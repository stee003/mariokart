// ============================================================================
// Gamepad menu navigation suite.
//
// Regression: the menus were mouse/keyboard only. A controller could START
// into the pause card and A-confirm on the results card, but there was no way
// to move between buttons, so every other screen was unreachable with a pad.
// GamepadUINavigator (src/uiNav.js) adds a spatial cursor driven by the D-pad
// or left stick, A to activate, B for the screen's [data-nav-back] button and
// left/right to adjust sliders.
//
// These tests parse the REAL index.html into a light DOM tree, fake a standard
// gamepad, and drive the navigator frame by frame.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

// ---------------------------------------------------------------- light DOM
const VOID_TAGS = new Set(['input', 'br', 'img', 'meta', 'link', 'hr', 'source', 'area']);

function makeEl(tag, attrs = {}) {
  const handlers = {};
  const el = {
    tag,
    id: attrs.id || '',
    attrs,
    children: [],
    parent: null,
    type: attrs.type || null,
    value: attrs.value ?? '',
    min: attrs.min, max: attrs.max, step: attrs.step,
    disabled: false,
    clicks: 0,
    focused: false,
    scrollCalls: 0,
    events: [],
    style: {},
    textContent: '',
    innerHTML: '',
    classList: {
      _s: new Set((attrs.class || '').split(/\s+/).filter(Boolean)),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, force) {
        const want = force === undefined ? !this._s.has(c) : !!force;
        want ? this._s.add(c) : this._s.delete(c);
        return want;
      },
      contains(c) { return this._s.has(c); },
    },
    get dataset() {
      const out = {};
      for (const [k, v] of Object.entries(this.attrs)) {
        if (k.startsWith('data-')) out[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
      }
      return out;
    },
    addEventListener(t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(e) {
      el.events.push(e.type);
      for (const fn of handlers[e.type] || []) fn(e);
      return true;
    },
    click() {
      el.clicks++;
      el.dispatchEvent({ type: 'click' });
    },
    focus() { el.focused = true; if (global.document) global.document.activeElement = el; },
    blur() { el.focused = false; },
    scrollIntoView() { el.scrollCalls++; },
    getClientRects() { return [{}]; },
    getBoundingClientRect() { return { left: el._x, top: el._y, width: 200, height: 34,
      right: el._x + 200, bottom: el._y + 34 }; },
    appendChild(c) { c.parent = el; el.children.push(c); return c; },
    append(...cs) { for (const c of cs) el.appendChild(c); },
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return el.attrs[k] ?? null; },
    querySelectorAll(sel) { return queryAll(el, sel); },
    querySelector(sel) { return queryAll(el, sel)[0] || null; },
    getContext() { return null; },
    _x: 0, _y: 0,
  };
  return el;
}

function parseAttrs(str) {
  const out = {};
  const re = /([\w:@.-]+)(?:\s*=\s*"([^"]*)")?/g;
  let m;
  while ((m = re.exec(str || ''))) out[m[1]] = m[2] === undefined ? '' : m[2];
  return out;
}

function parseTree(src) {
  src = src.replace(/<!--[\s\S]*?-->/g, '');
  const root = makeEl('#root');
  const stack = [root];
  const re = /<(\/)?([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*"[^"]*")?)*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(src))) {
    const [, closing, tag, attrStr, selfClose] = m;
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    if (['script', 'style'].includes(tag)) continue;
    const el = makeEl(tag, parseAttrs(attrStr));
    stack[stack.length - 1].appendChild(el);
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push(el);
  }
  return root;
}

function walk(el, fn) {
  for (const c of el.children) { fn(c); walk(c, fn); }
}

function matchSimple(el, sel) {
  const attrRe = /\[([\w-]+)(?:\s*=\s*"?([^\]"]*)"?)?\]/g;
  const tagPart = sel.split('[')[0];
  if (tagPart.startsWith('.')) {
    if (!el.classList.contains(tagPart.slice(1))) return false;
  } else if (tagPart && tagPart !== '*') {
    if (el.tag !== tagPart) return false;
  }
  let m;
  while ((m = attrRe.exec(sel))) {
    const [, name, val] = m;
    const have = el.attrs[name];
    if (val === undefined) { if (have === undefined) return false; }
    else if (have !== val) return false;
  }
  return true;
}

