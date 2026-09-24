// ============================================================================
// Finish-sequence suite - the last four seconds of a race.
//
// Covers the whole chain that runs when the player crosses the line:
//   * the slow-motion curve in race.js (a ramp, not a switch)
//   * the cinematic camera sweep in camera.js
//   * the DOM banner/flash/flag timeline in hud.js
//   * the results-card reveal (medal, staggered rows, stats, confetti)
//   * the finish/reveal audio, scheduled on the audio clock
//   * the markup + CSS contract those depend on
//
// Regression history:
//   * the results confetti used Math.random() for its scatter. Gameplay draws
//     from the same global stream (AI lines, item roulette), so a cosmetic
//     effect silently re-rolled how the NEXT race drove - a time-trial run
//     that had always finished started stalling. Everything decorative here is
//     seeded from the result instead, and one of the checks below fails loudly
//     if a reveal ever touches Math.random again.
//   * rows must be appended synchronously: callers (and boot_smoke) assert on
//     the table immediately after showResults(), so the stagger lives in
//     per-row animation-delay only.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from '../lib/three.module.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ROOT = path.resolve(import.meta.dirname, '..');

// ----------------------------------------------------------------- DOM shim
function ctx2d() {
  return new Proxy({}, {
    get: (_, k) => (k.startsWith('create') || k === 'measureText'
      ? () => ({ addColorStop() {}, width: 10 })
      : () => {}),
    set: () => true,
  });
}
function makeEl(tag = 'div', id = '') {
  const el = {
    tag, id, children: [], dataset: {}, textContent: '',
    width: 220, height: 220, offsetWidth: 100, parentNode: null,
    style: { setProperty(k, v) { this[k] = v; } },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) { const w = f === undefined ? !this._s.has(c) : f; w ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    append(...c) { c.forEach((x) => el.appendChild(x)); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {}, setAttribute() {},
    getContext() { return ctx2d(); },
  };
  // className and classList are two views of one thing in a real DOM, and
  // hud.js writes both - keep them in sync or the checks below lie.
  Object.defineProperty(el, 'className', {
    get: () => [...el.classList._s].join(' '),
    set: (v) => {
      el.classList._s.clear();
      String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classList._s.add(c));
    },
  });
  // Assigning innerHTML replaces the subtree; the code under test relies on
  // `innerHTML = ''` emptying the container before it re-appends.
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set: (v) => {
      html = String(v);
      if (html === '') { el.children.length = 0; }
    },
  });
  return el;
}
const els = {};
global.document = {
  documentElement: makeEl('html'),
  body: makeEl('body'),
  getElementById: (id) => els[id] || (els[id] = makeEl('div', id)),
  createElement: (tag) => makeEl(tag),
  querySelectorAll: (s) => (s.includes('.seg .fill') ? [makeEl(), makeEl(), makeEl()] : []),
};
global.window = {
  addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  localStorage: { getItem: () => null, setItem: () => {} },
};

// --------------------------------------------------------------- audio shim
// Records every scheduled voice so the fanfare can be asserted note by note.
const audioLog = [];
function mkParam() {
  return {
    value: 0, _set: null, _lin: null, _exp: null,
    setValueAtTime(v, t) { this._set = { v, t }; this.value = v; return this; },
    linearRampToValueAtTime(v, t) { this._lin = { v, t }; return this; },
    exponentialRampToValueAtTime(v, t) { this._exp = { v, t }; return this; },
    setTargetAtTime(v) { this.value = v; return this; },
    cancelScheduledValues() { return this; },
  };
}
class FakeAudioContext {
  constructor() {
    this.currentTime = 12.5;
    this.sampleRate = 48000;
    this.state = 'running';
    this.destination = makeEl('sink');
  }
  resume() {}
  createGain() { return { _kind: 'gain', gain: mkParam(), connect() {}, disconnect() {} }; }
  createBiquadFilter() {
    return { _kind: 'filter', type: 'lowpass', frequency: mkParam(), Q: mkParam(), connect(d) { this._dst = d; } };
  }
  createOscillator() {
    const n = {
      _kind: 'osc', type: 'sine', frequency: mkParam(),
      connect(d) { n._dst = d; },
      start(t) {
        audioLog.push({
          kind: 'tone', t, type: n.type,
          f0: n.frequency._set?.v ?? null, f1: n.frequency._exp?.v ?? null,
          peak: n._dst?.gain?._lin?.v ?? null, at: n._dst?.gain?._set?.t ?? null,
        });
      },
      stop() {},
    };
    return n;
  }
  createBufferSource() {
    const n = {
      _kind: 'noise', buffer: null, loop: false,
      connect(d) { n._dst = d; },
      start(t) {
        if (n.loop) return;                     // the drift bed, not a one-shot
        const gain = n._dst?._dst ?? n._dst;    // src -> filter -> gain
        audioLog.push({
          kind: 'noise', t, filter: n._dst?.type,
          f0: n._dst?.frequency?._set?.v ?? null, f1: n._dst?.frequency?._exp?.v ?? null,
          peak: gain?.gain?._lin?.v ?? null,
        });
      },
      stop() {},
    };
    return n;
  }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
}
global.window.AudioContext = FakeAudioContext;

