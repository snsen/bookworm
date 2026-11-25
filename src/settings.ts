export type Tone = 'white' | 'sepia' | 'night';
export type TextSize = 'small' | 'medium' | 'large';

export interface Settings {
  /** Seconds between automatic page turns (3–60). */
  interval: number;
  /** Return to the first page after the last one. */
  loop: boolean;
  /** Play a synthesized page-turn sound. */
  sound: boolean;
  /** Stage background colour. */
  background: string;
  /** 0.3–1. Applied as a black overlay, so it dims everything on the projector. */
  brightness: number;
  tone: Tone;
  /** EPUB only: changes how much text fits on a page. */
  textSize: TextSize;
  /** Paper texture, candle light, floating dust and drop caps. */
  ambience: boolean;
}

export interface ToneColors {
  paper: string;
  ink: string;
  /** Colour of ornamental initials. */
  accent: string;
}

export const TONES: Record<Tone, ToneColors> = {
  white: { paper: '#f2f0ea', ink: '#1c1b19', accent: '#8a2f1c' },
  sepia: { paper: '#e4d4b4', ink: '#3a2b1b', accent: '#7c3416' },
  night: { paper: '#1b1916', ink: '#b9b09f', accent: '#c9a25e' },
};

export const INTERVAL_MIN = 3;
export const INTERVAL_MAX = 60;
export const BRIGHTNESS_MIN = 0.3;

/** Defaults chosen for a dark room: near-black stage, dimmed, warm paper, no sound. */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  interval: 15,
  loop: true,
  sound: false,
  background: '#0b0b0c',
  brightness: 0.75,
  tone: 'sepia',
  textSize: 'medium',
  ambience: true,
});

export const BACKGROUND_PRESETS: ReadonlyArray<{ color: string; labelKey: string }> = [
  { color: '#0b0b0c', labelKey: 'bgBlack' },
  { color: '#0c1018', labelKey: 'bgNavy' },
  { color: '#17110c', labelKey: 'bgBrown' },
  { color: '#0d1610', labelKey: 'bgGreen' },
  { color: '#2a2a2c', labelKey: 'bgGray' },
];

const STORAGE_KEY = 'bookworm.settings.v1';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Coerces untrusted (stored or user-entered) values into valid settings. */
export function normalizeSettings(input: Partial<Record<keyof Settings, unknown>>): Settings {
  const d = DEFAULT_SETTINGS;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    interval: Math.round(clamp(num(input.interval, d.interval), INTERVAL_MIN, INTERVAL_MAX)),
    loop: typeof input.loop === 'boolean' ? input.loop : d.loop,
    sound: typeof input.sound === 'boolean' ? input.sound : d.sound,
    background:
      typeof input.background === 'string' && /^#[0-9a-f]{6}$/i.test(input.background) ? input.background : d.background,
    brightness: clamp(num(input.brightness, d.brightness), BRIGHTNESS_MIN, 1),
    tone: pick(input.tone, ['white', 'sepia', 'night'] as const, d.tone),
    textSize: pick(input.textSize, ['small', 'medium', 'large'] as const, d.textSize),
    ambience: typeof input.ambience === 'boolean' ? input.ambience : d.ambience,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch {
    // Storage blocked or corrupt: fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Private mode / storage disabled: settings simply won't persist.
  }
}
