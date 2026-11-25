export interface InputActions {
  next(): void;
  prev(): void;
  first(): void;
  last(): void;
  togglePlay(): void;
  toggleFullscreen(): void;
  closePanels(): boolean;
  isActive(): boolean;
}

const WHEEL_THRESHOLD = 40;
const WHEEL_COOLDOWN_MS = 650;

/**
 * Keyboard, mouse wheel and clicks outside the book.
 * (Clicks and drags on the book itself are handled by the page-turn engine.)
 */
export function bindInput(stage: HTMLElement, bookArea: () => HTMLElement | null, a: InputActions): void {
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') {
      if (a.closePanels()) e.preventDefault();
      return;
    }
    const target = e.target as HTMLElement | null;
    // Form controls (sliders, radio groups) keep their own arrow-key behaviour.
    if (target?.closest('input, textarea, select, [contenteditable], dialog')) return;
    if (!a.isActive()) return;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
        a.next();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        a.prev();
        break;
      case 'Home':
        a.first();
        break;
      case 'End':
        a.last();
        break;
      case ' ':
      case 'k':
        // Buttons have focus after a click; Space must still mean play/pause.
        a.togglePlay();
        break;
      case 'f':
      case 'F':
        a.toggleFullscreen();
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  // One wheel gesture (including trackpad inertia) turns exactly one page.
  let acc = 0;
  let lockedUntil = 0;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;
  stage.addEventListener(
    'wheel',
    (e) => {
      if (!a.isActive()) return;
      e.preventDefault();
      const now = performance.now();
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => (acc = 0), 200);
      if (now < lockedUntil) {
        lockedUntil = Math.max(lockedUntil, now + 120); // keep swallowing the tail of an inertial scroll
        return;
      }
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      acc += e.deltaMode === 1 ? delta * 16 : delta;
      if (Math.abs(acc) >= WHEEL_THRESHOLD) {
        if (acc > 0) a.next();
        else a.prev();
        acc = 0;
        lockedUntil = now + WHEEL_COOLDOWN_MS;
      }
    },
    { passive: false },
  );

  // Clicks on the empty stage: left half = back, right half = forward.
  stage.addEventListener('click', (e) => {
    if (!a.isActive() || e.button !== 0) return;
    const book = bookArea();
    if (book && book.contains(e.target as Node)) return;
    const rect = stage.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width / 2) a.prev();
    else a.next();
  });
}
