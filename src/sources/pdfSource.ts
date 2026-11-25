import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { t } from '../i18n';
import type { ToneColors } from '../settings';
import { BookError, type BookSource, type RenderContext, type RenderedPage } from './types';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Largest canvas edge we draw, to keep memory bounded on 4K screens. */
const MAX_CANVAS_EDGE = 4096;
/** Trim PDF.js font/image caches after this many renders (only while idle). */
const CLEANUP_EVERY = 40;

export class PdfSource implements BookSource {
  readonly kind = 'pdf';
  private rendersSinceCleanup = 0;
  private active = 0;
  private destroyed = false;

  private constructor(
    private task: PDFDocumentLoadingTask,
    private doc: PDFDocumentProxy,
    readonly title: string,
    readonly pageCount: number,
    readonly aspect: number,
  ) {}

  static async open(data: ArrayBuffer, fallbackTitle: string): Promise<PdfSource> {
    const task = getDocument({ data: new Uint8Array(data) });
    let doc: PDFDocumentProxy;
    try {
      doc = await task.promise;
    } catch (err) {
      await task.destroy().catch(() => {});
      const e = err as { name?: string; message?: string };
      if (e?.name === 'PasswordException' || /encrypt|password|decrypt/i.test(e?.message ?? '')) {
        throw new BookError(t.errDrmPdf, e?.message);
      }
      throw new BookError(t.errCorrupt, e?.message);
    }
    if (doc.numPages < 1) {
      await task.destroy();
      throw new BookError(t.errEmpty);
    }
    const first = await doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    first.cleanup();
    let title = fallbackTitle;
    try {
      const meta = await doc.getMetadata();
      const info = meta.info as { Title?: unknown } | undefined;
      if (typeof info?.Title === 'string' && info.Title.trim()) title = info.Title.trim();
    } catch {
      // metadata is optional
    }
    return new PdfSource(task, doc, title, doc.numPages, vp.width / vp.height);
  }

  renderKey(ctx: RenderContext): string {
    return `${Math.round(ctx.pageWidth * ctx.dpr)}x${Math.round(ctx.pageHeight * ctx.dpr)}|${ctx.toneName}`;
  }

  async render(index: number, ctx: RenderContext, signal: AbortSignal): Promise<RenderedPage> {
    if (this.destroyed) throw new DOMException('destroyed', 'AbortError');
    this.active++;
    const canvas = document.createElement('canvas');
    try {
      const page = await this.doc.getPage(index + 1);
      signal.throwIfAborted();
      const base = page.getViewport({ scale: 1 });
      // Fit the page inside the shell (pages of a different size are letterboxed).
      const fit = Math.min(ctx.pageWidth / base.width, ctx.pageHeight / base.height);
      let scale = fit * ctx.dpr;
      const edge = Math.max(base.width, base.height) * scale;
      if (edge > MAX_CANVAS_EDGE) scale *= MAX_CANVAS_EDGE / edge;
      const viewport = page.getViewport({ scale });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = `${Math.round(base.width * fit)}px`;
      canvas.style.height = `${Math.round(base.height * fit)}px`;

      const task = page.render({ canvas, viewport });
      const onAbort = () => task.cancel();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        await task.promise;
      } finally {
        signal.removeEventListener('abort', onAbort);
        page.cleanup();
      }
      signal.throwIfAborted();
      applyTone(canvas, ctx.tone, ctx.toneName === 'night');
      this.rendersSinceCleanup++;

      const wrap = document.createElement('div');
      wrap.className = 'pdf-page';
      wrap.appendChild(canvas);
      return {
        element: wrap,
        release: () => {
          // Dropping the backing store immediately frees the pixels (GC may be lazy).
          canvas.width = 0;
          canvas.height = 0;
          wrap.remove();
        },
      };
    } catch (err) {
      canvas.width = 0;
      canvas.height = 0;
      throw err;
    } finally {
      this.active--;
    }
  }

  onIdle(): void {
    if (this.active === 0 && this.rendersSinceCleanup >= CLEANUP_EVERY && !this.destroyed) {
      this.rendersSinceCleanup = 0;
      void this.doc.cleanup().catch(() => {});
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    void this.task.destroy().catch(() => {});
  }
}

/**
 * Bakes the paper tone into the rendered pixels once, so the page-turn animation
 * never has to run CSS blend modes or filters (which are slow during clip-path animations).
 *  - white/sepia: paper white → paper colour, black text → ink colour
 *  - night: inverted, so a dark page with light text
 */
function applyTone(canvas: HTMLCanvasElement, tone: ToneColors, invert: boolean): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.save();
  if (invert) {
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  // white → paper (or, inverted: light text → ink)
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = invert ? tone.ink : tone.paper;
  ctx.fillRect(0, 0, w, h);
  // black → ink (or, inverted: dark background → paper)
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = invert ? tone.paper : tone.ink;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
