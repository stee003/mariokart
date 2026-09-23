// Entry-point smoke test: boots src/main.js exactly like a browser would.
//
// This is the test that was missing when the game shipped a main.js with a
// duplicated tail: every other suite imported *modules*, nothing imported the
// game itself, so a fatal parse/runtime error in the entry point went unseen.
//
// Node has no WebGL, so the stub canvas hands THREE a proxy GL context: enough
// for WebGLRenderer to construct, which lets the REAL Game constructor run end
// to end - track, environment, items, roster, garage, HUD and every signal
// binding. Every DOM id it asks for must exist in index.html, and the
// player-facing menu must not be left half-wired.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

// ------------------------------------------------------------------ stub DOM
function fake2D() {
  const grad = { addColorStop() {} };
  return {
    createRadialGradient: () => grad, createLinearGradient: () => grad,
    fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {},
    closePath() {}, fill() {}, stroke() {}, fillText() {}, ellipse() {}, save() {}, restore() {},
    translate() {}, rotate() {}, quadraticCurveTo() {}, fillStyle: '', strokeStyle: '',
    font: '', textAlign: '', textBaseline: '', lineWidth: 1, lineCap: '',
  };
}

// A permissive stand-in for WebGL: THREE only needs a few queries to answer
// with plausible values while it builds its capability tables.
const GL_ENUMS = {
  VERSION: 0x1f02, SHADING_LANGUAGE_VERSION: 0x8b8c, EXTENSIONS: 0x1f03,
  MAX_TEXTURE_SIZE: 0x0d33, MAX_CUBE_MAP_TEXTURE_SIZE: 0x851c, MAX_RENDERBUFFER_SIZE: 0x84e8,
  MAX_VERTEX_UNIFORM_VECTORS: 0x8dfb, MAX_FRAGMENT_UNIFORM_VECTORS: 0x8dfd,
  MAX_VARYING_VECTORS: 0x8dfc, MAX_VERTEX_ATTRIBS: 0x8869, MAX_SAMPLES: 0x8d57,
  MAX_TEXTURE_IMAGE_UNITS: 0x8872, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b4c,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8b4d, MAX_VIEWPORT_DIMS: 0x0d3a, SCISSOR_BOX: 0x0c10,
  COMPRESSED_TEXTURE_FORMATS: 0x86a3,
  ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, TEXTURE_2D: 0x0de1,
};
function fakeGL() {
  return new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'string' && prop in GL_ENUMS) return GL_ENUMS[prop];
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return 1;   // any other GL enum
      if (prop === 'canvas') return { width: 1280, height: 720, style: {}, addEventListener() {} };
      if (prop === 'getParameter') {
        return (p) => {
          if (p === 7938) return 'WebGL 2.0 (fake)';
          if (p === 35724) return 'WebGL GLSL ES 3.00 (fake)';
          if (p === 33901) return [8192, 8192];
          return 4096;
        };
      }
      if (prop === 'getExtension') return () => null;
      if (prop === 'getShaderPrecisionFormat') return () => ({ rangeMin: 127, rangeMax: 127, precision: 23 });
      if (prop === 'getContextAttributes') return () => ({});
      return () => ({});
    },
    set() { return true; },
  });
}

class El {
  constructor(tag, id = '') {
    this.tagName = tag;
    this.id = id;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this.value = '0';
    this.width = 100;
    this.height = 100;
    this.disabled = false;
    this._text = '';
    this.classList = {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) {
        if (f === undefined) (this._s.has(c) ? this._s.delete(c) : this._s.add(c));
        else (f ? this._s.add(c) : this._s.delete(c));
      },
      contains(c) { return this._s.has(c); },
    };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = v == null ? '' : String(v); }
  get innerHTML() { return ''; }
  set innerHTML(_v) { this.children = []; this._text = ''; }
  appendChild(c) { this.children.push(c); return c; }
  append(...c) { this.children.push(...c); }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener() {}
  querySelectorAll() { return []; }
  getContext(kind) { return kind === '2d' ? fake2D() : fakeGL(); }
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
  setAttribute(k, v) { this[k] = v; }
  focus() {}
  click() { for (const fn of this.listeners.click || []) fn({ preventDefault() {}, target: this }); return true; }
}

