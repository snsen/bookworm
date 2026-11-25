import './styles/app.css';
import { t } from './i18n';
import { loadSettings, normalizeSettings, saveSettings, TONES, type Settings } from './settings';
import { sniffFormat } from './sources/detect';
import { BookError, isAbortError, type BookSource, type RenderContext } from './sources/types';
import { FlipBook } from './book/flipEngine';
import { PageCache } from './book/pageCache';
import { fitSpread, type Size } from './book/layout';
import { AutoPlayer } from './player/autoPlayer';
import { PageSound } from './player/sound';
import { h } from './ui/dom';
import { Toolbar } from './ui/toolbar';
import { SettingsPanel } from './ui/settingsPanel';
import { ErrorDialog, LoadingOverlay, Welcome } from './ui/screens';
import { IdleHider, isFullscreen, toggleFullscreen } from './ui/fullscreen';
import { bindInput } from './ui/input';
import { createDustLayer } from './ui/ambience';

const PREFETCH_AHEAD = 6;
const PREFETCH_BEHIND = 2;
/** Height kept free for the toolbar outside full screen (must match --toolbar-space). */
const TOOLBAR_SPACE = 76;

interface Session {
  source: BookSource;
  book: FlipBook;
  cache: PageCache;
  player: AutoPlayer;
  /** Kept for EPUB so a text-size change can re-paginate. */
  data: ArrayBuffer | null;
  fileName: string;
}

class App {
  private settings: Settings = loadSettings();
  private session: Session | null = null;
  private loadController: AbortController | null = null;
  private sound = new PageSound();

  private stage = h('main', { class: 'stage' });
  private bookArea = h('div', { class: 'book-area' });
  private dim = h('div', { class: 'dim', 'aria-hidden': 'true' });
  private welcome = new Welcome((f) => void this.openFile(f));
  private loading = new LoadingOverlay();
  private errors = new ErrorDialog();
  private toolbar: Toolbar;
  private panel: SettingsPanel;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private flipCount = 0;

  constructor() {
    this.toolbar = new Toolbar({
      prev: () => this.manual(() => this.session?.book.prev()),
      next: () => this.manual(() => this.session?.book.next()),
      togglePlay: () => this.togglePlay(),
      toggleSound: () => this.update({ sound: !this.settings.sound }),
      toggleSettings: () => this.setPanel(!this.panel.isOpen),
      toggleFullscreen: () => void toggleFullscreen(),
      openFile: () => this.welcome.pick(),
    });
    this.panel = new SettingsPanel(
      (patch) => this.update(patch),
      () => this.setPanel(false),
    );

    this.stage.append(this.bookArea, this.welcome.el);
    document.body.append(
      this.stage,
      createDustLayer(),
      this.dim,
      this.toolbar.el,
      this.panel.el,
      this.loading.el,
      this.welcome.dropOverlay,
      this.errors.el,
    );

    const idle = new IdleHider(3000, () => !this.panel.isOpen && this.loading.el.hidden);
    document.addEventListener('fullscreenchange', () => {
      this.toolbar.setFullscreen(isFullscreen());
      document.body.classList.toggle('is-fullscreen', isFullscreen());
      idle.wake();
    });

    bindInput(this.stage, () => this.session?.book.element ?? null, {
      next: () => this.manual(() => this.session?.book.next()),
      prev: () => this.manual(() => this.session?.book.prev()),
      first: () => this.manual(() => this.session?.book.goTo(0, false)),
      last: () => this.manual(() => this.session?.book.goTo(this.session.book.pageCount - 1, false)),
      togglePlay: () => this.togglePlay(),
      toggleFullscreen: () => void toggleFullscreen(),
      closePanels: () => {
        if (!this.panel.isOpen) return false;
        this.setPanel(false);
        return true;
      },
      isActive: () => this.session !== null && !this.errors.el.open,
    });

    // Any gesture is an opportunity to unlock audio (browser autoplay policy).
    window.addEventListener('pointerdown', () => this.settings.sound && this.sound.unlock(), { capture: true });
    window.addEventListener('keydown', () => this.settings.sound && this.sound.unlock(), { capture: true });
    window.addEventListener('resize', () => this.scheduleResize());

    this.applySettings(null);
    this.exposeTestHooks();
  }

