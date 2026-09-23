// Headless logic tests for Sunforge Racers (no DOM needed).
import { TrackManager } from '../src/track.js';
import { DriftSystem } from '../src/drift.js';
import { BoostSystem } from '../src/boost.js';
import { VehicleController } from '../src/vehicle.js';
import { RaceManager } from '../src/race.js';
import { CONFIG } from '../src/config.js';

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
}
const approx = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

console.log('--- Track geometry ---');
const track = new TrackManager();
check('loop length in 700..1800m', track.L > 700 && track.L < 1800, `L=${track.L.toFixed(1)}`);
check('10 checkpoints', track.checkpoints.length === 10);
let ordered = true;
for (let i = 1; i < track.checkpoints.length; i++) {
  if (track.checkpoints[i].s <= track.checkpoints[i - 1].s) ordered = false;
}
check('checkpoints strictly ordered', ordered);

// surface query on the centerline
{
  const s = track.L * 0.3;
  const p = track.pointAt(s);
  const hint = { main: -1, sc: -1 };
  const surf = track.surface(p.pos, hint);
  check('centerline is on road', surf.onRoad, JSON.stringify({ lat: surf.lateral }));
  check('centerline lateral ~0', Math.abs(surf.lateral) < 0.5, `lat=${surf.lateral}`);
  check('progress matches', Math.abs(surf.progress - s) < 3, `prog=${surf.progress} vs ${s}`);
}

// lap time estimate: length vs average speed 15..25 m/s
{
  const tMin = track.L / 25, tMax = track.L / 14;
  check('lap in 35..140s window', tMin > 25 && tMax < 150, `est ${tMin.toFixed(0)}-${tMax.toFixed(0)}s`);
}

// shortcut mapping
{
  const sc = track.shortcut;
  const mid = sc.samples[Math.floor(sc.samples.length / 2)];
  const surf = track.surface(mid.pos.clone(), { main: -1, sc: -1 });
  check('shortcut detected', surf.useShortcut === true);
  check('shortcut progress mapped between entry/exit',
    surf.progress > sc.entryProg && surf.progress < sc.exitProg, `prog=${surf.progress}`);
}

// ramp surface rises to lip
{
  const r = track.ramps[0];
  const pLip = track.pointAt(r.s1 - 0.4);
  const pos = pLip.pos.clone().addScaledVector(pLip.right, r.lat);
  const surf = track.surface(pos, { main: -1, sc: -1 });
  check('ramp surface near lip height', Math.abs(surf.y - (r.baseY + r.rise)) < 0.4,
    `y=${surf.y.toFixed(2)} want~${(r.baseY + r.rise).toFixed(2)}`);
  check('onRamp flag', surf.onRamp === true);
}

