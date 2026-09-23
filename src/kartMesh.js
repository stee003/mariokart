// ============================================================================
// Kart model builder + per-frame visual animation.
//
// Two entry points:
//   buildKart(bodyColor, accentColor, pilotColor)
//       Legacy vertical-slice kart ("Dune Blazer" + fox pilot). Kept
//       identical so existing callers/tests render exactly as before.
//   buildKartFromLoadout(loadout)
//       Modular kart from content/loadout.js: chassis body style, wheel
//       type, paint + finish, decal, exhaust style, boost-effect colors,
//       and a full procedural pilot model (characterMesh.js).
//
// Both return the same visual record shape consumed by updateKartVisual.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { buildCharacter } from './characterMesh.js';

function matFor(color, finish) {
  switch (finish) {
    case 'metal': return new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.72, flatShading: true });
    case 'pearl': return new THREE.MeshStandardMaterial({ color, roughness: 0.26, metalness: 0.38, flatShading: true });
    case 'matte': return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, flatShading: true });
    default:      return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08, flatShading: true });
  }
}

// ---------------------------------------------------------------------------
// Decal textures (canvas, procedural, original patterns).
// ---------------------------------------------------------------------------
const decalCache = new Map();
function decalTexture(pattern, accentHex) {
  const key = `${pattern}:${accentHex}`;
  if (decalCache.has(key)) return decalCache.get(key);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  const accent = `#${accentHex.toString(16).padStart(6, '0')}`;
  g.clearRect(0, 0, 128, 64);
  g.fillStyle = accent;
  switch (pattern) {
    case 'stripe':
      g.fillRect(20, 0, 14, 64); g.fillRect(44, 0, 8, 64);
      break;
    case 'sun':
      g.beginPath(); g.arc(64, 32, 14, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.fillRect(64 + Math.cos(a) * 20 - 2, 32 + Math.sin(a) * 20 - 2, 4, 4);
      }
      break;
    case 'gear':
      g.beginPath(); g.arc(64, 32, 12, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.save(); g.translate(64 + Math.cos(a) * 16, 32 + Math.sin(a) * 16);
        g.rotate(a); g.fillRect(-3, -3, 6, 6); g.restore();
      }
      break;
    case 'flames':
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.moveTo(8 + i * 30, 60); g.lineTo(20 + i * 30, 8 + (i % 2) * 14);
        g.lineTo(32 + i * 30, 60); g.closePath(); g.fill();
      }
      break;
    case 'bolt':
      g.beginPath(); g.moveTo(70, 4); g.lineTo(40, 34); g.lineTo(58, 34);
      g.lineTo(50, 60); g.lineTo(88, 26); g.lineTo(66, 26); g.closePath(); g.fill();
      break;
    case 'wave':
      for (let x = 0; x < 128; x += 4) {
        const y = 32 + Math.sin(x * 0.12) * 12;
        g.fillRect(x, y, 4, 8);
      }
      break;
    case 'stars':
      for (let i = 0; i < 9; i++) {
        const x = 12 + (i * 37) % 104, y = 10 + (i * 53) % 44;
        g.fillRect(x, y, 4, 4); g.fillRect(x + 1, y - 2, 2, 8); g.fillRect(x - 2, y + 1, 8, 2);
      }
      break;
    default: return null;
  }
  const tex = new THREE.CanvasTexture(c);
  decalCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Chassis body variants
