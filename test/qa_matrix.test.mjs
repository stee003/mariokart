// ============================================================================
// Release QA matrix - automated "test every track / every difficulty" pass.
//
//   DATA (all 16 tracks, all 4 arenas-agnostic defs):
//     - no checkpoint lies inside a shortcut arc (would strand lap counting)
//     - no shortcut is impossible/cheesy (bounded time-saving ratio)
//     - item boxes are reachable (on/near the road surface)
//
//   SIMULATION (all 16 tracks x beginner + master AI, sunforge x all 6 tiers):
//     - every AI kart finishes the race
//     - no NaN states, no permanently stuck karts, bounded rescue-resets
//     - AI never exceeds the physics speed envelope (no rubber-banding cheats)
// ============================================================================
import { CONFIG } from '../src/config.js';
import { TrackManager } from '../src/track.js';
import { TRACK_DEFS } from '../src/content/trackDefs.js';
import { VehicleController } from '../src/vehicle.js';
import { AIController } from '../src/ai.js';
import { RaceManager } from '../src/race.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

// Deterministic RNG: simulations are seeded per scenario so CI results are
// reproducible instead of flaking on Math.random luck.
const trueRandom = Math.random;
let lcgState = 1;
function seedRandom(seed) { lcgState = (seed >>> 0) || 1; }
function useLcg() {
  Math.random = () => {
    lcgState = (lcgState * 1103515245 + 12345) & 0x7fffffff;
    return lcgState / 0x7fffffff;
  };
}
function useTrueRandom() { Math.random = trueRandom; }

const stubHud = { onRaceStart() {}, countdown() {}, notify() {}, updateRace() {}, setWrongWay() {}, showResults() {} };
const stubAudio = new Proxy({}, { get: () => () => {} });
const stubI18n = { t: (k) => k };

// ------------------------------------------------------------- data checks
console.log('--- Shortcut & checkpoint fairness ---');
for (const def of TRACK_DEFS) {
  const track = new TrackManager(def);
  if (!track.shortcut) {
    check(`${def.id}: no shortcut - nothing skipped`, true);
  } else {
    const { entryProg, exitProg, len } = track.shortcut;
    const span = exitProg - entryProg;                 // forward arc it replaces
    // the start/finish line must never be replaceable by a shortcut chute
    const cp0 = track.checkpoints[0];
    const rel0 = ((cp0.s - entryProg) % track.L + track.L) % track.L;
    check(`${def.id}: shortcut never crosses the start line`, !(rel0 > 0 && rel0 < span));
    // the chute may be shorter, but never absurdly so (<= 45% saving)
    const saving = 1 - len / Math.max(1e-6, span);
    check(`${def.id}: shortcut saving bounded (${(saving * 100).toFixed(0)}%)`,
      saving <= 0.45, `save=${(saving * 100).toFixed(1)}%`);

    // DRIVE the chute end-to-end through real surface queries: every
    // checkpoint inside the replaced arc must register, never strand laps.
    const skippedIdx = track.checkpoints
      .filter((cp) => {
        const rel = ((cp.s - entryProg) % track.L + track.L) % track.L;
        return rel > 0 && rel < span;
      })
      .map((cp) => cp.idx);
    let ok = true, detail = '';
    if (skippedIdx.length) {
      for (const cpIdx of skippedIdx) {
        const race = new RaceManager({ track, hud: stubHud, audio: stubAudio, i18n: stubI18n });
        const v = { surf: null };
        const st = { nextCp: cpIdx, lap: 0, laps: 3, lapStart: 0, bestLap: null, lapTimes: [], prevProg: (entryProg - 6 + track.L) % track.L, finished: false, finishTime: null };
        const kart = { vehicle: v, nameKey: 'x', isPlayer: false };
        race.kartState.set(v, st);
        const hint = { main: -1, sc: -1 };
        const positions = [track.pointAt(entryProg - 6).pos, track.pointAt(entryProg - 3).pos];
        for (const sm of track.shortcut.samples) positions.push(sm.pos);
        positions.push(track.pointAt(exitProg + 3).pos, track.pointAt(exitProg + 6).pos);
        for (const pos of positions) {
          v.surf = track.surface(pos, hint);
          race._checkpoints(kart);
        }
        if (st.nextCp !== cpIdx + 1) { ok = false; detail = `cp#${cpIdx} nextCp=${st.nextCp}`; }
      }
    }
    check(`${def.id}: shortcut traversal registers in-arc checkpoints`, ok, detail + ` skipped=[${skippedIdx}]`);
  }
  // item boxes sit near the road
  let farBoxes = 0;
  for (const box of track.itemBoxes) {
    const p = track.pointAt(box.s);
    if (Math.abs(box.lat) > p.width / 2 + 3) farBoxes++;
  }
  check(`${def.id}: all item boxes reachable`, farBoxes === 0, `far=${farBoxes}`);
}

