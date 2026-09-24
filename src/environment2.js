// ============================================================================
// Themed environment renderer. Builds the world for any TrackManager def
// from a per-theme "kit" (sky, fog, lights, ground, prop archetypes).
// The original Sunforge desert stays in environment.js - main.js routes
// sunforge_circuit there and every other track here.
//
// Shared construction (road ribbon, curbs, ramps, pads, finish, banner,
// tunnels, obstacle meshes) is theme-parameterized; props give each
// environment its own silhouette and environmental storytelling.
//
// 2026 flagship pass: the desert / forest / city kits (used ONLY by
// Ashfall Run, Verdant Loop, Neon Cascade and Skyline Helix) were rebuilt
// with layered "road2" surfacing, richer skies (stars, sun/moon discs),
// per-theme tunnel variants, denser hand-tuned prop sets and per-track
// FLAVORS - signature landmarks (volcano, mega-tower, billboards, forest
// landmarks) with their own animation hooks. Every other theme's kit and
// prop set is byte-for-byte the previous release.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { createRampVisual } from './terrainMesh.js';
import { OBSTACLE_PROFILE, flameHazardRadius } from './track.js';
import { REFINEMENT_KITS, buildRefinedEnvironment } from './refinedEnvironment.js';
import { EXPEDITION_KITS, buildExpeditionEnvironment } from './expeditionEnvironment.js';

const UP = new THREE.Vector3(0, 1, 0);
const yawFor = (dir) => Math.atan2(dir.x, dir.z);

// ----------------------------------------------------------------------------
// Theme kits: colors + prop builders. Prop fns receive (group, track, rnd).
//
// "road2" kits get the layered flagship road: sand/shoulder apron, solid
// edge lines, brighter centre dash and (for city) a wet-asphalt sheen.
// "stars" adds a starfield; "sunDisc"/"moon" add a horizon light disc.
// ----------------------------------------------------------------------------
const KITS = {
  forest: {
    sky: ['#5f9fd8', '#93c6e4', '#cfe8c4', '#f0f4c8'], fog: [0xc9dcb8, 150, 640],
    hemi: [0xeef8d8, 0x3c5c30, 1.05], sun: [0xfff6cf, 1.25], sunPos: [150, 230, -80],
    ground: 0x578a42, road: [0.44, 0.41, 0.35], curbA: 0xe8e0c8, curbB: 0x3f8e4f,
    shoulder: [0.33, 0.47, 0.26], edge: [0.93, 0.9, 0.78], road2: true,
    sunDisc: { color: 0xfff2c8, r: 36, pos: [430, 300, -540] },
    banner: { bg: '#2e4a2a', stripe: '#66e8a0', text: '#eaffdc' },
  },
  city: {
    sky: ['#04061a', '#0d1230', '#2a1c4e', '#58306e'], fog: [0x141026, 140, 620],
    hemi: [0x9a8aff, 0x0e0a1c, 0.85], sun: [0x8a9aff, 0.7], sunPos: [-120, 160, 140],
    ground: 0x0d0f18, road: [0.2, 0.21, 0.26], curbA: 0xff5df1, curbB: 0x2fd8c8,
    shoulder: [0.05, 0.06, 0.1], edge: [0.85, 0.9, 1.0], road2: true, wet: true,
    stars: true,
    moon: { color: 0xdde4ff, r: 30, pos: [-520, 320, 260] },
    banner: { bg: '#101426', stripe: '#2fd8c8', text: '#9affff' },
  },
  // Volcanic ash field - Ashfall Run (the only non-flagship desert track).
  desert: {
    sky: ['#241f33', '#453650', '#7d5254', '#c98a58'], fog: [0x4a3c46, 130, 560],
    hemi: [0xd8b090, 0x2a2028, 0.95], sun: [0xffc088, 1.05], sunPos: [-160, 120, -140],
    ground: 0x574a44, road: [0.34, 0.31, 0.31], curbA: 0xff8a3c, curbB: 0x332c2e,
    shoulder: [0.28, 0.24, 0.22], edge: [0.9, 0.82, 0.68], road2: true,
    sunDisc: { color: 0xffb070, r: 46, pos: [-560, 170, -480] },
    banner: { bg: '#2a1c1e', stripe: '#ff8a3c', text: '#ffd9a8' },
  },
  mountain: {
    sky: ['#6aa0d8', '#a8c8e8', '#e8e0d0', '#f0e8d8'], fog: [0xc8d4e0, 150, 680],
    hemi: [0xe8f0ff, 0x6a7a8a, 1.0], sun: [0xfff8e8, 1.3], sunPos: [160, 260, 80],
    ground: 0x8a9078, road: [0.5, 0.48, 0.44], curbA: 0xd8d0c0, curbB: 0xb0483a,
  },
  volcano: {
    sky: ['#1a0a0a', '#3a1210', '#6a2410', '#a04818'], fog: [0x3a1810, 120, 520],
    hemi: [0xff8a50, 0x2a0a08, 0.85], sun: [0xff6a30, 1.0], sunPos: [-100, 160, -140],
    ground: 0x241412, road: [0.32, 0.24, 0.22], curbA: 0xff5d2a, curbB: 0x3a2a28,
  },
  underwater: {
    sky: ['#04182a', '#083858', '#0e5a80', '#1a7aa0'], fog: [0x0a4a68, 90, 460],
    hemi: [0x8ad0e8, 0x0a2a3a, 0.9], sun: [0xa0e0f0, 0.85], sunPos: [60, 240, 40],
    ground: 0x1a4a5a, road: [0.3, 0.42, 0.46], curbA: 0x40f0e0, curbB: 0x2a8fa8,
  },
  factory: {
    sky: ['#2a2622', '#4a4238', '#6a5c48', '#8a7a5c'], fog: [0x4a4238, 110, 500],
    hemi: [0xf0d8a0, 0x3a3228, 0.85], sun: [0xffd8a0, 1.0], sunPos: [100, 180, -120],
    ground: 0x3a3632, road: [0.38, 0.36, 0.34], curbA: 0xf0c820, curbB: 0x2b2530,
  },
  islands: {
    sky: ['#4da3e8', '#8ac8f0', '#d8ecf8', '#fff0d8'], fog: [0xcfe4f4, 160, 700],
    hemi: [0xfff0d8, 0x6a9ac8, 1.0], sun: [0xfff4d0, 1.25], sunPos: [140, 240, -80],
    ground: null, road: [0.72, 0.66, 0.5], curbA: 0xe8d8a8, curbB: 0x4a9e8a,
  },
  ruins: {
    sky: ['#5d94d0', '#a0c4e4', '#f0dcb8', '#ffdca0'], fog: [0xdcc8a0, 150, 640],
    hemi: [0xffe8c0, 0x8a6a48, 0.95], sun: [0xfff0c8, 1.2], sunPos: [130, 200, -90],
    ground: 0xc8a878, road: [0.62, 0.55, 0.44], curbA: 0xd8c8a8, curbB: 0x9c6b3c,
  },
  storm: {
    sky: ['#10141c', '#242c3a', '#3a4454', '#5a6472'], fog: [0x2c3440, 120, 540],
    hemi: [0xa0b0c8, 0x1a2028, 0.8], sun: [0xc8d4e8, 0.7], sunPos: [-80, 200, 60],
    ground: 0x3a4248, road: [0.36, 0.38, 0.42], curbA: 0xf0e04a, curbB: 0x2c3a44,
  },
  crystal: {
    sky: ['#0a0a1e', '#141438', '#241a54', '#3a2a6a'], fog: [0x1a1434, 90, 440],
    hemi: [0xb0a0ff, 0x141024, 0.85], sun: [0xc0b0ff, 0.9], sunPos: [80, 180, -100],
    ground: 0x181428, road: [0.34, 0.3, 0.44], curbA: 0xc8b0ff, curbB: 0x5a4a8a,
  },
  space: {
    sky: ['#000004', '#04060e', '#0a0c18', '#101420'], fog: [0x06080f, 200, 900],
    hemi: [0x8a9aff, 0x080a14, 0.7], sun: [0xdde4ff, 1.1], sunPos: [-120, 200, 140],
    ground: 0x10141c, road: [0.3, 0.32, 0.4], curbA: 0x66e8ff, curbB: 0x2a3a5a,
  },
};

function seeded(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// ----------------------------------------------------------------------------
// Shared builders (parameterized by kit)
// ----------------------------------------------------------------------------
function ribbon(group, samples, offsetA, offsetB, colorFn, closed, roadMat, yOff = 0.02) {
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

function buildSky(scene, group, kit) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  kit.sky.forEach((col, i) => grad.addColorStop(i / (kit.sky.length - 1), col));
  g.fillStyle = grad; g.fillRect(0, 0, 4, 512);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(860, 24, 16),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.BackSide, fog: false })
  );
  group.add(sky);
  scene.fog = new THREE.Fog(kit.fog[0], kit.fog[1], kit.fog[2]);
  const lightParent = kit.refinedRoad ? group : scene;
  lightParent.add(new THREE.HemisphereLight(kit.hemi[0], kit.hemi[1], kit.hemi[2]));
  const sun = new THREE.DirectionalLight(kit.sun[0], kit.sun[1]);
  sun.position.set(...kit.sunPos);
  lightParent.add(sun);
  lightParent.add(new THREE.AmbientLight(kit.hemi[0], 0.18));

  // optional starfield (night kits)
  if (kit.stars) {
    const n = 700;
    const arr = new Float32Array(n * 3);
    let s = 424242;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, b = Math.acos(2 * r() - 1);
      const rad = 760 + r() * 80;
      arr[i * 3] = rad * Math.sin(b) * Math.cos(a);
      arr[i * 3 + 1] = Math.abs(rad * Math.cos(b)) * 0.8 + 20;
      arr[i * 3 + 2] = rad * Math.sin(b) * Math.sin(a);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    group.add(new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xdde4ff, size: 1.5, sizeAttenuation: false, fog: false,
    })));
  }

  // optional sun/moon disc + halo on the horizon
  const discSpec = kit.sunDisc || kit.moon;
  if (discSpec) {
    const v = new THREE.Vector3(...discSpec.pos).normalize().multiplyScalar(800);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(discSpec.r, 24),
      new THREE.MeshBasicMaterial({ color: discSpec.color, fog: false })
    );
    disc.position.copy(v);
    disc.lookAt(0, 0, 0);
    group.add(disc);
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(discSpec.r * 2.1, 24),
      new THREE.MeshBasicMaterial({ color: discSpec.color, fog: false, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    halo.position.copy(v).multiplyScalar(0.999);
    halo.lookAt(0, 0, 0);
    group.add(halo);
  }
  return sun;
}

