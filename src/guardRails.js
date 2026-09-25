// ============================================================================
// Guard rail + arena barrier renderer.
//
// Reads the layout TrackManager generated (track.guardRails: per-sample,
// per-side flags, see track.js) and builds the physical wall you actually
// collide with: the vehicle's rail query measures off the same centreline,
// road width and GUARD_RAIL constants used to place this geometry, so art
// and hitbox are locked together by construction.
//
// Shape, per run of flagged samples on each side:
//    posts every ~3 m, thicker anchor posts at run ends, a two-piece beam
//    (main rail + rub strip) and a thin theme-accent crown strip. Tight
//    corners additionally get chevron boards facing the oncoming driver.
// Everything is InstancedMesh: a full-circuit railing costs a handful of
// draw calls.
//
// Battle arenas (def.arenaRadius) get buildArenaBarrier() instead - a visible
// energy fence exactly where enforceArenaWalls() clamps karts, so the old
// "invisible wall" finally has a body.
//
// Theme adaptation lives in RAIL_THEME: one consistent construction, with
// posts/beam/accent re-tinted per biome (rusted steel in the desert, neon
// glass in the city, ember-lit basalt in the volcano...).
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { GUARD_RAIL } from './track.js';

// post: uprights + anchors; rail: beam body; accent: crown strip / chevrons
// glow: accent emissive strength (0 = paint only); metal/rough: beam PBR
const RAIL_THEME = {
  desert:     { post: 0x74452a, rail: 0xb9763f, accent: 0xffb254, glow: 0.35, metal: 0.55, rough: 0.50 },
  forest:     { post: 0x6b4a2c, rail: 0x9c7346, accent: 0xe8e0c8, glow: 0.00, metal: 0.05, rough: 0.85 },
  city:       { post: 0x23262e, rail: 0x9aa4b8, accent: 0x2fd8c8, glow: 0.90, metal: 0.80, rough: 0.35 },
  mountain:   { post: 0x5c4a38, rail: 0x9c8f78, accent: 0xffd27a, glow: 0.25, metal: 0.20, rough: 0.70 },
  volcano:    { post: 0x2a1a16, rail: 0x4a2620, accent: 0xff6a2a, glow: 1.00, metal: 0.35, rough: 0.60 },
  underwater: { post: 0x14424e, rail: 0x2e7f8e, accent: 0x40f0e0, glow: 0.85, metal: 0.30, rough: 0.45 },
  factory:    { post: 0x3a362e, rail: 0xc9a11e, accent: 0xffe14a, glow: 0.35, metal: 0.60, rough: 0.45 },
  islands:    { post: 0x7a5a36, rail: 0xd8c498, accent: 0xfff0c8, glow: 0.20, metal: 0.05, rough: 0.80 },
  ruins:      { post: 0x8a6a44, rail: 0xc9b287, accent: 0xffd9a0, glow: 0.20, metal: 0.10, rough: 0.85 },
  storm:      { post: 0x2c3238, rail: 0x6a7684, accent: 0xffd84a, glow: 0.50, metal: 0.70, rough: 0.40 },
  crystal:    { post: 0x3a3060, rail: 0x8a76d8, accent: 0xc8b0ff, glow: 0.90, metal: 0.35, rough: 0.35 },
  space:      { post: 0x2a3242, rail: 0x9fb0d0, accent: 0x66e8ff, glow: 0.90, metal: 0.80, rough: 0.30 },
};

// arena energy fences: one tint per biome, matching its sky/fog identity
const BARRIER_THEME = {
  volcano: 0xff8a3c, crystal: 0xa88cff, city: 0x2fd8c8, islands: 0x7ac8ff,
  desert: 0xffb254, forest: 0x8fe07a, mountain: 0xffd27a, underwater: 0x40f0e0,
  factory: 0xffe14a, ruins: 0xffd9a0, storm: 0xffd84a, space: 0x66e8ff,
};

// physical/visual height constants (the collider tops out at
// GUARD_RAIL.clearHeight - the visible crown sits just below it)
const POST_H = 0.60, POST_SQ = 0.11;
const ANCHOR_H = 0.80, ANCHOR_SQ = 0.17;
const BEAM_Y = 0.46, BEAM_H = 0.26, BEAM_D = 0.20;
const RUB_Y = 0.22, RUB_H = 0.11, RUB_D = 0.15;
const CROWN_Y = 0.615, CROWN_D = 0.22;    // accent strip on top of the beam
const CHEV_Y = 0.98;

