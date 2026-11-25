export interface Turnable {
  next(): boolean;
  goTo(page: number, animate?: boolean): void;
  readonly atEnd: boolean;
  readonly isAnimating: boolean;
}

type WakeLockSentinelLike = { release(): Promise<void>; released: boolean };

/**
 * Turns pages on a timer. Manual navigation restarts the countdown, so the reader
 * always gets the full interval on the page they chose.
 */
export class AutoPlayer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private playing = false;
  private wakeLock: WakeLockSentinelLike | null = null;
  private listeners = new Set<(playing: boolean) => void>();
  /** Timestamp the current countdown ends, for progress display. */
  private due = 0;

  constructor(
    private book: Turnable,
    private intervalSec: number,
    private loop: boolean,
  ) {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** 0..1 progress of the current countdown (0 when paused). */
  get progress(): number {
    if (!this.playing || !this.due) return 0;
    const total = this.intervalSec * 1000;
    return Math.min(1, Math.max(0, 1 - (this.due - performance.now()) / total));
  }

  onChange(l: (playing: boolean) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.arm();
    void this.acquireWakeLock();
    this.emit();
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.clear();
    void this.releaseWakeLock();
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.stop();
    else this.start();
  }

  setInterval(sec: number): void {
    this.intervalSec = sec;
    if (this.playing) this.arm();
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
  }

  /** Call after the user turned a page by hand. */
  restartCountdown(): void {
    if (this.playing) this.arm();
  }

  private arm(delay = this.intervalSec * 1000): void {
    this.clear();
    this.due = performance.now() + delay;
    this.timer = setTimeout(this.tick, delay);
  }

  private clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.due = 0;
  }

  private tick = (): void => {
    this.timer = null;
    if (!this.playing) return;
    // A drag or a turn is still running: try again shortly instead of skipping it.
    if (this.book.isAnimating) {
      this.arm(250);
      return;
    }
    if (this.book.atEnd) {
      if (this.loop) {
        this.book.goTo(0, true);
      } else {
        this.stop();
        return;
      }
    } else {
      this.book.next();
    }
    this.arm();
  };

  private async acquireWakeLock(): Promise<void> {
    const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } })
      .wakeLock;
    if (!wl || this.wakeLock || document.visibilityState !== 'visible') return;
    try {
      this.wakeLock = await wl.request('screen');
      if (!this.playing) await this.releaseWakeLock();
    } catch {
      // Not allowed (e.g. no user gesture yet or unsupported); the show still runs.
    }
  }

  private async releaseWakeLock(): Promise<void> {
    const lock = this.wakeLock;
    this.wakeLock = null;
    if (lock && !lock.released) await lock.release().catch(() => {});
  }

  private onVisibility = (): void => {
    // The browser drops the wake lock when the tab is hidden; take it again on return.
    if (document.visibilityState === 'visible' && this.playing) {
      if (this.wakeLock?.released) this.wakeLock = null;
      void this.acquireWakeLock();
    }
  };

  private emit(): void {
    for (const l of this.listeners) l(this.playing);
  }

  destroy(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.listeners.clear();
  }
}