function buildRoad(group, track, kit) {
  const roadMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: kit.wet ? 0.58 : 0.95,
    metalness: kit.wet ? 0.12 : 0.0,
    side: kit.refinedRoad ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (kit.refinedRoad) {
    // World-space asphalt grain: no UV seams at the lap join. Opt-in only.
    roadMat.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 vRoadWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vRoadWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = 'varying vec3 vRoadWorld;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n float grain = fract(sin(dot(floor(vRoadWorld.xz * 24.0), vec2(12.9898,78.233))) * 43758.5453); diffuseColor.rgb *= 0.91 + grain * 0.09;');
    };
  }
  const S = track.samples;
  const hw = (sm) => sm.width / 2;
  const noise = (i) => (((i * 7919) % 13) / 13 - 0.5) * 0.05;
  const base = kit.road;

  // shoulder apron (flagship road2 kits)
  if (kit.road2) {
    const apronMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: kit.refinedRoad ? THREE.DoubleSide : THREE.FrontSide });
    for (const sideSign of [1, -1]) {
      ribbon(group, S,
        (sm) => sideSign * (hw(sm) + 2.8),
        (sm) => sideSign * (hw(sm) - 1.25),
        (sm, i) => {
          const v = 1 + noise(i + 2);
          return [kit.shoulder[0] * v, kit.shoulder[1] * v, kit.shoulder[2] * v];
        }, true, apronMat, 0.015);
    }
  }

  ribbon(group, S, (sm) => hw(sm) - 1.25, (sm) => -(hw(sm) - 1.25), (sm, i) => {
    const v = 1 + noise(i);
    return [base[0] * v, base[1] * v, base[2] * v];
  }, true, roadMat);
  const ca = new THREE.Color(kit.curbA), cb = new THREE.Color(kit.curbB);
  for (const sideSign of [1, -1]) {
    ribbon(group, S,
      (sm) => sideSign * hw(sm),
      (sm) => sideSign * (hw(sm) - 1.25),
      (sm, i) => {
        const c = Math.floor(sm.s / 3.5) % 2 === 0 ? ca : cb;
        return [c.r, c.g, c.b];
      }, true, roadMat, 0.03);
  }
  // solid edge lines just inside the curbs (flagship road2 kits)
  if (kit.road2) {
    const lineMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: kit.refinedRoad ? THREE.DoubleSide : THREE.FrontSide });
    for (const sideSign of [1, -1]) {
      ribbon(group, S,
        (sm) => sideSign * (hw(sm) - 1.6),
        (sm) => sideSign * (hw(sm) - 1.3),
        () => [kit.edge[0], kit.edge[1], kit.edge[2]], true, lineMat, 0.035);
    }
  }
  ribbon(group, S, () => 0.22, () => -0.22, (sm) => {
    const on = Math.floor(sm.s / 5) % 2 === 0;
    return on
      ? (kit.road2 ? [0.98, 0.96, 0.9] : [0.95, 0.92, 0.82])
      : [base[0] * 0.6, base[1] * 0.6, base[2] * 0.6];
  }, true, roadMat, 0.035);

  if (track.shortcut) {
    ribbon(group, track.shortcut.samples, () => track.shortcut.halfW, () => -track.shortcut.halfW,
      (sm, i) => {
        const v = 1 + noise(i + 3);
        return [base[0] * 1.1 * v, base[1] * 1.0 * v, base[2] * 0.85 * v];
      }, false, roadMat, 0.03);
  }
}

function buildFinishAndBanner(group, track, bannerText, kit) {
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

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x444a56, roughness: 0.7, metalness: 0.3 });
  for (const side of [1, -1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 7.2, 8), poleMat);
    pole.position.copy(fin.pos).addScaledVector(fin.right, side * (fin.width / 2 + 0.8));
    pole.position.y += 3.6;
    group.add(pole);
  }
  const ban = kit && kit.banner;
  const bc = document.createElement('canvas');
  bc.width = ban ? 1024 : 512;
  bc.height = ban ? 128 : 96;
  const bg = bc.getContext('2d');
  if (ban) {
    // flagship two-tone banner with diagonal stripes
    bg.fillStyle = ban.bg; bg.fillRect(0, 0, 1024, 128);
    bg.fillStyle = ban.stripe;
    for (let x = -60; x < 1080; x += 120) {
      bg.beginPath();
      bg.moveTo(x, 128); bg.lineTo(x + 34, 0); bg.lineTo(x + 56, 0); bg.lineTo(x + 22, 128);
      bg.closePath(); bg.fill();
    }
    bg.fillStyle = ban.stripe;
    bg.fillRect(0, 0, 1024, 6);
    bg.fillRect(0, 122, 1024, 6);
    bg.font = '900 76px "Trebuchet MS", sans-serif';
    bg.textAlign = 'center'; bg.textBaseline = 'middle';
    bg.fillStyle = 'rgba(0,0,0,0.55)';
    bg.fillText(bannerText, 515, 68);
    bg.fillStyle = ban.text;
    bg.fillText(bannerText, 512, 64);
  } else {
    bg.fillStyle = '#20304a'; bg.fillRect(0, 0, 512, 96);
    bg.fillStyle = '#8ae0ff'; bg.font = '900 48px "Trebuchet MS", sans-serif';
    bg.textAlign = 'center'; bg.textBaseline = 'middle';
    bg.fillText(bannerText, 256, 50);
  }
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(fin.width + 1.6, 2.2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bc), side: THREE.DoubleSide })
  );
  banner.position.copy(fin.pos).setY(fin.pos.y + 6.4);
  banner.rotation.y = yawFor(fin.dir) + (kit?.refinedRoad ? Math.PI : 0);
  group.add(banner);
}

function buildRampsAndPads(group, track, state) {
  for (const r of track.ramps) {
    group.add(createRampVisual(track, r, {
      surface: 0x747b8d,
      shoulder: 0x5c6270,
      side: 0x373b46,
      stripe: 0xffe08a,
    }));
  }

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
      const sc = track.shortcut.samples;
      const idx = Math.min(sc.length - 1, Math.floor(pad.scFrac * sc.length));
      const sm = sc[idx];
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.2, pad.halfW * 2),
        new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.95 }));
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
}

function buildTunnel(group, track, colliders, palette, theme, state) {
  if (!track.tunnelRange) return;
  const mat = new THREE.MeshStandardMaterial({ color: palette, roughness: 0.9, flatShading: true });
  const mat2 = new THREE.MeshStandardMaterial({ color: (palette & 0xffffff) * 0.8, roughness: 0.9, flatShading: true });
  // adaptive arch spacing so short tunnels still get several ribs
  const span = track.tunnelRange[1] - track.tunnelRange[0];
  const step = Math.max(3, Math.min(6.5, span / 4));
  const neonStrips = [];
  for (let s = track.tunnelRange[0]; s <= track.tunnelRange[1]; s += step) {
    const p = track.pointAt(s);
    const yaw = yawFor(p.dir);
    for (const side of [1, -1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 7, 1.4), mat);
      pillar.position.copy(p.pos).addScaledVector(p.right, side * (p.width / 2 + 1.1));
      pillar.position.y += 3.4;
      pillar.rotation.y = yaw;
      group.add(pillar);
      colliders.push(new THREE.Box3().setFromObject(pillar));
      // desert basalt ribs / forest moss cap on the pillar
      if (theme === 'desert') {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8.5, 0.5), mat2);
        rib.position.copy(pillar.position);
        rib.position.y += 0.6;
        rib.rotation.y = yaw;
        group.add(rib);
      } else if (theme === 'forest') {
        const moss = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.4, 6),
          new THREE.MeshStandardMaterial({ color: 0x4f8e4f, roughness: 1, flatShading: true }));
        moss.position.copy(pillar.position);
        moss.position.y += 4.1;
        group.add(moss);
      }
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(p.width + 4.4, 1.5, 1.9), mat);
    beam.position.copy(p.pos);
    beam.position.y += 7.2;
    beam.rotation.y = yaw;
    group.add(beam);
    colliders.push(new THREE.Box3().setFromObject(beam));
    if (theme === 'forest') {
      // leafy canopy crowning each arch
      for (const k of [-0.5, 0, 0.5]) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.6, 7),
          new THREE.MeshStandardMaterial({ color: k === 0 ? 0x57a85a : 0x3f8e4f, roughness: 1, flatShading: true }));
        leaf.position.copy(beam.position);
        leaf.position.addScaledVector(p.right, k * (p.width / 2));
        leaf.position.y += 1.4;
        group.add(leaf);
      }
    } else if (theme === 'city') {
      // under-beam neon strip, colour-cycled at runtime
      const stripMat = new THREE.MeshBasicMaterial({ color: 0x2fd8c8, transparent: true, opacity: 0.95 });
      const strip = new THREE.Mesh(new THREE.BoxGeometry(p.width + 3.6, 0.28, 0.28), stripMat);
      strip.position.copy(beam.position);
      strip.position.y -= 0.9;
      strip.rotation.y = yaw;
      group.add(strip);
      neonStrips.push(stripMat);
    }
  }
  if (neonStrips.length) {
    const a = new THREE.Color(0x2fd8c8), b = new THREE.Color(0xff5df1), tmp = new THREE.Color();
    state.extras.push((dt, time) => {
      for (let i = 0; i < neonStrips.length; i++) {
        tmp.copy(a).lerp(b, 0.5 + 0.5 * Math.sin(time * 0.9 + i * 0.8));
        neonStrips[i].color.copy(tmp);
      }
    });
  }
}

function buildCanyon(group, track, rockColor) {
  if (!track.canyonRange) return;
  let seed = 17;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const mats = [rockColor, rockColor * 0.92, rockColor * 1.08].map((c) =>
    new THREE.MeshStandardMaterial({ color: Math.floor(c), roughness: 1, flatShading: true }));
  for (let s = track.canyonRange[0]; s <= track.canyonRange[1]; s += 7) {
    const p = track.pointAt(s);
    for (const side of [1, -1]) {
      if (rnd() < 0.12) continue;
      const h = 8 + rnd() * 11;
      const cliff = new THREE.Mesh(
        new THREE.BoxGeometry(5 + rnd() * 5, h, 4 + rnd() * 4),
        mats[Math.floor(rnd() * 3)]
      );
      cliff.position.copy(p.pos).addScaledVector(p.right, side * (p.width / 2 + 6 + rnd() * 5));
      cliff.position.y = p.pos.y + h / 2 - 2;
      cliff.rotation.y = rnd() * Math.PI;
      group.add(cliff);
    }
  }
}

