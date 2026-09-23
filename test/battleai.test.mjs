// Increment 8 tests - arena AI, capture-zone visuals and the battle HUD data.
//
//   * chooseObjective() picks the right thing to do for every battle mode
//   * BattleAI drives with the same input contract + physics as the player
//   * a headless arena run actually scores (cores collected, zones captured)
//   * zone state -> colour/fill mapping (no WebGL needed)
import { ARENAS, enforceArenaWalls } from '../src/content/arenas.js';
import { BATTLE_MODES, BattleManager } from '../src/battle.js';
import { BattleAI, chooseObjective } from '../src/battleAI.js';
import { zoneVisualState, ZONE_NEUTRAL, ZONE_PLAYER } from '../src/battleFX.js';
import { TrackManager } from '../src/track.js';
import { VehicleController } from '../src/vehicle.js';
import { ItemSystem } from '../src/items.js';
import { CONFIG } from '../src/config.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

const stubAudio = {
  collision() {}, boost() {}, pad() {}, countBeep() {}, driftLevelUp() {}, landing() {},
  itemSound() {}, finish() {}, reset() {}, trick() {}, vocalize() {},
};
const stubI18n = { t: (k) => k };

// ------------------------------------------------------------ chooseObjective
console.log('--- Objective selection ---');
const selfKart = { isPlayer: false, id: 'self' };
const self = { kart: selfKart, pos: { x: 0, z: 0 }, cores: 2, hp: 3 };
const boxNear = { pos: { x: 5, z: 0 } };
const boxFar = { pos: { x: 60, z: 0 } };
const other = (id, x, z, extra = {}) => ({
  kart: { isPlayer: false, id }, pos: { x, z }, eliminated: false, hp: 3, cores: 0, ...extra,
});

check('energy: takes the closest crate',
  chooseObjective('energy', self, [other('a', 40, 0)], { boxes: [boxFar, boxNear] }).kind === 'box');
check('energy: intercepts the leader when no crates are up', (() => {
  const o = chooseObjective('energy', self, [other('a', 10, 0, { cores: 5 }), other('b', 30, 0, { cores: 2 })], { boxes: [] });
  return o.kind === 'hunt' && o.reason === 'leader' && o.target.x === 10;
})());
check('elimination: hunts the weakest rival, not just the nearest', (() => {
  const o = chooseObjective('elimination', self, [
    other('a', 8, 0, { hp: 3 }), other('b', 22, 0, { hp: 1 }),
  ], { boxes: [] });
  return o.kind === 'hunt' && o.target.x === 22;
})());
check('elimination: grabs a crate that is clearly closer than the fight', (() => {
  const o = chooseObjective('elimination', self, [other('a', 40, 0, { hp: 1 })], { boxes: [{ pos: { x: 6, z: 0 } }] });
  return o.kind === 'box';
})());
check('survival: flees from a nearby threat', (() => {
  const o = chooseObjective('survival', self, [other('a', 9, 0)], { boxes: [] });
  return o.kind === 'flee' && o.target.x < 0;
})());
check('survival: collects crates when nobody is close', (() => {
  const o = chooseObjective('survival', self, [other('a', 70, 0)], { boxes: [boxNear] });
  return o.kind === 'box';
})());
check('zones: captures a zone it does not own', (() => {
  const zones = [
    { pos: { x: 10, z: 0 }, owner: null, progress: 0 },
    { pos: { x: 40, z: 0 }, owner: null, progress: 0 },
  ];
  const o = chooseObjective('zones', self, [other('a', 5, 5)], { zones });
  return o.kind === 'zone' && o.target.x === 10 && o.reason === 'capture';
})());
check('zones: defends a zone a rival is taking from us', (() => {
  const rival = other('a', 26, 0);
  const zones = [
    { pos: { x: 5, z: 0 }, owner: null, progress: 0 },
    { pos: { x: 26, z: 0 }, owner: selfKart, progress: 0.4, contestedBy: rival },
  ];
  const o = chooseObjective('zones', self, [rival], { zones });
  return o.reason === 'defend' && o.target.x === 26;
})());
check('zones: holds an owned zone when the next one is far', (() => {
  const mine = { pos: { x: 4, z: 0 }, owner: selfKart, progress: 1 };
  const far = { pos: { x: 120, z: 0 }, owner: null, progress: 0 };
  const o = chooseObjective('zones', self, [other('b', 60, 0)], { zones: [mine, far] });
  return o.reason === 'hold' && o.target.x === 4;
})());
check('zones: expands to a nearby free zone', (() => {
  const mine = { pos: { x: 4, z: 0 }, owner: selfKart, progress: 1 };
  const near = { pos: { x: 18, z: 0 }, owner: null, progress: 0 };
  const o = chooseObjective('zones', self, [other('b', 60, 0)], { zones: [mine, near] });
  return o.reason === 'capture' && o.target.x === 18;
})());
check('dead rivals are ignored', (() => {
  const o = chooseObjective('elimination', self, [
    other('a', 2, 0, { hp: 1, eliminated: true }), other('b', 26, 0, { hp: 3 }),
  ], { boxes: [] });
  return o.target.x === 26;
})());
check('falls back to patrol with nothing to do',
  chooseObjective('score', self, [], { boxes: [], zones: [] }).kind === 'patrol');

