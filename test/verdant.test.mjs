// Verdant Loop: themed world, safe wildlife, road-height water, fixed-step
// interaction, and elevated off-track recovery through the normal R path.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from '../lib/three.module.js';
import { TRACK_DEFS } from '../src/content/trackDefs.js';
import { TrackManager } from '../src/track.js';
import { CONFIG } from '../src/config.js';
import { VehicleController } from '../src/vehicle.js';
import { AIController } from '../src/ai.js';
import { RaceManager } from '../src/race.js';
import { CameraController } from '../src/camera.js';
import { buildKart, updateKartVisual } from '../src/kartMesh.js';
import { buildThemedEnvironment } from '../src/environment2.js';
import { verdantClearance } from '../src/verdantEnvironment.js';
import { waterFootprint, waterCoverage } from '../src/water.js';

// The runtime draws its own signs/sky on canvases; no browser is required.
global.document = { createElement() {
  const c = { width: 0, height: 0 };
  c.getContext = () => new Proxy({}, {
    get: (_, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {},
    set: () => true,
  });
  return c;
} };
const def = TRACK_DEFS.find(d => d.id === 'verdant_loop');
const snapshot = JSON.parse(readFileSync(new URL('./fixtures/refinement-untouched-hashes.json', import.meta.url)));
assert.equal(createHash('sha256').update(JSON.stringify(def)).digest('hex'), snapshot.verdant_loop,
  'course geometry/checkpoints/music/layout remain the original Verdant Loop');
const track = new TrackManager(def);
const scene = new THREE.Scene(), previousLight = new THREE.AmbientLight(0xff0000, 10);
scene.add(previousLight);
const env = buildThemedEnvironment(scene, track, 'VERDANT LOOP');
const root = env.group.getObjectByName('Verdant Loop Lanternwood scenery');
assert.ok(root?.getObjectByName('The Lanternwood heart tree'));
assert.ok(root?.getObjectByName('Leaf-tunnel canopy'));
assert.ok(root?.getObjectByName('Lanternwood lily pond'));
assert.ok(root?.getObjectByName('Raised boardwalk timber fascia'));
assert.ok(root?.getObjectByName('Lanternwood welcome sign'));
assert.equal(previousLight.visible, false, 'forest lights isolate legacy scene lights');
assert.ok(env.colliders.length >= 8, 'tunnel/portal have camera colliders');
assert.equal(env.state.animals.length, 6);
assert.equal(env.state.puddles.length, 1);
assert.equal(track.waterSurfaces.length, 1);
let meshes = 0, instances = 0;
env.group.traverse(o => { if (o.isMesh) meshes++; if (o.isInstancedMesh) instances += o.count; });
assert.ok(meshes > 180 && meshes < 320 && instances > 2500 && instances < 5500,
  `bounded but layered procedural scenery: ${meshes} meshes, ${instances} instances`);
const ground = env.group.children.find(o => o.geometry?.parameters?.radius === 820);
assert.ok(ground && Math.abs(ground.position.y - track.recoveryFloorY) < 1e-7);
console.log(`PASS Lanternwood landmarks / light isolation / ${meshes} meshes, ${instances} instances`);

// Animals do not wander onto even the shortcut; NONE contributes a physics or
// camera collider. Check both their rig and its full bounding radius.
const colliderCount = env.colliders.length;
for (const t of [0, 1, 15, 600]) {
  env.state.update(1 / 60, t);
  for (const a of env.state.animals) {
    assert.ok(verdantClearance(track, a.mesh.position) > a.radius + 4,
      `${a.kind} stays well beyond both road edges`);
    assert.ok(a.mesh.position.distanceTo(a.anchor) < .01, 'wildlife only idles in place');
  }
  root.traverse(o => {
    assert.ok(o.position.toArray().every(Number.isFinite));
    assert.ok(o.scale.toArray().every(Number.isFinite));
    if (o.isInstancedMesh) assert.ok(o.instanceMatrix.array.every(Number.isFinite));
    if (o.geometry?.attributes.position) assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));
  });
}
assert.equal(env.colliders.length, colliderCount);
assert.equal(env.state.animals.filter(a => a.kind === 'deer').length, 3);
assert.equal(env.state.animals.filter(a => a.kind === 'heron').length, 3);
// Knee-height raycasts through both driving surfaces cannot hit decorative
// mesh: the puddle and flush plank seams are intentionally visible overlays.
env.group.updateMatrixWorld(true);
const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
for (const route of [track.samples, track.shortcut.samples]) {
  for (let i = 0; i < route.length; i += 8) {
    const p = route[i];
    for (const lane of [-.65, 0, .65]) {
      const origin = p.pos.clone().addScaledVector(p.right, lane * (p.width / 2 - 1.7));
      origin.y += 1.5;
      ray.set(origin, down); ray.far = 1.2;
      const hits = ray.intersectObject(root, true).filter(h => h.object.isMesh &&
        !h.object.userData.driveSurface && h.object.material?.opacity > .2 &&
        h.object.name !== 'Water displacement ring');
      assert.equal(hits.length, 0, `nothing decorative protrudes into lane ${lane} at sample ${i}: ${hits[0]?.object.name}`);
    }
  }
}
console.log('PASS wildlife, finite animation, camera colliders and road/shortcut clearance');

