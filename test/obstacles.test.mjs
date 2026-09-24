// ============================================================================
// Obstacle hitbox suite - "does the physical volume match the visible mesh?"
//
// Regression history:
//   * the gear's collider arm was placed with `z = +sin(angle)` while the
//     rendered group uses `rotation.y = angle`, which maps local +X onto world
//     (cos, -sin). The physical arm was therefore MIRRORED across the hub's X
//     axis: you were hit by nothing on the side you could see, and blocked by
//     an invisible arm on the other side.
//   * every obstacle was an infinitely tall circle, so hopping over the low
//     gear arm or a slider still counted as a hit.
//   * the flame jet used its authored radius for the collider while the visible
//     cone is flameScale (0.55) of that - the burn zone was ~2x the fire, and
//     the painted warning halos were drawn at the same wrong radius.
//   * the granite_pass quarry re-skins the pendulum crate as a 1.7 m boulder
//     without telling the physics, so the hitbox stayed crate-sized.
//
// These checks build the REAL environment and compare the colliders emitted by
// TrackManager against the world transforms of the meshes that were drawn.
// ============================================================================
import * as THREE from '../lib/three.module.js';
import { TrackManager, OBSTACLE_PROFILE, flameHazardRadius, resolveObstacleContact,
         KART_HIT_BOTTOM, KART_HIT_TOP } from '../src/track.js';
import { TRACK_DEFS } from '../src/content/trackDefs.js';
import { ARENAS } from '../src/content/arenas.js';
import { buildThemedEnvironment } from '../src/environment2.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ------------------------------------------------------------- canvas shim
global.document = {
  createElement: () => {
    const canvas = { width: 0, height: 0 };
    const ctx = new Proxy({}, {
      get: (_, key) => key === 'fillText' ? () => {}
        : key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {},
      set: () => true,
    });
    canvas.getContext = () => ctx;
    return canvas;
  },
};

const scene = new THREE.Scene();

// Build a world and return { track, env } with obstacle meshes synced.
function world(def, time = 0.9) {
  const track = new TrackManager(def);
  const env = buildThemedEnvironment(scene, track, 'TEST');
  track.update(0.016, time);
  env.state.update(0.016, time);
  env.group.updateMatrixWorld(true);
  return { track, env };
}

const collidersFor = (track) => track.getObstacleColliders();

// AABB of one collider, in world space.
function colliderBox(c) {
  if (c.kind === 'box') {
    return { x0: c.x - c.hx, x1: c.x + c.hx, z0: c.z - c.hz, z1: c.z + c.hz, y0: c.y0, y1: c.y1 };
  }
  if (c.kind === 'capsule') {
    const x0 = Math.min(c.x0, c.x1) - c.r, x1 = Math.max(c.x0, c.x1) + c.r;
    const z0 = Math.min(c.z0, c.z1) - c.r, z1 = Math.max(c.z0, c.z1) + c.r;
    return { x0, x1, z0, z1, y0: c.y0, y1: c.y1 };
  }
  return { x0: c.x - c.r, x1: c.x + c.r, z0: c.z - c.r, z1: c.z + c.r, y0: c.y0, y1: c.y1 };
}