// ------------------------------------------------------------------ imports
const { CONFIG } = await import('../src/config.js');
const { TrackManager } = await import('../src/track.js');
const { VehicleController } = await import('../src/vehicle.js');
const { RaceManager, finishTimeScale } = await import('../src/race.js');
const { CameraController } = await import('../src/camera.js');
const { HUDManager, RESULTS_REVEAL } = await import('../src/hud.js');
const { AudioManager } = await import('../src/audio.js');
const { SaveManager } = await import('../src/save.js');
const { LocalizationManager } = await import('../src/i18n.js');
const { TRACK_DEFS } = await import('../src/content/trackDefs.js');

const R = CONFIG.race;
const _tmp = new THREE.Vector3();
const track = new TrackManager(TRACK_DEFS[0]);
const stubAudio = new Proxy({}, { get: () => () => {} });

// ==========================================================================
console.log('--- Slow-motion curve ---');
{
  check('starts at full speed', near(finishTimeScale(0), 1, 1e-9));
  check('deepens through the ramp', finishTimeScale(R.slowMoRampIn * 0.5) < 1
    && finishTimeScale(R.slowMoRampIn * 0.5) > R.slowMoOnFinish);
  check('reaches the deep point', near(finishTimeScale(R.slowMoRampIn), R.slowMoOnFinish, 1e-9));
  const holdA = finishTimeScale(R.slowMoRampIn + 0.4);
  const holdB = finishTimeScale(R.resultsDelay - R.slowMoRampOut - 0.05);
  check('holds steady mid-cinematic', near(holdA, R.slowMoOnFinish, 1e-9) && near(holdB, R.slowMoOnFinish, 1e-9));
  const out = finishTimeScale(R.resultsDelay - R.slowMoRampOut * 0.5);
  check('eases back out before the card', out > R.slowMoOnFinish && out < R.slowMoFloor);
  check('ramp-out lands on the floor',
    near(finishTimeScale(R.resultsDelay), R.slowMoFloor, 1e-9),
    `got=${finishTimeScale(R.resultsDelay)}`);
  const samples = [];
  for (let t = 0; t <= R.resultsDelay; t += 1 / 240) samples.push(finishTimeScale(t));
  check('never faster than real time', samples.every((s) => s <= 1 + 1e-9));
  check('never deeper than the configured floor of the curve',
    samples.every((s) => s >= R.slowMoOnFinish - 1e-9));
  check('monotonic down, then monotonic up', (() => {
    let phase = 'down';
    for (let i = 1; i < samples.length; i++) {
      const d = samples[i] - samples[i - 1];
      if (phase === 'down') { if (d > 1e-9) phase = 'up'; else if (d < -1e-9) continue; }
      else if (d < -1e-9) return false;
    }
    return phase === 'up';
  })());
  check('negative time is clamped, not extrapolated', finishTimeScale(-1) <= 1);
  check('cinematic is longer than the old cut', R.resultsDelay >= 3.0, `${R.resultsDelay}`);
}