// ------------------------------------------------------------- battle AI live
console.log('--- Arena drivers (headless) ---');
const arena = ARENAS[0];

function makeArena(defId) {
  const def = ARENAS.find((a) => a.id === defId) || arena;
  const track = new TrackManager(def);
  return { def, track };
}

// Deterministic runs: arena AI is stochastic (reaction rolls, mistakes), so
// the test seeds Math.random for the duration of the simulated race.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function arenaRun(modeId, arenaId = 'ember_forge', seconds = 45, seed = 20250923) {
  const savedRandom = Math.random;
  Math.random = mulberry32(seed + modeId.length * 7919);
  try {
    return arenaRunInner(modeId, arenaId, seconds);
  } finally {
    Math.random = savedRandom;
  }
}

function arenaRunInner(modeId, arenaId, seconds) {
  const { def, track } = makeArena(arenaId);
  const karts = [];
  const boxDefs = track.itemBoxes;
  for (let i = 0; i < 4; i++) {
    const v = new VehicleController(track, i === 0, null, null);
    const grid = track.startGrid();
    v.place(grid[i % grid.length]);
    karts.push({ vehicle: v, nameKey: `pilot${i}`, isPlayer: i === 0, characterId: 'ember' });
  }
  // Mirror main.js: ItemSystem events feed the battle manager.
  let battle = null;
  const items = new ItemSystem({
    track,
    onEvent: (type, payload) => {
      if (!battle) return;
      if (type === 'boxPickup' && payload.kart) battle.boxPicked(payload.kart);
      else if (type === 'itemHit') battle.hitLanded(payload.attacker || null, payload.victim);
    },
    audio: stubAudio,
    i18n: stubI18n,
  });
  items.setBoxes(boxDefs);
  battle = new BattleManager({ track, modeId, karts, onEvent: () => {} });
  const ais = karts.map((k, i) => (i === 0 ? null : new BattleAI(k.vehicle, track, ['aggressive', 'balanced', 'technical', 'guardian'][i % 4])));
  for (const ai of ais) if (ai) ai.setDifficulty('normal');

  const dt = 1 / 60;
  let travelled = 0, maxSpeed = 0;
  for (let step = 0; step < seconds * 60 && battle.state !== 'over'; step++) {
    battle.update(dt);
    for (const kart of karts) {
      const st = battle.per.get(kart);
      const ai = ais[karts.indexOf(kart)];
      let input = { throttle: 0, brake: 0, steer: 0, drift: false, trick: false, item: false };
      if (battle.state === 'running' && !st.eliminated && ai) {
        input = ai.update(dt, karts, battle, items, def);
        if (!Number.isFinite(input.steer) || !Number.isFinite(input.throttle)) return { bad: true };
        if (input.throttle > 1 || input.steer < -1 || input.steer > 1) return { bad: true };
      }
      const px = kart.vehicle.pos.x, pz = kart.vehicle.pos.z;
      kart.vehicle.step(dt, input, false);
      enforceArenaWalls(def, kart.vehicle);
      if (battle.state === 'running' && input.item) items.useItem(kart, karts);
      if (ai && battle.state === 'running' && !st.eliminated) {
        travelled += Math.hypot(kart.vehicle.pos.x - px, kart.vehicle.pos.z - pz);
        maxSpeed = Math.max(maxSpeed, kart.vehicle.speedAbs);
      }
    }
    if (battle.state === 'running') items.update(dt, karts, battle.time);
    track.update(dt, 0);
  }
  return { battle, karts, items, travelled, maxSpeed, def };
}