// ----------------------------------------------------------- race simulation
console.log('--- AI race matrix (x difficulty) ---');
const LIMIT = 500;
const MAX_SPEED_ENVELOPE = CONFIG.vehicle.maxSpeed * 1.55; // incl. L3 boost + small epsilon

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function simulate(def, tier) {
  useLcg();
  seedRandom(hashStr(def.id) ^ hashStr(tier));
  const track = new TrackManager(def);
  const race = new RaceManager({ track, hud: stubHud, audio: stubAudio, i18n: stubI18n });
  const karts = [];
  const resets = new Map();
  for (const p of ['aggressive', 'balanced', 'defensive', 'balanced']) {
    const v = new VehicleController(track, false);
    let count = 0;
    const orig = v.doReset.bind(v);
    v.doReset = (r) => { count++; orig(r); };
    resets.set(v, () => count);
    const kart = { vehicle: v, ai: new AIController(v, track, p), nameKey: 'ai.test', isPlayer: false };
    kart.ai.setDifficulty(tier);
    race.registerKart(kart);
    karts.push(kart);
  }
  race.start(track.startGrid());
  const dt = 1 / 60;
  let t = 0, nan = false, maxStuckStreak = 0, maxSpeedObserved = 0;
  const stuck = new Map();
  while (t < LIMIT) {
    race.update(dt);
    track.update(dt, t);
    t += dt;
    if (race.state === 'countdown') continue;
    for (const k of karts) {
      const v = k.vehicle;
      if (![v.pos.x, v.pos.z, v.y, v.yaw, v.fSpeed].every(Number.isFinite)) { nan = true; break; }
      maxSpeedObserved = Math.max(maxSpeedObserved, v.speedAbs);
      // "permanently stuck" = ~4s below walking speed outside resets
      const stuckT = (Math.abs(v.fSpeed) < 1.2 && v.resetTimer <= 0 && !race.kartState.get(v).finished)
        ? (stuck.get(v) || 0) + dt : 0;
      stuck.set(v, stuckT);
      maxStuckStreak = Math.max(maxStuckStreak, stuckT);
    }
    if (nan) break;
    if (karts.every((k) => race.kartState.get(k.vehicle).finished)) break;
    if (race.state === 'results') break;
  }
  const finished = karts.filter((k) => race.kartState.get(k.vehicle).finished).length;
  const totalResets = [...resets.values()].reduce((s, f) => s + f(), 0);
  return { t, finished, nan, maxStuckStreak, maxSpeedObserved, totalResets, karts };
}

for (const def of TRACK_DEFS) {
  for (const tier of ['beginner', 'master']) {
    const r = simulate(def, tier);
    check(`${def.id} [${tier}]: all 4 KI finish (${r.finished}/4 @ ${r.t.toFixed(0)}s)`,
      !r.nan && r.finished === 4);
    check(`${def.id} [${tier}]: no permanent stuck`,
      r.maxStuckStreak < 5.5, `stuck=${r.maxStuckStreak.toFixed(1)}s`);
    check(`${def.id} [${tier}]: rescues bounded (${r.totalResets})`, r.totalResets < 40);
    check(`${def.id} [${tier}]: no speed cheating`,
      r.maxSpeedObserved < MAX_SPEED_ENVELOPE, `vmax=${r.maxSpeedObserved.toFixed(1)}`);
  }
}

// the flagship track at every single tier
for (const tier of ['easy', 'normal', 'hard', 'expert']) {
  const r = simulate(TRACK_DEFS[0], tier);
  check(`sunforge_circuit [${tier}]: all 4 AI finish`, !r.nan && r.finished === 4);
}

// ---------------------------------------------------------------- summary
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
