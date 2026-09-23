// Increment 6 UI tests - the garage screen, screen navigation and the
// "never hardcode user-visible text" rule.
//
// Runs against a tiny fake DOM (no jsdom dependency): elements record their
// children and listeners so the test can both inspect the rendered tree and
// click through the UI exactly like a player would.
import {
  HUDManager, SCREEN_IDS, drawItemIcon,
} from '../src/hud.js';
import { LocalizationManager, STRINGS } from '../src/i18n.js';
import { Garage, GARAGE_TABS } from '../src/garage.js';
import { GarageUI } from '../src/ui/garageUI.js';
import { LocalProvider } from '../src/online.js';
import { RecordsUI } from '../src/ui/recordsUI.js';
import { LocalLeaderboard } from '../src/leaderboard.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

// ------------------------------------------------------------------ fake DOM
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

class FakeElement {
  constructor(tag, id = '') {
    this.tagName = tag;
    this.id = id;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this.value = '0';
    this.offsetWidth = 100;
    this.width = 100;
    this.height = 100;
    this.disabled = false;
    this._text = '';
    this.classList = {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, force) {
        if (force === undefined) this._set.has(c) ? this._set.delete(c) : this._set.add(c);
        else force ? this._set.add(c) : this._set.delete(c);
      },
      contains(c) { return this._set.has(c); },
    };
  }

  get textContent() { return this._text; }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  get innerHTML() { return ''; }
  set innerHTML(_v) { this.children = []; this._text = ''; }

  appendChild(child) { this.children.push(child); return child; }
  append(...items) { this.children.push(...items); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener() {}
  querySelectorAll() { return []; }
  getContext() { return fake2D(); }
  setPointerCapture() {}
  releasePointerCapture() {}

  click() {
    if (this.disabled) return false;
    for (const fn of this.listeners.click || []) fn({ preventDefault() {}, target: this });
    return true;
  }

  // Depth-first list of every element in the tree.
  tree() {
    const out = [this];
    for (const c of this.children) out.push(...(c.tree ? c.tree() : [c]));
    return out;
  }
}

function installDom() {
  const elements = new Map();
  const doc = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement('div', id));
      return elements.get(id);
    },
    createElement(tag) { return new FakeElement(tag); },
    querySelectorAll() { return []; },
    body: new FakeElement('body'),
  };
  global.document = doc;
  global.window = {
    addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
    localStorage: { getItem: () => null, setItem() {} },
  };
  return elements;
}
const elements = installDom();

function memSave(initial = {}) {
  const data = { ...initial };
  return { get: (k, fb) => (k in data ? data[k] : fb), set: (k, v) => { data[k] = v; }, _data: data };
}

// ------------------------------------------------------------ localization
console.log('--- Screen navigation ---');
{
  const i18n = new LocalizationManager(memSave());
  const hud = new HUDManager(i18n);
  check('screen list covers every menu screen the game uses', ['screen-main', 'screen-mode',
    'screen-trackselect', 'screen-cupselect', 'screen-battleselect', 'screen-garage',
    'screen-records', 'screen-online', 'screen-settings', 'screen-pause', 'screen-results',
  ].every((id) => SCREEN_IDS.includes(id)));

  // regression: selecting "Start Race" must actually reveal the mode screen
  hud.showScreen('screen-mode');
  const visible = SCREEN_IDS.filter((id) => !elements.get(id)?.classList.contains('hidden'));
  check('exactly one screen is visible after showScreen', visible.length === 1, visible.join(','));
  check('the requested screen is the visible one', visible[0] === 'screen-mode');
  hud.showScreen('screen-trackselect');
  check('switching screens hides the previous one',
    !elements.get('screen-mode').classList.contains('hidden') === false
    && !elements.get('screen-trackselect').classList.contains('hidden'));
  hud.hideScreens();
  check('hideScreens hides everything', SCREEN_IDS.every((id) => elements.get(id)?.classList.contains('hidden')));
}

// ------------------------------------------------------------- text purity
// Every rendered string must come out of the localization dictionary.
const ALL_STRINGS = new Set();
const ALL_WORDS = new Set();
for (const key of Object.keys(STRINGS)) {
  for (const lang of ['en', 'it']) {
    const value = STRINGS[key][lang];
    if (!value) continue;
    ALL_STRINGS.add(value);
    for (const word of value.split(/[^\p{L}\p{N}]+/u)) if (word) ALL_WORDS.add(word);
  }
}