// Obstacle meshes are built from the SAME profile table the collision system
// reads (OBSTACLE_PROFILE in track.js). Nothing here is a magic number: change
// the profile and both the visible geometry and the hitbox move together.
function buildObstacles(group, track, state) {
  state.obstacleMeshes = [];
  for (const o of track.obstacles) {
    const prof = o.profile || OBSTACLE_PROFILE[o.type];
    if (o.type === 'gear') {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x5a6070, roughness: 0.55, metalness: 0.45 });
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(prof.hubRadius, prof.hubRadius, prof.hubHeight, 14), mat);
      g.add(hub);
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(o.armRadius * 2, prof.armHeight, prof.armDepth), mat);
      arm.position.y = prof.armLift;
      g.add(arm);
      for (const side of [1, -1]) {
        const tip = new THREE.Mesh(new THREE.SphereGeometry(prof.tipRadius, 10, 8), mat);
        tip.position.set(side * o.armRadius, prof.armLift, 0);
        g.add(tip);
      }
      g.position.copy(o.center); g.position.y += prof.lift;
      group.add(g);
      state.obstacleMeshes.push({ mesh: g, obstacle: o });
    } else if (o.type === 'slider' || o.type === 'pendulum') {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(o.radius * prof.boxScale, prof.height, o.radius * prof.boxScale),
        new THREE.MeshStandardMaterial({ color: o.type === 'pendulum' ? 0x8a4a4a : 0x707a88, roughness: 0.8, flatShading: true })
      );
      mesh.position.copy(o.pos);
      group.add(mesh);
      state.obstacleMeshes.push({ mesh, obstacle: o });
    } else if (o.type === 'flamejet') {
      const nozzle = new THREE.Mesh(
        new THREE.CylinderGeometry(prof.nozzleRadiusTop, prof.nozzleRadiusBottom, prof.nozzleHeight, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.6, metalness: 0.5 }));
      nozzle.position.copy(o.pos); nozzle.position.y += prof.nozzleLift;
      group.add(nozzle);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(flameHazardRadius(o.radius), prof.flameHeight, 8),
        new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.position.copy(o.pos); flame.position.y += prof.flameLift;
      group.add(flame);
      // Tarmac ring marking the exact burn footprint of the jet.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(flameHazardRadius(o.radius) * 0.86, flameHazardRadius(o.radius), 24),
        new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(o.pos); ring.position.y += 0.06;
      group.add(ring);
      state.obstacleMeshes.push({ mesh: flame, obstacle: o, isFlame: true, ring });
    }
  }
}

