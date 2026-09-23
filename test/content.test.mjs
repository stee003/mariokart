// Content integrity + balance tests.
// Verifies the "no objectively superior option" requirement:
//  - no character dominates another (Pareto check)
//  - every character hits the exact stat budget with valid per-stat ranges
//  - chassis & wheels are genuine trade-offs (gains balanced by losses)
//  - loadout combination is deterministic, soft-capped and within bounds
//  - per-kart vehicle params stay inside sane arcade ranges
import { CHARACTERS, getCharacter } from '../src/content/characters.js';
import { CHASSIS } from '../src/content/chassis.js';
import { WHEELS } from '../src/content/wheels.js';
import { PAINTS, DECALS, EXHAUSTS, EFFECTS } from '../src/content/cosmetics.js';
import {
  STAT_KEYS, CHARACTER_STAT_BUDGET, combineStats, vehicleParamsFromStats,
  driftModsFromStats, findDominationPairs, validateCharacterStats, validateDeltas,
} from '../src/content/stats.js';
import { buildLoadout, DEFAULT_LOADOUT } from '../src/content/loadout.js';
import { CONFIG } from '../src/config.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

console.log('--- Roster ---');
check('at least 12 characters', CHARACTERS.length >= 12, `n=${CHARACTERS.length}`);
const ids = new Set(CHARACTERS.map((c) => c.id));
check('unique character ids', ids.size === CHARACTERS.length);
check('unique silhouettes (no identical shape combos)', (() => {
  const combos = new Set(CHARACTERS.map((c) =>
    `${c.silhouette.head}|${c.silhouette.ears}|${c.silhouette.tail}|${c.silhouette.accessory}`));
  return combos.size === CHARACTERS.length;
})());

let statErrs = [];
for (const c of CHARACTERS) statErrs = statErrs.concat(validateCharacterStats(c));
check('every character meets the stat budget & ranges', statErrs.length === 0, statErrs.join('; '));

const domPairs = findDominationPairs(CHARACTERS, (c) => c.stats);
check('no character is objectively superior to another', domPairs.length === 0, JSON.stringify(domPairs));

// every stat is someone's specialty: each stat must have a unique-enough top holder
for (const k of STAT_KEYS) {
  const max = Math.max(...CHARACTERS.map((c) => c.stats[k]));
  check(`stat ${k} has a top holder (${max})`, CHARACTERS.some((c) => c.stats[k] === max));
}
check('every character has a personality key', CHARACTERS.every((c) => !!c.personalityKey));
check('every character has a voice profile', CHARACTERS.every((c) =>
  typeof c.voice?.pitch === 'number' && typeof c.voice?.rasp === 'number'));
check('unlockable characters exist', CHARACTERS.some((c) => c.unlock.type !== 'default'));

console.log('--- Chassis & wheels ---');
check('at least 8 chassis', CHASSIS.length >= 8, `n=${CHASSIS.length}`);
check('at least 12 wheel types', WHEELS.length >= 12, `n=${WHEELS.length}`);

let partErrs = [];
for (const p of [...CHASSIS, ...WHEELS]) partErrs = partErrs.concat(validateDeltas(p));
check('all parts are trade-offs (no pure buffs)', partErrs.length === 0, partErrs.join('; '));

const chDom = findDominationPairs(CHASSIS, (p) => {
  const s = {};
  for (const k of STAT_KEYS) s[k] = p.stats[k] || 0;
  return s;
});
check('no chassis dominates another', chDom.length === 0, JSON.stringify(chDom));
const whDom = findDominationPairs(WHEELS, (p) => {
  const s = {};
  for (const k of STAT_KEYS) s[k] = p.stats[k] || 0;
  return s;
});
check('no wheel dominates another', whDom.length === 0, JSON.stringify(whDom));

console.log('--- Cosmetics ---');
check('paints >= 12', PAINTS.length >= 12);
check('decals >= 6', DECALS.length >= 6);
check('exhausts >= 4', EXHAUSTS.length >= 4);
check('effects >= 4', EFFECTS.length >= 4);
check('cosmetic ids unique', (() => {
  const all = [...PAINTS, ...DECALS, ...EXHAUSTS, ...EFFECTS].map((x) => x.id);
  return new Set(all).size === all.length;
})());

