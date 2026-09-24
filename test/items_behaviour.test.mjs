// ============================================================================
// Item behaviour suite - "does each power-up actually do what it says?".
//
// test/items.test.mjs covers the catalogue and the roulette. This file drives
// the RUNTIME and pins the properties the Sunforge arsenal promises:
//   * every one of the 22 items fires and leaves an observable trace;
//   * the attacks behave differently from each other (the Lance pierces, the
//     Pod is a weak spread, the Fang shatters and dirties the road);
//   * the mortar leads its target instead of firing at where it was;
//   * the Bulwark is physically solid and the Dust Veil is not;
//   * defensive trades cost what their text says they cost (Glasswalk cannot
//     act, Sunflare's immunity is shorter than its boost, the Bulwark blocks
//     its own owner once the grace window is over);
//   * shields, mirrors and decoys all resolve before damage lands, and the
//     attacker gets nothing when its effect is denied;
//   * entity bookkeeping stays honest when handlers despawn their own entity.
// ============================================================================
import * as THREE from '../lib/three.module.js';
import { TrackManager } from '../src/track.js';
import { VehicleController } from '../src/vehicle.js';
import { ItemSystem } from '../src/items.js';
import { AIController } from '../src/ai.js';
import { TRACK_DEFS } from '../src/content/trackDefs.js';
import { CONFIG } from '../src/config.js';
import { ITEMS, ITEM_LIST, rollItem } from '../src/content/items.js';

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
function world(n = 4, gap = 14, rng = null) {
  const events = [];
  const items = new ItemSystem({
    track, audio: stubAudio, rng: rng || undefined,
    onEvent: (t, p) => events.push({ t, p }),
  });
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
const ahead = (v) => new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));

// ------------------------------------------------- every item does something
console.log('--- Every power-up produces an observable effect ---');
for (const def of ITEM_LIST) {
  const { items, karts, events } = world(4, 14);
  const user = karts[0];
  items.held.set(user.vehicle, def.id);
  const used = items.useItem(user, karts);

  const peak = { ents: 0, mine: 0, theirs: 0, shields: 0, boost: false, air: false };
  const sample = () => {
    peak.ents = Math.max(peak.ents, items.entities.length);
    peak.mine = Math.max(peak.mine, (items.statuses.get(user.vehicle) || []).length);
    peak.theirs = Math.max(peak.theirs,
      karts.slice(1).reduce((a, k) => a + (items.statuses.get(k.vehicle) || []).length, 0));
    peak.shields = Math.max(peak.shields, items.shieldCharges.get(user.vehicle) || 0);
    peak.boost = peak.boost || user.vehicle.boost.boosting;
    peak.air = peak.air || !user.vehicle.grounded;
  };
  for (let i = 0; i < 180; i++) {
    for (const k of karts) k.vehicle.step(dt, DRIVE, false);
    items.update(dt, karts, i * dt);
    sample();
  }
  const noteworthy = ['itemHit', 'itemBlocked', 'cloneFlash', 'tempestZap', 'itemBurst',
    'itemWard', 'itemHex', 'itemReroll', 'itemReflect', 'itemShatter'];
  const didSomething = peak.ents > 0 || peak.mine > 0 || peak.theirs > 0 || peak.shields > 0
    || peak.boost || peak.air || events.some((e) => noteworthy.includes(e.t));
  const finite = karts.every((k) => [k.vehicle.pos.x, k.vehicle.pos.z, k.vehicle.y,
    k.vehicle.yaw, k.vehicle.fSpeed].every(Number.isFinite));
  check(`${def.id}: fires and has an effect`, used && didSomething && finite,
    `used=${used} ents=${peak.ents} mine=${peak.mine} theirs=${peak.theirs} finite=${finite}`);
}

// --------------------------------------------------------- forward attack
console.log('--- Cinder Lance: fast, straight, piercing ---');
{
  const { items, karts, events } = world(3, 9);
  const me = karts[0];
  items.held.set(me.vehicle, 'cinder_lance');
  items.useItem(me, karts);
  const proj = items.entities.find((e) => e.kind === 'projectile');
  check('lance spawns one projectile', !!proj);
  check('lance does not home (it is dodgeable)', proj.target === null && ITEMS.cinder_lance.params.homing === 0);
  run(items, karts, 1.2);
  const hits = events.filter((e) => e.t === 'itemHit').map((e) => e.p.victim);
  check('one lance pierces a line of karts', hits.length >= 2,
    `hits=${hits.length}`);
  check('the lance is spent after piercing', !items.entities.some((e) => e.kind === 'projectile'));
}