const pud = env.state.puddles[0], water = pud.surface;
assert.equal(waterCoverage(water, water.center), 1);
assert.ok(waterCoverage(water, {
  x: water.center.x + water.right.x * water.across * 1.3,
  z: water.center.z + water.right.z * water.across * 1.3,
}) === 0);
assert.ok(waterFootprint(water, water.center) === 0);
let maxYError = 0;
const attr = pud.mesh.geometry.attributes.position;
for (let i = 0; i < attr.count; i++) {
  const v = new THREE.Vector3(attr.getX(i), attr.getY(i), attr.getZ(i));
  const height = track.surface(v, { main: -1, sc: -1 }).y;
  maxYError = Math.max(maxYError, Math.abs(v.y - (height + .073)));
}
assert.ok(maxYError < .002, `pool mesh follows physical road (max error ${maxYError})`);
const ringCount = pud.ripples.length;
const sceneChildren = root.children.length;
for (let i = 0; i < 100; i++) {
  const pos = water.center.clone().addScaledVector(water.dir, (i % 3 - 1) * 1.5);
  env.state.spawnPuddleRipple(pos, 18);
  env.state.update(1 / 60, i / 60);
}
assert.ok(pud.ripples.some(r => r.mesh.visible && r.mesh.material.opacity > 0));
assert.equal(pud.ripples.length, ringCount, 'water FX pool has a hard cap');
assert.equal(root.children.length, sceneChildren, 'ripples allocate no new scene nodes during play');
for (let i = 0; i < 160; i++) env.state.update(1 / 60, 2 + i / 60);
assert.ok(pud.ripples.every(r => !r.mesh.visible));
env.state.spawnPuddleRipple({ x: 900, y: 0, z: 900 });
assert.ok(pud.ripples.every(r => !r.mesh.visible), 'no ring from a car outside the visible shoreline');
console.log('PASS water mesh / shoreline physics / pooled wake animation');

const input = { throttle: 0, brake: 0, steer: 0, drift: false, trick: false };
function rolling(t, hz, seconds = .32) {
  const v = new VehicleController(t, true);
  const p = t.pointAt(t.L * .895);
  v.place(t.placeAt(t.L * .895, -1.2));
  v.vel.copy(p.dir).multiplyScalar(22);
  v.fSpeed = 22;
  for (let i = 0; i < Math.round(seconds * hz); i++) v.step(1 / hz, input);
  return v;
}
const dryTrack = new TrackManager(def);
const dry = rolling(dryTrack, 60), wet = rolling(track, 60);
assert.ok(wet.speedAbs < dry.speedAbs - 1.5, `water resists movement: ${wet.speedAbs} vs ${dry.speedAbs}`);
assert.ok(wet.waterDepth > .1 && wet.waterSurface === water);
const slow = rolling(track, 30, .3), fast = rolling(track, 144, .3);
assert.ok(Math.abs(slow.speedAbs - fast.speedAbs) < .55, 'wet handling is frame-rate independent');
const airborne = new VehicleController(track, true);
airborne.place(track.placeAt(track.L * .895, -1.2));
airborne.y += 3; airborne.pos.y = airborne.y; airborne.grounded = false;
airborne.step(1 / 60, input);
assert.equal(airborne.waterDepth, 0, 'jumping over a pool is not driving through it');
console.log('PASS fixed-step drag / shallow grip / airborne exemption / 30–144 Hz');

