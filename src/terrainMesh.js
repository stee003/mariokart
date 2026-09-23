// ============================================================================
// Canonical procedural terrain feature meshes.
//
// Ramp collision lives in TrackManager.rampSurfaceAt(). The renderer samples
// that exact function here instead of drawing an unrelated four-corner quad.
// As a result, curved ramps, the blended toe, the side shoulders and the lip
// all occupy the same surface that the kart wheels and jump physics use.
// ============================================================================

import * as THREE from '../lib/three.module.js';

const DEFAULTS = Object.freeze({
  surface: 0x6a7080,
  shoulder: 0x555b69,
  side: 0x343944,
  stripe: 0xffe08a,
});

function surfacePoint(track, ramp, progress, lateral, yOffset = 0) {
  const road = track.pointAt(progress);
  const sample = track.rampSurfaceAt(
    ramp, progress, lateral, road.pos.y, road.slope,
  );
  return {
    x: road.pos.x + road.right.x * lateral,
    y: sample.y + yOffset,
    z: road.pos.z + road.right.z * lateral,
    progress,
    lateral,
    surfaceY: sample.y,
    contact: sample.contact,
  };
}

// Build a two-vertex strip that follows the centreline and canonical ramp
// profile. Keeping progress/lateral metadata makes geometry/collision parity
// directly testable without reverse-projecting curved world-space vertices.
export function buildRampBandGeometry(track, ramp, {
  lateralA,
  lateralB,
  progressStart = ramp.s0 - (ramp.toe ?? 0),
  progressEnd = ramp.s1,
  maxSegmentLength = 0.65,
  yOffset = 0.045,
} = {}) {
  const span = Math.max(0.001, progressEnd - progressStart);
  const segments = Math.max(1, Math.ceil(span / maxSegmentLength));
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const indices = [];
  const samples = [];

  for (let i = 0; i <= segments; i++) {
    const progress = progressStart + span * (i / segments);
    const a = surfacePoint(track, ramp, progress, lateralA, yOffset);
    const b = surfacePoint(track, ramp, progress, lateralB, yOffset);
    positions.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    samples.push(a, b);
    if (i < segments) {
      const row = i * 2;
      // pointAt().right is UP x forward, so this winding faces upward.
      indices.push(row, row + 2, row + 1, row + 1, row + 2, row + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.surfaceSamples = samples;
  geometry.userData.ramp = ramp;
  return geometry;
}

function buildLipFaceGeometry(track, ramp, yOffset = 0.025) {
  const progress = ramp.s1;
  const outer = ramp.halfW + (ramp.feather ?? 0);
  const columns = 12;
  const positions = new Float32Array((columns + 1) * 2 * 3);
  const indices = [];
  const samples = [];
  const road = track.pointAt(progress);

  for (let i = 0; i <= columns; i++) {
    const lateral = ramp.lat - outer + (outer * 2 * i) / columns;
    const top = surfacePoint(track, ramp, progress, lateral, yOffset);
    const x = road.pos.x + road.right.x * lateral;
    const z = road.pos.z + road.right.z * lateral;
    positions.set([
      x, road.pos.y + yOffset, z,
      top.x, top.y, top.z,
    ], i * 6);
    samples.push(top);
    if (i < columns) {
      const col = i * 2;
      indices.push(col, col + 1, col + 2, col + 1, col + 3, col + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.surfaceSamples = samples;
  geometry.userData.ramp = ramp;
  return geometry;
}

function standard(color, roughness = 0.88) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.02,
    flatShading: false,
    side: THREE.DoubleSide,
  });
}

// Complete visible ramp: solid centre deck, tapered collision shoulders,
// physical drop face, and a lip stripe that lies ON the incline rather than
// floating horizontally across and beyond it.
export function createRampVisual(track, ramp, palette = {}) {
  const colors = { ...DEFAULTS, ...palette };
  const group = new THREE.Group();
  group.name = 'terrain-ramp';
  group.userData.ramp = ramp;
  group.userData.collisionSource = 'TrackManager.rampSurfaceAt';

  const deckLeft = ramp.lat - ramp.halfW;
  const deckRight = ramp.lat + ramp.halfW;
  const feather = ramp.feather ?? 0;

  const deck = new THREE.Mesh(
    buildRampBandGeometry(track, ramp, { lateralA: deckLeft, lateralB: deckRight }),
    standard(colors.surface),
  );
  deck.name = 'ramp-deck';
  group.add(deck);

  if (feather > 0) {
    const shoulderMat = standard(colors.shoulder, 0.96);
    const left = new THREE.Mesh(buildRampBandGeometry(track, ramp, {
      lateralA: deckLeft - feather,
      lateralB: deckLeft,
    }), shoulderMat);
    left.name = 'ramp-shoulder-left';
    const right = new THREE.Mesh(buildRampBandGeometry(track, ramp, {
      lateralA: deckRight,
      lateralB: deckRight + feather,
    }), shoulderMat);
    right.name = 'ramp-shoulder-right';
    group.add(left, right);
  }

  const lipFace = new THREE.Mesh(
    buildLipFaceGeometry(track, ramp),
    standard(colors.side, 1),
  );
  lipFace.name = 'ramp-lip-face';
  group.add(lipFace);

  // The warning stripe is the final part of the same sampled incline. It
  // terminates exactly at s1, where collision releases the kart into flight.
  const stripeLength = Math.min(0.9, ramp.len * 0.12);
  const stripe = new THREE.Mesh(
    buildRampBandGeometry(track, ramp, {
      lateralA: deckLeft,
      lateralB: deckRight,
      progressStart: ramp.s1 - stripeLength,
      progressEnd: ramp.s1,
      maxSegmentLength: 0.3,
      yOffset: 0.065,
    }),
    new THREE.MeshBasicMaterial({
      color: colors.stripe,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  stripe.name = 'ramp-lip-stripe';
  group.add(stripe);

  return group;
}
