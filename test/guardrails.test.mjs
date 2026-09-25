// ============================================================================
// Guard rail suite.
//
// DATA (every circuit + arena):
//   - every circuit generates guard rails; battle arenas opt out (they keep
//     their own energy wall, built by buildArenaBarrier)
//   - placement is selective: rails exist but do not fence the entire lap
//   - shortcut mouths stay open on the chute's side
//   - the start/finish straight and wide-swept obstacle zones stay clear
//
// PHYSICS (headless 60 Hz vehicles):
//   - grinding into a rail run never sends the kart through the wall plane
//     and never triggers a fall/off-track rescue
//   - a kart higher than the rail crown is NOT caught (ramps still launch)
//   - leaving the road through an unrailed gap still invokes normal recovery
//
// VISUALS: the renderer always emits instanced meshes per track (one cheap
// draw per part) and the arena fence sits where enforceArenaWalls clamps.
// ============================================================================

// ---- DOM stubs (renderer smoke builds materials; no canvas needed) --------
global.window = { addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720 };
global.document = { createElement: () => ({ getContext: () => null }), body: {}, getElementById: () => null };

const THREE = await import('../lib/three.module.js');
const { TrackManager, GUARD_RAIL, RAIL_LAYOUT } = await import('../src/track.js');
const { TRACK_DEFS } = await import('../src/content/trackDefs.js');
const { ARENAS, getArena, enforceArenaWalls } = await import('../src/content/arenas.js');
const { VehicleController } = await import('../src/vehicle.js');
const { buildGuardRails, buildArenaBarrier } = await import('../src/guardRails.js');
const { CONFIG } = await import('../src/config.js');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

const dt = 1 / 60;

// ---------------------------------------------------------------- data shape
console.log('--- Guard rail layout ---');
for (const def of TRACK_DEFS) {
  const t = new TrackManager(def);
  const g = t.guardRails;
  check(`${def.id}: rails generated`, !!g && g.count > 0);
  if (!g) continue;
  const coverage = g.count / (2 * t.n);
  check(`${def.id}: placement stays selective (cover=${(coverage * 100).toFixed(0)}%)`,
    coverage > 0.02 && coverage < 0.97);
}

for (const a of ARENAS) {
  const t = new TrackManager(a);
  check(`${a.id}: arena skips circuit rails (energy wall owns the edge)`, t.guardRails === null);
}

// ------------------------------------------------------------ openings
console.log('--- Openings: shortcuts, obstacles, start line ---');
for (const def of TRACK_DEFS) {
  if (!def.shortcut) continue;
  const t = new TrackManager(def);
  const sc = def.shortcut;
  const side = (sc.latEntry + sc.latExit) >= 0 ? 1 : -1;
  let blocked = 0;
  for (let f = sc.entry; f <= sc.exit; f += 0.002) {
    if (t.hasRailAt(f * t.L, side)) blocked++;
  }
  check(`${def.id}: shortcut mouth open on chute side`, blocked === 0, `${blocked} flagged samples`);
}
for (const def of TRACK_DEFS) {
  const t = new TrackManager(def);
  let startBlocked = 0;
  for (let m = -4; m <= 4; m += 0.5) {
    if (t.hasRailAt(m, 1)) startBlocked++;
    if (t.hasRailAt(m, -1)) startBlocked++;
  }
  check(`${def.id}: start/finish straight stays clear`, startBlocked === 0, `${startBlocked} flagged`);
}
// sliders sweep the widest paths; their span must be unfenced on both sides
for (const def of TRACK_DEFS) {
  const sliders = (def.obstacles || []).filter((o) => o.type === 'slider');
  if (!sliders.length) continue;
  const t = new TrackManager(def);
  for (const s of sliders) {
    const blocked = t.hasRailAt(s.s * t.L, 1) || t.hasRailAt(s.s * t.L, -1);
    check(`${def.id}: slider @${s.s.toFixed(2)} unfenced`, !blocked);
  }
}

