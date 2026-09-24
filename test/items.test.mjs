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

// every headline mechanic of the arsenal is present
for (const id of ['cinder_lance', 'hornet_pod', 'glass_fang', 'kiln_mortar', 'slag_mine',
  'brass_bulwark', 'dust_veil', 'thorn_scatter', 'sunflare', 'ember_draft', 'glasswalk',
  'dune_skip', 'rust_blight', 'gyro_jinx', 'hourglass_hex', 'forge_ward', 'echo_bell',
  'mirage_decoy', 'storm_cell', 'hex_mirror', 'kiln_lottery', 'sunforge_heart']) {
  check(`roster complete: ${id}`, !!ITEMS[id]);
}
check('exactly 22 items', ITEM_LIST.length === 22, `n=${ITEM_LIST.length}`);
check('unique colours (one hue per item)',
  new Set(ITEM_LIST.map((i) => i.color)).size === ITEM_LIST.length);
check('every item states its counterplay',
  ITEM_LIST.every((i) => i.counterKey && i.descKey && i.nameKey));
check('the signature item is gated to the back of the field',
  ITEMS.sunforge_heart.params.minFieldFraction > 0);
check('all six roles are covered',
  ITEM_LIST.every((i) => ['leader', 'chaser', 'any'].includes(i.bias))
  && new Set(ITEM_LIST.map((i) => i.category)).size === 6);

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

  // position weighting: disruption at the back, denial/protection at the front
  const tally = (pos, total, n = 4000) => {
    let seed = 1234;
    const r = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const t = {};
    for (let i = 0; i < n; i++) {
      const id = rollItem(r, pos, total);
      t[ITEMS[id].category] = (t[ITEMS[id].category] || 0) + 1;
    }
    return t;
  };
  const front = tally(1, 8), back = tally(8, 8);
  check('leaders get denial and protection', (front.hazard + front.utility) > (back.hazard + back.utility),
    `front=${front.hazard + front.utility} back=${back.hazard + back.utility}`);
  check('backmarkers get disruption', (back.debuff + back.zone) > (front.debuff + front.zone),
    `front=${front.debuff + front.zone} back=${back.debuff + back.zone}`);
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

  // ember draft: speed for your drift button
  items.held.set(k1.vehicle, 'ember_draft');
  items.useItem(k1, [k1, k2]);
  items.applyMods([k1, k2]);
  const m1 = k1.vehicle.mods;
  check('ember draft boosts speed/accel and kills drift',
    m1 && m1.speedMult > 1.2 && m1.accelMult > 1.5 && m1.noDrift);
  check('use consumes held item', items.heldItem(k1) === null);

  // rust blight on the kart ahead: accel only, top speed untouched
  items.statuses.delete(k1.vehicle);   // drop the leftover draft
  k2._raceLap = 1;                     // k2 is a full lap ahead
  items.held.set(k1.vehicle, 'rust_blight');
  items.useItem(k1, [k1, k2]);
  items.applyMods([k1, k2]);
  const m2 = k2.vehicle.mods;
  check('blight cripples the leader\'s acceleration', m2 && m2.accelMult < 0.5);
  check('blight leaves top speed alone', m2.speedMult === 1);
  check('blight does not affect the user', k1.vehicle.mods === null);

  // glasswalk: untouchable, and unable to act while it lasts
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
  items.held.set(k2.vehicle, 'glasswalk');
  items.useItem(k2, [k1, k2]);
  check('glasswalk makes the kart intangible', items.isIntangible(k2.vehicle));
  check('and unable to use items', items.hasNoItems(k2.vehicle));
  items.held.set(k1.vehicle, 'cinder_lance');
  items.useItem(k1, [k1, k2]);
  for (let t = 0; t < 120; t++) items.update(0.016, [k1, k2], 1 + t * 0.016);
  check('intangible kart not staggered by the lance', !items.hasStatus(k2.vehicle, 'stagger'));

  // forge ward blocks a direct hit
  items.removeStatus(k2.vehicle, 'glasswalk');   // let k2 be hittable again
  items.held.set(k2.vehicle, 'forge_ward');
  items.useItem(k2, [k1, k2]);
  check('ward grants a shield charge', (items.shieldCharges.get(k2.vehicle) || 0) >= 1);
  items.cleanse(k2.vehicle);
  placeK2Ahead();
  items.held.set(k1.vehicle, 'cinder_lance');
  items.useItem(k1, [k1, k2]);
  let blocked = false;
  const origOn = items.onEvent;
  items.onEvent = (t) => { if (t === 'itemBlocked') blocked = true; };
  for (let t = 0; t < 120 && !blocked; t++) items.update(0.016, [k1, k2], 1);
  items.onEvent = origOn;
  check('shield charge absorbs a hit', blocked);
  check('the charge was spent', (items.shieldCharges.get(k2.vehicle) || 0) === 0);

  // echo bell cleanses hazards
  items.held.set(k1.vehicle, 'slag_mine');
  items.useItem(k1, [k1, k2]);
  const hazardsBefore = items.entities.filter((e) => e.kind === 'hazard').length;
  k2.vehicle.pos.copy(k1.vehicle.pos).add({ x: 4, y: 0, z: 0 });
  items.held.set(k2.vehicle, 'echo_bell');
  items.useItem(k2, [k1, k2]);
  const hazardsAfter = items.entities.filter((e) => e.kind === 'hazard').length;
  check('echo bell removes nearby hazards', hazardsBefore > 0 && hazardsAfter < hazardsBefore,
    `${hazardsBefore} -> ${hazardsAfter}`);

  // hex mirror turns the next hostile item around
  items.reset();
  k2._raceLap = 0;
  placeK2Ahead();
  items.held.set(k2.vehicle, 'hex_mirror');
  items.useItem(k2, [k1, k2]);
  items.held.set(k1.vehicle, 'cinder_lance');
  items.useItem(k1, [k1, k2]);
  let throwerHit = false, mirrorHit = false, reflected = false;
  for (let t = 0; t < 90; t++) {
    items.update(0.016, [k1, k2], 1 + t * 0.016);
    throwerHit = throwerHit || items.hasStatus(k1.vehicle, 'stagger');
    mirrorHit = mirrorHit || items.hasStatus(k2.vehicle, 'stagger');
  }
  reflected = throwerHit && !mirrorHit;
  check('hex mirror sends the hit back to its thrower', reflected,
    `thrower=${throwerHit} mirror=${mirrorHit}`);

  // reset clears state
  items.reset();
  check('reset clears held/status/entities', items.held.size === 0 && items.statuses.size === 0 && items.entities.length === 0);
}

console.log('--- Full race integration (items on) ---');
{
  const stubHud = { onRaceStart() {}, countdown() {}, notify() {}, updateRace() {}, setWrongWay() {}, showResults() {} };
  const stubI18n = { t: (k) => k };
  let uses = 0, gets = 0, hits = 0;
  const granted = new Set(), landed = new Set();
  const items = new ItemSystem({
    track, audio: stubAudio, rng: Math.random,
    onEvent: (t, p) => {
      if (t === 'itemUse') uses++;
      if (t === 'itemGet') { gets++; granted.add(p.itemId); }
      if (t === 'itemHit') { hits++; landed.add(p.itemId); }
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
  check('a live race reaches most of the roster', granted.size >= 8,
    `distinct=${granted.size}: ${[...granted].join(',')}`);
  check('every granted item is a real catalog entry',
    [...granted].every((id) => !!ITEMS[id]));
  console.log(`  (race sim: t=${simTime.toFixed(0)}s gets=${gets} uses=${uses} hits=${hits} distinct=${granted.size} landed=${[...landed].join(',')})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
