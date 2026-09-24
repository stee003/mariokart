// Verdant Loop — Lanternwood. All scenery is procedural and ID-scoped; the
// spline, checkpoints, shortcuts, ramps and racing line are left untouched.
// Repeated foliage is instanced, and solid props/wildlife are placed against
// BOTH the main route and the shortcut, not just the nearest road sample.
import * as THREE from '../lib/three.module.js';
import { CONFIG } from './config.js';
import { shorelineRadius, waterFootprint } from './water.js';

export const VERDANT_KIT = {
  refinedRoad: true, road2: true,
  sky: ['#365e83', '#80b2c6', '#cce1c1', '#f5dfad'],
  fog: [0xabcab4, 135, 620],
  hemi: [0xf6ebc9, 0x315747, 1.18],
  sun: [0xffedbd, 1.55], sunPos: [140, 240, -90],
  sunDisc: { color: 0xffe5a8, r: 31, pos: [420, 320, -540] },
  ground: 0x385f46, groundDepth: 0.6,
  road: [0.31, 0.40, 0.35],
  shoulder: [0.20, 0.37, 0.27], edge: [0.78, 0.95, 0.75],
  curbA: 0xe1c684, curbB: 0x286455,
  banner: { bg: '#193d38', stripe: '#d9bc75', text: '#f7efc9' },
};

const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const yaw = p => Math.atan2(p.dir.x, p.dir.z);
const wood = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.93, flatShading: true, ...extra });
const lit = (color, opacity = 1) => new THREE.MeshBasicMaterial({
  color, transparent: opacity < 1, opacity, depthWrite: opacity === 1,
});
function add(group, name, geometry, material, position) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(position);
  group.add(mesh);
  return mesh;
}
function at(p, lateral = 0, height = 0, forward = 0) {
  return p.pos.clone().addScaledVector(p.right, lateral)
    .addScaledVector(p.dir, forward).add(V(0, height, 0));
}
function beam(group, name, start, end, radius, material) {
  const delta = end.clone().sub(start);
  const mesh = add(group, name, new THREE.CylinderGeometry(radius * 0.8, radius, delta.length(), 7),
    material, start.clone().add(end).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(UP, delta.normalize());
  return mesh;
}

// Clearance is measured in XZ against the WHOLE circuit, including the chute.
// This also keeps scenery out of the narrow infield between two nearby legs.
export function verdantClearance(track, pos) {
  let min = Infinity;
  for (const route of [track.samples, track.shortcut?.samples || []]) {
    for (const p of route) {
      const d = Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z) - p.width / 2;
      if (d < min) min = d;
    }
  }
  return min;
}
function safe(track, pos, radius) { return verdantClearance(track, pos) > radius + 4; }

