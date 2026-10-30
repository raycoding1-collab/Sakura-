// Loader, title card, hint and the three scene controls.

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.loader = $('loader');
    this.fill = $('loader-fill');
    this.stageEl = $('loader-stage');
    this.title = $('title');
    this.meta = $('title-meta');
    this.hint = $('hint');
    this.controls = $('controls');
    this.btnCamera = $('btn-camera');
    this.btnSound = $('btn-sound');
    this.btnUi = $('btn-ui');
    this.handlers = {};
    this.hintTimer = 0;
    this.btnCamera.addEventListener('click', () => this.handlers.camera?.());
    this.btnSound.addEventListener('click', () => this.handlers.sound?.());
    this.btnUi.addEventListener('click', () => this.toggleUi());
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === 'h') this.toggleUi();
      else if (k === 'c' || k === ' ') { e.preventDefault(); this.handlers.camera?.(); }
      else if (k === 'm') this.handlers.sound?.();
    });
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  progress(fraction, text) {
    this.fill.style.width = `${Math.round(fraction * 100)}%`;
    if (text) this.stageEl.textContent = text;
  }

  ready(meta, instant = false) {
    this.meta.textContent = meta;
    if (instant) {
      // Still captures: no overlays.
      this.loader.remove();
      document.body.classList.add('hide-ui');
      return;
    }
    this.loader.classList.add('done');
    setTimeout(() => this.loader.remove(), 2600);
    setTimeout(() => this.title.classList.add('show'), 1400);
    setTimeout(() => this.title.classList.remove('show'), 11000);
    setTimeout(() => {
      this.controls.classList.add('show');
      this.hint.classList.add('show');
    }, 2400);
    this.hintTimer = setTimeout(() => this.hint.classList.remove('show'), 12000);
  }

  interacted() {
    clearTimeout(this.hintTimer);
    this.hint.classList.remove('show');
  }

  setCamera(auto) {
    this.btnCamera.setAttribute('aria-pressed', String(auto));
    this.btnCamera.title = auto ? 'Cinematic camera: on (C)' : 'Cinematic camera: off (C)';
  }

  setSound(on) {
    this.btnSound.setAttribute('aria-pressed', String(on));
    this.btnSound.title = on ? 'Sound: on (M)' : 'Sound: off (M)';
  }

  toggleUi() {
    const hidden = document.body.classList.toggle('hide-ui');
    this.btnUi.title = hidden ? 'Show interface (H)' : 'Hide interface (H)';
  }

  fail() {
    $('error').hidden = false;
    this.loader?.remove();
  }
}
