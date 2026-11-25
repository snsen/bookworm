import ePub, { type Book } from 'epubjs';
import JSZip from 'jszip';
import DOMPurify from 'dompurify';
import { t } from '../i18n';
import type { TextSize } from '../settings';
import { findEpubDrm } from './detect';
import { buildScopedSheet, collectCssUrls, collectImports, preprocessCss } from './epub/css';
import { BookError, type BookSource, type RenderContext, type RenderedPage } from './types';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const OPS_NS = 'http://www.idpf.org/2007/ops';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
/** Sections longer than this (in characters) are laid out in several pieces. */
const CHUNK_CHARS = 60_000;
/** Parsed sections kept in memory while no visible page uses them. */
const SECTION_CACHE = 3;
const IMAGE_WAIT_MS = 4000;

export interface EpubLayout {
  /** Logical page size in CSS px. Pages are scaled to the screen with a transform. */
  width: number;
  height: number;
  padX: number;
  padTop: number;
  contentW: number;
  contentH: number;
  gap: number;
}

/**
 * Text is always laid out on a fixed logical page and scaled to fit the screen, so
 * entering full screen or resizing never re-paginates. A larger text size simply means
 * a narrower logical page (fewer words per page, scaled up more).
 */
export function epubLayout(size: TextSize): EpubLayout {
  const width = size === 'small' ? 620 : size === 'large' ? 460 : 540;
  const height = Math.round(width / 0.68);
  const padX = Math.round(width * 0.095);
  const padTop = Math.round(height * 0.07);
  const padBottom = Math.round(height * 0.085);
  return {
    width,
    height,
    padX,
    padTop,
    contentW: width - 2 * padX,
    contentH: height - padTop - padBottom,
    gap: 2 * padX,
  };
}

interface Part {
  section: number;
  chunk: number;
  /** Global index of this part's first page. */
  first: number;
  pages: number;
}

interface SectionData {
  sheets: CSSStyleSheet[];
  /** Inert templates; cloned into each page. */
  chunks: DocumentFragment[];
  urls: string[];
  htmlAttrs: [string, string][];
  bodyAttrs: [string, string][];
}

interface SectionEntry {
  promise: Promise<SectionData>;
  data?: SectionData;
  refs: number;
  lastUsed: number;
}

type ProgressFn = (done: number, total: number) => void;

