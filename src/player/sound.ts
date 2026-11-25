/**
 * A paper-rustle page-turn sound synthesised with Web Audio (no audio files to load or license).
 * Filtered noise with a sweep and two soft "swish" peaks.
 */
export class PageSound {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  enabled = false;

  /** Must be called from a user gesture at least once (autoplay policies). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      const len = Math.floor(this.ctx.sampleRate * 0.9);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      // Slightly "brown" noise sounds more like paper than pure white noise.
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.09 * white) / 1.09;
        data[i] = last * 3.2 + white * 0.18;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(): void {
    if (!this.enabled || !this.ctx || !this.noise || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = 0.55 + Math.random() * 0.15;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.8;
    band.frequency.setValueAtTime(900, now);
    band.frequency.exponentialRampToValueAtTime(3800, now + dur * 0.55);
    band.frequency.exponentialRampToValueAtTime(1600, now + dur);

    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 350;

    const gain = ctx.createGain();
    const g = gain.gain;
    g.setValueAtTime(0.0001, now);
    g.exponentialRampToValueAtTime(0.18, now + 0.06);
    g.exponentialRampToValueAtTime(0.07, now + dur * 0.35);
    g.exponentialRampToValueAtTime(0.26, now + dur * 0.62);
    g.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(band).connect(high).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + dur + 0.05);
    src.onended = () => {
      src.disconnect();
      band.disconnect();
      high.disconnect();
      gain.disconnect();
    };
  }
}
