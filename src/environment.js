// ============================================================================
// Environment builder for "Sunforge Circuit": desert canyon, sandstone
// cliffs, ancient gear monuments, bridge, tunnel, ramps, boost pads,
// moving obstacles and the start banner. Everything is original low-poly
// stylized geometry - no external assets.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { CONFIG } from './config.js';

const SANDSTONES = [0xc9834e, 0xb97a45, 0xd99a5b, 0xa86f3e, 0xd18c50];
const pick = (arr, i) => arr[i % arr.length];

function yawFor(dir) { return Math.atan2(dir.x, dir.z); }

export function buildEnvironment(scene, track) {
  const group = new THREE.Group();
  const colliders = [];
  const state = { gearMesh: null, sliderMesh: null, padMaterials: [], gearMonuments: [] };

  scene.add(group);

  // ------------------------------------------------------------------ sky
  scene.fog = new THREE.Fog(0xf2bd7d, 160, 640);
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 256;
  const sg = skyCanvas.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#4da3e8');
  grad.addColorStop(0.45, '#9fd0ef');
  grad.addColorStop(0.72, '#ffd9a3');
  grad.addColorStop(1, '#ffbe78');
  sg.fillStyle = grad; sg.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(820, 20, 14),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
  );
  group.add(sky);

  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(46, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false })
  );
  sun.position.set(330, 260, -520);
  sun.lookAt(0, 0, 0);
  group.add(sun);

  // lights
  scene.add(new THREE.HemisphereLight(0xffe0b0, 0xb06a3a, 0.95));
  const dirLight = new THREE.DirectionalLight(0xfff0d0, 1.25);
  dirLight.position.set(140, 200, -90);
  scene.add(dirLight);
  scene.add(new THREE.AmbientLight(0xffd9b0, 0.22));

  // clouds
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xfff6e6, fog: false, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 7; i++) {
    const cl = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), cloudMat);
    const a = (i / 7) * Math.PI * 2;
    cl.position.set(Math.cos(a) * (280 + i * 40), 130 + (i % 3) * 26, Math.sin(a) * (280 + i * 40));
    cl.scale.set(34 + i * 6, 9 + (i % 2) * 4, 16 + i * 3);
    group.add(cl);
  }

  // ---------------------------------------------------------------- ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(780, 56),
    new THREE.MeshStandardMaterial({ color: 0xe3b26e, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  group.add(ground);

  // canyon floor under the bridge (darker basin)
  const basin = new THREE.Mesh(
    new THREE.CircleGeometry(120, 24),
    new THREE.MeshStandardMaterial({ color: 0xc79455, roughness: 1 })
  );
  basin.rotation.x = -Math.PI / 2;
  basin.position.set(128, 0.02, 220);
  group.add(basin);

  // ------------------------------------------------------------------ road
  const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });

  function ribbon(samples, offsetA, offsetB, colorFn, closed, yOff = 0.02) {
    const n = samples.length;
    const count = closed ? n + 1 : n;
    const posArr = new Float32Array(count * 6);
    const colArr = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const sm = samples[i % n];
      const a = sm.pos.x + sm.right.x * offsetA(sm);
      const az = sm.pos.z + sm.right.z * offsetA(sm);
      const b = sm.pos.x + sm.right.x * offsetB(sm);
      const bz = sm.pos.z + sm.right.z * offsetB(sm);
      const y = sm.pos.y + yOff;
      posArr.set([a, y, az, b, y, bz], i * 6);
      const ca = colorFn(sm, i % n, 1), cb = colorFn(sm, i % n, -1);
      colArr.set([ca[0], ca[1], ca[2], cb[0], cb[1], cb[2]], i * 6);
    }
    const segs = closed ? n : n - 1;
    const idx = [];
    for (let i = 0; i < segs; i++) {
      const o = i * 2;
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, roadMat);
    group.add(mesh);
    return mesh;
  }

  const S = track.samples;
  const hw = (sm) => sm.width / 2;
  const noise = (i) => (((i * 7919) % 13) / 13 - 0.5) * 0.05;

  // center asphalt
  ribbon(S, (sm) => hw(sm) - 1.25, (sm) => -(hw(sm) - 1.25), (sm, i) => {
    const v = 0.58 + noise(i);
    return [v, v * 0.93, v * 0.82];
  }, true);
  // striped curbs
  for (const sideSign of [1, -1]) {
    ribbon(S,
      (sm) => sideSign * hw(sm),
      (sm) => sideSign * (hw(sm) - 1.25),
      (sm, i) => {
        const stripe = Math.floor(sm.s / 3.5) % 2 === 0;
        return stripe ? [0.87, 0.30, 0.24] : [0.96, 0.91, 0.80];
      }, true, 0.03);
  }
  // dashed center line
  ribbon(S, () => 0.22, () => -0.22, (sm) => {
    const on = Math.floor(sm.s / 5) % 2 === 0;
    return on ? [0.95, 0.92, 0.82] : [0.55, 0.5, 0.43];
  }, true, 0.035);

  // shortcut chute
  const sc = track.shortcut.samples;
  ribbon(sc, () => 3.6, () => -3.6, (sm, i) => {
    const v = 0.62 + noise(i + 3);
    return [v, v * 0.86, v * 0.62];
  }, false, 0.03);

  // ------------------------------------------------------------- finish line
  const fin = track.pointAt(0.2);
  const checker = document.createElement('canvas');
  checker.width = 128; checker.height = 32;
  const cg = checker.getContext('2d');
  for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
    cg.fillStyle = (x + y) % 2 ? '#1c1c1c' : '#f4f0e6';
    cg.fillRect(x * 8, y * 8, 8, 8);
  }
  const finMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(fin.width, 3),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(checker) })
  );
  finMesh.rotation.x = -Math.PI / 2;
  finMesh.rotation.z = yawFor(fin.dir);
  finMesh.position.copy(fin.pos).setY(fin.pos.y + 0.05);
  group.add(finMesh);

  // start banner
  const bannerAt = track.pointAt(0.2);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.8 });
  for (const side of [1, -1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 7.2, 8), poleMat);
    pole.position.copy(bannerAt.pos).addScaledVector(bannerAt.right, side * (bannerAt.width / 2 + 0.8));
    pole.position.y += 3.6;
    group.add(pole);
  }
  const bannerCanvas = document.createElement('canvas');
  bannerCanvas.width = 512; bannerCanvas.height = 96;
  const bg = bannerCanvas.getContext('2d');
  bg.fillStyle = '#e8632c'; bg.fillRect(0, 0, 512, 96);
  bg.fillStyle = '#ffd9a0'; bg.font = '900 56px "Trebuchet MS", sans-serif';
  bg.textAlign = 'center'; bg.textBaseline = 'middle';
  bg.fillText('SUNFORGE', 256, 50);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(bannerAt.width + 1.6, 2.2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bannerCanvas), side: THREE.DoubleSide })
  );
  banner.position.copy(bannerAt.pos).setY(bannerAt.pos.y + 6.4);
  banner.rotation.y = yawFor(bannerAt.dir);
  group.add(banner);

  // ------------------------------------------------------------------ ramps
  for (const r of track.ramps) {
    const p0 = track.pointAt(r.s0), p1 = track.pointAt(r.s1);
    const mk = (p, latOff, y) => {
      const v = p.pos.clone().addScaledVector(p.right, r.lat + latOff);
      v.y = y + 0.05;
      return v;
    };
    const a = mk(p0, -r.halfW, r.baseY), b = mk(p0, r.halfW, r.baseY);
    const c = mk(p1, r.halfW, r.baseY + r.rise), d = mk(p1, -r.halfW, r.baseY + r.rise);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z,
      a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z,
    ]), 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd8955a, roughness: 0.9 }));
    group.add(mesh);
    // lip stripe
    const lip = new THREE.Mesh(
      new THREE.PlaneGeometry(r.halfW * 2, 1.1),
      new THREE.MeshBasicMaterial({ color: 0xffe08a })
    );
    lip.rotation.x = -Math.PI / 2;
    lip.rotation.z = yawFor(p1.dir);
    lip.position.copy(p1.pos).addScaledVector(p1.right, r.lat);
    lip.position.y = r.baseY + r.rise + 0.07;
    group.add(lip);
  }

  // -------------------------------------------------------------- boost pads
  const padCanvas = document.createElement('canvas');
  padCanvas.width = 128; padCanvas.height = 64;
  const pg = padCanvas.getContext('2d');
  pg.fillStyle = '#0a5c66'; pg.fillRect(0, 0, 128, 64);
  pg.fillStyle = '#40f0e0';
  for (let i = 0; i < 3; i++) {
    const x = 18 + i * 36;
    pg.beginPath();
    pg.moveTo(x, 8); pg.lineTo(x + 22, 32); pg.lineTo(x, 56);
    pg.lineTo(x + 10, 32); pg.closePath(); pg.fill();
  }
  const padTex = new THREE.CanvasTexture(padCanvas);

  for (const pad of track.pads) {
    if (pad.shortcut) {
      const idx = Math.min(sc.length - 1, Math.floor(pad.scFrac * sc.length));
      const sm = sc[idx];
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(4.2, pad.halfW * 2),
        new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.95 })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.atan2(-sm.dir.z, sm.dir.x);
      mesh.position.copy(sm.pos); mesh.position.y += 0.06;
      group.add(mesh);
      state.padMaterials.push(mesh.material);
      continue;
    }
    const p = track.pointAt(pad.s);
    const mat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pad.len, pad.halfW * 2), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.atan2(-p.dir.z, p.dir.x);
    mesh.position.copy(p.pos).addScaledVector(p.right, pad.lat);
    mesh.position.y += 0.05;
    group.add(mesh);
    state.padMaterials.push(mat);
  }

  // ------------------------------------------------------------------ tunnel
  const archMat = new THREE.MeshStandardMaterial({ color: 0xb3763f, roughness: 0.95, flatShading: true });
  for (let s = track.tunnelRange[0]; s <= track.tunnelRange[1]; s += 6.5) {
    const p = track.pointAt(s);
    const yaw = yawFor(p.dir);
    for (const side of [1, -1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 7, 1.4), archMat);
      pillar.position.copy(p.pos).addScaledVector(p.right, side * (p.width / 2 + 1.1));
      pillar.position.y += 3.4;
      pillar.rotation.y = yaw;
      group.add(pillar);
      colliders.push(new THREE.Box3().setFromObject(pillar));
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(p.width + 4.4, 1.5, 1.9), archMat);
    beam.position.copy(p.pos);
    beam.position.y += 7.2;
    beam.rotation.y = yaw;
    group.add(beam);
    colliders.push(new THREE.Box3().setFromObject(beam));
  }

  // ------------------------------------------------------------------ bridge
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0xa86f3e, roughness: 0.95 });
  for (let s = track.bridgeRange[0]; s <= track.bridgeRange[1]; s += 12) {
    const p = track.pointAt(s);
    for (const side of [1, -1]) {
      const h = Math.max(2, p.pos.y);
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.8, h, 1.8), bridgeMat);
      pillar.position.copy(p.pos).addScaledVector(p.right, side * (p.width / 2 - 1.2));
      pillar.position.y = h / 2 - 0.4;
      group.add(pillar);
    }
  }
  // railings
  for (const side of [1, -1]) {
    for (let s = track.bridgeRange[0]; s < track.bridgeRange[1] - 1; s += 6) {
      const p = track.pointAt(s);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 6.4), bridgeMat);
      rail.position.copy(p.pos).addScaledVector(p.right, side * (p.width / 2 - 0.25));
      rail.position.y += 0.55;
      rail.rotation.y = yawFor(p.dir);
      group.add(rail);
    }
  }

  // ------------------------------------------------------------ canyon cliffs
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cliffMat = SANDSTONES.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
  for (let s = track.canyonRange[0]; s <= track.canyonRange[1]; s += 7) {
    const p = track.pointAt(s);
    for (const side of [1, -1]) {
      if (rnd() < 0.12) continue;
      const h = 8 + rnd() * 11;
      const cliff = new THREE.Mesh(
        new THREE.BoxGeometry(5 + rnd() * 5, h, 4 + rnd() * 4),
        pick(cliffMat, Math.floor(rnd() * 5))
      );
      cliff.position.copy(p.pos).addScaledVector(p.right, side * (p.width / 2 + 6 + rnd() * 5));
      cliff.position.y = p.pos.y + h / 2 - 2;
      cliff.rotation.y = rnd() * Math.PI;
      group.add(cliff);
    }
  }

  // scattered rocks everywhere (instanced)
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 130);
  const dummy = new THREE.Object3D();
  const rockCol = new THREE.Color();
  for (let i = 0; i < 130; i++) {
    const s = rnd() * track.L;
    const p = track.pointAt(s);
    const side = rnd() > 0.5 ? 1 : -1;
    const dist = p.width / 2 + 12 + rnd() * 42;
    dummy.position.copy(p.pos).addScaledVector(p.right, side * dist);
    dummy.position.y = p.pos.y - 0.4;
    const sc2 = 0.6 + rnd() * 2.6;
    dummy.scale.set(sc2, sc2 * (0.6 + rnd() * 0.8), sc2);
    dummy.rotation.set(rnd() * 0.4, rnd() * Math.PI * 2, rnd() * 0.4);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    rockCol.setHex(pick(SANDSTONES, Math.floor(rnd() * 5))).multiplyScalar(0.85 + rnd() * 0.3);
    rocks.setColorAt(i, rockCol);
  }
  rocks.instanceMatrix.needsUpdate = true;
  group.add(rocks);

  // cacti
  const cactusMat = new THREE.MeshStandardMaterial({ color: 0x3f9e5a, roughness: 0.9 });
  for (let i = 0; i < 22; i++) {
    const s = rnd() * track.L;
    const p = track.pointAt(s);
    const side = rnd() > 0.5 ? 1 : -1;
    const dist = p.width / 2 + 9 + rnd() * 26;
    const c = new THREE.Group();
    const h = 1.6 + rnd() * 1.6;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, h, 7), cactusMat);
    trunk.position.y = h / 2;
    c.add(trunk);
    if (rnd() > 0.35) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.9, 6), cactusMat);
      arm.position.set(0.45, h * 0.55, 0);
      arm.rotation.z = -0.9;
      c.add(arm);
    }
    c.position.copy(p.pos).addScaledVector(p.right, side * dist);
    group.add(c);
  }

  // ------------------------------------------------- ancient gear monuments
  function gearMonument(x, y, z, radius) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.6, metalness: 0.35 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1.1, 20), mat);
    disc.rotation.z = Math.PI / 2;
    g.add(disc);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 1.4), mat);
      tooth.position.set(0, Math.sin(a) * (radius + 0.6), Math.cos(a) * (radius + 0.6));
      tooth.rotation.x = -a;
      g.add(tooth);
    }
    g.position.set(x, y, z);
    group.add(g);
    state.gearMonuments.push(g);
    colliders.push(new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(x, y, z), new THREE.Vector3(3, radius * 2.4, radius * 2.4)));
  }
  gearMonument(322, 9, 20, 7);
  gearMonument(-348, 7, 150, 5.5);

  // ancient arch over the track at the end of the intro straight
  const archAt = track.pointAt(track.L * 0.2);
  const archMat2 = new THREE.MeshStandardMaterial({ color: 0x9c6b3c, roughness: 0.95, flatShading: true });
  for (const side of [1, -1]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 2), archMat2);
    col.position.copy(archAt.pos).addScaledVector(archAt.right, side * (archAt.width / 2 + 1.6));
    col.position.y += 4.8;
    group.add(col);
    colliders.push(new THREE.Box3().setFromObject(col));
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(archAt.width + 6, 2.4, 2.6), archMat2);
  top.position.copy(archAt.pos);
  top.position.y += 10.4;
  top.rotation.y = yawFor(archAt.dir);
  group.add(top);
  colliders.push(new THREE.Box3().setFromObject(top));

  // -------------------------------------------------------- moving obstacles
  // rotating gear arm in the canyon
  const gearG = new THREE.Group();
  const gearMatDark = new THREE.MeshStandardMaterial({ color: 0x7c5a2e, roughness: 0.55, metalness: 0.4 });
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 1.1, 14), gearMatDark);
  gearG.add(hub);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(track.gear.armRadius * 2, 0.55, 1.1), gearMatDark);
  arm.position.y = 0.45;
  gearG.add(arm);
  const tipA = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), gearMatDark);
  tipA.position.set(track.gear.armRadius, 0.45, 0);
  gearG.add(tipA);
  const tipB = tipA.clone();
  tipB.position.x = -track.gear.armRadius;
  gearG.add(tipB);
  gearG.position.copy(track.gear.center);
  gearG.position.y += 0.5;
  group.add(gearG);
  state.gearMesh = gearG;

  // sliding stone pillar on the north straight
  const sliderMesh = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 2.6, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x8f6238, roughness: 0.9, flatShading: true })
  );
  sliderMesh.position.copy(track.slider.pos);
  group.add(sliderMesh);
  state.sliderMesh = sliderMesh;

  // ----------------------------------------------------------- frame updates
  state.update = (dt, time) => {
    gearG.rotation.y = track.gear.angle;
    state.sliderMesh.position.set(track.slider.pos.x, track.slider.pos.y, track.slider.pos.z);
    for (let i = 0; i < state.gearMonuments.length; i++) {
      state.gearMonuments[i].rotation.x = time * (0.08 + i * 0.05);
    }
    const pulse = 0.75 + Math.sin(time * 6) * 0.25;
    for (const m of state.padMaterials) m.opacity = pulse;
  };

  return { group, colliders, state };
}
