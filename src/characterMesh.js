// ============================================================================
// Procedural original character models. Each pilot is assembled from a
// silhouette spec (head shape / ears / tail / accessory / build scale) so
// every roster member reads as a distinct shape at race speed.
// All geometry is original low-poly primitives; no external assets.
// ============================================================================

import * as THREE from '../lib/three.module.js';

function mat(color, flat = true, rough = 0.7) {
  return new THREE.MeshStandardMaterial({ color, flatShading: flat, roughness: rough });
}

function buildHead(shape, furMat, darkMat) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), furMat);
  g.add(head);
  switch (shape) {
    case 'fox': case 'lynx': case 'cat': {
      const snout = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 6), furMat);
      snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.06, 0.28);
      g.add(snout);
      break;
    }
    case 'bear': {
      const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.2), furMat);
      muzzle.position.set(0, -0.08, 0.24); g.add(muzzle);
      break;
    }
    case 'bird': case 'owl': {
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 4), mat(0xf0a83a));
      beak.rotation.x = Math.PI / 2; beak.position.set(0, -0.04, 0.3);
      g.add(beak);
      if (shape === 'owl') {
        for (const side of [1, -1]) {
          const eye = new THREE.Mesh(new THREE.CircleGeometry(0.1, 8), mat(0xfff6d0, false));
          eye.position.set(side * 0.13, 0.08, 0.27); g.add(eye);
        }
      }
      break;
    }
    case 'shell': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x7a8a5a));
      dome.position.y = 0.06; g.add(dome);
      break;
    }
    case 'bunny': {
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), furMat);
      nose.position.set(0, -0.06, 0.26); g.add(nose);
      break;
    }
    case 'dragon': {
      const snout = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.34), furMat);
      snout.position.set(0, -0.06, 0.3); g.add(snout);
      for (const side of [1, -1]) {
        const frill = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 4), mat(0xff9ab0));
        frill.position.set(side * 0.24, 0.1, -0.1); frill.rotation.z = -side * 0.8;
        g.add(frill);
      }
      break;
    }
    case 'weasel': case 'rat': case 'mole': {
      const snout = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 6), furMat);
      snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.05, 0.3);
      g.add(snout);
      if (shape === 'mole') {
        const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), mat(0xff8aa0));
        noseTip.position.set(0, -0.05, 0.48); g.add(noseTip);
      }
      break;
    }
    case 'bat': {
      const snout = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.18), furMat);
      snout.position.set(0, -0.08, 0.22); g.add(snout);
      for (const side of [1, -1]) {
        const fang = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 4), mat(0xf4f0e6));
        fang.rotation.x = Math.PI; fang.position.set(side * 0.06, -0.16, 0.2);
        g.add(fang);
      }
      break;
    }
    case 'sphinx': {
      const nemes = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.4), mat(0x2a6ab8));
      nemes.position.set(0, 0.2, -0.04); g.add(nemes);
      break;
    }
    default: break;
  }
  // eyes on every head (kept readable at distance)
  for (const side of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), darkMat);
    eye.position.set(side * 0.11, 0.07, 0.26);
    g.add(eye);
  }
  return g;
}

function buildEars(type, furMat) {
  const g = new THREE.Group();
  switch (type) {
    case 'pointed':
      for (const side of [1, -1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 4), furMat);
        ear.position.set(side * 0.16, 0.32, -0.05); ear.rotation.z = -side * 0.15;
        g.add(ear);
      }
      break;
    case 'round':
      for (const side of [1, -1]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.1, 7, 6), furMat);
        ear.position.set(side * 0.2, 0.26, -0.05); g.add(ear);
      }
      break;
    case 'tall':
      for (const side of [1, -1]) {
        const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.34, 3, 6), furMat);
        ear.position.set(side * 0.14, 0.42, -0.06); ear.rotation.z = -side * 0.12;
        g.add(ear);
      }
      break;
    case 'feathers': case 'tufts': {
      const crestMat = type === 'feathers' ? mat(0xbaffec) : furMat;
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26 - i * 0.04, 4), crestMat);
        f.position.set(0, 0.3 + i * 0.02, -0.12 + i * 0.09);
        f.rotation.x = -0.4; g.add(f);
      }
      break;
    }
    case 'fins':
      for (const side of [1, -1]) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 4), mat(0xff9ab0));
        fin.position.set(side * 0.2, 0.22, -0.08); fin.rotation.z = -side * 0.7;
        g.add(fin);
      }
      break;
    case 'horns':
      for (const side of [1, -1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 5), mat(0x3c3244));
        horn.position.set(side * 0.18, 0.3, -0.04); horn.rotation.z = -side * 0.45;
        g.add(horn);
      }
      break;
    case 'none': default: break;
  }
  return g;
}

function buildTail(type, furMat, accentMat) {
  const g = new THREE.Group();
  switch (type) {
    case 'bushy': {
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 6), furMat);
      t.position.set(0, 0.1, -0.42); t.rotation.x = -1.9; g.add(t);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), accentMat);
      tip.position.set(0, 0.28, -0.58); g.add(tip);
      break;
    }
    case 'stub': {
      const t = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), furMat);
      t.position.set(0, 0.02, -0.3); g.add(t);
      break;
    }
    case 'puff': {
      const t = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 6), accentMat);
      t.position.set(0, 0.06, -0.34); g.add(t);
      break;
    }
    case 'feathers': {
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3 - i * 0.05, 0.12), furMat);
        f.position.set(0, 0.12, -0.4 - i * 0.05); f.rotation.x = -0.6;
        g.add(f);
      }
      break;
    }
    case 'fin': {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 4), mat(0x7fd4d4));
      f.position.set(0, 0.14, -0.4); f.rotation.x = -1.2; g.add(f);
      break;
    }
    case 'long': {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.03, 0.6, 5), furMat);
      seg.position.set(0, 0.1, -0.45); seg.rotation.x = -1.35; g.add(seg);
      break;
    }
    case 'bolt': {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.3), mat(0xf0c820));
      b.position.set(0, 0.14, -0.4); b.rotation.x = -0.5; g.add(b);
      break;
    }
    default: break;
  }
  return g;
}

