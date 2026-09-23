// Track pipeline tests.
// For EVERY track definition: geometry integrity, racing line sanity, and a
// headless 4-kart AI race to the finish (no NaN, sane winner time).
// Also verifies the no-arg TrackManager still reproduces the original
// Sunforge Circuit from the vertical slice.
import { TrackManager } from '../src/track.js';
import { TRACK_DEFS, SUNFORGE_DEF } from '../src/content/trackDefs.js';
import { VehicleController } from '../src/vehicle.js';
import { AIController } from '../src/ai.js';
import { RaceManager } from '../src/race.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

console.log('--- Catalog ---');
check('at least 16 tracks', TRACK_DEFS.length >= 16, `n=${TRACK_DEFS.length}`);
check('unique track ids', new Set(TRACK_DEFS.map((t) => t.id)).size === TRACK_DEFS.length);
const themes = new Set(TRACK_DEFS.map((t) => t.theme));
check('at least 12 environments', themes.size >= 12, `themes=[${[...themes]}]`);
check('every track has a teach + mechanic key', TRACK_DEFS.every((t) => !!t.teachKey && !!t.mechanicKey));
check('every track has checkpoints', TRACK_DEFS.every((t) => (t.checkpoints?.length ?? 0) >= 7));
check('checkpoints strictly ordered in defs', TRACK_DEFS.every((t) =>
  t.checkpoints.every((f, i) => i === 0 || f > t.checkpoints[i - 1])));
check('every track has item boxes', TRACK_DEFS.every((t) => (t.boxes?.length ?? 0) >= 4));
check('every track has a unique music seed', new Set(TRACK_DEFS.map((t) => t.musicSeed)).size === TRACK_DEFS.length);

console.log('--- Legacy Sunforge unchanged ---');
{
  const t = new TrackManager();
  check('default builds sunforge_circuit', t.id === 'sunforge_circuit');
  check('loop length matches slice window', t.L > 700 && t.L < 1800, `L=${t.L.toFixed(1)}`);
  check('10 checkpoints', t.checkpoints.length === 10);
  check('shortcut present', !!t.shortcut);
  check('3 ramps', t.ramps.length === 3);
  check('gear + slider obstacles', !!t.gear && !!t.slider);
  check('item boxes added', t.itemBoxes.length >= 12);
  check('themed ranges kept as arc length (slice parity)',
    Math.abs(t.tunnelRange[0] - 0.657 * t.L) < 1 && Math.abs(t.bridgeRange[1] - 0.585 * t.L) < 1);
}

console.log('--- Per-track build + headless race ---');
const stubHud = { onRaceStart() {}, countdown() {}, notify() {}, updateRace() {}, setWrongWay() {}, showResults() {} };
const stubAudio = new Proxy({}, { get: () => () => {} });
const stubI18n = { t: (k) => k };

for (const def of TRACK_DEFS) {
  const track = new TrackManager(def);

  // geometry
  let geoOk = true, why = '';
  if (!(track.L > 450 && track.L < 2400)) { geoOk = false; why = `L=${track.L.toFixed(0)}`; }
  const cps = track.checkpoints;
  for (let i = 1; i < cps.length && geoOk; i++) {
    if (cps[i].s <= cps[i - 1].s) { geoOk = false; why = `cp order @${i}`; }
  }
  const mid = track.pointAt(track.L * 0.5);
  const surfMid = track.surface(mid.pos, { main: -1, sc: -1 });
  if (!surfMid.onRoad || Math.abs(surfMid.lateral) > 0.5) { geoOk = false; why = `centerline lat=${surfMid.lateral.toFixed(2)}`; }
  // racing line sanity
  let minV = Infinity, maxV = 0;
  for (let i = 0; i < 120; i++) {
    const v = track.lineAt((i / 120) * track.L).targetSpeed;
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  if (!(minV > 4 && maxV > 20)) { geoOk = false; why = `line v=${minV.toFixed(1)}..${maxV.toFixed(1)}`; }
  check(`${def.id}: geometry + racing line`, geoOk, why);
  if (!geoOk) continue;

  // headless AI race
  const race = new RaceManager({ track, hud: stubHud, audio: stubAudio, i18n: stubI18n });
  const karts = [];
  for (const p of ['aggressive', 'balanced', 'defensive', 'balanced']) {
    const v = new VehicleController(track, false);
    const kart = { vehicle: v, ai: new AIController(v, track, p), nameKey: 'ai.test', isPlayer: false };
    race.registerKart(kart);
    karts.push(kart);
  }
  race.start(track.startGrid());
  const dt = 1 / 60;
  let simTime = 0, nan = false, finished = 0, firstFinish = null;
  const LIMIT = 460;
  while (simTime < LIMIT) {
    race.update(dt);
    track.update(dt, simTime);
    simTime += dt;
    if (race.state === 'countdown') continue;
    for (const k of karts) {
      const v = k.vehicle;
      if (!Number.isFinite(v.pos.x) || !Number.isFinite(v.pos.z) || !Number.isFinite(v.y)) { nan = true; break; }
    }
    if (nan) break;
    finished = karts.filter((k) => race.kartState.get(k.vehicle).finished).length;
    if (finished >= 1 && firstFinish === null) firstFinish = simTime;
    if (finished === karts.length || race.state === 'results') break;
  }
  check(`${def.id}: AI race completes (${finished}/4, winner ${firstFinish ? firstFinish.toFixed(0) : '-'}s)`,
    !nan && finished >= 3 && firstFinish !== null && firstFinish > 45 && firstFinish < 420,
    nan ? 'NaN' : `fin=${finished} t=${simTime.toFixed(0)}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
