// ============================================================================
// GamepadUINavigator - full controller support for every menu screen.
//
// Before this, the menus were mouse/keyboard only: a pad could START-pause and
// A-confirm on the results screen, but nothing could move between buttons, so
// a controller player was stuck on whatever the mouse had last touched.
//
// Model:
//   * one visible .screen at a time (HUDManager.showScreen guarantees it);
//   * every enabled button / slider inside it is a navigation node;
//   * D-pad or left stick moves a spatial cursor (nearest node in that
//     direction, biased toward alignment), with auto-repeat while held;
//   * A activates the node, B activates the screen's [data-nav-back] button,
//   * range inputs are adjusted with left/right instead of moving focus;
//   * the cursor is only PAINTED once the pad has actually been used, so mouse
//     and touch players never see a stray highlight.
//
// The navigator never touches game state directly: activating a node just
// clicks the real button, so every existing handler (and its audio) runs.
// ============================================================================

const FOCUSABLE = 'button, input[type="range"], select, [tabindex]:not([tabindex="-1"])';
const DIRS = ['up', 'down', 'left', 'right'];

// Across-weight for spatial navigation: how much a candidate that is off-axis
// costs relative to one that is straight ahead. Higher = stricter rows/columns.
const ACROSS_WEIGHT = 2.2;

export class GamepadUINavigator {
  constructor({ input, audio = null } = {}) {
    this.input = input;
    this.audio = audio;
    this.screen = null;
    this.items = [];
    this.el = null;
    this.painted = false;      // cursor is visibly attached to an element
    this.suppressed = false;   // a mouse/touch click took the UI back
  }