  // ───────────────────────── settings ─────────────────────────

  private update(patch: Partial<Settings>): void {
    const prev = this.settings;
    this.settings = normalizeSettings({ ...prev, ...patch });
    saveSettings(this.settings);
    if (patch.sound) this.sound.unlock();
    this.applySettings(prev);
  }

  private applySettings(prev: Settings | null): void {
    const s = this.settings;
    const tone = TONES[s.tone];
    const root = document.documentElement.style;
    root.setProperty('--stage-bg', s.background);
    root.setProperty('--paper', tone.paper);
    root.setProperty('--ink', tone.ink);
    root.setProperty('--accent-ink', tone.accent);
    document.body.classList.toggle('ambience', s.ambience);
    root.setProperty('--epub-vector-filter', s.tone === 'night' ? 'invert(0.82) hue-rotate(180deg)' : 'none');
    root.setProperty('--epub-raster-filter', s.tone === 'night' ? 'brightness(0.72)' : 'none');
    document.documentElement.dataset.tone = s.tone;
    this.dim.style.opacity = String(1 - s.brightness);
    this.sound.enabled = s.sound;
    this.toolbar.setSound(s.sound);
    this.panel.update(s);

    const session = this.session;
    if (!session) return;
    session.player.setInterval(s.interval);
    session.player.setLoop(s.loop);
    session.cache.setLoop(s.loop);
    if (!prev || prev.tone !== s.tone) {
      session.book.setPaper(tone.paper);
      session.cache.setContext(this.renderContext());
    }
    if (prev && prev.textSize !== s.textSize && session.source.kind === 'epub' && session.data) {
      const progress = session.book.currentPage / Math.max(1, session.book.pageCount - 1);
      void this.load(session.data, session.fileName, 'epub', progress, session.player.isPlaying);
    }
  }

  private setPanel(open: boolean): void {
    // Return keyboard focus to the page so arrow keys turn pages again.
    if (!open && this.panel.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.panel.setOpen(open);
    this.toolbar.el.classList.toggle('panel-open', open);
  }

  // ───────────────────────── loading ─────────────────────────

  private async openFile(file: File): Promise<void> {
    this.setPanel(false);
    let format;
    try {
      const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
      format = sniffFormat(file.name, head);
    } catch (err) {
      this.errors.show(t.errCorrupt, String(err));
      return;
    }
    switch (format) {
      case 'kindle':
        return this.errors.show(t.errKindle);
      case 'acsm':
        return this.errors.show(t.errAcsm);
      case 'lcpl':
        return this.errors.show(t.errDrmEpub, 'Readium LCP');
      case 'unknown':
        return this.errors.show(t.errUnsupported);
    }
    const data = await file.arrayBuffer();
    await this.load(data, file.name.replace(/\.[^.]+$/, ''), format, 0);
  }

  private async load(
    data: ArrayBuffer,
    name: string,
    kind: 'pdf' | 'epub',
    progress: number,
    resumePlaying = false,
  ): Promise<void> {
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    this.loading.show(t.loadingOpen);
    try {
      let source: BookSource;
      if (kind === 'pdf') {
        const { PdfSource } = await import('./sources/pdfSource');
        // PDF.js takes ownership of the buffer it is given.
        source = await PdfSource.open(data, name);
      } else {
        const { EpubSource } = await import('./sources/epubSource');
        source = await EpubSource.open(
          data,
          name,
          this.settings.textSize,
          (done, total) => this.loading.show(t.loadingPaginate(done, total), total ? done / total : 0),
          controller.signal,
        );
      }
      if (controller.signal.aborted) {
        source.destroy();
        return;
      }
      this.closeSession();
      const startPage = Math.round(progress * (source.pageCount - 1));
      this.startSession(source, kind === 'epub' ? data : null, name, startPage);
      if (resumePlaying) this.session?.player.start();
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) return;
      console.error(err);
      if (err instanceof BookError) this.errors.show(err.message, err.details);
      else this.errors.show(t.errCorrupt, err instanceof Error ? err.message : String(err));
    } finally {
      if (this.loadController === controller) {
        this.loadController = null;
        this.loading.hide();
      }
    }
  }

