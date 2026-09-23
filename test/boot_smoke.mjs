// Boot smoke test: constructs every system exactly like main.js does
// (minus WebGL rendering, stubbed) and runs a full race to the results
// screen, exercising HUD, localization switching and restart.
import * as THREE from '../lib/three.module.js';

// ---------------------------------------------------------------- DOM stubs
function fake2D() {
  const grad = { addColorStop() {} };
  return {
    createRadialGradient: () => grad, createLinearGradient: () => grad,
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() {}, fillText() {}, fillStyle: '', font: '', textAlign: '', textBaseline: '',
  };
}
function makeElement(id) {
  return {
    id, children: [], style: {}, dataset: {}, textContent: '', innerHTML: '',
    value: '0', offsetWidth: 100, width: 100, height: 100,
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, force) {
        if (force === undefined) this._set.has(c) ? this._set.delete(c) : this._set.add(c);
        else force ? this._set.add(c) : this._set.delete(c);
      },
      contains(c) { return this._set.has(c); },
    },
    addEventListener() {}, removeEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    append(...items) { this.children.push(...items); },
    querySelectorAll() { return []; },
    getContext() { return fake2D(); },
  };
}
const elements = {};
global.window = {
  addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  localStorage: { getItem: () => null, setItem() {} },
};
global.document = {
  getElementById(id) { return elements[id] || (elements[id] = makeElement(id)); },
  createElement(tag) { return makeElement(tag); },
  querySelectorAll(sel) {
    if (sel.includes('.seg .fill')) return [makeElement('f1'), makeElement('f2'), makeElement('f3')];
    return [];
  },
  body: makeElement('body'),
};

const { SaveManager } = await import('../src/save.js');
const { LocalizationManager } = await import('../src/i18n.js');
const { AudioManager } = await import('../src/audio.js');
const { TrackManager } = await import('../src/track.js');
const { buildEnvironment } = await import('../src/environment.js');
const { buildKart, updateKartVisual } = await import('../src/kartMesh.js');
const { VehicleController } = await import('../src/vehicle.js');
const { AIController } = await import('../src/ai.js');
const { CameraController } = await import('../src/camera.js');
const { RaceManager } = await import('../src/race.js');
const { HUDManager } = await import('../src/hud.js');
const { ParticlePool } = await import('../src/particles.js');
const { CONFIG } = await import('../src/config.js');

let passed = 0, failed = 0;
const check = (name, cond) => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name}`));
};

// ---------------------------------------------------------------- build all
const save = new SaveManager();
const i18n = new LocalizationManager(save);
const audio = new AudioManager(save);
const track = new TrackManager();
const scene = new THREE.Scene();
const env = buildEnvironment(scene, track);
check('environment built', env.group.children.length > 40, `children=${env.group.children.length}`);
check('camera colliders exist', env.colliders.length > 5);

const dust = new ParticlePool(scene, 100, false);
const sparks = new ParticlePool(scene, 100, true);
const hud = new HUDManager(i18n);
const camera = new THREE.PerspectiveCamera(63, 16 / 9, 0.1, 1600);
const camCtl = new CameraController(camera, track);
camCtl.setColliders(env.colliders);

const race = new RaceManager({ track, hud, audio, i18n, onEvent: () => {} });
const visuals = new Map();
const defs = ['aggressive', 'balanced', 'defensive', null];
for (const ai of defs) {
  const v = new VehicleController(track, ai === null);
  const kart = { vehicle: v, ai: ai ? new AIController(v, track, ai) : null, nameKey: 'ai.you', isPlayer: ai === null };
  race.registerKart(kart);
  visuals.set(v, buildKart(0xff8a2a, 0x2fd8c8, 0xf2a65a));
}
const playerKart = race.karts.find((k) => k.isPlayer);
// let the "player" be driven by an AI brain for this simulation
playerKart.ai = new AIController(playerKart.vehicle, track, 'balanced');
playerKart.isPlayer = true;

// ---------------------------------------------------------------- run race
race.start(track.startGrid());
camCtl.snapTo(playerKart.vehicle);
check('race in countdown', race.state === 'countdown');

const dt = 1 / 60;
let t = 0, sawRacing = false, switchedLang = false;
while (race.state !== 'results' && t < 600) {
  race.playerInput = { throttle: 0, brake: 0, steer: 0, drift: false, trick: false };
  if (race.state === 'racing' && !playerKart.vehicle.isPlayer) { /* no-op */ }
  // drive player via AI brain
  if (race.state === 'racing') {
    race.playerInput = playerKart.ai.update(dt, race.karts, true);
  }
  race.update(dt);
  track.update(dt, t);
  if (race.state === 'racing' || race.state === 'finished') sawRacing = true;

  for (const k of race.karts) updateKartVisual(visuals.get(k.vehicle), k.vehicle, dt, t);
  camCtl.update(dt, playerKart.vehicle, playerKart.vehicle.boost.boosting, t);
  dust.update(dt); sparks.update(dt);
  env.state.update(dt, t);

  if (!switchedLang && t > 10) { i18n.setLanguage('it'); hud.applyLanguage(); switchedLang = true; }
  t += dt;
}
check('reached racing state', sawRacing);
check('language switched to IT', i18n.lang === 'it' && i18n.t('race.go') === 'VIA!');
check('race reached results', race.state === 'results', `state=${race.state} t=${t.toFixed(0)}s`);
check('results rows rendered', document.getElementById('results-rows').children.length === 4);
check('player finished', race.kartState.get(playerKart.vehicle).finished);
check('finish time sane', (() => {
  const ft = race.kartState.get(playerKart.vehicle).finishTime;
  return ft > 150 && ft < 420;
})(), `time=${race.kartState.get(playerKart.vehicle).finishTime}`);

// ---------------------------------------------------------------- restart
race.restart();
check('restart returns to countdown', race.state === 'countdown');
check('laps reset', race.kartState.get(playerKart.vehicle).lap === 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
