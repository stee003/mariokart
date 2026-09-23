// Increment 6 tests - garage, customization, rival roster and the
// loadout -> physics pipeline.
//
//   * no build in the entire space (character x chassis x wheels) Pareto
//     dominates another build, so there is no "obvious" optimum
//   * garage pages, unlock gating and persistence
//   * rival setups reference real content and stay trade-offs
//   * loadouts actually change physics (measured in a headless simulation)
import { CHARACTERS } from '../src/content/characters.js';
import { CHASSIS } from '../src/content/chassis.js';
import { WHEELS } from '../src/content/wheels.js';
import { PAINTS, DECALS, EXHAUSTS, EFFECTS } from '../src/content/cosmetics.js';
import { RIVAL_SETUPS, getRivalSetup, rivalSpec } from '../src/content/rivals.js';
import {
  STAT_KEYS, combineStats, vehicleParamsFromStats, driftModsFromStats, dominates, validateDeltas,
} from '../src/content/stats.js';
import { buildLoadout, DEFAULT_LOADOUT } from '../src/content/loadout.js';
import {
  Garage, GARAGE_TABS, getTab, entryUnlocked, unlockHint, unlockContext,
  statRows, performanceProfile, loadEquippedSpec, saveEquippedSpec, specSignature,
} from '../src/garage.js';
import { buildRaceRoster, pickRivals, PLAYER_NAME_KEY } from '../src/roster.js';
import { ACHIEVEMENTS } from '../src/achievements.js';
import { CUPS } from '../src/content/cups.js';
import { CONFIG } from '../src/config.js';
import { TrackManager } from '../src/track.js';
import { VehicleController } from '../src/vehicle.js';
import { AIController } from '../src/ai.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

function memSave(initial = {}) {
  const data = { ...initial };
  return {
    get: (k, fb) => (k in data ? data[k] : fb),
    set: (k, v) => { data[k] = v; },
    _data: data,
  };
}

// ------------------------------------------------------------------ balance
console.log('--- Build space: no obvious optimum ---');
const buildPairs = [];
for (const c of CHARACTERS) {
  for (const ch of CHASSIS) {
    for (const w of WHEELS) buildPairs.push({ c, ch, w });
  }
}
check('build space size = 14 x 8 x 12', buildPairs.length === CHARACTERS.length * CHASSIS.length * WHEELS.length,
  `n=${buildPairs.length}`);

// Full pairwise domination scan, grouped by character (stats are combined).
let dominations = 0;
for (const c of CHARACTERS) {
  const eff = [];
  for (const ch of CHASSIS) for (const w of WHEELS) eff.push(combineStats(c.stats, ch.stats, w.stats));
  for (let i = 0; i < eff.length; i++) {
    for (let j = 0; j < eff.length; j++) {
      if (i !== j && dominates(eff[i], eff[j])) dominations++;
    }
  }
}
check('no build dominates another build', dominations === 0, `pairs=${dominations}`);

// Every attribute still has a "best" build and a "worst" build: specialising
// must be possible, otherwise the space would be flat.
for (const k of STAT_KEYS) {
  const values = new Set();
  for (const c of CHARACTERS) for (const ch of CHASSIS) for (const w of WHEELS) {
    values.add(combineStats(c.stats, ch.stats, w.stats)[k]);
  }
  check(`attribute ${k} offers real spread`, values.size >= 5, `distinct=${values.size}`);
}

// Stacking the same strength twice must pay diminishing returns.
const stackBase = combineStats({ acceleration: 5, topSpeed: 5, handling: 5, weight: 5, driftControl: 5, offRoad: 5 },
  { topSpeed: 2 });
const stackTwice = combineStats({ acceleration: 5, topSpeed: 5, handling: 5, weight: 5, driftControl: 5, offRoad: 5 },
  { topSpeed: 2 }, { topSpeed: 2 });
check('second bonus on the same attribute is halved',
  Math.abs((stackTwice.topSpeed - stackBase.topSpeed) - 1) < 1e-9,
  `second bonus=${stackTwice.topSpeed - stackBase.topSpeed}`);