// ==========================================================================
console.log('--- Race finish timeline ---');
{
  const events = [];
  let resultsCalls = 0;
  const stubHud = {
    onRaceStart() {}, countdown() {}, notify() {}, updateRace() {}, setWrongWay() {},
    showResults() { resultsCalls++; }, setItem() {},
  };
  const race = new RaceManager({
    track, hud: stubHud, audio: stubAudio, i18n: { t: (k) => k },
    onEvent: (type, payload) => events.push([type, payload]),
  });
  race.itemsEnabled = false;
  const v = new VehicleController(track, true);
  const kart = { vehicle: v, ai: null, nameKey: 'ai.you', isPlayer: true };
  race.registerKart(kart);
  v.place(track.placeAt(track.L - 12, 0));
  race.start(track.startGrid());
  race.state = 'racing';
  race._kartFinished(kart);

  check('crossing the line enters the finished state', race.state === 'finished');
  check('the placing is recorded', race.finishPos === 1, `${race.finishPos}`);
  check('finish starts in real time (the ramp takes over)', near(race.timeScale, 1, 1e-9));
  check('celebrate carries the placing', events.some(([t, p]) => t === 'celebrate' && p.place === 1));
  check('celebrate still says whether it is a win', events.some(([t, p]) => t === 'celebrate' && p.win === true));
  check('playerFinished is emitted for the camera/banner handoff',
    events.some(([t, p]) => t === 'playerFinished' && p.pos === 1));

  const dt = 1 / 60;
  let t = 0;
  const scale = [];
  const prog = [];
  while (race.state === 'finished' && t < 12) {
    race.update(dt);
    t += dt;
    scale.push(race.timeScale);
    prog.push(race.finishProgress);
  }
  check('the cinematic runs for the configured delay',
    t > R.resultsDelay && t < R.resultsDelay + 0.1, `t=${t.toFixed(2)}`);
  check('results are shown exactly once', resultsCalls === 1, `${resultsCalls}`);
  check('time freezes for the results card', race.timeScale === 0);
  check('slow motion actually slows the race', Math.min(...scale) <= R.slowMoOnFinish + 1e-6);
  // the final sample is the freeze applied by _showResults on the same step,
  // so the ramp-out is read from the sample before it
  check('slow motion recovers before the card',
    scale[scale.length - 2] > R.slowMoOnFinish + 0.05, `${scale[scale.length - 2]}`);
  check('the freeze is the last thing that happens', scale[scale.length - 1] === 0);
  check('finishProgress sweeps 0..1', prog[0] < 0.05 && prog[prog.length - 1] >= 0.99);
  check('karts keep simulating during the cinematic', race.raceTime > 0);
  check('no second finish event while coasting',
    events.filter(([e]) => e === 'playerFinished').length === 1);
}