check('energy: arena AI actually banks cores', (() => {
  const run = arenaRun('energy');
  const cores = [...run.battle.per.values()].reduce((a, s) => a + s.cores, 0);
  return cores > 0;
})());
check('zones: arena AI captures at least one zone', (() => {
  const run = arenaRun('zones', 'ember_forge', 60);
  const owned = run.battle.zones.filter((z) => z.owner !== null).length;
  return owned > 0;
}, (() => {
  const run = arenaRun('zones', 'ember_forge', 60);
  return JSON.stringify(run.battle.zones.map((z) => Number(z.progress.toFixed(2))));
})()));
check('score/elimination: arena AI lands hits on each other', (() => {
  const run = arenaRun('score', 'neon_plaza', 60);
  const scored = [...run.battle.per.values()].some((s) => s.score > 0) || run.battle.finished;
  return scored;
})());
check('arena AI never produces illegal input', (() => {
  for (const mode of ['energy', 'elimination', 'zones', 'survival', 'score']) {
    const run = arenaRun(mode, 'cryo_hall', 12);
    if (run.bad) return false;
  }
  return true;
})());
check('arena AI actually drives (covers ground)', (() => {
  const run = arenaRun('survival', 'sky_atoll', 20);
  return run.travelled > 200 && run.maxSpeed > 8;
})());
check('arena AI keeps the kart inside the arena', (() => {
  const run = arenaRun('zones', 'ember_forge', 30);
  return run.karts.every((k) => Math.hypot(k.vehicle.pos.x, k.vehicle.pos.z) <= run.def.arenaRadius + 0.5);
})());
check('arena AI uses stock physics (no hidden speed cheats)', (() => {
  const run = arenaRun('energy', 'ember_forge', 10);
  return run.karts.every((k) => k.vehicle.params === CONFIG.vehicle)
    && run.maxSpeed <= CONFIG.vehicle.maxSpeed * 1.5;
})());

// --------------------------------------------------------------- zone visuals
console.log('--- Capture-zone visuals ---');
const player = { isPlayer: true, nameKey: 'ai.you' };
const rivalA = { isPlayer: false, nameKey: 'char.cinder' };
const rivalB = { isPlayer: false, nameKey: 'char.zephyr' };
const karts = [player, rivalA, rivalB];

check('neutral zone reads grey with no fill', (() => {
  const v = zoneVisualState({ owner: null, progress: 0, contestedBy: null }, karts, 0);
  return v.color === ZONE_NEUTRAL && v.fill === 0 && !v.capturing;
})());
check('a half-captured neutral zone fills up', (() => {
  const v = zoneVisualState({ owner: null, progress: 0.5, contestedBy: player }, karts, 0);
  return Math.abs(v.fill - 0.5) < 1e-9 && v.capturing === true;
})());
check('player-owned zones use the player colour', (() => {
  const v = zoneVisualState({ owner: player, progress: 1, contestedBy: null }, karts, 0);
  return v.color === ZONE_PLAYER && v.fill === 1 && v.alpha > 0.5;
})());
check('each rival gets its own colour', (() => {
  const a = zoneVisualState({ owner: rivalA, progress: 1 }, karts, 0).color;
  const b = zoneVisualState({ owner: rivalB, progress: 1 }, karts, 0).color;
  return a !== b && a !== ZONE_PLAYER && b !== ZONE_PLAYER;
})());
check('contested zones pulse faster than held ones', (() => {
  const held = [];
  const contested = [];
  for (let i = 0; i < 40; i++) {
    held.push(zoneVisualState({ owner: player, progress: 1 }, karts, i * 0.05).pulse);
    contested.push(zoneVisualState({ owner: null, progress: 0.4, contestedBy: rivalA }, karts, i * 0.05).pulse);
  }
  const swing = (a) => Math.max(...a) - Math.min(...a);
  return swing(held) > 0.5 && swing(contested) > 0.5;
})());
const summaryProblems = [];
{
  const { track } = makeArena('ember_forge');
  for (const mode of BATTLE_MODES) {
    const karts2 = [{ vehicle: new VehicleController(track, true), nameKey: 'p', isPlayer: true }];
    const b = new BattleManager({ track, modeId: mode.id, karts: karts2, onEvent: () => {} });
    const info = b.hudInfo();
    if (!('hp' in info)) summaryProblems.push(`${mode.id}:no-hp`);
    if (mode.id === 'zones' && (info.zonesTotal !== 3 || typeof info.zonesHeld !== 'number')) {
      summaryProblems.push(`${mode.id}:zones ${JSON.stringify(info)}`);
    }
  }
}
check('battle modes all have a hud summary', summaryProblems.length === 0, summaryProblems.join(', '));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