// ---------------------------------------------------------------------------
function buildChassis(bodyStyle, matBody, matAccent, matDark, scale) {
  const body = new THREE.Group();
  const hullDims = {
    classic: [1.28, 0.34, 2.5],
    slim:    [1.02, 0.3, 2.6],
    wide:    [1.56, 0.42, 2.6],
    needle:  [1.06, 0.3, 2.9],
    round:   [1.24, 0.4, 2.2],
  }[bodyStyle.hull] || [1.28, 0.34, 2.5];

  const hull = new THREE.Mesh(new THREE.BoxGeometry(...hullDims), matBody);
  hull.position.y = 0.42;
  body.add(hull);

  // nose
  const noseSpec = {
    wedge:  { geo: [0.94, 0.26, 0.7], pos: [0, 0.36, 1.45], tilt: 0.12 },
    dart:   { geo: [0.62, 0.22, 0.95], pos: [0, 0.38, 1.55], tilt: 0.2 },
    ram:    { geo: [1.3, 0.42, 0.5], pos: [0, 0.4, 1.4], tilt: 0 },
    lance:  { geo: [0.44, 0.2, 1.2], pos: [0, 0.4, 1.75], tilt: 0.16 },
    beetle: { geo: [0.9, 0.34, 0.7], pos: [0, 0.42, 1.35], tilt: -0.08 },
  }[bodyStyle.nose] || { geo: [0.94, 0.26, 0.7], pos: [0, 0.36, 1.45], tilt: 0.12 };
  const nose = new THREE.Mesh(new THREE.BoxGeometry(...noseSpec.geo), matAccent);
  nose.position.set(...noseSpec.pos);
  nose.rotation.x = noseSpec.tilt;
  body.add(nose);

  // side pods
  if (bodyStyle.pods === 'side' || bodyStyle.pods === undefined) {
    for (const side of [1, -1]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.5), matDark);
      pod.position.set(side * (hullDims[0] / 2 + 0.08), 0.36, -0.1);
      body.add(pod);
    }
  } else if (bodyStyle.pods === 'armor') {
    for (const side of [1, -1]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 1.9), matDark);
      pod.position.set(side * (hullDims[0] / 2 + 0.12), 0.4, -0.1);
      body.add(pod);
    }
  } else if (bodyStyle.pods === 'round') {
    for (const side of [1, -1]) {
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 1.1, 3, 8), matDark);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(side * (hullDims[0] / 2 + 0.08), 0.36, -0.1);
      body.add(pod);
    }
  }

  // cockpit
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.3, 0.8), matDark);
  cockpit.position.set(0, 0.58, -0.35);
  body.add(cockpit);

  // wing / rear structure
  const wingY = 0.98;
  if (bodyStyle.wing === 'tall') {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.09, 0.44), matAccent);
    wing.position.set(0, wingY + 0.3, -1.34);
    body.add(wing);
    for (const side of [1, -1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.1), matDark);
      strut.position.set(side * 0.5, wingY, -1.3);
      body.add(strut);
    }
  } else if (bodyStyle.wing === 'fin') {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 1.0), matAccent);
    fin.position.set(0, wingY + 0.05, -1.1);
    body.add(fin);
  } else if (bodyStyle.wing === 'rollbar') {
    const bar = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 6, 10, Math.PI), matDark);
    bar.position.set(0, 0.62, -0.4);
    bar.rotation.z = 0; bar.rotation.y = Math.PI / 2;
    body.add(bar);
  } else if (bodyStyle.wing !== 'none') { // default 'low'
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.34), matAccent);
    wing.position.set(0, wingY, -1.28);
    body.add(wing);
    for (const side of [1, -1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.1), matDark);
      strut.position.set(side * 0.5, 0.78, -1.26);
      body.add(strut);
    }
  }

  body.scale.setScalar(scale ?? 1);
  return body;
}

function buildExhaust(style, matDark) {
  const g = new THREE.Group();
  const pipes = [];
  const mk = (x, y, z, r = 0.09, len = 0.5, vertical = false) => {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.3, len, 8), matDark);
    pipe.rotation.x = vertical ? 0 : Math.PI / 2;
    pipe.position.set(x, y, z);
    g.add(pipe); pipes.push(pipe);
  };
  if (style === 'stack') {
    mk(-0.16, 0.72, -1.2, 0.08, 0.42, true);
    mk(0.16, 0.72, -1.2, 0.08, 0.42, true);
  } else if (style === 'quad') {
    mk(-0.42, 0.5, -1.32, 0.07); mk(-0.2, 0.56, -1.36, 0.07);
    mk(0.2, 0.56, -1.36, 0.07); mk(0.42, 0.5, -1.32, 0.07);
  } else if (style === 'turbine') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.07, 6, 12), matDark);
    ring.position.set(0, 0.55, -1.4);
    g.add(ring); pipes.push(ring);
  } else { // twin (legacy)
    mk(-0.34, 0.5, -1.35); mk(0.34, 0.5, -1.35);
  }
  return { group: g, pipes };
}