// ==========================================================================
console.log('--- Gear: collider follows the rendered arm, not its mirror ---');
{
  const def = TRACK_DEFS.find((d) => d.id === 'skyline_helix');
  const { track, env } = world(def);
  const gear = track.obstacles.find((o) => o.type === 'gear');
  const entry = env.state.obstacleMeshes.find((m) => m.obstacle === gear);
  const [hub, arm, tipA, tipB] = entry.mesh.children;
  const prof = gear.profile || OBSTACLE_PROFILE.gear;

  const wp = (o) => o.getWorldPosition(new THREE.Vector3());
  const cols = collidersFor(track).filter((c) => c.hit === 'gear');

  // hub circle sits exactly on the rendered hub
  const hubW = wp(hub);
  const hubCol = cols.find((c) => c.kind === 'circle' && near(c.r, prof.hubRadius));
  check('hub collider is centred on the rendered hub',
    !!hubCol && near(hubCol.x, hubW.x) && near(hubCol.z, hubW.z),
    hubCol ? `col=(${hubCol.x.toFixed(2)},${hubCol.z.toFixed(2)}) mesh=(${hubW.x.toFixed(2)},${hubW.z.toFixed(2)})` : 'no hub collider');

  // both tip spheres must have a collider at their rendered centre
  const tips = [tipA, tipB].map(wp);
  const tipCols = cols.filter((c) => c.kind === 'circle' && near(c.r, prof.tipRadius));
  check('two tip colliders emitted', tipCols.length === 2, `n=${tipCols.length}`);
  const tipsMatched = tips.every((t) => tipCols.some((c) => near(c.x, t.x, 1e-6) && near(c.z, t.z, 1e-6)));
  check('tip colliders sit on the rendered tips', tipsMatched,
    `mesh=${tips.map((t) => `${t.x.toFixed(2)},${t.z.toFixed(2)}`).join(' | ')} ` +
    `col=${tipCols.map((c) => `${c.x.toFixed(2)},${c.z.toFixed(2)}`).join(' | ')}`);

  // the mirrored-arm regression, stated directly: rotation.y maps local +X to
  // world (cos, -sin), so at angle = pi/2 the tips move along -Z / +Z.
  gear.angle = Math.PI / 2;
  track.update(0, 0.9);
  env.state.update(0, 0.9);
  env.group.updateMatrixWorld(true);
  const mirrored = collidersFor(track).filter((c) => c.hit === 'gear' && near(c.r, prof.tipRadius));
  const mirrorTips = [tipA, tipB].map(wp);
  check('arm rotation direction matches the mesh at angle=pi/2 (no mirror)',
    mirrorTips.every((t) => mirrored.some((c) => near(c.x, t.x, 1e-6) && near(c.z, t.z, 1e-6))),
    `mesh=${mirrorTips.map((t) => `${t.x.toFixed(3)},${t.z.toFixed(3)}`).join(' | ')} ` +
    `col=${mirrored.map((c) => `${c.x.toFixed(3)},${c.z.toFixed(3)}`).join(' | ')}`);

  // arm capsule spans the rendered arm's world AABB
  gear.angle = 0.7;
  track.update(0, 0.9);
  env.state.update(0, 0.9);
  env.group.updateMatrixWorld(true);
  const armBox = new THREE.Box3().setFromObject(arm);
  const cap = collidersFor(track).find((c) => c.hit === 'gear' && c.kind === 'capsule');
  const capBox = colliderBox(cap);
  check('arm capsule covers the rendered arm footprint',
    capBox.x0 <= armBox.min.x + 1e-6 && capBox.x1 >= armBox.max.x - 1e-6 &&
    capBox.z0 <= armBox.min.z + 1e-6 && capBox.z1 >= armBox.max.z - 1e-6,
    `arm=[${armBox.min.x.toFixed(2)},${armBox.max.x.toFixed(2)}]x[${armBox.min.z.toFixed(2)},${armBox.max.z.toFixed(2)}] ` +
    `cap=[${capBox.x0.toFixed(2)},${capBox.x1.toFixed(2)}]x[${capBox.z0.toFixed(2)},${capBox.z1.toFixed(2)}]`);
  check('arm capsule is not grossly fatter than the rendered arm',
    capBox.x1 - capBox.x0 <= (armBox.max.x - armBox.min.x) + prof.armDepth + 1e-6);

  // vertical span matches the rendered arm box
  check('arm collider height matches the rendered arm',
    near(cap.y0, armBox.min.y, 1e-6) && near(cap.y1, armBox.max.y, 1e-6),
    `mesh=[${armBox.min.y.toFixed(2)},${armBox.max.y.toFixed(2)}] col=[${cap.y0.toFixed(2)},${cap.y1.toFixed(2)}]`);
}

// ==========================================================================
console.log('--- Slider / pendulum: box collider matches the rendered crate ---');
for (const id of ['neon_cascade', 'verdant_loop', 'forge_line', 'sandstone_crown']) {
  const def = TRACK_DEFS.find((d) => d.id === id);
  const { track, env } = world(def);
  for (const o of track.obstacles) {
    if (o.type !== 'slider' && o.type !== 'pendulum') continue;
    const entry = env.state.obstacleMeshes.find((m) => m.obstacle === o);
    const box = new THREE.Box3().setFromObject(entry.mesh);
    const col = collidersFor(track).find((c) => c.src === o);
    const cb = colliderBox(col);
    check(`${id}/${o.type}: footprint matches the rendered mesh`,
      near(cb.x0, box.min.x, 1e-6) && near(cb.x1, box.max.x, 1e-6) &&
      near(cb.z0, box.min.z, 1e-6) && near(cb.z1, box.max.z, 1e-6),
      `mesh=[${box.min.x.toFixed(2)},${box.max.x.toFixed(2)}] col=[${cb.x0.toFixed(2)},${cb.x1.toFixed(2)}]`);
    check(`${id}/${o.type}: height matches the rendered mesh`,
      near(cb.y0, box.min.y, 1e-6) && near(cb.y1, box.max.y, 1e-6),
      `mesh=[${box.min.y.toFixed(2)},${box.max.y.toFixed(2)}] col=[${cb.y0.toFixed(2)},${cb.y1.toFixed(2)}]`);
  }
}