// ----------------------------------------------------------------------------
// Theme props - environmental storytelling per world
// ----------------------------------------------------------------------------
const PROPS = {
  forest(group, track, rnd) {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2e, roughness: 1 });
    const trunkMat2 = new THREE.MeshStandardMaterial({ color: 0x5c4228, roughness: 1 });
    const leafMats = [0x3f8e4f, 0x57a85a, 0x2f7a3f, 0x6cb863].map((c) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
    // two-storey trees: tapered crown + lower skirt reads as a real canopy
    for (let i = 0; i < 44; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 8 + rnd() * 34;
      const t = new THREE.Group();
      const h = 3 + rnd() * 4;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, h, 6), rnd() > 0.5 ? trunkMat : trunkMat2);
      trunk.position.y = h / 2;
      t.add(trunk);
      const r1 = 2.2 + rnd() * 1.8;
      const skirt = new THREE.Mesh(new THREE.ConeGeometry(r1 * 1.25, 2.6 + rnd() * 1.6, 7), leafMats[i % 4]);
      skirt.position.y = h + 0.8;
      t.add(skirt);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(r1 * 0.8, 3 + rnd() * 2.4, 7), leafMats[(i + 2) % 4]);
      crown.position.y = h + 2.6 + rnd() * 1.2;
      t.add(crown);
      t.position.copy(p.pos).addScaledVector(p.right, side * dist);
      group.add(t);
    }
    // mushroom ring (instanced stem + cap)
    const N = 34;
    const stemGeo = new THREE.CylinderGeometry(0.09, 0.13, 0.5, 5);
    const capGeo = new THREE.ConeGeometry(0.42, 0.34, 7);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.9 });
    const capMats = [0xe05a4a, 0xe8a04a, 0xd8d8e8].map((c) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true }));
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, N);
    const caps = new THREE.InstancedMesh(capGeo, capMats[0], N);
    const d = new THREE.Object3D();
    for (let i = 0; i < N; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 5 + rnd() * 16;
      const sz = 0.7 + rnd() * 1.1;
      d.position.copy(p.pos).addScaledVector(p.right, side * dist);
      d.position.y += 0.25 * sz;
      d.scale.setScalar(sz);
      d.rotation.set(0, rnd() * Math.PI * 2, 0);
      d.updateMatrix();
      stems.setMatrixAt(i, d.matrix);
      d.position.y += 0.42 * sz;
      d.updateMatrix();
      caps.setMatrixAt(i, d.matrix);
      caps.setColorAt(i, new THREE.Color(capMats[i % 3].color));
    }
    stems.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    group.add(stems, caps);
    // ferns + wildflowers (instanced)
    const fernGeo = new THREE.ConeGeometry(0.5, 0.9, 6);
    const fernMat = new THREE.MeshStandardMaterial({ color: 0x4fa85f, roughness: 1, flatShading: true });
    const N_F = 36;
    const ferns = new THREE.InstancedMesh(fernGeo, fernMat, N_F);
    const flGeo = new THREE.SphereGeometry(0.16, 6, 5);
    const flMats = [0xffd24a, 0xff8aa0, 0xffffff, 0xc88aff].map((c) => new THREE.Color(c));
    const flowers = new THREE.InstancedMesh(flGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), N_F + 14);
    for (let i = 0; i < N_F; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 4 + rnd() * 20;
      d.position.copy(p.pos).addScaledVector(p.right, side * dist);
      d.position.y += 0.3;
      d.scale.set(0.7 + rnd() * 0.9, 0.7 + rnd() * 0.9, 0.7 + rnd() * 0.9);
      d.rotation.set(0, rnd() * Math.PI * 2, 0);
      d.updateMatrix();
      ferns.setMatrixAt(i, d.matrix);
    }
    ferns.instanceMatrix.needsUpdate = true;
    group.add(ferns);
    for (let i = 0; i < N_F + 14; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 3 + rnd() * 24;
      d.position.copy(p.pos).addScaledVector(p.right, side * dist);
      d.position.y += 0.35;
      d.scale.setScalar(0.8 + rnd() * 0.8);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      flowers.setMatrixAt(i, d.matrix);
      flowers.setColorAt(i, flMats[Math.floor(rnd() * 4)]);
    }
    flowers.instanceMatrix.needsUpdate = true;
    group.add(flowers);
  },
  city(group, track, rnd) {
    // shared lit-window facade texture (deterministic per build)
    const wc = document.createElement('canvas');
    wc.width = 96; wc.height = 192;
    const wg = wc.getContext('2d');
    wg.fillStyle = '#070910'; wg.fillRect(0, 0, 96, 192);
    const winCols = ['#8ae0ff', '#ffd24a', '#ff5df1', '#40f0e0', '#a8b0c0'];
    let ws = 987654321;
    const wr = () => (ws = (ws * 16807) % 2147483647) / 2147483647;
    for (let row = 0; row < 22; row++) {
      for (let col = 0; col < 9; col++) {
        const lit = wr() < 0.42;
        wg.fillStyle = lit ? winCols[Math.floor(wr() * winCols.length)] : '#10131e';
        wg.fillRect(col * 10 + 2, row * 8 + 2, 6, 5);
      }
    }
    const winTex = new THREE.CanvasTexture(wc);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x14162a, roughness: 0.6, metalness: 0.35 });
    const neonCols = [0xff5df1, 0x2fd8c8, 0x4aa8ff, 0xffd24a];
    const neonMats = neonCols.map((c) => new THREE.MeshBasicMaterial({ color: c }));
    for (let i = 0; i < 42; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 14 + rnd() * 44;
      const h = 14 + rnd() * 46;
      const w = 5 + rnd() * 8;
      // tower rotated so local +Z = road-right: road-facing facades then sit
      // at exact, constant local offsets instead of arbitrary world angles
      const tw = new THREE.Group();
      tw.position.copy(p.pos).addScaledVector(p.right, side * dist);
      tw.position.y += h / 2;
      tw.rotation.y = yawFor(p.right);
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), towerMat);
      tw.add(body);
      // lit window facades on the road-facing side and one flank
      const fz = side > 0 ? -1 : 1;
      const win1 = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.82, h * 0.94),
        new THREE.MeshBasicMaterial({ map: winTex }));
      win1.position.set(0, 0, fz * (w / 2 + 0.06));
      if (fz < 0) win1.rotation.y = Math.PI;
      tw.add(win1);
      const win2 = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.82, h * 0.94),
        new THREE.MeshBasicMaterial({ map: winTex }));
      win2.position.set((rnd() > 0.5 ? 1 : -1) * (w / 2 + 0.06), 0, 0);
      win2.rotation.y = (rnd() > 0.5 ? 1 : -1) * Math.PI / 2;
      tw.add(win2);
      group.add(tw);
      // neon edge strip + antenna
      const nm = neonMats[Math.floor(rnd() * neonMats.length)];
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, h, 0.3), nm);
      strip.position.set(fz * (w / 2 + 0.15) * 0.86, 0, fz * (w / 2 + 0.15) * 0.5);
      tw.add(strip);
      if (rnd() > 0.45) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 6 + rnd() * 6, 5), towerMat);
        ant.position.y = h / 2 + 3;
        tw.add(ant);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 5), neonMats[2]);
        tip.position.y = h / 2 + 6;
        tw.add(tip);
      }
    }
  },
  // Volcanic ash field for Ashfall Run — REFINED ASHFALL IDENTITY
  // Black-glass dunes, cooled basalt, quenched tarn and ember flora.
  desert(group, track, rnd) {
    const spireMat = new THREE.MeshStandardMaterial({ color: 0x1c1a20, roughness: 0.85, flatShading: true });
    const spireMat2 = new THREE.MeshStandardMaterial({ color: 0x221e28, roughness: 0.88, flatShading: true });
    const basaltMat = new THREE.MeshStandardMaterial({ color: 0x2e2a30, roughness: 0.95, flatShading: true });
    const ashMat = new THREE.MeshStandardMaterial({ color: 0x6a5f5c, roughness: 1 });
    const ashMatLight = new THREE.MeshStandardMaterial({ color: 0x7a6e6b, roughness: 1 });
    const emberMat = new THREE.MeshStandardMaterial({ color: 0x8a3a1a, roughness: 0.9, emissive: 0xff4a1a, emissiveIntensity: 0.12 });
    // obsidian spires — taller, sharper, with glass shards
    for (let i = 0; i < 28; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      if (Math.abs((s/track.L)-0.32) < 0.05) continue; // keep tarn clear
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 10 + rnd() * 32;
      const h = 6 + rnd() * 13;
      const mat = rnd()>0.5 ? spireMat : spireMat2;
      const spire = new THREE.Mesh(new THREE.ConeGeometry(1.1 + rnd() * 2.4, h, 5), mat);
      spire.position.copy(p.pos).addScaledVector(p.right, side * dist);
      spire.position.y = p.pos.y + h / 2 - 1.1;
      spire.rotation.z = (rnd() - 0.5) * 0.30;
      spire.rotation.y = rnd() * Math.PI;
      group.add(spire);
      // glass shard at base
      if (rnd()>0.6) {
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.6+ rnd()*0.7,0), new THREE.MeshStandardMaterial({ color: 0x111016, roughness:0.35, metalness:0.35 }));
        shard.position.copy(spire.position); shard.position.y = p.pos.y + 0.12;
        shard.rotation.set(rnd()*Math.PI, rnd()*Math.PI, rnd()*Math.PI);
        group.add(shard);
      }
    }
    // basalt column field (instanced hex columns) — denser
    const colGeo = new THREE.CylinderGeometry(0.9, 1.3, 1, 6);
    const N_C = 36;
    const cols = new THREE.InstancedMesh(colGeo, basaltMat, N_C);
    const d = new THREE.Object3D();
    for (let i = 0; i < N_C; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      if (Math.abs((s/track.L)-0.32) < 0.05) { i--; continue; }
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 12 + rnd() * 36;
      const h = 2.8 + rnd() * 8;
      d.position.copy(p.pos).addScaledVector(p.right, side * dist);
      d.position.y = p.pos.y + h / 2 - 0.9;
      d.scale.set(0.68 + rnd() * 0.95, h, 0.68 + rnd() * 0.95);
      d.rotation.set(0, rnd() * Math.PI, 0);
      d.updateMatrix();
      cols.setMatrixAt(i, d.matrix);
    }
    cols.instanceMatrix.needsUpdate = true;
    group.add(cols);
    // ash mounds (instanced flattened spheres) + scorched tufts
    const moundGeo = new THREE.SphereGeometry(1, 8, 6);
    const N_M = 26;
    const mounds = new THREE.InstancedMesh(moundGeo, ashMat, N_M);
    for (let i = 0; i < N_M; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      if (Math.abs((s/track.L)-0.32) < 0.045) { i--; continue; }
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 9 + rnd() * 32;
      const r = 4.5 + rnd() * 9;
      d.position.copy(p.pos).addScaledVector(p.right, side * dist);
      d.position.y = p.pos.y - r * 0.22;
      d.scale.set(r, r * 0.32, r * 0.82);
      d.rotation.set(0, rnd() * Math.PI, 0);
      d.updateMatrix();
      mounds.setMatrixAt(i, d.matrix);
    }
    mounds.instanceMatrix.needsUpdate = true;
    group.add(mounds);
    // glowing lava cracks hugging the road + ember bloom strips
    const crackMat = new THREE.MeshBasicMaterial({
      color: 0xff5d1a, transparent: true, opacity: 0.58,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const crackMat2 = new THREE.MeshBasicMaterial({
      color: 0xff8a24, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < 12; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 2.8 + rnd() * 6.5;
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 7 + rnd() * 9), crackMat);
      crack.rotation.x = -Math.PI / 2;
      crack.rotation.z = Math.atan2(-p.dir.z, p.dir.x) + (rnd() - 0.5) * 0.45;
      crack.position.copy(p.pos).addScaledVector(p.right, side * dist);
      crack.position.y += 0.07;
      group.add(crack);
      if (rnd()>0.5){
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 7+ rnd()*9), crackMat2);
        glow.rotation.x = -Math.PI/2;
        glow.rotation.z = crack.rotation.z;
        glow.position.copy(crack.position); glow.position.y += 0.02;
        group.add(glow);
      }
    }
    // cooled lava river ribbon along inner canyon bend (subtle)
    {
      const riverMat = new THREE.MeshStandardMaterial({ color: 0x1a1214, roughness: 0.9 });
      const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff5d1a, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite:false });
      for(let s= track.L*0.58; s< track.L*0.78; s+= 7){
        const p = track.pointAt(s);
        const side = 1;
        const center = p.pos.clone().addScaledVector(p.right, side*(p.width/2 + 9));
        center.y = p.pos.y - 1.1;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(4, 0.6, 7), riverMat);
        seg.position.copy(center); seg.rotation.y = Math.atan2(p.dir.x, p.dir.z);
        group.add(seg);
        const flow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 6), lavaMat);
        flow.rotation.x = -Math.PI/2; flow.rotation.z = seg.rotation.y;
        flow.position.copy(center); flow.position.y += 0.32;
        group.add(flow);
      }
    }
    // scorched flora: charcoal shrubs, ash-column pines, ember flowers
    const charShrubMat = new THREE.MeshStandardMaterial({ color: 0x3a2f2a, roughness:1 });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x2e2a28, roughness:1 });
    const flowerCols = [0xff6a3c, 0xffb84a, 0xff8ae8, 0xa0e8ff].map(c=> new THREE.MeshBasicMaterial({color:c}));
    for(let i=0;i<18;i++){
      const s = rnd()*track.L; const p = track.pointAt(s);
      if (Math.abs((s/track.L)-0.32) < 0.06) continue;
      const side = rnd()>0.5?1:-1; const dist = p.width/2 + 8 + rnd()*24;
      const base = p.pos.clone().addScaledVector(p.right, side*dist);
      if (rnd()>0.5){
        // charcoal pine
        const h = 2.5 + rnd()*3.2;
        const pine = new THREE.Mesh(new THREE.ConeGeometry(0.85, h, 6), pineMat);
        pine.position.copy(base); pine.position.y = p.pos.y + h/2 -0.4;
        group.add(pine);
      } else {
        // shrub
        const sh = new THREE.Mesh(new THREE.SphereGeometry(0.55+ rnd()*0.5,6,5), charShrubMat);
        sh.scale.y = 0.65; sh.position.copy(base); sh.position.y = p.pos.y + 0.28;
        group.add(sh);
      }
      if (rnd()>0.65){
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.13,5,4), flowerCols[Math.floor(rnd()*4)]);
        fl.position.copy(base); fl.position.y = p.pos.y + 0.42 + rnd()*0.2;
        fl.position.x += (rnd()-0.5)*0.6; fl.position.z += (rnd()-0.5)*0.6;
        group.add(fl);
      }
    }
    // ashfall particulate veil — subtle fog sheets
    {
      const veilMat = new THREE.MeshBasicMaterial({ color: 0x6a5f5c, transparent:true, opacity:0.07, depthWrite:false, side: THREE.DoubleSide });
      for(let i=0;i<3;i++){
        const veil = new THREE.Mesh(new THREE.PlaneGeometry(420, 90), veilMat);
        veil.position.set((rnd()-0.5)*180, 16 + rnd()*14, (rnd()-0.5)*180);
        veil.rotation.y = rnd()*Math.PI;
        group.add(veil);
      }
    }
  },
  mountain(group, track, rnd) {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a8088, roughness: 1, flatShading: true });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xf0f4f8, roughness: 0.9, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 20 + rnd() * 60;
      const h = 20 + rnd() * 40;
      const peak = new THREE.Mesh(new THREE.ConeGeometry(10 + rnd() * 14, h, 6), rockMat);
      peak.position.copy(p.pos).addScaledVector(p.right, side * dist);
      peak.position.y = p.pos.y + h / 2 - 4;
      group.add(peak);
      const cap = new THREE.Mesh(new THREE.ConeGeometry((10 + rnd() * 14) * 0.35, h * 0.3, 6), snowMat);
      cap.position.copy(peak.position); cap.position.y += h * 0.36;
      group.add(cap);
    }
  },
  volcano(group, track, rnd) {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x241a18, roughness: 1, flatShading: true });
    const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff5d1a });
    for (let i = 0; i < 30; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 10 + rnd() * 34;
      if (i % 4 === 0) {
        const pool = new THREE.Mesh(new THREE.CircleGeometry(2.5 + rnd() * 3, 12), lavaMat);
        pool.rotation.x = -Math.PI / 2;
        pool.position.copy(p.pos).addScaledVector(p.right, side * dist);
        pool.position.y = p.pos.y + 0.1;
        group.add(pool);
      } else {
        const h = 4 + rnd() * 9;
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.8 + rnd(), 1.4 + rnd(), h, 6), rockMat);
        col.position.copy(p.pos).addScaledVector(p.right, side * dist);
        col.position.y = p.pos.y + h / 2 - 1;
        group.add(col);
      }
    }
  },
  underwater(group, track, rnd) {
    const coralCols = [0xff8aa0, 0x40f0e0, 0xffd24a, 0x8aff6a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, flatShading: true }));
    for (let i = 0; i < 54; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 8 + rnd() * 26;
      const coral = new THREE.Group();
      const n = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const h = 1.2 + rnd() * 3;
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.35 + rnd() * 0.4, h, 5), coralCols[Math.floor(rnd() * 4)]);
        c.position.set((rnd() - 0.5) * 1.6, h / 2, (rnd() - 0.5) * 1.6);
        c.rotation.set((rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4);
        coral.add(c);
      }
      coral.position.copy(p.pos).addScaledVector(p.right, side * dist);
      group.add(coral);
    }
  },
  factory(group, track, rnd) {
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x5a5248, roughness: 0.5, metalness: 0.6 });
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x7a6a48, roughness: 0.9 });
    for (let i = 0; i < 40; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 7 + rnd() * 22;
      if (i % 3 === 0) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 8 + rnd() * 10, 8), pipeMat);
        pipe.rotation.z = Math.PI / 2;
        pipe.rotation.y = yawFor(p.dir);
        pipe.position.copy(p.pos).addScaledVector(p.right, side * dist);
        pipe.position.y += 2.5 + rnd() * 3;
        group.add(pipe);
      } else {
        const sz = 1 + rnd() * 1.8;
        const crate = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), crateMat);
        crate.position.copy(p.pos).addScaledVector(p.right, side * dist);
        crate.position.y += sz / 2;
        crate.rotation.y = rnd() * Math.PI;
        group.add(crate);
      }
    }
  },
  islands(group, track, rnd) {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a6f52, roughness: 1, flatShading: true });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x5aa85a, roughness: 1, flatShading: true });
    for (let i = 0; i < 34; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 12 + rnd() * 36;
      const isl = new THREE.Group();
      const r = 3 + rnd() * 6;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.75, 1.4, 7), grassMat);
      const bottom = new THREE.Mesh(new THREE.ConeGeometry(r * 0.75, r * 1.6, 7), rockMat);
      bottom.rotation.x = Math.PI;
      bottom.position.y = -r * 0.8 - 0.6;
      isl.add(top, bottom);
      isl.position.copy(p.pos).addScaledVector(p.right, side * dist);
      isl.position.y = p.pos.y - 6 - rnd() * 14;
      group.add(isl);
    }
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xfff6e6, fog: false, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 8; i++) {
      const cl = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), cloudMat);
      const a = (i / 8) * Math.PI * 2;
      cl.position.set(Math.cos(a) * (300 + i * 30), 90 + (i % 3) * 30, Math.sin(a) * (300 + i * 30));
      cl.scale.set(30 + i * 5, 8, 14 + i * 2);
      group.add(cl);
    }
  },
  ruins(group, track, rnd) {
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb09878, roughness: 0.95, flatShading: true });
    for (let i = 0; i < 44; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 6 + rnd() * 20;
      if (i % 3 === 0) {
        const h = 4 + rnd() * 4;
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, h, 8), stoneMat);
        col.position.copy(p.pos).addScaledVector(p.right, side * dist);
        col.position.y += h / 2 - 0.5;
        col.rotation.z = (rnd() - 0.5) * 0.12;
        group.add(col);
      } else {
        const blk = new THREE.Mesh(new THREE.BoxGeometry(1.5 + rnd() * 2, 1 + rnd() * 1.6, 1.5 + rnd() * 2), stoneMat);
        blk.position.copy(p.pos).addScaledVector(p.right, side * dist);
        blk.position.y += 0.4;
        blk.rotation.y = rnd() * Math.PI;
        group.add(blk);
      }
    }
  },
  storm(group, track, rnd) {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2c3238, roughness: 1, flatShading: true });
    for (let i = 0; i < 36; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 10 + rnd() * 34;
      const h = 3 + rnd() * 8;
      const spire = new THREE.Mesh(new THREE.ConeGeometry(1 + rnd() * 2, h, 5), rockMat);
      spire.position.copy(p.pos).addScaledVector(p.right, side * dist);
      spire.position.y += h / 2 - 1;
      spire.rotation.z = (rnd() - 0.5) * 0.2;
      group.add(spire);
    }
  },
  crystal(group, track, rnd) {
    const crysCols = [0xc8b0ff, 0x8ad0ff, 0xff9af5, 0xbaffec].map((c) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.2, metalness: 0.1, emissive: c, emissiveIntensity: 0.35, flatShading: true }));
    for (let i = 0; i < 50; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 5 + rnd() * 20;
      const cluster = new THREE.Group();
      const n = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const h = 1.5 + rnd() * 4;
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.5 + rnd() * 0.6, 0), crysCols[Math.floor(rnd() * 4)]);
        c.scale.y = 2 + rnd() * 2;
        c.position.set((rnd() - 0.5) * 1.8, h / 2, (rnd() - 0.5) * 1.8);
        c.rotation.set((rnd() - 0.5) * 0.5, rnd() * Math.PI, (rnd() - 0.5) * 0.5);
        cluster.add(c);
      }
      cluster.position.copy(p.pos).addScaledVector(p.right, side * dist);
      group.add(cluster);
    }
  },
  space(group, track, rnd) {
    // starfield
    const starGeo = new THREE.BufferGeometry();
    const n = 900;
    const posArr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, b = Math.acos(2 * rnd() - 1);
      const r = 700 + rnd() * 120;
      posArr[i * 3] = r * Math.sin(b) * Math.cos(a);
      posArr[i * 3 + 1] = Math.abs(r * Math.cos(b)) * 0.7 + 20;
      posArr[i * 3 + 2] = r * Math.sin(b) * Math.sin(a);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdde4ff, size: 1.6, sizeAttenuation: false, fog: false }));
    group.add(stars);
    // nearby planet
    const planet = new THREE.Mesh(new THREE.SphereGeometry(90, 24, 18),
      new THREE.MeshStandardMaterial({ color: 0x4a6a9a, roughness: 0.8 }));
    planet.position.set(420, 180, -460);
    group.add(planet);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(130, 6, 6, 40),
      new THREE.MeshStandardMaterial({ color: 0x8a9ac8, roughness: 0.6 }));
    ring.position.copy(planet.position);
    ring.rotation.x = Math.PI / 2.4;
    group.add(ring);
    // station ribs over the road
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x3a4254, roughness: 0.5, metalness: 0.6 });
    for (let s = 0; s < track.L; s += track.L / 8) {
      const p = track.pointAt(s);
      const rib = new THREE.Mesh(new THREE.TorusGeometry(p.width / 2 + 3, 0.5, 6, 14, Math.PI), ribMat);
      rib.position.copy(p.pos); rib.position.y += 0.5;
      rib.rotation.y = yawFor(p.dir);
      group.add(rib);
    }
    // antenna + dock towers along the hull
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x2c3444, roughness: 0.5, metalness: 0.55 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff5d5d });
    for (let i = 0; i < 14; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 10 + rnd() * 26;
      const h = 6 + rnd() * 12;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 1.6), towerMat);
      tower.position.copy(p.pos).addScaledVector(p.right, side * dist);
      tower.position.y += h / 2 - 1;
      group.add(tower);
      const blink = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5), lightMat);
      blink.position.copy(tower.position); blink.position.y += h / 2 + 0.4;
      group.add(blink);
    }
  },
};

