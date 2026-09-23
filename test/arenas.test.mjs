// Battle arenas: every arena def must build through the untouched track
// pipeline and themed renderer, stay drivable (disc containment, no NaN),
// and integrate with BattleManager zones on the real track geometry.
import * as THREE from '../lib/three.module.js';

// ---------------------------------------------------------------- DOM stubs
function fake2D() {
  const grad = { addColorStop() {} };
  return {
    createRadialGradient: () => grad, createLinearGradient: () => grad,
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() {}, fillText() {}, fillStyle: '', font: '', textAlign: '', textBaseline: '',
  };
}
function makeElement(id) {
  return {
    id, children: [], style: {}, dataset: {}, textContent: '', innerHTML: '',
    value: '0', offsetWidth: 100, width: 100, height: 100,
    classList: { _set: new Set(), add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      toggle(c, f) { if (f === undefined) this._set.has(c) ? this._set.delete(c) : this._set.add(c); else f ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); } },
    addEventListener() {}, removeEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    append(...items) { this.children.push(...items); },
    querySelectorAll() { return []; },
    getContext() { return fake2D(); },
  };
}
const elements = {};
global.window = { addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  localStorage: { getItem: () => null, setItem() {} } };
global.document = {
  getElementById(id) { return elements[id] || (elements[id] = makeElement(id)); },
  createElement() { return makeElement('x'); },
  querySelectorAll() { return []; },
  body: makeElement('body'),
};

const { ARENAS, getArena, enforceArenaWalls } = await import('../src/content/arenas.js');
const { TrackManager } = await import('../src/track.js');
const { buildThemedEnvironment } = await import('../src/environment2.js');
const { VehicleController } = await import('../src/vehicle.js');
const { BattleManager } = await import('../src/battle.js');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

check('4 arenas defined', ARENAS.length === 4);
check('arena ids unique', new Set(ARENAS.map((a) => a.id)).size === 4);
check('getArena falls back', getArena('nope').id === ARENAS[0].id);

const tracks = new Map();
for (const def of ARENAS) {
  const track = new TrackManager(def);
  tracks.set(def.id, track);
  const scene = new THREE.Scene();
  const env = buildThemedEnvironment(scene, track, 'ARENA');
  const kids = env.group.children.length;
  check(`${def.id}: themed world populated (${kids} nodes)`, kids > 30, `children=${kids}`);
  check(`${def.id}: checkpoints built`, track.checkpoints.length === 4);
  check(`${def.id}: item boxes scattered`, track.itemBoxes.length >= 12, `boxes=${track.itemBoxes.length}`);

  // drivability: full-throttle circle for 6 simulated seconds
  const v = new VehicleController(track, true);
  v.place(track.startGrid()[3]);
  const input = { throttle: 1, brake: 0, steer: 0.35, drift: false, trick: false };
  for (let i = 0; i < 360; i++) {
    v.step(1 / 60, input, false);
    enforceArenaWalls(def, v);
    track.update(1 / 60, i / 60);
  }
  check(`${def.id}: drivable without NaN`,
    Number.isFinite(v.pos.x) && Number.isFinite(v.pos.y) && Number.isFinite(v.pos.z) && !!v.surf);
  const r = Math.hypot(v.pos.x, v.pos.z);
  check(`${def.id}: arena wall contains the kart (r=${r.toFixed(1)})`, r <= def.arenaRadius + 0.01);

  // obstacle sim sync
  track.update(0.016, 1);
  const colliders = track.getObstacleColliders();
  if ((def.obstacles || []).length) {
    check(`${def.id}: obstacle colliders active`, colliders.length > 0, `n=${colliders.length}`);
  }
  env.state.update(0.016, 1);
}

// BattleManager zones on a real arena
{
  const track = tracks.get('neon_plaza');
  const karts = [0, 1, 2, 3].map((i) => ({
    nameKey: `k${i}`, isPlayer: i === 0,
    vehicle: { pos: track.pointAt(0.125 * track.L + i * 2).pos.clone() },
  }));
  // only kart 1 near the first zone
  const z0 = track.pointAt(0.125 * track.L).pos;
  karts[1].vehicle.pos.set(z0.x + 1, 0, z0.z);
  karts[0].vehicle.pos.set(z0.x + 80, 0, z0.z);
  karts[2].vehicle.pos.set(z0.x - 80, 0, z0.z);
  karts[3].vehicle.pos.set(z0.x, 0, z0.z + 80);
  const battle = new BattleManager({ track, modeId: 'zones', karts });
  for (let i = 0; i < 60; i++) battle.update(0.1);   // past countdown + capture
  check('zones mode captures on real arena geometry', battle.zones[0].owner === karts[1]);
}

// energy battle over item boxes placement sanity
{
  const track = tracks.get('ember_forge');
  check('ember_forge has flamejets', track.obstacles.some((o) => o.type === 'flamejet'));
}
{
  const track = tracks.get('sky_atoll');
  check('sky_atoll low-gravity zone covers arena', track.zones.length === 1 && track.zones[0].type === 'lowgrav');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
