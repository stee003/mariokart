// ============================================================================
// InputManager - keyboard + gamepad driving input with remappable keys.
//
// Keyboard bindings follow the standard layout below; the settings screen can
// override any action with a single replacement key (persisted in the save).
// Gamepads use the W3C standard mapping (Xbox/PS/Switch-Pro layout):
//   RT throttle · LT brake/reverse · left stick / d-pad steer
//   X or LB drift (hold) · A trick/confirm · Y power-up · B reset · START pause
// Analog triggers feed analog throttle/brake; the left stick feeds analog
// steering with a small dead zone. Keyboard always remains fully usable.
// ============================================================================

export const DEFAULT_KEYMAP = {
  throttle: ['ArrowUp', 'KeyW'],
  brake:    ['ArrowDown', 'KeyS'],
  left:     ['ArrowLeft', 'KeyA'],
  right:    ['ArrowRight', 'KeyD'],
  drift:    ['ShiftLeft', 'ShiftRight'],
  trick:    ['Space'],
  item:     ['KeyE', 'KeyF'],
  reset:    ['KeyR'],
  pause:    ['Escape'],
  confirm:  ['Enter'],
};

export const REMAPPABLE_ACTIONS = [
  'throttle', 'brake', 'left', 'right', 'drift', 'trick', 'item', 'reset', 'pause', 'confirm',
];

// W3C standard gamepad mapping (Xbox / PS / Switch Pro).
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

// Menu navigation feel: a direction fires immediately on press, then repeats
// after a short delay so long lists and sliders can be swept by holding.
const UI_REPEAT_DELAY = 400;   // ms before auto-repeat starts
const UI_REPEAT_RATE = 105;    // ms between repeats
const UI_STICK_THRESHOLD = 0.55;

const UI_DIRS = ['up', 'down', 'left', 'right'];

const NULL_UI = Object.freeze({ up: false, down: false, left: false, right: false });

const nowMs = () => (typeof performance !== 'undefined' && performance.now
  ? performance.now() : Date.now());

const SCROLL_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