// One draw call per repeated shape, with colour variation per instance.
function batcher(root) {
  const batches = new Map(), dummy = new THREE.Object3D();
  return {
    put(name, geometry, material, pos, scale, angle = 0, tint = null) {
      if (!batches.has(name)) batches.set(name, { geometry, material, entries: [] });
      dummy.position.copy(pos);
      dummy.rotation.set(0, angle, 0);
      dummy.scale.set(...scale);
      dummy.updateMatrix();
      batches.get(name).entries.push({ matrix: dummy.matrix.clone(), tint });
    },
    flush() {
      for (const [name, { geometry, material, entries }] of batches) {
        if (!entries.length) continue;
        const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
        mesh.name = name;
        entries.forEach((entry, i) => {
          mesh.setMatrixAt(i, entry.matrix);
          if (entry.tint !== null) mesh.setColorAt(i, new THREE.Color(entry.tint));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        if (name === 'Boardwalk plank seams') mesh.userData.driveSurface = true;
        root.add(mesh);
      }
    },
  };
}

function woods(root, track, rnd, b, floor) {
  const bark = wood(0xffffff), leaf = wood(0xffffff, { side: THREE.DoubleSide });
  const trunk = new THREE.CylinderGeometry(0.65, 1, 1, 7);
  const branch = new THREE.ConeGeometry(1, 1, 7);
  const crown = new THREE.IcosahedronGeometry(1, 0);
  const shrub = new THREE.DodecahedronGeometry(1, 0);
  const frond = new THREE.ConeGeometry(1, 1, 5);
  const petal = new THREE.IcosahedronGeometry(1, 0);
  const mushroom = new THREE.ConeGeometry(1, 1, 7);
  const stump = new THREE.CylinderGeometry(1, 1.25, 1, 6);
  const pebble = new THREE.DodecahedronGeometry(1, 0);
  const flowerMat = lit(0xffffff), stemMat = wood(0xe8e1ca), stoneMat = wood(0xffffff);
  const leaves = [0x315f45, 0x3e7954, 0x5a9863, 0x7aac71, 0x43836d];
  const under = [0x386b4b, 0x509260, 0x5d9d6a, 0x2c7258];
  const blooms = [0xf1d77e, 0xffe6a4, 0xf4afa1, 0xb9d9b3];
  const mushroomCaps = [0xeac589, 0xe8a98c, 0xd3ddb3];

  // Tall mixed woodland behind the roadside planting, with gaps for the
  // landmark tree, pond and shortcut. Trees have trunks, forked branches and
  // three staggered crowns rather than a uniform cone silhouette.
  for (let i = 0; i < 390; i++) {
    const p = track.pointAt(rnd() * track.L);
    const side = rnd() < 0.5 ? -1 : 1;
    const v = at(p, side * (p.width / 2 + 12 + rnd() * 115));
    if (!safe(track, v, 6)) continue;
    const h = 11 + rnd() * 12, r = 4 + rnd() * 4.5;
    b.put('Lanternwood trunks', trunk, bark, V(v.x, floor + h * 0.48, v.z),
      [1.2 + rnd() * 0.55, h * .96, 1.2 + rnd() * .55], rnd() * 6.28, i % 3 ? 0x765c44 : 0x967656);
    for (const s of [-1, 1]) {
      b.put('Lanternwood forks', branch, bark,
        V(v.x + s * r * .35, floor + h * .76, v.z + s * .5), [0.56, h * .65, .56],
        s * .4, 0x806248);
    }
    for (let j = 0; j < 3; j++) {
      b.put('Layered woodland canopy', crown, leaf,
        V(v.x + (j - 1) * r * .44, floor + h + (j % 2) * 1.2, v.z + (j - 1) * r * .25),
        [r * (j === 1 ? 1.05 : .78), r * (.67 + j * .08), r * .85],
        rnd() * 6.28, leaves[(i + j) % leaves.length]);
    }
  }
  // Dense but low understorey gives the forest floor a silhouette at road
  // level. Everything is deliberately too far away to become an obstacle.
  for (let i = 0; i < 490; i++) {
    const p = track.pointAt(rnd() * track.L);
    const v = at(p, (rnd() < .5 ? -1 : 1) * (p.width / 2 + 5 + rnd() * 47));
    if (!safe(track, v, 1.6)) continue;
    const r = .7 + rnd() * 1.65;
    b.put('Moss and bracken clumps', shrub, leaf, V(v.x, floor + r * .35, v.z),
      [r * 1.35, r * .6, r], rnd() * 6.28, under[i % under.length]);
    b.put('Fern fronds', frond, leaf, V(v.x + r * .35, floor + .5 + r * .25, v.z),
      [r * .6, 1.2 + rnd() * .8, r * .65], rnd() * 6.28, leaves[(i + 1) % leaves.length]);
  }
  for (let i = 0; i < 320; i++) {
    const p = track.pointAt(rnd() * track.L);
    const v = at(p, (rnd() < .5 ? -1 : 1) * (p.width / 2 + 5 + rnd() * 32));
    if (!safe(track, v, 1)) continue;
    b.put('Sunlit wildflowers', petal, flowerMat, V(v.x, floor + .44, v.z),
      [.22 + rnd() * .12, .32, .22], rnd() * 6.28, blooms[i % blooms.length]);
    if (i % 4 === 0) {
      b.put('Forest toadstool stems', stump, stemMat, V(v.x + .5, floor + .2, v.z), [.15, .42, .15]);
      b.put('Forest toadstool caps', mushroom, leaf, V(v.x + .5, floor + .48, v.z),
        [.45, .35, .45], rnd() * 6.28, mushroomCaps[i % 3]);
    }
  }
  for (let i = 0; i < 145; i++) {
    const p = track.pointAt(rnd() * track.L);
    const v = at(p, (rnd() < .5 ? -1 : 1) * (p.width / 2 + 6 + rnd() * 34));
    if (!safe(track, v, 1.5)) continue;
    const r = .5 + rnd() * 1.5;
    b.put('Creekside fieldstones', pebble, stoneMat,
      V(v.x, floor + r * .24, v.z), [r * 1.3, r * .55, r], rnd() * 6.28,
      i % 3 === 0 ? 0x718978 : 0x8c9881);
  }

  // A staggered ridge of leaf-covered hills closes the horizon behind the
  // treeline; the flat ground disc is no longer an obvious cutoff.
  const ridge = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 44; i++) {
    const a = 2 * Math.PI * i / 44 + rnd() * .05;
    const r = 415 + rnd() * 130, h = 22 + rnd() * 35;
    b.put('Distant forested ridge', ridge, leaf,
      V(Math.cos(a) * r, floor + h * .18, Math.sin(a) * r),
      [55 + rnd() * 55, h, 48 + rnd() * 42], a, 0x4d8065);
  }
}

function carvedTree(root, track, state, colliders, rnd, floor) {
  const p = track.pointAt(track.L * .018);
  const base = at(p, -(p.width / 2 + 32));
  // A recognizable silhouette from the grid AND from the far side of the
  // loop. No part of the trunk is inside the racing/shortcut corridor.
  const heart = new THREE.Group();
  heart.name = 'The Lanternwood heart tree';
  heart.position.set(base.x, floor, base.z);
  root.add(heart);
  const dark = wood(0x584936), bark = wood(0x876b4b), gold = lit(0xf5d788, .86);
  const foliage = [0x376c52, 0x519169, 0x75ad75].map(c => wood(c));
  const trunk = add(heart, 'Heart tree twisted trunk', new THREE.CylinderGeometry(2.7, 4.8, 27, 11, 4),
    dark, V(0, 13.5, 0));
  trunk.rotation.z = -.045;
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    const end = V(Math.cos(a) * (8 + rnd() * 4), 30 + rnd() * 7, Math.sin(a) * (8 + rnd() * 3));
    beam(heart, 'Heart tree limbs', V(Math.cos(a) * 1.5, 21, Math.sin(a) * 1.5), end,
      1.05, i % 2 ? dark : bark);
    const leaf = add(heart, 'Heart tree layered crown', new THREE.IcosahedronGeometry(1, 1),
      foliage[i % foliage.length], end.clone().add(V(0, 2, 0)));
    leaf.scale.set(8 + rnd() * 3, 6 + rnd() * 2, 8 + rnd() * 3);
    const leafTop = add(heart, 'Heart tree sunlit bough', new THREE.IcosahedronGeometry(1, 0),
      foliage[(i + 1) % foliage.length], end.clone().add(V(0, 6, 0)));
    leafTop.scale.set(5.7, 3.8, 5.9);
  }
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    beam(heart, 'Heart tree exposed roots', V(Math.sin(a) * 2.7, 1.7, Math.cos(a) * 2.7),
      V(Math.sin(a) * 8, .45, Math.cos(a) * 8), .55, bark);
  }
  // Inlaid concentric amber growth rings, not a generic conifer landmark.
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const ring = add(heart, 'Heart tree amber growth rings',
      new THREE.TorusGeometry(3.1 + i * .25, .12, 6, 32), gold.clone(), V(0, 9 + i * 2.9, 0));
    ring.rotation.x = Math.PI / 2;
    rings.push(ring);
  }
  const gems = [];
  for (let i = 0; i < 11; i++) {
    const a = i * 2.4, r = 5.2 + rnd() * 8;
    const lamp = add(heart, 'Heart tree hanging lanterns', new THREE.IcosahedronGeometry(.45, 0),
      lit(i % 3 ? 0xffdfa0 : 0xa5efd4), V(Math.cos(a) * r, 24 + rnd() * 5, Math.sin(a) * r));
    gems.push({ lamp, y: lamp.position.y, phase: a });
  }
  state.extras.push((dt, time) => {
    for (let i = 0; i < rings.length; i++) rings[i].material.opacity = .78 + .18 * Math.sin(time * 1.1 + i);
    for (const { lamp, y, phase } of gems) lamp.position.y = y + Math.sin(time * .8 + phase) * .25;
  });
  // Camera-only collider; the tree and its animals cannot physically stop a
  // racer (they are considerably farther out than the playable apron).
  colliders.push(new THREE.Box3().setFromCenterAndSize(
    V(base.x, floor + 14, base.z), V(10, 28, 10)));
  return heart;
}