function matches(el, sel) {
  const notM = sel.match(/:not\(([^)]*)\)/);
  let base = sel, notSel = null;
  if (notM) { notSel = notM[1]; base = sel.replace(notM[0], ''); }
  if (notSel && matchSimple(el, notSel)) return false;
  return matchSimple(el, base.trim());
}

function queryAll(rootEl, selector) {
  const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  walk(rootEl, (el) => { if (parts.some((p) => matches(el, p))) out.push(el); });
  return out;
}

// ------------------------------------------------------------------ globals
const tree = parseTree(html);
const byId = new Map();
walk(tree, (el) => { if (el.id) byId.set(el.id, el); });

// Document-order layout so spatial navigation has something to work with:
// every element gets a row, siblings inside a horizontal toggle share a row.
{
  let row = 0;
  const assign = (el, depth) => {
    el._y = row * 44;
    el._x = depth * 8;
    row++;
    for (const c of el.children) assign(c, depth + 1);
  };
  assign(tree, 0);
}

global.window = {
  addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  localStorage: { getItem: () => null, setItem() {} },
};
global.document = {
  documentElement: makeEl('html'),
  body: makeEl('body'),
  activeElement: null,
  getElementById: (id) => byId.get(id) || null,
  createElement: (tag) => makeEl(tag),
  querySelectorAll: (sel) => queryAll(tree, sel),
  querySelector: (sel) => queryAll(tree, sel)[0] || null,
  contains: (el) => { let n = el; while (n) { if (n === tree) return true; n = n.parent; } return false; },
};
global.Event = class { constructor(type, opts = {}) { this.type = type; Object.assign(this, opts); } };
global.localStorage = global.window.localStorage;

const { SaveManager } = await import('../src/save.js');
const { InputManager, PAD } = await import('../src/input.js');
const { GamepadUINavigator } = await import('../src/uiNav.js');

// --------------------------------------------------------------- fake pad
let pad = null;
function mkPad(over = {}) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: false, value: 0 }));
  const set = (i, v) => { if (buttons[i]) { buttons[i].pressed = !!v; buttons[i].value = v ? 1 : 0; } };
  for (const [k, v] of Object.entries(over)) {
    if (k.startsWith('b')) set(Number(k.slice(1)), v);
  }
  return {
    connected: true,
    axes: [over.steer ?? 0, over.axisY ?? 0, 0, 0],
    buttons,
    mapping: 'standard',
  };
}
Object.defineProperty(global, 'navigator', {
  value: { getGamepads: () => (pad ? [pad] : []) }, configurable: true, writable: true,
});

// A tiny frame driver: set the pad, poll, run the navigator.
const save = new SaveManager();
const input = new InputManager(save);
const sounds = [];
const audio = new Proxy({}, { get: (_, k) => (...a) => { sounds.push(k); } });
const nav = new GamepadUINavigator({ input, audio });

const show = (id) => {
  for (const s of queryAll(tree, '.screen')) s.classList.toggle('hidden', s.id !== id);
};
const hideAll = () => { for (const s of queryAll(tree, '.screen')) s.classList.add('hidden'); };
const visible = () => queryAll(tree, '.screen').filter((s) => !s.classList.contains('hidden')).map((s) => s.id);

function frame(over) {
  if (over === null) pad = null; else pad = mkPad(over);
  input.poll();
  const r = nav.update();
  input.endFrame();
  return r;
}
// One navigation step: press for a frame, then release so the next press is a
// fresh edge (holding is covered separately by `hold`).
function tap(over) {
  const r = frame(over);
  frame({});
  return r;
}
// hold a direction across `n` frames, advancing the repeat clock
async function hold(over, n) {
  let acted = 0;
  for (let i = 0; i < n; i++) {
    const r = frame(over);
    if (r?.acted) acted++;
    if (i === 0) await new Promise((res) => setTimeout(res, 430));
    else await new Promise((res) => setTimeout(res, 115));
  }
  return acted;
}

// ==========================================================================
console.log('--- No screen, no cursor ---');
hideAll();
pad = mkPad({ b12: true });
input.poll();
check('nothing to navigate while racing', nav.update() === null);
input.endFrame();