const requestedIds = new Set();
const elements = new Map();
const getById = (id) => {
  requestedIds.add(id);
  if (!elements.has(id)) elements.set(id, new El('div', id));
  return elements.get(id);
};
global.document = {
  getElementById: getById,
  createElement: (tag) => new El(tag),
  querySelectorAll: () => [],
  body: new El('body'),
  addEventListener() {}, removeEventListener() {},
};
global.window = {
  addEventListener() {}, removeEventListener() {},
  devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  location: { protocol: 'http:', host: 'localhost:8000', origin: 'http://localhost:8000' },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};
global.self = global.window;

const indexHtml = await readFile(path.join(ROOT, 'index.html'), 'utf8');
const mainSource = await readFile(path.join(ROOT, 'src', 'main.js'), 'utf8');
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); };

let importThrew = null;
console.log('--- entry point boots ---');
try {
  await import('../src/main.js');
} catch (err) {
  importThrew = err;
}
console.error = originalError;

check('main.js boots the whole game without throwing',
  importThrew === null, importThrew ? `${importThrew.name}: ${importThrew.message}` : '');
check('no errors were logged during boot',
  !errors.some((e) => !/extension not supported/i.test(e)),
  errors.filter((e) => !/extension not supported/i.test(e)).slice(0, 2).join(' | '));
check('the game built its world (loads a track and reads the HUD)',
  requestedIds.size > 25, `ids=${requestedIds.size}`);

if (process.env.DEBUG_ENTRY) {
  console.log('  DEBUG requested ids:', [...requestedIds].join(', '));
  console.log('  DEBUG screen-main hidden?', elements.get('screen-main')?.classList.contains('hidden'));
  console.log('  DEBUG webgl-error hidden?', elements.get('webgl-error')?.classList.contains('hidden'));
  console.log('  DEBUG errors:', errors.join(' | '));
}
// main.js only ever looks up #webgl-error on the failure path, so "was it
// requested at all?" is a precise signal that boot succeeded.
check('the webgl-error fallback was not triggered', !requestedIds.has('webgl-error'));

// bindUI() ran: the menu buttons must have click handlers attached.
const bound = ['btn-start', 'btn-garage', 'btn-records', 'btn-online', 'btn-settings',
  'btn-mode-quick', 'btn-mode-battle', 'btn-battle-start'];
const unbound = bound.filter((id) => !(elements.get(id)?.listeners.click || []).length);
check('the main menu is fully wired', unbound.length === 0, `unbound: ${unbound.join(', ')}`);
check('the HUD received its elements',
  !!elements.get('hud') && !!elements.get('battle-board') && !!elements.get('item-box'));

// Every DOM id the game asked for must exist in index.html (auto-created stubs
// would silently hide a typo like "bttn-start").
console.log('--- DOM contract ---');
const missingIds = [...requestedIds].filter((id) => !indexHtml.includes(`id="${id}"`));
check('every element the game looks up exists in index.html', missingIds.length === 0,
  missingIds.slice(0, 8).join(', '));

// The screens the loader touches must all be declared in the markup.
const { SCREEN_IDS } = await import('../src/hud.js');
const declaredScreens = SCREEN_IDS.filter((id) => indexHtml.includes(`id="${id}"`));
check('every screen the state machine can show is in the markup',
  declaredScreens.length === SCREEN_IDS.length,
  SCREEN_IDS.filter((id) => !indexHtml.includes(`id="${id}"`)).join(', '));
check('the screen list also covers the screens main.js names', (() => {
  const named = new Set([...mainSource.matchAll(/showScreen\('([a-z-]+)'\)/g)].map((m) => m[1]));
  const missing = [...named].filter((id) => !SCREEN_IDS.includes(id));
  if (missing.length) console.log('    not in SCREEN_IDS:', missing.join(', '));
  return missing.length === 0;
})());

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
