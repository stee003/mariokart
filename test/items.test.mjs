// Power-up system tests: catalog integrity, roulette math, runtime
// mechanics (statuses, projectiles, shields, cleanse) and a headless
// full-race integration with items enabled.
import { ITEM_LIST, ITEMS, rollItem } from '../src/content/items.js';
import { ItemSystem } from '../src/items.js';
import { TrackManager } from '../src/track.js';
import { VehicleController } from '../src/vehicle.js';
import { AIController } from '../src/ai.js';
import { RaceManager } from '../src/race.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

console.log('--- Catalog ---');
check('at least 20 original items', ITEM_LIST.length >= 20, `n=${ITEM_LIST.length}`);
const reqFields = ['nameKey', 'descKey', 'counterKey', 'color', 'icon', 'sound', 'params', 'weight'];
let fieldErrs = [];
for (const it of ITEM_LIST) {
  for (const f of reqFields) if (it[f] === undefined) fieldErrs.push(`${it.id}.${f}`);
}
check('every item defines purpose/counterplay/identity/sound/params', fieldErrs.length === 0, fieldErrs.join(','));
check('unique icons (visual identity)', new Set(ITEM_LIST.map((i) => i.icon)).size === ITEM_LIST.length);
check('unique sounds', new Set(ITEM_LIST.map((i) => i.sound)).size === ITEM_LIST.length);
check('valid categories', ITEM_LIST.every((i) =>
  ['projectile', 'hazard', 'buff', 'debuff', 'zone', 'utility'].includes(i.category)));

// specific requested mechanics exist
for (const id of ['flux_bolt', 'gravity_anchor', 'mirage_clone', 'pulse_ring', 'overdrive_core',
  'vortex_mine', 'phase_shield', 'time_ripple', 'magnet_surge', 'repair_drone']) {
  check(`requested item present: ${id}`, !!ITEMS[id]);
}

console.log('--- Roulette ---');
{
  let seed = 42;
  const rng = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const rolls = new Set();
  for (let i = 0; i < 400; i++) rolls.add(rollItem(rng, 1 + (i % 4), 4));
  check('roulette returns valid ids only', [...rolls].every((id) => !!ITEMS[id]));
  check('roulette covers many items over time', rolls.size >= 12, `n=${rolls.size}`);
  // determinism
  let s1 = 7; const r1 = () => (s1 = (s1 * 1103515245 + 12345) % 2147483648) / 2147483648;
  let s2 = 7; const r2 = () => (s2 = (s2 * 1103515245 + 12345) % 2147483648) / 2147483648;
  const a = Array.from({ length: 20 }, () => rollItem(r1, 2, 4));
  const b = Array.from({ length: 20 }, () => rollItem(r2, 2, 4));
  check('roulette deterministic under seed', JSON.stringify(a) === JSON.stringify(b));
}

console.log('--- Runtime mechanics ---');
const track = new TrackManager();
const stubAudio = new Proxy({}, { get: () => () => {} });

function mkKart(i, isPlayer = false) {
  const v = new VehicleController(track, isPlayer);
  v.place(track.startGrid()[i % 4]);
  return { vehicle: v, ai: null, nameKey: 'ai.you', isPlayer, _racePos: i + 1, _raceTotal: 4, _raceLap: 0 };
}

