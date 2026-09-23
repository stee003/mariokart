// ============================================================================
// Environment builder for "Sunforge Circuit" - the flagship desert canyon.
//
// 2026 rebuild: the circuit now reads as a hand-crafted world instead of a
// vertical slice:
//   * layered sky with a true sun disc + halo, drifting cloud banks, and a
//     ring of distant dunes that closes the horizon
//   * dune mounds, basalt boulders, cacti, agaves and dry scrub instanced
//     around the route
//   * layered road: sand shoulder, warm asphalt, striped curbs, solid edge
//     lines and a centre dash
//   * a carved start gate with a two-tone SUNFORGE banner
//   * mesa-cliff canyons (stacked strata), a proper trussed bridge over a
//     dry riverbed basin, and a sandstone tunnel with amber gear inlays
//   * three rotating gear monuments plus a giant half-buried landmark gear
//   * wind-blown sand particles and circling raptors
//
// Everything is original low-poly stylized geometry - no external assets.
// Exported shape is unchanged: { group, colliders, state } with
// state.update(dt, time) driving all animation.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { createRampVisual } from './terrainMesh.js';

const SANDSTONES = [0xc9834e, 0xb97a45, 0xd99a5b, 0xa86f3e, 0xd18c50];
const DUNES = [0xe0b070, 0xd8a868, 0xdcab78, 0xe6bc84, 0xcfa060];
const pick = (arr, i) => arr[i % arr.length];
const yawFor = (dir) => Math.atan2(dir.x, dir.z);