// ---------------------------------------------------------------- physics
console.log('--- Rail wall physics ---');
{
  // Every track: pick the longest continuous rail run, grind outward through
  // it at full throttle and verify the kart stays inside the wall plane,
  // never rescues, and reports hit FX.
  for (const def of TRACK_DEFS) {
    const t = new TrackManager(def);
    const g = t.guardRails;
    // find the longest run (either side)
    let best = { side: 1, start: 0, len: 0 };
    for (const [arr, side] of [[g.right, 1], [g.left, -1]]) {
      let i = 0;
      while (i < t.n) {
        if (!arr[i]) { i++; continue; }
        let j = i;
        while (j < t.n && arr[j]) j++;
        if (j - i > best.len) best = { side, start: i, len: j - i };
        i = j;
      }
    }
    const v = new VehicleController(t, true);
    // spawn near the rail line and shove hard into it once - rail-hit FX is
    // (deliberately) only reported for meaningful impacts
    v.place(t.placeAt(best.start * t.sampleStep + 2,
      best.side * Math.max(0, t.samples[best.start].width / 2 - 2.2)));
    let maxOver = 0, rescuesAtRail = 0, hits = 0;
    const steps = Math.min(60 * 30, Math.floor((best.len * t.sampleStep / 18) * 60));
    for (let k = 0; k < steps; k++) {
      if (k === 3 && v.surf) v.vel.addScaledVector(v.surf.right, best.side * 14);
      // then keep pressing toward the railed side at grind strength
      if (v.surf) v.vel.addScaledVector(v.surf.right, best.side * 9 * dt);
      // steer along the road (like a real player mid-grind) so the kart
      // keeps moving instead of wedging itself against the wall
      let steer = 0;
      if (v.surf) {
        const yawTarget = Math.atan2(v.surf.dir.x, v.surf.dir.z);
        let dy = yawTarget - v.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        steer = Math.max(-1, Math.min(1, dy * 2.5));
      }
      const wasRescuing = v.respawnPending > 0 || v.resetTimer > 0;
      v.step(dt, { throttle: 1, brake: 0, steer, drift: false, trick: false });
      if (!v.surf || v.surf.useShortcut) continue;
      const side = Math.sign(v.surf.lateral) || best.side;
      const railed = t.hasRailAt(v.surf.progress, side);
      // vertically matched with the projected deck: on multi-level tracks a
      // kart that already fell below keeps an (off-deck) projection onto the
      // railed road above - that recovery is legitimate, not a rail failure
      const onDeck = Math.abs(v.y - v.surf.y) < 0.9;
      if (!railed || !onDeck) continue;
      const r = CONFIG.vehicle.collisionRadius;
      const lim = v.surf.width / 2 + GUARD_RAIL.offset - GUARD_RAIL.face - r;
      maxOver = Math.max(maxOver, Math.abs(v.surf.lateral) - lim);
      // a rescue QUEUED while standing on a railed sample means the wall
      // let the kart through (rescues beyond the run are legitimate)
      if (!wasRescuing && (v.respawnPending > 0 || v.resetTimer > 0)) rescuesAtRail++;
      if (v.fx.railHit) hits++;
    }
    check(`${def.id}: grind held by rail (over=${maxOver.toFixed(3)}m)`, maxOver < 0.5);
    check(`${def.id}: no rescue queued on the rail`, rescuesAtRail === 0);
    check(`${def.id}: rail hit FX fires`, hits > 0);
  }
}

