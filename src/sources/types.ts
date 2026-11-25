import type { ToneColors } from '../settings';

/** Everything a source needs to draw one page. */
export interface RenderContext {
  /** Size of one page on screen, in CSS pixels. */
  pageWidth: number;
  pageHeight: number;
  /** Device pixel ratio to render at (already capped). */
  dpr: number;
  tone: ToneColors;
  toneName: string;
}

export interface RenderedPage {
  /** Element to place inside the page shell. */
  element: HTMLElement;
  /** Frees memory held by this page (canvas pixels, blob URLs…). */
  release(): void;
}

export interface BookSource {
  readonly kind: 'pdf' | 'epub';
  readonly title: string;
  readonly pageCount: number;
  /** width / height of one page. */
  readonly aspect: number;
  /**
   * A string that changes whenever an already rendered page would look different
   * for the new context. Pages rendered under another key are redrawn.
   */
  renderKey(ctx: RenderContext): string;
  render(index: number, ctx: RenderContext, signal: AbortSignal): Promise<RenderedPage>;
  /** Called when the render queue drains; a chance to trim library caches. */
  onIdle?(): void;
  destroy(): void;
}

/** Thrown for problems that should be shown to the user as-is. */
export class BookError extends Error {
  constructor(
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'BookError';
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'RenderingCancelledException')
  );
}