// ==========================================================================
console.log('--- Pause menu: the reported bug ---');
{
  show('screen-pause');
  frame({});                                     // settle, no input
  check('pause screen is visible', visible().join() === 'screen-pause');
  const buttons = byId.get('screen-pause').querySelectorAll('button');
  check('pause menu exposes 4 buttons to the pad', buttons.length === 4, `n=${buttons.length}`);
  check('cursor starts on the primary (Resume)', nav.el === byId.get('btn-resume'),
    nav.el?.id);

  // D-pad down walks the list
  tap({ b13: true });
  check('D-pad down moves to Settings', nav.el === byId.get('btn-pause-settings'), nav.el?.id);
  tap({ b13: true });
  check('D-pad down again moves to Restart', nav.el === byId.get('btn-pause-restart'), nav.el?.id);
  tap({ b12: true });
  check('D-pad up moves back to Settings', nav.el === byId.get('btn-pause-settings'), nav.el?.id);

  // left stick works too
  tap({ axisY: 0.9 });
  check('stick down moves to Restart', nav.el === byId.get('btn-pause-restart'), nav.el?.id);
  tap({ axisY: -0.9 });
  check('stick up moves back', nav.el === byId.get('btn-pause-settings'), nav.el?.id);

  // A activates the highlighted button
  const target = byId.get('btn-pause-settings');
  frame({ b0: true });
  check('A activates the highlighted button', target.clicks === 1, `clicks=${target.clicks}`);
  check('the pad click is dispatched on the element', target.events.includes('click'));

  // B runs the screen's back action (pause -> Resume)
  frame({ b1: true });
  check('B activates the pause screen back button (Resume)',
    byId.get('btn-resume').clicks === 1, `clicks=${byId.get('btn-resume').clicks}`);

  // the cursor is painted only for pad players
  check('pad cursor class is applied', nav.el?.classList?.contains('pad-focus') === true);
  check('body is flagged as pad-driven', global.document.body.classList.contains('pad-nav'));
}

// ==========================================================================
console.log('--- Auto-repeat while a direction is held ---');
{
  show('screen-mode');
  frame({});
  const rows = byId.get('screen-mode').querySelectorAll('button');
  check('mode select offers 6 buttons', rows.length === 6, `n=${rows.length}`);
  const fired = await hold({ b13: true }, 5);
  check('holding down auto-repeats past the first press', fired >= 3, `fired=${fired}`);
  check('repeat walked to the end of the list', nav.el === rows[rows.length - 1], nav.el?.id);
  frame({});
  const extra = await hold({ b13: true }, 2);
  check('the cursor stops at the last row instead of wrapping away',
    nav.el === rows[rows.length - 1], `extra=${extra}`);
  frame({});
}

// ==========================================================================
console.log('--- Settings: sliders and toggles are reachable ---');
{
  show('screen-settings');
  frame({});
  const engine = byId.get('engine-volume');
  check('the engine volume slider is in the pad list', nav.items.includes(engine));

  // walk down to the engine slider (Volume is the row above it)
  let guard = 0;
  while (nav.el !== engine && guard++ < 40) tap({ b13: true });
  check('D-pad reaches the engine volume slider', nav.el === engine, `at=${nav.el?.id} steps=${guard}`);

  engine.value = '0.6';
  let heard = 0;
  engine.addEventListener('input', () => { heard++; });
  tap({ b15: true });                            // right
  check('right raises the slider', parseFloat(engine.value) > 0.6, `value=${engine.value}`);
  check('the slider dispatches an input event', heard >= 1, `heard=${heard}`);
  tap({ b14: true });                            // left
  check('left lowers the slider', parseFloat(engine.value) < 0.7, `value=${engine.value}`);

  // clamp at both ends
  for (let i = 0; i < 40; i++) tap({ b14: true });
  check('slider clamps at min', parseFloat(engine.value) === parseFloat(engine.min), engine.value);
  for (let i = 0; i < 60; i++) tap({ b15: true });
  check('slider clamps at max', parseFloat(engine.value) === parseFloat(engine.max), engine.value);

  // a left/right press on a slider must not steal focus sideways
  const before = nav.el;
  tap({ b15: true });
  check('slider keeps focus while being adjusted', nav.el === before);
}

// ==========================================================================
console.log('--- Back buttons per screen ---');
{
  const cases = [
    ['screen-settings', 'btn-settings-back'],
    ['screen-garage', 'btn-garage-back'],
    ['screen-mode', 'btn-mode-back'],
    ['screen-trackselect', 'btn-tracksel-back'],
    ['screen-cupselect', 'btn-cupsel-back'],
    ['screen-battleselect', 'btn-battlesel-back'],
  ];
  for (const [screenId, backId] of cases) {
    show(screenId);
    frame({});
    const back = byId.get(backId);
    check(`${screenId} marks ${backId} as its back button`,
      !!back && back.attrs['data-nav-back'] !== undefined);
    tap({ b1: true });
    check(`${screenId}: B presses ${backId}`, back.clicks > 0, `clicks=${back?.clicks}`);
  }
}