check('penalties always apply in full',
  combineStats({ acceleration: 5, topSpeed: 5, handling: 5, weight: 5, driftControl: 5, offRoad: 5 },
    { topSpeed: -2 }, { topSpeed: -2 }).topSpeed === 1);

let partErrs = [];
for (const p of [...CHASSIS, ...WHEELS]) partErrs = partErrs.concat(validateDeltas(p));
check('all parts still trade-offs after rebalance', partErrs.length === 0, partErrs.join('; '));

// ------------------------------------------------------------------- garage
console.log('--- Garage pages & unlocks ---');
check('seven customization pages', GARAGE_TABS.length === 7, `n=${GARAGE_TABS.length}`);
check('every page maps to a loadout field', GARAGE_TABS.every((t) => t.specKey in DEFAULT_LOADOUT));
check('every page has a localized label', GARAGE_TABS.every((t) => typeof t.labelKey === 'string' && t.labelKey.startsWith('garage.tab.')));
check('page catalogs non-empty', GARAGE_TABS.every((t) => t.items().length > 0));
check('unknown page falls back to the first', getTab('nope').id === GARAGE_TABS[0].id);

const freshSave = memSave({});
const freshCtx = unlockContext(freshSave);
check('fresh save is level 1', freshCtx.level === 1);
check('cup-locked pilot is locked', entryUnlocked(CHARACTERS.find((c) => c.id === 'aurelia'), freshCtx) === false);
check('achievement-locked pilot is locked', entryUnlocked(CHARACTERS.find((c) => c.id === 'umbra'), freshCtx) === false);
check('default pilot unlocked', entryUnlocked(CHARACTERS.find((c) => c.id === 'ember'), freshCtx) === true);
check('level 4 chassis locked at level 1', entryUnlocked(CHASSIS.find((c) => c.id === 'tempest_bolt'), freshCtx) === false);
check('locked hint names the level', (() => {
  const h = unlockHint(CHASSIS.find((c) => c.id === 'tempest_bolt'));
  return h.key === 'garage.lockedLevel' && h.vars.level === 4;
})());
check('locked hints point at a real requirement', (() => {
  const a = unlockHint(CHARACTERS.find((c) => c.id === 'umbra'));
  const cup = unlockHint(CHARACTERS.find((c) => c.id === 'aurelia'));
  const lvl = unlockHint(CHASSIS.find((c) => c.id === 'gearwork_royale'));
  if (!a || !cup || !lvl) return false;
  if (lvl.key !== 'garage.lockedLevel' || lvl.vars.level !== 8) return false;
  const achievementIds = new Set(ACHIEVEMENTS.map((x) => x.id));
  const cupIds = new Set(CUPS.map((x) => x.id));
  return (a.nameKey || achievementIds.has('night_shift')) && (cup.nameKey || cupIds.has('crown'));
})());

// Every unlock rule declared by content must resolve against real content:
// this is the regression guard for "unlockable but impossible to unlock".
const allEntries = [...CHARACTERS, ...CHASSIS, ...WHEELS, ...PAINTS, ...DECALS, ...EXHAUSTS, ...EFFECTS];
const achievementIds = new Set(ACHIEVEMENTS.map((a) => a.id));
const cupIds = new Set(CUPS.map((c) => c.id));
check('every achievement unlock names a real achievement', allEntries.every((e) =>
  e.unlock?.type !== 'achievement' || achievementIds.has(e.unlock.achievementId)),
  JSON.stringify(allEntries.filter((e) => e.unlock?.type === 'achievement' && !achievementIds.has(e.unlock.achievementId)).map((e) => e.id)));
check('every cup unlock names a real cup', allEntries.every((e) =>
  e.unlock?.type !== 'cup' || cupIds.has(e.unlock.cupId)));
check('every level unlock is inside the level curve', allEntries.every((e) =>
  e.unlock?.type !== 'level' || (e.unlock.level >= 2 && e.unlock.level <= 40)));

