import { isAbortError, type BookSource, type RenderContext, type RenderedPage } from '../sources/types';
import { pageWindow } from './window';

interface Entry {
  /** Content currently shown in the shell (may be stale while a redraw is pending). */
  shown?: RenderedPage;
  shownKey?: string;
  loading?: { key: string; controller: AbortController };
}

export interface PageCacheOptions {
  ahead: number;
  behind: number;
  /** Extra pages kept (not rendered) beyond the window before eviction, to avoid thrashing. */
  slack: number;
  concurrency: number;
}

export interface CacheStats {
  rendered: number;
  loading: number;
  renders: number;
  evictions: number;
}

/**
 * Keeps only the pages around the current spread rendered.
 * Pages leaving the window are aborted (if loading) or released (if shown).
 */
export class PageCache {
  private entries = new Map<number, Entry>();
  private queue: number[] = [];
  private running = 0;
  private visible: number[] = [0];
  private ctx: RenderContext | null = null;
  private loop = false;
  private destroyed = false;
  private stats = { renders: 0, evictions: 0 };

  constructor(
    private source: BookSource,
    /** Content element of each page shell, by page index. */
    private hosts: HTMLElement[],
    private opts: PageCacheOptions,
    private onError: (index: number, err: unknown) => void = (i, e) => console.error(`page ${i}`, e),
  ) {}

  setContext(ctx: RenderContext): void {
    this.ctx = ctx;
    this.schedule();
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    this.schedule();
  }

  setVisible(visible: number[]): void {
    this.visible = visible.length ? [...visible] : [0];
    this.schedule();
  }

  getStats(): CacheStats {
    let rendered = 0;
    let loading = 0;
    for (const e of this.entries.values()) {
      if (e.shown) rendered++;
      if (e.loading) loading++;
    }
    return { rendered, loading, ...this.stats };
  }

  /** True when every visible page shows content for the current context. */
  isVisibleReady(): boolean {
    if (!this.ctx) return false;
    const key = this.source.renderKey(this.ctx);
    return this.visible.every((i) => this.entries.get(i)?.shownKey === key);
  }

  private schedule(): void {
    if (this.destroyed || !this.ctx) return;
    const n = this.source.pageCount;
    const want = pageWindow(this.visible, { pageCount: n, ahead: this.opts.ahead, behind: this.opts.behind, loop: this.loop });
    const keep = new Set(
      pageWindow(this.visible, {
        pageCount: n,
        ahead: this.opts.ahead + this.opts.slack,
        behind: this.opts.behind + this.opts.slack,
        loop: this.loop,
      }),
    );
    for (const i of want) keep.add(i);

    // Evict everything outside the keep set.
    for (const [i, e] of this.entries) {
      if (keep.has(i)) continue;
      e.loading?.controller.abort();
      if (e.shown) {
        e.shown.release();
        this.stats.evictions++;
      }
      this.entries.delete(i);
    }

    const key = this.source.renderKey(this.ctx);
    this.queue = want.filter((i) => {
      const e = this.entries.get(i);
      if (e?.loading?.key === key) return false;
      return e?.shownKey !== key;
    });
    // Cancel in-flight renders for an outdated context.
    for (const e of this.entries.values()) {
      if (e.loading && e.loading.key !== key) {
        e.loading.controller.abort();
        e.loading = undefined;
      }
    }
    this.pump();
  }

  private pump(): void {
    while (!this.destroyed && this.ctx && this.running < this.opts.concurrency && this.queue.length) {
      const index = this.queue.shift()!;
      void this.renderOne(index, this.ctx);
    }
    if (this.running === 0 && this.queue.length === 0) this.source.onIdle?.();
  }

  private async renderOne(index: number, ctx: RenderContext): Promise<void> {
    const key = this.source.renderKey(ctx);
    let entry = this.entries.get(index);
    if (!entry) {
      entry = {};
      this.entries.set(index, entry);
    }
    const controller = new AbortController();
    entry.loading = { key, controller };
    this.running++;
    try {
      const page = await this.source.render(index, ctx, controller.signal);
      if (controller.signal.aborted || this.destroyed || this.entries.get(index) !== entry) {
        page.release();
        return;
      }
      // Swap in the new content only when it is ready, so a redraw never flashes blank.
      const old = entry.shown;
      this.hosts[index].replaceChildren(page.element);
      old?.release();
      entry.shown = page;
      entry.shownKey = key;
      this.stats.renders++;
    } catch (err) {
      if (!isAbortError(err) && !controller.signal.aborted) this.onError(index, err);
    } finally {
      if (entry.loading?.controller === controller) entry.loading = undefined;
      this.running--;
      this.pump();
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const e of this.entries.values()) {
      e.loading?.controller.abort();
      e.shown?.release();
    }
    this.entries.clear();
    this.queue = [];
  }
}
