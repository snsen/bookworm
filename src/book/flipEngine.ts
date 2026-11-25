// The only module that talks to the page-turn library. Swapping engines
// (e.g. back to the original `page-flip`, whose API this fork keeps) means editing this file.
import { FlippingState, PageFlip } from '@gullabs/flipbook-core';
import type { Size } from './layout';

export interface FlipBookOptions {
  pageCount: number;
  size: Size;
  paper: string;
  /** Upper bound of one turn's duration, ms. */
  flippingTime?: number;
}

type FlipListener = (visible: number[], page: number) => void;

export class FlipBook {
  /** Content host per page index; the engine owns each page's root element. */
  readonly hosts: HTMLElement[] = [];
  private engine: PageFlip;
  private root: HTMLElement;
  private flipListeners = new Set<FlipListener>();
  private turnStartListeners = new Set<() => void>();
  private destroyed = false;
  /**
   * Turns requested while a page is still moving. Interrupting a running turn can leave
   * a hard cover stuck mid-rotation in the engine, so requests wait for the turn to end.
   */
  private pending = 0;

  constructor(container: HTMLElement, opts: FlipBookOptions) {
    this.root = document.createElement('div');
    this.root.className = 'flipbook';
    container.appendChild(this.root);

    const pages: HTMLElement[] = [];
    for (let i = 0; i < opts.pageCount; i++) {
      const page = document.createElement('div');
      page.className = 'page';
      // With a lone cover on the right, odd pages sit on the left of a spread.
      page.dataset.side = i === 0 ? 'right' : i % 2 === 1 ? 'left' : 'right';
      const inner = document.createElement('div');
      inner.className = 'page-inner';
      const content = document.createElement('div');
      content.className = 'page-content';
      inner.appendChild(content);
      page.appendChild(inner);
      pages.push(page);
      this.hosts.push(content);
      this.root.appendChild(page);
    }

    this.engine = new PageFlip(this.root, {
      width: opts.size.width,
      height: opts.size.height,
      sizing: 'fixed',
      autoSize: true,
      usePortrait: false,
      hardCovers: opts.pageCount > 2,
      drawShadow: true,
      maxShadowOpacity: 0.55,
      flippingTime: opts.flippingTime ?? 1100,
      flipOnClick: 'anywhere',
      foldCornerOnHover: true,
      allowTouchScroll: false,
      pageBackground: opts.paper,
      respectReducedMotion: false,
    });
    this.engine.on('flip', (e) => {
      for (const l of this.flipListeners) l(e.data.visiblePages, e.data.page);
    });
    this.engine.on('changeState', (e) => {
      if (e.data.state === FlippingState.FLIPPING) for (const l of this.turnStartListeners) l();
      if (e.data.state === FlippingState.READ && this.pending !== 0) setTimeout(this.drain, 0);
    });
    this.engine.loadFromHTML(pages);
  }

  onFlip(listener: FlipListener): () => void {
    this.flipListeners.add(listener);
    return () => this.flipListeners.delete(listener);
  }

  /** Fires when a page starts its turn animation (any cause). */
  onTurnStart(listener: () => void): () => void {
    this.turnStartListeners.add(listener);
    return () => this.turnStartListeners.delete(listener);
  }

  get element(): HTMLElement {
    return this.root;
  }

  get pageCount(): number {
    return this.hosts.length;
  }

  get currentPage(): number {
    return this.engine.getCurrentPageIndex();
  }

  get visiblePages(): number[] {
    return this.engine.getVisiblePages();
  }

  get isAnimating(): boolean {
    return this.engine.isAnimating();
  }

  /** True when the spread showing the last page is on screen. */
  get atEnd(): boolean {
    return !this.engine.canTurn('next');
  }

  next(): boolean {
    if (this.engine.isAnimating()) {
      this.pending = Math.min(2, Math.max(0, this.pending) + 1);
      return true;
    }
    return this.engine.flipNext();
  }

  prev(): boolean {
    if (this.engine.isAnimating()) {
      this.pending = Math.max(-2, Math.min(0, this.pending) - 1);
      return true;
    }
    return this.engine.flipPrev();
  }

  private drain = (): void => {
    if (this.destroyed || this.pending === 0 || this.engine.isAnimating()) return;
    if (this.pending > 0) {
      this.pending--;
      this.engine.flipNext();
    } else {
      this.pending++;
      this.engine.flipPrev();
    }
  };

  goTo(page: number, animate = true): void {
    this.pending = 0;
    if (this.engine.isAnimating()) this.engine.cancelTurn();
    const target = Math.max(0, Math.min(this.pageCount - 1, page));
    if (animate) this.engine.flipToPage(target);
    else this.engine.turnToPage(target);
  }

  resize(size: Size): void {
    this.engine.updateSettings({ width: size.width, height: size.height });
    this.engine.update();
  }

  setPaper(color: string): void {
    this.engine.updateSettings({ pageBackground: color });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.flipListeners.clear();
    this.turnStartListeners.clear();
    this.engine.destroy();
    this.root.remove();
  }
}