const richSave = memSave({
  xp: 99999,
  trophies: Object.fromEntries([...cupIds].map((id) => [id, 'platinum'])),
  achievements: [...achievementIds],
  stats: { itemsTaken: 500 },
});
const richCtx = unlockContext(richSave);
check('a maxed save unlocks every single item',
  allEntries.every((e) => entryUnlocked(e, richCtx)),
  JSON.stringify(allEntries.filter((e) => !entryUnlocked(e, richCtx)).map((e) => e.id)));
check('bronze is not enough for a gold requirement', (() => {
  const ctx = { level: 1, trophies: { crown: 'bronze' }, achievements: new Set() };
  return entryUnlocked({ unlock: { type: 'cup', cupId: 'crown', minTrophy: 'gold' } }, ctx) === false;
})());

// ------------------------------------------------------------------ session
console.log('--- Garage session ---');
const save = memSave({ xp: 1200 });   // level ~4
const garage = new Garage(save, { rng: (() => { let s = 5; return () => (s = (s * 1103515245 + 12345) % 2147483647) / 2147483647; })() });
check('starts from the default build', garage.signature === specSignature(DEFAULT_LOADOUT));
check('items report equipped state', garage.items('chassis').filter((i) => i.equipped).length === 1);
check('locked items are flagged, not selectable', (() => {
  const locked = garage.items('chassis').find((i) => !i.unlocked);
  if (!locked) return false;
  const before = garage.signature;
  const ok = garage.select('chassis', locked.id) === false;
  return ok && garage.signature === before;
})());
check('selecting equips and persists', (() => {
  const target = garage.items('wheels').find((i) => i.unlocked && !i.equipped);
  if (!target) return false;
  const ok = garage.select('wheels', target.id);
  return ok && save.get('loadout').wheelId === target.id && garage.loadout.wheels.id === target.id;
})());
check('unknown item is refused', garage.select('wheels', 'not-a-wheel') === false);
check('randomize stays inside unlocked content', (() => {
  garage.randomize();
  const spec = garage.spec;
  const byTab = { pilot: 'characterId', chassis: 'chassisId', wheels: 'wheelId', paint: 'paintId', decal: 'decalId', exhaust: 'exhaustId', effect: 'effectId' };
  return Object.entries(byTab).every(([tab, key]) => garage.unlockedIds(tab).includes(spec[key]));
})());
check('reset returns to stock', (() => {
  garage.reset();
  return garage.signature === specSignature(DEFAULT_LOADOUT) && save.get('loadout').chassisId === DEFAULT_LOADOUT.chassisId;
})());
check('loadout spec survives a save/load round trip', (() => {
  const build = { ...DEFAULT_LOADOUT, chassisId: 'rockjaw', wheelId: 'dune_rollers', paintId: 'forest_moss' };
  saveEquippedSpec(save, build);
  const back = loadEquippedSpec(save);
  return back.chassisId === 'rockjaw' && back.wheelId === 'dune_rollers' && back.paintId === 'forest_moss';
})());
check('a corrupt save is sanitized to real ids', (() => {
  save.set('loadout', { characterId: 'ghost', chassisId: 'nope', wheelId: 42 });
  const clean = loadEquippedSpec(save);
  const sanitized = saveEquippedSpec(save, clean);
  return CHARACTERS.some((c) => c.id === sanitized.characterId)
    && CHASSIS.some((c) => c.id === sanitized.chassisId)
    && WHEELS.some((w) => w.id === sanitized.wheelId);
})());

// ------------------------------------------------------------------ previews
console.log('--- Stat & performance preview ---');
const garage2 = new Garage(memSave({ xp: 99999 }));
check('stat rows cover all six attributes', statRows(DEFAULT_LOADOUT).length === 6);
check('stat rows show the delta against another build', (() => {
  const rows = statRows({ ...DEFAULT_LOADOUT, chassisId: 'ironclad_hauler' }, DEFAULT_LOADOUT);
  const top = rows.find((r) => r.key === 'topSpeed');
  const accel = rows.find((r) => r.key === 'acceleration');
  return top.delta > 0 && accel.delta < 0;
})());
check('leaving the build untouched shows zero deltas',
  garage2.statRows().every((r) => r.delta === 0));
