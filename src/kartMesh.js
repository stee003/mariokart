// ============================================================================
// Original kart model builder ("Dune Blazer" style) + per-frame visual
// animation: wheel spin, steering, body roll/pitch, drift hop, boost flames
// and a soft blob shadow. All geometry is original low-poly shapes.
// ============================================================================

import * as THREE from '../lib/three.module.js';

export function buildKart(bodyColor, accentColor, pilotColor) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const matBody = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55, flatShading: true });
  const matAccent = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.5, flatShading: true });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x2b2530, roughness: 0.8 });

  // chassis
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.34, 2.5), matBody);
  hull.position.y = 0.42;
  body.add(hull);
  // nose wedge
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.26, 0.7), matAccent);
  nose.position.set(0, 0.36, 1.45);
  nose.rotation.x = 0.12;
  body.add(nose);
  // side pods
  for (const side of [1, -1]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.5), matDark);
    pod.position.set(side * 0.72, 0.36, -0.1);
    body.add(pod);
  }
  // cockpit + pilot
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.3, 0.8), matDark);
  cockpit.position.set(0, 0.58, -0.35);
  body.add(cockpit);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8),
    new THREE.MeshStandardMaterial({ color: pilotColor, roughness: 0.6, flatShading: true }));
  head.position.set(0, 0.98, -0.42);
  body.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.12), matDark);
  visor.position.set(0, 1.0, -0.14);
  body.add(visor);
  // ears (Dustfox!)
  for (const side of [1, -1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 4),
      new THREE.MeshStandardMaterial({ color: pilotColor, roughness: 0.7, flatShading: true }));
    ear.position.set(side * 0.16, 1.28, -0.46);
    body.add(ear);
  }
  // rear wing
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.34), matAccent);
  wing.position.set(0, 0.98, -1.28);
  body.add(wing);
  for (const side of [1, -1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.1), matDark);
    strut.position.set(side * 0.5, 0.78, -1.26);
    body.add(strut);
  }
  // exhausts
  const exhausts = [];
  for (const side of [1, -1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.5, 8), matDark);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(side * 0.34, 0.5, -1.35);
    body.add(pipe);
    exhausts.push(pipe);
  }

  // wheels: front wheels sit in steering pivots
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x26222a, roughness: 0.95 });
  const hubMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.5 });

  function makeWheel() {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, wheelMat);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 8).rotateZ(Math.PI / 2), hubMat);
    w.add(tire, hub);
    return w;
  }

  const frontPivots = [];
  const wheels = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.78, 0.42, 1.0);
    const wheel = makeWheel();
    pivot.add(wheel);
    body.add(pivot);
    frontPivots.push(pivot);
    wheels.push(wheel);
  }
  for (const side of [1, -1]) {
    const wheel = makeWheel();
    wheel.position.set(side * 0.82, 0.42, -0.95);
    body.add(wheel);
    wheels.push(wheel);
  }

  // boost flames (hidden unless boosting)
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x66e8ff, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.5, 8), flameMat);
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0.5, -2.1);
  flame.visible = false;
  body.add(flame);

  // blob shadow (added to the scene separately, stays on the ground plane)
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.25, 18),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;

  return { group, body, wheels, frontPivots, flame, flameMat, shadow, exhausts, wheelRadius: 0.42 };
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

  // boost flames
  const boosting = vehicle.boost.boosting;
  kartVis.flame.visible = boosting;
  if (boosting) {
    const flick = 0.8 + Math.sin(time * 40 + vehicle.yaw * 10) * 0.25;
    kartVis.flame.scale.set(flick, 1 + Math.sin(time * 33) * 0.3, flick);
    kartVis.flameMat.color.setHSL(0.52 + Math.sin(time * 20) * 0.06, 1, 0.65);
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
