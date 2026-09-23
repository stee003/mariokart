// Headless full-race simulation: 4 AI-driven karts race 3 laps through
// Sunforge Circuit using the real physics, AI, checkpoints and collisions.
import { TrackManager } from '../src/track.js';
import { VehicleController } from '../src/vehicle.js';
import { AIController } from '../src/ai.js';
import { RaceManager } from '../src/race.js';

const track = new TrackManager();
const stubHud = {
  onRaceStart() {}, countdown() {}, notify() {}, updateRace() {},
  setWrongWay() {}, showResults() {},
};
const stubAudio = new Proxy({}, { get: () => () => {} });
const stubI18n = { t: (k) => k };

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
let simTime = 0;
const LIMIT = 480; // seconds
let lapReport = false;
let firstFinish = null;

while (simTime < LIMIT) {
  race.update(dt);
  track.update(dt, simTime);
  simTime += dt;

  if (race.state === 'countdown') continue;

  // sanity: no NaN anywhere
  for (const k of karts) {
    const v = k.vehicle;
    if (!Number.isFinite(v.pos.x) || !Number.isFinite(v.pos.z) || !Number.isFinite(v.y)) {
      console.error('FAIL: NaN in vehicle state');
      process.exit(1);
    }
  }

  if (!lapReport && simTime > 100) {
    const laps = karts.map((k) => race.kartState.get(k.vehicle).lap);
    console.log(`  t=${simTime.toFixed(0)}s laps=[${laps.join(',')}]`);
    lapReport = true;
  }

  const finished = karts.filter((k) => race.kartState.get(k.vehicle).finished);
  if (finished.length === 1 && !firstFinish) firstFinish = simTime;
  if (finished.length === karts.length) break;
  if (race.state === 'results') break;
}

const results = karts.map((k) => {
  const st = race.kartState.get(k.vehicle);
  return { laps: st.lap, finished: st.finished, time: st.finishTime, prog: k.vehicle.progress.toFixed(0) };
});
console.log('results:', JSON.stringify(results));
const finishedCount = results.filter((r) => r.finished).length;
const allLaps = results.every((r) => r.laps >= 1);

let ok = true;
if (!allLaps) { console.error('FAIL: at least one AI never completed lap 1'); ok = false; }
if (finishedCount < 3) { console.error(`FAIL: only ${finishedCount} karts finished in ${LIMIT}s`); ok = false; }
if (firstFinish && (firstFinish < 120 || firstFinish > 330)) {
  console.error(`FAIL: winner time unreasonable: ${firstFinish.toFixed(1)}s`); ok = false;
}
console.log(ok
  ? `PASS: full race simulation (${finishedCount}/4 finished, winner at ${firstFinish ? firstFinish.toFixed(1) : '?'}s)`
  : 'race simulation failed');
process.exit(ok ? 0 : 1);
