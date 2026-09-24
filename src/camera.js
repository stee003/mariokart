// ============================================================================
// CameraController - smooth chase camera with dynamic FOV, shake, and
// collision avoidance against environment bounding boxes.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { CONFIG } from './config.js';
import { normalizeAngle } from './vehicle.js';

const C = CONFIG.camera;

export class CameraController {
  constructor(camera, track) {
    this.camera = camera;
    this.track = track;
    this.yaw = 0;
    this.pos = new THREE.Vector3(0, 6, -20);
    this.fov = C.fovBase;
    this.trauma = 0;
    this.shakeSeed = Math.random() * 100;
    this.distance = C.distance;
    this.height = C.height;
    this.colliders = [];        // array of THREE.Box3
    this._ray = new THREE.Ray();
    this._target = new THREE.Vector3();
    this.mode = 'menu';
    this.menuAngle = 0;
    this.cine = null;           // finish cinematic state (see beginCinematic)
    // accessibility multipliers (set from settings; 1 = default feel)
    this.shakeScale = 1;        // reduce for motion-sensitive players
    this.fovScale = 1;          // reduce to damp speed/boost FOV swings
  }

  setColliders(boxes) { this.colliders = boxes; }

  addTrauma(amount) { this.trauma = Math.min(1, this.trauma + amount * this.shakeScale); }

  // Leave the cinematic and hand the camera back to the chase cam.
  endCinematic() { this.cine = null; }

  snapTo(vehicle) {
    this.cine = null;
    this.yaw = vehicle.yaw;
    const back = this._back(_v1);
    this.pos.copy(vehicle.pos).addScaledVector(back, this.distance);
    this.pos.y = vehicle.y + this.height;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(vehicle.pos.x, vehicle.y + 1.2, vehicle.pos.z);
  }