// ---------------------------------------------------------------------------
// Wheels
// ---------------------------------------------------------------------------
function buildWheelSet(wheelGeoSpec, hubColor) {
  const spec = wheelGeoSpec || { radius: 0.42, width: 0.34, hub: 'disc', color: 0x26222a };
  const geo = new THREE.CylinderGeometry(spec.radius, spec.radius, spec.width, 12);
  geo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.95 });
  const hubMat = new THREE.MeshStandardMaterial({ color: hubColor, roughness: 0.5 });
  const hubR = spec.radius * 0.48;

  function makeWheel() {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(geo, tireMat));
    let hub;
    switch (spec.hub) {
      case 'spoke':
        hub = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const sp = new THREE.Mesh(new THREE.BoxGeometry(spec.width + 0.02, hubR * 1.8, 0.06), hubMat);
          sp.rotation.x = (i / 3) * Math.PI;
          hub.add(sp);
        }
        break;
      case 'ring':
        hub = new THREE.Mesh(new THREE.TorusGeometry(hubR, 0.04, 5, 10).rotateY(Math.PI / 2), hubMat);
        break;
      case 'drum':
        hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 1.1, hubR * 1.1, spec.width + 0.04, 9).rotateZ(Math.PI / 2), hubMat);
        break;
      case 'spike': {
        hub = new THREE.Group();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), hubMat);
          sp.position.set(0, Math.sin(a) * hubR, Math.cos(a) * hubR);
          sp.rotation.x = -a + Math.PI / 2;
          hub.add(sp);
        }
        break;
      }
      case 'gear': {
        hub = new THREE.Group();
        const core = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 0.7, hubR * 0.7, spec.width + 0.02, 8).rotateZ(Math.PI / 2), hubMat);
        hub.add(core);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const tooth = new THREE.Mesh(new THREE.BoxGeometry(spec.width * 0.8, 0.08, 0.08), hubMat);
          tooth.position.set(0, Math.sin(a) * hubR, Math.cos(a) * hubR);
          tooth.rotation.x = -a;
          hub.add(tooth);
        }
        break;
      }
      case 'hex':
        hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, spec.width + 0.02, 6).rotateZ(Math.PI / 2), hubMat);
        break;
      default: // disc
        hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 0.8, hubR * 0.8, spec.width + 0.02, 8).rotateZ(Math.PI / 2), hubMat);
        break;
    }
    w.add(hub);
    return w;
  }
  return { makeWheel, radius: spec.radius, width: spec.width };
}

// ---------------------------------------------------------------------------
// Shared assembly
// ---------------------------------------------------------------------------
function assemble({
  bodyColor, accentColor, pilotColor, finish,
  chassisBody, wheelSpec, exhaustStyle, decalPattern, flameColor,
  pilotCharacter,
}) {
  const group = new THREE.Group();
  const matBody = matFor(bodyColor, finish || 'gloss');
  const matAccent = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.5, flatShading: true });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x2b2530, roughness: 0.8 });

  const body = buildChassis(chassisBody || { hull: 'classic', nose: 'wedge', pods: 'side', wing: 'low', scale: 1 },
    matBody, matAccent, matDark, 1);
  group.add(body);

  // pilot -------------------------------------------------------------------
  let charVis = null;
  if (pilotCharacter) {
    charVis = buildCharacter(pilotCharacter);
    charVis.group.position.set(0, 0.62, -0.42);
    body.add(charVis.group);
  } else {
    // Legacy fox pilot (vertical slice look), unchanged.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8),
      new THREE.MeshStandardMaterial({ color: pilotColor, roughness: 0.6, flatShading: true }));
    head.position.set(0, 0.98, -0.42);
    body.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.12), matDark);
    visor.position.set(0, 1.0, -0.14);
    body.add(visor);
    for (const side of [1, -1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 4),
        new THREE.MeshStandardMaterial({ color: pilotColor, roughness: 0.7, flatShading: true }));
      ear.position.set(side * 0.16, 1.28, -0.46);
      body.add(ear);
    }
  }

  // decal -------------------------------------------------------------------
  if (decalPattern && decalPattern !== 'none') {
    const tex = decalTexture(decalPattern, accentColor);
    if (tex) {
      const dm = new THREE.Mesh(
        new THREE.PlaneGeometry(1.0, 0.5),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
      );
      dm.rotation.x = -Math.PI / 2 + 0.12;
      dm.position.set(0, 0.62, 0.75);
      body.add(dm);
    }
  }

  // exhaust -----------------------------------------------------------------
  const exhaust = buildExhaust(exhaustStyle || 'twin', matDark);
  body.add(exhaust.group);

  // wheels ------------------------------------------------------------------
  const wheelSet = buildWheelSet(wheelSpec, accentColor);
  const frontPivots = [];
  const wheels = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.78, 0.42, 1.0);
    const wheel = wheelSet.makeWheel();
    pivot.add(wheel);
    body.add(pivot);
    frontPivots.push(pivot);
    wheels.push(wheel);
  }
  for (const side of [1, -1]) {
    const wheel = wheelSet.makeWheel();
    wheel.position.set(side * 0.82, 0.42, -0.95);
    body.add(wheel);
    wheels.push(wheel);
  }

  // boost flame ---------------------------------------------------------------
  const flameMat = new THREE.MeshBasicMaterial({
    color: flameColor ?? 0x66e8ff, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.5, 8), flameMat);
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0.5, -2.1);
  flame.visible = false;
  body.add(flame);

  // blob shadow ----------------------------------------------------------------
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.25, 18),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;

  return {
    group, body, wheels, frontPivots, flame, flameMat, shadow,
    exhausts: exhaust.pipes, wheelRadius: wheelSet.radius,
    charVis,
  };
}