function buildAccessory(type, suitMat, accentMat) {
  const g = new THREE.Group();
  switch (type) {
    case 'goggles': {
      for (const side of [1, -1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 5, 8), suitMat);
        ring.position.set(side * 0.11, 0.07, 0.27); g.add(ring);
      }
      break;
    }
    case 'scarf': {
      const s = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 5, 8), accentMat);
      s.rotation.x = Math.PI / 2; s.position.y = -0.24; g.add(s);
      break;
    }
    case 'helmet': {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.33, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), suitMat);
      h.position.y = 0.05; g.add(h);
      break;
    }
    case 'visor': {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.08), mat(0x182030, false, 0.3));
      v.position.set(0, 0.08, 0.27); g.add(v);
      break;
    }
    case 'bandana': {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.09, 0.44), accentMat);
      b.position.y = -0.2; g.add(b);
      break;
    }
    case 'leaf': {
      const l = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 4), mat(0x6a8f3f));
      l.position.set(0.14, 0.3, 0); l.rotation.z = -0.7; g.add(l);
      break;
    }
    case 'wrench': {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), mat(0x9aa0a8, false, 0.35));
      w.position.set(0.24, -0.1, 0.08); w.rotation.z = 0.6; g.add(w);
      break;
    }
    case 'crown': {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 4), mat(0xffd24a, false, 0.35));
        spike.position.set(Math.cos(a) * 0.16, 0.32, Math.sin(a) * 0.16);
        g.add(spike);
      }
      break;
    }
    case 'lamp': {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.08, 7, 6), mat(0xfff6d0, false, 0.4));
      l.position.set(0, 0.26, 0.18); g.add(l);
      break;
    }
    case 'scar': {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.02), mat(0x6a3a2a));
      s.position.set(0.14, 0.02, 0.26); g.add(s);
      break;
    }
    default: break;
  }
  return g;
}

// Builds a pilot sitting at the kart's cockpit origin.
// Returns { group, head } so the kart can animate the head per-frame.
export function buildCharacter(character) {
  const { silhouette, colors } = character;
  const furMat = mat(colors.fur);
  const suitMat = mat(colors.suit, true, 0.6);
  const accentMat = mat(colors.accent, true, 0.55);
  const darkMat = mat(0x1e1a22, false, 0.5);

  const group = new THREE.Group();

  // torso (suit)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.28, 3, 8), suitMat);
  torso.position.y = -0.05;
  group.add(torso);
  // arms reaching for the wheel
  for (const side of [1, -1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.24, 2, 6), suitMat);
    arm.position.set(side * 0.2, 0.02, 0.18);
    arm.rotation.x = 0.9; arm.rotation.z = -side * 0.35;
    group.add(arm);
  }

  const headPivot = new THREE.Group();
  headPivot.position.y = 0.36;
  headPivot.add(buildHead(silhouette.head, furMat, darkMat));
  headPivot.add(buildEars(silhouette.ears, furMat));
  headPivot.add(buildAccessory(silhouette.accessory, suitMat, accentMat));
  group.add(headPivot);

  const tail = buildTail(silhouette.tail, furMat, accentMat);
  tail.position.y = -0.2;
  group.add(tail);

  const s = silhouette.build ?? 1;
  group.scale.setScalar(s);

  return { group, head: headPivot, tail };
}

// Lightweight per-frame pilot animation: lean into turns, bob with speed.
export function animateCharacter(charVis, vehicle, dt, time) {
  if (!charVis) return;
  const g = charVis.group;

  // Lateral lean from sliding, plus a counter-lean against the terrain roll:
  // the pilot stays roughly upright while the kart banks, instead of being
  // rigidly welded to a chassis that is now tilting with the ground.
  const slideLean = -vehicle.latSpeed * 0.035;
  const counter = -(vehicle.terrainRoll || 0) * 0.45;
  const lean = Math.max(-0.35, Math.min(0.35, slideLean + counter));
  g.rotation.z += (lean - g.rotation.z) * Math.min(1, 8 * dt);

  // Fore/aft body english: the pilot is pushed back climbing and thrown
  // forward on a descent or a landing, then settles again.
  const slopeLean = Math.max(-0.30, Math.min(0.30,
    -(vehicle.terrainPitch || 0) * 0.5 - (vehicle.suspension || 0) * 0.35));
  const airTuck = vehicle.grounded ? 0 : -0.16;   // tucks in while airborne
  const targetPitch = Math.max(-0.42, Math.min(0.42, slopeLean + airTuck));
  g.rotation.x += (targetPitch - g.rotation.x) * Math.min(1, 9 * dt);

  // Head bob: driven by the actual ride, not only by speed. Vertical impacts
  // compress the neck, so rolling over bumps reads as a jolt instead of the
  // head clipping through the chassis.
  const bob = Math.sin(time * (6 + vehicle.speedAbs * 0.5)) * 0.012
    * Math.min(1, vehicle.speedAbs / 10);
  const jolt = -(vehicle.suspension || 0) * 0.07;
  charVis.head.position.y = 0.36 + bob + jolt;
  // look into the slope while grounded, level out in the air
  const lookPitch = -vehicle.steer * 0.12 + (vehicle.grounded ? (vehicle.terrainPitch || 0) * 0.3 : 0);
  charVis.head.rotation.x = Math.max(-0.25, Math.min(0.25, lookPitch));
}