// The quarry re-skins the pendulum as a boulder; the hitbox must follow.
console.log('--- Bespoke re-skins declare their own profile ---');
{
  const def = TRACK_DEFS.find((d) => d.id === 'granite_pass');
  const { track, env } = world(def);
  const pend = track.obstacles.find((o) => o.type === 'pendulum');
  const entry = env.state.obstacleMeshes.find((m) => m.obstacle === pend);
  const drawn = entry.mesh.geometry.parameters.radius;
  const col = collidersFor(track).find((c) => c.hit === 'pendulum');
  check('granite_pass pendulum declares a sphere profile', pend.profile?.shape === 'sphere',
    JSON.stringify(pend.profile));
  check('boulder collider uses the drawn radius', drawn > 0 && near(col.r, drawn, 1e-6),
    `drawn=${drawn} collider=${col.r}`);
  check('boulder collider is centred on the drawn rock',
    near(col.x, pend.pos.x) && near(col.z, pend.pos.z) &&
    near(col.y0, pend.pos.y - drawn) && near(col.y1, pend.pos.y + drawn));
}

// ==========================================================================
console.log('--- Flame jet: the burn zone is the visible fire ---');
for (const def of [TRACK_DEFS.find((d) => d.id === 'magma_coil'), ARENAS.find((a) => a.id === 'ember_forge')]) {
  const { track, env } = world(def, 0.1);
  const jets = track.obstacles.filter((o) => o.type === 'flamejet');
  // force every jet lit so the colliders exist
  for (const j of jets) j.active = true;
  const cols = collidersFor(track).filter((c) => c.hit === 'flame');
  check(`${def.id}: one collider per lit jet`, cols.length === jets.length, `${cols.length}/${jets.length}`);
  jets.forEach((j) => {
    const entry = env.state.obstacleMeshes.find((m) => m.obstacle === j && m.isFlame);
    const cone = entry.mesh.geometry.parameters;   // ConeGeometry(radius, height)
    const centre = entry.mesh.getWorldPosition(new THREE.Vector3());
    const c = cols.find((cc) => cc.src === j);
    check(`${def.id} jet: collider found for this jet`, !!c);
    if (!c) return;
    check(`${def.id} jet: radius equals the drawn cone base`,
      near(c.r, cone.radius, 1e-6) && near(c.r, flameHazardRadius(j.radius), 1e-6),
      `cone=${cone.radius.toFixed(2)} authored=${j.radius} collider=${c.r.toFixed(2)}`);
    check(`${def.id} jet: collider is narrower than the authored radius`,
      c.r < j.radius, `${c.r} !< ${j.radius}`);
    // Compare against the cone's NOMINAL height (the flicker only ever scales
    // the flame down from it, asserted next) - the collider is the volume the
    // fire occupies at full lick.
    check(`${def.id} jet: height span equals the drawn cone`,
      near(c.y0, centre.y - cone.height / 2, 1e-6) && near(c.y1, centre.y + cone.height / 2, 1e-6),
      `cone=[${(centre.y - cone.height / 2).toFixed(2)},${(centre.y + cone.height / 2).toFixed(2)}] ` +
      `col=[${c.y0.toFixed(2)},${c.y1.toFixed(2)}]`);
    check(`${def.id} jet: collider sits on the jet's world position`,
      near(c.x, j.pos.x) && near(c.z, j.pos.z));
  });
  // the animated flame must never be drawn outside its own hazard volume
  let worst = 0;
  for (const t of [0, 0.05, 0.1, 0.37, 1.3, 4.4]) {
    env.state.update(0.016, t);
    for (const m of env.state.obstacleMeshes) {
      if (m.isFlame) worst = Math.max(worst, m.mesh.scale.y);
    }
  }
  check(`${def.id}: flicker never exceeds the nominal cone`, worst <= 1 + 1e-9, `maxScale=${worst.toFixed(3)}`);
  // an unlit jet must not hurt anybody
  for (const j of jets) j.active = false;
  check(`${def.id}: unlit jets emit no collider`, collidersFor(track).filter((c) => c.hit === 'flame').length === 0);
}