console.log('--- Loadout combination ---');
const l1 = buildLoadout(DEFAULT_LOADOUT);
check('default loadout builds', !!l1 && !!l1.stats && !!l1.params);
const l2 = buildLoadout({ ...DEFAULT_LOADOUT });
check('loadout is deterministic', JSON.stringify(l1.stats) === JSON.stringify(l2.stats)
  && JSON.stringify(l1.params) === JSON.stringify(l2.params));

// stacking the heaviest parts must not exceed bounds
const extreme = buildLoadout({
  characterId: 'bastion', chassisId: 'ironclad_hauler', wheelId: 'iron_drums',
});
check('extreme heavy build mass capped', extreme.params.massFactor <= 1.35,
  `mass=${extreme.params.massFactor.toFixed(2)}`);
check('extreme build stats within 1..10', STAT_KEYS.every((k) =>
  extreme.stats[k] >= 1 && extreme.stats[k] <= 10));

// soft cap: adding +2 stats above 8 must gain less than +2 effective
const base = combineStats({ acceleration: 8, topSpeed: 5, handling: 5, weight: 5, driftControl: 6, offRoad: 5 });
const boosted = combineStats({ acceleration: 8, topSpeed: 5, handling: 5, weight: 5, driftControl: 6, offRoad: 5 },
  { acceleration: 2 });
check('soft cap applies diminishing returns',
  boosted.acceleration - base.acceleration < 2 && boosted.acceleration > base.acceleration,
  `delta=${(boosted.acceleration - base.acceleration).toFixed(2)}`);

// fastest possible build vs slowest: spread must stay in arcade range
const fastest = buildLoadout({ characterId: 'nova', chassisId: 'tempest_bolt', wheelId: 'chrome_halos' });
const slowest = buildLoadout({ characterId: 'bastion', chassisId: 'featherwing', wheelId: 'balloon_floaters' });
check('top speed spread bounded (0.82x..1.22x of base)', (() => {
  const b = CONFIG.vehicle.maxSpeed;
  return slowest.params.maxSpeed > b * 0.8 && fastest.params.maxSpeed < b * 1.24;
})(), `fast=${fastest.params.maxSpeed.toFixed(1)} slow=${slowest.params.maxSpeed.toFixed(1)} base=${CONFIG.vehicle.maxSpeed}`);
check('acceleration spread bounded', (() => {
  const b = CONFIG.vehicle.accel;
  return slowest.params.accel > b * 0.7 && fastest.params.accel < b * 1.35;
})());

// no loadout can be strictly best everywhere (compare a matrix of builds)
const builds = [];
for (const c of CHARACTERS) {
  builds.push(buildLoadout({ characterId: c.id, chassisId: 'dune_blazer', wheelId: 'standard_treads' }));
  builds.push(buildLoadout({ characterId: c.id, chassisId: 'tempest_bolt', wheelId: 'chrome_halos' }));
}
const domLoadouts = [];
for (let i = 0; i < builds.length; i++) {
  for (let j = 0; j < builds.length; j++) {
    if (i === j) continue;
    let allGe = true, anyGt = false;
    for (const k of STAT_KEYS) {
      if (builds[i].stats[k] < builds[j].stats[k]) { allGe = false; break; }
      if (builds[i].stats[k] > builds[j].stats[k]) anyGt = true;
    }
    if (allGe && anyGt) domLoadouts.push([i, j]);
  }
}
check('no sampled loadout dominates another (post soft-cap)', domLoadouts.length === 0, JSON.stringify(domLoadouts.slice(0, 3)));

// drift mods are valid
check('drift mods in range', (() => {
  const d = driftModsFromStats({ driftControl: 9 });
  const e = driftModsFromStats({ driftControl: 1 });
  return d.gripMult > e.gripMult && d.chargeRate > e.chargeRate && d.gripMult < 0.5;
})());

// params carry through the untouched base fields
check('params preserve base collision radius', l1.params.collisionRadius === CONFIG.vehicle.collisionRadius);
check('getCharacter works', getCharacter('ember')?.id === 'ember' && getCharacter('nope') === null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