  _back(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  updateMenu(dt) {
    this.menuAngle += dt * 0.06;
    const c = this.track.pointAt(this.track.L * 0.5);
    const r = 95;
    const x = c.pos.x + Math.cos(this.menuAngle) * r;
    const z = c.pos.z + Math.sin(this.menuAngle) * r;
    this.camera.position.lerp(_v1.set(x, c.pos.y + 42, z), Math.min(1, dt * 2));
    this.camera.lookAt(c.pos.x, c.pos.y, c.pos.z);
    this._updateFov(C.fovBase, dt);
  }

  // `anchor` is the kart's INTERPOLATED render position (x, y, z, yaw). The
  // physics pose only updates on the fixed 60 Hz step, so following it
  // directly makes the camera - and therefore the whole world - judder
  // whenever the display rate differs, which reads as terrain jitter.
  // Omitting it falls back to the raw physics pose.
  update(dt, vehicle, boostActive, time, anchor = null) {
    const ax = anchor ? anchor.x : vehicle.pos.x;
    const ay = anchor ? anchor.y : vehicle.y;
    const az = anchor ? anchor.z : vehicle.pos.z;
    const ayaw = anchor ? anchor.yaw : vehicle.yaw;

    // rotate behind the kart
    let diff = normalizeAngle(ayaw - this.yaw);
    this.yaw += diff * Math.min(1, C.turnSmooth * dt);

    const back = this._back(_v1);
    _desired.set(ax, ay, az).addScaledVector(back, this.distance);
    _desired.y = ay + this.height;

    this._avoid(_origin.set(ax, ay + 1.4, az), _desired);

    // keep above the terrain
    const groundY = this.track.surface(_desired, this._hint || (this._hint = { main: -1, sc: -1 }));
    if (_desired.y < groundY.y + C.minHeightAboveGround) {
      _desired.y = groundY.y + C.minHeightAboveGround;
    }

    this.pos.lerp(_desired, Math.min(1, C.followSmooth * dt));

    // --- camera shake -----------------------------------------------------
    this.trauma = Math.max(0, this.trauma - C.shakeDecay * dt);
    const shake = this.trauma * this.trauma;
    const t = time * 37 + this.shakeSeed;
    _shake.set(
      Math.sin(t * 1.3) * 0.5 + Math.sin(t * 2.7) * 0.5,
      Math.sin(t * 1.7 + 2) * 0.4,
      Math.sin(t * 1.1 + 4) * 0.5,
    ).multiplyScalar(shake * 0.55);

    this.camera.position.copy(this.pos).add(_shake);

    // look ahead of the kart for stability
    _look.set(Math.sin(ayaw), 0, Math.cos(ayaw))
      .multiplyScalar(C.lookAhead);
    _look.x += ax; _look.z += az;
    _look.y = ay + 1.3;
    this.camera.lookAt(_look);
    this.camera.rotation.z += shake * Math.sin(t * 2.1) * 0.03;

    // --- dynamic FOV --------------------------------------------------------
    const speedRatio = Math.min(1, vehicle.speedAbs / CONFIG.vehicle.maxSpeed);
    const targetFov = C.fovBase + C.fovSpeedAdd * speedRatio * this.fovScale
      + (boostActive ? C.fovBoostAdd * this.fovScale : 0);
    this._updateFov(targetFov, dt);
  }

  // Pull `desired` back to just in front of the first environment box hit
  // along origin->desired. Shared by the chase cam and the finish cinematic so
  // a sweeping camera never travels through scenery.
  _avoid(origin, desired) {
    if (!this.colliders.length) return;
    _dir.copy(desired).sub(origin);
    const len = _dir.length();
    if (len < 1e-4) return;
    _dir.normalize();
    this._ray.origin.copy(origin);
    this._ray.direction.copy(_dir);
    let closest = len;
    for (const box of this.colliders) {
      const hit = this._ray.intersectBox(box, _hitPoint);
      if (hit) {
        const d = origin.distanceTo(hit);
        if (d < closest) closest = d;
      }
    }
    if (closest < len) {
      desired.copy(origin).addScaledVector(_dir, Math.max(1.6, closest - C.margin));
    }
  }

  // ------------------------------------------------------------- cinematic
  // The finish-line camera. It starts from wherever the chase cam is, then
  // sweeps around the kart while pulling in and dropping toward a
  // three-quarter view, easing the FOV down for a slow push-in. Once the
  // scripted sweep ends it keeps drifting, so the results card is revealed
  // over a live background instead of a frozen frame.
  beginCinematic(opts = {}) {
    this.cine = {
      t: 0,
      a0: opts.yaw != null ? opts.yaw : this.yaw,
      sweep: opts.sweep != null ? opts.sweep : -1.5,   // radians around the kart
      dur: opts.duration != null ? opts.duration : 2.8,
      drift: opts.drift != null ? opts.drift : 0.09,   // rad/s after the sweep
      pull: opts.pull != null ? opts.pull : 0.38,      // how much closer to go
      drop: opts.drop != null ? opts.drop : 0.45,      // how much lower to go
    };
    this._cineHint = { main: -1, sc: -1 };
  }

  // `anchor` is the interpolated render pose, as in update().
  updateCinematic(dt, vehicle, time, anchor = null) {
    if (!this.cine) this.beginCinematic();
    const c = this.cine;
    c.t += dt;
    const k = Math.min(1, c.t / c.dur);
    const e = k * k * (3 - 2 * k);                                  // smoothstep
    const drift = c.t > c.dur ? (c.t - c.dur) * c.drift : 0;
    const ang = c.a0 + c.sweep * e + drift;

    const ax = anchor ? anchor.x : vehicle.pos.x;
    const ay = anchor ? anchor.y : vehicle.y;
    const az = anchor ? anchor.z : vehicle.pos.z;

    const dist = this.distance * (1 - c.pull * e);
    const lift = this.height * (1 - c.drop * e) + 0.55
      + 0.14 * Math.sin(c.t * 1.6) * (1 - 0.5 * e);   // a slow breathing bob

    _desired.set(ax - Math.sin(ang) * dist, ay + lift, az - Math.cos(ang) * dist);
    this._avoid(_origin.set(ax, ay + 1.3, az), _desired);

    // keep above the terrain (the sweep can carry the camera over a bank)
    const g = this.track.surface(_desired, this._cineHint);
    if (_desired.y < g.y + C.minHeightAboveGround) _desired.y = g.y + C.minHeightAboveGround;

    this.pos.lerp(_desired, Math.min(1, 3.4 * dt));

    // --- shake: bleed it off, a celebration should feel smooth -------------
    this.trauma = Math.max(0, this.trauma - C.shakeDecay * 1.7 * dt);
    const shake = this.trauma * this.trauma;
    const st = time * 31 + this.shakeSeed;
    _shake.set(
      Math.sin(st * 1.3) * 0.5 + Math.sin(st * 2.7) * 0.5,
      Math.sin(st * 1.7 + 2) * 0.4,
      Math.sin(st * 1.1 + 4) * 0.5,
    ).multiplyScalar(shake * 0.4);
    this.camera.position.copy(this.pos).add(_shake);

    // look at the kart, rising slightly as the sweep completes
    _look.set(ax, ay + 1.15 + 0.35 * e, az);
    this.camera.lookAt(_look);
    // a touch of dutch tilt through the widest part of the sweep reads as a
    // broadcast camera rather than a locked-on follow cam
    this.camera.rotation.z += Math.sin(e * Math.PI) * 0.04 + shake * Math.sin(st * 2.1) * 0.02;

    this._updateFov(C.fovBase + (4 - 9 * e) * this.fovScale, dt);
  }

  _updateFov(targetFov, dt) {
    this.fov += (targetFov - this.fov) * Math.min(1, C.fovSmooth * dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

const _v1 = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _shake = new THREE.Vector3();
const _look = new THREE.Vector3();