// A normal AI controller must still drive the ORIGINAL racing line and cross
// the new puddle, not stall at the water or jump off the raised section.
const oldRandom = Math.random;
let seed = 4814;
Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
try {
  const aiVehicle = new VehicleController(track, false);
  const ai = new AIController(aiVehicle, track, 'balanced');
  const runner = { vehicle: aiVehicle, ai, isPlayer: false };
  aiVehicle.place(track.startGrid(1)[0]);
  let progress = 0, previous = aiVehicle.surf.progress, wetFrames = 0, rescues = 0;
  for (let i = 0; i < 110 * 60 && progress < track.L; i++) {
    aiVehicle.step(1 / 60, ai.update(1 / 60, [runner], true));
    track.update(1 / 60, i / 60);
    const s = aiVehicle.surf.progress;
    let advance = s - previous;
    if (advance < -track.L / 2) advance += track.L;
    if (advance > track.L / 2) advance -= track.L;
    progress += advance;
    previous = s;
    if (aiVehicle.waterDepth > .3) wetFrames++;
    if (aiVehicle.fx.reset) rescues++;
  }
  assert.ok(progress >= track.L, 'AI can finish a lap with the forest and puddle active');
  assert.ok(wetFrames > 10, 'the racing line actually encounters shallow water');
  assert.ok(rescues <= 1, 'new scenery/recovery do not strand racers');
} finally { Math.random = oldRandom; }
console.log('PASS AI completes original route through active water');

const f = .40, p = track.pointAt(track.L * f), dt = 1 / 60;
// Drive over the apron with actual horizontal velocity (not merely a forced
// mid-air position) to exercise the supported -> unsupported transition.
const droveOff = new VehicleController(track, true);
droveOff.place(track.placeAt(track.L * f, p.width / 2 - 1));
droveOff.yaw = Math.atan2(p.right.x, p.right.z);
droveOff.vel.copy(p.right).multiplyScalar(20); droveOff.fSpeed = 20;
let edgeTick = -1, rescueTick = -1;
for (let i = 0; i < 80; i++) {
  droveOff.step(dt, { ...input, throttle: 1 });
  if (edgeTick < 0 && droveOff.respawnPending > 0) edgeTick = i;
  if (droveOff.fx.reset) { rescueTick = i; break; }
}
assert.ok(edgeTick >= 8 && edgeTick < 30, 'real driving crosses the timber edge');
assert.ok(rescueTick - edgeTick >= 35 && droveOff.fx.reset === 'fall');

const fallen = new VehicleController(track, true);
fallen.place(track.placeAt(track.L * f, 0));
const safeProgress = fallen.surf.progress;
const firstY = fallen.y;
fallen.pos.addScaledVector(p.right, p.width / 2 + CONFIG.recovery.deckOverhang + 1.1);
fallen.step(dt, input);
assert.equal(fallen.respawnReason, 'fall');
assert.equal(fallen.rescueProgress, safeProgress);
assert.equal(fallen.grounded, false, 'the raised edge has no invisible floor');
assert.ok(fallen.respawnPending > .6);
let resetStep = -1, lastY = fallen.y, falling = false;
for (let i = 1; i < 85; i++) {
  // An unrelated nearest leg in mid-fall must not change the rescue anchor.
  if (i === 16) {
    fallen.pos.set(800, fallen.y, 800);
    fallen.hint = { main: -1, sc: -1 };
  }
  fallen.step(dt, input);
  if (i === 16) assert.equal(fallen.rescueProgress, safeProgress);
  if (fallen.fx.reset) { resetStep = i; break; }
  assert.ok(fallen.y <= lastY + .03 || fallen.y === track.recoveryFloorY,
    'fall height is continuous until the intentional reset');
  falling ||= fallen.y < firstY - .5;
  lastY = fallen.y;
}
assert.ok(falling);
assert.ok(resetStep >= 35 && resetStep <= 60, `reset after short delay: ${resetStep} frames`);
assert.equal(fallen.fx.reset, 'fall');
assert.equal(fallen.respawnPending, 0);
assert.ok(fallen.resetTimer > .8);
assert.equal(fallen.grounded, true);
assert.equal(fallen.vy, 0);
assert.equal(fallen.vel.length(), 0);
assert.equal(fallen.latSpeed, 0);
assert.equal(fallen.drift.drifting, false);
assert.ok(Math.abs(fallen.pos.y - fallen.surf.y) < 1e-6);
assert.ok(Math.abs(fallen.surf.progress - (safeProgress - 4)) < 2);
const revision = fallen.poseRevision;
for (let i = 0; i < 130; i++) fallen.step(dt, { ...input, throttle: 1 });
assert.equal(fallen.poseRevision, revision, 'freeze cannot re-trigger a rescue');
assert.ok(fallen.speedAbs > 2, 'controls return after the freeze');