// ----------------------------------------------------------------------------
// Per-track FLAVORS - signature landmarks for the four flagship themed
// circuits. Receive (group, track, rnd, state, colliders); animated parts
// register update fns on state.extras.
// ----------------------------------------------------------------------------
function makeSignTexture(text, colorHex) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#05060c'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = colorHex;
  g.fillRect(0, 0, 256, 10); g.fillRect(0, 118, 256, 10);
  g.fillRect(0, 0, 10, 128); g.fillRect(246, 0, 10, 128);
  g.fillStyle = colorHex;
  g.fillRect(0, 26, 256, 4); g.fillRect(0, 98, 256, 4);
  g.font = '900 62px "Trebuchet MS", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 64);
  return new THREE.CanvasTexture(c);
}

const FLAVORS = {
  // ----------------------------------------------------------- ashfall_run — REFORGED ASHFALL IDENTITY
  // Volcanic glass desert, quenched tarn with reactive water, ember wildlife
  ashfall_run(group, track, rnd, state, colliders) {
    // ensure puddle container exists for main-loop water handling (mirrors Sunforge)
    state.puddles = state.puddles || [];
    state.ripples = state.ripples || [];
    const p0 = track.pointAt(track.L * 0.7);
    const vx = p0.pos.x + p0.right.x * 130;
    const vz = p0.pos.z + p0.right.z * 130;
    // distant volcano with glowing crater + rising smoke — more detailed rim
    const volc = new THREE.Mesh(new THREE.ConeGeometry(75, 115, 9),
      new THREE.MeshStandardMaterial({ color: 0x241c1e, roughness: 1, flatShading: true }));
    volc.position.set(vx, 57, vz);
    group.add(volc);
    // rim torus
    const rim = new THREE.Mesh(new THREE.TorusGeometry(24, 3.2, 8, 18),
      new THREE.MeshStandardMaterial({ color: 0x1e1a22, roughness: 0.9 }));
    rim.rotation.x = Math.PI/2; rim.position.set(vx, 110, vz); group.add(rim);
    const crater = new THREE.Mesh(new THREE.CircleGeometry(24, 16),
      new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    crater.rotation.x = -Math.PI / 2;
    crater.position.set(vx, 112, vz);
    group.add(crater);
    // inner magma pool glow
    const innerGlow = new THREE.Mesh(new THREE.CircleGeometry(12, 16), new THREE.MeshBasicMaterial({ color: 0xff8a24, transparent:true, opacity:0.42, blending: THREE.AdditiveBlending, depthWrite:false }));
    innerGlow.rotation.x = -Math.PI/2; innerGlow.position.set(vx, 112.2, vz); group.add(innerGlow);
    const smokes = [];
    for (let i = 0; i < 5; i++) {
      const smMat = new THREE.MeshStandardMaterial({ color: 0x3a3238, transparent: true, opacity: 0.55, flatShading: true });
      const sm = new THREE.Mesh(new THREE.SphereGeometry(8 + i * 2.4, 7, 6), smMat);
      sm.position.set(vx, 122 + i * 13, vz);
      group.add(sm);
      smokes.push({ m: sm, y0: 122 + i * 13, ph: rnd() * 6, x0: vx });
    }
    // ash veil sheets drifting across caldera
    const veilMat = new THREE.MeshBasicMaterial({ color: 0x5a4a44, transparent:true, opacity:0.09, depthWrite:false, side: THREE.DoubleSide });
    const veils = [];
    for(let i=0;i<2;i++){ const veil = new THREE.Mesh(new THREE.PlaneGeometry(140, 70), veilMat); veil.position.set(vx + (rnd()-0.5)*60, 88+ rnd()*12, vz + (rnd()-0.5)*60); veil.rotation.y = rnd()*Math.PI; veils.push(veil); group.add(veil); }
    state.extras.push((dt, time) => {
      const pulse = 0.75 + Math.sin(time * 1.4) * 0.25;
      crater.material.opacity = 0.6 + pulse * 0.35;
      crater.scale.setScalar(0.9 + pulse * 0.15);
      innerGlow.material.opacity = 0.34 + pulse*0.16;
      for (const sm of smokes) {
        sm.m.position.y = sm.y0 + ((time * 3 + sm.ph * 10) % 55);
        sm.m.position.x = sm.x0 + Math.sin(time * 0.4 + sm.ph) * 6;
        const f = (sm.m.position.y - sm.y0) / 55;
        sm.m.material.opacity = 0.55 * (1 - f);
        sm.m.scale.setScalar(1 + f * 0.8);
      }
      for(let i=0;i<veils.length;i++) veils[i].material.opacity = 0.06 + Math.sin(time*0.4 + i)*0.03;
    });

    // obsidian gate over the start straight — with side braziers
    const gateAt = track.pointAt(track.L * 0.045);
    const gHalf = gateAt.width / 2 + 3.5;
    const obsMat = new THREE.MeshStandardMaterial({ color: 0x1c1a22, roughness: 0.85, flatShading: true });
    const runeMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.9 });
    for (const side of [1, -1]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(2.4, 15, 2.4), obsMat);
      col.position.copy(gateAt.pos).addScaledVector(gateAt.right, side * gHalf);
      col.position.y += 7.5;
      group.add(col);
      colliders.push(new THREE.Box3().setFromObject(col));
      const rune = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), runeMat);
      rune.position.copy(col.position);
      rune.position.x -= gateAt.right.x * side * 1.3;
      rune.position.z -= gateAt.right.z * side * 1.3;
      group.add(rune);
      // brazier on each pillar
      const brazier = new THREE.Mesh(new THREE.CylinderGeometry(0.7,0.9,1,7), new THREE.MeshStandardMaterial({ color: 0x2a2328 }));
      brazier.position.copy(col.position); brazier.position.y += 8.2; group.add(brazier);
      const bFlame = new THREE.Mesh(new THREE.ConeGeometry(0.55,1.2,6), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent:true, opacity:0.88, blending: THREE.AdditiveBlending, depthWrite:false }));
      bFlame.position.copy(brazier.position); bFlame.position.y += 0.85; group.add(bFlame);
      state.extras.push((dt,time)=>{ const f=0.85+ Math.sin(time*4+ side)*0.18; bFlame.scale.set(1,f,1); bFlame.material.opacity=0.72+ Math.sin(time*4+ side)*0.12; });
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(gHalf * 2 + 3, 2.6, 3.2), obsMat);
    lintel.position.copy(gateAt.pos);
    lintel.position.y += 15.6;
    lintel.rotation.y = yawFor(gateAt.dir);
    group.add(lintel);
    colliders.push(new THREE.Box3().setFromObject(lintel));
    // hanging chains with ember charm
    for(const side of [1,-1]){
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,4.2,4), new THREE.MeshStandardMaterial({ color: 0x5a4a3a, metalness:0.45 }));
      chain.position.copy(gateAt.pos).addScaledVector(gateAt.right, side*(gHalf*0.55));
      chain.position.y += 13.5; group.add(chain);
      const charm = new THREE.Mesh(new THREE.OctahedronGeometry(0.42,0), new THREE.MeshBasicMaterial({ color: 0xff8a24, transparent:true, opacity:0.85 }));
      charm.position.copy(chain.position); charm.position.y -= 2.4; group.add(charm);
      state.extras.push((dt,time)=>{ charm.rotation.y = time*0.9; charm.position.y = chain.position.y -2.4 + Math.sin(time*1.2+ side)*0.12; });
    }

    // ember vents with flickering flames — add steam + ash puffs
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x221e24, roughness: 1, flatShading: true });
    const vents = [];
    const fracs = [0.09, 0.2, 0.33, 0.47, 0.58, 0.72, 0.83, 0.93];
    for (let i = 0; i < fracs.length; i++) {
      const p = track.pointAt(track.L * fracs[i]);
      const side = i % 2 === 0 ? 1 : -1;
      const dist = p.width / 2 + 7 + rnd() * 5;
      const base = p.pos.clone().addScaledVector(p.right, side * dist);
      const v = new THREE.Group();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + rnd();
        const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45 + rnd() * 0.4, 0), rockMat);
        rk.position.set(Math.cos(a) * 1.4, 0.3, Math.sin(a) * 1.4);
        v.add(rk);
      }
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
      const flame = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.2, 7), flameMat);
      flame.position.y = 1.9;
      v.add(flame);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), flameMat);
      core.position.y = 0.7;
      v.add(core);
      v.position.copy(base);
      group.add(v);
      vents.push({ flame, core, ph: rnd() * 6 });
    }
    state.extras.push((dt, time) => {
      for (const v of vents) {
        const f = 0.75 + Math.sin(time * 3.2 + v.ph) * 0.3;
        v.flame.scale.set(1, f, 1);
        v.flame.material.opacity = 0.55 + 0.3 * f;
        v.core.scale.setScalar(f);
      }
    });

    // === Quenched tarn — reactive water puddle astride the road (distinctive Ashfall glass water) ===
    {
      const prog = track.L * 0.32;
      const pp = track.pointAt(prog);
      const center = pp.pos.clone().addScaledVector(pp.right, 0.15);
      center.y = pp.pos.y + 0.05;
      const radius = 6.0;
      const puddleGeo = new THREE.CircleGeometry(radius, 26);
      const pa = puddleGeo.attributes.position;
      for(let i=0;i<pa.count;i++){
        const x=pa.getX(i), y=pa.getY(i); const d=Math.hypot(x,y);
        if(d>0.2){ const ang=Math.atan2(y,x); const wob=1+ Math.sin(ang*4+ i*0.6)*0.07 + Math.cos(ang*3)*0.04; pa.setX(i,x*wob); pa.setY(i,y*wob*0.92); }
      }
      puddleGeo.computeVertexNormals();
      const puddleMat = new THREE.MeshStandardMaterial({ color: 0x2e4a52, roughness:0.14, metalness:0.32, transparent:true, opacity:0.90, emissive:0x182830, emissiveIntensity:0.10 });
      const puddleMesh = new THREE.Mesh(puddleGeo, puddleMat);
      puddleMesh.rotation.x = -Math.PI/2; puddleMesh.rotation.z = yawFor(pp.dir);
      puddleMesh.position.copy(center); puddleMesh.position.y += 0.07;
      puddleMesh.name='Ashfall quenched tarn'; group.add(puddleMesh);
      // shoreline obsidian shards + ash stones
      const shardMat = new THREE.MeshStandardMaterial({ color: 0x0e0e16, roughness:0.45, metalness:0.3 });
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness:1 });
      for(let i=0;i<18;i++){
        const a=(i/18)*Math.PI*2; const rr=radius*0.94 + (rnd()-0.5)*0.9;
        const sx=center.x + Math.cos(a)*rr; const sz=center.z + Math.sin(a)*rr;
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.32+ rnd()*0.42,0), i%2? shardMat: stoneMat);
        shard.position.set(sx, center.y+0.03, sz); shard.scale.y=0.6; shard.rotation.set(rnd()*0.6, rnd()*Math.PI, rnd()*0.6); group.add(shard);
      }
      const highlight = new THREE.Mesh(new THREE.CircleGeometry(radius*0.48,16), new THREE.MeshBasicMaterial({ color: 0xd6eef5, transparent:true, opacity:0.14, blending: THREE.AdditiveBlending, depthWrite:false }));
      highlight.rotation.x=-Math.PI/2; highlight.position.copy(center); highlight.position.y+=0.09; group.add(highlight);
      // steam wisps
      const steams=[]; const steamMat = new THREE.MeshBasicMaterial({ color: 0xc8d8de, transparent:true, opacity:0.10, depthWrite:false });
      for(let i=0;i<3;i++){ const sMesh = new THREE.Mesh(new THREE.SphereGeometry(1.1+ rnd()*0.6,6,5), steamMat.clone()); sMesh.position.set(center.x+ (rnd()-0.5)*3, center.y+0.8+ rnd()*1.2, center.z+ (rnd()-0.5)*3); sMesh.scale.y=1.6; steams.push({m:sMesh, y0: sMesh.position.y, ph: rnd()*6, x0: sMesh.position.x}); group.add(sMesh); }
      const ripples=[]; state.puddles.push({ center: center.clone(), radius, mesh: puddleMesh, highlight, ripples, _lastRipple:0 });
      const spawnRipple = (pos)=>{
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.38,0.58,18), new THREE.MeshBasicMaterial({ color: 0x8ac8e0, transparent:true, opacity:0.58, side: THREE.DoubleSide, depthWrite:false }));
        ring.rotation.x=-Math.PI/2; ring.position.set(pos.x, center.y+0.11, pos.z); ring.userData.t=0; group.add(ring); ripples.push(ring);
      };
      state.spawnPuddleRipple = state.spawnPuddleRipple || spawnRipple;
      // if multiple puddles, keep array; first puddle's spawner used by main-loop, but store per-puddle too
      const mySpawn = spawnRipple;
      state.extras.push((dt,time)=>{
        puddleMat.emissiveIntensity = 0.08 + Math.sin(time*1.15)*0.022;
        highlight.position.x = center.x + Math.sin(time*0.38)*0.14;
        highlight.position.z = center.z + Math.cos(time*0.34)*0.14;
        for(let i=ripples.length-1;i>=0;i--){ const r=ripples[i]; r.userData.t+=dt; const t=r.userData.t; const s=1+ t*3.1; r.scale.setScalar(s); r.material.opacity=Math.max(0,0.58- t*0.92); if(t>0.78){ group.remove(r); r.geometry.dispose(); r.material.dispose(); ripples.splice(i,1);} }
        for(const st of steams){ st.m.position.y = st.y0 + ((time*0.7 + st.ph)%4); st.m.position.x = st.x0 + Math.sin(time*0.35+ st.ph)*0.9; st.m.material.opacity=0.11*(1- ((st.m.position.y- st.y0)/4)); st.m.scale.setScalar(1+ ((st.m.position.y- st.y0)/4)*0.6); }
      });
      // slippery physics for the tarn
      track.zones.push({ s0: prog-7, s1: prog+7, type:'slippery', v:0.52 });
      // expose merged spawner that fans out to all puddles
      const existing = state.spawnPuddleRipple;
      state.spawnPuddleRipple = (pos)=>{
        // find nearest puddle
        let best=null, bestD=Infinity;
        for(const pud of state.puddles){ const d = pos.distanceToSquared(pud.center); if(d < bestD){ bestD=d; best=pud; } }
        if(best && bestD < 120){ // within ~11m
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.38,0.58,18), new THREE.MeshBasicMaterial({ color: 0x8ac8e0, transparent:true, opacity:0.58, side: THREE.DoubleSide, depthWrite:false }));
          ring.rotation.x=-Math.PI/2; ring.position.set(pos.x, best.center.y+0.11, pos.z); ring.userData.t=0; group.add(ring); best.ripples.push(ring);
        } else { existing(pos); }
      };
    }

    // === Ashfall wildlife — safely outside, ambient only ===
    {
      state.animals = state.animals || [];
      const placeOutside = (frac, side, extra)=>{
        const p = track.pointAt(frac*track.L);
        const dist = p.width/2 + 12 + extra;
        const pos = p.pos.clone().addScaledVector(p.right, side*dist);
        pos.y = p.pos.y;
        return { p, pos };
      };
      // ash hares (pale, dusty)
      for(let i=0;i<2;i++){
        const {pos} = placeOutside(0.18 + i*0.38, i%2?1:-1, 13+ rnd()*10);
        const hare = new THREE.Group(); hare.name='Ash hare';
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8c8b8, roughness:1 });
        const earMat = new THREE.MeshStandardMaterial({ color: 0x6a5f5c, roughness:1 });
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17,0.42,4,6), bodyMat); body.rotation.z=Math.PI/2; body.position.y=0.24; hare.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.15,6,5), bodyMat); head.position.set(0.24,0.32,0); hare.add(head);
        for(const sx of [1,-1]){ const ear=new THREE.Mesh(new THREE.CapsuleGeometry(0.04,0.28,4,4), earMat); ear.position.set(0.26,0.46, sx*0.06); hare.add(ear); }
        hare.position.copy(pos); hare.position.y=0.02; group.add(hare);
        state.animals.push({ mesh: hare, type:'hare', base: pos.clone(), phase: rnd()*6, hopT: rnd()*2 });
      }
      // cinder crows circling ash columns (ground crows pecking)
      for(let i=0;i<4;i++){
        const {pos} = placeOutside(0.28 + i*0.15, 1, 10+ rnd()*12);
        const crow = new THREE.Group(); crow.name='Cinder crow';
        const bMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness:1 });
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09,0.28,4,6), bMat); body.rotation.z=Math.PI/2; body.position.y=0.18; crow.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.08,5,4), bMat); head.position.set(0.18,0.20,0); crow.add(head);
        const wingGeo = new THREE.PlaneGeometry(0.32,0.12);
        const wMat = new THREE.MeshBasicMaterial({ color: 0x2a2a30, side: THREE.DoubleSide });
        const w1=new THREE.Mesh(wingGeo,wMat); w1.position.set(0,0.20,0.10); crow.add(w1);
        const w2=w1.clone(); w2.position.z=-0.10; crow.add(w2);
        crow.position.copy(pos); crow.position.y=0.02; group.add(crow);
        state.animals.push({ mesh: crow, type:'crow', base: pos.clone(), phase: rnd()*6 });
      }
      // basalt lizards
      for(let i=0;i<3;i++){
        const {pos}=placeOutside(0.55+ i*0.18, -1, 9+ rnd()*9);
        const lz=new THREE.Group(); const lMat=new THREE.MeshStandardMaterial({ color: 0x5a6a58, roughness:0.9 });
        const body=new THREE.Mesh(new THREE.CapsuleGeometry(0.08,0.38,4,5), lMat); body.rotation.z=Math.PI/2; body.position.y=0.09; lz.add(body);
        const tail=new THREE.Mesh(new THREE.CapsuleGeometry(0.05,0.32,4,4), lMat); tail.rotation.z=Math.PI/2; tail.position.set(-0.28,0.07,0); tail.name='tail'; lz.add(tail);
        lz.position.copy(pos); lz.position.y=0.02; group.add(lz);
        state.animals.push({ mesh: lz, type:'lizard', base: pos.clone(), phase: rnd()*6 });
      }
      // distant ash fox trotting along ridge
      {
        const {pos}=placeOutside(0.62, -1, 28);
        const fox=new THREE.Group(); const fMat=new THREE.MeshStandardMaterial({ color: 0xb07a3a, roughness:1 });
        const fMat2=new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness:1 });
        const body=new THREE.Mesh(new THREE.CapsuleGeometry(0.20,0.64,4,6), fMat); body.rotation.z=Math.PI/2; body.position.y=0.34; fox.add(body);
        const head=new THREE.Mesh(new THREE.ConeGeometry(0.17,0.32,6), fMat); head.rotation.z=-Math.PI/2; head.position.set(0.42,0.40,0); fox.add(head);
        const tail=new THREE.Mesh(new THREE.CapsuleGeometry(0.10,0.44,4,5), fMat); tail.rotation.z=Math.PI/2; tail.position.set(-0.42,0.30,0); fox.add(tail);
        for(const sx of [1,-1]) for(const fz of [0.16,-0.16]){ const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.05,0.26,4), fMat2); leg.position.set(fz,0.13,sx*0.11); fox.add(leg); }
        fox.position.copy(pos); group.add(fox);
        state.animals.push({ mesh: fox, type:'fox', base: pos.clone(), phase: rnd()*6 });
      }
      state.extras.push((dt,time)=>{
        for(const a of state.animals){
          if(a.type==='hare'){ a.hopT+=dt*2.0; const hop=Math.max(0, Math.sin(a.hopT))*0.16; a.mesh.position.y=0.02+ hop; a.mesh.rotation.y=Math.sin(time*0.45+ a.phase)*0.5; if(hop>0.01) a.mesh.position.x=a.base.x+ Math.sin(a.hopT*0.55)*0.35; }
          else if(a.type==='crow'){ a.mesh.position.y=0.02+ Math.abs(Math.sin(time*2.2+ a.phase))*0.08; a.mesh.rotation.y= Math.sin(time*0.6+ a.phase)*0.7; const wob=Math.sin(time*8+ a.phase)*0.18; a.mesh.children.forEach(c=>{ if(c.isMesh && c.geometry.type==='PlaneGeometry') c.rotation.z=wob; }); }
          else if(a.type==='lizard'){ const tail=a.mesh.getObjectByName('tail'); if(tail) tail.rotation.y=Math.sin(time*2.4+ a.phase)*0.32; a.mesh.rotation.y=Math.sin(time*0.3+ a.phase)*0.22; }
          else if(a.type==='fox'){ const off=Math.sin(time*0.55+ a.phase)*1.6; a.mesh.position.x=a.base.x+ off*0.4; a.mesh.position.z=a.base.z+ Math.cos(time*0.48+ a.phase)*1.0; a.mesh.rotation.y=Math.sin(time*0.55+ a.phase)*0.5; }
        }
      });
    }

    // === Additional ashfall atmosphere: ember fireflies + ash veil ===
    {
      const N_EMB = 90;
      const ePos=new Float32Array(N_EMB*3); const eBase=[];
      for(let i=0;i<N_EMB;i++){
        const s=rnd()*track.L; const p=track.pointAt(s);
        const side=rnd()>0.5?1:-1; const dist=p.width/2+ 4+ rnd()*18;
        const x=p.pos.x+ p.right.x*side*dist; const y=p.pos.y+ 1.2+ rnd()*5; const z=p.pos.z+ p.right.z*side*dist;
        ePos[i*3]=x; ePos[i*3+1]=y; ePos[i*3+2]=z; eBase.push({x,y,z, ph: rnd()*6, sp: 0.35+ rnd()*0.55});
      }
      const eGeo=new THREE.BufferGeometry(); eGeo.setAttribute('position', new THREE.BufferAttribute(ePos,3));
      const embers=new THREE.Points(eGeo, new THREE.PointsMaterial({ color: 0xff8a24, size:0.42, sizeAttenuation:true, transparent:true, opacity:0.85, blending: THREE.AdditiveBlending, depthWrite:false }));
      group.add(embers);
      state.extras.push((dt,time)=>{
        const arr=eGeo.attributes.position.array;
        for(let i=0;i<N_EMB;i++){ const b=eBase[i]; arr[i*3]=b.x+ Math.sin(time*b.sp+ b.ph)*1.6; arr[i*3+1]=b.y+ Math.sin(time*b.sp*1.3+ b.ph*2)*0.9 + (time*0.15%6)*0.1; arr[i*3+2]=b.z+ Math.cos(time*b.sp*0.9+ b.ph)*1.5; if(arr[i*3+1] > b.y+6) arr[i*3+1]=b.y; }
        eGeo.attributes.position.needsUpdate=true; embers.material.opacity=0.78+ Math.sin(time*1.3)*0.12;
      });
    }
    // distant ash hawks (high, slow)
    {
      const hawkMat=new THREE.MeshBasicMaterial({ color: 0x2e2a24, side: THREE.DoubleSide });
      for(let i=0;i<3;i++){
        const hawk=new THREE.Group(); const wGeo=new THREE.PlaneGeometry(2.1,0.62);
        const w1=new THREE.Mesh(wGeo,hawkMat); w1.position.x=1.05; w1.rotation.z=0.32; hawk.add(w1);
        const w2=new THREE.Mesh(wGeo,hawkMat); w2.position.x=-1.05; w2.rotation.z=-0.32; hawk.add(w2);
        hawk.position.set(0, 52+ i*7, 0); group.add(hawk);
        const a0=rnd()*Math.PI*2; const r=110+ rnd()*75; const sp=0.13+ rnd()*0.07;
        state.extras.push((dt)=>{ const t=Date.now()*0.0001; hawk.position.set(Math.cos(a0+ t*sp)*r, 52+ i*7+ Math.sin(t*2+ i)*2.5, Math.sin(a0+ t*sp)*r); hawk.rotation.y= -a0 - t*sp; });
      }
    }
  },

  // ---------------------------------------------------------- verdant_loop
  verdant_loop(group, track, rnd, state, colliders) {
    // giant landmark tree guarding the start
    const tp = track.pointAt(track.L * 0.02);
    const tPos = tp.pos.clone().addScaledVector(tp.right, -(tp.width / 2 + 15));
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4228, roughness: 1 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 17, 8), trunkMat);
    trunk.position.set(tPos.x, 8.5, tPos.z);
    group.add(trunk);
    const canopyCols = [0x2f7a3f, 0x3f8e4f, 0x57a85a];
    const canopy = [[12, 8, 15], [8.5, 6.5, 20.5], [5.5, 5.5, 25]].map(([r, h, y], i) => {
      const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8),
        new THREE.MeshStandardMaterial({ color: canopyCols[i], roughness: 1, flatShading: true }));
      c.position.set(tPos.x, y, tPos.z);
      group.add(c);
      return c;
    });
    colliders.push(new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(tPos.x, 12, tPos.z), new THREE.Vector3(26, 30, 26)));
    state.extras.push((dt, time) => {
      // gentle breeze sway
      for (let i = 0; i < canopy.length; i++) {
        canopy[i].rotation.z = Math.sin(time * 0.8 + i) * 0.02 * (i + 1);
      }
    });

    // sunlit pond with reeds
    const pp = track.pointAt(track.L * 0.86);
    const pond = pp.pos.clone().addScaledVector(pp.right, pp.width / 2 + 17);
    const rim = new THREE.Mesh(new THREE.CircleGeometry(15, 20),
      new THREE.MeshStandardMaterial({ color: 0xc8b080, roughness: 1 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(pond.x, -0.38, pond.z);
    group.add(rim);
    const water = new THREE.Mesh(new THREE.CircleGeometry(13, 20),
      new THREE.MeshStandardMaterial({ color: 0x4a90b8, roughness: 0.25, transparent: true, opacity: 0.88 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(pond.x, -0.3, pond.z);
    group.add(water);
    const reedMat = new THREE.MeshStandardMaterial({ color: 0x4f8e4f, roughness: 1 });
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 11 + rnd() * 3.4;
      const h = 1.6 + rnd() * 1.1;
      const reed = new THREE.Mesh(new THREE.ConeGeometry(0.09, h, 4), reedMat);
      reed.position.set(pond.x + Math.cos(a) * r, -0.3 + h / 2, pond.z + Math.sin(a) * r);
      reed.rotation.z = (rnd() - 0.5) * 0.2;
      group.add(reed);
    }
    const lilyMat = new THREE.MeshStandardMaterial({ color: 0x6aae5a, roughness: 0.9 });
    for (let i = 0; i < 5; i++) {
      const a = rnd() * Math.PI * 2;
      const lily = new THREE.Mesh(new THREE.CircleGeometry(0.55, 8), lilyMat);
      lily.rotation.x = -Math.PI / 2;
      lily.position.set(pond.x + Math.cos(a) * (2 + rnd() * 7), -0.28, pond.z + Math.sin(a) * (2 + rnd() * 7));
      group.add(lily);
    }

    // drifting fireflies
    const N_FLY = 80;
    const flyPos = new Float32Array(N_FLY * 3);
    const flyBase = [];
    for (let i = 0; i < N_FLY; i++) {
      const s = rnd() * track.L;
      const p = track.pointAt(s);
      const side = rnd() > 0.5 ? 1 : -1;
      const dist = p.width / 2 + 3 + rnd() * 13;
      const x = p.pos.x + p.right.x * side * dist;
      const y = p.pos.y + 0.8 + rnd() * 3.8;
      const z = p.pos.z + p.right.z * side * dist;
      flyPos[i * 3] = x; flyPos[i * 3 + 1] = y; flyPos[i * 3 + 2] = z;
      flyBase.push({ x, y, z, ph: rnd() * 6, sp: 0.25 + rnd() * 0.4 });
    }
    const flyGeo = new THREE.BufferGeometry();
    flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
    const flies = new THREE.Points(flyGeo, new THREE.PointsMaterial({
      color: 0xd8ff8a, size: 0.5, sizeAttenuation: true,
      transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    group.add(flies);
    state.extras.push((dt, time) => {
      const arr = flyGeo.attributes.position.array;
      for (let i = 0; i < N_FLY; i++) {
        const b = flyBase[i];
        arr[i * 3] = b.x + Math.sin(time * b.sp + b.ph) * 1.8;
        arr[i * 3 + 1] = b.y + Math.sin(time * b.sp * 1.6 + b.ph * 2) * 0.7;
        arr[i * 3 + 2] = b.z + Math.cos(time * b.sp * 0.8 + b.ph) * 1.8;
      }
      flyGeo.attributes.position.needsUpdate = true;
    });

    // volumetric light shafts through the canopy
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0xfff8c0, transparent: true, opacity: 0.055,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    for (let i = 0; i < 6; i++) {
      const sp = track.pointAt(track.L * (0.02 + i * 0.012));
      const shaft = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 34), shaftMat);
      shaft.position.copy(sp.pos).addScaledVector(sp.right, (rnd() - 0.5) * sp.width);
      shaft.position.y += 15;
      shaft.rotation.y = yawFor(sp.dir) + (rnd() - 0.5) * 0.6;
      shaft.rotation.z = 0.45;
      group.add(shaft);
    }
  },

  // ---------------------------------------------------------- neon_cascade
  neon_cascade(group, track, rnd, state, colliders) {
    // neon billboards marching along the rooftops
    const WORDS = ['CASCADE', 'VOLT', 'NOVA', 'PULSE', 'APEX', 'ZEN', 'DRIFT'];
    const HUES = [0.86, 0.48, 0.13, 0.33, 0.58, 0.06, 0.75];
    const signs = [];
    for (let i = 0; i < WORDS.length; i++) {
      const p = track.pointAt(track.L * (0.07 + i * 0.135));
      const side = i % 2 === 0 ? 1 : -1;
      const dist = p.width / 2 + 5.5;
      const base = p.pos.clone().addScaledVector(p.right, side * dist);
      const hgt = 6.5 + rnd() * 3;
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2e3e, roughness: 0.6, metalness: 0.5 });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, hgt, 6), poleMat);
      pole.position.set(base.x, p.pos.y + hgt / 2, base.z);
      group.add(pole);
      const tex = makeSignTexture(WORDS[i], '#' + new THREE.Color().setHSL(HUES[i], 0.95, 0.6).getHexString());
      const signMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.96, side: THREE.DoubleSide });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.4), signMat);
      sign.position.set(base.x, p.pos.y + hgt + 1.1, base.z);
      sign.rotation.y = yawFor(p.dir);
      group.add(sign);
      signs.push({ mat: signMat, hue: HUES[i], dir: i % 3 === 0 ? -1 : 1 });
    }
    state.extras.push((dt, time) => {
      for (const sgn of signs) {
        const pulse = 0.75 + Math.sin(time * 2.2 + sgn.hue * 12) * 0.25;
        sgn.mat.opacity = 0.75 + pulse * 0.25;
      }
    });

    // colour-cycling neon tube arches over key straights
    const archCols = [0x2fd8c8, 0xff5df1, 0xffd24a];
    const arches = [];
    for (let i = 0; i < 3; i++) {
      const p = track.pointAt(track.L * (0.26 + i * 0.18));
      const archMat = new THREE.MeshBasicMaterial({ color: archCols[i], transparent: true, opacity: 0.9 });
      const arch = new THREE.Mesh(new THREE.TorusGeometry(p.width / 2 + 2.4, 0.22, 6, 22, Math.PI), archMat);
      arch.position.copy(p.pos);
      arch.position.y += 0.15;
      arch.rotation.y = yawFor(p.dir);
      group.add(arch);
      arches.push({ mat: archMat, hue: i / 3 });
    }
    state.extras.push((dt, time) => {
      for (const a of arches) {
        a.mat.color.setHSL((a.hue + time * 0.03) % 1, 0.95, 0.6);
      }
    });

    // light "cascade" falls from the high rooftop section
    const fallMat = new THREE.MeshBasicMaterial({
      color: 0x2fd8c8, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    for (let i = 0; i < 4; i++) {
      const p = track.pointAt(track.L * (0.52 + i * 0.03));
      const side = i % 2 === 0 ? 1 : -1;
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 42), fallMat);
      fall.position.copy(p.pos).addScaledVector(p.right, side * (p.width / 2 + 9 + rnd() * 6));
      fall.position.y += 21;
      fall.rotation.y = yawFor(p.dir) + Math.PI / 2;
      group.add(fall);
    }

    // distant mega-skyline for depth
    const farMat = new THREE.MeshStandardMaterial({ color: 0x0a0c16, roughness: 0.7, metalness: 0.3 });
    for (let i = 0; i < 12; i++) {
      const p = track.pointAt(track.L * ((i * 0.083 + 0.03) % 1));
      const side = i % 2 === 0 ? 1 : -1;
      const dist = p.width / 2 + 70 + rnd() * 70;
      const h = 50 + rnd() * 60;
      const w = 9 + rnd() * 8;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), farMat);
      tower.position.copy(p.pos).addScaledVector(p.right, side * dist);
      tower.position.y += h / 2;
      group.add(tower);
    }
  },

  // --------------------------------------------------------- skyline_helix
  skyline_helix(group, track, rnd, state, colliders) {
    const cx = 0, cz = 10;   // helix axis: the track spirals around here
    // the mega-tower
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x141828, roughness: 0.6, metalness: 0.4, flatShading: true });
    const towerMat2 = new THREE.MeshStandardMaterial({ color: 0x1a2036, roughness: 0.6, metalness: 0.4, flatShading: true });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(20, 27, 62, 8), towerMat);
    base.position.set(cx, 31, cz);
    group.add(base);
    const mid = new THREE.Mesh(new THREE.CylinderGeometry(15, 19, 42, 8), towerMat2);
    mid.position.set(cx, 83, cz);
    group.add(mid);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(10, 13.5, 32, 8), towerMat);
    top.position.set(cx, 119, cz);
    group.add(top);
    // neon edge strips on the base corners
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x2fd8c8 });
    for (const [ex, ez] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 60, 0.7), edgeMat);
      strip.position.set(cx + ex * 18.5, 30, cz + ez * 18.5);
      group.add(strip);
    }
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5df1 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(17.5, 0.35, 6, 28), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx, 105, cz);
    group.add(ring);
    // antenna + blinking beacon
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 26, 6), towerMat2);
    antenna.position.set(cx, 145, cz);
    group.add(antenna);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff4a4a, transparent: true, opacity: 0.95 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 8), beaconMat);
    beacon.position.set(cx, 159, cz);
    group.add(beacon);
    // rotating radar dish
    const dishPivot = new THREE.Group();
    dishPivot.position.set(cx + 16, 96, cz);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(4.5, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a4258, roughness: 0.4, metalness: 0.6 }));
    dish.scale.y = 0.22;
    dish.position.x = 3;
    dishPivot.add(dish);
    const dishMast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 6, 6), towerMat2);
    dishMast.position.y = -2.5;
    dishPivot.add(dishMast);
    group.add(dishPivot);
    colliders.push(new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(cx, 75, cz), new THREE.Vector3(58, 160, 58)));

    // the light-helix wrapping the tower
    const helixPts = [];
    const turns = 2.6 * Math.PI * 1.35;
    for (let i = 0; i <= 110; i++) {
      const t = i / 110;
      const a = -0.5 * Math.PI + turns * t;
      helixPts.push(new THREE.Vector3(Math.cos(a) * 215, -2 + 57 * t, Math.sin(a) * 215));
    }
    const helixCurve = new THREE.CatmullRomCurve3(helixPts);
    const helixMat = new THREE.MeshBasicMaterial({
      color: 0xff5df1, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const helix = new THREE.Mesh(new THREE.TubeGeometry(helixCurve, 150, 0.7, 6), helixMat);
    const helixGroup = new THREE.Group();
    helixGroup.position.set(cx, 0, cz);
    helixGroup.add(helix);   // helix pts are already centred on the origin
    group.add(helixGroup);

    // distant super-tall towers
    const farMat = new THREE.MeshStandardMaterial({ color: 0x0a0c16, roughness: 0.7, metalness: 0.3 });
    const farNeon = new THREE.MeshBasicMaterial({ color: 0x4aa8ff });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const r = 330 + rnd() * 150;
      const h = 95 + rnd() * 75;
      const w = 12 + rnd() * 10;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), farMat);
      tower.position.set(cx + Math.cos(a) * r, h / 2, cz + Math.sin(a) * r);
      group.add(tower);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.8, h * 0.9, 0.8), farNeon);
      strip.position.set(cx + Math.cos(a) * (r + w / 2), h / 2, cz + Math.sin(a) * (r + w / 2));
      group.add(strip);
    }

    state.extras.push((dt, time) => {
      beaconMat.opacity = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 2.4));
      beacon.scale.setScalar(0.9 + 0.25 * (0.5 + 0.5 * Math.sin(time * 2.4)));
      dishPivot.rotation.y = time * 0.5;
      helixGroup.rotation.y = time * 0.03;
      helixMat.opacity = 0.55 + 0.2 * Math.sin(time * 1.2);
    });
  },
};