// ==========================================================================
console.log('--- resolveObstacleContact: shapes, heights, buried centres ---');
{
  const KART_R = 1.45;
  const ground = [0 + KART_HIT_BOTTOM, 0 + KART_HIT_TOP];

  // circle
  const circ = { kind: 'circle', x: 0, z: 0, r: 1.5, y0: 0, y1: 1, hit: 't' };
  check('circle: far away is a miss', resolveObstacleContact(circ, 9, 9, ...ground, KART_R) === null);
  const touch = resolveObstacleContact(circ, 2.9, 0, ...ground, KART_R);
  check('circle: contact just inside the reach', !!touch && near(touch.nx, 1) && near(touch.pen, 0.05, 1e-6),
    JSON.stringify(touch));
  check('circle: exactly at the reach is a miss',
    resolveObstacleContact(circ, 1.5 + KART_R, 0, ...ground, KART_R) === null);
  check('circle: flying over it is a miss',
    resolveObstacleContact(circ, 0.4, 0, 1.4, 2.6, KART_R) === null);
  check('circle: driving under it is a miss',
    resolveObstacleContact(circ, 0.4, 0, -2.6, -1.4, KART_R) === null);

  // box
  const box = { kind: 'box', x: 0, z: 0, hx: 1.2, hz: 1.2, y0: -0.3, y1: 2.3, hit: 'slider' };
  const bHit = resolveObstacleContact(box, 2.0, 0, ...ground, KART_R);
  check('box: side contact pushes along +X', !!bHit && near(bHit.nx, 1) && near(bHit.pen, KART_R - 0.8, 1e-6),
    JSON.stringify(bHit));
  const bCorner = resolveObstacleContact(box, 1.6, 1.6, ...ground, KART_R);
  const dCorner = Math.hypot(1.6 - 1.2, 1.6 - 1.2);
  check('box: corner contact uses the closest point',
    !!bCorner && near(bCorner.pen, KART_R - dCorner, 1e-6) && near(bCorner.nx, 0.4 / dCorner, 1e-6));
  const buried = resolveObstacleContact(box, 0.2, 0.9, ...ground, KART_R);
  check('box: buried centre escapes along the shallowest axis',
    !!buried && near(buried.nz, 1) && near(buried.pen, KART_R + (1.2 - 0.9), 1e-6), JSON.stringify(buried));
  check('box: hopping over a slider clears it',
    resolveObstacleContact(box, 0.2, 0.2, 2.5, 3.8, KART_R) === null);

  // capsule
  const cap = { kind: 'capsule', x0: -6, z0: 0, x1: 6, z1: 0, r: 0.55, y0: 0.675, y1: 1.225, hit: 'gear' };
  const midHit = resolveObstacleContact(cap, 0, 1.2, ...ground, KART_R);
  check('capsule: mid-span contact', !!midHit && near(midHit.nz, 1) && near(midHit.pen, KART_R + 0.55 - 1.2, 1e-6),
    JSON.stringify(midHit));
  const pastEnd = resolveObstacleContact(cap, 8, 0, ...ground, KART_R);
  check('capsule: beyond the end caps is a miss', pastEnd === null);
  const nearEnd = resolveObstacleContact(cap, 6.4, 0.4, ...ground, KART_R);
  check('capsule: rounded end cap still connects', !!nearEnd);
  check('capsule: a kart under the gear arm is not clipped',
    resolveObstacleContact(cap, 0, 0.2, -1.5, -0.4, KART_R) === null);
  check('capsule: a kart above the gear arm clears it (tips still catch it)',
    resolveObstacleContact(cap, 0, 0.2, 1.3, 2.6, KART_R) === null);
}

// ==========================================================================
console.log('--- Every world emits finite, sane colliders ---');
{
  const defs = [...TRACK_DEFS, ...ARENAS];
  let bad = [];
  let total = 0;
  for (const def of defs) {
    if (!(def.obstacles || []).length) continue;
    const track = new TrackManager(def);
    for (const t of [0, 0.7, 3.3, 11.1]) {
      track.update(0.016, t);
      for (const j of track.obstacles) if (j.type === 'flamejet') j.active = true;
      for (const c of track.getObstacleColliders()) {
        total++;
        const b = colliderBox(c);
        const finite = [b.x0, b.x1, b.z0, b.z1, b.y0, b.y1].every(Number.isFinite);
        const sane = b.x1 > b.x0 && b.z1 > b.z0 && b.y1 > b.y0;
        // the hazard must be reachable from the road it guards: within 30 m of
        // its authored centre line sample
        if (!finite || !sane) bad.push(`${def.id}@${t}`);
      }
    }
  }
  check('all colliders are finite and non-degenerate', bad.length === 0, bad.join(','));
  check('colliders were actually produced', total > 40, `n=${total}`);
}

