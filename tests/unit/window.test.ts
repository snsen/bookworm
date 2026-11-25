import { describe, expect, it } from 'vitest';
import { pageWindow } from '../../src/book/window';

const opts = { pageCount: 100, ahead: 6, behind: 2, loop: false };

describe('pageWindow', () => {
  it('orders visible, then ahead, then behind', () => {
    expect(pageWindow([10, 11], opts)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 9, 8]);
  });

  it('clamps at the start of the book', () => {
    expect(pageWindow([0], opts)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('clamps at the end of the book', () => {
    expect(pageWindow([98, 99], opts)).toEqual([98, 99, 97, 96]);
  });

  it('prepares the first pages near the end when looping', () => {
    expect(pageWindow([98, 99], { ...opts, loop: true })).toEqual([98, 99, 97, 96, 0, 1]);
    expect(pageWindow([50, 51], { ...opts, loop: true })).not.toContain(0);
  });

  it('never exceeds visible + ahead + behind (+2 when looping)', () => {
    for (let p = 0; p < 100; p++) {
      const w = pageWindow([p, p + 1], { ...opts, loop: true });
      expect(w.length).toBeLessThanOrEqual(2 + 6 + 2 + 2);
      expect(new Set(w).size).toBe(w.length);
      expect(w.every((i) => i >= 0 && i < 100)).toBe(true);
    }
  });

  it('handles empty and out-of-range input', () => {
    expect(pageWindow([], opts)[0]).toBe(0);
    expect(pageWindow([5], { ...opts, pageCount: 0 })).toEqual([]);
  });
});
