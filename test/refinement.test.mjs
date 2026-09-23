// Regressions for the explicitly requested eight-track refinement. Historical
// definitions of the OTHER eight tracks are protected by independent hashes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from '../lib/three.module.js';
import { TRACK_DEFS } from '../src/content/trackDefs.js';
import { TrackManager } from '../src/track.js';
import { MusicManager } from '../src/music.js';
import { REFINEMENT_KITS } from '../src/refinedEnvironment.js';
import { REFINEMENT_MUSIC } from '../src/content/refinementMusic.js';
import { buildThemedEnvironment } from '../src/environment2.js';

const widths = {
  forge_line: [20,18,14,13,12.5,12.5,13.5,13,13,15],
  skyreach: [18,15,13,12,12,12.5,12,12.5,14],
  ruins_of_vael: [22,19,14,13,12.5,13,13.5,12.5,12,14],
  sandstone_crown: [20,16,13,12,11.5,11.5,11,11.5],
  tempest_ridge: [20,17,14,13,12.5,13,13.5,15],
  glimmer_deep: [18,16,13,12.5,12,11.5,12,13,14],
  orbital_ring: [24,22,17,15,15,15,16,18],
  void_terminal: [18,16,13,12,11.5,11.5,12,13,14],
};
const landmarks = {
  forge_line: 'Central blast furnace', skyreach: 'Sky beacon tower',
  ruins_of_vael: 'Vael celestial sundial', sandstone_crown: 'Sandstone crown monument',
  tempest_ridge: 'Stormwatch station', glimmer_deep: 'Heart of Glimmer',
  orbital_ring: 'Orbital habitation ring', void_terminal: 'Void transit aperture',
};
assert.deepEqual(Object.keys(REFINEMENT_KITS), Object.keys(widths));
assert.deepEqual(Object.keys(REFINEMENT_MUSIC), Object.keys(widths));
const untouched=JSON.parse(readFileSync(new URL('./fixtures/refinement-untouched-hashes.json',import.meta.url)));
assert.equal(Object.keys(untouched).length,8);
for(const def of TRACK_DEFS.filter(d=>!widths[d.id])) {
  assert.equal(createHash('sha256').update(JSON.stringify(def)).digest('hex'),untouched[def.id],`${def.id}: not requested, not changed`);
}
console.log('PASS all eight unrequested track definitions remain byte-equivalent');
global.document={createElement:()=>{
  const canvas={width:0,height:0};
  const ctx=new Proxy({}, {get:(_,key)=>key==='fillText'?text=>{canvas.drawnText=text;}
    :key.startsWith('create')?()=>({addColorStop(){}}):()=>{}});
  canvas.getContext=()=>ctx;return canvas;
}};
const save={get:(_,fallback)=>fallback,set(){}};
for(const [id,oldWidths] of Object.entries(widths)) {
  const def=TRACK_DEFS.find(d=>d.id===id),track=new TrackManager(def);
  assert.deepEqual(def.points.map(p=>p.w),oldWidths.map(w=>w+2),`${id}: +2m physical road width`);
  assert.ok(Math.min(...track.samples.map(p=>p.width))>12.5);
  for(let i=0;i<track.n;i++) {
    const p=track.samples[i],q=track.samples[(i+1)%track.n];
    const radius=p.pos.distanceTo(q.pos)/Math.max(.00001,Math.acos(Math.min(1,p.dir.dot(q.dir))));
    assert.ok(radius>p.width/2+2.8,`${id}: no folded shoulder at ${i}`);
  }
  for(let i=0;i<track.n;i+=3) for(let j=i+3;j<track.n;j+=3) {
    const a=track.samples[i],b=track.samples[j];
    if(Math.min(b.s-a.s,track.L-b.s+a.s)<40) continue;
    assert.ok(a.pos.distanceTo(b.pos)>(a.width+b.width)/2+5.6,`${id}: separated nonadjacent road sections`);
  }
  for(const ramp of def.ramps) {
    assert.ok(ramp.rise/ramp.len<=.17,`${id}: ramp grade`);
    assert.ok(Math.abs(ramp.lat)+ramp.halfW<track.pointAt(ramp.f*track.L).width/2);
  }
  if(track.shortcut) {
    assert.ok(track.shortcut.halfW>=3.6);
    assert.ok(track.pads.some(p=>p.shortcut));
  }
  for(const zone of def.zones.filter(z=>z.type==='wind')) {
    assert.ok(!def.ramps.some(r=>r.f>=zone.f0&&r.f<=zone.f1),'no jump launch inside crosswind');
  }
  const scene=new THREE.Scene(),oldLight=new THREE.AmbientLight(0xff0000,10);scene.add(oldLight);
  const env=buildThemedEnvironment(scene,track,id);
  assert.equal(oldLight.visible,false);
  assert.equal(env.group.children.filter(o=>o.isLight).length,3);
  const root=env.group.getObjectByName(`${id} refined scenery`);
  assert.ok(root?.getObjectByName(landmarks[id]));
  const turns=[];
  root.traverse(o=>{const text=o.material?.map?.image?.drawnText;if(['‹‹','››'].includes(text))turns.push(text);});
  const expectedTurns=[];
  for(let f=.08;f<.98;f+=.047) {
    const p=track.pointAt(f*track.L),q=track.pointAt(f*track.L+25);
    const cameraRight=p.dir.clone().cross(new THREE.Vector3(0,1,0));
    const turn=q.dir.dot(cameraRight);
    if(Math.abs(turn)>.28)expectedTurns.push(turn>0?'››':'‹‹');
  }
  assert.deepEqual(turns,expectedTurns,`${id}: chevrons point into the bend from the driver's view`);
  if(track.tunnelRange) assert.ok(env.colliders.length>=4);
  let meshes=0,instances=0;
  env.group.traverse(o=>{if(o.isMesh)meshes++;if(o.isInstancedMesh)instances+=o.count;});
  assert.ok(meshes<210,`${id}: bounded mesh budget ${meshes}`);
  assert.ok(instances>450,`${id}: detailed batched world ${instances}`);
  for(const t of [0,.016,.5,5,60,600]) {
    track.update(.016,t);env.state.update(.016,t);
    env.group.traverse(o=>{
      assert.ok(o.position.toArray().every(Number.isFinite));
      assert.ok(o.scale.toArray().every(Number.isFinite));
      if(o.geometry?.attributes.position) assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));
      if(o.isInstancedMesh) assert.ok(o.instanceMatrix.array.every(Number.isFinite));
    });
  }
  // Raycast through the knee-height driving corridor. Raised foundations and
  // decorative rocks must not poke through the road (including on gradients).
  env.state.update(0,0);env.group.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);
  const drivingSamples=[...track.samples,...(track.shortcut?.samples||[])];
  for(let i=0;i<drivingSamples.length;i+=7) for(const lane of [-.65,0,.65]) {
    const p=drivingSamples[i],origin=p.pos.clone().addScaledVector(p.right,lane*(p.width/2-2));origin.y+=1.5;
    ray.set(origin,down);ray.near=0;ray.far=1.2;
    const hits=ray.intersectObject(root,true).filter(h=>h.object.isMesh&&h.object.material?.visible!==false);
    assert.equal(hits.length,0,`${id}: scenery intrudes on driving corridor at ${(i/track.n).toFixed(3)}: ${hits[0]?.object.name}`);
  }
  env.dispose();scene.remove(env.group);assert.equal(oldLight.visible,true);
  console.log(`PASS ${id}: layout, scenery clearance, landmark, ${meshes} meshes / ${instances} instances, light lifecycle`);
  const spec=def.music;
  assert.equal(spec.loopSteps,64);assert.equal(spec.chords.length,8);
  for(const pattern of [spec.lead,spec.bass,...Object.values(spec.drums)]) {
    assert.equal(pattern.length,64);assert.ok(pattern.every(n=>n===null||Number.isFinite(n)));
  }
  assert.notDeepEqual(spec.lead.slice(0,32),spec.lead.slice(32));
  const music=new MusicManager(save);music.setTheme(def.musicSeed,def.theme,spec);
  let tones=0;
  music._tone=(f,t,d)=>{assert.ok(Number.isFinite(f)&&f>0&&f<24000&&d>0);tones++;};
  music._kick=music._hat=music._snare=()=>{};
  for(const state of ['countdown','racing','finalLap','victory','defeat']) {
    music.setState(state);for(let s=0;s<64;s++)music._playStep(s,s*.25,.25);
  }
  assert.ok(tones>300);
  const heard=[];music.ctx={currentTime:0};music._nextNoteTime=0;music._step=0;music._playStep=s=>heard.push(s);
  for(let i=0;i<440;i++){music.ctx.currentTime=i*.05;music._schedule();}
  assert.equal(heard[63],63);assert.equal(heard[64],0);
  music.setTheme(11,'desert');assert.equal(music._step,0);
  console.log(`PASS ${id}: complete original score, dynamic states, scheduler wrap and legacy transition`);
}
console.log('Eight-track refinement regressions passed.');
