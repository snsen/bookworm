import { t } from '../i18n';
import {
  BACKGROUND_PRESETS,
  BRIGHTNESS_MIN,
  DEFAULT_SETTINGS,
  INTERVAL_MAX,
  INTERVAL_MIN,
  type Settings,
  type TextSize,
  type Tone,
} from '../settings';
import { h, iconButton, icons } from './dom';

type Change = (patch: Partial<Settings>) => void;

let uid = 0;
const id = (name: string) => `set-${name}-${++uid}`;

function segmented<T extends string>(
  name: string,
  options: { value: T; label: string }[],
  onPick: (v: T) => void,
): { el: HTMLElement; set(v: T): void } {
  const inputs = options.map((o) => {
    const input = h('input', { type: 'radio', name, value: o.value, id: id(name) });
    input.addEventListener('change', () => input.checked && onPick(o.value));
    return { input, label: h('label', { for: input.id }, o.label), value: o.value };
  });
  const el = h('div', { class: 'segmented', role: 'radiogroup' }, ...inputs.flatMap((i) => [i.input, i.label]));
  return {
    el,
    set: (v) => inputs.forEach((i) => (i.input.checked = i.value === v)),
  };
}

function toggle(label: string, onToggle: (on: boolean) => void): { el: HTMLElement; set(v: boolean): void } {
  const input = h('input', { type: 'checkbox', role: 'switch', id: id('toggle') });
  input.addEventListener('change', () => onToggle(input.checked));
  return {
    el: h('div', { class: 'row toggle-row' }, h('label', { for: input.id }, label), input),
    set: (v) => (input.checked = v),
  };
}

export class SettingsPanel {
  readonly el: HTMLElement;
  private sync: (s: Settings) => void;

  constructor(onChange: Change, onClose: () => void) {
    // Interval
    const intervalOut = h('output', { class: 'value' });
    const interval = h('input', { type: 'range', min: INTERVAL_MIN, max: INTERVAL_MAX, step: 1, id: id('interval') });
    interval.addEventListener('input', () => {
      intervalOut.textContent = t.seconds(Number(interval.value));
      onChange({ interval: Number(interval.value) });
    });

    // Brightness
    const brightOut = h('output', { class: 'value' });
    const bright = h('input', { type: 'range', min: Math.round(BRIGHTNESS_MIN * 100), max: 100, step: 5, id: id('bright') });
    bright.addEventListener('input', () => {
      brightOut.textContent = `%${bright.value}`;
      onChange({ brightness: Number(bright.value) / 100 });
    });

    // Background
    const swatches = BACKGROUND_PRESETS.map((p) => {
      const label = t[p.labelKey as keyof typeof t] as string;
      const b = h('button', { type: 'button', class: 'swatch', title: label, 'aria-label': label, 'data-color': p.color });
      b.style.background = p.color;
      b.addEventListener('click', () => onChange({ background: p.color }));
      return b;
    });
    const custom = h('input', { type: 'color', class: 'swatch-custom', title: t.customColor, 'aria-label': t.customColor });
    custom.addEventListener('input', () => onChange({ background: custom.value }));

    const tone = segmented<Tone>(
      'tone',
      [
        { value: 'white', label: t.toneWhite },
        { value: 'sepia', label: t.toneSepia },
        { value: 'night', label: t.toneNight },
      ],
      (v) => onChange({ tone: v }),
    );
    const textSize = segmented<TextSize>(
      'textsize',
      [
        { value: 'small', label: t.textSmall },
        { value: 'medium', label: t.textMedium },
        { value: 'large', label: t.textLarge },
      ],
      (v) => onChange({ textSize: v }),
    );
    const loop = toggle(t.loop, (v) => onChange({ loop: v }));
    const sound = toggle(t.sound, (v) => onChange({ sound: v }));

    const reset = h('button', { type: 'button', class: 'text-btn' }, t.resetDefaults);
    reset.addEventListener('click', () => onChange({ ...DEFAULT_SETTINGS }));

    this.el = h(
      'aside',
      { class: 'settings', hidden: true, role: 'dialog', 'aria-label': t.settingsTitle },
      h('header', {}, h('h2', {}, t.settingsTitle), iconButton(icons.close, t.close, onClose)),
      h('div', { class: 'row' }, h('label', { for: interval.id }, t.interval), intervalOut),
      interval,
      loop.el,
      sound.el,
      h('div', { class: 'row' }, h('span', { class: 'label' }, t.background)),
      h('div', { class: 'swatches' }, ...swatches, custom),
      h('div', { class: 'row' }, h('label', { for: bright.id }, t.brightness), brightOut),
      bright,
      h('div', { class: 'row' }, h('span', { class: 'label' }, t.tone)),
      tone.el,
      h('div', { class: 'row' }, h('span', { class: 'label' }, t.textSize)),
      textSize.el,
      h('footer', {}, reset),
    );
    // Keep interactions inside the panel from turning pages.
    for (const type of ['click', 'pointerdown', 'wheel', 'keydown'] as const) {
      this.el.addEventListener(type, (e) => {
        if (type !== 'keydown' || (e as KeyboardEvent).key !== 'Escape') e.stopPropagation();
      });
    }

    this.sync = (s) => {
      interval.value = String(s.interval);
      intervalOut.textContent = t.seconds(s.interval);
      bright.value = String(Math.round(s.brightness * 100));
      brightOut.textContent = `%${Math.round(s.brightness * 100)}`;
      for (const sw of swatches) sw.classList.toggle('selected', sw.dataset.color === s.background);
      custom.value = s.background;
      tone.set(s.tone);
      textSize.set(s.textSize);
      loop.set(s.loop);
      sound.set(s.sound);
    };
  }

  update(s: Settings): void {
    this.sync(s);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  setOpen(open: boolean): void {
    this.el.hidden = !open;
  }
}