check('performance preview has all rows', performanceProfile(buildLoadout(DEFAULT_LOADOUT)).length === 7);
check('performance preview trades speed for launch (and says so)', (() => {
  const fast = performanceProfile(buildLoadout({ characterId: 'nova', chassisId: 'tempest_bolt', wheelId: 'chrome_halos' }));
  const quick = performanceProfile(buildLoadout({ characterId: 'volt', chassisId: 'featherwing', wheelId: 'slick_comets' }));
  const pick = (p, id) => p.find((r) => r.id === id).value;
  return pick(fast, 'topSpeed') > pick(quick, 'topSpeed')
    && pick(fast, 'accel') > pick(quick, 'accel')       // seconds to 100: higher = slower
    && pick(fast, 'offRoad') <= pick(quick, 'offRoad');
})());
check('performance preview reports mass', (() => {
  const heavy = performanceProfile(buildLoadout({ characterId: 'bastion', chassisId: 'ironclad_hauler', wheelId: 'iron_drums' }));
  const light = performanceProfile(buildLoadout({ characterId: 'thistle', chassisId: 'featherwing', wheelId: 'slick_comets' }));
  const pick = (p, id) => p.find((r) => r.id === id).value;
  return pick(heavy, 'mass') > pick(light, 'mass');
})());
check('performance preview uses real config values', (() => {
  const rows = performanceProfile(buildLoadout(DEFAULT_LOADOUT));
  const top = rows.find((r) => r.id === 'topSpeed');
  return Math.abs(top.value - CONFIG.vehicle.maxSpeed * 3.6) <= 3;
})());

// -------------------------------------------------------------------- rivals
console.log('--- Rival roster ---');
check('every character has a rival setup', CHARACTERS.every((c) => !!RIVAL_SETUPS[c.id]));
check('rival setups reference real parts', (() => {
  const ids = {
    chassis: new Set(CHASSIS.map((c) => c.id)),
    wheels: new Set(WHEELS.map((w) => w.id)),
    paint: new Set(PAINTS.map((p) => p.id)),
    decal: new Set(DECALS.map((d) => d.id)),
    exhaust: new Set(EXHAUSTS.map((e) => e.id)),
    effect: new Set(EFFECTS.map((e) => e.id)),
  };
  return Object.values(RIVAL_SETUPS).every((s) =>
    ids.chassis.has(s.chassisId) && ids.wheels.has(s.wheelId) && ids.paint.has(s.paintId)
    && ids.decal.has(s.decalId) && ids.exhaust.has(s.exhaustId) && ids.effect.has(s.effectId));
})());
check('rival personalities all exist in config', Object.values(RIVAL_SETUPS)
  .every((s) => !!CONFIG.ai.personalities[s.personality]));
check('rival chassis + wheels are trade-offs', Object.entries(RIVAL_SETUPS).every(([, s]) => {
  const ch = CHASSIS.find((c) => c.id === s.chassisId);
  const wh = WHEELS.find((w) => w.id === s.wheelId);
  return validateDeltas(ch).length === 0 && validateDeltas(wh).length === 0;
}));

// Every personality is a style, never a speed upgrade.
const baseline = CONFIG.ai.personalities.aggressive;
for (const [key, p] of Object.entries(CONFIG.ai.personalities)) {
  check(`personality ${key} has no speed cheat`,
    p.targetSpeed <= baseline.targetSpeed + 1e-9 && p.cornerSpeed <= baseline.cornerSpeed + 1e-9,
    `target=${p.targetSpeed} corner=${p.cornerSpeed}`);
}
check('personalities stay spread out (not reskins)', (() => {
  const keys = Object.keys(CONFIG.ai.personalities);
  const sigs = new Set(keys.map((k) => {
    const p = CONFIG.ai.personalities[k];
    return `${p.aggression}|${p.blockiness}|${p.mistakeRate}|${p.driftEagerness}`;
  }));
  return sigs.size === keys.length;
})());

