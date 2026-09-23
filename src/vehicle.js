// ============================================================================
// VehicleController - arcade kart physics.
// Decomposes velocity into forward/lateral components, applies engine,
// braking, grip and yaw each fixed step. Deliberately NOT a simulation:
// everything is shaped for instant, forgiving, fun response.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { CONFIG } from './config.js';
import { DriftSystem } from './drift.js';
import { BoostSystem } from './boost.js';

const V = CONFIG.vehicle;

export class VehicleController {
  constructor(track, isPlayer = false) {
    this.track = track;
    this.isPlayer = isPlayer;
    this.drift = new DriftSystem();
    this.pendingFx = {};
    this.boost = new BoostSystem((level, source) => {
      this.pendingFx.boostStart = { level, source };
    });

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();      // horizontal velocity
    this.yaw = 0;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.onRamp = false;
    this.steer = 0;                       // smoothed analog steer
    this.fSpeed = 0;                      // signed forward speed (cached)
    this.latSpeed = 0;                    // cached lateral speed

    this.surf = null;
    this.hint = { main: -1, sc: -1 };

    this.offTrackTimer = 0;
    this.stuckTimer = 0;
    this.resetTimer = 0;
    this.padTimer = 0;

    this.trick = { active: false, t: 0, landed: false };
    this.airTime = 0;
    this.climbRate = 0;
    this.lastFallSpeed = 0;

    this.fx = {};                          // per-frame FX event flags
  }

  // ------------------------------------------------------------------ setup
  place(slot) {
    this.pos.copy(slot.pos);
    this.yaw = slot.yaw;
    this.vel.set(0, 0, 0);
    this.y = slot.pos.y;
    this.vy = 0;
    this.grounded = true;
    this.fSpeed = 0;
    this.steer = 0;
    this.hint = { main: -1, sc: -1 };
    this.surf = this.track.surface(this.pos, this.hint);
    this.y = this.surf.y;
    this.drift.cancel();
    this.boost.cancel();
    this.resetTimer = 0;
    this.offTrackTimer = 0;
    this.stuckTimer = 0;
    this.trick.active = false;
  }

  forward(out) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  right(out) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  // ------------------------------------------------------------------ reset
  doReset(reason = 'offtrack') {
    const prog = ((this.surf ? this.surf.progress : 0) - 4 + this.track.L) % this.track.L;
    const slot = this.track.placeAt(prog, 0);
    this.place(slot);
    this.resetTimer = CONFIG.recovery.resetDelay;
    this.fx.reset = reason;
  }

