// ============================================================================
// Item behaviour suite - "does each power-up actually do what it says?".
//
// test/items.test.mjs covers the catalogue and the roulette. This file drives
// the RUNTIME and pins the defects that were found in the arsenal:
//   * slipstream_harpoon wrote a 'harpoon' status that nothing ever read, so
//     the item hooked a rival and then did nothing at all;
//   * magnet_surge permanently relocated item boxes (they never returned to
//     their authored spots, so the circuit slowly lost its pickups);
//   * kinetic_siphon granted the attacker its speed buff even when the victim
//     shielded the hit - a free permanent boost that cost the target nothing;
//   * ion_lash ignored shields entirely and credited a boost for drift charge
//     the victim never had;
//   * phase_shield set a `noItems` flag that was never enforced, so a phased
//     kart was untouchable AND still able to attack;
//   * entities were spliced by index while handlers mutated the list, so a
//     projectile impact could silently delete an unrelated live mine or wall.
// ============================================================================
import { TrackManager } from '../src/track.js';
import { VehicleController } from '../src/vehicle.js';
import { ItemSystem } from '../src/items.js';
import { ITEMS, ITEM_LIST } from '../src/content/items.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

const track = new TrackManager();
const dt = 1 / 60;
const stubAudio = new Proxy({}, { get: () => () => {} });
const COAST = { throttle: 0, brake: 0, steer: 0, drift: false, trick: false };
const DRIVE = { throttle: 1, brake: 0, steer: 0, drift: false, trick: false };

// kart 0 is last on the road; higher indices are further ahead
function world(n = 4, gap = 14) {
  const events = [];
  const items = new ItemSystem({ track, audio: stubAudio, onEvent: (t, p) => events.push({ t, p }) });
  const karts = [];
  for (let i = 0; i < n; i++) {
    const v = new VehicleController(track, i === 0);
    v.place(track.placeAt(100 + i * gap, 0));
    v.fSpeed = 25;
    v.vel.set(Math.sin(v.yaw) * 25, 0, Math.cos(v.yaw) * 25);
    v.surf = track.surface(v.pos, v.hint);
    karts.push({ vehicle: v, ai: null, nameKey: `k${i}`, isPlayer: i === 0,
                 _racePos: n - i, _raceTotal: n, _raceLap: 0 });
  }
  return { items, karts, events };
}
function run(items, karts, secs, input = DRIVE) {
  const steps = Math.round(secs * 60);
  for (let i = 0; i < steps; i++) {
    for (const k of karts) k.vehicle.step(dt, input, false);
    items.update(dt, karts, i * dt);
  }
}

// ------------------------------------------------- every item does something
console.log('--- Every power-up produces an observable effect ---');
for (const def of ITEM_LIST) {
  // ion_lash is a deliberately short-range melee arc (6.5 m), so it needs a
  // tight pack to have anything to hit; everything else is tested spread out.
  const gap = def.id === 'ion_lash' ? 4 : 14;
  const { items, karts, events } = world(4, gap);
  const user = karts[0];
  items.held.set(user.vehicle, def.id);
  const used = items.useItem(user, karts);

  const peak = { ents: items.entities.length, mine: 0, theirs: 0, shields: 0, boost: false };
  const sample = () => {
    peak.ents = Math.max(peak.ents, items.entities.length);
    peak.mine = Math.max(peak.mine, (items.statuses.get(user.vehicle) || []).length);
    peak.theirs = Math.max(peak.theirs,
      karts.slice(1).reduce((a, k) => a + (items.statuses.get(k.vehicle) || []).length, 0));
    peak.shields = Math.max(peak.shields, items.shieldCharges.get(user.vehicle) || 0);
    peak.boost = peak.boost || user.vehicle.boost.boosting;
  };
  for (let i = 0; i < 180; i++) {
    for (const k of karts) k.vehicle.step(dt, DRIVE, false);
    items.update(dt, karts, i * dt);
    sample();
  }
  const noteworthy = ['itemHit', 'itemBlocked', 'cloneFlash', 'tempestZap', 'chronoRestore', 'harpoonPull'];
  const didSomething = peak.ents > 0 || peak.mine > 0 || peak.theirs > 0 || peak.shields > 0
    || peak.boost || events.some(e => noteworthy.includes(e.t));
  const finite = karts.every(k => [k.vehicle.pos.x, k.vehicle.pos.z, k.vehicle.y,
    k.vehicle.yaw, k.vehicle.fSpeed].every(Number.isFinite));
  check(`${def.id}: fires and has an effect`, used && didSomething && finite,
    `used=${used} ents=${peak.ents} mine=${peak.mine} theirs=${peak.theirs} finite=${finite}`);
}