// Legacy entry point - identical to the vertical slice kart.
export function buildKart(bodyColor, accentColor, pilotColor) {
  return assemble({
    bodyColor, accentColor, pilotColor, finish: 'gloss',
    chassisBody: { hull: 'classic', nose: 'wedge', pods: 'side', wing: 'low', scale: 1 },
    wheelSpec: { radius: 0.42, width: 0.34, hub: 'disc', color: 0x26222a },
    exhaustStyle: 'twin', decalPattern: null, flameColor: 0x66e8ff,
    pilotCharacter: null,
  });
}

// Loadout entry point.
export function buildKartFromLoadout(loadout) {
  const v = loadout.visual;
  return assemble({
    bodyColor: v.bodyColor,
    accentColor: v.accentColor,
    pilotColor: v.pilotColor,
    finish: v.finish,
    chassisBody: v.chassisBody,
    wheelSpec: v.wheel,
    exhaustStyle: v.exhaustStyle,
    decalPattern: v.decalPattern,
    flameColor: v.effectFlame,
    pilotCharacter: loadout.character,
  });
}

// Per-frame visual update from physics state.
export function updateKartVisual(kartVis, vehicle, dt, time) {
  const g = kartVis.group;
  g.position.set(vehicle.pos.x, vehicle.y, vehicle.pos.z);
  g.rotation.y = vehicle.yaw;

  // aerial trick spin
  let trickPitch = 0;
  if (vehicle.trick && vehicle.trick.active) {
    trickPitch = (vehicle.trick.t / 0.72) * Math.PI * 2;
  }

  const body = kartVis.body;
  // wheel spin
  const spin = (vehicle.fSpeed / kartVis.wheelRadius) * dt;
  for (const w of kartVis.wheels) w.rotation.x += spin;
  // steering
  for (const p of kartVis.frontPivots) p.rotation.y = -vehicle.steer * 0.42;

  // body attitude: roll with lateral slide, pitch with accel, hop squash
  const targetRoll = Math.max(-0.22, Math.min(0.22, -vehicle.latSpeed * 0.02));
  const targetPitch = Math.max(-0.14, Math.min(0.14,
    (vehicle.drift.drifting ? -0.06 : 0) + trickPitch));
  body.rotation.z += (targetRoll - body.rotation.z) * Math.min(1, 10 * dt);
  body.rotation.x += (targetPitch - body.rotation.x) * Math.min(1, 12 * dt);
  body.position.y = 0;

  // item-hit spinout visual
  if (vehicle._spinT > 0) {
    vehicle._spinT = Math.max(0, vehicle._spinT - dt);
    body.rotation.y = (1 - vehicle._spinT / 0.85) * Math.PI * 2;
  } else if (body.rotation.y !== 0) {
    body.rotation.y = 0;
  }

  // boost flames
  const boosting = vehicle.boost.boosting;
  kartVis.flame.visible = boosting;
  if (boosting) {
    const flick = 0.8 + Math.sin(time * 40 + vehicle.yaw * 10) * 0.25;
    kartVis.flame.scale.set(flick, 1 + Math.sin(time * 33) * 0.3, flick);
    // hue pulse around the loadout's base flame color (non-accumulating)
    if (!kartVis._flameBase) kartVis._flameBase = new THREE.Color(kartVis.flameMat.color.getHex());
    kartVis.flameMat.color.copy(kartVis._flameBase);
    kartVis.flameMat.color.offsetHSL(Math.sin(time * 20) * 0.06, 0, Math.sin(time * 33) * 0.08);
  }

  // blob shadow follows on the ground
  const sh = kartVis.shadow;
  const groundY = vehicle.surf ? vehicle.surf.y : vehicle.y;
  sh.position.set(vehicle.pos.x, groundY + 0.04, vehicle.pos.z);
  const h = Math.max(0, vehicle.y - groundY);
  const s = Math.max(0.45, 1 - h * 0.12);
  sh.scale.set(s, s, s);
  sh.material.opacity = Math.max(0.06, 0.3 - h * 0.05);

  // reset blink
  if (vehicle.resetTimer > 0) {
    g.visible = Math.floor(time * 12) % 2 === 0;
  } else {
    g.visible = true;
  }
}