const _dummy = new THREE.Object3D();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

// Minimal non-indexed merge for the handful of authored boxes (chevrons).
function mergeBoxes(parts) {
  const geos = parts.map(([geo, x, y, z, rz]) => {
    const g = geo.toNonIndexed();
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    return g;
  });
  const total = geos.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

function instancedFrom(geo, mat, matrices) {
  if (!matrices.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = true;
  return mesh;
}

// World-space rail line point for sample `sm` on `side` (+1 right / -1 left).
function railPoint(sm, side, lift, out) {
  const off = side * (sm.width / 2 + GUARD_RAIL.offset);
  return out.set(
    sm.pos.x + sm.right.x * off,
    sm.pos.y + lift,
    sm.pos.z + sm.right.z * off,
  );
}

// ----------------------------------------------------------------------------
// Circuit guard rails. Returns the number of instanced meshes created (0 = no
// rails on this track). Meshes are added straight into `group`.
// ----------------------------------------------------------------------------
export function buildGuardRails(group, track, themeName, state = null) {
  const g = track.guardRails;
  if (!g || !g.count) return 0;
  const T = RAIL_THEME[themeName] || RAIL_THEME.desert;
  const S = track.samples;
  const n = S.length;

  const beams = [], rubs = [], crowns = [], posts = [], anchors = [], chevrons = [];
  const sides = [
    { flag: g.left,  side: -1 },
    { flag: g.right, side: +1 },
  ];

  for (const { flag, side } of sides) {
    for (let i = 0; i < n; i++) {
      if (!flag[i]) continue;
      const sm = S[i];
      const next = (i + 1) % n;
      const prev = (i - 1 + n) % n;
      const isRunStart = !flag[prev];
      const isRunEnd = !flag[next];

      // anchors mark both ends of every run
      if (isRunStart || isRunEnd) {
        railPoint(sm, side, ANCHOR_H / 2 - 0.05, _a);
        _dummy.position.copy(_a);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        anchors.push(_dummy.matrix.clone());
      } else if (i % 2 === 0) {
        // mid posts, slightly behind the beam line
        railPoint(sm, side, POST_H / 2 - 0.04, _a);
        _a.addScaledVector(sm.right, side * 0.07);
        _dummy.position.copy(_a);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        posts.push(_dummy.matrix.clone());
      }

      // beams run between consecutive flagged samples
      if (!isRunEnd) {
        railPoint(sm, side, 0, _a);
        railPoint(S[next], side, 0, _b);
        const len = _a.distanceTo(_b) + 0.12;
        for (const [sink, y, dscale] of [[beams, BEAM_Y, 1], [rubs, RUB_Y, 1], [crowns, CROWN_Y, 1]]) {
          _dummy.position.lerpVectors(_a, _b, 0.5);
          _dummy.position.y += y;
          _dummy.lookAt(_b.x, _b.y + y, _b.z);
          _dummy.scale.set(dscale, 1, len);
          _dummy.updateMatrix();
          sink.push(_dummy.matrix.clone());
        }
      }

      // chevrons on tight corners, aimed back at the oncoming driver
      if (i % 6 === 0 && Math.abs(track.line.curv[i]) > 0.048 && !isRunStart) {
        // boards sit just outside the rail line and lean back a touch
        railPoint(sm, side, CHEV_Y, _a);
        _a.addScaledVector(sm.right, side * 0.55);
        _dummy.position.copy(_a);
        _b.copy(_a).sub(sm.dir);       // face the traffic (normal = -dir)
        _dummy.lookAt(_b);
        // chevron geometry points local +X (= world -right after lookAt);
        // flip it when the corner's inside is the other way
        if (track.line.curv[i] < 0) _dummy.rotateY(Math.PI);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        chevrons.push(_dummy.matrix.clone());
      }
    }
  }

  const railMat = new THREE.MeshStandardMaterial({
    color: T.rail, metalness: T.metal, roughness: T.rough,
  });
  const postMat = new THREE.MeshStandardMaterial({
    color: T.post, metalness: Math.min(0.5, T.metal), roughness: Math.max(0.45, T.rough),
  });
  const anchorMat = new THREE.MeshStandardMaterial({
    color: T.accent, metalness: T.metal * 0.5, roughness: 0.5,
    emissive: T.accent, emissiveIntensity: Math.min(1, T.glow) * 0.35,
  });

  let made = 0;
  const add = (mesh) => { if (mesh) { group.add(mesh); made++; } };
  add(instancedFrom(new THREE.BoxGeometry(BEAM_D, BEAM_H, 1), railMat, beams));
  add(instancedFrom(new THREE.BoxGeometry(RUB_D, RUB_H, 1), railMat, rubs));
  add(instancedFrom(new THREE.BoxGeometry(POST_SQ, POST_H, POST_SQ), postMat, posts));
  add(instancedFrom(new THREE.BoxGeometry(ANCHOR_SQ, ANCHOR_H, ANCHOR_SQ), anchorMat, anchors));

  // glowing crown strips only exist on themes that want them
  let crownMat = null;
  if (T.glow > 0) {
    crownMat = new THREE.MeshBasicMaterial({
      color: T.accent, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    add(instancedFrom(new THREE.BoxGeometry(CROWN_D, 0.045, 1), crownMat, crowns));
    if (state) {
      const mat = crownMat, base = T.glow;
      state.extras.push((dt, time) => {
        mat.opacity = 0.5 + 0.3 * Math.min(1, base) * (0.5 + 0.5 * Math.sin(time * 2.4));
      });
    }
  }

  if (chevrons.length) {
    // "<" board: dark backing plate + two slanted slats (merged, one instanced draw)
    const chevGeo = mergeBoxes([
      [new THREE.BoxGeometry(0.72, 0.5, 0.05), 0, 0, -0.035, 0],
      [new THREE.BoxGeometry(0.52, 0.11, 0.07), -0.02, 0.11, 0.02, 0.62],
      [new THREE.BoxGeometry(0.52, 0.11, 0.07), -0.02, -0.11, 0.02, -0.62],
    ]);
    const chevMat = new THREE.MeshStandardMaterial({
      color: T.accent, emissive: T.accent,
      emissiveIntensity: Math.max(0.55, Math.min(1, T.glow)),
      roughness: 0.45, metalness: 0.2,
    });
    add(instancedFrom(chevGeo, chevMat, chevrons));
  }

  return made;
}

// ----------------------------------------------------------------------------
// Battle arena barrier. A pane + twin glow rims + posts marking the exact
// ring where enforceArenaWalls() clamps a kart (def.arenaRadius), lifted just
// past the kart body so geometry never visibly swallows a racer at the wall.
// ----------------------------------------------------------------------------
export function buildArenaBarrier(group, track, themeName, state = null) {
  const def = track.def;
  if (!def || def.arenaRadius === undefined) return 0;
  const accent = BARRIER_THEME[themeName] ?? 0x7ac8ff;
  // kart centres clamp at arenaRadius; the visible fence stands one kart-body
  // beyond it so the wall face is what the bumper touches
  const R = def.arenaRadius + 1.15;
  const H = 1.75;

  const paneMat = new THREE.MeshBasicMaterial({
    color: accent, transparent: true, opacity: 0.10, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const pane = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, H, 96, 1, true), paneMat);
  pane.position.y = H / 2 - 0.12;
  group.add(pane);

  const rimMat = new THREE.MeshBasicMaterial({
    color: accent, transparent: true, opacity: 0.85, fog: false,
  });
  for (const y of [H - 0.12, 0.02]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.055, 6, 128), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    group.add(rim);
  }

  // posts: instanced uprights every ~4 degrees
  const postGeo = new THREE.BoxGeometry(0.16, H, 0.16);
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x2a2e38, metalness: 0.7, roughness: 0.4,
    emissive: accent, emissiveIntensity: 0.25,
  });
  const mats = [];
  const count = 90;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    _dummy.position.set(Math.cos(a) * R, H / 2 - 0.12, Math.sin(a) * R);
    _dummy.rotation.set(0, -a, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    mats.push(_dummy.matrix.clone());
  }
  const posts = instancedFrom(postGeo, postMat, mats);
  if (posts) group.add(posts);

  if (state) {
    state.extras.push((dt, time) => {
      paneMat.opacity = 0.075 + 0.045 * (0.5 + 0.5 * Math.sin(time * 1.8));
      rimMat.opacity = 0.65 + 0.3 * (0.5 + 0.5 * Math.sin(time * 2.6));
    });
  }
  return 3;
}