// ==========================================================================
console.log('--- Cinematic camera ---');
{
  const cam = new THREE.PerspectiveCamera(CONFIG.camera.fovBase, 16 / 9, 0.1, 3000);
  const camCtl = new CameraController(cam, track);
  const v = new VehicleController(track, true);
  v.place(track.placeAt(track.L * 0.5, 0));
  v.step(1 / 60, { throttle: 1, brake: 0, steer: 0, drift: false, trick: false }, false);
  camCtl.snapTo(v);
  check('snapTo clears any leftover cinematic', camCtl.cine === null);

  const p0 = cam.position.clone();
  camCtl.beginCinematic();
  check('beginCinematic arms the sweep', !!camCtl.cine && camCtl.cine.t === 0);
  check('the sweep starts from the current chase yaw', near(camCtl.cine.a0, camCtl.yaw, 1e-9));

  const bearing = [];
  const dist = [];
  const hint = { main: -1, sc: -1 };
  const idle = { throttle: 0, brake: 0, steer: 0, drift: false, trick: false };
  let aboveGround = true;
  const dt = 1 / 60;
  for (let i = 0; i < 300; i++) {          // 5 s: past the scripted sweep
    v.step(dt, idle, false);
    camCtl.updateCinematic(dt, v, i * dt);
    const dx = cam.position.x - v.pos.x;
    const dz = cam.position.z - v.pos.z;
    bearing.push(Math.atan2(dx, dz));
    dist.push(Math.hypot(dx, cam.position.y - v.y, dz));
    const g = track.surface(_tmp.set(cam.position.x, cam.position.y, cam.position.z), hint);
    if (cam.position.y < g.y + CONFIG.camera.minHeightAboveGround - 0.05) aboveGround = false;
  }
  // unwrapped total rotation
  let sweepTotal = 0;
  for (let i = 1; i < bearing.length; i++) {
    let d = bearing[i] - bearing[i - 1];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    sweepTotal += d;
  }
  check('the camera orbits the kart', Math.abs(sweepTotal) > 0.9, `sweep=${sweepTotal.toFixed(2)}rad`);
  check('the orbit direction matches the configured sweep',
    Math.sign(sweepTotal) === Math.sign(camCtl.cine.sweep));
  check('the camera pulls in for the close-up',
    dist[dist.length - 1] < dist[0] * 0.85, `${dist[0].toFixed(2)} -> ${dist[dist.length - 1].toFixed(2)}`);
  check('the handoff starts where the chase cam was',
    cam.position.distanceTo(p0) < 26, `jump=${cam.position.distanceTo(p0).toFixed(1)}`);
  check('the camera stays out of the terrain', aboveGround);
  check('it keeps looking at the kart', (() => {
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const toKart = _tmp.set(v.pos.x - cam.position.x, v.y + 1.2 - cam.position.y, v.pos.z - cam.position.z).normalize();
    return fwd.dot(toKart) > 0.9;
  })());
  check('the FOV eases down for a push-in', camCtl.fov < CONFIG.camera.fovBase, `${camCtl.fov.toFixed(2)}`);
  check('shake bleeds off during the celebration', camCtl.trauma < 0.001);

  // it must keep drifting once the scripted sweep is over, so the results card
  // is revealed over a live background rather than a frozen frame
  const b1 = bearing[bearing.length - 1];
  for (let i = 0; i < 90; i++) camCtl.updateCinematic(dt, v, 5 + i * dt);
  const dx = cam.position.x - v.pos.x, dz = cam.position.z - v.pos.z;
  let d2 = Math.atan2(dx, dz) - b1;
  while (d2 > Math.PI) d2 -= Math.PI * 2;
  while (d2 < -Math.PI) d2 += Math.PI * 2;
  check('the shot keeps drifting behind the results card', Math.abs(d2) > 0.1, `${d2.toFixed(3)}`);

  camCtl.addTrauma(0.6);
  camCtl.updateCinematic(dt, v, 6);
  check('trauma added mid-cinematic still decays', camCtl.trauma < 0.6);
  camCtl.endCinematic();
  check('endCinematic hands the camera back', camCtl.cine === null);
  camCtl.updateCinematic(dt, v, 7);
  check('updateCinematic re-arms itself if called cold', !!camCtl.cine);

  // obstacle avoidance is shared with the chase cam
  const camCtl2 = new CameraController(cam, track);
  const origin = new THREE.Vector3(0, 2, 0);
  const desired = new THREE.Vector3(0, 2, -20);
  camCtl2.setColliders([new THREE.Box3(new THREE.Vector3(-5, 0, -12), new THREE.Vector3(5, 6, -8))]);
  camCtl2._avoid(origin, desired);
  check('the sweep stops in front of scenery instead of inside it',
    near(desired.z, -(8 - CONFIG.camera.margin), 0.02), `z=${desired.z.toFixed(2)}`);
  const clear = new THREE.Vector3(0, 2, -20);
  camCtl2.setColliders([]);
  camCtl2._avoid(origin, clear);
  check('with nothing in the way the shot is untouched', near(clear.z, -20, 1e-9));
}

// ==========================================================================
console.log('--- Finish banner (HUD) ---');
const save = new SaveManager();
const i18n = new LocalizationManager(save);
const hud = new HUDManager(i18n);

// a results card tree so the button reveal path is exercised too
const card = makeEl('div', 'results-card');
const buttons = makeEl('div', 'menu-buttons');
card.appendChild(buttons);
card.appendChild(document.getElementById('results-stats'));
card.querySelector = (sel) => (sel === '.menu-buttons' ? buttons : null);