// Human-readable label for a KeyboardEvent.code, used by the bindings UI.
export function keyLabel(code) {
  if (!code) return '—';
  const special = {
    ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT', AltRight: 'R-ALT',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', Tab: 'TAB',
    Backspace: 'BACKSPACE',
  };
  if (special[code]) return special[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  return code;
}

export class InputManager {
  constructor(save = null) {
    this.save = save;
    this.down = new Set();
    this.pressed = new Set();      // keyboard edge-triggered set, cleared by endFrame()
    this.enabled = true;
    this.gamepadConnected = false;

    // remapping state
    this._custom = { ...(save?.get('keys', {}) || {}) };
    this._capture = null;           // set while a rebind is waiting for a key
    this._rebuildMap();

    // gamepad state (filled by poll())
    this._gp = { buttons: [], steer: 0, throttle: 0, brake: 0, steerDigital: 0,
                 ui: { up: false, down: false, left: false, right: false } };
    this._gpPrevButtons = [];
    this._gpPressed = new Set();    // gamepad edge-triggered actions

    // Touch controls feed the same action snapshot as keyboard and pads. The
    // virtual stick writes analog values; button layouts write held actions.
    this._touch = { throttle: 0, brake: 0, left: false, right: false, steer: 0,
                    drift: false, trick: false, item: false, reset: false, pause: false };
    this._touchPressed = new Set();

    // menu-navigation state: per-direction hold tracking + auto-repeat
    this._uiPrev = { up: false, down: false, left: false, right: false };
    this._uiFire = { up: false, down: false, left: false, right: false };
    this._uiNext = { up: 0, down: 0, left: 0, right: 0 };
    this._padUsed = false;          // a pad drove the UI at least once

    window.addEventListener('gamepadconnected', () => { this.gamepadConnected = true; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepadConnected = false; });

    window.addEventListener('keydown', (e) => {
      if (this._capture) {
        // rebinding in progress: Esc cancels, anything else is captured
        e.preventDefault();
        const fn = this._capture;
        this._capture = null;
        fn(e.code === 'Escape' ? null : e.code);
        return;
      }
      if (SCROLL_KEYS.includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => { this.down.clear(); this.clearTouch(); });
  }

  // ---------------------------------------------------------------- bindings
  _rebuildMap() {
    this.keymap = {};
    for (const action of Object.keys(DEFAULT_KEYMAP)) {
      const custom = this._custom[action];
      this.keymap[action] = custom ? [custom] : DEFAULT_KEYMAP[action];
    }
  }

  bindings() {
    // action -> displayed binding code (first effective code)
    const out = {};
    for (const action of Object.keys(this.keymap)) out[action] = this.keymap[action][0] || null;
    return out;
  }

  setBinding(action, code) {
    if (!(action in DEFAULT_KEYMAP)) return;
    if (code) this._custom[action] = code;
    else delete this._custom[action];
    this._rebuildMap();
    this.save?.set('keys', { ...this._custom });
  }

  resetBindings() {
    this._custom = {};
    this._rebuildMap();
    this.save?.set('keys', {});
  }

  // Called by the settings UI; the callback receives the new code (or null
  // when the user cancelled with Esc).
  captureNextKey(fn) { this._capture = fn; }
  get capturing() { return !!this._capture; }

  // ----------------------------------------------------------------- gamepad
  // Poll gamepads once per frame (called from the main loop, before any
  // snapshot()/wasPressed() reads).
  poll() {
    const cur = this._gp;
    const prevButtons = this._gpPrevButtons;
    cur.buttons = this._gpStandardButtons || (this._gpStandardButtons = []);
    let connected = false;

    const pads = (typeof navigator !== 'undefined' && navigator.getGamepads)
      ? navigator.getGamepads()
      : [];
    let gp = null;
    for (const p of pads) { if (p && p.connected) { gp = p; break; } }

    if (gp) {
      connected = true;
      for (let i = 0; i < gp.buttons.length; i++) {
        const b = gp.buttons[i];
        cur.buttons[i] = b.pressed || b.value > 0.5;
      }
      const ax = gp.axes[0] ?? 0;
      // Vehicle yaw is authored in a +Z-forward frame: positive steering is
      // visually LEFT from the chase camera. Standard gamepad axes report
      // left as negative, so convert once at the input boundary rather than
      // inverting keyboard, d-pad and stick independently inside physics.
      cur.steer = Math.abs(ax) > 0.18 ? -ax : 0;
      cur.throttle = (gp.buttons[7]?.value ?? 0) > 0.25 ? gp.buttons[7].value : 0;
      cur.brake = (gp.buttons[6]?.value ?? 0) > 0.25 ? gp.buttons[6].value : 0;
      cur.steerDigital = (cur.buttons[14] ? 1 : 0) - (cur.buttons[15] ? 1 : 0);

      const edge = (i, action) => {
        if (cur.buttons[i] && !prevButtons[i]) this._gpPressed.add(action);
      };
      for (const i of [0, 9]) edge(i, i === 0 ? 'confirm' : 'pause');
      edge(0, 'trick');
      edge(1, 'reset');
      edge(1, 'back');      // B doubles as the menu "back" button
      edge(3, 'item');

      // --- menu navigation -------------------------------------------------
      // D-pad and left stick both drive the four UI directions; the stick also
      // steers, but UI reads only happen while a screen is on top of the race.
      const ay = gp.axes[1] ?? 0;
      cur.ui.up = !!cur.buttons[PAD.UP] || ay < -UI_STICK_THRESHOLD;
      cur.ui.down = !!cur.buttons[PAD.DOWN] || ay > UI_STICK_THRESHOLD;
      cur.ui.left = !!cur.buttons[PAD.LEFT] || cur.steer > UI_STICK_THRESHOLD;
      cur.ui.right = !!cur.buttons[PAD.RIGHT] || cur.steer < -UI_STICK_THRESHOLD;
    } else {
      cur.steer = 0; cur.throttle = 0; cur.brake = 0; cur.steerDigital = 0;
      cur.buttons.length = 0;
      cur.ui.up = cur.ui.down = cur.ui.left = cur.ui.right = false;
    }
    this.gamepadConnected = connected;
    this._gpPrevButtons = cur.buttons.slice();
    this._updateUiRepeat(connected ? cur.ui : NULL_UI);
  }

  // Edge + auto-repeat for the four menu directions.
  _updateUiRepeat(ui) {
    const t = nowMs();
    for (const dir of UI_DIRS) {
      const held = !!ui[dir];
      const prev = this._uiPrev[dir];
      if (held && !prev) {
        this._uiFire[dir] = true;
        this._uiNext[dir] = t + UI_REPEAT_DELAY;
        this._padUsed = true;
      } else if (held && t >= this._uiNext[dir]) {
        this._uiFire[dir] = true;
        this._uiNext[dir] = t + UI_REPEAT_RATE;
        this._padUsed = true;
      } else {
        this._uiFire[dir] = false;
      }
      if (!held) this._uiNext[dir] = 0;
      this._uiPrev[dir] = held;
    }
  }

  // ------------------------------------------------------------ touch input
  // Button actions use pointer-down/up so a press is responsive and remains
  // held even when a finger slides slightly off the button (pointer capture is
  // managed by the UI). Edge actions are recorded once on the initial press.
  setTouchAction(action, active) {
    if (!Object.prototype.hasOwnProperty.call(this._touch, action) || action === 'steer') return;
    const next = !!active;
    const was = !!this._touch[action];
    this._touch[action] = next;
    if (next && !was && ['trick', 'item', 'reset', 'pause'].includes(action)) {
      this._touchPressed.add(action);
    }
  }

  // x/y use ordinary screen coordinates: right is +x, down is +y. The kart's
  // steering convention is inverted once here, at the input boundary.
  setTouchStick(x, y) {
    const sx = Math.max(-1, Math.min(1, Number(x) || 0));
    const sy = Math.max(-1, Math.min(1, Number(y) || 0));
    this._touch.steer = -sx;
    this._touch.throttle = Math.max(0, -sy);
    this._touch.brake = Math.max(0, sy);
  }

  clearTouch() {
    Object.assign(this._touch, {
      throttle: 0, brake: 0, left: false, right: false, steer: 0,
      drift: false, trick: false, item: false, reset: false, pause: false,
    });
    this._touchPressed.clear();
  }

  _touchActionDown(action) {
    const t = this._touch;
    switch (action) {
      case 'throttle': return t.throttle > 0;
      case 'brake': return t.brake > 0;
      case 'left': return t.left || t.steer > 0.18;
      case 'right': return t.right || t.steer < -0.18;
      case 'drift': return !!t.drift;
      case 'trick': return !!t.trick;
      case 'item': return !!t.item;
      case 'reset': return !!t.reset;
      case 'pause': return !!t.pause;
      default: return false;
    }
  }

  // ---------------------------------------------------------- menu queries
  // True on the frame a pad direction fires (including auto-repeat).
  uiPressed(dir) { return this.enabled && !!this._uiFire[dir]; }
  uiHeld(dir) { return this.enabled && !!(this._gp.ui && this._gp.ui[dir]); }
  // Gamepad-only edges: the UI navigator owns these so a focused button is
  // never activated twice (once by the browser's native Enter/Space handling
  // and once by the pad path).
  padPressed(action) { return this.enabled && this._gpPressed.has(action); }
  // Keyboard-only edges.
  keyPressed(action) {
    return this.enabled && this.keymap[action]?.some((c) => this.pressed.has(c));
  }
  get padUsedUI() { return this._padUsed; }

  _gpActionDown(action) {
    const g = this._gp;
    switch (action) {
      case 'throttle': return g.throttle > 0;
      case 'brake':    return g.brake > 0;
      case 'left':     return g.steer > 0.18 || g.steerDigital > 0;
      case 'right':    return g.steer < -0.18 || g.steerDigital < 0;
      case 'drift':    return !!g.buttons[2] || !!g.buttons[4];
      default:         return false;
    }
  }

  // ------------------------------------------------------------------ queries
  isDown(action) {
    if (!this.enabled) return false;
    return this.keymap[action].some((c) => this.down.has(c)) ||
      this._gpActionDown(action) || this._touchActionDown(action);
  }

  wasPressed(action) {
    if (!this.enabled) return false;
    return this.keymap[action].some((c) => this.pressed.has(c)) ||
      this._gpPressed.has(action) || this._touchPressed.has(action);
  }

  // Keyboard-only held check (snapshot merges gamepad separately so analog
  // values are not double-counted through isDown()).
  _kbDown(action) {
    return this.keymap[action].some((c) => this.down.has(c));
  }

  // Returns a fresh snapshot of the full driving state, merging keyboard and
  // gamepad (analog where the pad provides it).
  snapshot() {
    // In the kart's +Z-forward coordinate frame positive yaw is a visual left
    // turn. Keep that engine convention internal while exposing ordinary
    // controls: A/← and stick-left turn left; D/→ and stick-right turn right.
    const kSteer = (this._kbDown('left') ? 1 : 0) + (this._kbDown('right') ? -1 : 0);
    const gp = this._gp;
    // Keyboard steer, physical stick and virtual touch stick add; opposite
    // directions cancel cleanly. Discrete touch arrows share the same axes.
    const touchSteer = (this._touch.left ? 1 : 0) - (this._touch.right ? 1 : 0);
    let steer = kSteer + gp.steer + gp.steerDigital + touchSteer + this._touch.steer;
    steer = Math.max(-1, Math.min(1, steer));
    return {
      throttle: Math.max(this._kbDown('throttle') ? 1 : 0, gp.throttle, this._touch.throttle),
      brake: Math.max(this._kbDown('brake') ? 1 : 0, gp.brake, this._touch.brake),
      steer,
      drift: this._kbDown('drift') || !!this._gp.buttons[2] || !!this._gp.buttons[4] || !!this._touch.drift,
      trick: this.wasPressed('trick'),
      item: this.wasPressed('item'),
    };
  }

  endFrame() {
    this.pressed.clear();
    this._gpPressed.clear();
    this._touchPressed.clear();
  }
}