// ----------------------------------------------------------------------------
// Main entry
// ----------------------------------------------------------------------------
export function buildThemedEnvironment(scene, track, bannerName) {
  const theme = track.def.theme;
  const expedition = EXPEDITION_KITS[track.def.id];
  const refinement = REFINEMENT_KITS[track.def.id];
  const bespoke = expedition || refinement;
  const kit = bespoke || KITS[theme] || KITS.ruins;
  const group = new THREE.Group();
  const colliders = [];
  const state = { padMaterials: [], obstacleMeshes: [], extras: [] };
  scene.add(group);

  // Legacy worlds attach lights directly to the scene. Isolate the bespoke
  // palettes from those lights while active, then restore the exact old state.
  // New lights belong to the disposable world group and cannot leak on exit.
  const previousLights = bespoke
    ? scene.children.filter(o => o.isLight).map(light => ({ light, visible: light.visible })) : [];
  for (const { light } of previousLights) light.visible = false;
  const sunLight = buildSky(scene, group, kit);

  // ground (islands theme floats over void instead)
  if (kit.ground !== null) {
    const minY = Math.min(...track.samples.map((s) => s.pos.y));
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(820, 56),
      new THREE.MeshStandardMaterial({ color: kit.ground, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = minY - (kit.groundDepth || 0.6);
    group.add(ground);
  }

  buildRoad(group, track, kit);
  buildFinishAndBanner(group, track, bannerName || 'SUNFORGE', kit);
  buildRampsAndPads(group, track, state);
  if (!bespoke) buildTunnel(group, track, colliders, theme === 'ruins' ? 0xb3763f : theme === 'crystal' ? 0x3a3054 : theme === 'desert' ? 0x3a3238 : 0x565e6c, theme, state);
  if (!bespoke) buildCanyon(group, track, (kit.ground ?? 0x8a6f52) + 0x101010);
  buildObstacles(group, track, state);

  const rnd = seeded(track.def.musicSeed * 1013 + 7);
  if (expedition) buildExpeditionEnvironment(group, track, rnd, state, colliders);
  else if (refinement) buildRefinedEnvironment(group, track, rnd, state, colliders);
  else (PROPS[theme] || PROPS.ruins)(group, track, rnd);

  // signature landmarks for the four flagship themed circuits
  const flavor = FLAVORS[track.def.id];
  if (flavor) flavor(group, track, rnd, state, colliders);

  state.update = (dt, time) => {
    for (const { mesh, obstacle, isFlame, ring } of state.obstacleMeshes) {
      if (obstacle.type === 'gear') mesh.rotation.y = obstacle.angle;
      else if (obstacle.type === 'slider' || obstacle.type === 'pendulum') mesh.position.copy(obstacle.pos);
      else if (isFlame) {
        mesh.visible = obstacle.active;
        // Flicker oscillates UP TO the nominal cone height and never past it,
        // so the drawn fire always stays inside the collider volume that was
        // derived from that same nominal height (max scale === 1.0).
        if (obstacle.active) mesh.scale.set(1, 0.86 + Math.sin(time * 30) * 0.14, 1);
        if (ring) {
          // the ring always marks the vent footprint; it goes hot while lit
          ring.material.color.setHex(obstacle.active ? 0xff5a2a : 0xffb347);
          ring.material.opacity = obstacle.active ? 0.75 : 0.32 + Math.sin(time * 2.4) * 0.06;
        }
      }
    }
    const pulse = 0.75 + Math.sin(time * 6) * 0.25;
    for (const m of state.padMaterials) m.opacity = pulse;
    if (theme === 'storm' && !refinement) {
      // lightning flicker
      const flash = Math.max(0, Math.sin(time * 1.7) * Math.sin(time * 7.3) - 0.93) * 12;
      sunLight.intensity = kit.sun[1] + flash;
    }
    for (const fn of state.extras) fn(dt, time);
  };

  return { group, colliders, state, dispose() {
    for (const { light, visible } of previousLights) light.visible = visible;
  } };
}