function crossings(root, track, state, colliders, b, floor) {
  const dark = wood(0x3c4034), beamMat = wood(0x725b3c), copper = wood(0xc29c60);
  const moss = wood(0x458361), lantern = lit(0xf8d493);
  const postGeo = new THREE.CylinderGeometry(.45, .62, 1, 7);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const gem = new THREE.IcosahedronGeometry(1, 0);
  const plankGeo = new THREE.BoxGeometry(1, 1, 1);
  const pool = [];

  // Built-up boardwalk on the eastern rise / leaf tunnel. The top of every
  // fascia segment is BELOW the driving surface. Support columns are outside
  // the apron; they don't change the physical road width or act as barriers.
  const raised = track.samples.filter(p => p.pos.y - floor > CONFIG.recovery.elevatedRoadHeight);
  for (const side of [-1, 1]) {
    const verts = [], indices = [];
    for (let i = 0; i < raised.length; i++) {
      const p = raised[i], v = at(p, side * (p.width / 2 + CONFIG.recovery.deckOverhang));
      verts.push(v.x, v.y - .11, v.z, v.x, floor - .08, v.z);
      if (i) { const n = i * 2; indices.push(n - 2, n, n - 1, n - 1, n, n + 1); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(indices); geo.computeVertexNormals();
    const fascia = add(root, 'Raised boardwalk timber fascia', geo,
      wood(side > 0 ? 0x624f3a : 0x584634, { side: THREE.DoubleSide }), V(0, 0, 0));
    fascia.userData.support = true;
  }
  for (let s = track.L * .25; s < track.L * .62; s += 13) {
    const p = track.pointAt(s);
    if (p.pos.y - floor <= CONFIG.recovery.elevatedRoadHeight) continue;
    for (const side of [-1, 1]) {
      const x = side * (p.width / 2 + 3.7), h = p.pos.y - floor;
      b.put('Raised walkway timber buttresses', postGeo, beamMat,
        at(p, x, -h / 2), [1.1, h, 1.1]);
      b.put('Raised walkway copper bolt heads', gem, copper, at(p, x, -.35), [.24, .24, .24]);
    }
    // Flush seams: visible board grain, no physical bump on the road.
    b.put('Boardwalk plank seams', plankGeo, dark, at(p, 0, .046),
      [p.width - 2.9, .012, .12], yaw(p));
  }
  // The tunnel already exists in the track definition. Replace the bland
  // grey arches only here with an interwoven, warm-lit living colonnade.
  if (track.tunnelRange) {
    for (let s = track.tunnelRange[0]; s <= track.tunnelRange[1] + .01; s += 7) {
      const p = track.pointAt(s), span = p.width / 2 + 3.4;
      for (const side of [-1, 1]) {
        const base = at(p, side * span);
        const stem = add(root, 'Leaf-tunnel carved piers', new THREE.CylinderGeometry(.65, .9, 9.3, 7),
          beamMat, base.clone().add(V(0, 4.65, 0)));
        colliders.push(new THREE.Box3().setFromObject(stem));
        b.put('Leaf-tunnel moss crowns', gem, moss, base.clone().add(V(0, 9.4, 0)), [1.9, 1.4, 1.9]);
        b.put('Leaf-tunnel amber sconces', gem, lantern, base.clone().add(V(0, 5.9, 0)), [.55, .7, .55]);
      }
      const header = add(root, 'Leaf-tunnel timber lintels', new THREE.BoxGeometry(span * 2 + 1.6, 1.1, 1.2),
        dark, at(p, 0, 10.2));
      header.rotation.y = yaw(p);
      colliders.push(new THREE.Box3().setFromObject(header));
      const crown = add(root, 'Leaf-tunnel canopy', new THREE.IcosahedronGeometry(1, 0),
        moss, at(p, 0, 12.1));
      crown.scale.set(span * .8, 2.1, 2.6);
    }
  }

  // A signature woodland entry portal, readable from the opening straight.
  const p = track.pointAt(track.L * .064), w = p.width / 2 + 3.9;
  for (const side of [-1, 1]) {
    const v = at(p, side * w);
    const post = add(root, 'Lanternwood welcome gate posts',
      new THREE.CylinderGeometry(.65, 1.05, 9.4, 8), beamMat, v.clone().add(V(0, 4.7, 0)));
    colliders.push(new THREE.Box3().setFromObject(post));
    b.put('Welcome gate amber lanterns', gem, lantern, v.clone().add(V(0, 9.6, 0)), [.8, 1.05, .8]);
  }
  const cap = add(root, 'Lanternwood welcome gate beam', new THREE.BoxGeometry(w * 2 + 1.6, .85, 1.5),
    dark, at(p, 0, 9.25));
  cap.rotation.y = yaw(p);
  colliders.push(new THREE.Box3().setFromObject(cap));
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#20473a'; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#d8b870'; ctx.fillRect(0, 5, 512, 6); ctx.fillRect(0, 116, 512, 6);
  ctx.fillStyle = '#f9e7aa'; ctx.font = 'bold 48px Georgia, serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('VERDANT LOOP', 256, 56);
  ctx.fillStyle = '#adddb1'; ctx.font = 'bold 19px Georgia, serif';
  ctx.fillText('T H E   L A N T E R N W O O D', 256, 101);
  const sign = add(root, 'Lanternwood welcome sign', new THREE.PlaneGeometry(8, 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }),
    at(p, 0, 7.95));
  sign.rotation.y = yaw(p);

  // Low, repeated verge lights give speed cues through the bends. Only three
  // actual PointLights are used; the other glass cores are emissive meshes.
  for (let s = 12; s < track.L; s += 27) {
    const p = track.pointAt(s);
    for (const side of [-1, 1]) {
      const foot = at(p, side * (p.width / 2 + 4.7));
      if (!safe(track, foot, .9)) continue;
      b.put('Verge carved trail posts', postGeo, dark,
        foot.clone().add(V(0, 1.05, 0)), [.5, 2.1, .5]);
      b.put('Verge copper collars', box, copper,
        foot.clone().add(V(0, 2.05, 0)), [.78, .18, .78], yaw(p));
      b.put('Verge honeyglass lanterns', gem, lantern,
        foot.clone().add(V(0, 2.47, 0)), [.48, .52, .48]);
    }
  }
  for (const f of [.055, .575, .87]) {
    const p = track.pointAt(track.L * f), light = new THREE.PointLight(0xffdf9e, .65, 27, 2);
    light.position.copy(at(p, p.width / 2 + 3.3, 6));
    root.add(light);
    pool.push({ light, phase: f * 21 });
  }
  state.extras.push((dt, time) => {
    for (const { light, phase } of pool) light.intensity = .57 + .1 * Math.sin(time * 1.3 + phase);
  });
}

function lightAndAir(root, track, state, rnd) {
  const shafts = new THREE.MeshBasicMaterial({
    color: 0xfff1b4, transparent: true, opacity: .055,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const f of [.11, .18, .32, .4, .52, .58, .76, .88]) {
    const p = track.pointAt(f * track.L);
    const shaft = add(root, 'Canopy-filtered sunlight', new THREE.PlaneGeometry(5.5, 27),
      shafts, at(p, (rnd() - .5) * p.width, 15));
    shaft.rotation.y = yaw(p) + .3; shaft.rotation.z = .37;
  }
  const n = 115, pos = new Float32Array(n * 3), origin = [];
  for (let i = 0; i < n; i++) {
    const p = track.pointAt(rnd() * track.L), side = rnd() < .5 ? -1 : 1;
    const v = at(p, side * (p.width / 2 + 8 + rnd() * 28), 1 + rnd() * 9);
    origin.push({ x: v.x, y: v.y, z: v.z, phase: rnd() * 6.28 });
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const fireflies = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xf9eaa9, size: .75, sizeAttenuation: true,
    transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  fireflies.name = 'Lanternwood floating fireflies'; root.add(fireflies);
  state.extras.push((dt, time) => {
    for (let i = 0; i < n; i++) {
      const v = origin[i], phase = v.phase + time * .52;
      pos[i * 3] = v.x + Math.sin(phase) * 1.2;
      pos[i * 3 + 1] = v.y + Math.sin(phase * 1.4) * .7;
      pos[i * 3 + 2] = v.z + Math.cos(phase * .8) * 1.2;
    }
    g.attributes.position.needsUpdate = true;
    fireflies.material.opacity = .58 + .18 * Math.sin(time * .9);
  });
}

function riverPond(root, track, rnd, b, floor) {
  const p = track.pointAt(track.L * .858);
  const center = at(p, p.width / 2 + 39);
  center.y = floor;
  const mud = wood(0x746f50), water = wood(0x367e86, {
    roughness: .22, metalness: .2, transparent: true, opacity: .91,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const reedMat = wood(0x60885a), cattailMat = wood(0x9b7147),
    bloomMat = wood(0xf7e0b8);
  const lily = new THREE.CircleGeometry(.9, 10);
  lily.rotateX(-Math.PI / 2);
  const bank = add(root, 'Lanternwood lily pond bank', new THREE.CircleGeometry(19, 36), mud,
    center.clone().add(V(0, .03, 0)));
  bank.rotation.x = -Math.PI / 2;
  const pond = add(root, 'Lanternwood lily pond', new THREE.CircleGeometry(16.2, 36), water,
    center.clone().add(V(0, .08, 0)));
  pond.rotation.x = -Math.PI / 2;
  const leaf = wood(0x80ad67, { side: THREE.DoubleSide });
  const bulb = new THREE.SphereGeometry(.28, 6, 5);
  for (let i = 0; i < 22; i++) {
    const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 14.4;
    const v = V(center.x + Math.cos(a) * r, floor + .12, center.z + Math.sin(a) * r);
    b.put('Pond lily pads', lily, leaf, v, [.8 + rnd() * .5, .8 + rnd() * .5, 1], a);
    if (i % 4 === 0) b.put('Pond water lilies', bulb, bloomMat, v.clone().add(V(0, .16, 0)), [1, .5, 1]);
  }
  const reeds = new THREE.ConeGeometry(.11, 1, 5), cattail = new THREE.CapsuleGeometry(.15, .55, 3, 5);
  for (let i = 0; i < 85; i++) {
    const a = i * 2.3999, r = 16.3 + rnd() * 3.6, h = 1.3 + rnd() * 2;
    const v = V(center.x + Math.cos(a) * r, floor + h / 2, center.z + Math.sin(a) * r);
    b.put('Pond wind-swept reeds', reeds, reedMat, v, [1, h, 1]);
    if (i % 3 === 0) b.put('Pond amber cattails', cattail, cattailMat,
      v.clone().add(V(0, h / 2 + .2, 0)), [1, 1, 1]);
  }
  // A shallow stream leads towards the road without becoming a shortcut or
  // an invisible driving surface. It stops short of the actual apron.
  const strip = [], ix = [], width = [5, 4, 3.3, 2.6, 2.1, 1.5];
  for (let i = 0; i < 6; i++) {
    const dist = p.width / 2 + 31 - i * 4;
    const v = at(p, dist, floor + .12 - p.pos.y, (i - 3) * 2.4);
    const wobble = Math.sin(i * 1.8) * 2;
    const a = v.clone().addScaledVector(p.dir, -width[i] + wobble);
    const c = v.clone().addScaledVector(p.dir, width[i] + wobble);
    strip.push(a.x, a.y, a.z, c.x, c.y, c.z);
    if (i) { const n = i * 2; ix.push(n - 2, n, n - 1, n - 1, n, n + 1); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(strip, 3));
  geo.setIndex(ix); geo.computeVertexNormals();
  add(root, 'Pond outflow stream', geo, water, V(0, 0, 0));
  return center;
}

// A shallow elliptical wash across the return straight. Its subdivided mesh
// follows the EXACT TrackManager surface (even at a change in road grade).
// The same ellipse/shoreline function gates kart drag, splashes and ripples.
function roadsidePuddle(root, track, state) {
  const p = track.pointAt(track.L * .895);
  const center = at(p, -1.2);
  const pool = {
    center, right: p.right.clone(), dir: p.dir.clone(),
    across: 6.6, along: 10.4,
  };
  // World-space, radially subdivided water surface. Sample the physical road
  // per vertex so it never floats through the tarmac on a slope.
  function surfaceMesh(extra, lift, material, name) {
    const sides = 48, rings = 6, vertices = [], indices = [];
    const hint = { main: -1, sc: -1 };
    for (let ring = 0; ring <= rings; ring++) {
      for (let i = 0; i < sides; i++) {
        const a = i / sides * Math.PI * 2, r = ring / rings * extra * shorelineRadius(a);
        const v = center.clone().addScaledVector(p.right, Math.cos(a) * pool.across * r)
          .addScaledVector(p.dir, Math.sin(a) * pool.along * r);
        v.y = track.surface(v, hint).y + lift;
        vertices.push(v.x, v.y, v.z);
        if (ring) {
          const cur = ring * sides + i, next = ring * sides + (i + 1) % sides;
          const last = (ring - 1) * sides + i, lastNext = (ring - 1) * sides + (i + 1) % sides;
          indices.push(last, lastNext, cur, lastNext, next, cur);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    g.setIndex(indices); g.computeVertexNormals();
    const mesh = add(root, name, g, material, V(0, 0, 0));
    mesh.userData.driveSurface = true;
    return mesh;
  }
  const wet = surfaceMesh(1.12, .041,
    new THREE.MeshBasicMaterial({ color: 0x163c3e, transparent: true, opacity: .41,
      depthWrite: false, side: THREE.DoubleSide }), 'Puddle dark wet asphalt');
  const water = surfaceMesh(1, .073,
    wood(0x4a9b9a, { roughness: .16, metalness: .34, transparent: true,
      opacity: .87, depthWrite: false, side: THREE.DoubleSide }), 'Verdant reactive puddle');
  const sheen = surfaceMesh(.82, .087,
    new THREE.MeshBasicMaterial({ color: 0xc4efe0, transparent: true, opacity: .10,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    'Puddle canopy reflection');
  // Broken silver-green shoreline, sampled against the same irregular bank.
  // Gaps avoid the hard, perfect-circle silhouette of a painted road decal.
  const edge = [], edgeIndex = [], edgeHint = { main: -1, sc: -1 }, sides = 64;
  for (let i = 0; i <= sides; i++) {
    const a = i / sides * 2 * Math.PI;
    for (const radius of [.97, 1.01]) {
      const r = radius * shorelineRadius(a);
      const v = center.clone().addScaledVector(p.right, Math.cos(a) * pool.across * r)
        .addScaledVector(p.dir, Math.sin(a) * pool.along * r);
      v.y = track.surface(v, edgeHint).y + .103;
      edge.push(v.x, v.y, v.z);
    }
    if (i && i % 9 < 6) {
      const n = i * 2;
      edgeIndex.push(n - 2, n, n - 1, n - 1, n, n + 1);
    }
  }
  const bankGeo = new THREE.BufferGeometry();
  bankGeo.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
  bankGeo.setIndex(edgeIndex); bankGeo.computeVertexNormals();
  const bankLight = add(root, 'Puddle broken silver shoreline', bankGeo,
    new THREE.MeshBasicMaterial({ color: 0xc1e4d5, transparent: true, opacity: .34,
      depthWrite: false, side: THREE.DoubleSide }), V(0, 0, 0));
  bankLight.userData.driveSurface = true;

  // Slender reflections of sun and canopy on the water, in one draw call.
  const reflection = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xe4f3d2, transparent: true, opacity: .20,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 34);
  reflection.name = 'Puddle reflected glints'; reflection.userData.driveSurface = true;
  reflection.renderOrder = 3;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < reflection.count; i++) {
    const a = i * 2.39996, r = Math.sqrt((i + .5) / reflection.count) * .86;
    const v = center.clone().addScaledVector(p.right, Math.cos(a) * pool.across * r)
      .addScaledVector(p.dir, Math.sin(a) * pool.along * r);
    v.y = track.surface(v, { main: -1, sc: -1 }).y + .115;
    dummy.position.copy(v); dummy.rotation.set(-Math.PI / 2, 0, yaw(p));
    dummy.scale.set(.12 + (i % 4) * .06, .8 + (i % 5) * .35, 1);
    dummy.updateMatrix(); reflection.setMatrixAt(i, dummy.matrix);
  }
  reflection.instanceMatrix.needsUpdate = true;
  root.add(reflection);
  wet.renderOrder = 1; water.renderOrder = 2; sheen.renderOrder = 3;
  bankLight.renderOrder = 3;
  // Shared geometry/material: rings are reused from a bounded pool. Each
  // ripple is clamped to the irregular shoreline before it fades away.
  const ringGeo = new THREE.RingGeometry(.92, 1, 32);
  const rings = [];
  const maxRings = 28;
  for (let i = 0; i < maxRings; i++) {
    const ring = add(root, 'Water displacement ring', ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xcce9dc, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false }), V(0, -100, 0));
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 4;
    ring.visible = false;
    rings.push({ mesh: ring, age: Infinity, limit: 0 });
  }
  const info = { ...pool, radius: pool.along, mesh: water, ripples: rings,
    stepped: true, surface: pool };
  state.puddles = [info];
  track.waterSurfaces = [pool];
  let cursor = 0;
  state.spawnPuddleRipple = (pos, speed = 12) => {
    const footprint = waterFootprint(pool, pos);
    if (footprint >= .94) return;
    const ripple = rings[cursor++ % rings.length];
    const surf = track.surface(V(pos.x, center.y, pos.z), { main: -1, sc: -1 });
    const remaining = Math.max(.3, (1 - footprint) * Math.min(pool.across, pool.along) * .85);
    ripple.mesh.position.set(pos.x, surf.y + .11, pos.z);
    ripple.mesh.scale.setScalar(.22);
    ripple.age = 0;
    ripple.limit = Math.min(remaining, 3.2 + Math.min(1, speed / 25) * 1.4);
    ripple.mesh.material.opacity = .38;
    ripple.mesh.visible = true;
  };
  state.extras.push((dt, time) => {
    water.material.emissive.setHex(0x173e38);
    water.material.emissiveIntensity = .18 + .04 * Math.sin(time * 1.4);
    sheen.material.opacity = .075 + .035 * Math.sin(time * 1.1);
    reflection.material.opacity = .17 + .06 * Math.sin(time * 1.45);
    for (const ripple of rings) {
      if (!ripple.mesh.visible) continue;
      ripple.age += dt;
      const radius = Math.min(ripple.limit, .22 + ripple.age * (3.1 + Math.min(1, ripple.limit / 4)));
      ripple.mesh.scale.setScalar(radius);
      ripple.mesh.material.opacity = .36 * Math.max(0, 1 - radius / ripple.limit);
      if (ripple.age > 1.25 || radius >= ripple.limit) ripple.mesh.visible = false;
    }
  });
  return pool;
}

function wildlife(root, track, state, rnd, pond, floor) {
  state.animals = [];
  const fur = wood(0xa98052), pale = wood(0xf3e4bb), dark = wood(0x584635);
  const feather = wood(0xd9e6d5), beak = wood(0xd7a56b);
  const sphere = new THREE.IcosahedronGeometry(1, 0);
  const legGeo = new THREE.CylinderGeometry(.11, .15, 1, 6);
  const antlerGeo = new THREE.CylinderGeometry(.06, .1, 1, 5);
  const herd = [];
  // 20+ metres beyond the outer curb: visible from the kart but far outside
  // the drivable width, even allowing for the whole animal and its antlers.
  for (const [f, side, extra] of [[.105, -1, 22], [.39, 1, 24], [.755, 1, 23]]) {
    const p = track.pointAt(track.L * f);
    const anchor = at(p, side * (p.width / 2 + extra));
    anchor.y = floor;
    if (!safe(track, anchor, 4)) continue;
    const animal = new THREE.Group(); animal.name = 'Lanternwood grazing deer';
    animal.position.copy(anchor);
    animal.rotation.y = yaw(p) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    root.add(animal);
    const body = add(animal, 'Deer torso', sphere, fur, V(0, 1.55, 0));
    body.scale.set(.53, .58, 1.1);
    const chest = add(animal, 'Deer chest', sphere, pale, V(0, 1.57, .6));
    chest.scale.set(.43, .46, .48);
    const head = new THREE.Group(); head.position.set(0, 1.85, .88); animal.add(head);
    const neck = add(head, 'Deer neck', sphere, fur, V(0, .2, .13)); neck.scale.set(.32, .65, .35);
    const face = add(head, 'Deer face', sphere, fur, V(0, .72, .43)); face.scale.set(.38, .33, .51);
    const muzzle = add(head, 'Deer pale muzzle', sphere, pale, V(0, .61, .83)); muzzle.scale.set(.25, .2, .26);
    for (const s of [-1, 1]) {
      const ear = add(head, 'Deer alert ears', sphere, pale, V(s * .45, .98, .25));
      ear.scale.set(.26, .14, .38); ear.rotation.z = s * .28;
      const eye = add(head, 'Deer dark eyes', new THREE.SphereGeometry(.08, 6, 5), dark,
        V(s * .32, .78, .7)); eye.scale.setScalar(1);
      for (const [a, c] of [
        [V(s * .16, .98, .15), V(s * .36, 1.8, .07)],
        [V(s * .3, 1.45, .1), V(s * .63, 1.59, .33)],
      ]) beam(head, 'Deer branching antlers', a, c, .08, dark);
    }
    const legs = [];
    for (const x of [-.33, .33]) for (const z of [-.65, .7]) {
      const leg = new THREE.Group(); leg.position.set(x, 1.24, z); animal.add(leg);
      const shank = add(leg, 'Deer slender legs', legGeo, dark, V(0, -.55, 0));
      shank.scale.set(1, 1.05, 1);
      legs.push(leg);
    }
    const tail = add(animal, 'Deer tail', sphere, pale, V(0, 1.62, -1.11));
    tail.scale.set(.24, .22, .39);
    state.animals.push({ mesh: animal, anchor: anchor.clone(), radius: 3.1, kind: 'deer' });
    herd.push({ animal, head, legs, phase: f * 17 });
  }
  const birds = [];
  for (const [i, a] of [0, 1, 2].entries()) {
    const anchor = pond.clone().add(V(Math.cos(a * 2.3) * (22 + i * 2), 0, Math.sin(a * 2.3) * 23));
    if (!safe(track, anchor, 4)) continue;
    const bird = new THREE.Group(); bird.name = 'Lanternwood pond heron';
    bird.position.copy(anchor); bird.rotation.y = a * 2.3 + 1.5; root.add(bird);
    const body = add(bird, 'Heron plumage', sphere, feather, V(0, 1.7, 0)); body.scale.set(.38, .48, .62);
    beam(bird, 'Heron curved neck', V(0, 1.7, .25), V(0, 2.65, .52), .11, feather);
    const head = new THREE.Group(); head.position.set(0, 2.65, .5); bird.add(head);
    const crown = add(head, 'Heron head', sphere, feather, V(0, .08, 0)); crown.scale.set(.25, .25, .28);
    const bill = add(head, 'Heron copper bill', new THREE.ConeGeometry(.15, .55, 5), beak, V(0, -.04, .38));
    bill.rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) {
      beam(bird, 'Heron stilt legs', V(s * .16, 1.4, 0), V(s * .22, .12, .15), .055, dark);
      const wing = add(bird, 'Heron folded wings', sphere, feather, V(s * .24, 1.76, -.08));
      wing.scale.set(.22, .36, .52);
    }
    state.animals.push({ mesh: bird, anchor: anchor.clone(), radius: 2, kind: 'heron' });
    birds.push({ bird, head, phase: i * 1.9 });
  }
  state.extras.push((dt, time) => {
    for (const { animal, head, legs, phase } of herd) {
      head.rotation.x = .08 + Math.sin(time * .65 + phase) * .16;
      animal.scale.y = 1 + Math.sin(time * 1.2 + phase) * .012;
      for (let i = 0; i < legs.length; i++) legs[i].rotation.x = Math.sin(time * .5 + phase + i * 2) * .04;
    }
    for (const { bird, head, phase } of birds) {
      head.rotation.y = Math.sin(time * .55 + phase) * .34;
      bird.scale.y = 1 + Math.sin(time * 1.1 + phase) * .015;
    }
  });
}

export function buildVerdantEnvironment(group, track, rnd, state, colliders) {
  const root = new THREE.Group(); root.name = 'Verdant Loop Lanternwood scenery';
  group.add(root);
  const floor = Math.min(...track.samples.map(p => p.pos.y)) - VERDANT_KIT.groundDepth;
  const b = batcher(root);
  woods(root, track, rnd, b, floor);
  carvedTree(root, track, state, colliders, rnd, floor);
  crossings(root, track, state, colliders, b, floor);
  const pond = riverPond(root, track, rnd, b, floor);
  roadsidePuddle(root, track, state);
  wildlife(root, track, state, rnd, pond, floor);
  lightAndAir(root, track, state, rnd);
  b.flush();
}