{
  const events = [];
  const items = new ItemSystem({ track, onEvent: (t, p) => events.push({ t, p }), rng: () => 0.5 });
  items.setBoxes([{ s: track.L * 0.2, lat: 0 }, { s: track.L * 0.5, lat: 2 }]);
  check('boxes created', items.boxes.length === 2);

  const k1 = mkKart(0), k2 = mkKart(1);
  k1.vehicle.place({ pos: items.boxes[0].pos.clone().setY(items.boxes[0].pos.y - 1.1), yaw: 0 });
  k1.vehicle.surf = track.surface(k1.vehicle.pos, k1.vehicle.hint);

  items.update(0.016, [k1, k2], 1);
  check('box grants an item', items.heldItem(k1) !== null);
  const got = events.find((e) => e.t === 'itemGet');
  check('itemGet event fired', !!got);

  const heldBefore = items.heldItem(k1);
  items.update(0.016, [k1, k2], 1);
  check('no double pickup while holding', items.heldItem(k1) === heldBefore);
  check('box goes on respawn cooldown', items.boxes[0].respawnT > 0);

  // overdrive buff
  items.held.set(k1.vehicle, 'overdrive_core');
  items.useItem(k1, [k1, k2]);
  items.applyMods([k1, k2]);
  const m1 = k1.vehicle.mods;
  check('overdrive boosts speed/accel', m1 && m1.speedMult > 1.2 && m1.accelMult > 1.5 && m1.noDrift);
  check('use consumes held item', items.heldItem(k1) === null);

  // gravity anchor on the kart ahead
  items.statuses.delete(k1.vehicle);   // drop leftover overdrive from previous case
  k2._raceLap = 1; // k2 is a full lap ahead
  items.held.set(k1.vehicle, 'gravity_anchor');
  items.useItem(k1, [k1, k2]);
  items.applyMods([k1, k2]);
  const m2 = k2.vehicle.mods;
  check('anchor slows + disables drift on target', m2 && m2.speedMult === 0.8 && m2.noDrift);
  check('anchor does not affect the user', k1.vehicle.mods === null || !k1.vehicle.mods.noDrift);

  // phase shield blocks hits (k2 placed 15m ahead of k1, in firing line)
  const placeK2Ahead = () => {
    const yaw = k1.vehicle.yaw;
    k2.vehicle.pos.set(
      k1.vehicle.pos.x + Math.sin(yaw) * 15,
      k1.vehicle.pos.y,
      k1.vehicle.pos.z + Math.cos(yaw) * 15,
    );
    k2.vehicle.surf = track.surface(k2.vehicle.pos, k2.vehicle.hint);
  };
  k1.vehicle.yaw = Math.atan2(
    track.pointAt(track.L * 0.25).pos.x - k1.vehicle.pos.x,
    track.pointAt(track.L * 0.25).pos.z - k1.vehicle.pos.z,
  );
  placeK2Ahead();
  items.held.set(k2.vehicle, 'phase_shield');
  items.useItem(k2, [k1, k2]);
  check('phase makes intangible', items.isIntangible(k2.vehicle));
  items.held.set(k1.vehicle, 'flux_bolt');
  items.useItem(k1, [k1, k2]);
  for (let t = 0; t < 120; t++) items.update(0.016, [k1, k2], 1 + t * 0.016);
  check('intangible kart not staggered by bolt', !items.hasStatus(k2.vehicle, 'stagger'));

  // repair drone shield blocks a direct hit
  items.removeStatus(k2.vehicle, 'phase');   // let k2 be hittable again
  items.held.set(k2.vehicle, 'repair_drone');
  items.useItem(k2, [k1, k2]);
  check('repair grants shield charge', (items.shieldCharges.get(k2.vehicle) || 0) >= 1);
  items.cleanse(k2.vehicle);
  placeK2Ahead();
  items.held.set(k1.vehicle, 'flux_bolt');
  items.useItem(k1, [k1, k2]);
  let blocked = false;
  const origOn = items.onEvent;
  items.onEvent = (t) => { if (t === 'itemBlocked') blocked = true; };
  for (let t = 0; t < 120 && !blocked; t++) items.update(0.016, [k1, k2], 1);
  items.onEvent = origOn;
  check('shield charge absorbs a hit', blocked);

  // pulse ring cleanses hazards
  items.held.set(k1.vehicle, 'vortex_mine');
  items.useItem(k1, [k1, k2]);
  const hazardsBefore = items.entities.filter((e) => e.kind === 'hazard').length;
  k2.vehicle.pos.copy(k1.vehicle.pos).add({ x: 4, y: 0, z: 0 });
  items.held.set(k2.vehicle, 'pulse_ring');
  items.useItem(k2, [k1, k2]);
  const hazardsAfter = items.entities.filter((e) => e.kind === 'hazard').length;
  check('pulse ring removes nearby hazards', hazardsBefore > 0 && hazardsAfter < hazardsBefore);

  // reset clears state
  items.reset();
  check('reset clears held/status/entities', items.held.size === 0 && items.statuses.size === 0 && items.entities.length === 0);
}

console.log('--- Full race integration (items on) ---');
{
  const stubHud = { onRaceStart() {}, countdown() {}, notify() {}, updateRace() {}, setWrongWay() {}, showResults() {} };
  const stubI18n = { t: (k) => k };
  let uses = 0, gets = 0, hits = 0;
  const items = new ItemSystem({
    track, audio: stubAudio, rng: Math.random,
    onEvent: (t) => {
      if (t === 'itemUse') uses++;
      if (t === 'itemGet') gets++;
      if (t === 'itemHit') hits++;
    },
  });
  items.setBoxes([0.08, 0.25, 0.42, 0.6, 0.78, 0.93].map((f) => ({ s: f * track.L, lat: 0 })));
  const race = new RaceManager({ track, hud: stubHud, audio: stubAudio, i18n: stubI18n, items });
  for (const p of ['aggressive', 'balanced', 'defensive', 'balanced']) {
    const v = new VehicleController(track, false);
    race.registerKart({ vehicle: v, ai: new AIController(v, track, p), nameKey: 'ai.test', isPlayer: false });
  }
  race.start(track.startGrid());
  const dt = 1 / 60;
  let simTime = 0, nan = false, finished = 0;
  while (simTime < 420 && finished < race.karts.length) {
    race.update(dt);
    track.update(dt, simTime);
    simTime += dt;
    for (const k of race.karts) {
      const v = k.vehicle;
      if (!Number.isFinite(v.pos.x) || !Number.isFinite(v.pos.z) || !Number.isFinite(v.y)) nan = true;
    }
    finished = race.karts.filter((k) => race.kartState.get(k.vehicle).finished).length;
    if (nan) break;
  }
  check('no NaN with items active', !nan);
  check('items were picked up during the race', gets > 0, `gets=${gets}`);
  check('AI used items during the race', uses > 0, `uses=${uses}`);
  check('at least 3 karts finished with items', finished >= 3, `finished=${finished}`);
  check('race time still sane', simTime < 420, `t=${simTime.toFixed(0)}`);
  console.log(`  (race sim: t=${simTime.toFixed(0)}s gets=${gets} uses=${uses} hits=${hits})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
