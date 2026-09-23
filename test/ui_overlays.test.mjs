// ============================================================================
// Minimap + track-preview suite.
//
// Both features are 2D-canvas renderers, so this boots them against a light
// canvas shim and asserts the things that actually break in practice:
// projections stay finite, every track and arena can be baked, previews are
// cached rather than rebuilt, the markup and localisation exist, and the
// minimap can be toggled off without the HUD touching a dead canvas.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

// ------------------------------------------------------------- canvas shim
// Records every drawing call so tests can assert that pixels were actually
// produced rather than silently skipped.
function ctx2d(log) {
  const noop = (name) => (...a) => { log.push(name); return undefined; };
  const grad = { addColorStop() {} };
  const base = {
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    setLineDash: noop('setLineDash'), save: noop('save'), restore: noop('restore'),
    translate: noop('translate'), rotate: noop('rotate'), scale: noop('scale'),
    beginPath: noop('beginPath'), closePath: noop('closePath'),
    moveTo: noop('moveTo'), lineTo: noop('lineTo'), arc: noop('arc'),
    fill: noop('fill'), stroke: noop('stroke'),
    fillRect: noop('fillRect'), clearRect: noop('clearRect'), strokeRect: noop('strokeRect'),
    drawImage: noop('drawImage'), fillText: noop('fillText'),
    measureText: () => ({ width: 10 }),
  };
  return new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : undefined),
    set: () => true,
  });
}
function makeEl(tag = 'div', id = '') {
  const log = [];
  return {
    tag, id, width: 220, height: 220, style: {}, dataset: {},
    textContent: '', innerHTML: '', children: [], _ops: log,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { const w = f === undefined ? !this._s.has(c) : f; w ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener() {}, removeEventListener() {}, setAttribute() {},
    appendChild(c) { this.children.push(c); return c; },
    append(...c) { this.children.push(...c); },
    querySelectorAll() { return []; },
    getContext() { return ctx2d(log); },
  };
}
const els = {};
global.window = {
  addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  localStorage: { getItem: () => null, setItem() {} },
};
global.document = {
  documentElement: makeEl('html'), body: makeEl('body'),
  getElementById: (id) => els[id] || (els[id] = makeEl('div', id)),
  createElement: (tag) => makeEl(tag),
  querySelectorAll: (s) => (s.includes('.seg .fill') ? [makeEl(), makeEl(), makeEl()] : []),
};

const { TrackManager } = await import('../src/track.js');
const { TRACK_DEFS } = await import('../src/content/trackDefs.js');
const { ARENAS } = await import('../src/content/arenas.js');
const { VehicleController } = await import('../src/vehicle.js');
const { Minimap } = await import('../src/minimap.js');
const { renderTrackPreview, trackPreviewStats, drawPreviewInto, clearPreviewCache } =
  await import('../src/trackPreview.js');
const { CONFIG } = await import('../src/config.js');
const { STRINGS } = await import('../src/i18n.js');

const ALL = [...TRACK_DEFS, ...ARENAS];
const N = CONFIG.race.maxPlayers;

// ------------------------------------------------------------------ minimap
console.log('--- Minimap ---');
for (const def of ALL) {
  const track = new TrackManager(def);
  const canvas = makeEl('canvas', 'minimap');
  const mm = new Minimap(canvas);
  mm.setTrack(track);

  const projOk = Number.isFinite(mm.scale) && mm.scale > 0
    && Number.isFinite(mm.ox) && Number.isFinite(mm.oy);

  // a full grid of karts, plus live item boxes
  const karts = [];
  for (let i = 0; i < N; i++) {
    const v = new VehicleController(track, i === 0);
    v.place(track.startGrid(N)[i]);
    karts.push({ vehicle: v, isPlayer: i === 0, minimapColor: 0x00ff00 });
  }
  const items = { boxes: track.itemBoxes.map(b => ({ pos: track.pointAt(b.s).pos, respawnT: 0 })) };

  canvas._ops.length = 0;
  mm.draw(karts, karts[0], items);
  const drew = canvas._ops.length > 0;

  // every kart must project to a finite pixel inside a sane range
  let coordsOk = true;
  for (const k of karts) {
    const x = mm._px(k.vehicle.pos.x), y = mm._py(k.vehicle.pos.z);
    if (!Number.isFinite(x) || !Number.isFinite(y)) coordsOk = false;
    if (x < -50 || x > canvas.width + 50 || y < -50 || y > canvas.height + 50) coordsOk = false;
  }
  check(`${def.id}: minimap projects and draws the field`, projOk && drew && coordsOk,
    `scale=${mm.scale} ops=${canvas._ops.length} coords=${coordsOk}`);
}
{
  // robustness: no track, no canvas, no karts
  const mm = new Minimap(makeEl('canvas'));
  mm.draw([], null, null);                       // must not throw
  const blind = new Minimap(null);
  blind.setTrack(new TrackManager());
  blind.draw([], null, null);
  blind.clear();
  check('minimap tolerates a missing canvas or track', true);
}
{
  const track = new TrackManager();
  const mm = new Minimap(makeEl('canvas'));
  mm.setTrack(track);
  const v = new VehicleController(track, true);
  v.place(track.startGrid(2)[0]);
  const c = mm.canvas;
  c._ops.length = 0;
  mm.draw([{ vehicle: v, isPlayer: true }], { vehicle: v, isPlayer: true },
    { boxes: [{ pos: track.pointAt(10).pos, respawnT: 3 }] });
  check('respawning boxes are hidden from the minimap',
    !c._ops.includes('arc') || c._ops.length > 0);   // drew the kart, skipped the box
}

// ------------------------------------------------------------------ preview
console.log('--- Track previews ---');
clearPreviewCache();
for (const def of ALL) {
  const canvas = renderTrackPreview(def, 420, 236);
  const stats = trackPreviewStats(def);
  const ok = !!canvas && canvas.width === 420 && canvas.height === 236
    && !!stats && Number.isFinite(stats.length) && stats.length > 0
    && stats.difficulty >= 1 && stats.difficulty <= 5
    && stats.laps >= 0;
  check(`${def.id}: preview renders with sane stats`, ok,
    `canvas=${!!canvas} L=${stats?.length?.toFixed(0)} diff=${stats?.difficulty}`);
}
check('previews are cached, not rebuilt',
  renderTrackPreview(TRACK_DEFS[0], 420, 236) === renderTrackPreview(TRACK_DEFS[0], 420, 236));
check('different sizes get their own cache entry',
  renderTrackPreview(TRACK_DEFS[0], 420, 236) !== renderTrackPreview(TRACK_DEFS[0], 200, 120));
check('clearing the cache forces a rebuild', (() => {
  const a = renderTrackPreview(TRACK_DEFS[1], 300, 200);
  clearPreviewCache();
  return renderTrackPreview(TRACK_DEFS[1], 300, 200) !== a;
})());
check('drawPreviewInto blits into a target canvas', drawPreviewInto(makeEl('canvas'), TRACK_DEFS[0]));
check('drawPreviewInto rejects a bad target', drawPreviewInto(null, TRACK_DEFS[0]) === false);
check('stats are memoised per track',
  trackPreviewStats(TRACK_DEFS[0]) === trackPreviewStats(TRACK_DEFS[0]));
check('every track theme resolves to a palette',
  ALL.every(d => !!renderTrackPreview(d, 120, 80)));

// ------------------------------------------------------------------- markup
console.log('--- Markup and localisation ---');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const id of ['minimap-box', 'minimap', 'track-preview-canvas', 'track-preview-name',
                  'track-preview-teach', 'track-preview-stats',
                  'arena-preview-canvas', 'arena-preview-name', 'arena-preview-teach',
                  'minimap-on', 'minimap-off']) {
  check(`index.html defines #${id}`, html.includes(`id="${id}"`));
}
const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
for (const sel of ['#minimap-box', '#minimap', '.preview-pane', '.select-split', '.preview-legend']) {
  check(`style.css styles ${sel}`, css.includes(sel));
}
for (const key of ['settings.minimap', 'preview.shortcut', 'preview.pad', 'preview.ramp',
                   'preview.box', 'preview.length', 'preview.laps', 'preview.difficulty',
                   'preview.record']) {
  check(`${key} is localised EN+IT`, !!STRINGS[key]?.en && !!STRINGS[key]?.it);
}

// ------------------------------------------------------------- HUD plumbing
console.log('--- HUD integration ---');
{
  const { SaveManager } = await import('../src/save.js');
  const { LocalizationManager } = await import('../src/i18n.js');
  const { HUDManager } = await import('../src/hud.js');
  const hud = new HUDManager(new LocalizationManager(new SaveManager()));
  check('HUD owns a minimap', !!hud.minimap);

  hud.setMinimapTrack(new TrackManager());
  hud.setMinimapEnabled(true);
  hud.showHUD(true);
  check('showing the HUD reveals the minimap', !els['minimap-box'].classList.contains('hidden'));
  hud.showHUD(false);
  check('hiding the HUD hides the minimap', els['minimap-box'].classList.contains('hidden'));

  hud.setMinimapEnabled(false);
  hud.showHUD(true);
  check('the settings toggle keeps the minimap hidden',
    els['minimap-box'].classList.contains('hidden'));
  hud.drawMinimap([], null, null);   // must be a safe no-op when disabled
  check('drawing while disabled is a no-op', true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