  // ------------------------------------------------------------- visibility
  visibleScreen() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return null;
    for (const s of document.querySelectorAll('.screen')) {
      if (!s.classList?.contains('hidden')) return s;
    }
    return null;
  }

  _usable(el) {
    if (!el || el.disabled) return false;
    const cls = el.classList;
    if (cls && (cls.contains('hidden') || cls.contains('locked'))) return false;
    // an element with no client boxes is not on screen (display:none subtree)
    if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
    return true;
  }

  collect(screen) {
    const out = [];
    if (!screen || typeof screen.querySelectorAll !== 'function') return out;
    for (const el of screen.querySelectorAll(FOCUSABLE)) {
      if (this._usable(el)) out.push(el);
    }
    return out;
  }

  _isRange(el) {
    return !!el && (el.type === 'range' || el.tagName === 'INPUT' && el.getAttribute?.('type') === 'range');
  }

  _centre(el) {
    if (typeof el.getBoundingClientRect === 'function') {
      const r = el.getBoundingClientRect();
      if (r && Number.isFinite(r.left)) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    // Headless / shim DOM: fall back to document order so navigation is still
    // testable without a layout engine.
    const i = Math.max(0, this.items.indexOf(el));
    return { x: 0, y: i * 40 };
  }

  // The node a freshly opened screen should start on.
  _preferred(items, screen) {
    const marked = screen?.querySelector?.('[data-nav-default]');
    if (marked && items.includes(marked)) return marked;
    const primary = items.find((el) => el.classList?.contains('btn-primary'));
    return primary || items[0] || null;
  }

  // ------------------------------------------------------------- the cursor
  // Only highlight once the pad has really been used, is still plugged in, and
  // a pointer has not taken over - mouse and touch players never see a ring.
  get paintCursor() {
    return !this.suppressed && !!(this.input && this.input.padUsedUI && this.input.gamepadConnected);
  }

  setEl(el) {
    if (this.el && this.el !== el) this.el.classList?.remove('pad-focus');
    this.el = el || null;
    this.painted = false;
    this.repaint();
  }

  // Attach/detach the visible cursor to whatever `el` currently is. Called
  // after every selection change and whenever `paintCursor` flips.
  repaint() {
    const want = this.paintCursor && !!this.el;
    this._bodyFlag(want);
    if (want && !this.painted) {
      this.el.classList?.add('pad-focus');
      this.painted = true;
      try { this.el.focus?.({ preventScroll: true }); } catch (_e) { this.el.focus?.(); }
      this.el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    } else if (!want && this.painted) {
      this.el?.classList?.remove('pad-focus');
      this.painted = false;
    }
  }

  // Drop the cursor because a pointer was used: the pad stays connected, but
  // the mouse owns the menu until a direction is pressed again.
  suppress() {
    this.suppressed = true;
    this._clearCursor();
  }

  // Drop the cursor entirely (no screen on top of the race).
  release() {
    this._clearCursor();
    this.screen = null;
    this.items = [];
  }

  _clearCursor() {
    if (this.el) this.el.classList?.remove('pad-focus');
    this.el = null;
    this.painted = false;
    this._bodyFlag(false);
  }

  _bodyFlag(on) {
    const body = typeof document !== 'undefined' ? document.body : null;
    body?.classList?.toggle?.('pad-nav', !!on);
  }

  // ------------------------------------------------------------- navigation
  _move(dir) {
    const from = this.el;
    if (!from) return false;
    if ((dir === 'left' || dir === 'right') && this._isRange(from)) {
      return this._nudge(from, dir);
    }
    const a = this._centre(from);
    let best = null, bestScore = Infinity;
    for (const el of this.items) {
      if (el === from) continue;
      const b = this._centre(el);
      const dx = b.x - a.x, dy = b.y - a.y;
      let along, across;
      if (dir === 'up') { along = -dy; across = Math.abs(dx); }
      else if (dir === 'down') { along = dy; across = Math.abs(dx); }
      else if (dir === 'left') { along = -dx; across = Math.abs(dy); }
      else { along = dx; across = Math.abs(dy); }
      if (along <= 0.5) continue;
      const score = along + across * ACROSS_WEIGHT;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) return false;
    this.setEl(best);
    this.audio?.uiMove?.();
    return true;
  }

  // Sliders are walked in whole steps and written back rounded to the step's
  // own precision. Adding `step` repeatedly in floating point never lands
  // exactly on min/max (0 becomes 2.7e-17, 1 becomes 0.9999999999999999),
  // which both looked wrong in the save data and left the slider a hair short
  // of its ends no matter how long the pad was held.
  _nudge(el, dir) {
    const min = parseFloat(el.min);
    const max = parseFloat(el.max);
    const step = parseFloat(el.step);
    const lo = Number.isFinite(min) ? min : 0;
    const hi = Number.isFinite(max) ? max : 1;
    const inc = Number.isFinite(step) && step > 0 ? step : (hi - lo) / 20;
    const steps = Math.max(1, Math.round((hi - lo) / inc));
    const cur = parseFloat(el.value);
    const at = Number.isFinite(cur) ? Math.round((cur - lo) / inc) : 0;
    // two steps per press so holding the pad sweeps a slider quickly
    const target = Math.max(0, Math.min(steps, at + (dir === 'right' ? 2 : -2)));
    if (target === at) return false;
    const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(inc)) + 1));
    const value = Number(Math.min(hi, Math.max(lo, lo + target * inc)).toFixed(decimals));
    el.value = String(value);
    if (typeof Event === 'function' && typeof el.dispatchEvent === 'function') {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    this.audio?.uiTick?.();
    return true;
  }

  _activate() {
    const el = this.el;
    if (!el) return false;
    if (this._isRange(el)) return false;         // sliders use left/right
    if (typeof el.click === 'function') { el.click(); return true; }
    return false;
  }

  _back(screen) {
    const btn = screen?.querySelector?.('[data-nav-back]');
    if (btn && this._usable(btn) && typeof btn.click === 'function') {
      this.audio?.uiBack?.();
      btn.click();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------- per frame
  // Returns a short report of what happened this frame (used by tests and by
  // main.js to keep pad confirm from double-firing with keyboard shortcuts).
  update() {
    const screen = this.visibleScreen();
    if (!screen) { this.release(); return null; }

    this.items = this.collect(screen);
    if (!this.items.length) { this.release(); this.screen = screen; return null; }

    const screenChanged = screen !== this.screen;
    this.screen = screen;
    if (screenChanged || !this.items.includes(this.el)) {
      this.setEl(this._preferred(this.items, screen));
    } else {
      this.repaint();
    }

    const input = this.input;
    if (!input || !input.gamepadConnected) return { acted: false, screen: screen.id };

    const report = { acted: false, screen: screen.id, moved: null };
    const confirm = input.padPressed('confirm');
    const back = input.padPressed('back');
    const dir = DIRS.find((d) => input.uiPressed(d)) || null;

    // any pad intent hands control back from the mouse
    if ((dir || confirm || back) && this.suppressed) {
      this.suppressed = false;
      this.repaint();
    }
    if (dir) {
      if (this._move(dir)) { report.acted = true; report.moved = dir; }
    } else if (confirm) {
      report.acted = this._activate();
      report.action = 'confirm';
    } else if (back) {
      report.acted = this._back(screen);
      report.action = 'back';
    }
    return report;
  }
}