/** Resolves `rel` against the archive path `base` ("/OEBPS/text/ch1.xhtml"). Returns an encoded absolute path. */
function resolvePath(base: string, rel: string): string | null {
  try {
    const u = new URL(rel, `epub://book${base}`);
    if (u.protocol !== 'epub:' || u.host !== 'book') return null; // external link
    return u.pathname;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function settleImages(root: ParentNode, timeoutMs: number): Promise<void> {
  const imgs = [...root.querySelectorAll('img')];
  if (imgs.length === 0) return;
  await Promise.race([
    Promise.all(imgs.map((img) => (img.complete && img.naturalWidth ? null : img.decode().catch(() => {})))),
    sleep(timeoutMs),
  ]);
}

export class EpubSource implements BookSource {
  readonly kind = 'epub';
  readonly aspect: number;
  pageCount = 0;
  title: string;

  private parts: Part[] = [];
  private spine: string[] = [];
  private sections = new Map<number, SectionEntry>();
  private sheetCache = new Map<string, Promise<CSSStyleSheet | null>>();
  private bookUrls: string[] = [];
  private fontSheet = new CSSStyleSheet();
  private baseSheet = new CSSStyleSheet();
  private overrideSheet = new CSSStyleSheet();
  private measureHost: HTMLElement;
  private useCounter = 0;
  private destroyed = false;

  private constructor(
    private book: Book,
    readonly layout: EpubLayout,
    fallbackTitle: string,
  ) {
    this.aspect = layout.width / layout.height;
    const meta = (book as unknown as { packaging?: { metadata?: { title?: string } } }).packaging?.metadata;
    this.title = meta?.title?.trim() || fallbackTitle;
    this.installSheets();
    this.measureHost = document.createElement('div');
    this.measureHost.className = 'epub-measure';
    this.measureHost.setAttribute('aria-hidden', 'true');
    Object.assign(this.measureHost.style, {
      position: 'fixed',
      left: '-100000px',
      top: '0',
      width: `${layout.width}px`,
      height: `${layout.height}px`,
      visibility: 'hidden',
      contain: 'strict',
      pointerEvents: 'none',
    });
    document.body.appendChild(this.measureHost);
  }

  static async open(
    data: ArrayBuffer,
    fallbackTitle: string,
    textSize: TextSize,
    onProgress: ProgressFn,
    signal: AbortSignal,
  ): Promise<EpubSource> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(data);
    } catch (err) {
      throw new BookError(t.errCorrupt, String(err));
    }
    const drm = await findEpubDrm(zip);
    if (drm) throw new BookError(t.errDrmEpub, drm);

    const book = ePub(data as unknown as string);
    try {
      await book.opened;
    } catch (err) {
      book.destroy();
      throw new BookError(t.errCorrupt, err instanceof Error ? err.message : String(err));
    }
    signal.throwIfAborted();
    const source = new EpubSource(book, epubLayout(textSize), fallbackTitle);
    try {
      await source.paginate(onProgress, signal);
    } catch (err) {
      source.destroy();
      throw err;
    }
    if (source.pageCount === 0) {
      source.destroy();
      throw new BookError(t.errEmpty);
    }
    return source;
  }

  // ───────────────────────── stylesheets ─────────────────────────

  private installSheets(): void {
    const L = this.layout;
    // Defaults a book may override.
    this.baseSheet.replaceSync(`
      :host { all: initial; display: block; position: absolute; inset: 0; }
      .viewport { position: absolute; left: ${L.padX}px; top: ${L.padTop}px; width: ${L.contentW}px; height: ${L.contentH}px; overflow: hidden; }
      .epub-html {
        font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, 'DejaVu Serif', serif;
        font-size: 19px; line-height: 1.5; text-align: justify; hyphens: auto; -webkit-hyphens: auto;
        overflow-wrap: break-word; text-rendering: optimizeLegibility; font-kerning: normal;
      }
      p { margin: 0; }
      h1, h2, h3, h4 { text-align: center; line-height: 1.25; break-after: avoid; hyphens: manual; }
    `);
    // Structural rules the book must not override.
    this.overrideSheet.replaceSync(`
      .epub-html {
        position: relative !important; display: block !important;
        width: ${L.contentW}px !important; height: ${L.contentH}px !important;
        margin: 0 !important; padding: 0 !important; border: 0 !important;
        columns: ${L.contentW}px auto !important; column-gap: ${L.gap}px !important; column-fill: auto !important;
        background: transparent !important; color: var(--ink, #222) !important;
        overflow: visible !important;
      }
      .epub-body {
        display: block !important; margin: 0 !important; padding: 0 !important; border: 0 !important;
        width: auto !important; height: auto !important; max-width: none !important; min-height: 0 !important;
        columns: auto !important; background: transparent !important; color: inherit !important;
        position: static !important; transform: none !important;
      }
      img, svg, video, object { max-width: 100% !important; max-height: ${L.contentH}px !important; box-sizing: border-box; }
      img { height: auto; object-fit: contain; }
      img[data-kind="vector"] { filter: var(--epub-vector-filter, none); }
      img:not([data-kind="vector"]) { filter: var(--epub-raster-filter, none); }
      figure, img, svg, table, pre, blockquote { break-inside: avoid; }
      a { color: inherit !important; text-decoration: none !important; pointer-events: none; }
      [style*="fixed" i] { position: static !important; }
    `);
    this.fontSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.fontSheet];
  }

  private async createArchiveUrl(path: string): Promise<{ url: string; type: string } | null> {
    try {
      const blob = await (this.book.archive.getBlob(path) as Promise<Blob> | undefined);
      if (!blob) return null;
      return { url: URL.createObjectURL(blob), type: blob.type };
    } catch {
      return null;
    }
  }

  private async readText(path: string): Promise<string | null> {
    try {
      const text = await (this.book.archive.getText(path) as Promise<string> | undefined);
      return text ?? null;
    } catch {
      return null;
    }
  }

  /** Loads a stylesheet once per book (shared by every page through adoptedStyleSheets). */
  private sheetFor(path: string): Promise<CSSStyleSheet | null> {
    let p = this.sheetCache.get(path);
    if (!p) {
      p = this.readText(path).then((css) => (css == null ? null : this.makeSheet(css, path)));
      this.sheetCache.set(path, p);
    }
    return p;
  }

  private async inlineImports(css: string, basePath: string, depth: number): Promise<string> {
    if (depth > 2) return css;
    let prefix = '';
    for (const href of collectImports(css)) {
      const path = resolvePath(basePath, href);
      const imported = path ? await this.readText(path) : null;
      if (imported && path) prefix += (await this.inlineImports(imported, path, depth + 1)) + '\n';
    }
    return prefix + css;
  }

  private async makeSheet(rawCss: string, basePath: string): Promise<CSSStyleSheet> {
    const css = await this.inlineImports(rawCss, basePath, 0);
    const urls = new Map<string, string>();
    for (const rel of collectCssUrls(css)) {
      const path = resolvePath(basePath, rel);
      const made = path ? await this.createArchiveUrl(path) : null;
      if (made) {
        urls.set(rel, made.url);
        this.bookUrls.push(made.url);
      }
    }
    const { sheet, fontFaces } = buildScopedSheet(
      preprocessCss(css, { urls, viewportWidth: this.layout.contentW, viewportHeight: this.layout.contentH }),
    );
    for (const rule of fontFaces) {
      try {
        this.fontSheet.insertRule(rule, this.fontSheet.cssRules.length);
      } catch {
        // ignore unsupported font rules
      }
    }
    return sheet;
  }

  // ───────────────────────── sections ─────────────────────────

  private async loadSection(index: number): Promise<SectionData> {
    const path = this.spine[index];
    const text = (await this.readText(path)) ?? '';
    let doc = new DOMParser().parseFromString(text, 'application/xhtml+xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
      doc = new DOMParser().parseFromString(text, 'text/html');
    }

    const sheets: CSSStyleSheet[] = [];
    const styleEls = [...doc.querySelectorAll('link, style')];
    for (const [i, el] of styleEls.entries()) {
      const name = el.localName.toLowerCase();
      if (name === 'link') {
        const rel = (el.getAttribute('rel') ?? '').toLowerCase();
        const href = el.getAttribute('href');
        if (!rel.split(/\s+/).includes('stylesheet') || !href) continue;
        const cssPath = resolvePath(path, href);
        const sheet = cssPath ? await this.sheetFor(cssPath) : null;
        if (sheet) sheets.push(sheet);
      } else if (name === 'style') {
        const key = `${path}#style${i}`;
        let p = this.sheetCache.get(key);
        if (!p) {
          p = this.makeSheet(el.textContent ?? '', path);
          this.sheetCache.set(key, p);
        }
        const sheet = await p;
        if (sheet) sheets.push(sheet);
      }
    }

    const html = doc.documentElement;
    const body = (doc.body ?? doc.querySelector('body') ?? html) as Element;
    const pickAttrs = (el: Element, names: string[]): [string, string][] => {
      const out: [string, string][] = [];
      for (const n of names) {
        const v = n === 'lang' ? el.getAttribute('lang') ?? el.getAttribute('xml:lang') : el.getAttribute(n);
        if (v) out.push([n, v]);
      }
      const epubType = el.getAttributeNS(OPS_NS, 'type') ?? el.getAttribute('epub:type');
      if (epubType) out.push(['data-epub-type', epubType]);
      return out;
    };
    const htmlAttrs = pickAttrs(html, ['lang', 'dir', 'class']);
    const bodyAttrs = pickAttrs(body, ['lang', 'dir', 'class', 'id']);
    if (!htmlAttrs.some(([n]) => n === 'lang')) {
      const lang = (this.book as unknown as { packaging?: { metadata?: { language?: string } } }).packaging?.metadata
        ?.language;
      if (lang) htmlAttrs.push(['lang', lang]);
    }

    // epub:type is namespaced in XHTML and a plain attribute in HTML; normalise both.
    for (const el of body.getElementsByTagName('*')) {
      const v = el.getAttributeNS(OPS_NS, 'type') ?? el.getAttribute('epub:type');
      if (v) el.setAttribute('data-epub-type', v);
    }

    const wrapper = doc.createElementNS(XHTML_NS, 'div');
    while (body.firstChild) wrapper.appendChild(body.firstChild);
    const clean = DOMPurify.sanitize(wrapper, {
      RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: ['style', 'link', 'meta', 'base', 'title', 'iframe', 'frame', 'object', 'embed', 'form', 'input',
        'button', 'textarea', 'select', 'video', 'audio', 'source', 'track', 'script', 'noscript'],
      FORBID_ATTR: ['srcset', 'autofocus', 'tabindex'],
    }) as DocumentFragment;
    const root = clean.firstElementChild ?? clean;

    const urls: string[] = [];
    const urlFor = new Map<string, Promise<{ url: string; type: string } | null>>();
    const toBlobUrl = (rel: string) => {
      const p = resolvePath(path, rel);
      if (!p) return Promise.resolve(null);
      let pending = urlFor.get(p);
      if (!pending) {
        pending = this.createArchiveUrl(p).then((r) => {
          if (r) urls.push(r.url);
          return r;
        });
        urlFor.set(p, pending);
      }
      return pending;
    };

    const jobs: Promise<void>[] = [];
    for (const img of root.querySelectorAll('img')) {
      const src = img.getAttribute('src');
      img.removeAttribute('src');
      img.setAttribute('decoding', 'async');
      if (!src) continue;
      jobs.push(
        toBlobUrl(src).then((r) => {
          if (!r) return;
          img.setAttribute('src', r.url);
          if (r.type.includes('svg')) img.setAttribute('data-kind', 'vector');
        }),
      );
    }
    for (const image of root.querySelectorAll('image')) {
      const href = image.getAttribute('href') ?? image.getAttributeNS(XLINK_NS, 'href');
      image.removeAttribute('href');
      image.removeAttributeNS(XLINK_NS, 'href');
      if (!href) continue;
      jobs.push(
        toBlobUrl(href).then((r) => {
          if (r) image.setAttribute('href', r.url);
        }),
      );
    }
    for (const a of root.querySelectorAll('a[href]')) a.removeAttribute('href');
    // Inline styles must not fetch anything from the network (or the app origin).
    for (const el of root.querySelectorAll('[style*="url("]')) {
      el.setAttribute('style', (el.getAttribute('style') ?? '').replace(/url\([^)]*\)/gi, 'none'));
    }
    await Promise.all(jobs);

    return { sheets, chunks: splitIntoChunks(root, CHUNK_CHARS), urls, htmlAttrs, bodyAttrs };
  }

  private acquire(index: number): SectionEntry {
    let entry = this.sections.get(index);
    if (!entry) {
      const created: SectionEntry = { promise: this.loadSection(index), refs: 0, lastUsed: 0 };
      created.promise.then(
        (d) => {
          created.data = d;
          if (this.destroyed || this.sections.get(index) !== created) revokeAll(d.urls);
        },
        () => this.sections.delete(index),
      );
      this.sections.set(index, created);
      entry = created;
    }
    entry.refs++;
    entry.lastUsed = ++this.useCounter;
    return entry;
  }

  private releaseSection(index: number): void {
    const entry = this.sections.get(index);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    entry.lastUsed = ++this.useCounter;
    this.trimSections();
  }

  private trimSections(): void {
    const idle = [...this.sections.entries()].filter(([, e]) => e.refs === 0 && e.data);
    if (idle.length <= SECTION_CACHE) return;
    idle.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [i, e] of idle.slice(0, idle.length - SECTION_CACHE)) {
      this.sections.delete(i);
      revokeAll(e.data!.urls);
    }
  }

  // ───────────────────────── layout ─────────────────────────

  private buildPage(data: SectionData, chunk: number): { el: HTMLElement; columns: HTMLElement } {
    const el = document.createElement('div');
    el.className = 'epub-page';
    const host = document.createElement('div');
    host.className = 'epub-host';
    el.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.adoptedStyleSheets = [this.baseSheet, ...data.sheets, this.overrideSheet];
    const viewport = document.createElement('div');
    viewport.className = 'viewport';
    const columns = document.createElement('div');
    const body = document.createElement('div');
    for (const [n, v] of data.htmlAttrs) columns.setAttribute(n, v);
    for (const [n, v] of data.bodyAttrs) body.setAttribute(n, v);
    columns.classList.add('epub-html');
    body.classList.add('epub-body');
    body.appendChild(document.importNode(data.chunks[chunk], true));
    columns.appendChild(body);
    viewport.appendChild(columns);
    shadow.appendChild(viewport);
    return { el, columns };
  }

  private async paginate(onProgress: ProgressFn, signal: AbortSignal): Promise<void> {
    const spineItems: { url: string; linear: boolean }[] = [];
    this.book.spine.each((s: { url: string; linear: boolean }) => spineItems.push({ url: s.url, linear: s.linear }));
    const linear = spineItems.filter((s) => s.linear);
    this.spine = (linear.length ? linear : spineItems).map((s) => s.url);
    const L = this.layout;

    let page = 0;
    for (let i = 0; i < this.spine.length; i++) {
      signal.throwIfAborted();
      onProgress(i, this.spine.length);
      const entry = this.acquire(i);
      try {
        const data = await entry.promise;
        for (let c = 0; c < data.chunks.length; c++) {
          const { el } = this.buildPage(data, c);
          this.measureHost.appendChild(el);
          const shadow = el.querySelector('.epub-host')!.shadowRoot!;
          await settleImages(shadow, IMAGE_WAIT_MS);
          await document.fonts.ready;
          const viewport = shadow.querySelector('.viewport') as HTMLElement;
          const pages = Math.max(1, Math.round((viewport.scrollWidth + L.gap) / (L.contentW + L.gap)));
          el.remove();
          // Skip sections that are completely empty (e.g. a stray blank file).
          const hasContent = (data.chunks[c].textContent ?? '').trim() !== '' || data.chunks[c].querySelector('img,svg');
          if (!hasContent) continue;
          this.parts.push({ section: i, chunk: c, first: page, pages });
          page += pages;
        }
      } catch (err) {
        if (signal.aborted) throw err;
        console.warn('Skipping unreadable section', this.spine[i], err);
      } finally {
        this.releaseSection(i);
      }
      // Let the progress bar paint.
      await sleep(0);
    }
    onProgress(this.spine.length, this.spine.length);
    this.pageCount = page;
  }

  private findPart(index: number): Part {
    let lo = 0;
    let hi = this.parts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.parts[mid].first <= index) lo = mid;
      else hi = mid - 1;
    }
    return this.parts[lo];
  }

  // ───────────────────────── BookSource ─────────────────────────

  renderKey(): string {
    return 'epub';
  }

  async render(index: number, _ctx: RenderContext, signal: AbortSignal): Promise<RenderedPage> {
    if (this.destroyed) throw new DOMException('destroyed', 'AbortError');
    const part = this.findPart(index);
    const entry = this.acquire(part.section);
    let handedOver = false;
    try {
      const data = await entry.promise;
      signal.throwIfAborted();
      const { el, columns } = this.buildPage(data, part.chunk);
      const L = this.layout;
      el.style.width = `${L.width}px`;
      el.style.height = `${L.height}px`;
      columns.style.transform = `translateX(${-(index - part.first) * (L.contentW + L.gap)}px)`;
      if (index > 0) {
        const folio = document.createElement('div');
        folio.className = 'epub-folio';
        folio.textContent = String(index + 1);
        el.appendChild(folio);
      }
      await settleImages(el.querySelector('.epub-host')!.shadowRoot!, IMAGE_WAIT_MS);
      signal.throwIfAborted();
      handedOver = true;
      let released = false;
      return {
        element: el,
        release: () => {
          if (released) return;
          released = true;
          el.remove();
          this.releaseSection(part.section);
        },
      };
    } finally {
      if (!handedOver) this.releaseSection(part.section);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const e of this.sections.values()) if (e.data) revokeAll(e.data.urls);
    this.sections.clear();
    revokeAll(this.bookUrls);
    this.bookUrls = [];
    this.sheetCache.clear();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== this.fontSheet);
    this.measureHost.remove();
    try {
      this.book.destroy();
    } catch {
      // epub.js may throw while tearing down a half-opened book
    }
  }
}