// ==========================================================================
console.log('--- Locked / hidden controls are skipped ---');
{
  show('screen-garage');
  frame({});
  const locked = makeEl('button', { class: 'btn list-row garage-cell locked' });
  locked.disabled = true;
  byId.get('screen-garage').appendChild(locked);
  frame({});
  check('a disabled+locked cell never enters the pad list', !nav.items.includes(locked));

  const hiddenScreen = byId.get('screen-main');
  show('screen-garage');
  frame({});
  check('buttons on hidden screens are not reachable',
    !nav.items.includes(byId.get('btn-start')) && visible().join() === 'screen-garage',
    visible().join());
  hiddenScreen.classList.remove('hidden');
}

// ==========================================================================
console.log('--- Mouse takes the cursor back ---');
{
  show('screen-pause');
  frame({ b13: true });
  check('pad cursor is painted', nav.painted === true);
  nav.suppress();
  check('suppress clears the highlight', nav.painted === false && nav.el === null);
  check('suppress clears the body flag', !global.document.body.classList.contains('pad-nav'));
  frame({});
  check('a mouse-owned menu does not repaint the pad cursor', nav.painted === false);
  frame({ b13: true });
  check('touching the pad again brings the cursor back', nav.painted === true && !!nav.el);
  frame({});
}

// ==========================================================================
console.log('--- No pad connected: the navigator stays out of the way ---');
{
  show('screen-pause');
  nav.release();
  byId.get('btn-resume').clicks = 0;
  frame(null);
  const r = frame(null);
  check('with no pad the cursor still tracks a default node', !!nav.el);
  check('with no pad no action is reported', r?.acted === false, JSON.stringify(r));
  check('with no pad nothing is clicked', byId.get('btn-resume').clicks === 0);
  check('with no pad the cursor is not painted', nav.painted === false);
  pad = mkPad({});
  input.poll(); input.endFrame();
  frame({});
  check('plugging the pad back in repaints the cursor', nav.painted === true);
}

// ==========================================================================
console.log('--- Spatial navigation prefers aligned targets ---');
{
  show('screen-mode');
  frame({});
  const rows = byId.get('screen-mode').querySelectorAll('button');
  // lay two of them out side by side, below the cursor
  const a = rows[1], b = rows[2];
  const saved = rows.map((r) => [r._x, r._y]);
  // rows[0] on top; a straight below it; b far to the right at almost the same
  // height; everything else pushed well out of the way.
  rows.forEach((r, i) => { r._x = 0; r._y = 5000 + i * 44; });
  rows[0]._x = 0; rows[0]._y = 0;
  a._x = 0; a._y = 100;
  b._x = 400; b._y = 104;
  nav.setEl(rows[0]);
  tap({ b13: true });                            // down
  check('down picks the aligned candidate, not the merely nearest',
    nav.el === a, `picked=${nav.el?.id}`);
  tap({ b15: true });                            // right
  check('right moves across to the offset candidate', nav.el === b, `picked=${nav.el?.id}`);
  // restore
  rows.forEach((r, i) => { r._x = saved[i][0]; r._y = saved[i][1]; });
}

// ==========================================================================
console.log('--- Markup contract ---');
{
  check('settings screen has an engine volume slider', !!byId.get('engine-volume'));
  check('pause screen has a settings button', !!byId.get('btn-pause-settings'));
  check('pause screen keeps resume/restart/main menu',
    !!byId.get('btn-resume') && !!byId.get('btn-pause-restart') && !!byId.get('btn-pause-menu'));
  check('exactly one back button per navigable screen',
    ['screen-settings', 'screen-garage', 'screen-mode', 'screen-trackselect',
      'screen-cupselect', 'screen-battleselect', 'screen-pause']
      .every((id) => byId.get(id).querySelectorAll('[data-nav-back]').length === 1));
  check('results screen offers a default pad target',
    byId.get('screen-results').querySelectorAll('[data-nav-default]').length === 1);
  check('PAD mapping exposes the D-pad buttons',
    PAD.UP === 12 && PAD.DOWN === 13 && PAD.LEFT === 14 && PAD.RIGHT === 15 && PAD.A === 0 && PAD.B === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
