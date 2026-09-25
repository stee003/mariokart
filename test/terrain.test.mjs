// ============================================================================
// Terrain following regression suite.
//
// Regression history: bumps and elevation changes used to break kart movement
// and animation. Four distinct defects fed into that:
//   1. surface() clamped the road-height interpolation at the sample behind
//      the kart, making the ground piecewise-CONSTANT - every 1.5 m the
//      terrain stepped instead of sloping.
//   2. _nearest() partitioned candidate samples with a hard 2.2 m height
//      band, so drifting across the band edge flipped the query to a deck
//      metres away in a single step.
//   3. Ramps were applied as a hard override inside a rectangle: crossing a
//      ramp edge teleported the kart by the full rise.
//   4. The shortcut was claimed on lateral distance alone, so a kart on the
//      far side of the loop could snap onto it and warp its progress.
// The vehicle read every one of those discontinuities as "the ground fell
// away" and launched the kart, producing the jitter/air-stutter.
//
// These tests assert the ground stays CONTINUOUS under a driving kart, and
// that the visual attitude the renderer consumes tracks the real slope.
// ============================================================================
import { TrackManager } from '../src/track.js';
import { TRACK_DEFS } from '../src/content/trackDefs.js';
import { VehicleController } from '../src/vehicle.js';
import { AIController } from '../src/ai.js';
import { CONFIG } from '../src/config.js';
import { buildRampBandGeometry } from '../src/terrainMesh.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

const dt = 1 / 60;
const T = CONFIG.terrain;

// Deterministic RNG: the AI wobbles via Math.random, so seed it per track to
// keep CI reproducible instead of flaking on one unlucky lap.
const trueRandom = Math.random;
let lcg = 1;
function seed(n) { lcg = (n >>> 0) || 1; }
function useLcg() {
  Math.random = () => { lcg = (lcg * 1103515245 + 12345) & 0x7fffffff; return lcg / 0x7fffffff; };
}
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------- surface continuity
console.log('--- Surface continuity (static sampling) ---');
for (const def of TRACK_DEFS) {
  const track = new TrackManager(def);
  // Walk the centreline in small steps and require the ground height to move
  // smoothly. Ramps are genuine geometry, so the bound is a GRADE, not a
  // constant: over 0.25 m no surface may rise or fall more than 0.35 m.
  const hint = { main: -1, sc: -1 };
  // A ramp LIP is a deliberate cliff (that is the jump), so the stretch just
  // past each ramp exit is excluded; everything else must be smooth.
  const nearLip = (s) => (track.ramps || []).some((r) => {
    let rel = s - r.s1;
    if (rel < -track.L / 2) rel += track.L;
    if (rel > track.L / 2) rel -= track.L;
    return rel > -1.0 && rel < 2.0;
  });
  let maxJump = 0, at = 0;
  let prev = null;
  for (let s = 0; s < track.L; s += 0.25) {
    const p = track.pointAt(s);
    const pos = p.pos.clone();
    if (prev !== null) {
      pos.y = prev;                       // carry altitude, like a real kart
      const surf = track.surface(pos, hint);
      if (!nearLip(s) && Math.abs(surf.y - prev) > maxJump) {
        maxJump = Math.abs(surf.y - prev); at = s;
      }
      prev = surf.y;
    } else {
      prev = track.surface(pos, hint).y;
    }
  }
  check(`${def.id}: centreline height is continuous`, maxJump < 0.35,
    `max step ${maxJump.toFixed(3)}m at s=${at.toFixed(0)}`);
}