// racing line sanity
{
  const straight = track.lineAt(track.L * 0.08);
  let minV = Infinity, maxV = 0;
  for (let i = 0; i < 200; i++) {
    const v = track.lineAt((i / 200) * track.L).targetSpeed;
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  check('straight target near max', straight.targetSpeed > CONFIG.vehicle.maxSpeed * 0.8,
    `v=${straight.targetSpeed}`);
  check('corners force slowdown', minV < maxV * 0.8, `min=${minV.toFixed(1)} max=${maxV.toFixed(1)}`);
  check('corner target bounded', minV > 5, `min=${minV.toFixed(1)}`);
}

console.log('--- Drift system ---');
{
  const d = new DriftSystem();
  const ctx = { steer: 1, speed: 20, grounded: true, driftHeld: true, brake: false };
  let ev = d.update(0.016, ctx);
  check('drift starts', ev.started === true && d.drifting);
  for (let t = 0; t < 0.9; t += 0.016) d.update(0.016, ctx);
  check('level 1 charged', d.level >= 1, `charge=${d.charge}`);
  for (let t = 0; t < 1.2; t += 0.016) d.update(0.016, ctx);
  check('level 2+ charged', d.level >= 2, `charge=${d.charge}`);
  for (let t = 0; t < 1.4; t += 0.016) d.update(0.016, ctx);
  check('level 3 charged', d.level === 3, `charge=${d.charge}`);
  ev = d.update(0.016, { ...ctx, driftHeld: false });
  check('release grants boost', ev.ended && ev.ended.boosted && ev.ended.level === 3);
  // cancel via brake
  d.update(0.016, ctx); // start again
  for (let t = 0; t < 1.0; t += 0.016) d.update(0.016, ctx);
  ev = d.update(0.016, { ...ctx, brake: true });
  check('brake cancels without boost', ev.ended && !ev.ended.boosted);
  check('too slow ends drift', (() => {
    const d2 = new DriftSystem();
    d2.update(0.016, ctx);
    const e2 = d2.update(0.016, { ...ctx, speed: 3 });
    return e2.ended && !e2.ended.boosted;
  })());
}

console.log('--- Boost system ---');
{
  const b = new BoostSystem();
  b.trigger(2, 'drift');
  check('boost active', b.boosting);
  const m = b.update(0.1);
  check('speed multiplier applied', m.speedMult > 1.3 && m.accelMult > 2);
  let total = 0.1;
  while (b.boosting && total < 10) { b.update(0.1); total += 0.1; }
  check('boost expires', !b.boosting, `t=${total}`);
}

console.log('--- Vehicle physics ---');
const mkInput = (over = {}) => ({ throttle: 0, brake: 0, steer: 0, drift: false, trick: false, ...over });
{
  const v = new VehicleController(track, true);
  v.place(track.placeAt(20, 0));
  const dt = 1 / 60;
  for (let t = 0; t < 8; t += dt) v.step(dt, mkInput({ throttle: 1 }));
  check('accelerates to ~maxSpeed', v.fSpeed > CONFIG.vehicle.maxSpeed * 0.85 &&
    v.fSpeed < CONFIG.vehicle.maxSpeed * 1.05, `v=${v.fSpeed.toFixed(1)}`);

  const yaw0 = v.yaw;
  for (let t = 0; t < 0.8; t += dt) v.step(dt, mkInput({ throttle: 1, steer: 1 }));
  check('steering rotates kart', Math.abs(v.yaw - yaw0) > 0.5, `dyaw=${(v.yaw - yaw0).toFixed(2)}`);

  // brake to reverse
  const v2 = new VehicleController(track, true);
  v2.place(track.placeAt(40, 0));
  for (let t = 0; t < 5; t += dt) v2.step(dt, mkInput({ brake: 1 }));
  check('brake-hold reverses', v2.fSpeed < -CONFIG.vehicle.reverseMax * 0.7, `v=${v2.fSpeed.toFixed(1)}`);

  // boost raises top speed
  const v3 = new VehicleController(track, true);
  v3.place(track.placeAt(60, 0));
  for (let t = 0; t < 6; t += dt) v3.step(dt, mkInput({ throttle: 1 }));
  v3.boost.trigger(2, 'drift');
  for (let t = 0; t < 0.6; t += dt) v3.step(dt, mkInput({ throttle: 1 }));
  check('boost exceeds base max speed', v3.fSpeed > CONFIG.vehicle.maxSpeed * 1.05, `v=${v3.fSpeed.toFixed(1)}`);

  // drift physics: hold drift+steer -> charges and slides
  const v4 = new VehicleController(track, true);
  v4.place(track.placeAt(80, 0));
  for (let t = 0; t < 5; t += dt) v4.step(dt, mkInput({ throttle: 1 }));
  for (let t = 0; t < 1.6; t += dt) v4.step(dt, mkInput({ throttle: 1, steer: 1, drift: true }));
  check('drift charges in vehicle', v4.drift.level >= 1, `charge=${v4.drift.charge.toFixed(2)}`);

  // off-road -> auto recovery
  const v5 = new VehicleController(track, true);
  const far = track.placeAt(100, 18);
  v5.place(far);
  let resetSeen = false;
  for (let t = 0; t < 6 && !resetSeen; t += dt) {
    v5.step(dt, mkInput({ throttle: 1 }));
    if (v5.resetTimer > 0 || (v5.fx && v5.fx.reset)) resetSeen = true;
  }
  check('off-road auto-reset triggers', resetSeen);
  for (let t = 0; t < 2; t += dt) v5.step(dt, mkInput());
  check('reset returns kart near road', v5.surf && Math.abs(v5.surf.lateral) < v5.surf.width,
    `lat=${v5.surf && v5.surf.lateral.toFixed(1)}`);

  // ramp launch gives vertical velocity
  const v6 = new VehicleController(track, true);
  const r = track.ramps[2];
  v6.place(track.placeAt(r.s0 - 30, r.lat));
  let launched = false;
  for (let t = 0; t < 6 && !launched; t += dt) {
    v6.step(dt, mkInput({ throttle: 1 }));
    if (!v6.grounded && v6.vy > 1) launched = true;
  }
  check('ramp launches kart airborne', launched, `vy=${v6.vy.toFixed(2)}`);
}

console.log('--- Checkpoints & laps ---');
{
  const stubHud = {
    onRaceStart() {}, countdown() {}, notify() {}, updateRace() {},
    setWrongWay() {}, showResults() {},
  };
  const stubAudio = new Proxy({}, { get: () => () => {} });
  const stubI18n = { t: (k) => k };
  const race = new RaceManager({ track, hud: stubHud, audio: stubAudio, i18n: stubI18n });
  const v = new VehicleController(track, true);
  const kart = { vehicle: v, ai: null, nameKey: 'ai.you', isPlayer: true };
  race.registerKart(kart);
  v.place(track.placeAt(track.L - 12, 0));
  race.start(track.startGrid());
  race.state = 'racing';

  const st = race.kartState.get(v);
  const cps = track.checkpoints;

  function pass(idx) {
    const cp = cps[idx];
    st.prevProg = ((cp.s - 4) % track.L + track.L) % track.L;
    v.surf = { progress: (cp.s + 2) % track.L, lateral: 0 };
    v.pos.copy(track.pointAt(v.surf.progress).pos);
    race._checkpoints(kart);
  }

  const startLap = st.lap;
  for (let i = 1; i < cps.length; i++) pass(i);
  check('all section checkpoints pass in order', st.nextCp === 0, `nextCp=${st.nextCp}`);
  check('no lap counted before finish line', st.lap === startLap);
  pass(0);
  check('finish line completes lap', st.lap === startLap + 1 && st.nextCp === 1);

  // backwards crossing must NOT count
  const lapBefore = st.lap;
  st.prevProg = 3;                      // just past the line, driving backwards
  v.surf = { progress: track.L - 3, lateral: 0 };
  race._checkpoints(kart);
  check('reverse finish crossing rejected', st.lap === lapBefore);

  // skipping a checkpoint must not count the next one
  const nextBefore = st.nextCp;
  st.prevProg = cps[3].s - 4;
  v.surf = { progress: cps[3].s + 2, lateral: 0 };
  race._checkpoints(kart);
  check('skipped checkpoints do not advance', st.nextCp === nextBefore);

  // finish the race
  for (let lap = st.lap; lap < CONFIG.race.laps; lap++) {
    for (let i = st.nextCp; i !== 0; i = (i + 1) % cps.length) pass(i);
    pass(0);
  }
  check('race finishes after N laps', st.finished && st.lap === CONFIG.race.laps,
    `lap=${st.lap} finished=${st.finished}`);
}

console.log('--- Reset interaction with checkpoints ---');
{
  const stubHud = { onRaceStart() {}, countdown() {}, notify() {}, updateRace() {}, setWrongWay() {}, showResults() {} };
  const stubAudio = new Proxy({}, { get: () => () => {} });
  const race = new RaceManager({ track, hud: stubHud, audio: stubAudio, i18n: { t: (k) => k } });
  const v = new VehicleController(track, true);
  const kart = { vehicle: v, ai: null, nameKey: 'ai.you', isPlayer: true };
  race.registerKart(kart);
  v.place(track.placeAt(track.L - 12, 0));
  race.start(track.startGrid());
  race.state = 'racing';
  const st = race.kartState.get(v);

  // simulate a mid-race reset a few meters before the finish line
  v.doReset('manual');
  for (let t = 0; t < 1.5; t += 1 / 60) v.step(1 / 60, { throttle: 0, brake: 0, steer: 0, drift: false, trick: false });
  // drive forward across the line
  const L = track.L;
  const lapBefore = st.lap;
  st.prevProg = L - 3;
  v.surf = { progress: 3, lateral: 0 };
  race._checkpoints(kart);
  check('crossing line after early reset does NOT grant a lap', st.lap === lapBefore,
    `lap=${st.lap} nextCp=${st.nextCp}`);
  check('nextCp still requires full loop', st.nextCp === 1);
}

console.log('--- Localization ---');
{
  const { LocalizationManager, STRINGS } = await import('../src/i18n.js');
  const fakeSave = { get: () => 'en', set() {} };
  const i18n = new LocalizationManager(fakeSave);
  const keys = Object.keys(STRINGS);
  const missing = keys.filter((k) => !STRINGS[k].en || !STRINGS[k].it);
  check('every string has EN + IT', missing.length === 0, missing.join(','));
  check('interpolation works', i18n.t('hud.lapFormat', { lap: 2, total: 3 }).includes('2'));
  i18n.setLanguage('it');
  check('italian switch', i18n.t('race.go') === 'VIA!');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