console.log('--- Hornet Pod: a spread of weak hits ---');
{
  const { items, karts } = world(2, 12);
  items.held.set(karts[0].vehicle, 'hornet_pod');
  items.useItem(karts[0], karts);
  const wasps = items.entities.filter((e) => e.kind === 'projectile');
  check('pod releases three wasps', wasps.length === ITEMS.hornet_pod.params.count, `n=${wasps.length}`);
  check('they are laterally offset from each other',
    new Set(wasps.map((w) => w.vel.clone().normalize().x.toFixed(3))).size === wasps.length);
  // a weak hit nudges but does NOT dump the held item
  const victim = karts[1];
  items.held.set(victim.vehicle, 'forge_ward');
  items._hitKart(ITEMS.hornet_pod, victim, karts[0], 0.5);
  check('a weak hit leaves the victim holding its item', items.heldItem(victim) === 'forge_ward');
  items._hitKart(ITEMS.cinder_lance, victim, karts[0], 1);
  check('a full hit dumps it', items.heldItem(victim) === null);
}

console.log('--- Glass Fang: locks on, then dirties the road ---');
{
  const { items, karts, events } = world(2, 14);
  items.held.set(karts[0].vehicle, 'glass_fang');
  items.useItem(karts[0], karts);
  const fang = items.entities.find((e) => e.kind === 'projectile');
  check('fang locks onto the kart ahead', fang.target === karts[1].vehicle);
  run(items, karts, 1.6);
  check('fang shatters on impact', events.some((e) => e.t === 'itemShatter'));
  const shards = items.entities.filter((e) => e.kind === 'hazard' && e.fx.kind === 'shards');
  check('the shatter leaves glass on the road', shards.length === 1,
    `n=${shards.length}`);
  check('glass is a slow, not a spin',
    shards[0].fx.slowMult < 1 && shards[0].fx.spinDur === undefined);
  // driving through the patch slows you down
  const victim = karts[1];
  victim.vehicle.pos.copy(shards[0].pos);
  victim.vehicle.surf = track.surface(victim.vehicle.pos, victim.vehicle.hint);
  items.cleanse(victim.vehicle);
  items.update(dt, karts, 2);
  check('the patch slows whoever crosses it', items.hasStatus(victim.vehicle, 'slip'));
}

console.log('--- Kiln Mortar: leads its target ---');
{
  const { items, karts } = world(2, 30);
  const me = karts[0], target = karts[1];
  const atFire = target.vehicle.pos.clone();
  items.held.set(me.vehicle, 'kiln_mortar');
  items.useItem(me, karts);
  const shell = items.entities.find((e) => e.kind === 'hazard');
  check('mortar spawns a shell', !!shell);
  check('the shell is inert while it is in the air', shell.armT > 0.5, `armT=${shell.armT.toFixed(2)}`);
  const lead = shell.pos.clone().sub(atFire).dot(ahead(target.vehicle));
  const lateral = Math.abs(shell.pos.clone().sub(atFire).dot(
    new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), ahead(target.vehicle))));
  check('it lands where the target is GOING to be', lead > 8, `lead=${lead.toFixed(1)}m`);
  check('...and not several lanes away', lateral < 8, `lateral=${lateral.toFixed(1)}m`);
  check('the shell is on the road surface', Math.abs(shell.pos.y - target.vehicle.y) < 6,
    `dy=${(shell.pos.y - target.vehicle.y).toFixed(1)}`);
}
{
  // once it lands, the crater burns whoever is standing in it
  const { items, karts } = world(2, 20);
  const me = karts[0], victim = karts[1];
  items.held.set(me.vehicle, 'kiln_mortar');
  items.useItem(me, karts);
  const shell = items.entities.find((e) => e.kind === 'hazard');
  // stop just short of the landing so the whole loop is genuinely airborne
  const airFrames = Math.floor(ITEMS.kiln_mortar.params.flight * 60) - 3;
  let hitInAir = false;
  for (let i = 0; i < airFrames; i++) {
    // park the victim on the impact point the whole way down
    victim.vehicle.pos.copy(shell.pos);
    victim.vehicle.vel.set(0, 0, 0);
    victim.vehicle.step(dt, COAST, false);
    items.update(dt, karts, i * dt);
    hitInAir = hitInAir || items.hasStatus(victim.vehicle, 'burnt');
  }
  check('nothing burns while the shell is still in the air', !hitInAir && shell.armT > 0,
    `burnt=${hitInAir} armT=${shell.armT.toFixed(2)}`);
  // ... then let it land with the victim still on the impact point
  for (let i = 0; i < 30; i++) {
    victim.vehicle.pos.copy(shell.pos);
    victim.vehicle.vel.set(0, 0, 0);
    items.update(dt, karts, 2 + i * dt);
  }
  check('the crater burns whoever is standing in it', items.hasStatus(victim.vehicle, 'burnt'),
    `armT=${shell.armT.toFixed(2)} statuses=${(items.statuses.get(victim.vehicle) || []).map(x => x.type).join(',')}`);
}
{
  // nobody ahead: it still puts a crater down the road, and never on itself
  const { items, karts } = world(1);
  items.held.set(karts[0].vehicle, 'kiln_mortar');
  items.useItem(karts[0], karts);
  const crater = items.entities.find((e) => e.kind === 'hazard');
  check('mortar with no target still puts a crater down', !!crater && crater.fx.kind === 'crater');
  const d = crater.pos.distanceTo(karts[0].vehicle.pos);
  check('far enough ahead that it arms before anyone arrives',
    d > 28 && crater.armT > 0.5, `d=${d.toFixed(1)} armT=${crater.armT.toFixed(2)}`);
  // self-immunity: hazards never burn their own thrower
  karts[0].vehicle.pos.copy(crater.pos);
  karts[0].vehicle.vel.set(0, 0, 0);
  crater.armT = -1;
  items.update(dt, karts, 3);
  check('the owner never burns on their own crater', !items.hasStatus(karts[0].vehicle, 'burnt'));
}