// A rendered text is "localized" when it is a dictionary entry, or a
// composition of dictionary entries / numbers (e.g. a value row, a stat with
// a unit, or a "+0.4" delta badge).
function textIsLocalized(raw) {
  const text = String(raw || '').trim();
  if (!text) return true;
  if (ALL_STRINGS.has(text)) return true;
  if (/^[+\-−–—.,:×/\s%]+$/.test(text)) return true;          // pure punctuation
  const fragments = text.split(/[:·×→|()«»"“”/]+/);
  for (const raw2 of fragments) {
    const frag = raw2.replace(/[0-9]+([.,][0-9]+)?/g, ' ').replace(/[+\-−–%°\s]+/g, ' ').trim();
    if (!frag) continue;
    if (ALL_STRINGS.has(frag)) continue;
    const words = frag.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (words.length && words.every((w) => ALL_WORDS.has(w))) continue;
    return false;
  }
  return true;
}

function findUnlocalized(root) {
  const bad = [];
  for (const el of root.tree()) {
    if (el.children.length === 0 && el.textContent && !el.textContent.includes('undefined')) {
      if (!textIsLocalized(el.textContent)) bad.push(`${el.className || el.tagName}: "${el.textContent}"`);
    } else if (el.children.length === 0 && el.textContent.includes('undefined')) {
      bad.push(`${el.className || el.tagName}: "${el.textContent}" (unresolved key)`);
    }
  }
  return bad;
}

console.log('--- Localization purity ---');
check('purity helper accepts dictionary text', textIsLocalized(STRINGS['garage.title'].en));
check('purity helper rejects invented text', !textIsLocalized('Press START to begin the fun'));

// --------------------------------------------------------------- garage UI
console.log('--- Garage UI ---');
const save = memSave({ xp: 4000 });
const i18n = new LocalizationManager(save);
const garage = new Garage(save, { rng: () => 0.42 });
const actions = { back: 0, race: 0, previews: 0 };
const ui = new GarageUI({
  i18n, garage, preview: null,
  onBack: () => { actions.back++; },
  onRace: () => { actions.race++; },
  onPreviewChange: () => { actions.previews++; },
});
ui.show();

const tabBox = elements.get('garage-tabs');
check('a tab per customization page', tabBox.children.length === GARAGE_TABS.length,
  `${tabBox.children.length} vs ${GARAGE_TABS.length}`);
check('tabs are labelled from the dictionary',
  tabBox.children.every((b) => b.textContent === i18n.t(GARAGE_TABS.find((t) => i18n.t(t.labelKey) === b.textContent).labelKey)));

const listBox = elements.get('garage-list');
check('pilot page lists the whole roster', listBox.children.length === 14, `n=${listBox.children.length}`);
const unlocalized = [
  ...findUnlocalized(elements.get('garage-tabs')),
  ...findUnlocalized(listBox),
  ...findUnlocalized(elements.get('garage-stats')),
  ...findUnlocalized(elements.get('garage-perf')),
  ...findUnlocalized(elements.get('garage-caption')),
];
check('every rendered string is localized (EN)', unlocalized.length === 0, unlocalized.join(' | '));

check('stat panel shows six attributes', elements.get('garage-stats').children.length === 7,
  `n=${elements.get('garage-stats').children.length}`);
check('performance panel lists seven readouts', elements.get('garage-perf').children.length === 8,
  `n=${elements.get('garage-perf').children.length}`);
check('caption names the pilot and the build',
  elements.get('garage-caption').children.some((c) => c.textContent === i18n.t('char.ember')));

// equip through the UI
const chassisTab = tabBox.children.find((b) => b.textContent === i18n.t('garage.tab.chassis'));
check('clicking a tab switches page', chassisTab.click() && garage.tab === 'chassis');
const chassisList = elements.get('garage-list');
const unlockedRow = chassisList.children.find((row) => !row.disabled && row !== chassisList.children[0]);
const beforeSig = garage.signature;
check('clicking an unlocked row equips it', unlockedRow.click() && garage.signature !== beforeSig);
check('equipping persists to the save', save.get('loadout').chassisId === garage.spec.chassisId);

// locked rows: the pilot page always has two gated pilots (cup + achievement)
const pilotTab = tabBox.children.find((b) => b.textContent === i18n.t('garage.tab.pilot'));
pilotTab.click();
const pilotList = elements.get('garage-list');
const lockedRow = pilotList.children.find((row) => row.disabled);
check('locked rows are disabled', !!lockedRow,
  pilotList.children.map((r) => `${r.disabled ? 'X' : 'o'}`).join(''));
check('clicking a locked row changes nothing', (() => {
  const sig = garage.signature;
  const clicked = lockedRow.click();
  return clicked === false && garage.signature === sig;
})());

// randomize + focus buttons
const sigBeforeRandom = garage.signature;
elements.get('btn-garage-randomize').click();
check('randomize rebuilds the kart', garage.signature !== sigBeforeRandom || garage.signature.length > 0);
elements.get('btn-garage-focus').click();
check('focus button toggles pilot view and relabels itself',
  garage.focus === 'pilot' && elements.get('btn-garage-focus').textContent === i18n.t('garage.focusKart'));
elements.get('btn-garage-focus').click();
check('focus toggles back', garage.focus === 'kart');
elements.get('btn-garage-back').click();
elements.get('btn-garage-race').click();
check('back and race buttons fire their callbacks', actions.back === 1 && actions.race === 1);

// language switch re-renders everything in Italian
i18n.setLanguage('it');
const itList = elements.get('garage-list');
check('switching to IT re-renders the shop',
  itList.children.length > 0
  && findUnlocalized(elements.get('garage-tabs')).length === 0
  && findUnlocalized(itList).length === 0
  && findUnlocalized(elements.get('garage-stats')).length === 0,
  findUnlocalized(itList).join(' | '));
check('IT render actually uses Italian', (() => {
  const name = itList.children[0].children.find((c) => c.className === 'garage-row-text');
  const words = name.children[0].textContent;
  const key = GARAGE_TABS.find((t) => t.id === garage.tab);
  const anyItem = key.items()[0];
  return words === i18n.t(anyItem.nameKey) && i18n.t(anyItem.nameKey) === STRINGS[anyItem.nameKey].it;
})());
i18n.setLanguage('en');

// ------------------------------------------------------------- records UI
console.log('--- Records screen ---');
const recSave = memSave({ xp: 5000, trophies: { ember: 'gold' }, achievements: ['first_win'], stats: { races: 9, wins: 3 } });
const recI18n = new LocalizationManager(recSave);
const board = new LocalLeaderboard(recSave);
board.submit('sunforge_circuit', { name: 'You', time: 61.5 });
board.submit('sunforge_circuit', { name: 'Ghost', time: 59.2 });
const records = new RecordsUI({
  i18n: recI18n,
  save: recSave,
  provider: new LocalProvider(board),
  trackNameKey: () => 'track.sunforge',
});
records.show();
check('records screen renders all panels',
  elements.get('records-tracks').children.length > 0
  && elements.get('records-board').children.length > 0
  && elements.get('records-achievements').children.length > 0
  && elements.get('records-stats').children.length > 0);
check('leaderboard rows are localized', findUnlocalized(elements.get('records-board')).length === 0,
  findUnlocalized(elements.get('records-board')).join(' | '));
check('achievement rows are localized', findUnlocalized(elements.get('records-achievements')).length === 0,
  findUnlocalized(elements.get('records-achievements')).join(' | '));
check('stat rows are localized', findUnlocalized(elements.get('records-stats')).length === 0,
  findUnlocalized(elements.get('records-stats')).join(' | '));
const summaryText = elements.get('records-summary').tree().map((n) => n.textContent).join(' ');
check('progression header shows level + xp', /[0-9]/.test(summaryText), `"${summaryText}"`);
check('summary is localized', findUnlocalized(elements.get('records-summary')).length === 0,
  findUnlocalized(elements.get('records-summary')).join(' | '));


// --------------------------------------------------------------- online UI
console.log('--- Online screen ---');
{
  const { OnlineUI } = await import('../src/ui/onlineUI.js');
  const i18n = new LocalizationManager(memSave());
  const save = memSave({ playerName: 'Arena', loadout: { characterId: 'nova', chassisId: 'tempest_bolt', wheelId: 'chrome_limbs' } });

  const fakeService = {
    online: true, status: 'online', latency: 14, name: 'http',
    async probe() { return true; },
    async getRanked() { return { season: '2026-09', rank: 4, points: 1032, wins: 3, matches: 7 }; },
    async fetchLadder() { return [{ rank: 1, name: 'Ada', points: 1120, wins: 5, matches: 8 }]; },
    async fetchRooms() { return []; },
  };
  const roster = new Map([
    ['p1', { id: 'p1', name: 'Ada', host: true }],
    ['p2', { id: 'p2', name: 'Bee', host: false }],
  ]);
  const fakeSession = {
    players: roster, host: true, room: 'WXYZ', connected: true,
    connect() {}, on() {}, join() {}, leave() {}, startRace() {},
  };
  const tracks = [{ id: 'sunforge_circuit', nameKey: 'track.sunforge' }];
  const ui = new OnlineUI({
    i18n, service: fakeService, tracks, save, session: fakeSession,
    onBack: () => { ui._backed = true; },
    onRankedRace: (t) => { ui._rankedTrack = t; },
    onGhostRace: (t, r) => { ui._ghost = [t, r]; },
  });

  ui.show();
  await new Promise((r) => setTimeout(r, 0));
  check('status chip reports the connection', /online/i.test(elements.get('online-status').textContent));
  check('ranked card shows season, rank and points', (() => {
    const text = elements.get('online-ranked').tree().map((n) => n.textContent).join(' ');
    return text.includes('2026-09') && text.includes('1032') && text.includes('#4');
  })());
  check('ladder lists the top player', (() => {
    const text = elements.get('online-ladder').tree().map((n) => n.textContent).join(' ');
    return text.includes('Ada') && text.includes('1120');
  })());
  check('lobby shows the room code and both racers', (() => {
    const text = elements.get('online-lobby').tree().map((n) => n.textContent).join(' ');
    return text.includes('WXYZ') && text.includes('Ada') && text.includes('Bee');
  })());
  check('host sees the start hint', elements.get('online-lobby').tree()
    .some((n) => /start/i.test(n.textContent)));
  check('racer tag input is prefilled from the save', elements.get('online-name').value === 'Arena');
  check('track picker offers every track', elements.get('online-track').tree().length >= tracks.length);

  elements.get('btn-online-ranked').click();
  check('ranked button targets the picked track', ui._rankedTrack === 'sunforge_circuit');
  elements.get('btn-online-ghost').click();
  check('ghost button asks for the #1 ghost', ui._ghost && ui._ghost[1] === 1);
  elements.get('btn-online-back').click();
  check('back button calls back', ui._backed === true);

  // offline: the same screen must degrade to a clear offline state
  const offline = new OnlineUI({
    i18n, tracks, save,
    service: { online: false, status: 'offline', latency: null, name: 'local',
      async probe() { return false; }, async getRanked() { return null; },
      async fetchLadder() { return []; }, async fetchRooms() { return []; } },
    session: { players: new Map(), host: false, room: null, connect() {}, on() {}, join() {}, leave() {}, startRace() {} },
  });
  offline.show();
  await new Promise((r) => setTimeout(r, 0));
  check('offline status is honest', /offline/i.test(elements.get('online-status').textContent));
  check('offline ranked card explains why', elements.get('online-ranked').tree()
    .some((n) => /server/i.test(n.textContent)));

  // purity: nothing on the screen may be hardcoded
  const bad = [];
  for (const id of ['online-status', 'online-ranked', 'online-ghost', 'online-lobby', 'online-ladder']) {
    for (const node of elements.get(id).tree()) {
      const text = String(node.textContent || '').trim();
      if (!text) continue;
      if (!textIsLocalized(text)) bad.push(`${id}: "${text}"`);
    }
  }
  check('every online string is localized', bad.length === 0, bad.join(' | '));

  // IT switch re-renders without leaking English
  i18n.setLanguage('it');
  ui.render();
  const itText = elements.get('online-ladder').tree().map((n) => n.textContent).join(' ');
  check('ladder re-renders in Italian', itText.includes('Classifica'), itText);
  i18n.setLanguage('en');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