// ------------------------------------------------------------- the harpoon
console.log('--- Slipstream harpoon ---');
{
  const { items, karts } = world(2, 12);
  const me = karts[0], target = karts[1];
  items.held.set(me.vehicle, 'slipstream_harpoon');
  items.useItem(me, karts);
  const d0 = me.vehicle.pos.distanceTo(target.vehicle.pos);
  let dMin = d0, tethered = false;
  for (let i = 0; i < 150; i++) {
    for (const k of karts) k.vehicle.step(dt, COAST, false);
    items.update(dt, karts, i * dt);
    dMin = Math.min(dMin, me.vehicle.pos.distanceTo(target.vehicle.pos));
    tethered = tethered || items.hasStatus(me.vehicle, 'harpoon');
  }
  check('harpoon tether attaches', tethered);
  check('harpoon reels the owner toward the target', dMin < d0 - 2,
    `${d0.toFixed(1)}m -> ${dMin.toFixed(1)}m`);
}
{
  // the counter text promises the target escapes by boosting
  const { items, karts } = world(2, 12);
  items.addStatus(karts[0].vehicle, {
    type: 'harpoon', dur: 5,
    data: { targetVehicle: karts[1].vehicle, pullForce: ITEMS.slipstream_harpoon.params.pullForce },
  });
  karts[1].vehicle.boost.trigger(2, 'drift');
  items.update(dt, karts, 0);
  check('harpoon snaps when the target boosts free', !items.hasStatus(karts[0].vehicle, 'harpoon'));
}

// --------------------------------------------------------------- the magnet
console.log('--- Magnet surge ---');
{
  const { items, karts } = world(1);
  items.setBoxes([{ s: 120, lat: 0 }, { s: 160, lat: 3 }]);
  const homes = items.boxes.map(b => b.pos.clone());
  karts[0].vehicle.place(track.placeAt(112, 6));
  items.held.set(karts[0].vehicle, 'magnet_surge');
  items.useItem(karts[0], karts);
  run(items, karts, ITEMS.magnet_surge.params.duration + 4, COAST);
  const drift = items.boxes.map((b, i) => b.pos.distanceTo(homes[i]));
  check('boxes return to their authored spots after the surge',
    drift.every(d => d < 1.5), `drift=[${drift.map(d => d.toFixed(2)).join(',')}]`);
}

// -------------------------------------------------------- shields & phasing
console.log('--- Shields, phasing and fair exchanges ---');
{
  const { items, karts } = world(2, 10);
  const victim = karts[1];
  items.shieldCharges.set(victim.vehicle, 1);
  items.held.set(karts[0].vehicle, 'kinetic_siphon');
  items.useItem(karts[0], karts);
  check('siphon grants nothing when the victim shields it',
    !items.hasStatus(karts[0].vehicle, 'siphonOwner')
    && !items.hasStatus(victim.vehicle, 'siphonVictim'));
  check('the shield charge was spent', (items.shieldCharges.get(victim.vehicle) || 0) === 0);
}
{
  const { items, karts } = world(2, 10);
  items.held.set(karts[0].vehicle, 'kinetic_siphon');
  items.useItem(karts[0], karts);
  check('siphon drains the victim and feeds the owner',
    items.hasStatus(karts[0].vehicle, 'siphonOwner') && items.hasStatus(karts[1].vehicle, 'siphonVictim'));
  // "break line of sight or boost away": escaping range ends the drain
  karts[1].vehicle.pos.addScaledVector(karts[1].vehicle.pos.clone().normalize(), 500);
  karts[1].vehicle.pos.x += 400;
  items.update(dt, karts, 0);
  check('escaping range breaks the siphon',
    !items.hasStatus(karts[0].vehicle, 'siphonOwner') && !items.hasStatus(karts[1].vehicle, 'siphonVictim'));
}
{
  const { items, karts } = world(2, 4);
  items.shieldCharges.set(karts[1].vehicle, 1);
  const charge0 = (karts[1].vehicle.drift.charge = 1.0);
  items.held.set(karts[0].vehicle, 'ion_lash');
  items.useItem(karts[0], karts);
  check('ion lash respects shields',
    karts[1].vehicle.drift.charge === charge0 && (items.shieldCharges.get(karts[1].vehicle) || 0) === 0);
}
{
  const { items, karts } = world(2, 4);
  karts[1].vehicle.drift.charge = 1.0;
  items.held.set(karts[0].vehicle, 'ion_lash');
  items.useItem(karts[0], karts);
  check('ion lash steals drift charge when it connects', karts[1].vehicle.drift.charge < 1.0);
}
{
  const { items, karts } = world(2, 10);
  items.held.set(karts[0].vehicle, 'phase_shield');
  items.useItem(karts[0], karts);
  check('phase shield makes the kart intangible', items.isIntangible(karts[0].vehicle));
  items.held.set(karts[0].vehicle, 'flux_bolt');
  check('a phased kart cannot fire', items.useItem(karts[0], karts) === false);
  check('the blocked item is not consumed', items.heldItem(karts[0]) === 'flux_bolt');
  run(items, karts, ITEMS.phase_shield.params.duration + 0.5, COAST);
  check('phase expires and the kart can act again', !items.isIntangible(karts[0].vehicle)
    && !items.hasNoItems(karts[0].vehicle));
}