// Re-entering the real road before the countdown ends cancels the rescue;
// a harmless jump cannot silently teleport a player who saved the kart.
const saved = new VehicleController(track, true);
saved.place(track.placeAt(track.L * f, 0));
saved.pos.addScaledVector(p.right, p.width / 2 + 4);
saved.step(dt, input);
assert.ok(saved.respawnPending > 0);
saved.pos.copy(p.pos); saved.y = p.pos.y; saved.pos.y = saved.y;
saved.vel.set(0, 0, 0); saved.vy = 0; saved.grounded = true;
saved.step(dt, input);
assert.equal(saved.respawnPending, 0);
for (let i = 0; i < 70; i++) saved.step(dt, input);
assert.equal(saved.poseRevision, 1, 'no belated reset after a valid save');

const manual = new VehicleController(track, true);
manual.place(track.placeAt(track.L * f, 0));
manual.pos.addScaledVector(p.right, p.width / 2 + CONFIG.recovery.deckOverhang + 1.1);
manual.step(dt, input);
manual.doReset('manual');
assert.equal(manual.fx.reset, 'manual');
assert.ok(manual.pos.distanceTo(track.placeAt(safeProgress - 4, 0).pos) < .35);
assert.equal(manual.resetTimer, CONFIG.recovery.resetDelay);
// R pressed OUTSIDE step still reaches the usual reset FX hook exactly once.
let notices = 0, chimes = 0;
const hud = { notify() { notices++; }, updateRace() {}, setWrongWay() {}, countdown() {}, onRaceStart() {} };
const audio = new Proxy({ reset() { chimes++; } }, { get: (o, k) => o[k] || (() => {}) });
const race = new RaceManager({ track, hud, audio, i18n: { t: k => k } });
const rider = new VehicleController(track, true);
const kart = { vehicle: rider, isPlayer: true, nameKey: 'ai.you' };
race.registerKart(kart); race.start([track.placeAt(0, 0)]); race.state = 'racing';
rider.place(track.placeAt(track.L * f, 0)); rider.doReset('manual');
for (let i = 0; i < 3; i++) race.update(dt);
assert.equal(chimes, 1); assert.equal(notices, 1);
const st = race.kartState.get(rider);
st.nextCp = 3; st.prevProg = track.L * .48;
rider.surf.progress = track.L * .53;
race._checkpoints(kart);
assert.equal(st.nextCp, 3, 'a reset cannot steal a checkpoint/lap');
assert.equal(st.prevProg, rider.surf.progress);
// Resetting/falling karts cannot be shoved by another kart at the same XZ.
const opponent = new VehicleController(track);
opponent.place(track.placeAt(0, 0));
opponent.pos.copy(rider.pos); opponent.pos.x += 1.3;
opponent.y = rider.y; opponent.pos.y = opponent.y;
race.registerKart({ vehicle: opponent, isPlayer: false, nameKey: 'ai.rival' });
const px = rider.pos.x, ox = opponent.pos.x;
race._collideKarts();
assert.equal(rider.pos.x, px); assert.equal(opponent.pos.x, ox);
rider.resetTimer = dt / 2;
rider.step(dt, input);
assert.equal(rider.resetTimer, 0);
assert.equal(rider.fx.recovering, true);
race._collideKarts();
assert.equal(rider.pos.x, px); assert.equal(opponent.pos.x, ox,
  'final frozen tick remains intangible, with no collision impulse');
rider.step(dt, input);
race._collideKarts();
assert.ok(rider.pos.x !== px || opponent.pos.x !== ox,
  'normal collision behavior resumes after the reset freeze');
console.log('PASS elevated drop, frozen safe-progress rescue, R parity, checkpoints and collision safety');

// Teleports rebase interpolation AND the chase camera, not only the solver.
const vis = buildKart(0xd88a32, 0x4dccc0, 0xffcf77);
const cam = new CameraController(new THREE.PerspectiveCamera(63, 1, .1, 900), track);
const actor = new VehicleController(track, true);
actor.place(track.placeAt(track.L * .9, 0));
updateKartVisual(vis, actor, dt, 0, 1); cam.snapTo(actor);
actor.place(track.placeAt(track.L * .4, 0));
updateKartVisual(vis, actor, dt, 1, 0);
assert.ok(vis.group.position.distanceTo(actor.pos) < 1e-7, 'alpha=0 does not replay pre-reset position');
cam.update(dt, actor, false, 1, vis.renderPose);
assert.ok(cam.pos.distanceTo(actor.pos) < 18, 'camera snaps to recovered kart rather than crossing the map');
console.log('PASS kart/camera pose revision on reset');

env.dispose();
assert.equal(previousLight.visible, true);
console.log('Verdant Loop regressions passed.');