  // ------------------------------------------------------------------ step
  // input: {throttle, brake, steer, drift, trick}
  step(dt, input, locked = false) {
    this.fx = { ...this.pendingFx };
    this.pendingFx = {};
    const track = this.track;

    if (this.resetTimer > 0) {
      this.resetTimer -= dt;
      this.surf = track.surface(this.pos, this.hint);
      this.y = this.surf.y;
      return;
    }

    if (locked) input = { throttle: 0, brake: 0, steer: 0, drift: false, trick: false };

    // --- surface at previous position (used for drag/limits this frame) ---
    const prevSurf = this.surf || track.surface(this.pos, this.hint);

    const fwd = this.forward(_fwd);
    const right = this.right(_right);
    let fSpeed = this.vel.dot(fwd);
    let latSpeed = this.vel.dot(right);

    const b = this.boost.update(dt);

    // --- engine / brakes / reverse -----------------------------------
    const maxEff = V.maxSpeed * b.speedMult;
    if (input.throttle > 0) {
      const accel = V.accel * (b.active ? b.accelMult : 1);
      if (fSpeed < maxEff) fSpeed += accel * dt * Math.max(0.35, 1 - Math.max(0, fSpeed) / maxEff);
      else fSpeed -= (fSpeed - maxEff) * 2.2 * dt;           // soft overspeed decay
    } else if (input.brake > 0) {
      if (fSpeed > 0.4) fSpeed -= V.braking * dt;
      else fSpeed = Math.max(-V.reverseMax, fSpeed - V.reverseAccel * dt);
    } else {
      const s = Math.sign(fSpeed);
      fSpeed -= s * Math.min(Math.abs(fSpeed), V.coastDrag * dt);
    }
    fSpeed -= fSpeed * V.drag * dt;

    // --- off-road penalty ------------------------------------------------
    const onRoad = prevSurf.onRoad, onShoulder = prevSurf.onShoulder;
    if (!onRoad) {
      const cap = V.offTrackMaxSpeed;
      if (fSpeed > cap) fSpeed -= (fSpeed - cap) * 3.0 * dt;
      fSpeed *= Math.exp(-V.offTrackDrag * (onShoulder ? 0.25 : 1) * dt);
    }

    // --- steering ---------------------------------------------------------
    this.steer += (input.steer - this.steer) * Math.min(1, V.steerSmoothing * dt);

    // --- drift state machine ---------------------------------------------
    const dEv = this.drift.update(dt, {
      steer: this.steer,
      speed: fSpeed,
      grounded: this.grounded,
      airTime: this.airTime,
      driftHeld: input.drift,
      brake: input.brake > 0,
    });
    if (dEv.started) {
      this.vy = dEv.hop;
      this.grounded = false;
      this.fx.driftStart = true;
    }
    if (dEv.levelChanged) this.fx.driftLevel = dEv.levelChanged;
    if (dEv.ended) {
      this.fx.driftEnd = dEv.ended;
      if (dEv.ended.boosted) this.boost.trigger(dEv.ended.level - 1, 'drift');
    }
    const drifting = this.drift.drifting;

    // --- yaw ---------------------------------------------------------------
    const speedAbs = Math.abs(fSpeed);
    let yawRate = 0;
    if (this.grounded) {
      const speedFactor = Math.min(1, speedAbs / V.steerRefSpeed);
      const highDamp = 1 - V.steerHighSpeedDamp *
        Math.min(1, Math.max(0, (speedAbs - V.steerRefSpeed) / (V.maxSpeed - V.steerRefSpeed)));
      const dirSign = fSpeed >= -0.5 ? 1 : -1;
      let steerAuth = drifting ? CONFIG.drift.steerMult : 1;
      if (b.active) steerAuth *= CONFIG.boost.steerRetention;
      yawRate = this.steer * V.steerRate * speedFactor * highDamp * steerAuth * dirSign;
      if (drifting) {
        yawRate += this.drift.dir * CONFIG.drift.driftStrength * Math.min(1, speedAbs / 16);
      }
    } else {
      yawRate = this.steer * V.steerRate * CONFIG.air.airSteer;
    }
    this.yaw += yawRate * dt;

    // --- lateral grip -------------------------------------------------------
    let grip = onRoad ? V.traction : V.offTrackTraction;
    if (drifting) grip *= CONFIG.drift.gripMult;
    latSpeed *= Math.exp(-grip * dt);

    // --- integrate horizontal ----------------------------------------------
    const nf = this.forward(_fwd);   // yaw may have changed
    const nr = this.right(_right);
    this.vel.copy(nf).multiplyScalar(fSpeed).addScaledVector(nr, latSpeed);
    this.pos.addScaledVector(this.vel, dt);
    this.fSpeed = fSpeed;
    this.latSpeed = latSpeed;

    // --- vertical ------------------------------------------------------------
    const surf = track.surface(this.pos, this.hint);
    this.surf = surf;
    const groundY = surf.y;

    if (this.grounded) {
      const prevY = this.y;
      this.y = groundY;
      const implicit = (this.y - prevY) / dt;
      this.vy = implicit;
      // remember how fast the ground was climbing (ramp launches)
      if (implicit > 0.3) this.climbRate = this.climbRate * 0.5 + implicit * 0.5;
      else this.climbRate = Math.max(0, this.climbRate - 18 * dt);
      if (groundY < prevY - 0.4) {
        // terrain fell away - become airborne
        this.grounded = false;
        if (this.climbRate > 0.6) {
          this.vy = this.climbRate * (this.onRamp ? CONFIG.boost.rampLaunchMult : 1.0);
          this.fx.launch = this.vy;
        } else {
          this.vy = 0;
        }
        this.climbRate = 0;
        this.airTime = 0;
      }
      this.onRamp = surf.onRamp;
    } else {
      this.airTime += dt;
      this.vy -= CONFIG.air.gravity * dt;
      this.y += this.vy * dt;

      // aerial trick
      if (input.trick && !this.trick.active && this.airTime > 0.12) {
        this.trick.active = true;
        this.trick.t = 0;
        this.trick.landed = false;
        this.fx.trickStart = true;
      }
      if (this.trick.active) {
        this.trick.t += dt;
        if (this.trick.t >= CONFIG.air.trickTime) {
          this.trick.active = false;
          this.trick.landed = true;   // completed rotation; cash in on touchdown
        }
      }

      if (this.y <= groundY) {
        this.y = groundY;
        this.grounded = true;
        this.airTime = 0;
        this.lastFallSpeed = -this.vy;
        this.vy = 0;
        this.fx.landing = this.lastFallSpeed;
        if (this.trick.active) { this.trick.active = false; this.trick.landed = false; }
        if (this.trick.landed) {
          this.trick.landed = false;
          this.boost.trigger(0, 'trick');
          this.fx.trickLanded = true;
        }
        // NOTE: an active drift survives landings (hop-drifts & ramp landings)
      }
    }

    // --- boost pads -----------------------------------------------------------
    this.padTimer = Math.max(0, this.padTimer - dt);
    if (this.grounded && this.padTimer <= 0) {
      const pad = track.padAt(surf.progress, surf.lateral, this.pos);
      if (pad) {
        this.padTimer = 1.0;
        this.boost.pad();
        this.fx.pad = true;
      }
    }

    // --- recovery / stuck detection ---------------------------------------------
    if (onRoad || this.resetTimer > 0) {
      this.offTrackTimer = 0;
    } else {
      this.offTrackTimer += dt;
    }
    const hardOut = Math.abs(surf.lateral) > surf.width / 2 + CONFIG.recovery.hardLimitLateral;
    const fell = this.y < surf.y - 6;
    if (hardOut || fell || this.offTrackTimer > CONFIG.recovery.offTrackLimit) {
      this.doReset('offtrack');
      return;
    }
    if (onRoad && input.throttle > 0 && Math.abs(fSpeed) < CONFIG.recovery.stuckSpeed && !b.active) {
      this.stuckTimer += dt;
      if (this.stuckTimer > CONFIG.recovery.stuckTime) { this.doReset('stuck'); return; }
    } else {
      this.stuckTimer = 0;
    }
  }

  // Convenience for HUD/AI
  get speed() { return this.fSpeed; }
  get speedAbs() { return Math.abs(this.fSpeed); }
  get speedKmh() { return Math.abs(this.fSpeed) * 3.6; }
  get progress() { return this.surf ? this.surf.progress : 0; }
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

export function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