// ------------------------------------------------------- ramp profile is smooth
console.log('--- Ramp profiles blend in and out ---');
for (const def of TRACK_DEFS) {
  const track = new TrackManager(def);
  if (!track.ramps?.length) { check(`${def.id}: no ramps`, true); continue; }
  let ok = true, why = '';
  for (const r of track.ramps) {
    const hint = { main: -1, sc: -1 };
    // sweep laterally across the ramp deck at its midpoint: the height must
    // feather back to the road rather than dropping off a cliff
    const mid = track.pointAt(r.s0 + r.len * 0.5);
    let prevY = null;
    for (let lat = r.lat - r.halfW - 3; lat <= r.lat + r.halfW + 3; lat += 0.1) {
      const pos = mid.pos.clone().addScaledVector(mid.right, lat);
      pos.y = prevY ?? (r.baseY + r.rise);
      const surf = track.surface(pos, hint);
      if (prevY !== null && Math.abs(surf.y - prevY) > 0.3) {
        ok = false; why = `lateral step ${(surf.y - prevY).toFixed(2)}m at lat=${lat.toFixed(1)}`;
        break;
      }
      prevY = surf.y;
    }
    if (!ok) break;
    // and the deck still reaches its full height at the lip
    const lip = track.pointAt(r.s1 - 0.3);
    const lipPos = lip.pos.clone().addScaledVector(lip.right, r.lat);
    lipPos.y = r.baseY + r.rise;
    const lipSurf = track.surface(lipPos, { main: -1, sc: -1 });
    if (Math.abs(lipSurf.y - (r.baseY + r.rise)) > 0.4) {
      ok = false; why = `lip height ${lipSurf.y.toFixed(2)} want ${(r.baseY + r.rise).toFixed(2)}`;
    }
  }
  check(`${def.id}: ramps feather laterally and reach full height`, ok, why);
}

// --------------------------------------- rendered/physical ramp are identical
console.log('--- Ramp visuals share the physical contact profile ---');
for (const def of TRACK_DEFS) {
  const track = new TrackManager(def);
  const r = track.ramps?.[0];
  if (!r) { check(`${def.id}: no ramp mesh needed`, true); continue; }

  // terrainMesh stores the source progress/lateral beside every generated
  // vertex. Its world Y must be the canonical collision Y plus only the tiny
  // anti-z-fighting render offset.
  const geo = buildRampBandGeometry(track, r, {
    lateralA: r.lat - r.halfW - r.feather,
    lateralB: r.lat + r.halfW + r.feather,
  });
  const attr = geo.getAttribute('position');
  const source = geo.userData.surfaceSamples;
  let maxError = 0;
  for (let i = 0; i < source.length; i++) {
    maxError = Math.max(maxError, Math.abs(attr.getY(i) - (source[i].surfaceY + 0.045)));
  }
  check(`${def.id}: visible ramp vertices match collision height`, maxError < 1e-4,
    `error=${maxError.toFixed(6)}`);
  geo.dispose();

  // The attitude gradient must also be the derivative of that same profile,
  // including on the tapered shoulder (the former grade*w approximation was
  // visibly wrong here).
  const s = r.s0 + r.len * 0.47;
  const lat = r.lat + r.halfW + r.feather * 0.43;
  const e = 0.015;
  const sample = track.rampSurfaceAt(r, s, lat);
  const slopeNum = (track.rampSurfaceAt(r, s + e, lat).y
    - track.rampSurfaceAt(r, s - e, lat).y) / (2 * e);
  const bankNum = (track.rampSurfaceAt(r, s, lat + e).y
    - track.rampSurfaceAt(r, s, lat - e).y) / (2 * e);
  check(`${def.id}: ramp animation gradient matches physical profile`,
    Math.abs(sample.slope - slopeNum) < 0.025 && Math.abs(sample.bank - bankNum) < 0.025,
    `slope ${sample.slope.toFixed(3)}/${slopeNum.toFixed(3)} bank ${sample.bank.toFixed(3)}/${bankNum.toFixed(3)}`);
}