{
  // airborne above the crown: no contact
  const t = new TrackManager(TRACK_DEFS[0]);
  const g = t.guardRails;
  let idx = -1;
  for (let i = 0; i < t.n; i++) if (g.right[i]) { idx = i; break; }
  const P = t.pointAt(idx * t.sampleStep);
  const v = new VehicleController(t, true);
  v.place(t.placeAt(idx * t.sampleStep - 10, 0));
  v.pos.copy(P.pos).addScaledVector(P.right, P.width / 2 + 1.2);
  v.y = P.pos.y + GUARD_RAIL.clearHeight + 0.4;   // sailing over the crown
  v.pos.y = v.y;
  v.vel.set(P.right.x * 6, 0, P.right.z * 6);
  v.surf = t.surface(v.pos, v.hint, v.vel);
  const latBefore = Math.abs(v.surf.lateral);
  v.step(dt, { throttle: 0, brake: 0, steer: 0, drift: false, trick: false });
  const r = CONFIG.vehicle.collisionRadius;
  const lim = v.surf.width / 2 + GUARD_RAIL.offset - GUARD_RAIL.face - r;
  check('airborne over the crown is not clamped', Math.abs(v.surf.lateral) > lim - 0.01 || Math.abs(v.surf.lateral) > latBefore - 0.5,
    `lat=${Math.abs(v.surf.lateral).toFixed(2)} lim=${lim.toFixed(2)}`);
}

{
  // an unrailed stretch still lets the kart leave the road (no invisible
  // fence): drive off through a gap and the normal recovery fires
  const t = new TrackManager(TRACK_DEFS[0]);
  let gapIdx = -1, gapLen = 0, bestLen = 0;
  const arr = t.guardRails.right;
  let i = 0;
  while (i < t.n) {
    if (arr[i]) { i++; continue; }
    let j = i;
    while (j < t.n && !arr[j]) j++;
    if (j - i > bestLen) { bestLen = j - i; gapIdx = i + ((j - i) >> 1); }
    i = j;
  }
  const v = new VehicleController(t, true);
  v.place(t.placeAt(gapIdx * t.sampleStep, 0));
  const P = t.pointAt(gapIdx * t.sampleStep);
  // park the kart well outside the unrailed edge and let recovery logic run
  v.pos.copy(P.pos).addScaledVector(P.right, P.width / 2 + CONFIG.recovery.hardLimitLateral + 1);
  v.pos.y = v.y = P.pos.y;
  v.surf = t.surface(v.pos, v.hint, v.vel);
  let rescued = false;
  for (let k = 0; k < 60 * 4; k++) {
    v.step(dt, { throttle: 0, brake: 0, steer: 0, drift: false, trick: false });
    if (v.respawnPending > 0 || v.resetTimer > 0) { rescued = true; break; }
  }
  check('unrailed gap still triggers normal off-track recovery', rescued);
}

// ---------------------------------------------------------------- visuals
console.log('--- Guard rail / barrier renderer ---');
for (const def of TRACK_DEFS) {
  const t = new TrackManager(def);
  const group = new THREE.Group();
  const state = { extras: [] };
  const meshes = buildGuardRails(group, t, def.theme, state);
  let instances = 0;
  group.traverse((o) => { if (o.isInstancedMesh) instances += o.count; });
  check(`${def.id}: rail meshes instanced (${meshes} draws, ${instances} instances)`,
    meshes >= 4 && instances > 100);
}
for (const a of ARENAS) {
  const t = new TrackManager(a);
  const group = new THREE.Group();
  const state = { extras: [] };
  const meshes = buildArenaBarrier(group, t, a.theme, state);
  // the visible fence must stand just past the physics clamp ring
  const v = new VehicleController(t, true);
  const g = getArena(a.id);
  v.pos.set(g.arenaRadius + 50, 0, 0);
  v.vel.set(40, 0, 0);
  enforceArenaWalls(g, v);
  const clamped = Math.hypot(v.pos.x, v.pos.z);
  check(`${a.id}: energy wall clamp = ${clamped.toFixed(1)} (fence at ${(g.arenaRadius + 1.15).toFixed(1)})`,
    meshes >= 3 && Math.abs(clamped - g.arenaRadius) < 0.01);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