console.log('--- Roster construction ---');
const seedRng = () => { let s = 42; return () => (s = (s * 1103515245 + 12345) % 2147483647) / 2147483647; };
const roster = buildRaceRoster({ playerSpec: { ...DEFAULT_LOADOUT, characterId: 'thistle' }, rivals: 3, rng: seedRng() });
check('roster = player + rivals', roster.length === 4 && roster[0].isPlayer === true);
check('player entry keeps the ai.you name key', roster[0].nameKey === PLAYER_NAME_KEY);
check('player drives the garage build', roster[0].loadout.character.id === 'thistle');
check('rivals are distinct characters and never the player', (() => {
  const ids = roster.slice(1).map((r) => r.characterId);
  return new Set(ids).size === 3 && !ids.includes('thistle');
})());
check('roster is deterministic for a seeded rng', (() => {
  const a = buildRaceRoster({ playerSpec: DEFAULT_LOADOUT, rivals: 3, rng: seedRng() }).map((e) => e.characterId);
  const b = buildRaceRoster({ playerSpec: DEFAULT_LOADOUT, rivals: 3, rng: seedRng() }).map((e) => e.characterId);
  return JSON.stringify(a) === JSON.stringify(b);
})());
check('solo roster has only the player', buildRaceRoster({ rivals: 0 }).length === 1);
check('pickRivals caps at the pool size', pickRivals(99).length === CHARACTERS.length);
check('every roster entry builds a full loadout', roster.every((e) => !!e.loadout.params && !!e.loadout.visual.bodyColor));

// ------------------------------------------------- loadout -> physics proof
console.log('--- Loadouts change the driving ---');
// `line` = full throttle down the racing line (no target-speed limiting), so
// the kart reaches its OWN top speed on the straights; the AI run is capped by
// the line's speed profile and cannot tell two builds apart on raw speed.
function drive(spec, seconds = 22, mode = 'ai') {
  const track = new TrackManager();
  const loadout = buildLoadout(spec);
  const v = new VehicleController(track, false, loadout.params, loadout.driftMods);
  v.place(track.startGrid()[0]);
  const ai = new AIController(v, track, 'balanced');
  ai.setDifficulty('normal');
  let maxSpeed = 0, distance = 0;
  const dt = 1 / 60;
  let px = v.pos.x, pz = v.pos.z;
  for (let i = 0; i < seconds * 60; i++) {
    let input;
    if (mode === 'line') {
      const s = v.surf.progress;
      const look = 6 * Math.max(0.4, v.speedAbs / 20);
      const p = track.pointAt(s + look);
      const lat = track.lineAt(s + look).prefLat;
      const tx = p.pos.x + p.right.x * lat;
      const tz = p.pos.z + p.right.z * lat;
      const desired = Math.atan2(tx - v.pos.x, tz - v.pos.z);
      const diff = Math.atan2(Math.sin(desired - v.yaw), Math.cos(desired - v.yaw));
      input = {
        throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, diff * 1.6)),
        drift: false, trick: false, item: false,
      };
    } else {
      input = ai.update(dt, [{ vehicle: v }], true, null);
    }
    v.step(dt, input, false);
    maxSpeed = Math.max(maxSpeed, v.speedAbs);
    distance += Math.hypot(v.pos.x - px, v.pos.z - pz);
    px = v.pos.x; pz = v.pos.z;
  }
  return { maxSpeed, distance, loadout };
}
const speedSpec = { characterId: 'nova', chassisId: 'tempest_bolt', wheelId: 'chrome_halos', paintId: 'sunset_orange', decalId: 'none', exhaustId: 'twin_pipes', effectId: 'classic_flame' };
const heavySpec = { characterId: 'cinder', chassisId: 'ironclad_hauler', wheelId: 'iron_drums', paintId: 'ember_red', decalId: 'none', exhaustId: 'twin_pipes', effectId: 'classic_flame' };
const speedRun = drive(speedSpec, 22);                 // AI lap: distance + feel
const heavyRun = drive(heavySpec, 22);
const speedTop = drive(speedSpec, 26, 'line');         // physics: top speed
const heavyTop = drive(heavySpec, 26, 'line');
check('speed build reaches a higher top speed than the heavy build',
  speedTop.maxSpeed > heavyTop.maxSpeed + 0.5,
  `speed=${(speedTop.maxSpeed * 3.6).toFixed(1)} heavy=${(heavyTop.maxSpeed * 3.6).toFixed(1)} km/h`);