// --------------------------------------------------- driving stays glued down
console.log('--- Driving a full lap stays glued to the ground ---');
for (const def of TRACK_DEFS) {
  useLcg(); seed(hash(def.id));
  const track = new TrackManager(def);
  const v = new VehicleController(track, false);
  const ai = new AIController(v, track, 'balanced');
  v.place(track.startGrid(4)[3]);

  let bigJumps = 0, microAir = 0, airRun = 0, groundedSurfJumps = 0;
  let prevY = v.y, prevGrounded = true, prevSurfY = v.surf ? v.surf.y : v.y;
  let prevOnSc = v.surf?.useShortcut, prevProg = v.surf?.progress ?? 0;
  let prevLat = v.surf?.lateral ?? 0;
  let badAttitude = 0;
  const STEPS = 60 * 90;

  for (let i = 0; i < STEPS; i++) {
    const input = ai.update(dt, [{ vehicle: v }], true);
    v.step(dt, input, false);
    track.update(dt, i * dt);
    if (v.resetTimer > 0) {
      prevY = v.y; prevGrounded = v.grounded; prevSurfY = v.surf?.y ?? v.y;
      prevOnSc = v.surf?.useShortcut; prevProg = v.surf?.progress ?? prevProg;
      prevLat = v.surf?.lateral ?? prevLat;
      continue;
    }

    // A kart that stays on the ground must never teleport vertically.
    // (Touching down after a jump legitimately closes a gap in one step.)
    if (v.grounded && prevGrounded && Math.abs(v.y - prevY) > 0.9) bigJumps++;
    // The ground under a grounded kart must not jump - EXCEPT when the query
    // legitimately swaps deck (crossing a shortcut mouth, or the overlapping
    // decks of a helix). Those report a different surface by definition; what
    // matters is that the kart itself is re-seated smoothly, which the check
    // above already asserts. A lateral re-seat counts too: when a kart cuts
    // deep inside a hairpin, the surface match eventually releases the
    // trailing leg and re-attaches metres to the side - reported lateral
    // changes by half a road in one step, which can step the ramp feather
    // edge (and with it the reported ground) even though the kart's own
    // altitude still follows continuously.
    const deckSwap = v.surf?.useShortcut !== prevOnSc
      || Math.abs((v.surf?.progress ?? 0) - prevProg) > 8
      || Math.abs((v.surf?.lateral ?? 0) - prevLat) > 4;
    if (v.grounded && prevGrounded && v.surf && !deckSwap &&
        Math.abs(v.surf.y - prevSurfY) > 0.5) groundedSurfJumps++;
    // "micro air": airborne for only a frame or two = bump chatter
    if (!v.grounded) airRun++;
    else { if (airRun > 0 && airRun < 8) microAir++; airRun = 0; }
    // the attitude handed to the renderer must stay finite and bounded
    if (!Number.isFinite(v.terrainPitch) || !Number.isFinite(v.terrainRoll) ||
        Math.abs(v.terrainPitch) > T.maxPitch + 1e-6 || Math.abs(v.terrainRoll) > T.maxRoll + 1e-6 ||
        !Number.isFinite(v.suspension) || v.suspension < 0 || v.suspension > 1.001) badAttitude++;

    prevY = v.y; prevGrounded = v.grounded; prevSurfY = v.surf?.y ?? prevSurfY;
    prevOnSc = v.surf?.useShortcut; prevProg = v.surf?.progress ?? prevProg;
    prevLat = v.surf?.lateral ?? prevLat;
  }
  // multi-deck circuits may re-seat once or twice per lap at a chute mouth
  check(`${def.id}: no kart-altitude teleports while grounded`, bigJumps <= 1, `jumps=${bigJumps}`);
  check(`${def.id}: ground never jumps under a grounded kart`, groundedSurfJumps === 0, `n=${groundedSurfJumps}`);
  check(`${def.id}: no bump chatter (micro air-times)`, microAir <= 2, `microAir=${microAir}`);
  check(`${def.id}: terrain attitude stays finite and bounded`, badAttitude === 0, `bad=${badAttitude}`);
  Math.random = trueRandom;
}

