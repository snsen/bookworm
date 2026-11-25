import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoPlayer, type Turnable } from '../../src/player/autoPlayer';

function fakeBook(pages: number): Turnable & { page: number; isAnimating: boolean } {
  return {
    page: 0,
    isAnimating: false,
    get atEnd() {
      return this.page >= pages - 1;
    },
    next() {
      this.page = Math.min(pages - 1, this.page + 2);
      return true;
    },
    goTo(p: number) {
      this.page = p;
    },
  };
}

describe('AutoPlayer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns a page every interval', () => {
    const book = fakeBook(100);
    const p = new AutoPlayer(book, 5, false);
    p.start();
    vi.advanceTimersByTime(4999);
    expect(book.page).toBe(0);
    vi.advanceTimersByTime(1);
    expect(book.page).toBe(2);
    vi.advanceTimersByTime(10_000);
    expect(book.page).toBe(6);
    p.destroy();
  });

  it('restarts the countdown after a manual turn', () => {
    const book = fakeBook(100);
    const p = new AutoPlayer(book, 5, false);
    p.start();
    vi.advanceTimersByTime(4000);
    p.restartCountdown();
    vi.advanceTimersByTime(4000);
    expect(book.page).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(book.page).toBe(2);
    p.destroy();
  });

  it('loops back to the start, or stops at the end', () => {
    const looping = fakeBook(5);
    const a = new AutoPlayer(looping, 3, true);
    a.start();
    vi.advanceTimersByTime(3000 * 3);
    expect(looping.page).toBe(0);
    expect(a.isPlaying).toBe(true);
    a.destroy();

    const once = fakeBook(5);
    const b = new AutoPlayer(once, 3, false);
    b.start();
    vi.advanceTimersByTime(3000 * 5);
    expect(once.page).toBe(4);
    expect(b.isPlaying).toBe(false);
    b.destroy();
  });

  it('waits for a running animation instead of skipping a turn', () => {
    const book = fakeBook(100);
    book.isAnimating = true;
    const p = new AutoPlayer(book, 3, false);
    p.start();
    vi.advanceTimersByTime(3000);
    expect(book.page).toBe(0);
    book.isAnimating = false;
    vi.advanceTimersByTime(250);
    expect(book.page).toBe(2);
    p.destroy();
  });
});
