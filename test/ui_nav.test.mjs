// UI navigation regression test - guards the screen-manager fix.
//
// Regression history: HUDManager.showScreen() used to toggle a hardcoded
// list of FOUR screens, so screen-mode / screen-trackselect / screen-cupselect
// / screen-battleselect (added later) never became visible - "Start Race" on
// the main menu appeared to do nothing. showScreen now manages every element
// carrying the .screen class dynamically. This test boots the real index.html
// markup into a light DOM shim and walks the navigation paths.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

// ------------------------------------------------------------ light DOM shim
const elements = new Map();

function makeClassList(initial) {
  const set = new Set(initial);
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    toggle: (c, force) => {
      const want = force === undefined ? !set.has(c) : force;
      want ? set.add(c) : set.delete(c);
    },
    contains: (c) => set.has(c),
    _set: set,
  };
}

function makeElement(tag = 'div', id = '', cls = '') {
  return {
    tag, id,
    className: cls,
    classList: makeClassList(cls.split(/\s+/).filter(Boolean)),
    style: {}, dataset: {},
    textContent: '', innerHTML: '',
    children: [], parent: null,
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { this.children.push(...cs); },
    setAttribute() {},
    getContext() { return null; },
  };
}

// Parse every element with an id out of index.html into the registry.
// This shim only models what the test needs: id, classes, hidden state.
function parseHtmlScreens(src) {
  const tagRe = /<(\w+)([^>]*?)>/gs;
  let m;
  while ((m = tagRe.exec(src))) {
    const [, tag, attrs] = m;
    const idM = attrs.match(/id="([^"]+)"/);
    if (!idM) continue;
    const clsM = attrs.match(/class="([^"]*)"/);
    const el = makeElement(tag, idM[1], clsM ? clsM[1] : '');
    elements.set(el.id, el);
  }
}
parseHtmlScreens(html);

global.window = {
  addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  localStorage: { getItem: () => null, setItem() {} },
  localStorageShim: true,
};
global.document = {
  documentElement: makeElement('html', 'html'),
  body: makeElement('body', 'body'),
  getElementById: (id) => elements.get(id) || null,
  createElement: (tag) => makeElement(tag),
  querySelectorAll: (sel) => {
    if (sel === '.screen') {
      return [...elements.values()].filter((e) => e.classList.contains('screen'));
    }
    if (sel === '[data-i18n]') return [];
    if (sel.includes('.seg .fill')) return [makeElement('div'), makeElement('div'), makeElement('div')];
    return [];
  },
};

const { SaveManager } = await import('../src/save.js');
const { LocalizationManager } = await import('../src/i18n.js');
const { HUDManager } = await import('../src/hud.js');

const i18n = new LocalizationManager(new SaveManager());
const hud = new HUDManager(i18n);

// ------------------------------------------------------------ markup sanity
const MENU_SCREENS = [
  'screen-main', 'screen-settings', 'screen-mode', 'screen-trackselect',
  'screen-cupselect', 'screen-battleselect', 'screen-pause', 'screen-results',
  'screen-garage', 'webgl-error',
];
check('index.html defines all menu screens',
  MENU_SCREENS.every((id) => elements.has(id)),
  MENU_SCREENS.filter((id) => !elements.has(id)).join(','));
check('all menu screens carry the .screen class',
  MENU_SCREENS.every((id) => elements.get(id).classList.contains('screen')));
check('exactly the main menu starts visible',
  [...document.querySelectorAll('.screen')]
    .filter((s) => !s.classList.contains('hidden')).map((s) => s.id).join(',') === 'screen-main');
check('main menu uses the polished command-panel structure',
  html.includes('main-menu-card') && html.includes('main-actions')
    && html.includes('loadout-panel') && html.includes('action-note'));

// every element id referenced by main.js's bindUI must exist in markup
const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
const idRefs = new Set();
for (const re of [/click\('([^']+)'/g, /\$\('([^']+)'\)/g, /getElementById\('([^']+)'\)/g]) {
  let m; while ((m = re.exec(mainSrc))) idRefs.add(m[1]);
}
const missing = [...idRefs].filter((id) => !elements.has(id));
check('every DOM id used by main.js exists in index.html', missing.length === 0, missing.join(','));

// ------------------------------------------------------------ navigation
const visibleScreens = () =>
  [...document.querySelectorAll('.screen')].filter((s) => !s.classList.contains('hidden')).map((s) => s.id);

// main menu -> mode select (the original bug: mode screen stayed hidden)
hud.showScreen('screen-mode');
check('mode select becomes visible on Start Race',
  visibleScreens().join() === 'screen-mode', visibleScreens().join());

hud.showScreen('screen-trackselect');
check('track select becomes visible', visibleScreens().join() === 'screen-trackselect');
hud.showScreen('screen-cupselect');
check('cup select becomes visible', visibleScreens().join() === 'screen-cupselect');
hud.showScreen('screen-battleselect');
check('battle select becomes visible', visibleScreens().join() === 'screen-battleselect');
hud.showScreen('screen-garage');
check('garage becomes visible', visibleScreens().join() === 'screen-garage');

// only one screen is ever visible at a time
let exclusive = true;
for (const id of MENU_SCREENS) {
  hud.showScreen(id);
  if (visibleScreens().length !== 1) exclusive = false;
}
check('showScreen is strictly exclusive', exclusive);

hud.hideScreens();
check('hideScreens hides everything (race HUD state)', visibleScreens().length === 0);
hud.showScreen('screen-pause');
check('pause shows after hidden race state', visibleScreens().join() === 'screen-pause');
hud.showScreen('screen-results');
check('results screen shows', visibleScreens().join() === 'screen-results');
hud.showScreen('screen-main');
check('back to main menu', visibleScreens().join() === 'screen-main');

// ------------------------------------------------------------ i18n of markup
const i18nAttrRe = /data-i18n="([^"]+)"/g;
const htmlKeys = new Set();
{ let m; while ((m = i18nAttrRe.exec(html))) htmlKeys.add(m[1]); }
const missingHtml = [...htmlKeys].filter((k) => i18n.t(k) === k);
check('every data-i18n key in index.html has a translation', missingHtml.length === 0, missingHtml.join(','));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