// ------------------------------------------------------- frame-rate invariance
console.log('--- Terrain following is frame-rate independent ---');
{
  // The same drive at 30, 60 and 144 Hz must end up in the same place: the
  // snap/climb budgets are rates, not per-frame constants.
  const ends = [];
  for (const hz of [30, 60, 144]) {
    const track = new TrackManager(TRACK_DEFS[0]);
    const v = new VehicleController(track, false);
    v.place(track.placeAt(60, 0));
    const h = 1 / hz;
    for (let t = 0; t < 30; t += h) {
      v.step(h, { throttle: 1, brake: 0, steer: 0, drift: false, trick: false }, false);
    }
    ends.push({ hz, prog: v.surf.progress, y: v.y });
  }
  const spread = Math.max(...ends.map(e => e.prog)) - Math.min(...ends.map(e => e.prog));
  check('progress after 30s agrees across 30/60/144 Hz', spread < 25,
    ends.map(e => `${e.hz}Hz:${e.prog.toFixed(0)}m`).join(' '));
  const ySpread = Math.max(...ends.map(e => e.y)) - Math.min(...ends.map(e => e.y));
  check('ground height agrees across frame rates', ySpread < 0.6,
    ends.map(e => `${e.hz}Hz:${e.y.toFixed(2)}`).join(' '));
}

// -------------------------------------------------------- ramps still launch
console.log('--- Ramps still launch (the fix must not flatten the game) ---');
{
  const track = new TrackManager(TRACK_DEFS[0]);
  const r = track.ramps[0];
  const v = new VehicleController(track, false);
  v.place(track.placeAt(r.s0 - 40, r.lat));
  let launched = false, peak = 0, coherentY = true;
  let ascentPitch = 0, descentPitch = 0;
  for (let t = 0; t < 8; t += dt) {
    v.step(dt, { throttle: 1, brake: 0, steer: 0, drift: false, trick: false }, false);
    coherentY &&= Math.abs(v.pos.y - v.y) < 1e-9;
    if (!v.grounded && v.vy > 1) {
      launched = true;
      peak = Math.max(peak, v.vy);
      ascentPitch = Math.max(ascentPitch, v.terrainPitch);
    }
    if (!v.grounded && v.vy < -1) descentPitch = Math.min(descentPitch, v.terrainPitch);
  }
  check('a real ramp still throws the kart airborne', launched, `vy=${peak.toFixed(2)}`);
  check('world transform stays attached to the physical jump', coherentY);
  check('jump attitude follows ascent then descent', ascentPitch > 0.04 && descentPitch < -0.01,
    `up=${ascentPitch.toFixed(3)} down=${descentPitch.toFixed(3)}`);
}

// ------------------------------------------------- attitude tracks real slope
console.log('--- Visual attitude follows the real slope ---');
{
  const track = new TrackManager(TRACK_DEFS[0]);
  const r = track.ramps[0];
  const v = new VehicleController(track, false);
  v.place(track.placeAt(r.s0 - 40, r.lat));
  let maxPitchOnRamp = 0, pitchWhileFlat = 0;
  for (let t = 0; t < 8; t += dt) {
    v.step(dt, { throttle: 1, brake: 0, steer: 0, drift: false, trick: false }, false);
    if (v.grounded && v.surf?.onRamp) maxPitchOnRamp = Math.max(maxPitchOnRamp, v.terrainPitch);
    else if (v.grounded && Math.abs(v.surf?.slope ?? 0) < 0.01) {
      pitchWhileFlat = Math.max(pitchWhileFlat, Math.abs(v.terrainPitch));
    }
  }
  check('chassis pitches nose-up climbing a ramp', maxPitchOnRamp > 0.05, `pitch=${maxPitchOnRamp.toFixed(3)}`);
  check('chassis stays level on flat road', pitchWhileFlat < 0.12, `pitch=${pitchWhileFlat.toFixed(3)}`);
}

// --------------------------------------------------- reset clears the attitude
{
  const track = new TrackManager(TRACK_DEFS[0]);
  const v = new VehicleController(track, false);
  v.place(track.placeAt(100, 0));
  v.terrainPitch = 0.4; v.terrainRoll = -0.3; v.suspension = 0.8;
  v.place(track.placeAt(120, 0));
  check('place() clears the terrain attitude',
    v.terrainPitch === 0 && v.terrainRoll === 0 && v.suspension === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