{
  const box = hud.finishFx(1);
  check('finishFx returns the overlay', !!box);
  check('the overlay is shown and playing',
    !box.classList.contains('hidden') && box.classList.contains('play'));
  check('a win is tagged fx-win', box.classList.contains('fx-win') && !box.classList.contains('fx-podium'));
  check('the placing is rendered', document.getElementById('finish-place').textContent === '1st');
  check('the kicker is localized', document.getElementById('finish-kicker').textContent === i18n.t('race.finishKicker'));
  check('a win gets the win subtitle',
    document.getElementById('finish-sub').textContent === i18n.t('race.finishSubWin'));

  hud.finishFx(2);
  check('a podium finish is tagged fx-podium, not fx-win',
    box.classList.contains('fx-podium') && !box.classList.contains('fx-win'));
  check('the placing updates', document.getElementById('finish-place').textContent === '2nd');

  hud.finishFx(6);
  check('outside the podium is tagged fx-back',
    box.classList.contains('fx-back') && !box.classList.contains('fx-podium') && !box.classList.contains('fx-win'));
  check('the subtitle falls back to "race complete"',
    document.getElementById('finish-sub').textContent === i18n.t('race.finishSubDone'));

  // replaying must restart the timeline rather than leave it stuck
  hud.hideFinishFx();
  check('hideFinishFx retires the overlay',
    box.classList.contains('hidden') && !box.classList.contains('play'));
  hud.finishFx(1);
  check('replaying re-arms the timeline', box.classList.contains('play') && !box.classList.contains('hidden'));

  i18n.setLanguage('it');
  hud.finishFx(3);
  check('the banner follows the language switch',
    document.getElementById('finish-kicker').textContent === i18n.t('race.finishKicker')
    && document.getElementById('finish-sub').textContent === i18n.t('race.finishSubPodium'),
    document.getElementById('finish-sub').textContent);
  check('Italian ordinals are used', document.getElementById('finish-place').textContent === i18n.t('ordinal.3'));
  i18n.setLanguage('en');

  hud.setCinematic(true);
  check('the race chrome dims for the cinematic', document.getElementById('hud').classList.contains('cine'));
  hud.setCinematic(true);
  check('setCinematic is idempotent', document.getElementById('hud').classList.contains('cine'));
  hud.setCinematic(false);
  check('the chrome comes back for the results card', !document.getElementById('hud').classList.contains('cine'));
  hud.onRaceStart();
  check('starting a race clears the finish overlay', document.getElementById('finish-fx').classList.contains('hidden'));
}