export function buildEnvironment(scene, track) {
  const group = new THREE.Group();
  const colliders = [];
  const state = { padMaterials: [], gearMonuments: [], extras: [], padGlow: [] };

  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pickMat = (arr, mats) => mats[Math.floor(rnd() * mats.length)];

  scene.add(group);

  // ------------------------------------------------------------------ sky
  scene.fog = new THREE.Fog(0xf2bd7d, 180, 760);
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 512;
  const sg = skyCanvas.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.00, '#3f8fd6');
  grad.addColorStop(0.38, '#8ec4ea');
  grad.addColorStop(0.62, '#d8e2c8');
  grad.addColorStop(0.80, '#ffd9a3');
  grad.addColorStop(1.00, '#ffbe78');
  sg.fillStyle = grad; sg.fillRect(0, 0, 4, 512);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(880, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
  );
  group.add(sky);

  // sun disc + additive halo, aligned with the key light
  const SUN_POS = new THREE.Vector3(330, 260, -520).normalize().multiplyScalar(820);
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(52, 28),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false })
  );
  sun.position.copy(SUN_POS);
  sun.lookAt(0, 0, 0);
  group.add(sun);
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(110, 28),
    new THREE.MeshBasicMaterial({ color: 0xffd990, fog: false, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  halo.position.copy(SUN_POS).multiplyScalar(0.999);
  halo.lookAt(0, 0, 0);
  group.add(halo);

  // lights
  scene.add(new THREE.HemisphereLight(0xffe0b0, 0xb06a3a, 0.95));
  const dirLight = new THREE.DirectionalLight(0xfff0d0, 1.3);
  dirLight.position.set(140, 200, -90);
  scene.add(dirLight);
  scene.add(new THREE.AmbientLight(0xffd9b0, 0.24));

  // drifting cloud banks
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xfff6e6, fog: false, transparent: true, opacity: 0.85 });
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const cl = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 5), cloudMat);
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.5;
    const r = 300 + rnd() * 260;
    cl.position.set(Math.cos(a) * r, 120 + rnd() * 60, Math.sin(a) * r);
    cl.scale.set(36 + rnd() * 40, 8 + rnd() * 8, 16 + rnd() * 14);
    group.add(cl);
    clouds.push({ mesh: cl, speed: 1.2 + rnd() * 1.6, a, r, y: cl.position.y, spin: 0.01 + rnd() * 0.02 });
  }
  state.extras.push((dt, time) => {
    for (const c of clouds) {
      c.a += dt * 0.004 * c.speed;
      c.mesh.position.set(Math.cos(c.a) * c.r, c.y + Math.sin(time * 0.1 + c.r) * 2, Math.sin(c.a) * c.r);
      c.mesh.rotation.y += dt * c.spin;
    }
  });

  // distant dune ring closing the horizon
  const duneMats = DUNES.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + rnd() * 0.2;
    const r = 640 + rnd() * 140;
    const rw = 90 + rnd() * 130;
    const h = 14 + rnd() * 26;
    const d = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 6), pickMat(DUNES, duneMats));
    d.position.set(Math.cos(a) * r, h * 0.35 - 1, Math.sin(a) * r);
    d.scale.set(rw, h, rw * 0.7);
    d.rotation.y = rnd() * Math.PI;
    group.add(d);
  }

  // ---------------------------------------------------------------- ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(860, 56),
    new THREE.MeshStandardMaterial({ color: 0xe3b26e, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  group.add(ground);

  // dune mounds scattered around the route (instanced)
  const duneGeo = new THREE.SphereGeometry(1, 8, 6);
  const duneBase = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const dunes2 = new THREE.InstancedMesh(duneGeo, duneBase, 42);
  const dummy = new THREE.Object3D();
  const tintColor = new THREE.Color();
  for (let i = 0; i < 42; i++) {
    const s = rnd() * track.L;
    const p = track.pointAt(s);
    const side = rnd() > 0.5 ? 1 : -1;
    const dist = p.width / 2 + 14 + rnd() * 55;
    const rw = 7 + rnd() * 16;
    const h = 2.5 + rnd() * 6;
    dummy.position.copy(p.pos).addScaledVector(p.right, side * dist);
    dummy.position.y = h * 0.35 - 0.6;
    dummy.scale.set(rw, h, rw * (0.6 + rnd() * 0.4));
    dummy.rotation.set(0, rnd() * Math.PI, 0);
    dummy.updateMatrix();
    dunes2.setMatrixAt(i, dummy.matrix);
    tintColor.setHex(pick(DUNES, Math.floor(rnd() * DUNES.length)));
    dunes2.setColorAt(i, tintColor);
  }
  dunes2.instanceMatrix.needsUpdate = true;
  group.add(dunes2);

  // scattered basalt boulders (instanced)
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 120);
  const rockCol = new THREE.Color();
  for (let i = 0; i < 120; i++) {
    const s = rnd() * track.L;
    const p = track.pointAt(s);
    const side = rnd() > 0.5 ? 1 : -1;
    const dist = p.width / 2 + 10 + rnd() * 40;
    dummy.position.copy(p.pos).addScaledVector(p.right, side * dist);
    dummy.position.y = p.pos.y - 0.4;
    const sc2 = 0.5 + rnd() * 2.4;
    dummy.scale.set(sc2, sc2 * (0.6 + rnd() * 0.8), sc2);
    dummy.rotation.set(rnd() * 0.4, rnd() * Math.PI * 2, rnd() * 0.4);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    rockCol.setHex(pick(SANDSTONES, Math.floor(rnd() * 5))).multiplyScalar(0.7 + rnd() * 0.35);
    rocks.setColorAt(i, rockCol);
  }
  rocks.instanceMatrix.needsUpdate = true;
  group.add(rocks);

  // ------------------------------------------------------------------ road
  const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const apronMat = new THREE.MeshStandardMaterial({ color: 0xd8a868, roughness: 1 });
  const lineMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  function ribbon(samples, offsetA, offsetB, colorFn, closed, mat, yOff = 0.02) {
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
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    return mesh;
  }

  const S = track.samples;
  const hw = (sm) => sm.width / 2;
  const noise = (i) => (((i * 7919) % 13) / 13 - 0.5) * 0.06;

  // sand shoulder aprons
  for (const sideSign of [1, -1]) {
    ribbon(S,
      (sm) => sideSign * (hw(sm) + 2.8),
      (sm) => sideSign * (hw(sm) - 1.25),
      (sm, i) => {
        const v = 0.86 + noise(i + 1);
        return [v, v * 0.78, v * 0.55];
      }, true, apronMat, 0.015);
  }
  // center asphalt (warm)
  ribbon(S, (sm) => hw(sm) - 1.25, (sm) => -(hw(sm) - 1.25), (sm, i) => {
    const v = 0.56 + noise(i);
    return [v, v * 0.94, v * 0.84];
  }, true, roadMat);
  // striped curbs
  for (const sideSign of [1, -1]) {
    ribbon(S,
      (sm) => sideSign * hw(sm),
      (sm) => sideSign * (hw(sm) - 1.25),
      (sm, i) => {
        const stripe = Math.floor(sm.s / 3.5) % 2 === 0;
        return stripe ? [0.87, 0.30, 0.24] : [0.96, 0.91, 0.80];
      }, true, roadMat, 0.03);
  }
  // solid edge lines just inside the curbs
  for (const sideSign of [1, -1]) {
    ribbon(S,
      (sm) => sideSign * (hw(sm) - 1.6),
      (sm) => sideSign * (hw(sm) - 1.3),
      () => [0.98, 0.95, 0.88], true, lineMat, 0.035);
  }
  // dashed center line
  ribbon(S, () => 0.22, () => -0.22, (sm) => {
    const on = Math.floor(sm.s / 5) % 2 === 0;
    return on ? [0.95, 0.92, 0.82] : [0.55, 0.5, 0.43];
  }, true, roadMat, 0.035);

  // shortcut chute
  const sc = track.shortcut.samples;
  ribbon(sc, () => track.shortcut.halfW, () => -track.shortcut.halfW, (sm, i) => {
    const v = 0.66 + noise(i + 3);
    return [v, v * 0.88, v * 0.62];
  }, false, roadMat, 0.03);
  ribbon(sc, () => 0.2, () => -0.2, (sm) => {
    const on = Math.floor(sm.s / 4) % 2 === 0;
    return on ? [0.98, 0.95, 0.88] : [0, 0, 0];
  }, false, lineMat, 0.04);

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

  // start gate: tapered pillars + lintel with a carved gear emblem
  const gateStone = new THREE.MeshStandardMaterial({ color: 0x9c6b3c, roughness: 0.95, flatShading: true });
  const gateStoneDark = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.95, flatShading: true });
  const gateAt = track.pointAt(0.2);
  const gateHalfW = gateAt.width / 2 + 1.8;
  for (const side of [1, -1]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.6, 3.4), gateStoneDark);
    base.position.copy(gateAt.pos).addScaledVector(gateAt.right, side * gateHalfW);
    base.position.y += 0.8;
    group.add(base);
    colliders.push(new THREE.Box3().setFromObject(base));
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 9.5, 8), gateStone);
    pillar.position.copy(gateAt.pos).addScaledVector(gateAt.right, side * gateHalfW);
    pillar.position.y += 6.2;
    group.add(pillar);
    colliders.push(new THREE.Box3().setFromObject(pillar));
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 2.6), gateStoneDark);
    cap.position.copy(pillar.position);
    cap.position.y += 5.1;
    group.add(cap);
    colliders.push(new THREE.Box3().setFromObject(cap));
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(gateHalfW * 2 + 2.6, 2.6, 2.8), gateStone);
  lintel.position.copy(gateAt.pos);
  lintel.position.y += 10.9;
  lintel.rotation.y = yawFor(gateAt.dir);
  group.add(lintel);
  colliders.push(new THREE.Box3().setFromObject(lintel));
  // carved gear emblem on the lintel
  const emblem = new THREE.Group();
  const embMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.7, metalness: 0.3 });
  const disc = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.22, 8, 18), embMat);
  emblem.add(disc);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.22), embMat);
    tooth.position.set(Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0);
    tooth.rotation.z = -a;
    emblem.add(tooth);
  }
  emblem.position.copy(gateAt.pos);
  emblem.position.y += 10.9;
  emblem.rotation.y = yawFor(gateAt.dir);
  group.add(emblem);

  // SUNFORGE banner
  const bannerCanvas = document.createElement('canvas');
  bannerCanvas.width = 1024; bannerCanvas.height = 128;
  const bg = bannerCanvas.getContext('2d');
  bg.fillStyle = '#c8452a'; bg.fillRect(0, 0, 1024, 128);
  bg.fillStyle = '#8f2f1c';
  for (let x = -40; x < 1060; x += 80) {
    bg.beginPath();
    bg.moveTo(x, 128); bg.lineTo(x + 40, 0); bg.lineTo(x + 64, 0); bg.lineTo(x + 24, 128);
    bg.closePath(); bg.fill();
  }
  bg.fillStyle = '#ffd9a0';
  bg.font = '900 84px "Trebuchet MS", sans-serif';
  bg.textAlign = 'center'; bg.textBaseline = 'middle';
  bg.shadowColor = 'rgba(60,20,0,0.8)'; bg.shadowBlur = 6; bg.shadowOffsetY = 4;
  bg.fillText('SUNFORGE', 512, 68);
  bg.shadowBlur = 0; bg.shadowOffsetY = 0;
  bg.fillStyle = '#fff2d0'; bg.font = '700 26px "Trebuchet MS", sans-serif';
  bg.fillText('C I R C U I T', 512, 112);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(gateAt.width + 1.2, 2.2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bannerCanvas), side: THREE.DoubleSide })
  );
  banner.position.copy(gateAt.pos).setY(gateAt.pos.y + 6.8);
  banner.rotation.y = yawFor(gateAt.dir);
  group.add(banner);

  // ------------------------------------------------------------------ ramps
  // The visible deck is sampled from the same profile as wheel collision and
  // launch physics; see TrackManager.rampSurfaceAt().
  for (const r of track.ramps) {
    group.add(createRampVisual(track, r, {
      surface: 0xd8955a,
      shoulder: 0xbe7845,
      side: 0x744126,
      stripe: 0xffe08a,
    }));
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
    let sm, isSc = false;
    if (pad.shortcut) {
      const idx = Math.min(sc.length - 1, Math.floor(pad.scFrac * sc.length));
      sm = sc[idx]; isSc = true;
    } else {
      sm = track.pointAt(pad.s);
    }
    const mat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(isSc ? 4.2 : pad.len, pad.halfW * 2), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.atan2(-sm.dir.z, sm.dir.x);
    mesh.position.copy(sm.pos).addScaledVector(sm.right, isSc ? 0 : pad.lat);
    mesh.position.y += 0.06;
    group.add(mesh);
    // soft glow underlay so pads read from a distance
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x40f0e0, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry((isSc ? 4.2 : pad.len) + 1.2, pad.halfW * 2 + 1), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.rotation.z = mesh.rotation.z;
    glow.position.copy(mesh.position);
    glow.position.y -= 0.01;
    group.add(glow);
    state.padMaterials.push(mat);
    state.padGlow.push(glowMat);
  }

  // ------------------------------------------------------------------ tunnel
  const archMat = new THREE.MeshStandardMaterial({ color: 0xb3763f, roughness: 0.95, flatShading: true });
  const archMat2 = new THREE.MeshStandardMaterial({ color: 0x9c6234, roughness: 0.95, flatShading: true });
  const inlayMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9 });
  if (track.tunnelRange) {
    for (let s = track.tunnelRange[0]; s <= track.tunnelRange[1]; s += 6.5) {
      const p = track.pointAt(s);
      const yaw = yawFor(p.dir);
      for (const side of [1, -1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 7, 1.5), archMat);
        pillar.position.copy(p.pos).addScaledVector(p.right, side * (p.width / 2 + 1.1));
        pillar.position.y += 3.4;
        pillar.rotation.y = yaw;
        group.add(pillar);
        colliders.push(new THREE.Box3().setFromObject(pillar));
        const step = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 2.2), archMat2);
        step.position.copy(pillar.position);
        step.position.y = -2.7;
        group.add(step);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(p.width + 4.4, 1.5, 1.9), archMat);
      beam.position.copy(p.pos);
      beam.position.y += 7.2;
      beam.rotation.y = yaw;
      group.add(beam);
      colliders.push(new THREE.Box3().setFromObject(beam));
      const crown = new THREE.Mesh(new THREE.BoxGeometry(p.width + 3.4, 0.7, 1.3), archMat2);
      crown.position.copy(beam.position);
      crown.position.y += 1.1;
      crown.rotation.y = yaw;
      group.add(crown);
      // amber gear inlay glowing on the beam face
      const inlay = new THREE.Mesh(new THREE.CircleGeometry(0.55, 12), inlayMat);
      inlay.position.copy(beam.position);
      inlay.position.addScaledVector(p.right, -p.width / 2 - 2.2);
      inlay.rotation.y = yaw;
      group.add(inlay);
    }
  }
  state.extras.push((dt, time) => {
    const pulse = 0.6 + Math.sin(time * 3) * 0.35;
    inlayMat.opacity = pulse;
  });

  // ------------------------------------------------------------------ bridge
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0xa86f3e, roughness: 0.95 });
  const bridgeMat2 = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.95 });
  if (track.bridgeRange) {
    // basin + dry riverbed under the bridge
    const basin = new THREE.Mesh(
      new THREE.CircleGeometry(130, 26),
      new THREE.MeshStandardMaterial({ color: 0xc79455, roughness: 1 })
    );
    basin.rotation.x = -Math.PI / 2;
    basin.position.set(128, 0.02, 220);
    group.add(basin);
    ribbon(S.filter((_, i) => {
      const s = (i / S.length) * track.L;
      return s > track.bridgeRange[0] - 25 && s < track.bridgeRange[1] + 25;
    }), (sm) => 7, () => -7, () => [0.62, 0.47, 0.31], false, roadMat, 0.15);

    for (let s = track.bridgeRange[0]; s <= track.bridgeRange[1]; s += 12) {
      const p = track.pointAt(s);
      for (const side of [1, -1]) {
        const h = Math.max(2, p.pos.y);
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.9, h, 1.9), bridgeMat);
        pillar.position.copy(p.pos).addScaledVector(p.right, side * (p.width / 2 - 1.2));
        pillar.position.y = h / 2 - 0.4;
        group.add(pillar);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 3), bridgeMat2);
        foot.position.copy(pillar.position);
        foot.position.y = 0.3;
        group.add(foot);
      }
    }
    // truss chords along both sides
    for (const side of [1, -1]) {
      const chordPts = [];
      for (let s = track.bridgeRange[0]; s <= track.bridgeRange[1]; s += 6) {
        const p = track.pointAt(s);
        const v = p.pos.clone().addScaledVector(p.right, side * (p.width / 2 - 1.2));
        chordPts.push(new THREE.Vector3(v.x, v.y + 1.1, v.z));
      }
      const curve = new THREE.CatmullRomCurve3(chordPts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.22, 5), bridgeMat2);
      group.add(tube);
    }
    // railings
    for (const side of [1, -1]) {
      for (let s = track.bridgeRange[0]; s < track.bridgeRange[1] - 1; s += 6) {
        const p = track.pointAt(s);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.9, 6.4), bridgeMat);
        rail.position.copy(p.pos).addScaledVector(p.right, side * (p.width / 2 - 0.3));
        rail.position.y += 0.55;
        rail.rotation.y = yawFor(p.dir);
        group.add(rail);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.3, 0.3), bridgeMat2);
        post.position.copy(p.pos).addScaledVector(p.right, side * (p.width / 2 - 0.3));
        post.position.y += 0.65;
        post.rotation.y = yawFor(p.dir);
        group.add(post);
      }
    }
  }

  // ------------------------------------------------------------ canyon cliffs
  const cliffMats = SANDSTONES.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
  if (track.canyonRange) {
    for (let s = track.canyonRange[0]; s <= track.canyonRange[1]; s += 10) {
      const p = track.pointAt(s);
      for (const side of [1, -1]) {
        if (rnd() < 0.15) continue;
        const x0 = p.pos.x + p.right.x * side * (p.width / 2 + 8 + rnd() * 8);
        const z0 = p.pos.z + p.right.z * side * (p.width / 2 + 8 + rnd() * 8);
        const h = 9 + rnd() * 12;
        // stacked strata: each tier smaller and slightly offset -> mesa look
        const tiers = 2 + (rnd() > 0.55 ? 1 : 0);
        let y = p.pos.y - 1.5;
        for (let k = 0; k < tiers; k++) {
          const tw = (5 + rnd() * 5) * (1 - k * 0.22);
          const th = h / tiers + rnd() * 1.5;
          const cliff = new THREE.Mesh(
            new THREE.BoxGeometry(tw + rnd() * 2, th, 4 + rnd() * 4),
            pickMat(SANDSTONES, cliffMats)
          );
          cliff.position.set(x0 + (rnd() - 0.5) * 2, y + th / 2, z0 + (rnd() - 0.5) * 2);
          cliff.rotation.y = rnd() * Math.PI;
          group.add(cliff);
          y += th * 0.92;
        }
      }
    }
  }

  // cacti
  const cactusMat = new THREE.MeshStandardMaterial({ color: 0x3f9e5a, roughness: 0.9 });
  const cactusMat2 = new THREE.MeshStandardMaterial({ color: 0x4fae66, roughness: 0.9 });
  for (let i = 0; i < 26; i++) {
    const s = rnd() * track.L;
    const p = track.pointAt(s);
    const side = rnd() > 0.5 ? 1 : -1;
    const dist = p.width / 2 + 9 + rnd() * 26;
    const c = new THREE.Group();
    if (rnd() > 0.5) {
      // saguaro with arms
      const h = 1.8 + rnd() * 1.8;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, h, 7), cactusMat);
      trunk.position.y = h / 2;
      c.add(trunk);
      if (rnd() > 0.3) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.9, 6), cactusMat);
        arm.position.set(0.45, h * 0.55, 0);
        arm.rotation.z = -0.9;
        c.add(arm);
        const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.7, 6), cactusMat);
        arm2.position.set(-0.4, h * 0.42, 0);
        arm2.rotation.z = 0.9;
        c.add(arm2);
      }
    } else {
      // barrel cactus
      const r = 0.5 + rnd() * 0.5;
      const barrel = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), cactusMat2);
      barrel.scale.y = 0.8;
      barrel.position.y = r * 0.8;
      c.add(barrel);
      const fl = new THREE.Mesh(new THREE.SphereGeometry(r * 0.25, 6, 5), cactusMat);
      fl.position.y = r * 1.55;
      c.add(fl);
    }
    c.position.copy(p.pos).addScaledVector(p.right, side * dist);
    c.position.y = 0;
    group.add(c);
  }

  // agave fans (instanced blades)
  const bladeGeo = new THREE.ConeGeometry(0.16, 1, 4);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x5fae70, roughness: 0.9 });
  const N_AGAVE = 24, BLADES = 7;
  const agave = new THREE.InstancedMesh(bladeGeo, bladeMat, N_AGAVE * BLADES);
  let ai = 0;
  for (let i = 0; i < N_AGAVE; i++) {
    const s = rnd() * track.L;
    const p = track.pointAt(s);
    const side = rnd() > 0.5 ? 1 : -1;
    const dist = p.width / 2 + 8 + rnd() * 30;
    const base = p.pos.clone().addScaledVector(p.right, side * dist);
    const sz = 0.7 + rnd() * 0.9;
    for (let b = 0; b < BLADES; b++) {
      const a = (b / BLADES) * Math.PI * 2 + rnd() * 0.3;
      dummy.position.set(base.x + Math.cos(a) * 0.3 * sz, 0.45 * sz, base.z + Math.sin(a) * 0.3 * sz);
      dummy.rotation.set(Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8);
      dummy.scale.set(sz, sz, sz);
      dummy.updateMatrix();
      agave.setMatrixAt(ai++, dummy.matrix);
    }
  }
  agave.instanceMatrix.needsUpdate = true;
  group.add(agave);

  // dry scrub bushes (instanced twig cones)
  const twigGeo = new THREE.ConeGeometry(0.12, 1, 4);
  const twigMat = new THREE.MeshStandardMaterial({ color: 0xc8a05a, roughness: 1 });
  const N_BUSH = 22, TWIGS = 5;
  const bushes = new THREE.InstancedMesh(twigGeo, twigMat, N_BUSH * TWIGS);
  let bi = 0;
  const bushCol = new THREE.Color();
  for (let i = 0; i < N_BUSH; i++) {
    const s = rnd() * track.L;
    const p = track.pointAt(s);
    const side = rnd() > 0.5 ? 1 : -1;
    const dist = p.width / 2 + 7 + rnd() * 24;
    const base = p.pos.clone().addScaledVector(p.right, side * dist);
    const sz = 0.5 + rnd() * 0.7;
    bushCol.setHex(0xc8a05a).multiplyScalar(0.8 + rnd() * 0.4);
    for (let b = 0; b < TWIGS; b++) {
      const a = rnd() * Math.PI * 2;
      dummy.position.set(base.x + Math.cos(a) * 0.25 * sz, 0.5 * sz, base.z + Math.sin(a) * 0.25 * sz);
      dummy.rotation.set((rnd() - 0.5) * 0.9, 0, (rnd() - 0.5) * 0.9);
      dummy.scale.set(sz, sz * (0.8 + rnd() * 0.6), sz);
      dummy.updateMatrix();
      bushes.setMatrixAt(bi, dummy.matrix);
      bushes.setColorAt(bi, bushCol);
      bi++;
    }
  }
  bushes.instanceMatrix.needsUpdate = true;
  group.add(bushes);

  // ------------------------------------------------- ancient gear monuments
  function gearMonument(x, y, z, radius) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.6, metalness: 0.35 });
    const mat2 = new THREE.MeshStandardMaterial({ color: 0x75592f, roughness: 0.7, metalness: 0.3 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1.1, 20), mat);
    disc.rotation.z = Math.PI / 2;
    g.add(disc);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 1.4), mat2);
      tooth.position.set(0, Math.sin(a) * (radius + 0.6), Math.cos(a) * (radius + 0.6));
      tooth.rotation.x = -a;
      g.add(tooth);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.25, radius * 0.25, 1.7, 10), mat);
    hub.rotation.z = Math.PI / 2;
    g.add(hub);
    g.position.set(x, y, z);
    group.add(g);
    state.gearMonuments.push(g);
    colliders.push(new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(x, y, z), new THREE.Vector3(3, radius * 2.4, radius * 2.4)));
  }
  gearMonument(322, 9, 20, 7);
  gearMonument(-348, 7, 150, 5.5);
  gearMonument(-40, 6, -250, 4.5);

  // giant half-buried landmark gear on the north straight
  const megaGear = new THREE.Group();
  const megaMat = new THREE.MeshStandardMaterial({ color: 0x8f6c3a, roughness: 0.75, metalness: 0.3, flatShading: true });
  const megaDisc = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 1.6, 22), megaMat);
  megaDisc.rotation.z = Math.PI / 2;
  megaGear.add(megaDisc);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, 2), megaMat);
    tooth.position.set(0, Math.sin(a) * 12.4, Math.cos(a) * 12.4);
    tooth.rotation.x = -a;
    megaGear.add(tooth);
  }
  const megaHub = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 2.4, 12), megaMat);
  megaHub.rotation.z = Math.PI / 2;
  megaGear.add(megaHub);
  megaGear.position.set(150, 3.2, -245);
  group.add(megaGear);
  colliders.push(new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(150, 4, -245), new THREE.Vector3(4, 26, 26)));

  // -------------------------------------------------------- moving obstacles
  // rotating gear arm in the canyon
  const gearG = new THREE.Group();
  const gearMatDark = new THREE.MeshStandardMaterial({ color: 0x7c5a2e, roughness: 0.55, metalness: 0.4 });
  const gearGlowMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9 });
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 1.1, 14), gearMatDark);
  gearG.add(hub);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(track.gear.armRadius * 2, 0.55, 1.1), gearMatDark);
  arm.position.y = 0.45;
  gearG.add(arm);
  for (const side of [1, -1]) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), gearMatDark);
    tip.position.set(side * track.gear.armRadius, 0.45, 0);
    gearG.add(tip);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), gearGlowMat);
    glow.position.set(side * track.gear.armRadius, 1.15, 0);
    gearG.add(glow);
  }
  gearG.position.copy(track.gear.center);
  gearG.position.y += 0.5;
  group.add(gearG);
  state.gearMesh = gearG;

  // sliding stone pillar on the north straight
  const sliderG = new THREE.Group();
  const sliderMat = new THREE.MeshStandardMaterial({ color: 0x8f6238, roughness: 0.9, flatShading: true });
  const bandMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 2.4), sliderMat);
  sliderG.add(slab);
  for (const yy of [-0.6, 0.6]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.28, 2.55), bandMat);
    band.position.y = yy;
    sliderG.add(band);
  }
  sliderG.position.copy(track.slider.pos);
  group.add(sliderG);
  state.sliderMesh = sliderG;

  // ----------------------------------------------------------- sand particles
  const N_SAND = 240;
  const sandPos = new Float32Array(N_SAND * 3);
  const sandBase = [];
  for (let i = 0; i < N_SAND; i++) {
    const x = (rnd() - 0.5) * 720;
    const y = rnd() * 26;
    const z = (rnd() - 0.5) * 720;
    sandPos[i * 3] = x; sandPos[i * 3 + 1] = y; sandPos[i * 3 + 2] = z;
    sandBase.push({ x, y, z, sp: 4 + rnd() * 9, ph: rnd() * Math.PI * 2 });
  }
  const sandGeo = new THREE.BufferGeometry();
  sandGeo.setAttribute('position', new THREE.BufferAttribute(sandPos, 3));
  const sand = new THREE.Points(sandGeo, new THREE.PointsMaterial({
    color: 0xe8c088, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0.4, depthWrite: false,
  }));
  group.add(sand);
  state.extras.push((dt, time) => {
    const arr = sandGeo.attributes.position.array;
    for (let i = 0; i < N_SAND; i++) {
      const b = sandBase[i];
      b.x += b.sp * dt;
      if (b.x > 360) b.x = -360;
      arr[i * 3] = b.x;
      arr[i * 3 + 1] = b.y + Math.sin(time * 0.7 + b.ph) * 1.6;
      arr[i * 3 + 2] = b.z + Math.cos(time * 0.5 + b.ph) * 1.2;
    }
    sandGeo.attributes.position.needsUpdate = true;
  });

  // ----------------------------------------------------------- circling raptors
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x4a3628, side: THREE.DoubleSide });
  const birds = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Group();
    const wingGeo = new THREE.PlaneGeometry(2.4, 0.7);
    const w1 = new THREE.Mesh(wingGeo, birdMat);
    w1.position.x = 1.2; w1.rotation.z = 0.35;
    const w2 = new THREE.Mesh(wingGeo, birdMat);
    w2.position.x = -1.2; w2.rotation.z = -0.35;
    b.add(w1, w2);
    b.position.set(0, 45 + i * 8, 0);
    group.add(b);
    birds.push({ g: b, a: rnd() * Math.PI * 2, r: 70 + rnd() * 90, y: 45 + i * 9, sp: 0.16 + rnd() * 0.1, cx: 0, cz: 40 });
  }
  state.extras.push((dt) => {
    for (const b of birds) {
      b.a += b.sp * dt;
      b.g.position.set(b.cx + Math.cos(b.a) * b.r, b.y + Math.sin(b.a * 2) * 3, b.cz + Math.sin(b.a) * b.r);
      b.g.rotation.y = -b.a;
    }
  });

  // ----------------------------------------------------------- frame updates
  state.update = (dt, time) => {
    gearG.rotation.y = track.gear.angle;
    state.sliderMesh.position.set(track.slider.pos.x, track.slider.pos.y, track.slider.pos.z);
    for (let i = 0; i < state.gearMonuments.length; i++) {
      state.gearMonuments[i].rotation.x = time * (0.08 + i * 0.05);
    }
    megaGear.rotation.x = time * 0.05;
    const pulse = 0.75 + Math.sin(time * 6) * 0.25;
    for (const m of state.padMaterials) m.opacity = pulse;
    for (const m of state.padGlow) m.opacity = 0.08 + pulse * 0.09;
    for (const fn of state.extras) fn(dt, time);
  };

  return { group, colliders, state };
}
