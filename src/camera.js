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
  }

  setColliders(boxes) { this.colliders = boxes; }

  addTrauma(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  snapTo(vehicle) {
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

  update(dt, vehicle, boostActive, time) {
    // rotate behind the kart
    const targetYaw = vehicle.yaw;
    let diff = normalizeAngle(targetYaw - this.yaw);
    this.yaw += diff * Math.min(1, C.turnSmooth * dt);

    const back = this._back(_v1);
    _desired.copy(vehicle.pos).addScaledVector(back, this.distance);
    _desired.y = vehicle.y + this.height;

    // --- collision avoidance: don't clip environment geometry ------------
    _origin.set(vehicle.pos.x, vehicle.y + 1.4, vehicle.pos.z);
    _dir.copy(_desired).sub(_origin);
    const len = _dir.length();
    _dir.normalize();
    this._ray.origin.copy(_origin);
    this._ray.direction.copy(_dir);
    let closest = len;
    for (const box of this.colliders) {
      const hit = this._ray.intersectBox(box, _hitPoint);
      if (hit) {
        const d = _origin.distanceTo(hit);
        if (d < closest) closest = d;
      }
    }
    if (closest < len) {
      _desired.copy(_origin).addScaledVector(_dir, Math.max(1.6, closest - C.margin));
    }

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
    _look.set(Math.sin(vehicle.yaw), 0, Math.cos(vehicle.yaw))
      .multiplyScalar(C.lookAhead)
      .add(vehicle.pos);
    _look.y = vehicle.y + 1.3;
    this.camera.lookAt(_look);
    this.camera.rotation.z += shake * Math.sin(t * 2.1) * 0.03;

    // --- dynamic FOV --------------------------------------------------------
    const speedRatio = Math.min(1, vehicle.speedAbs / CONFIG.vehicle.maxSpeed);
    const targetFov = C.fovBase + C.fovSpeedAdd * speedRatio + (boostActive ? C.fovBoostAdd : 0);
    this._updateFov(targetFov, dt);
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
