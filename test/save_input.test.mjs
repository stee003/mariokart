// Save-data robustness + input remapping/gamepad unit tests.
import { SaveManager } from '../src/save.js';
import { RecordsStore } from '../src/timetrial.js';
import { buildLoadout, DEFAULT_LOADOUT } from '../src/content/loadout.js';
import { deserializeGhost } from '../src/ghost.js';
import { InputManager, DEFAULT_KEYMAP, keyLabel } from '../src/input.js';
import { VehicleController } from '../src/vehicle.js';
import { TrackManager } from '../src/track.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

// in-memory localStorage shim controllable per test
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function gameWithStorage(store) {
  global.window = global.window || { addEventListener() {} };
  global.window.localStorage = store;
  return new SaveManager();
}

// --------------------------------------------------------------- save robustness
{
  const save = gameWithStorage(makeStorage());
  check('fresh save uses defaults', save.get('lang') === 'en' && save.storageOk);
  save.set('lang', 'it');
  check('set persists to storage',
    JSON.parse(global.window.localStorage.getItem('sunforge_racers_save_v1')).lang === 'it');
  check('language survives restart (reload simulation)',
    gameWithStorage(global.window.localStorage).get('lang') === 'it');
}
{
  const save = gameWithStorage(makeStorage({ sunforge_racers_save_v1: '{not json' }));
  check('corrupt JSON falls back to defaults', save.get('lang') === 'en');
  check('persistence still works after corruption (self-heals)', save.storageOk);
  save.set('lang', 'it');
  check('healed save writes over the corrupt blob',
    global.window.localStorage.getItem('sunforge_racers_save_v1').includes('"lang":"it"'));
}
{
  const save = gameWithStorage(makeStorage({ sunforge_racers_save_v1: '[1,2,3]' }));
  check('non-object blob resets to defaults', save.get('lang') === 'en' && save.storageOk);
}
{
  const save = gameWithStorage(makeStorage({ sunforge_racers_save_v1: '"hacked"' }));
  check('string blob resets to defaults', save.get('volume') === 0.8);
}

// --------------------------------------------------------------- records/ghost
const memStore = { get: (k, fb) => (k in memStore._d ? memStore._d[k] : fb), set: (k, v) => { memStore._d[k] = v; }, _d: {} };
{
  memStore._d.records = 'garbage-string';
  const store = new RecordsStore(memStore);
  check('corrupt records field starts clean', Object.keys(store.records).length === 0);
}
{
  const store = new RecordsStore(memStore);
  const frames = [];
  for (let i = 0; i < 300; i++) frames.push({ x: i, y: 1, z: -i, yaw: 0.5 });
  store.submit({ trackId: 'x', totalTime: 100, bestLap: 30, lapTimes: [30, 30, 40], ghostFrames: frames });
  const rec = store.get('x');
  check('ghost stored compactly (30 Hz downsample)', rec.ghost.length === 4 * 151 && rec.ghostStep === 2,
    `len=${rec.ghost.length}`);
  const back = store.ghostFor('x');
  check('ghostFor reconstructs frames + step', back.step === 2 && back.frames.length === 151);
  check('ghost survives serialization round trip',
    deserializeGhost(rec.ghost)[150].x === frames[300 - 1 - (300 - 1) % 2]?.x || deserializeGhost(rec.ghost).at(-1).x === 299);
  check('decoder output rows are {x,y,z,yaw}', back.frames.every((f) => Number.isFinite(f.x) && Number.isFinite(f.yaw)));
  check('track with no ghost returns null', store.ghostFor('missing') === null);
}

// --------------------------------------------------------------- loadout robustness
{
  const lo = buildLoadout({ characterId: 'hacker', chassisId: 'nope', wheelId: 'fake', paintId: 'zzz' });
  check('garbage loadout falls back safely', lo.character.id === 'ember' && lo.chassis.id === DEFAULT_LOADOUT.chassisId);
  check('garbage loadout still yields finite physics params',
    Number.isFinite(lo.params.maxSpeed) && Number.isFinite(lo.params.accel));
  const track = new TrackManager();
  const v = new VehicleController(track, true, lo.params, lo.driftMods);
  v.step(1 / 60, { throttle: 1, brake: 0, steer: 0, drift: false, trick: false }, false);
  check('steps cleanly with recovered loadout', Number.isFinite(v.pos.x) && Number.isFinite(v.yaw));
}
{
  const lo = buildLoadout({});
  const stock = new TrackManager();
  const v = new VehicleController(stock, true, lo.params, null);
  check('default loadout reproduces stock-ish handling',
    Math.abs(lo.params.maxSpeed - 30 * (0.93 + (1.085 - 0.93) * ((lo.stats.topSpeed) / 10))) < 1e-9);
  check('default loadout driftMods come from stats', lo.driftMods.chargeRate > 0.8);
}

