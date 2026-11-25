import { describe, expect, it } from 'vitest';
import { splitIntoChunks } from '../../src/sources/epubSource';

function section(paragraphs: number, chars: number): HTMLElement {
  const root = document.createElement('div');
  const wrapper = document.createElement('section');
  wrapper.className = 'chapter';
  for (let i = 0; i < paragraphs; i++) {
    const p = document.createElement('p');
    p.textContent = `${i}:`.padEnd(chars, 'x');
    wrapper.appendChild(p);
  }
  root.appendChild(wrapper);
  return root;
}

describe('splitIntoChunks', () => {
  it('keeps short sections whole', () => {
    const chunks = splitIntoChunks(section(10, 100), 60_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].querySelectorAll('p')).toHaveLength(10);
  });

  it('splits long sections at paragraph boundaries and clones wrappers', () => {
    const chunks = splitIntoChunks(section(100, 1000), 30_000);
    expect(chunks.length).toBeGreaterThan(2);
    let total = 0;
    for (const c of chunks) {
      const wrapper = c.firstElementChild!;
      expect(wrapper.tagName).toBe('SECTION');
      expect(wrapper.className).toBe('chapter');
      total += wrapper.querySelectorAll('p').length;
      expect((wrapper.textContent ?? '').length).toBeLessThanOrEqual(31_000);
    }
    expect(total).toBe(100);
  });
});