// ==========================================================================
console.log('--- A kart really does clear a low obstacle now ---');
{
  // Physical proof of the height test: place a kart at road height next to the
  // gear arm and confirm contact, then lift it above the arm and confirm none.
  const def = TRACK_DEFS.find((d) => d.id === 'ruins_of_vael');
  const track = new TrackManager(def);
  const gear = track.obstacles.find((o) => o.type === 'gear');
  gear.angle = 0;                       // arm lies along world +X / -X
  track.update(0, 0);
  const cols = collidersFor(track).filter((c) => c.hit === 'gear');
  const arm = cols.find((c) => c.kind === 'capsule');
  const probeX = gear.center.x + gear.armRadius * 0.6;
  const probeZ = gear.center.z;
  const roadLevel = [gear.center.y + KART_HIT_BOTTOM, gear.center.y + KART_HIT_TOP];
  const airborne = [gear.center.y + 1.6, gear.center.y + 2.9];
  const hitGround = cols.some((c) => resolveObstacleContact(c, probeX, probeZ, ...roadLevel, 1.45));
  const hitAir = cols.filter((c) => c.kind === 'capsule')
    .some((c) => resolveObstacleContact(c, probeX, probeZ, ...airborne, 1.45));
  check('grounded kart on the arm line is hit', hitGround);
  check('airborne kart clears the arm itself', !hitAir, `arm y=[${arm.y0.toFixed(2)},${arm.y1.toFixed(2)}]`);
}

// ==========================================================================
console.log('--- The AI can actually drive past what it now collides with ---');
{
  // Regression: accurate hitboxes turned obstacles into real walls. A sliding
  // block presents a FLAT face across the racing line, and the gear arm sweeps
  // the whole road broadside-on. An AI that only followed the authored line
  // drove straight in, stopped dead (the old oversized circles used to deflect
  // it around by luck), and its recovery reset dropped it back behind the same
  // obstacle - an endless stall loop that never completed a lap.
  //
  // The AI now maps the colliders ahead into track space, merges them into
  // blocked lateral intervals, picks an open side, and holds short of a sweep
  // until a gap appears. Every world with obstacles must be drivable solo.
  const { VehicleController } = await import('../src/vehicle.js');
  const { AIController } = await import('../src/ai.js');
  const dt = 1 / 60;
  const BUDGET = 150;                     // simulated seconds per world
  const defs = [...TRACK_DEFS, ...ARENAS].filter((d) => (d.obstacles || []).length);
  const stalled = [];
  let waited = 0;
  for (const def of defs) {
    const track = new TrackManager(def);
    const v = new VehicleController(track, true);
    const ai = new AIController(v, track, 'balanced');
    const kart = { vehicle: v, ai, nameKey: 'ai.you', isPlayer: true };
    v.place(track.placeAt(0, 0));
    v.step(dt, { throttle: 0, brake: 0, steer: 0, drift: false, trick: false }, false);
    let resets = 0;
    const realReset = v.doReset.bind(v);
    v.doReset = (reason, lat) => { resets++; return realReset(reason, lat); };

    let prev = v.surf.progress, dist = 0, t = 0;
    while (t < BUDGET && dist < track.L * 0.85) {
      v.step(dt, ai.update(dt, [kart], true), false);
      track.update(dt, t);                // obstacles move, as they do in game
      t += dt;
      waited = Math.max(waited, ai._waitT || 0);
      let d = v.surf.progress - prev;
      if (d < -track.L / 2) d += track.L;
      if (d > track.L / 2) d -= track.L;
      dist += d;
      prev = v.surf.progress;
    }
    if (dist < track.L * 0.85 || resets > 3) {
      stalled.push(`${def.id}(${(dist / track.L * 100).toFixed(0)}%,${resets}r)`);
    }
  }
  check(`every obstacle world is drivable by the AI (${defs.length} worlds)`,
    stalled.length === 0, stalled.join(' '));
  check('the AI really does hold short of a sweeping obstacle', waited > 0.4,
    `longest hold=${waited.toFixed(2)}s`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