// --------------------------------------------------------------- input remapping
{
  const events = {};
  global.window = {
    addEventListener: (type, fn) => { (events[type] = events[type] ?? []).push(fn); },
    getGamepads: () => [],
  };
  Object.defineProperty(global, 'navigator', { value: { getGamepads: () => [] }, configurable: true, writable: true });
  const save = gameWithStorage(makeStorage());
  const input = new InputManager(save);
  const fire = (type, code) => events[type].forEach((fn) => fn({ code, preventDefault() {} }));

  input.poll();
  fire('keydown', 'KeyW');
  check('default throttle mapping', input.isDown('throttle'));
  check('no remap by default', input.bindings().throttle === 'KeyW' || input.bindings().throttle === 'ArrowUp');

  // Vehicle steering uses positive yaw for a visual left turn. The input
  // boundary must map conventional left controls to that sign.
  fire('keydown', 'KeyA');
  check('A steers visually left', input.snapshot().steer === 1);
  fire('keyup', 'KeyA');
  fire('keydown', 'ArrowRight');
  check('right arrow steers visually right', input.snapshot().steer === -1);
  fire('keyup', 'ArrowRight');

  input.setBinding('throttle', 'KeyJ');
  fire('keyup', 'KeyW');
  check('old binding stops working after remap', !input.isDown('throttle'));
  fire('keydown', 'KeyJ');
  check('new binding drives the action', input.isDown('throttle'));
  input.endFrame(); input.poll();
  check('snapshot reflects remapped key', input.snapshot().throttle === 1);
  fire('keyup', 'KeyJ');

  check('remap persists into the save', save.get('keys', {}).throttle === 'KeyJ');
  const input2 = new InputManager(gameWithStorage(global.window.localStorage));
  check('remap survives restart', input2.bindings().throttle === 'KeyJ');

  input.resetBindings();
  check('reset restores default bindings', input.bindings().throttle === 'ArrowUp' || input.bindings().throttle === 'KeyW');
  check('reset clears the save entry', Object.keys(save.get('keys', {})).length === 0);

  // capture flow (settings UI): Escape cancels, anything else captures
  input.captureNextKey((code) => { input._captured = code; });
  fire('keydown', 'Escape');
  check('Esc cancels a capture', input._captured === null && !input.capturing);
  input.captureNextKey((code) => { input._captured = code; });
  fire('keydown', 'KeyQ');
  check('capture takes the pressed key', input._captured === 'KeyQ');
  check('captured key is not treated as gameplay input', !input.pressed.has('KeyQ'));

  check('keyLabel formats common keys', keyLabel('KeyW') === 'W' && keyLabel('ShiftLeft') === 'L-SHIFT' && keyLabel('ArrowUp') === '↑');
}

// --------------------------------------------------------------- gamepad
{
  const events = {};
  global.window = { addEventListener: (t, fn) => { (events[t] = events[t] ?? []).push(fn); } };
  const mkPad = (over = {}) => ({
    connected: true,
    axes: [over.steer ?? 0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: !!over['b' + i], value: over['v' + i] ?? (over['b' + i] ? 1 : 0),
    })),
  });
  let pad = mkPad({ steer: -0.6, v7: 0.8 });
  Object.defineProperty(global, 'navigator', { value: { getGamepads: () => [pad] }, configurable: true, writable: true });
  const input = new InputManager(gameWithStorage(makeStorage()));

  input.poll();
  check('gamepad detected', input.gamepadConnected);
  const snap = input.snapshot();
  check('stick-left steers visually left', Math.abs(snap.steer - 0.6) < 1e-6, `steer=${snap.steer}`);
  check('stick-left reports the left action', input.isDown('left') && !input.isDown('right'));
  check('analog trigger throttles', Math.abs(snap.throttle - 0.8) < 1e-6);

  pad = mkPad({ b14: true });               // d-pad left
  global.navigator.getGamepads = () => [pad];
  input.poll();
  check('d-pad left steers visually left', input.snapshot().steer === 1);

  pad = mkPad({ steer: 0.6, b15: true });   // stick/d-pad right
  global.navigator.getGamepads = () => [pad];
  input.poll();
  check('stick and d-pad right steer visually right', input.snapshot().steer === -1
    && input.isDown('right') && !input.isDown('left'));

  pad = mkPad({ steer: 0.05 });            // inside dead zone
  global.navigator.getGamepads = () => [pad];
  input.poll();
  check('stick dead zone filters noise', input.snapshot().steer === 0);

  pad = mkPad({ b2: true });               // X held = drift
  global.navigator.getGamepads = () => [pad];
  input.poll();
  check('X holds drift', input.snapshot().drift === true);

  pad = mkPad({ b9: true });               // START edge = pause
  global.navigator.getGamepads = () => [pad];
  input.poll();
  check('START edge triggers pause', input.wasPressed('pause'));
  input.endFrame();
  input.poll();
  check('held START does not re-trigger', !input.wasPressed('pause'));

  pad = mkPad({ b3: true });               // Y edge = item
  global.navigator.getGamepads = () => [pad];
  input.poll();
  check('Y triggers power-up use', input.snapshot().item === true);

  pad = null;
  global.navigator.getGamepads = () => [];
  input.poll();
  check('disconnect does not crash', input.snapshot().steer === 0 && !input.gamepadConnected);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