check('heavy build is not simply worse (it covers comparable ground)',
  heavyRun.distance > speedRun.distance * 0.9,
  `heavy=${heavyRun.distance.toFixed(1)}m speed=${speedRun.distance.toFixed(1)}m`);
const quickSpec = { characterId: 'volt', chassisId: 'featherwing', wheelId: 'slick_comets', paintId: 'storm_yellow', decalId: 'none', exhaustId: 'twin_pipes', effectId: 'classic_flame' };
check('every stat pair moves the physics in both directions', (() => {
  const a = buildLoadout(speedSpec).params;
  const b = buildLoadout(quickSpec).params;
  const c = buildLoadout(heavySpec).params;
  return a.maxSpeed > b.maxSpeed && a.maxSpeed > c.maxSpeed
    && b.accel > a.accel && b.accel > c.accel
    && c.massFactor > b.massFactor && c.massFactor > a.massFactor;
})());

// Measured, not just read from the params: the quicker build pulls away from
// a standing start, the heavier one shrugs off a side impact (massFactor).
function launch(spec, seconds = 4) {
  const track = new TrackManager();
  const loadout = buildLoadout(spec);
  const v = new VehicleController(track, false, loadout.params, loadout.driftMods);
  v.place(track.startGrid()[0]);
  const ai = new AIController(v, track, 'balanced');
  ai.setDifficulty('normal');
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) v.step(dt, ai.update(dt, [{ vehicle: v }], true, null), false);
  return v.speedAbs;
}
check('quick build is faster off the line than the heavy build',
  launch(quickSpec) > launch(heavySpec) + 0.5,
  `quick=${launch(quickSpec).toFixed(2)} heavy=${launch(heavySpec).toFixed(2)} m/s`);
check('drift control changes the drift modifiers', (() => {
  const high = driftModsFromStats(combineStats({ driftControl: 9, acceleration: 5, topSpeed: 5, handling: 5, weight: 5, offRoad: 5 }));
  const low = driftModsFromStats(combineStats({ driftControl: 2, acceleration: 5, topSpeed: 5, handling: 5, weight: 5, offRoad: 5 }));
  return high.gripMult > low.gripMult && high.chargeRate > low.chargeRate;
})());
check('off-road stat reaches the physics', (() => {
  const rough = vehicleParamsFromStats(combineStats({ offRoad: 9, acceleration: 5, topSpeed: 5, handling: 5, weight: 5, driftControl: 5 }));
  const road = vehicleParamsFromStats(combineStats({ offRoad: 2, acceleration: 5, topSpeed: 5, handling: 5, weight: 5, driftControl: 5 }));
  return rough.offTrackMaxSpeed > road.offTrackMaxSpeed && rough.offTrackDrag < road.offTrackDrag;
})());
check('params never escape arcade bounds', (() => {
  for (const c of CHARACTERS) for (const ch of CHASSIS) for (const w of WHEELS) {
    const p = buildLoadout({ characterId: c.id, chassisId: ch.id, wheelId: w.id }).params;
    if (p.maxSpeed > CONFIG.vehicle.maxSpeed * 1.25 || p.maxSpeed < CONFIG.vehicle.maxSpeed * 0.8) return false;
    if (p.accel > CONFIG.vehicle.accel * 1.35 || p.accel < CONFIG.vehicle.accel * 0.7) return false;
    if (p.massFactor < 0.7 || p.massFactor > 1.4) return false;
  }
  return true;
})());

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
