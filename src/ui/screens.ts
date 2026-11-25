import { t } from '../i18n';
import { h, icons } from './dom';

const ACCEPT = '.pdf,.epub,application/pdf,application/epub+zip';

/** Start screen + file picker + window-wide drag and drop. */
export class Welcome {
  readonly el: HTMLElement;
  readonly dropOverlay: HTMLElement;
  private input: HTMLInputElement;
  private dragDepth = 0;

  constructor(private onFile: (file: File) => void) {
    this.input = h('input', { type: 'file', accept: ACCEPT, hidden: true, 'data-testid': 'file-input' });
    this.input.addEventListener('change', () => {
      const f = this.input.files?.[0];
      this.input.value = '';
      if (f) onFile(f);
    });
    const choose = h('button', { type: 'button', class: 'primary-btn' }, t.chooseFile);
    choose.addEventListener('click', () => this.pick());
    const logo = h('div', { class: 'logo' });
    logo.innerHTML = icons.book;
    const zone = h(
      'div',
      { class: 'dropzone' },
      h('p', { class: 'drop-title' }, t.dropTitle),
      h('p', { class: 'drop-or' }, t.dropOr),
      choose,
      h('p', { class: 'privacy' }, t.privacyNote),
    );
    zone.addEventListener('click', (e) => {
      if (e.target === zone) this.pick();
    });
    this.el = h(
      'section',
      { class: 'welcome' },
      logo,
      h('h1', {}, t.appName),
      h('p', { class: 'tagline' }, t.tagline),
      zone,
      h('p', { class: 'shortcuts' }, t.shortcuts),
      this.input,
    );
    this.dropOverlay = h('div', { class: 'drop-overlay', hidden: true }, h('p', {}, t.dropHere));

    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      this.dragDepth++;
      this.dropOverlay.hidden = false;
    });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', () => {
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (this.dragDepth === 0) this.dropOverlay.hidden = true;
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      this.dragDepth = 0;
      this.dropOverlay.hidden = true;
      const f = e.dataTransfer?.files?.[0];
      if (f) this.onFile(f);
    });
  }

  pick(): void {
    this.input.click();
  }

  show(visible: boolean): void {
    this.el.hidden = !visible;
  }
}

function hasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
}

export class LoadingOverlay {
  readonly el: HTMLElement;
  private text: HTMLElement;
  private bar: HTMLElement;

  constructor() {
    this.text = h('p', {});
    this.bar = h('div', { class: 'bar-fill' });
    this.el = h(
      'div',
      { class: 'loading', hidden: true, role: 'status' },
      h('div', { class: 'spinner' }),
      this.text,
      h('div', { class: 'bar' }, this.bar),
    );
  }

  show(text: string, progress?: number): void {
    this.el.hidden = false;
    this.text.textContent = text;
    this.bar.parentElement!.hidden = progress === undefined;
    if (progress !== undefined) this.bar.style.width = `${Math.round(progress * 100)}%`;
  }

  hide(): void {
    this.el.hidden = true;
  }
}

export class ErrorDialog {
  readonly el: HTMLDialogElement;
  private message: HTMLElement;
  private details: HTMLElement;

  constructor() {
    this.message = h('p', { class: 'error-message' });
    this.details = h('pre', {});
    const ok = h('button', { type: 'submit', class: 'primary-btn' }, t.errOk);
    this.el = h(
      'dialog',
      { class: 'error-dialog' },
      h(
        'form',
        { method: 'dialog' },
        h('h2', {}, t.errTitle),
        this.message,
        h('details', {}, h('summary', {}, t.errDetails), this.details),
        h('div', { class: 'actions' }, ok),
      ),
    );
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
  }

  show(message: string, details?: string): void {
    this.message.textContent = message;
    this.details.textContent = details ?? '';
    (this.details.parentElement as HTMLElement).hidden = !details;
    if (!this.el.open) this.el.showModal();
  }
}
