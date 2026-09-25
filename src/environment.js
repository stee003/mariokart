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
import { OBSTACLE_PROFILE } from './track.js';
import { buildGuardRails } from './guardRails.js';

const SANDSTONES = [0xc9834e, 0xb97a45, 0xd99a5b, 0xa86f3e, 0xd18c50];
const DUNES = [0xe0b070, 0xd8a868, 0xdcab78, 0xe6bc84, 0xcfa060];
const pick = (arr, i) => arr[i % arr.length];
const yawFor = (dir) => Math.atan2(dir.x, dir.z);

export function buildEnvironment(scene, track) {
  const group = new THREE.Group();
  const colliders = [];
  const state = { padMaterials: [], gearMonuments: [], extras: [], padGlow: [], puddles: [], ripples: [], animals: [], tumbleweeds: [] };

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

  // track-edge protection: desert-style guard rails on the circuit's
  // danger profile (corners, elevated decks); collides exactly as drawn
  buildGuardRails(group, track, 'desert', state);

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
  // ------------------------------------------------------------------
  // SUNFORGE REFINEMENT: enhanced visual identity, water, animals
  // ------------------------------------------------------------------

  // === God rays / light shafts ===
  {
    const rayMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const rays = new THREE.Group();
    rays.name = 'Sun god rays';
    for (let i = 0; i < 5; i++) {
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(38 + i*12, 420), rayMat);
      ray.position.set(-40 + i*45, 115, -180 + i*20);
      ray.rotation.z = 0.12 + i*0.04;
      ray.rotation.y = 0.35;
      rays.add(ray);
    }
    group.add(rays);
    state.extras.push((dt, time) => {
      const o = 0.045 + Math.sin(time*0.35)*0.015;
      for (const ray of rays.children) ray.material.opacity = o + (Math.random()-0.5)*0.008;
    });
  }

  // === Heat haze shimmer over distant sand ===
  {
    const hazeGeo = new THREE.PlaneGeometry(720, 720);
    const hazeCanvas = document.createElement('canvas');
    hazeCanvas.width = 256; hazeCanvas.height = 256;
    const hc = hazeCanvas.getContext('2d');
    hc.fillStyle = '#e9c29a'; hc.fillRect(0,0,256,256);
    for (let i=0;i<600;i++){ hc.fillStyle='rgba(255,255,255,'+(0.04+Math.random()*0.08)+')'; hc.fillRect(Math.random()*256, Math.random()*256, 2,2); }
    const hazeTex = new THREE.CanvasTexture(hazeCanvas);
    hazeTex.wrapS = hazeTex.wrapT = THREE.RepeatWrapping; hazeTex.repeat.set(4,4);
    const hazeMat = new THREE.MeshBasicMaterial({ map: hazeTex, transparent: true, opacity: 0.14, depthWrite: false });
    const haze = new THREE.Mesh(hazeGeo, hazeMat);
    haze.rotation.x = -Math.PI/2; haze.position.y = 0.02;
    group.add(haze);
    state.extras.push((dt)=>{ hazeTex.offset.x += dt*0.006; hazeTex.offset.y += dt*0.003; });
  }

  // === Oasis & interactive puddle ===
  // Off-track oasis (visual landmark) + on-track puddle that reacts to the car
  let puddleInfo = null;
  let oasisMesh = null;
  {
    // Choose puddle location on a flat, visible straight: around f=0.265
    const prog = track.L * 0.265;
    const pp = track.pointAt(prog);
    const center = pp.pos.clone().addScaledVector(pp.right, 0.2);
    center.y = pp.pos.y + 0.04;
    const radius = 6.2;

    // Visible puddle - shallow desert wash crossing the road
    const puddleGeo = new THREE.CircleGeometry(radius, 28);
    // distort vertices slightly for organic shoreline
    const posAttr = puddleGeo.attributes.position;
    for (let i=0;i<posAttr.count;i++){
      const x = posAttr.getX(i), y = posAttr.getY(i);
      const d = Math.hypot(x,y);
      if (d>0.1){
        const ang = Math.atan2(y,x);
        const wobble = 1 + Math.sin(ang*5 + i*0.7)*0.08 + Math.cos(ang*3)*0.05;
        posAttr.setX(i, x*wobble);
        posAttr.setY(i, y*wobble*0.9);
      }
    }
    puddleGeo.computeVertexNormals();
    const puddleMat = new THREE.MeshStandardMaterial({
      color: 0x4a8da8, roughness: 0.12, metalness: 0.28, transparent: true, opacity: 0.88,
      emissive: 0x1a3a4a, emissiveIntensity: 0.12
    });
    const puddleMesh = new THREE.Mesh(puddleGeo, puddleMat);
    puddleMesh.rotation.x = -Math.PI/2;
    puddleMesh.rotation.z = yawFor(pp.dir);
    puddleMesh.position.copy(center);
    puddleMesh.position.y += 0.06;
    puddleMesh.name = 'Sunforge interactive puddle';
    group.add(puddleMesh);

    // shoreline stones
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a7060, roughness: 1, flatShading: true });
    for (let i=0;i<16;i++){
      const a = (i/16)*Math.PI*2;
      const rr = radius*0.92 + (rnd()-0.5)*0.9;
      const sx = center.x + Math.cos(a)*rr;
      const sz = center.z + Math.sin(a)*rr;
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35+Math.random()*0.35,0), stoneMat);
      stone.position.set(sx, center.y+0.02, sz);
      stone.scale.set(1, 0.6, 1);
      stone.rotation.set(Math.random()*0.6, Math.random()*Math.PI, Math.random()*0.6);
      group.add(stone);
    }
    // subtle reflective highlight
    const highlight = new THREE.Mesh(new THREE.CircleGeometry(radius*0.55, 18), new THREE.MeshBasicMaterial({ color: 0xd6eef5, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    highlight.rotation.x = -Math.PI/2;
    highlight.position.copy(center); highlight.position.y += 0.07;
    group.add(highlight);

    // ripple rings that expand when driven through
    const ripples = [];
    state.puddles.push({ center: center.clone(), radius, mesh: puddleMesh, highlight, ripples });

    // helper to spawn a ripple
    const spawnRipple = (pos) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 18), new THREE.MeshBasicMaterial({ color: 0x8ac8e0, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI/2;
      ring.position.set(pos.x, center.y+0.09, pos.z);
      ring.userData.t = 0;
      group.add(ring);
      ripples.push(ring);
    };
    state.spawnPuddleRipple = spawnRipple;

    // animate ripples and subtle water shimmer
    state.extras.push((dt, time) => {
      puddleMat.emissiveIntensity = 0.10 + Math.sin(time*1.2)*0.02;
      highlight.position.x = center.x + Math.sin(time*0.4)*0.12;
      highlight.position.z = center.z + Math.cos(time*0.35)*0.12;
      for (let i=ripples.length-1;i>=0;i--){
        const r = ripples[i];
        r.userData.t += dt;
        const t = r.userData.t;
        const s = 1 + t*3.2;
        r.scale.setScalar(s);
        r.material.opacity = Math.max(0, 0.62 - t*0.95);
        if (t>0.75){ group.remove(r); r.geometry.dispose(); r.material.dispose(); ripples.splice(i,1); }
      }
    });

    // Add zone-like slippery physics via track (pure visual zone but also grip)
    // Push a short slippery microregion so VehicleController naturally loses grip
    track.zones.push({ s0: prog-7, s1: prog+7, type: 'slippery', v: 0.58 });

    // Off-track oasis pond (scenic, near canyon mouth)
    const oasisProg = track.L * 0.78;
    const op = track.pointAt(oasisProg);
    const oasisCenter = op.pos.clone().addScaledVector(op.right, -(op.width/2 + 22));
    oasisCenter.y = op.pos.y - 0.8;
    const oasisGeo = new THREE.CircleGeometry(15, 24);
    const oasisMat = new THREE.MeshStandardMaterial({ color: 0x2e7a88, roughness: 0.18, metalness: 0.35, transparent: true, opacity: 0.92 });
    oasisMesh = new THREE.Mesh(oasisGeo, oasisMat);
    oasisMesh.rotation.x = -Math.PI/2;
    oasisMesh.position.set(oasisCenter.x, oasisCenter.y+0.12, oasisCenter.z);
    group.add(oasisMesh);
    const bankMat = new THREE.MeshStandardMaterial({ color: 0xc9ab7a, roughness: 1 });
    const bank = new THREE.Mesh(new THREE.RingGeometry(15, 18, 24), bankMat);
    bank.rotation.x = -Math.PI/2;
    bank.position.set(oasisCenter.x, oasisCenter.y+0.05, oasisCenter.z);
    group.add(bank);
    // palms around oasis
    const palmMatTrunk = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 1 });
    const palmMatLeaf = new THREE.MeshStandardMaterial({ color: 0x2d7a3a, roughness: 0.8, flatShading: true });
    const frondGeo = new THREE.ConeGeometry(0.55, 2.2, 5);
    frondGeo.translate(0, 1.1, 0);
    for (let i=0;i<7;i++){
      const a = (i/7)*Math.PI*2 + rnd()*0.4;
      const r = 12 + rnd()*5;
      const pc = oasisCenter.clone().add(new THREE.Vector3(Math.cos(a)*r, 0, Math.sin(a)*r));
      pc.y = oasisCenter.y;
      const h = 4 + rnd()*2.5;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, h, 6), palmMatTrunk);
      trunk.position.set(pc.x, pc.y + h/2, pc.z);
      trunk.rotation.z = (rnd()-0.5)*0.15;
      group.add(trunk);
      const crown = new THREE.Group();
      crown.position.set(pc.x, pc.y+h, pc.z);
      for(let f=0; f<6; f++){
        const fr = new THREE.Mesh(frondGeo, palmMatLeaf);
        fr.rotation.y = (f/6)*Math.PI*2;
        fr.rotation.z = 0.9 + rnd()*0.2;
        crown.add(fr);
      }
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.28,6,5), new THREE.MeshStandardMaterial({color: 0x8a6520}));
      top.position.y = 0.2; crown.add(top);
      group.add(crown);
      state.extras.push((dt,time)=>{ crown.rotation.y = a + Math.sin(time*0.5+i)*0.08; });
    }
    state.extras.push((dt,time)=>{
      oasisMesh.material.opacity = 0.88 + Math.sin(time*0.7)*0.04;
    });
  }

  // === Hoodoos & rock arches (extra strata detail) ===
  {
    const hoodooMat = new THREE.MeshStandardMaterial({ color: 0xc9834e, roughness: 1, flatShading: true });
    const hoodooMat2 = new THREE.MeshStandardMaterial({ color: 0xb97a45, roughness: 1, flatShading: true });
    for(let i=0;i<10;i++){
      const s = rnd()*track.L; const p = track.pointAt(s);
      if (Math.abs(s/track.L - 0.265) < 0.04) continue; // keep puddle area clear
      const side = rnd()>0.5?1:-1; const dist = p.width/2 + 18 + rnd()*28;
      const base = p.pos.clone().addScaledVector(p.right, side*dist);
      base.y = p.pos.y -0.6;
      const h = 5 + rnd()*7;
      const hood = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, h*0.55, 6), hoodooMat2);
      stem.position.y = h*0.28; hood.add(stem);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.2+ rnd()*0.6, 8,6), hoodooMat);
      cap.scale.y = 0.55; cap.position.y = h*0.58; hood.add(cap);
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.9+ rnd()*0.5, 1.4, 6), hoodooMat);
      top.position.y = h*0.58 + 0.8; hood.add(top);
      hood.position.copy(base);
      hood.rotation.y = rnd()*Math.PI;
      group.add(hood);
    }
    // a natural arch near the canyon
    if (track.canyonRange){
      const s = (track.canyonRange[0]+track.canyonRange[1])/2;
      const p = track.pointAt(s);
      const side = -1; const base = p.pos.clone().addScaledVector(p.right, side*(p.width/2+34));
      base.y = p.pos.y -1;
      const archGroup = new THREE.Group();
      const pillarGeo = new THREE.BoxGeometry(2.2, 14, 2.2);
      const mat = new THREE.MeshStandardMaterial({ color: 0xd99a5b, roughness: 1, flatShading: true });
      const left = new THREE.Mesh(pillarGeo, mat); left.position.set(-6, 7, 0); archGroup.add(left);
      const right = new THREE.Mesh(pillarGeo, mat); right.position.set(6,7,0); archGroup.add(right);
      const lint = new THREE.Mesh(new THREE.BoxGeometry(15, 2.2, 3), mat); lint.position.y = 14.5; archGroup.add(lint);
      const capMat = new THREE.MeshStandardMaterial({ color: 0xa86f3e });
      const cap1 = new THREE.Mesh(new THREE.BoxGeometry(2.8,1,2.8), capMat); cap1.position.set(-6,14.5,0); archGroup.add(cap1);
      const cap2 = cap1.clone(); cap2.position.set(6,14.5,0); archGroup.add(cap2);
      archGroup.position.copy(base); archGroup.rotation.y = yawFor(p.dir);
      group.add(archGroup);
    }
  }

  // === Solar forge mirror array on distant mesa ===
  {
    const mirrorMat = new THREE.MeshStandardMaterial({ color: 0x6a7a8a, roughness: 0.25, metalness: 0.75 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.6, metalness: 0.3 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffe7a0, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
    for(let i=0;i<6;i++){
      const base = new THREE.Vector3(120 + i*18, 6, -260 - i*6);
      // pedestal
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.6, 6,6), frameMat);
      ped.position.copy(base); ped.position.y += 3;
      group.add(ped);
      // dish
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(5,5,0.6,18), mirrorMat);
      dish.rotation.x = Math.PI/2 - 0.35;
      dish.position.copy(base); dish.position.y += 6.2;
      dish.rotation.y = Math.PI*0.7;
      group.add(dish);
      const gl = new THREE.Mesh(new THREE.CircleGeometry(4.6, 18), glowMat);
      gl.position.copy(dish.position); gl.position.y += 0.35;
      gl.rotation.x = -Math.PI/2 +0.35; gl.rotation.z = Math.PI*0.7;
      group.add(gl);
      state.extras.push((dt,time)=>{
        const f = 0.18 + Math.sin(time*1.1+i)*0.07;
        gl.material.opacity = f;
      });
    }
  }

  // === Tumbleweeds (rolling instanced) ===
  {
    const tumbleGeo = new THREE.SphereGeometry(0.65, 7,5);
    const posAttr = tumbleGeo.attributes.position;
    // add spiky displacement
    for(let i=0;i<posAttr.count;i++){
      const v = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      const d = 1 + (Math.random()-0.5)*0.35;
      v.multiplyScalar(d);
      posAttr.setXYZ(i, v.x, v.y, v.z);
    }
    tumbleGeo.computeVertexNormals();
    const tumbleMat = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 1, flatShading: true });
    const N_TUMBLE = 14;
    const tumbles = new THREE.InstancedMesh(tumbleGeo, tumbleMat, N_TUMBLE);
    const tData = [];
    for(let i=0;i<N_TUMBLE;i++){
      const s = rnd()*track.L; const p = track.pointAt(s);
      const side = rnd()>0.5?1:-1; const dist = p.width/2 + 10 + rnd()*32;
      const base = p.pos.clone().addScaledVector(p.right, side*dist);
      base.y = 0.55;
      tData.push({ base: base.clone(), s, a: rnd()*Math.PI*2, sp: 6 + rnd()*8, roll: rnd()*Math.PI });
    }
    state.tumbleweeds = { mesh: tumbles, data: tData };
    group.add(tumbles);
    const dummy2 = new THREE.Object3D();
    state.extras.push((dt, time)=>{
      for(let i=0;i<N_TUMBLE;i++){
        const d = tData[i];
        d.a += dt * (d.sp*0.08);
        // drift across desert perpendicular to track
        const p = track.pointAt(((d.s + time*d.sp)%track.L));
        const off = Math.sin(time*0.3 + i)*6;
        const pos = p.pos.clone().addScaledVector(p.right, (p.width/2 + 18 + (i%3)*8)* (d.base.x>p.pos.x?1:-1) + off);
        pos.y = 0.55 + Math.abs(Math.sin(time*2 + i))*0.08;
        dummy2.position.copy(pos);
        dummy2.rotation.set(time* (1.2 + i*0.1), d.a, 0);
        dummy2.scale.setScalar(0.85 + (i%3)*0.2);
        dummy2.updateMatrix();
        tumbles.setMatrixAt(i, dummy2.matrix);
      }
      tumbles.instanceMatrix.needsUpdate = true;
    });
  }

  // === Flags & banners along track ===
  {
    const flagGeo = new THREE.PlaneGeometry(1.6, 1.1, 4,2);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.7, metalness: 0.25 });
    const colors = [0xc8452a, 0xffb347, 0x6a9a3e];
    for(let f=0.06; f<0.98; f+=0.14){
      const p = track.pointAt(f*track.L);
      if (Math.abs(f-0.265)<0.04) continue;
      for(const side of [1,-1]){
        if (side==-1 && Math.random()<0.4) continue;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.09, 3.2,5), poleMat);
        pole.position.copy(p.pos).addScaledVector(p.right, side*(p.width/2+2.6));
        pole.position.y += 1.6;
        group.add(pole);
        const texCanvas = document.createElement('canvas'); texCanvas.width=64; texCanvas.height=32;
        const ctx = texCanvas.getContext('2d'); ctx.fillStyle = '#'+colors[Math.floor(rnd()*3)].toString(16).padStart(6,'0'); ctx.fillRect(0,0,64,32);
        ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.font='900 18px monospace'; ctx.textAlign='center'; ctx.fillText('SF',32,20);
        const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(texCanvas), side: THREE.DoubleSide });
        const flag = new THREE.Mesh(flagGeo, mat);
        flag.position.copy(pole.position); flag.position.y += 0.9;
        flag.position.addScaledVector(p.right, side*0.85);
        flag.rotation.y = yawFor(p.dir) + (side>0?0:Math.PI);
        group.add(flag);
        flag.userData.baseY = flag.position.y; flag.userData.phase = rnd()*6;
        state.extras.push((dt,time)=>{
          const w = Math.sin(time*2.8 + flag.userData.phase)*0.28;
          const arr = flag.geometry.attributes.position;
          for(let i=0;i<arr.count;i++){
            const x = arr.getX(i);
            arr.setZ(i, Math.sin(x*3 + time*4 + flag.userData.phase)*0.18 );
          }
          arr.needsUpdate = true;
          flag.rotation.z = w*0.5;
        });
      }
    }
  }

  // === Desert flowers & additional scrub ===
  {
    const flowerGeo = new THREE.SphereGeometry(0.14,5,4);
    const flowerMats = [0xff6a3c, 0xffd23f, 0xff8ae8, 0xffffff].map(c=> new THREE.MeshBasicMaterial({color:c}));
    const stemMat = new THREE.MeshStandardMaterial({color: 0x4a7a3c});
    for(let i=0;i<34;i++){
      const s = rnd()*track.L; const p = track.pointAt(s);
      const side = rnd()>0.5?1:-1; const dist = p.width/2 + 6 + rnd()*22;
      if (Math.abs(s/track.L -0.265)<0.05 && Math.abs(dist)<12) continue;
      const base = p.pos.clone().addScaledVector(p.right, side*dist);
      base.y = 0.18;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.03,0.35,4), stemMat);
      stem.position.copy(base); stem.position.y += 0.18;
      group.add(stem);
      const bloom = new THREE.Mesh(flowerGeo, flowerMats[Math.floor(rnd()*4)]);
      bloom.position.copy(base); bloom.position.y += 0.38;
      group.add(bloom);
    }
  }




  // === Ambient desert animals (safe, off-track) ===
  {
    // Helper to place safely outside racing line: use lateral > width/2 + 12
    const placeOutside = (progFrac, side, extraDist) => {
      const p = track.pointAt(progFrac*track.L);
      const dist = p.width/2 + 12 + extraDist;
      const pos = p.pos.clone().addScaledVector(p.right, side*dist);
      pos.y = p.pos.y;
      return { p, pos };
    };

    // 1) Desert foxes (2) - trotting near rocks
    const foxMat = new THREE.MeshStandardMaterial({ color: 0xc68642, roughness: 1 });
    const foxMat2 = new THREE.MeshStandardMaterial({ color: 0xfff4d0, roughness: 1 });
    const foxMatDark = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 1 });
    for(let i=0;i<2;i++){
      const { pos } = placeOutside(0.42 + i*0.31, i%2?1:-1, 14 + rnd()*12);
      const fox = new THREE.Group(); fox.name='Desert fox';
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 4,8), foxMat);
      body.rotation.z = Math.PI/2; body.position.y = 0.36; fox.add(body);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.35, 6), foxMat);
      head.rotation.z = -Math.PI/2; head.position.set(0.45, 0.42, 0); fox.add(head);
      const earGeo = new THREE.ConeGeometry(0.08,0.18,4);
      for(const sx of [1,-1]){ const ear = new THREE.Mesh(earGeo, foxMatDark); ear.position.set(0.48, 0.55, sx*0.09); fox.add(ear); }
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4,6), foxMat);
      tail.rotation.z = Math.PI/2; tail.position.set(-0.45, 0.32, 0); fox.add(tail);
      for(const sx of [1,-1]){
        for(const fz of [0.18,-0.18]){
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.05,0.28,5), foxMatDark);
          leg.position.set(fz, 0.14, sx*0.12); fox.add(leg);
        }
      }
      fox.position.copy(pos); fox.position.y = 0.05;
      group.add(fox);
      // wandering animation: small patrol loop
      const start = pos.clone();
      state.animals.push({ mesh: fox, type:'fox', base: start.clone(), phase: rnd()*6, side: i%2?1:-1 });
    }

    // 2) Lizards on rocks (4) - basking, occasional tail flick
    const lizardMat = new THREE.MeshStandardMaterial({ color: 0x7a9a58, roughness: 0.9 });
    for(let i=0;i<4;i++){
      const { pos } = placeOutside(0.18 + i*0.19, 1, 9 + rnd()*10);
      const lizard = new THREE.Group(); lizard.name='Basking lizard';
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.45,4,6), lizardMat);
      body.rotation.z = Math.PI/2; body.position.y = 0.11; lizard.add(body);
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.38,4,6), lizardMat);
      tail.rotation.z = Math.PI/2; tail.position.set(-0.32, 0.09, 0); lizard.add(tail);
      tail.name='tail';
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09,6,5), lizardMat);
      head.position.set(0.26,0.13,0); lizard.add(head);
      lizard.position.copy(pos); lizard.position.y = 0.02;
      group.add(lizard);
      state.animals.push({ mesh: lizard, type:'lizard', base: pos.clone(), phase: rnd()*6 });
    }

    // 3) Hares (2) - hopping near scrub
    const hareMat = new THREE.MeshStandardMaterial({ color: 0xd8c2a6, roughness: 1 });
    const hareEarMat = new THREE.MeshStandardMaterial({ color: 0x6a9a8a, roughness: 1 });
    for(let i=0;i<2;i++){
      const { pos } = placeOutside(0.55 + i*0.22, -1, 16 + rnd()*10);
      const hare = new THREE.Group(); hare.name='Desert hare';
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.45,4,6), hareMat);
      body.rotation.z = Math.PI/2; body.position.y=0.26; hare.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16,7,5), hareMat);
      head.position.set(0.26,0.34,0); hare.add(head);
      for(const sx of [1,-1]){ const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.04,0.32,4,6), hareEarMat); ear.position.set(0.28,0.48, sx*0.06); hare.add(ear); }
      hare.position.copy(pos); hare.position.y=0.02;
      group.add(hare);
      state.animals.push({ mesh: hare, type:'hare', base: pos.clone(), phase: rnd()*6, hopT: rnd()*2 });
    }

    // 4) Camel caravan far distance (moving slowly around horizon)
    {
      const camelMat = new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 1 });
      const caravan = new THREE.Group(); caravan.name='Camel caravan';
      for(let c=0;c<3;c++){
        const camel = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.9,0.55,0.32), camelMat); body.position.y=0.85; camel.add(body);
        const hump = new THREE.Mesh(new THREE.SphereGeometry(0.26,6,5), camelMat); hump.position.set(0,1.12,0); hump.scale.y=0.7; camel.add(hump);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.12,0.6,5), camelMat); neck.position.set(0.4,1.15,0); neck.rotation.z=-0.6; camel.add(neck);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.28,0.22,0.2), camelMat); head.position.set(0.58,1.42,0); camel.add(head);
        for(const sx of [1,-1]){
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,0.72,5), camelMat); leg.position.set(0.32,0.36, sx*0.12); camel.add(leg);
          const leg2 = leg.clone(); leg2.position.set(-0.32,0.36, sx*0.12); camel.add(leg2);
        }
        camel.position.set(c*3.2,0,0);
        caravan.add(camel);
      }
      caravan.position.set(260, 0, 80);
      group.add(caravan);
      state.animals.push({ mesh: caravan, type:'caravan', base: new THREE.Vector3(260,0,80), phase: 0 });
    }

    // generic animal animation loop
    state.extras.push((dt, time)=>{
      for(const a of state.animals){
        if (a.type==='fox'){
          const off = Math.sin(time*0.6 + a.phase)*1.8;
          a.mesh.position.x = a.base.x + off * (a.side*0.3);
          a.mesh.position.z = a.base.z + Math.cos(time*0.5 + a.phase)*1.2;
          a.mesh.rotation.y = Math.sin(time*0.6 + a.phase)*0.6;
          a.mesh.position.y = 0.05 + Math.abs(Math.sin(time*3 + a.phase))*0.04;
        } else if (a.type==='lizard'){
          const tail = a.mesh.getObjectByName('tail');
          if (tail) tail.rotation.y = Math.sin(time*2.5 + a.phase)*0.35;
          a.mesh.rotation.y = Math.sin(time*0.3 + a.phase)*0.2;
        } else if (a.type==='hare'){
          a.hopT += dt*2.2;
          const hop = Math.max(0, Math.sin(a.hopT))*0.18;
          a.mesh.position.y = 0.02 + hop;
          a.mesh.rotation.y = Math.sin(time*0.4 + a.phase)*0.4;
          if (hop>0.01) a.mesh.position.x = a.base.x + Math.sin(a.hopT*0.6)*0.4;
        } else if (a.type==='caravan'){
          const t = time*0.018;
          const r = 520;
          a.mesh.position.set(Math.cos(t)*r, 0, Math.sin(t)*r);
          a.mesh.rotation.y = -t + Math.PI/2;
          // gentle bob
          a.mesh.position.y = Math.sin(time*0.8 + a.phase)*0.12;
        }
      }
    });
  }

  // === Dust devils (rotating sand columns, distant) ===
  {
    const devilMat = new THREE.MeshBasicMaterial({ color: 0xe8c088, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
    const devils = [];
    for(let i=0;i<3;i++){
      const h = 14 + rnd()*12;
      const devil = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, h, 7, 1, true), devilMat.clone());
      devil.position.set( (rnd()-0.5)*420, h/2, (rnd()-0.5)*420 );
      // keep away from road
      const chk = track.surface(devil.position, {main:-1, sc:-1});
      if (Math.abs(chk.lateral) < chk.width/2 + 20){ i--; continue; }
      group.add(devil);
      devils.push({ mesh: devil, y0: h/2, phase: rnd()*6, speed: 0.6 + rnd()*0.7 });
    }
    state.extras.push((dt, time)=>{
      for(const d of devils){
        d.mesh.rotation.y += dt * d.speed;
        d.mesh.position.y = d.y0 + Math.sin(time*0.5 + d.phase)*0.8;
        d.mesh.material.opacity = 0.14 + Math.sin(time*0.9 + d.phase)*0.05;
      }
    });
  }


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
  // Dimensions come from the shared collision profile, so this gear's visible
  // hub / arm / tips are exactly what getObstacleColliders() reports.
  const GP = track.gear.profile || OBSTACLE_PROFILE.gear;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(GP.hubRadius, GP.hubRadius, GP.hubHeight, 14), gearMatDark);
  gearG.add(hub);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(track.gear.armRadius * 2, GP.armHeight, GP.armDepth), gearMatDark);
  arm.position.y = GP.armLift;
  gearG.add(arm);
  for (const side of [1, -1]) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(GP.tipRadius, 10, 8), gearMatDark);
    tip.position.set(side * track.gear.armRadius, GP.armLift, 0);
    gearG.add(tip);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(GP.tipRadius * 0.42, 8, 6), gearGlowMat);
    glow.position.set(side * track.gear.armRadius, GP.armLift + GP.tipRadius * 0.58, 0);
    gearG.add(glow);
  }
  gearG.position.copy(track.gear.center);
  gearG.position.y += GP.lift;
  group.add(gearG);
  state.gearMesh = gearG;

  // sliding stone pillar on the north straight
  const sliderG = new THREE.Group();
  const sliderMat = new THREE.MeshStandardMaterial({ color: 0x8f6238, roughness: 0.9, flatShading: true });
  const bandMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85 });
  const SP = track.slider.profile || OBSTACLE_PROFILE.slider;
  const slabW = track.slider.radius * SP.boxScale;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(slabW, SP.height, slabW), sliderMat);
  sliderG.add(slab);
  for (const yy of [-0.6, 0.6]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(slabW * 1.02, 0.28, slabW * 1.02), bandMat);
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