// ==========================================================================
console.log('--- Results reveal ---');
{
  const mkRows = (n = 4, playerPos = 1) => Array.from({ length: n }, (_, i) => ({
    pos: i + 1,
    nameKey: i + 1 === playerPos ? 'ai.you' : `ai.name${i}`,
    isPlayer: i + 1 === playerPos,
    finished: true,
    time: 180 + i * 1.5,
    bestLap: 58 + i * 0.4,
  }));

  // Math.random must not be touched: gameplay shares that stream
  const realRandom = Math.random;
  let randomCalls = 0;
  Math.random = () => { randomCalls++; return realRandom(); };

  const win = hud.showResults({
    rows: mkRows(4, 1), playerPos: 1, totalTime: 183.42, bestLap: 58.9,
  });

  Math.random = realRandom;
  check('the reveal never re-rolls the gameplay RNG', randomCalls === 0, `${randomCalls} calls`);

  const rows = document.getElementById('results-rows').children;
  check('every row is appended synchronously', rows.length === 4, `${rows.length}`);
  const delays = rows.map((r) => parseFloat(r.style.animationDelay));
  check('rows are staggered in finishing order',
    delays.every((d, i) => i === 0 || d > delays[i - 1]), delays.join(','));
  check('the stagger starts after the card lands',
    delays[0] >= RESULTS_REVEAL.rowFirst - 1e-9 && near(delays[0], RESULTS_REVEAL.rowFirst, 1e-3));
  check('the stagger step matches the published timeline',
    near(delays[1] - delays[0], RESULTS_REVEAL.rowStep, 1e-3));
  check('rows are animated by class, not by JS timers', rows.every((r) => r.classList.contains('row-in')));
  check('the player row keeps its highlight class', rows[0].classList.contains('you'));
  check('the row order is unchanged', rows[0].children[0].textContent === '1st');

  const medal = document.getElementById('results-medal');
  check('a win shows the medal', !medal.classList.contains('hidden') && medal.classList.contains('gold'));
  check('the medal drops in', medal.classList.contains('drop'));
  check('the medal carries the placing', document.getElementById('results-medal-rank').textContent === '1st');

  check('the headline sweeps in', document.getElementById('results-headline').classList.contains('reveal'));
  check('the headline is the victory line',
    document.getElementById('results-headline').textContent === i18n.t('results.victory'));
  check('the stats fade up after the last row',
    document.getElementById('results-stats').classList.contains('stat-in'));
  check('the buttons arrive last', buttons.classList.contains('btns-in'));
  const statsAt = parseFloat(document.getElementById('results-stats').style.animationDelay);
  const buttonsAt = parseFloat(buttons.style.animationDelay);
  check('stats land after the final row', statsAt > delays[delays.length - 1], `${statsAt} vs ${delays[3]}`);
  check('buttons land after the stats', buttonsAt > statsAt);

  const confetti = document.getElementById('results-confetti');
  check('a win throws confetti', confetti.children.length === RESULTS_REVEAL.confettiWin,
    `${confetti.children.length}`);
  check('confetti is scattered, not stacked', (() => {
    const lefts = new Set(confetti.children.map((c) => c.style.left));
    return lefts.size > confetti.children.length * 0.8;
  })());
  check('each piece has its own timing', (() => {
    const durs = new Set(confetti.children.map((c) => c.style.animationDuration));
    return durs.size > 5;
  })());
  check('confetti pieces carry a sway value', confetti.children.every((c) => c.style['--drift'] !== undefined));

  // determinism: the same finish looks the same again
  const before = confetti.children.map((c) => `${c.style.left}|${c.style.animationDelay}|${c.style['--drift']}`).join(';');
  hud.showResults({ rows: mkRows(4, 1), playerPos: 1, totalTime: 183.42, bestLap: 58.9 });
  const after = document.getElementById('results-confetti').children
    .map((c) => `${c.style.left}|${c.style.animationDelay}|${c.style['--drift']}`).join(';');
  check('the same result replays the same celebration', before === after);

  // the reveal timings handed back for audio scheduling
  check('lastReveal reports the win', win.win === true && win.podium === true && win.playerPos === 1);
  check('lastReveal exposes a per-row clock', near(win.rowAt(2), RESULTS_REVEAL.rowFirst + 2 * RESULTS_REVEAL.rowStep, 1e-9));
  check('lastReveal orders medal < rows < stats < buttons',
    win.medal < win.rowAt(0) && win.rowAt(win.rows - 1) < win.statsAt && win.statsAt < win.buttonsAt);

  // second place: silver, fewer sparks
  const second = hud.showResults({ rows: mkRows(6, 2), playerPos: 2, totalTime: 190.1, bestLap: 60.2 });
  check('second place gets the silver medal',
    !medal.classList.contains('hidden') && medal.classList.contains('silver') && !medal.classList.contains('gold'));
  check('the podium headline is used', document.getElementById('results-headline').textContent === i18n.t('results.podium'));
  check('a podium throws less confetti than a win',
    document.getElementById('results-confetti').children.length === RESULTS_REVEAL.confettiPodium);
  check('six rows all get a delay', document.getElementById('results-rows').children.length === 6);
  check('the player row is the second one',
    document.getElementById('results-rows').children[1].classList.contains('you'));
  check('second place is not flagged as a win', second.win === false && second.podium === true);

  // back of the field: no medal, no confetti, still a full reveal
  const last = hud.showResults({ rows: mkRows(8, 7), playerPos: 7, totalTime: 201.5, bestLap: 62.4 });
  check('no medal outside the podium', medal.classList.contains('hidden'));
  check('no confetti outside the podium',
    document.getElementById('results-confetti').children.length === 0
    && document.getElementById('results-confetti').classList.contains('hidden'));
  check('the "done" headline is used', document.getElementById('results-headline').textContent === i18n.t('results.done'));
  check('rows still stagger for a last-place finish', last.rows === 8);

  // unfinished karts must not break the table
  const partial = mkRows(4, 1).map((r, i) => (i > 1 ? { ...r, finished: false, time: null } : r));
  hud.showResults({ rows: partial, playerPos: 1, totalTime: 183.4, bestLap: 58.9 });
  check('unfinished rows render a dash',
    document.getElementById('results-rows').children[2].children[2].textContent === '—');
  check('null times do not throw in the stats', true);
}

