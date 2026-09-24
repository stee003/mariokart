// Mobile input and fixed-aspect viewport regression tests.
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let passed = 0, failed = 0;
const check = (name, ok, extra = '') => {
  ok ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

const { GAMEPLAY_ASPECT, fitAspectViewport, detectMobileDevice } = await import('../src/mobile.js');

console.log('--- Mobile 16:9 viewport ---');
for (const [name, w, h] of [
  ['portrait phone', 390, 844],
  ['small portrait phone', 320, 568],
  ['landscape phone', 844, 390],
  ['desktop', 1440, 900],
]) {
  const r = fitAspectViewport(w, h);
  check(`${name} viewport stays 16:9`, Math.abs(r.width / r.height - GAMEPLAY_ASPECT) < 1e-9,
    `${r.width}x${r.height}`);
  check(`${name} viewport fits and is centred`, r.x >= 0 && r.y >= 0 &&
    Math.abs(r.x * 2 + r.width - w) < 1e-9 && Math.abs(r.y * 2 + r.height - h) < 1e-9);
}
check('zero-sized viewport is safe', fitAspectViewport(0, 0).width === 0);
check('coarse pointer detects mobile', detectMobileDevice({ matchMedia: () => ({ matches: true }) }, {}));
check('touchscreen iPad is detected without UA sniffing', detectMobileDevice({}, { maxTouchPoints: 5, userAgent: 'Macintosh' }));
check('desktop pointer is not classified as mobile', !detectMobileDevice({ matchMedia: () => ({ matches: false }) }, { maxTouchPoints: 0, userAgent: 'Desktop' }));

console.log('--- Unified touch action input ---');
const events = {};
global.window = { addEventListener: (type, fn) => { (events[type] ??= []).push(fn); } };
Object.defineProperty(global, 'navigator', {
  value: { getGamepads: () => [] }, configurable: true, writable: true,
});
const { InputManager } = await import('../src/input.js');
const input = new InputManager({ get: () => ({}), set() {} });
input.poll();

input.setTouchStick(-0.65, -0.8);
let snap = input.snapshot();
check('virtual stick steers left and accelerates', Math.abs(snap.steer - 0.65) < 1e-9 && Math.abs(snap.throttle - 0.8) < 1e-9,
  JSON.stringify(snap));
input.setTouchStick(0.4, 0.7);
snap = input.snapshot();
check('virtual stick steers right and brakes', Math.abs(snap.steer + 0.4) < 1e-9 && Math.abs(snap.brake - 0.7) < 1e-9,
  JSON.stringify(snap));
input.setTouchStick(0, 0);
check('joystick release immediately returns to neutral', input.snapshot().steer === 0 &&
  input.snapshot().throttle === 0 && input.snapshot().brake === 0);

input.setTouchAction('throttle', true);
input.setTouchAction('left', true);
input.setTouchAction('drift', true);
snap = input.snapshot();
check('touch buttons combine throttle, steering and held drift', snap.throttle === 1 && snap.steer === 1 && snap.drift);
input.setTouchAction('throttle', false);
input.setTouchAction('left', false);
input.setTouchAction('drift', false);

input.setTouchAction('item', true);
check('item button creates a one-frame edge', input.wasPressed('item'));
input.endFrame();
check('held item button does not retrigger each frame', !input.wasPressed('item'));
input.setTouchAction('item', false);
input.setTouchAction('item', true);
check('item can be pressed again after release', input.wasPressed('item'));
input.setTouchAction('pause', true);
check('touch pause is exposed through the shared pause action', input.wasPressed('pause'));
input.clearTouch();
check('clearing touch state releases every held action', input.snapshot().steer === 0 &&
  input.snapshot().throttle === 0 && !input.snapshot().drift && !input.wasPressed('pause'));

console.log('--- Mobile interface markup ---');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
for (const id of ['touch-controls', 'touch-joystick', 'touch-pause', 'touch-fullscreen',
  'btn-fullscreen', 'control-mode-list', 'touch-layout-list', 'gamepad-status']) {
  check(`index.html includes #${id}`, html.includes(`id="${id}"`));
}
for (const action of ['throttle', 'brake', 'left', 'right', 'drift', 'item', 'trick', 'reset', 'pause']) {
  check(`touch controls expose ${action}`, html.includes(`data-touch-action="${action}"`));
}
check('CSS keeps touch controls hidden until enabled', css.includes('.touch-controls.hidden') ||
  (css.includes('.touch-controls {') && css.includes('.touch-controls:not(.hidden)')));
check('CSS supports alternate D-pad layout', css.includes('body[data-touch-layout="buttons"] .touch-dpad'));
check('HUD follows the fitted gameplay rectangle', css.includes('left: var(--game-left)') && css.includes('height: var(--game-height)'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
