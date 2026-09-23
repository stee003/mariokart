// ============================================================================
// InputManager - keyboard state + edge-triggered action presses.
// ============================================================================

const KEYMAP = {
  throttle: ['ArrowUp', 'KeyW'],
  brake:    ['ArrowDown', 'KeyS'],
  left:     ['ArrowLeft', 'KeyA'],
  right:    ['ArrowRight', 'KeyD'],
  drift:    ['ShiftLeft', 'ShiftRight'],
  trick:    ['Space'],
  reset:    ['KeyR'],
  pause:    ['Escape'],
  confirm:  ['Enter'],
};

export class InputManager {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();   // edge-triggered, cleared by endFrame()
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => { this.down.clear(); });
  }

  isDown(action) {
    if (!this.enabled) return false;
    return KEYMAP[action].some((c) => this.down.has(c));
  }

  wasPressed(action) {
    if (!this.enabled) return false;
    return KEYMAP[action].some((c) => this.pressed.has(c));
  }

  // Returns a fresh snapshot of the full driving state.
  snapshot() {
    return {
      throttle: this.isDown('throttle') ? 1 : 0,
      brake: this.isDown('brake') ? 1 : 0,
      steer: (this.isDown('left') ? -1 : 0) + (this.isDown('right') ? 1 : 0),
      drift: this.isDown('drift'),
      trick: this.wasPressed('trick'),
    };
  }

  endFrame() {
    this.pressed.clear();
  }
}
