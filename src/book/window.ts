export interface WindowOptions {
  pageCount: number;
  /** Pages prepared after the last visible page. */
  ahead: number;
  /** Pages prepared before the first visible page. */
  behind: number;
  /** When looping, the first pages are prepared while near the end. */
  loop: boolean;
}

/**
 * Page indices to keep rendered, in priority order:
 * visible pages, then pages ahead (nearest first), then pages behind (nearest first),
 * then — when looping near the end — the first pages of the book.
 */
export function pageWindow(visible: readonly number[], opts: WindowOptions): number[] {
  const { pageCount, ahead, behind, loop } = opts;
  if (pageCount <= 0) return [];
  const valid = visible.filter((i) => i >= 0 && i < pageCount);
  if (valid.length === 0) valid.push(0);
  const lo = Math.min(...valid);
  const hi = Math.max(...valid);
  const out: number[] = [];
  const seen = new Set<number>();
  const add = (i: number) => {
    if (i >= 0 && i < pageCount && !seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  };
  for (let i = lo; i <= hi; i++) add(i);
  for (let i = 1; i <= ahead; i++) add(hi + i);
  for (let i = 1; i <= behind; i++) add(lo - i);
  if (loop && hi + ahead >= pageCount - 1) {
    const wrap = Math.min(2, hi + ahead - (pageCount - 1));
    for (let i = 0; i < wrap; i++) add(i);
  }
  return out;
}