// ==========================================================================
console.log('--- Finish + reveal audio ---');
{
  const audio = new AudioManager(save);
  check('cues are safe before the context exists', (() => {
    try {
      audio.finishLine(1); audio.podiumChime(2); audio.resultsTick(1, 4); audio.resultsLock(true);
      return true;
    } catch { return false; }
  })());

  audio.init();
  check('the fake context initialised the mixer', audio.ready === true);

  const grab = (fn) => { audioLog.length = 0; fn(); return audioLog.slice(); };

  const win = grab(() => audio.finishLine(1));
  check('the crossing starts with a whoosh',
    win.some((e) => e.kind === 'noise' && e.f1 !== null && e.f1 < e.f0), JSON.stringify(win[0]));
  check('the whoosh is followed by a low thump',
    win.some((e) => e.kind === 'tone' && e.f0 < 260 && e.f1 !== null && e.f1 < e.f0));
  const notes = win.filter((e) => e.kind === 'tone' && e.f0 > 400).sort((a, b) => a.t - b.t);
  check('a win plays a rising fanfare', notes.length >= 4
    && notes.slice(0, 4).every((n, i, arr) => i === 0 || n.f0 > arr[i - 1].f0),
    notes.slice(0, 4).map((n) => n.f0.toFixed(0)).join(','));
  check('the fanfare is scheduled ahead on the audio clock',
    notes[notes.length - 1].t > notes[0].t + 0.2, `${(notes[notes.length - 1].t - notes[0].t).toFixed(3)}s`);
  check('a win ends on a held chord', win.some((e) => e.kind === 'tone' && e.t > notes[3].t));
  check('nothing in the fanfare is louder than a collision',
    win.every((e) => (e.peak ?? 0) <= 0.2), `max=${Math.max(...win.map((e) => e.peak ?? 0))}`);

  const back = grab(() => audio.finishLine(7));
  const backNotes = back.filter((e) => e.kind === 'tone' && e.f0 > 300);
  check('finishing last still gets a musical resolve', backNotes.length >= 2);
  check('a non-win skips the held chord', backNotes.length < notes.length,
    `${backNotes.length} vs ${notes.length}`);
  check('the whoosh plays for every placing', back.some((e) => e.kind === 'noise'));

  const chime = grab(() => audio.podiumChime(1));
  check('the medal bell rings', chime.length >= 3 && chime.every((e) => e.t >= chime[0].t));
  const bellGold = chime.filter((e) => e.kind === 'tone')[0].f0;
  audioLog.length = 0; audio.podiumChime(3);
  const bellBronze = audioLog.filter((e) => e.kind === 'tone')[0].f0;
  check('gold rings higher than bronze', bellGold > bellBronze, `${bellGold} vs ${bellBronze}`);

  audioLog.length = 0;
  for (let i = 0; i < 6; i++) audio.resultsTick(i, 6);
  const ticks = audioLog.filter((e) => e.kind === 'tone').map((e) => e.f0);
  check('row ticks climb with the ladder', ticks.every((f, i) => i === 0 || f >= ticks[i - 1]), ticks.join(','));
  check('row ticks stay quiet under the music',
    audioLog.filter((e) => e.kind === 'tone').every((e) => e.peak <= 0.06));

  const lock = grab(() => audio.resultsLock(true));
  check('the reveal closes on two notes', lock.filter((e) => e.kind === 'tone').length === 2);
  check('the closing pair rises', lock[1].f0 > lock[0].f0);

  const legacy = grab(() => audio.finish(true));
  check('the legacy finish() cue still works', legacy.filter((e) => e.kind === 'tone').length >= 4);

  // the engine bus must still be independent of all of this
  audio.setEngineVolume(0.3);
  check('engine volume is untouched by the fanfare', near(audio.engineVolume, 0.3, 1e-9));
}

