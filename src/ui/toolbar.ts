import { t } from '../i18n';
import { h, iconButton, icons } from './dom';

export interface ToolbarActions {
  prev(): void;
  next(): void;
  togglePlay(): void;
  toggleSound(): void;
  toggleSettings(): void;
  toggleFullscreen(): void;
  openFile(): void;
}

export class Toolbar {
  readonly el: HTMLElement;
  private playBtn: HTMLButtonElement;
  private soundBtn: HTMLButtonElement;
  private fsBtn: HTMLButtonElement;
  private pageLabel: HTMLElement;
  private titleEl: HTMLElement;

  constructor(actions: ToolbarActions) {
    this.playBtn = iconButton(icons.play, t.play, actions.togglePlay, 'play');
    this.soundBtn = iconButton(icons.soundOff, t.soundOff, actions.toggleSound);
    this.fsBtn = iconButton(icons.fullscreen, t.fullscreenEnter, actions.toggleFullscreen);
    this.pageLabel = h('span', { class: 'page-label', 'aria-live': 'polite' });
    this.titleEl = h('span', { class: 'book-title' });
    this.el = h(
      'div',
      { class: 'toolbar', role: 'toolbar', hidden: true },
      h('div', { class: 'tb-group tb-left' }, iconButton(icons.open, t.openAnother, actions.openFile), this.titleEl),
      h(
        'div',
        { class: 'tb-group tb-center' },
        iconButton(icons.prev, t.prev, actions.prev),
        this.playBtn,
        iconButton(icons.next, t.next, actions.next),
        this.pageLabel,
      ),
      h(
        'div',
        { class: 'tb-group tb-right' },
        this.soundBtn,
        iconButton(icons.settings, t.settings, actions.toggleSettings, 'settings-btn'),
        this.fsBtn,
      ),
    );
    // Clicks on the toolbar must never reach the stage (which turns pages).
    this.el.addEventListener('click', (e) => e.stopPropagation());
  }

  show(visible: boolean): void {
    this.el.hidden = !visible;
  }

  setTitle(title: string): void {
    this.titleEl.textContent = title;
    this.titleEl.title = title;
  }

  setPages(visible: number[], total: number): void {
    const shown = visible.map((i) => i + 1);
    const label = shown.length > 1 ? `${shown[0]}–${shown[shown.length - 1]}` : String(shown[0] ?? 1);
    this.pageLabel.textContent = t.pageOf(label, total);
  }

  setPlaying(playing: boolean): void {
    this.playBtn.innerHTML = playing ? icons.pause : icons.play;
    const label = playing ? t.pause : t.play;
    this.playBtn.title = label;
    this.playBtn.setAttribute('aria-label', label);
    this.playBtn.classList.toggle('active', playing);
  }

  setSound(on: boolean): void {
    this.soundBtn.innerHTML = on ? icons.soundOn : icons.soundOff;
    const label = on ? t.soundOn : t.soundOff;
    this.soundBtn.title = label;
    this.soundBtn.setAttribute('aria-label', label);
  }

  setFullscreen(on: boolean): void {
    this.fsBtn.innerHTML = on ? icons.fullscreenExit : icons.fullscreen;
    const label = on ? t.fullscreenExit : t.fullscreenEnter;
    this.fsBtn.title = label;
    this.fsBtn.setAttribute('aria-label', label);
  }
}