  private startSession(source: BookSource, data: ArrayBuffer | null, fileName: string, startPage: number): void {
    const size = this.pageSize(source.aspect);
    const book = new FlipBook(this.bookArea, {
      pageCount: source.pageCount,
      size,
      paper: TONES[this.settings.tone].paper,
    });
    const cache = new PageCache(source, book.hosts, {
      ahead: PREFETCH_AHEAD,
      behind: PREFETCH_BEHIND,
      slack: 2,
      concurrency: 2,
    });
    const player = new AutoPlayer(book, this.settings.interval, this.settings.loop);
    const session: Session = { source, book, cache, player, data, fileName };
    this.session = session;

    this.setScale(size);
    cache.setLoop(this.settings.loop);
    cache.setContext(this.renderContext());
    if (startPage > 0) book.goTo(startPage, false);
    cache.setVisible(book.visiblePages);

    book.onFlip((visible) => {
      this.flipCount++;
      cache.setVisible(visible);
      this.toolbar.setPages(visible, source.pageCount);
    });
    book.onTurnStart(() => this.sound.play());
    // Dragging or clicking a page by hand restarts the countdown.
    book.element.addEventListener('pointerdown', () => player.restartCountdown());
    player.onChange((playing) => {
      this.toolbar.setPlaying(playing);
      document.body.classList.toggle('is-playing', playing);
    });

    this.welcome.show(false);
    this.toolbar.show(true);
    this.toolbar.setTitle(source.title);
    this.toolbar.setPages(book.visiblePages, source.pageCount);
    this.toolbar.setPlaying(false);
    document.body.classList.add('has-book');
    document.title = `${source.title} · ${t.appName}`;
  }

  private closeSession(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    s.player.destroy();
    s.cache.destroy();
    s.book.destroy();
    s.source.destroy();
  }

  // ───────────────────────── layout ─────────────────────────

  private stageSize(): Size {
    const width = this.stage.clientWidth || window.innerWidth;
    const height = this.stage.clientHeight || window.innerHeight;
    // Outside full screen the toolbar stays visible, so keep the book clear of it.
    const reserve = isFullscreen() ? 0 : TOOLBAR_SPACE;
    return { width, height: height - reserve };
  }

  private pageSize(aspect: number): Size {
    return fitSpread(this.stageSize(), aspect);
  }

  private renderContext(): RenderContext {
    const s = this.session;
    const size = s ? this.pageSize(s.source.aspect) : { width: 1, height: 1 };
    return {
      pageWidth: size.width,
      pageHeight: size.height,
      dpr: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
      tone: TONES[this.settings.tone],
      toneName: this.settings.tone,
    };
  }

  private setScale(size: Size): void {
    const src = this.session?.source as { layout?: { width: number } } | undefined;
    if (src?.layout) this.bookArea.style.setProperty('--epub-scale', String(size.width / src.layout.width));
  }

  private scheduleResize(): void {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      const s = this.session;
      if (!s) return;
      const size = this.pageSize(s.source.aspect);
      s.book.resize(size);
      this.setScale(size);
      s.cache.setContext(this.renderContext());
    }, 150);
  }

  // ───────────────────────── playback ─────────────────────────

  private togglePlay(): void {
    const s = this.session;
    if (!s) return;
    if (this.settings.sound) this.sound.unlock();
    s.player.toggle();
  }

  private manual(action: () => void): void {
    action();
    this.session?.player.restartCountdown();
  }

  /** Read-only hooks used by the end-to-end and soak tests. */
  private exposeTestHooks(): void {
    (window as unknown as { __bookworm: unknown }).__bookworm = {
      state: () => {
        const s = this.session;
        if (!s) return null;
        return {
          kind: s.source.kind,
          title: s.source.title,
          pageCount: s.source.pageCount,
          current: s.book.currentPage,
          visible: s.book.visiblePages,
          playing: s.player.isPlaying,
          cache: s.cache.getStats(),
          visibleReady: s.cache.isVisibleReady(),
          animating: s.book.isAnimating,
          flips: this.flipCount,
        };
      },
      settings: () => ({ ...this.settings }),
    };
  }
}

new App();
