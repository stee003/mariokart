// Boot smoke test: constructs every system exactly like main.js does
// (minus WebGL rendering, stubbed) and runs a full race to the results
// screen, exercising HUD, localization switching and restart.
import * as THREE from '../lib/three.module.js';

// ---------------------------------------------------------------- DOM stubs
function fake2D() {
  const grad = { addColorStop() {} };
  return {
    createRadialGradient: () => grad, createLinearGradient: () => grad,
    fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    arc() {}, ellipse() {}, quadraticCurveTo() {}, stroke() {}, save() {}, restore() {},
    translate() {}, rotate() {},
    fill() {}, fillText() {}, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '',
    font: '', textAlign: '', textBaseline: '',
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
const { buildKart, buildKartFromLoadout, updateKartVisual } = await import('../src/kartMesh.js');
const { buildRaceRoster } = await import('../src/roster.js');
const { DEFAULT_LOADOUT } = await import('../src/content/loadout.js');
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
// Exact same grid construction main.js uses: the player drives their garage
// build, each rival brings their own character's loadout.
const defs = buildRaceRoster({
  playerSpec: { ...DEFAULT_LOADOUT, characterId: 'thistle', chassisId: 'bumblewisp', wheelId: 'gyro_rings' },
  rivals: 3,
  rng: (() => { let s = 7; return () => (s = (s * 1103515245 + 12345) % 2147483647) / 2147483647; })(),
});
const kartCharacterIds = [];
for (const d of defs) {
  const v = new VehicleController(track, d.isPlayer, d.loadout.params, d.loadout.driftMods);
  const kart = {
    vehicle: v,
    ai: d.isPlayer ? null : new AIController(v, track, d.personality),
    nameKey: d.nameKey,
    characterId: d.characterId,
    isPlayer: d.isPlayer,
  };
  race.registerKart(kart);
  visuals.set(v, buildKartFromLoadout(d.loadout));
  kartCharacterIds.push(d.characterId);
}
check('grid has four distinct pilots', new Set(kartCharacterIds).size === 4, kartCharacterIds.join(','));
check('player kart carries its own build', (() => {
  const p = race.karts.find((k) => k.isPlayer).vehicle.params;
  const ai = race.karts.find((k) => !k.isPlayer).vehicle.params;
  return p !== ai && Number.isFinite(p.maxSpeed);
})());
check('every kart mesh includes a pilot model', [...visuals.values()].every((v) => !!v.charVis));

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

// ---------------------------------------------------- grand prix cup session
const { GrandPrixSession } = await import('../src/grandprix.js');
const gp = new GrandPrixSession('ember', 'ai.you');
check('gp starts on first cup track', gp.trackId === 'sunforge_circuit');

function runFullRace(raceMgr, player, { onLap } = {}) {
  let t = 0;
  let lap1Leader = null;
  raceMgr.onEvent = (type, payload) => {
    if (type === 'lapComplete' && payload.lap === 1 && !lap1Leader) {
      lap1Leader = payload.kart.nameKey;
      onLap && onLap(payload);
    } else if (type === 'lapComplete') {
      onLap && onLap(payload);
    }
  };
  while (raceMgr.state !== 'results' && t < 600) {
    raceMgr.playerInput = raceMgr.state === 'racing'
      ? player.ai.update(dt, raceMgr.karts, true)
      : { throttle: 0, brake: 0, steer: 0, drift: false, trick: false };
    raceMgr.update(dt);
    t += dt;
  }
  return lap1Leader;
}

while (!gp.finished) {
  race.lapsOverride = gp.laps;
  race.restart();
  check(`gp race ${gp.raceIndex + 1} lap override applied`,
    race.kartState.get(playerKart.vehicle).laps === gp.laps);
  const lap1 = runFullRace(race, playerKart);
  if (lap1) gp.markLap1Leader(lap1);
  const rows = race.positions().map((kart, i) => ({
    nameKey: kart.nameKey, pos: i + 1,
    bestLap: race.kartState.get(kart.vehicle).bestLap,
  }));
  gp.recordRace(rows);
}
const gpFinal = gp.finalStandings();
check('gp finished after 4 races', gp.results.length === 4);
check('gp standings cover all karts', gp.standings().length === 4);
check('gp player points positive', gpFinal.playerPoints > 0);
check('gp trophy awarded or absent', gpFinal.trophy === null ||
  ['bronze', 'silver', 'gold', 'platinum'].includes(gpFinal.trophy));

// --------------------------------------------------------------- time trial
const { TimeTrialSession, RecordsStore } = await import('../src/timetriial.js');
const { GhostPlayer, serializeGhost, deserializeGhost } = await import('../src/ghost.js');

const ttRace = new RaceManager({ track, hud, audio, i18n, onEvent: () => {} });
const ttVehicle = new VehicleController(track, true);
const ttKart = { vehicle: ttVehicle, ai: new AIController(ttVehicle, track, 'balanced'), nameKey: 'ai.you', isPlayer: true };
ttRace.registerKart(ttKart);
ttRace.lapsOverride = 3;

const tt = new TimeTrialSession('sunforge_circuit');
tt.start(0);
ttRace.restart();
check('tt solo grid has one kart', ttRace.karts.length === 1);

let ghostFrames = 0;
ttRace.onEvent = (type, payload) => {
  if (type === 'lapComplete' && payload.kart.isPlayer) {
    tt.onLap(ttRace.raceTime, payload.lapTime);
  }
};
let ttT = 0;
while (ttRace.state !== 'results' && ttT < 600) {
  ttRace.playerInput = ttRace.state === 'racing'
    ? ttKart.ai.update(dt, ttRace.karts, true)
    : { throttle: 0, brake: 0, steer: 0, drift: false, trick: false };
  ttRace.update(dt);
  if (ttRace.state === 'racing') { tt.captureGhost(ttVehicle); ghostFrames++; }
  ttT += dt;
}
check('tt race finished', ttRace.state === 'results');
check('tt recorded 3 laps', tt.lapTimes.length === 3);
check('tt ghost frames captured', ghostFrames > 1000, `frames=${ghostFrames}`);

const ttResult = tt.finish();
const records = new RecordsStore(save);
const updated = records.submit(ttResult);
check('tt record submitted', updated.includes('total'));
const stored = records.get('sunforge_circuit');
check('tt record persisted with ghost', !!stored && Array.isArray(stored.ghost) && stored.ghost.length > 1000);

// ghost round-trip + playback interpolation
const ghostData = deserializeGhost(serializeGhost(stored.ghost));
const player2 = new GhostPlayer(ghostData, dt);
const p0 = player2.update(dt);
const p1 = player2.update(dt);
check('ghost playback produces poses', !!p0 && !!p1 && Number.isFinite(p0.x) && Number.isFinite(p1.yaw));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