function revokeAll(urls: string[]): void {
  for (const u of urls) URL.revokeObjectURL(u);
}

/**
 * Splits very long sections at block boundaries so no single layout becomes huge.
 * Wrappers that hold all the content (e.g. <section><div>…) are cloned around each chunk.
 */
export function splitIntoChunks(root: ParentNode, maxChars: number): DocumentFragment[] {
  const doc = (root as Node).ownerDocument ?? document;
  const whole = () => {
    const f = doc.createDocumentFragment();
    while (root.firstChild) f.appendChild(root.firstChild);
    return f;
  };
  if ((root.textContent ?? '').length <= maxChars) return [whole()];

  // Descend through single wrappers that contain (almost) all the text.
  const chain: Element[] = [];
  let target: ParentNode = root;
  for (;;) {
    const kids = [...target.childNodes].filter(
      (n) => n.nodeType === Node.ELEMENT_NODE || (n.textContent ?? '').trim() !== '',
    );
    if (kids.length === 1 && kids[0].nodeType === Node.ELEMENT_NODE) {
      chain.push(kids[0] as Element);
      target = kids[0] as Element;
    } else break;
  }

  const groups: Node[][] = [[]];
  let size = 0;
  for (const node of [...target.childNodes]) {
    const len = (node.textContent ?? '').length;
    if (size > 0 && size + len > maxChars && node.nodeType === Node.ELEMENT_NODE) {
      groups.push([]);
      size = 0;
    }
    groups[groups.length - 1].push(node);
    size += len;
  }
  if (groups.length === 1) return [whole()];

  return groups.map((nodes) => {
    const frag = doc.createDocumentFragment();
    let parent: ParentNode = frag;
    for (const wrapper of chain) {
      const shell = wrapper.cloneNode(false) as Element;
      parent.appendChild(shell);
      parent = shell;
    }
    for (const n of nodes) parent.appendChild(n);
    return frag;
  });
}