console.log('--- Slag Mine: drags you in, then erupts ---');
{
  const { items, karts } = world(2, 6);
  const me = karts[0], victim = karts[1];
  items.held.set(me.vehicle, 'slag_mine');
  items.useItem(me, karts);
  const mine = items.entities.find((e) => e.kind === 'hazard');
  // park the victim on the road just short of the mine and let it pull
  victim.vehicle.pos.copy(mine.pos).addScaledVector(ahead(me.vehicle), -3.2);
  victim.vehicle.pos.y = mine.pos.y;
  victim.vehicle.surf = track.surface(victim.vehicle.pos, victim.vehicle.hint);
  victim.vehicle.vel.set(0, 0, 0);
  victim.vehicle.fSpeed = 0;
  const d0 = victim.vehicle.pos.distanceTo(mine.pos);
  check('the victim starts inside the pull radius', d0 < ITEMS.slag_mine.params.radius,
    `d0=${d0.toFixed(1)}`);
  // the mine arms first (armTime), then pulls, then blows
  for (let i = 0; i < 180 && !mine.dead; i++) {
    victim.vehicle.step(dt, COAST, false);
    items.update(dt, karts, i * dt);
  }
  check('the mine pulls karts toward it', mine.dead || victim.vehicle.pos.distanceTo(mine.pos) < d0 - 0.4,
    `d0=${d0.toFixed(1)}`);
  check('and then erupts, launching the victim', victim.vehicle.vy > 1 || !victim.vehicle.grounded,
    `vy=${victim.vehicle.vy.toFixed(1)} grounded=${victim.vehicle.grounded}`);
  check('the mine is consumed by its own eruption', mine.dead || !items.entities.includes(mine));
}

// ------------------------------------------------------------ area denial
console.log('--- Brass Bulwark is solid; Dust Veil is not ---');
{
  const { items, karts, events } = world(2, 10);
  items.held.set(karts[1].vehicle, 'brass_bulwark');
  items.useItem(karts[1], karts);
  const wall = items.entities.find((e) => e.kind === 'wall');
  check('bulwark spawns a solid wall', !!wall && wall.fx.solid === true);
  run(items, karts, 2.5);                    // kart 0 drives straight at it
  const along = karts[0].vehicle.pos.clone().sub(wall.pos).dot(wall.dir);
  check('the kart behind cannot drive through it', along < -0.5, `along=${along.toFixed(2)}m`);
  check('blocking is not damage: the wall never hits',
    !events.some((e) => e.t === 'itemHit'));
  check('the wall is still standing', items.entities.includes(wall));
}
{
  const { items, karts } = world(2, 10);
  items.held.set(karts[1].vehicle, 'dust_veil');
  items.useItem(karts[1], karts);
  const veil = items.entities.find((e) => e.kind === 'wall');
  check('dust veil is not solid', !!veil && !veil.fx.solid);
  run(items, karts, 1.0);   // through the curtain, before the slip wears off
  const along = karts[0].vehicle.pos.clone().sub(veil.pos).dot(veil.dir);
  check('you can drive straight through the dust', along > 2, `along=${along.toFixed(2)}m`);
  const slip = (items.statuses.get(karts[0].vehicle) || []).find((s) => s.type === 'slip');
  check('but it takes your grip with you', !!slip);
  check('the dust loosens the steering',
    !!slip && slip.data.gripMult < 1 && slip.data.jitter > 0, JSON.stringify(slip?.data));
}
{
  // the bulwark costs its owner a lane: after the grace window it is solid
  // for them too
  const { items, karts } = world(1);
  items.held.set(karts[0].vehicle, 'brass_bulwark');
  items.useItem(karts[0], karts);
  const wall = items.entities.find((e) => e.kind === 'wall');
  check('the owner is exempt while leaving their own gate', wall.graceT > 0);
  // grace over: the same gate is now solid for its own owner
  wall.graceT = -1;
  const v = karts[0].vehicle;
  v.pos.copy(wall.pos).addScaledVector(wall.dir, -1.0);
  v.vel.copy(wall.dir).multiplyScalar(12);          // driving back into it
  items.update(dt, karts, 5);
  const ownerAlong = v.pos.clone().sub(wall.pos).dot(wall.dir);
  check('...and it shoves its owner back out too', ownerAlong < -1.2,
    `along=${ownerAlong.toFixed(2)}`);
  check('the owner is slowed by their own gate', items.hasStatus(v, 'slow'));
  check('the gate reverses their momentum', v.vel.dot(wall.dir) < 0,
    `into=${v.vel.dot(wall.dir).toFixed(1)}`);
}

