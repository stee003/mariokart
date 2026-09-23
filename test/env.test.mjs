// Environment renderer tests (headless with DOM stubs): every track must
// produce a populated themed world, camera colliders where structures exist,
// and an animation state hook.
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
    classList: { _set: new Set(), add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      toggle(c, f) { if (f === undefined) this._set.has(c) ? this._set.delete(c) : this._set.add(c); else f ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); } },
    addEventListener() {}, removeEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    append(...items) { this.children.push(...items); },
    querySelectorAll() { return []; },
    getContext() { return fake2D(); },
  };
}
const elements = {};
global.window = { addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  localStorage: { getItem: () => null, setItem() {} } };
global.document = {
  getElementById(id) { return elements[id] || (elements[id] = makeElement(id)); },
  createElement() { return makeElement('x'); },
  querySelectorAll() { return []; },
  body: makeElement('body'),
};

const { TrackManager } = await import('../src/track.js');
const { buildEnvironment } = await import('../src/environment.js');
const { buildThemedEnvironment } = await import('../src/environment2.js');
const { TRACK_DEFS } = await import('../src/content/trackDefs.js');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

for (const def of TRACK_DEFS) {
  const track = new TrackManager(def);
  const scene = new THREE.Scene();
  const env = def.id === 'sunforge_circuit'
    ? buildEnvironment(scene, track)
    : buildThemedEnvironment(scene, track, 'TEST');
  // Count renderable descendants: instanced scenery is deliberately grouped.
  let kids = 0;
  env.group.traverse(o => { if (o.isMesh || o.isPoints) kids++; });
  check(`${def.id}: env populated (${def.theme}, ${kids} nodes)`, kids > 30, `children=${kids}`);
  check(`${def.id}: state.update animates`, typeof env.state.update === 'function');
  // animation step must not throw (obstacles sync with track sim)
  track.update(0.016, 1);
  env.state.update(0.016, 1);
  env.state.update(0.016, 4.5);
  check(`${def.id}: colliders present`, Array.isArray(env.colliders));
  if (def.ranges?.tunnel) {
    check(`${def.id}: tunnel adds camera colliders`, env.colliders.length >= 4, `n=${env.colliders.length}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