// ------------------------------------------------------- entity bookkeeping
console.log('--- Entity lifetime bookkeeping ---');
{
  const { items, karts } = world(2, 6);
  items.held.set(karts[0].vehicle, 'prism_wall');
  items.useItem(karts[0], karts);
  items.held.set(karts[0].vehicle, 'vortex_mine');
  items.useItem(karts[0], karts);
  const walls0 = items.entities.filter(e => e.kind === 'wall').length;
  const mines0 = items.entities.filter(e => e.kind === 'hazard').length;
  // a projectile detonating must not take the wall or the mine with it
  items.held.set(karts[0].vehicle, 'flux_bolt');
  items.useItem(karts[0], karts);
  run(items, karts, 1.5);
  const walls1 = items.entities.filter(e => e.kind === 'wall').length;
  check('an unrelated wall survives a projectile impact', walls1 === walls0,
    `walls ${walls0} -> ${walls1}, mines0=${mines0}`);
  check('no dead entity lingers in the list', items.entities.every(e => !e.dead));
}
{
  const { items, karts } = world(2, 6);
  items.held.set(karts[0].vehicle, 'flux_bolt');
  items.useItem(karts[0], karts);
  const proj = items.entities.find(e => e.kind === 'projectile');
  items._kill(proj);
  items._kill(proj);   // double-kill must be a no-op, not a stray splice
  check('killing an entity twice is harmless', items.entities.length === 0);
}

// -------------------------------------------------------------- box pickups
console.log('--- Item boxes ---');
{
  const { items, karts } = world(1);
  items.setBoxes([{ s: 100, lat: 0 }]);
  karts[0].vehicle.place(track.placeAt(100, 0));
  karts[0].vehicle.fSpeed = 0; karts[0].vehicle.vel.set(0, 0, 0);
  run(items, karts, 0.2, COAST);
  const first = items.heldItem(karts[0]);
  check('driving over a box grants exactly one item', !!first);
  check('the box went into respawn', items.boxes[0].respawnT > 0,
    `respawnT=${items.boxes[0].respawnT.toFixed(2)}`);
  run(items, karts, 9, COAST);
  check('a held item cannot be replaced by another box', items.heldItem(karts[0]) === first);
  check('the box came back after its respawn timer', items.boxes[0].respawnT <= 0);
}
{
  const { items, karts } = world(1);
  items.setBoxes([{ s: 100, lat: 0 }]);
  items.addStatus(karts[0].vehicle, { type: 'phase', dur: 5, data: { intangible: true, noItems: true } });
  karts[0].vehicle.place(track.placeAt(100, 0));
  karts[0].vehicle.fSpeed = 0; karts[0].vehicle.vel.set(0, 0, 0);
  run(items, karts, 0.5, COAST);
  check('a phased kart collects nothing', items.heldItem(karts[0]) === null);
}

// ------------------------------------------------------------------- resets
console.log('--- Reset ---');
{
  const { items, karts } = world(2, 6);
  items.setBoxes([{ s: 120, lat: 0 }]);
  items.boxes[0].pos.x += 9;                       // pretend a magnet moved it
  items.held.set(karts[0].vehicle, 'flux_bolt');
  items.useItem(karts[0], karts);
  items.addStatus(karts[1].vehicle, { type: 'stagger', dur: 5, data: { speedMult: 0.5 } });
  items.shieldCharges.set(karts[0].vehicle, 2);
  items.reset();
  check('reset clears entities, statuses, shields and held items',
    items.entities.length === 0 && items.statuses.size === 0
    && items.shieldCharges.size === 0 && items.held.size === 0);
  check('reset returns boxes to their anchors',
    items.boxes[0].pos.distanceTo(items.boxes[0].home) < 1e-6);
  items.applyMods(karts);
  check('reset drops every vehicle mod', karts.every(k => k.vehicle.mods === null));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