console.log('--- Brass Bulwark: the hitbox is the visible gate, and the AI reads it ---');
{
  const { items, karts } = world(2, 20);
  items.held.set(karts[1].vehicle, 'brass_bulwark');
  items.useItem(karts[1], karts);
  const wall = items.entities.find((e) => e.kind === 'wall');
  wall.graceT = -1;
  const c = wall.collider, R = CONFIG.vehicle.collisionRadius;
  check('the gate carries a capsule hitbox spanning its plate',
    !!c && c.kind === 'capsule' && Math.abs(Math.hypot(c.x1 - c.x0, c.z1 - c.z0) - wall.width) < 1e-6);
  const v = karts[0].vehicle;
  const put = (lat, along, y = null) => {
    v.pos.copy(wall.pos).addScaledVector(wall.right, lat).addScaledVector(wall.dir, along);
    if (y !== null) v.y = y;
    v.vel.copy(wall.dir).multiplyScalar(10);
    items.statuses.delete(v);
  };
  const toSegment = () => {
    const ex = c.x1 - c.x0, ez = c.z1 - c.z0;
    const t = Math.max(0, Math.min(1, ((v.pos.x - c.x0) * ex + (v.pos.z - c.z0) * ez) / (ex * ex + ez * ez)));
    return Math.hypot(v.pos.x - (c.x0 + ex * t), v.pos.z - (c.z0 + ez * t));
  };
  const groundY = v.y;
  // centre beyond the plate, body over the end post: the old centre-only test let this through
  put(wall.width / 2 + 1.0, -0.3, groundY);
  items.update(dt, karts, 1);
  check('a kart whose body clips an end post is stopped by it', items.hasStatus(v, 'slow'));
  check('...and pushed clear of the post', toSegment() >= c.r + R - 1e-3, `gap=${(toSegment() - c.r - R).toFixed(3)}`);
  // fully clear of the post: untouched
  put(wall.width / 2 + c.r + R + 0.15, -0.3, groundY);
  const before = v.pos.clone();
  items.update(dt, karts, 1.1);
  check('a kart clear of the post drives past untouched',
    !items.hasStatus(v, 'slow') && v.pos.distanceTo(before) < 1e-9);
  // flying over the plate
  put(0, 0, wall.pos.y + ITEMS.brass_bulwark.params.height + 0.1);
  items.update(dt, karts, 1.2);
  check('a kart hopping over the gate clears it', !items.hasStatus(v, 'slow'));
  // it always leaves a lane: centred on the narrowest road of ANY track, a
  // kart still fits beside it
  let narrowest = Infinity, where = '';
  for (const def of TRACK_DEFS) {
    const t = new TrackManager(def);
    for (let s = 0; s < t.L; s += 3) {
      const w = t.pointAt(s).width;
      if (w < narrowest) { narrowest = w; where = `${def.id}@${s}`; }
    }
  }
  const lane = (narrowest - wall.width) / 2 - c.r;          // free road beside a centred gate
  check('a gate never closes the road (a kart fits beside it on the narrowest road of all 16 tracks)',
    lane > 2 * R, `lane=${lane.toFixed(2)}m kart=${(2 * R).toFixed(2)}m at ${where}`);
}
{
  // AI karts treat a Bulwark like any other obstacle: pick a lane early, pass clean
  let seed = 7;
  const seeded = () => {                                   // mulberry32
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const realRandom = Math.random;
  const trial = (sWall, latWall, aware) => {
    const items = new ItemSystem({ track, audio: stubAudio });
    const v = new VehicleController(track, false);
    v.place(track.placeAt(sWall - 70, 0));
    v.fSpeed = 24; v.vel.set(Math.sin(v.yaw) * 24, 0, Math.cos(v.yaw) * 24);
    v.surf = track.surface(v.pos, v.hint);
    const me = { vehicle: v, ai: new AIController(v, track, 'balanced'), nameKey: 'k', isPlayer: false,
      _racePos: 2, _raceTotal: 2, _raceLap: 0 };
    const dv = new VehicleController(track, false);
    dv.place(track.placeAt(sWall + 3, latWall));
    dv.surf = track.surface(dv.pos, dv.hint);
    items.held.set(dv, 'brass_bulwark');
    items.useItem({ vehicle: dv, ai: null, nameKey: 'd', isPlayer: false, _racePos: 1, _raceTotal: 2, _raceLap: 0 }, [me]);
    const wall = items.entities.find((e) => e.kind === 'wall');
    let touched = false, passed = false;
    for (let f = 0; f < 60 * 7 && !passed; f++) {
      const input = me.ai.update(dt, [me], true, aware ? items : null);
      v.step(dt, input, false);
      track.update(dt, f * dt);                            // obstacles move, as in the real loop
      items.update(dt, [me], f * dt);
      touched = touched || items.hasStatus(v, 'slow');
      passed = v.pos.clone().sub(wall.pos).dot(wall.dir) > 3;
    }
    return { clean: passed && !touched, touched };
  };
  const spots = [[320, 0], [530, -2], [740, 2], [950, 0], [1160, 2]];
  let clean = 0, blindHits = 0;
  try {
    Math.random = seeded;
    for (const [sw, lat] of spots) if (trial(sw, lat, true).clean) clean++;
    seed = 7;
    for (const [sw, lat] of spots) if (trial(sw, lat, false).touched) blindHits++;
  } finally {
    Math.random = realRandom;
  }
  check('the gates were dropped on the racing line (a blind AI hits most of them)', blindHits >= 3,
    `blind hits ${blindHits}/${spots.length}`);
  check('the AI steers around a Bulwark instead of ramming it', clean >= 4, `clean ${clean}/${spots.length}`);
}

console.log('--- Thorn Scatter: a fan, not a pile ---');
{
  const { items, karts } = world(2, 20);
  items.held.set(karts[0].vehicle, 'thorn_scatter');
  items.useItem(karts[0], karts);
  const thorns = items.entities.filter((e) => e.kind === 'hazard');
  check('three thorns are thrown', thorns.length === ITEMS.thorn_scatter.params.count,
    `n=${thorns.length}`);
  check('they spread out behind the owner',
    new Set(thorns.map((t) => t.pos.x.toFixed(1) + t.pos.z.toFixed(1))).size === thorns.length);
  check('all three are behind the thrower',
    thorns.every((t) => t.pos.clone().sub(karts[0].vehicle.pos).dot(ahead(karts[0].vehicle)) < 1));
  // one thorn, one spin, then it is gone
  const victim = karts[1];
  victim.vehicle.pos.copy(thorns[0].pos);
  thorns[0].armT = -1;
  const before = items.entities.length;
  items.update(dt, karts, 1);
  check('a thorn spins out its victim and is spent',
    items.hasStatus(victim.vehicle, 'thornSpin') && items.entities.length === before - 1);
}

// --------------------------------------------------------------- mobility
console.log('--- Sunflare: the immunity is shorter than the boost ---');
{
  const { items, karts } = world(2, 20);
  items.held.set(karts[0].vehicle, 'sunflare');
  items.useItem(karts[0], karts);
  check('flare gives an instant boost', karts[0].vehicle.boost.boosting);
  check('and a moment of immunity', items.isIntangible(karts[0].vehicle));
  run(items, karts, ITEMS.sunflare.params.immune + 0.4, DRIVE);
  check('the immunity expires first', !items.isIntangible(karts[0].vehicle));
  check('the boost is still running', karts[0].vehicle.boost.boosting);
}

console.log('--- Ember Draft: speed for your drift button ---');
{
  const { items, karts } = world(1);
  items.held.set(karts[0].vehicle, 'ember_draft');
  items.useItem(karts[0], karts);
  items.applyMods(karts);
  const m = karts[0].vehicle.mods;
  check('draft raises speed and acceleration', m.speedMult > 1.2 && m.accelMult > 1.5);
  check('and kills drifting while it lasts', m.noDrift === true);
  run(items, karts, ITEMS.ember_draft.params.duration + 0.5, DRIVE);
  check('it expires on its own', karts[0].vehicle.mods === null);
}

console.log('--- Glasswalk: untouchable, and it costs you ---');
{
  const { items, karts } = world(2, 20);
  items.held.set(karts[0].vehicle, 'glasswalk');
  items.useItem(karts[0], karts);
  check('glasswalk makes the kart intangible', items.isIntangible(karts[0].vehicle));
  items.held.set(karts[0].vehicle, 'cinder_lance');
  check('a phased kart cannot attack', items.useItem(karts[0], karts) === false);
  check('the blocked item is not consumed', items.heldItem(karts[0]) === 'cinder_lance');
  check('it collects no boxes either', (() => {
    items.setBoxes([{ s: 100, lat: 0 }]);
    karts[0].vehicle.pos.copy(items.boxes[0].pos);
    items.update(dt, karts, 1);
    return items.heldItem(karts[0]) === 'cinder_lance';
  })());
  run(items, karts, 1.2, DRIVE);
  const trail = items.entities.filter((e) => e.kind === 'hazard' && e.fx.kind === 'shards');
  check('it sheds a slowing glass trail behind it', trail.length >= 2, `n=${trail.length}`);
  run(items, karts, ITEMS.glasswalk.params.duration, DRIVE);
  check('and the phase expires', !items.isIntangible(karts[0].vehicle)
    && !items.hasNoItems(karts[0].vehicle));
}

console.log('--- Dune Skip: a real hop ---');
{
  const { items, karts } = world(1);
  const v = karts[0].vehicle;
  const speed0 = v.fSpeed;
  items.held.set(v, 'dune_skip');
  items.useItem(karts[0], karts);
  check('skip leaves the ground', v.vy > 4 && v.grounded === false, `vy=${v.vy.toFixed(1)}`);
  check('and throws the kart forward', v.fSpeed >= speed0 - 1 || v.vel.length() > speed0);
  for (let i = 0; i < 120; i++) { v.step(dt, DRIVE, false); items.update(dt, karts, i * dt); }
  check('it lands and the air status clears', v.grounded && !items.hasStatus(v, 'skip'));
}

// ------------------------------------------------------------- disruption
console.log('--- Rust Blight: acceleration, not top speed ---');
{
  const { items, karts } = world(2, 20);
  karts[1]._raceLap = 1;                       // make kart 1 the leader
  items.held.set(karts[0].vehicle, 'rust_blight');
  items.useItem(karts[0], karts);
  items.applyMods(karts);
  const m = karts[1].vehicle.mods;
  check('blight cripples the leader\'s acceleration', m && m.accelMult < 0.5, `accel=${m?.accelMult}`);
  check('top speed is untouched - it only hurts after a corner', m.speedMult === 1);
  check('the user is not affected', karts[0].vehicle.mods === null);
  items.cleanse(karts[1].vehicle);
  items.applyMods(karts);
  check('a cleanse removes it', karts[1].vehicle.mods === null);
}

console.log('--- Gyro Jinx: a full spin-out ---');
{
  const { items, karts } = world(2, 12);
  const victim = karts[1];
  items.held.set(victim.vehicle, 'forge_ward');
  items.held.set(karts[0].vehicle, 'gyro_jinx');
  items.useItem(karts[0], karts);
  check('jinx spins the rival out', victim.vehicle._spinT > 0.5, `spinT=${victim.vehicle._spinT}`);
  check('steering is taken away', items.hasStatus(victim.vehicle, 'jinx'));
  check('and the held item goes with it', items.heldItem(victim) === null);
}

console.log('--- Hourglass Hex: the bubble travels with its victim ---');
{
  const { items, karts, events } = world(3, 16);
  items.held.set(karts[0].vehicle, 'hourglass_hex');
  items.useItem(karts[0], karts);
  const zone = items.entities.find((e) => e.kind === 'zone');
  check('hex spawns a zone', !!zone);
  check('it hangs on the rival, not on the thrower', zone.follow === karts[1].vehicle);
  check('an itemHex event was raised', events.some((e) => e.t === 'itemHex'));
  // teleport the victim: the bubble must come with them
  karts[1].vehicle.pos.x += 40;
  karts[1].vehicle.pos.z += 40;
  items.update(dt, karts, 1);
  check('the bubble follows the victim anywhere',
    zone.pos.distanceTo(karts[1].vehicle.pos) < 0.01);
  // a third kart drafting past the victim gets caught in it
  karts[2].vehicle.pos.copy(karts[1].vehicle.pos).add(new THREE.Vector3(3, 0, 0));
  zone.life = 0.5;                              // skip the wind-up
  items.update(dt, karts, 2);
  check('whoever drafts past them is caught too', items.hasStatus(karts[2].vehicle, 'hexSlow'));
}

// ------------------------------------------------------------- protection
console.log('--- Forge Ward, Echo Bell and the Hex Mirror ---');
{
  const { items, karts } = world(2, 14);
  items.addStatus(karts[0].vehicle, { type: 'blight', dur: 5, data: { accelMult: 0.4 } });
  items.held.set(karts[0].vehicle, 'forge_ward');
  items.useItem(karts[0], karts);
  check('ward grants one shield charge', (items.shieldCharges.get(karts[0].vehicle) || 0) === 1);
  check('ward cleanses what is already on you', !items.hasStatus(karts[0].vehicle, 'blight'));
}
{
  const { items, karts } = world(3, 8);
  items.held.set(karts[1].vehicle, 'slag_mine');
  items.useItem(karts[1], karts);
  items.held.set(karts[2].vehicle, 'thorn_scatter');
  items.useItem(karts[2], karts);
  const hazardsBefore = items.entities.filter((e) => e.kind === 'hazard').length;
  items.addStatus(karts[0].vehicle, { type: 'jinx', dur: 5, data: { steerMult: 0.1 } });
  karts[0].vehicle.pos.copy(items.entities[0].pos);      // stand in the middle of them
  items.held.set(karts[0].vehicle, 'echo_bell');
  items.useItem(karts[0], karts);
  const hazardsAfter = items.entities.filter((e) => e.kind === 'hazard').length;
  check('the bell shatters every trap in range',
    hazardsBefore >= 3 && hazardsAfter === 0, `${hazardsBefore} -> ${hazardsAfter}`);
  check('the bell cleanses you', !items.hasStatus(karts[0].vehicle, 'jinx'));
  check('the bell pays charge back for what it broke', karts[0].vehicle.boost.boosting);
  check('and it leaves a visible ring', items.entities.some((e) => e.kind === 'pulse'));
}
{
  const { items, karts, events } = world(2, 14);
  items.held.set(karts[1].vehicle, 'hex_mirror');
  items.useItem(karts[1], karts);
  check('mirror paints a sigil on the kart', items.hasStatus(karts[1].vehicle, 'mirror'));
  items.held.set(karts[0].vehicle, 'cinder_lance');
  items.useItem(karts[0], karts);
  let throwerStaggered = false, mirrorClean = true;
  for (let i = 0; i < 90; i++) {
    for (const k of karts) k.vehicle.step(dt, DRIVE, false);
    items.update(dt, karts, i * dt);
    throwerStaggered = throwerStaggered || items.hasStatus(karts[0].vehicle, 'stagger');
    mirrorClean = mirrorClean && !items.hasStatus(karts[1].vehicle, 'stagger');
  }
  check('the next hostile item goes back to its thrower', throwerStaggered && mirrorClean,
    `thrower=${throwerStaggered} mirrorClean=${mirrorClean}`);
  check('a reflection is announced', events.some((e) => e.t === 'itemReflect'));
  check('the sigil is spent after one use', !items.hasStatus(karts[1].vehicle, 'mirror'));
}
{
  // a shielded victim denies the effect AND the attacker's reward
  const { items, karts, events } = world(2, 14);
  items.shieldCharges.set(karts[1].vehicle, 1);
  items.held.set(karts[0].vehicle, 'glass_fang');
  items.useItem(karts[0], karts);
  run(items, karts, 1.4);
  check('the shield absorbs the fang', events.some((e) => e.t === 'itemBlocked'));
  check('the attacker gets no shatter for a blocked hit',
    !items.entities.some((e) => e.kind === 'hazard' && e.fx.kind === 'shards')
    && !events.some((e) => e.t === 'itemShatter'));
}

console.log('--- Mirage Decoy steals a shot ---');
{
  const { items, karts, events } = world(2, 12);
  items.held.set(karts[1].vehicle, 'mirage_decoy');
  items.useItem(karts[1], karts);
  const decoy = items.entities.find((e) => e.kind === 'decoy');
  check('decoy drops a double behind its owner', !!decoy);
  items.held.set(karts[0].vehicle, 'cinder_lance');
  items.useItem(karts[0], karts);
  // park the decoy in the lance's path
  decoy.pos.copy(karts[0].vehicle.pos).addScaledVector(ahead(karts[0].vehicle), 6);
  run(items, karts, 0.6);
  check('the shot goes for the mirage instead', events.some((e) => e.t === 'cloneFlash'));
  check('and both the decoy and the lance are spent',
    !items.entities.includes(decoy) && !items.entities.some((e) => e.kind === 'projectile'));
}

console.log('--- Storm Cell arcs backwards on a drift-boost release ---');
{
  const { items, karts, events } = world(2, 6);
  const me = karts[0];
  items.held.set(me.vehicle, 'storm_cell');
  items.useItem(me, karts);
  const cell = (items.statuses.get(me.vehicle) || []).find((s) => s.type === 'storm');
  check('the cell holds three charges', cell && cell.data.charges === 3);
  // park a rival directly behind, then release a drift boost
  karts[1].vehicle.pos.copy(me.vehicle.pos).addScaledVector(ahead(me.vehicle), -4);
  me.vehicle.fx = { driftEnd: { boosted: true } };
  items.update(dt, karts, 1);
  check('a released drift-boost arcs backwards', events.some((e) => e.t === 'tempestZap'));
  check('the tailing rival is hit', items.hasStatus(karts[1].vehicle, 'stagger'));
  check('one charge was spent', cell.data.charges === 2);
  me.vehicle.fx = { driftEnd: { boosted: false } };
  items.update(dt, karts, 2);
  check('nothing arcs without a drift-boost release', cell.data.charges === 2);
}

// ----------------------------------------------------------------- gamble
console.log('--- Kiln Lottery ---');
{
  let seed = 11;
  const rng = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const { items, karts, events } = world(2, 20, rng);
  items.held.set(karts[0].vehicle, 'kiln_lottery');
  items.useItem(karts[0], karts);
  const reroll = events.find((e) => e.t === 'itemReroll');
  check('the lottery announces what came out', !!reroll);
  check('it never comes back as another lottery', reroll && reroll.p.itemId !== 'kiln_lottery',
    `got=${reroll?.p.itemId}`);
  check('it never rerolls into a real item id', !!ITEMS[reroll?.p.itemId]);
  check('the slot stays empty (the new item fires immediately)',
    items.heldItem(karts[0]) === null);
}

console.log('--- Sunforge Heart: gated to the back, and it burns ---');
{
  let seed = 5;
  const rng = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const front = new Set(), back = new Set();
  for (let i = 0; i < 500; i++) {
    front.add(rollItem(rng, 1, 8));
    back.add(rollItem(rng, 8, 8));
  }
  check('the leader never finds the signature', !front.has('sunforge_heart'));
  check('the back of the field does', back.has('sunforge_heart'));
  check('disruption favours backmarkers', back.has('gyro_jinx') && back.has('rust_blight'));
}
{
  const { items, karts, events } = world(2, 8);
  items.held.set(karts[0].vehicle, 'sunforge_heart');
  items.useItem(karts[0], karts);
  const swarm = items.entities.find((e) => e.kind === 'swarm');
  check('the heart trails a burning swarm', !!swarm && swarm.burn === true);
  check('and it is a big boost', items.hasStatus(karts[0].vehicle, 'heart')
    && karts[0].vehicle.boost.boosting);
  // the tailing kart is inside the cone
  karts[1].vehicle.pos.copy(karts[0].vehicle.pos).addScaledVector(ahead(karts[0].vehicle), -5);
  items.update(dt, karts, 1);
  check('sitting in its wake burns you', events.some((e) => e.t === 'itemHit' && e.p.itemId === 'sunforge_heart'));
}

// ------------------------------------------------------- entity bookkeeping
console.log('--- Entity lifetime bookkeeping ---');
{
  const { items, karts } = world(2, 6);
  items.held.set(karts[1].vehicle, 'brass_bulwark');
  items.useItem(karts[1], karts);
  items.held.set(karts[1].vehicle, 'slag_mine');
  items.useItem(karts[1], karts);
  const walls0 = items.entities.filter((e) => e.kind === 'wall').length;
  const mines0 = items.entities.filter((e) => e.kind === 'hazard').length;
  check('setup built a wall and a mine', walls0 === 1 && mines0 === 1);
  // a projectile detonating must not take the wall or the mine with it
  items.held.set(karts[0].vehicle, 'cinder_lance');
  items.useItem(karts[0], karts);
  run(items, karts, 1.5);
  check('an unrelated wall survives a projectile impact',
    items.entities.filter((e) => e.kind === 'wall').length === walls0);
  check('no dead entity lingers in the list', items.entities.every((e) => !e.dead));
}
{
  const { items, karts } = world(2, 6);
  items.held.set(karts[0].vehicle, 'cinder_lance');
  items.useItem(karts[0], karts);
  const proj = items.entities.find((e) => e.kind === 'projectile');
  items._kill(proj);
  items._kill(proj);   // double-kill must be a no-op, not a stray splice
  check('killing an entity twice is harmless', items.entities.length === 0);
}
{
  // a shatter-on-impact despawns its own projectile mid-iteration
  const { items, karts } = world(3, 8);
  items.held.set(karts[1].vehicle, 'slag_mine');
  items.useItem(karts[1], karts);
  items.held.set(karts[0].vehicle, 'glass_fang');
  items.useItem(karts[0], karts);
  run(items, karts, 2);
  check('a self-despawning handler leaves the list consistent',
    items.entities.every((e) => !e.dead)
    && items.entities.filter((e) => e.kind === 'hazard').length >= 1);
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
  items.addStatus(karts[0].vehicle, {
    type: 'glasswalk', dur: 5, data: { intangible: true, noItems: true },
  });
  karts[0].vehicle.place(track.placeAt(100, 0));
  karts[0].vehicle.fSpeed = 0; karts[0].vehicle.vel.set(0, 0, 0);
  run(items, karts, 0.5, COAST);
  check('a phased kart collects nothing', items.heldItem(karts[0]) === null);
}
{
  // boxes always sit at their authored anchor
  const { items, karts } = world(1);
  items.setBoxes([{ s: 100, lat: 0 }, { s: 160, lat: 3 }]);
  const homes = items.boxes.map((b) => b.pos.clone());
  items.boxes[0].pos.x += 12; items.boxes[0].pos.z -= 7;
  run(items, karts, 0.4, COAST);
  check('a displaced box snaps back to its anchor',
    items.boxes.every((b, i) => b.pos.distanceTo(homes[i]) < 1e-6));
}

// ------------------------------------------------------------------- resets
console.log('--- Reset ---');
{
  const { items, karts } = world(2, 6);
  items.setBoxes([{ s: 120, lat: 0 }]);
  items.boxes[0].pos.x += 9;                       // pretend something moved it
  items.held.set(karts[0].vehicle, 'cinder_lance');
  items.useItem(karts[0], karts);
  items.addStatus(karts[1].vehicle, { type: 'stagger', dur: 5, data: { speedMult: 0.5 } });
  items.shieldCharges.set(karts[0].vehicle, 2);
  const stale = items.entities[0];
  items.reset();
  check('reset clears entities, statuses, shields and held items',
    items.entities.length === 0 && items.statuses.size === 0
    && items.shieldCharges.size === 0 && items.held.size === 0);
  check('reset invalidates handles held by the renderer', stale && stale.dead === true);
  check('reset returns boxes to their anchors',
    items.boxes[0].pos.distanceTo(items.boxes[0].home) < 1e-6);
  items.applyMods(karts);
  check('reset drops every vehicle mod', karts.every((k) => k.vehicle.mods === null));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
