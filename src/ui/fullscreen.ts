export function isFullscreen(): boolean {
  return document.fullscreenElement != null;
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    // Refused (no user gesture, iframe without permission…): nothing to do.
  }
}

/**
 * Adds `ui-idle` to <body> after a few seconds without pointer/keyboard activity
 * while in full screen, which hides the controls and the cursor.
 */
export class IdleHider {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private delayMs: number,
    private canHide: () => boolean,
  ) {
    for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
      window.addEventListener(type, this.wake, { passive: true });
    }
    document.addEventListener('fullscreenchange', this.wake);
  }

  /** Re-evaluate (e.g. after the settings panel closes). */
  wake = (): void => {
    document.body.classList.remove('ui-idle');
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!isFullscreen()) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (isFullscreen() && this.canHide()) document.body.classList.add('ui-idle');
    }, this.delayMs);
  };
}
