// Keyboard input. Turns key presses into a tiny "controls" object:
//   { mx, my, jump, shove }   (mx/my are -1, 0 or 1; jump/shove are held-or-not)
// and tells main.js whenever it changes. The SERVER decides what those controls
// actually do - the browser never moves anything on its own authority.

const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyK'],
  shove: ['KeyE', 'ShiftLeft', 'ShiftRight', 'KeyJ'],
};

export class Input {
  constructor(onChange) {
    this.onChange = onChange;
    this.down = new Set();
    this.enabled = false;
    this.last = { mx: 0, my: 0, jump: false, shove: false };

    window.addEventListener('keydown', (e) => this.handle(e, true));
    window.addEventListener('keyup', (e) => this.handle(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  isGameKey(code) {
    return Object.values(KEYS).some((list) => list.includes(code));
  }

  handle(e, isDown) {
    if (!this.enabled) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!this.isGameKey(e.code)) return;
    e.preventDefault(); // stops Space/arrows from scrolling the page
    if (isDown) {
      if (e.repeat) return;
      this.down.add(e.code);
    } else {
      this.down.delete(e.code);
    }
    this.emit();
  }

  anyDown(list) {
    return list.some((c) => this.down.has(c));
  }

  current() {
    const mx = (this.anyDown(KEYS.right) ? 1 : 0) - (this.anyDown(KEYS.left) ? 1 : 0);
    const my = (this.anyDown(KEYS.down) ? 1 : 0) - (this.anyDown(KEYS.up) ? 1 : 0);
    return {
      mx,
      my,
      jump: this.anyDown(KEYS.jump),
      shove: this.anyDown(KEYS.shove),
    };
  }

  emit(force = false) {
    const c = this.current();
    const l = this.last;
    if (!force && c.mx === l.mx && c.my === l.my && c.jump === l.jump && c.shove === l.shove) return;
    this.last = c;
    this.onChange(c);
  }

  releaseAll() {
    this.down.clear();
    this.emit();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.releaseAll();
  }

  // Resend the current controls (called a few times per second as a safety net).
  heartbeat() {
    if (this.enabled) this.emit(true);
  }
}