// ==========================================================================
console.log('--- Markup + CSS contract ---');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');

  for (const id of ['finish-fx', 'finish-kicker', 'finish-place', 'finish-sub',
    'results-medal', 'results-medal-rank', 'results-confetti']) {
    check(`index.html has #${id}`, html.includes(`id="${id}"`));
  }
  check('the finish overlay is decorative for screen readers',
    /id="finish-fx"[^>]*aria-hidden="true"/.test(html));
  check('the overlay sits inside the HUD', html.indexOf('id="finish-fx"') > html.indexOf('id="hud"')
    && html.indexOf('id="finish-fx"') < html.indexOf('id="minimap-box"'));
  for (const layer of ['fx-vignette', 'fx-rays', 'fx-flash', 'fx-flag-top', 'fx-flag-bot', 'fx-banner']) {
    check(`the overlay contains .${layer}`, html.includes(layer));
  }
  check('the confetti layer is inside the results screen',
    html.indexOf('id="results-confetti"') > html.indexOf('id="screen-results"')
    && html.indexOf('id="results-confetti"') < html.indexOf('id="results-medal"'));

  // every animation the JS starts must exist in the stylesheet
  for (const sel of ['#finish-fx', '#finish-fx.play .fx-vignette', '#finish-fx.play .fx-rays',
    '#finish-fx.play .fx-flash', '#finish-fx.play .fx-flag-top', '#finish-fx.play .fx-flag-bot',
    '#finish-fx.play .fx-place', '#results-medal.drop', '#results-headline.reveal',
    '.result-row.row-in', '.result-row.you.row-in', '#results-stats.stat-in',
    '.menu-buttons.btns-in', '#results-confetti .spark',
    '#screen-results:not(.hidden) .results-card', '#hud.cine .hud-top', '#hud.cine .hud-bottom']) {
    check(`style.css styles ${sel}`, css.includes(sel));
  }
  for (const kf of ['fxVignette', 'fxRays', 'fxFlash', 'fxFlagL', 'fxFlagR', 'fxKicker', 'fxPlace',
    'fxSub', 'fxBannerOut', 'fxBannerFocus', 'cardSlam', 'medalDrop', 'medalSpin', 'headlineIn',
    'rowIn', 'rowInYou', 'fadeUp', 'confettiFall']) {
    check(`keyframes ${kf} exist`, css.includes(`@keyframes ${kf}`));
  }
  check('the banner is out before the card arrives', (() => {
    const m = css.match(/fxBannerOut [0-9.]+s ease ([0-9.]+)s/);
    return !!m && parseFloat(m[1]) + 0.6 <= R.resultsDelay;
  })());
  check('the cinematic never blocks clicks', /#finish-fx \{[^}]*pointer-events: none/.test(css));
  check('the HUD stays a stacking context below the screens',
    /#hud \{[^}]*z-index: 0/.test(css));
  check('confetti never blocks clicks', /#results-confetti \{[^}]*pointer-events: none/.test(css));

  // motion-sensitive players keep the information, lose the movement
  for (const sel of ['.reduce-fx #finish-fx .fx-flash', '.reduce-fx #results-confetti',
    '.reduce-fx .result-row.row-in', '.reduce-fx #results-medal.drop',
    '.reduce-fx #screen-results:not(.hidden) .results-card']) {
    check(`reduced motion covers ${sel}`, css.includes(sel));
  }
  check('reduced motion still shows the placing', css.includes('.reduce-fx #finish-fx .fx-place'));

  // the medal tiers the JS applies must be styled
  for (const tier of ['gold', 'silver', 'bronze']) {
    check(`medal tier .${tier} is styled`, css.includes(`#results-medal.${tier}`));
  }
  check('confetti colours s0..s4 are styled',
    [0, 1, 2, 3, 4].every((i) => css.includes(`#results-confetti .s${i}`)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
