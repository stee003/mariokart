// Focused regression coverage for the three-track expedition pass.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from '../lib/three.module.js';
import { TRACK_DEFS } from '../src/content/trackDefs.js';
import { TrackManager } from '../src/track.js';
import { MusicManager, buildTheme } from '../src/music.js';
import { EXPEDITION_KITS } from '../src/expeditionEnvironment.js';
import { buildThemedEnvironment } from '../src/environment2.js';

const ids = ['granite_pass', 'magma_coil', 'abyss_dock'];
const untouched = JSON.parse(readFileSync(new URL('./fixtures/untouched-track-hashes.json', import.meta.url)));
assert.deepEqual(Object.keys(EXPEDITION_KITS), ids, 'art direction is scoped by ID');
for (const [id, hash] of Object.entries(untouched)) {
  const def = TRACK_DEFS.find(d => d.id === id);
  assert.equal(createHash('sha256').update(JSON.stringify(def)).digest('hex'), hash, `${id} content unchanged`);
}
assert.equal(Object.keys(untouched).length, TRACK_DEFS.length - 3);
console.log('PASS all 13 other track definitions match their pre-pass fingerprints');

const ctx = new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
const save = { get: (_, fallback) => fallback, set() {} };
for (const id of ids) {
  const def = TRACK_DEFS.find(d => d.id === id), track = new TrackManager(def);
  assert.ok(Math.min(...track.samples.map(p => p.width)) >= 12.8, `${id}: comfortable minimum width`);
  for (let i = 0; i < track.n; i++) {
    const p = track.samples[i], q = track.samples[(i + 1) % track.n];
    const angle = Math.acos(Math.min(1, p.dir.dot(q.dir)));
    const radius = p.pos.distanceTo(q.pos) / Math.max(.00001, angle);
    assert.ok(radius > p.width / 2 + 2.8, `${id}: no folded inner shoulder at ${i}`);
  }
  for (let i = 0; i < track.n; i += 3) for (let j = i + 3; j < track.n; j += 3) {
    const a = track.samples[i], b = track.samples[j];
    if (Math.min(b.s - a.s, track.L - b.s + a.s) < 40) continue;
    assert.ok(a.pos.distanceTo(b.pos) > (a.width + b.width) / 2 + 5.6, `${id}: separated road aprons`);
  }
  for (const ramp of def.ramps) {
    assert.ok(ramp.rise / ramp.len <= .17, `${id}: forgiving ramp grade`);
    const p = track.pointAt(ramp.f * track.L);
    assert.ok(Math.abs(ramp.lat) + ramp.halfW < p.width / 2, `${id}: ramp fits road`);
  }
  for (const [i, spec] of def.obstacles.entries()) {
    if (spec.type !== 'flamejet' && spec.type !== 'pendulum') continue;
    const p = track.pointAt(spec.s * track.L), obstacle = track.obstacles[i];
    assert.ok((obstacle.base || obstacle.pos).distanceTo(p.pos.clone().addScaledVector(p.right, spec.lat)) < 1e-6,
      `${id}: hazard's visual and physical lane offset agree`);
  }
  console.log(`PASS ${id}: widths, shoulder curvature, road separation, ramps, hazard offsets`);

  const scene = new THREE.Scene();
  const previousLight = new THREE.AmbientLight(0xff0000, 8);
  scene.add(previousLight);
  const env = buildThemedEnvironment(scene, track, id);
  assert.equal(previousLight.visible, false, 'prior world lights cannot alter this palette');
  assert.equal(env.group.children.filter(o => o.isLight).length, 3, 'new lighting belongs to its world');
  assert.ok(env.group.getObjectByName(`${id} bespoke scenery`));
  const counts = { instances: 0, meshes: 0 };
  const checkFinite = () => env.group.traverse(o => {
    assert.ok(o.position.toArray().every(Number.isFinite));
    if (o.geometry?.attributes.position) assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));
    if (o.isInstancedMesh) assert.ok(o.instanceMatrix.array.every(Number.isFinite));
  });
  for (const time of [0, .5, 3, 8, 30, 300]) { track.update(.016, time); env.state.update(.016, time); checkFinite(); }
  env.group.traverse(o => { if (o.isMesh) counts.meshes++; if (o.isInstancedMesh) counts.instances += o.count; });
  assert.ok(counts.instances > 300, `${id}: rich batched environment`);
  assert.ok(counts.meshes < 200, `${id}: bounded draw-call budget`);
  if (id === 'abyss_dock') {
    assert.ok(env.group.getObjectByName('Observation tunnel glass'));
    assert.ok(env.colliders.length >= 4);
    assert.ok(track.pads.some(p => p.shortcut));
  }
  if (id === 'magma_coil') assert.ok(env.group.getObjectByName('Incandescent crater'));
  if (id === 'granite_pass') assert.ok(env.group.getObjectByName('Summit lookout'));
  console.log(`PASS ${id}: animated finite geometry, landmarks, ${counts.instances} batched instances / ${counts.meshes} meshes`);

  env.dispose();
  scene.remove(env.group);
  assert.equal(previousLight.visible, true, 'restore legacy lighting state on track exit');
  assert.equal(scene.children.filter(o => o.isLight).length, 1, 'no expedition lights leak');

  const spec = def.music;
  assert.equal(spec.loopSteps, 64);
  assert.equal(spec.chords.length, 8);
  for (const pattern of [spec.bass, spec.lead, ...Object.values(spec.drums)]) {
    assert.equal(pattern.length, 64, `${id}: complete eight-bar pattern`);
    assert.ok(pattern.every(n => n === null || Number.isFinite(n)));
  }
  assert.notDeepEqual(spec.lead.slice(0, 32), spec.lead.slice(32), `${id}: answering phrase, not duplicate loop`);
  const music = new MusicManager(save);
  music.setTheme(def.musicSeed, def.theme, spec);
  let tones = 0;
  music._tone = (freq, time, dur) => { assert.ok(Number.isFinite(freq) && freq > 0 && dur > 0); tones++; };
  music._kick = music._hat = music._snare = () => {};
  for (const state of ['menu', 'countdown', 'racing', 'finalLap', 'victory', 'defeat']) {
    music.setState(state);
    for (let s = 0; s < 64; s++) music._playStep(s, s * .25, .25);
  }
  assert.ok(tones > 300);
  // Exercise the actual scheduler, including wrap, not just direct playback.
  const heard = [];
  music.ctx = { currentTime: 0 }; music._nextNoteTime = 0; music._step = 0;
  music._playStep = s => heard.push(s);
  for (let i = 0; i < 400; i++) { music.ctx.currentTime = i * .05; music._schedule(); }
  assert.ok(heard.includes(63));
  assert.equal(heard[64], 0);
  music._step = 59;
  music.setTheme(11, 'desert');
  assert.equal(music._step, 0, 'switching to legacy music cannot index past its pattern');
  assert.deepEqual(music.theme, buildTheme(11, 'desert'));
  const legacy = TRACK_DEFS.find(d => d.id === 'sunforge_circuit');
  music.setTheme(legacy.musicSeed, legacy.theme, legacy.music);
  assert.equal(music.theme.loopSteps, 16, 'unrequested tracks retain their existing playback');
  console.log(`PASS ${id}: eight bars, finite audio, all dynamic states and legacy transitions`);
}
console.log('\nExpedition regression checks passed.');
