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

export class VehicleController {
  // `params` overrides CONFIG.vehicle per-kart (stat-based loadouts);
  // with no override the behaviour is byte-for-byte the original slice.
  constructor(track, isPlayer = false, params = null, driftMods = null) {
    this.track = track;
    this.isPlayer = isPlayer;
    this.params = params || CONFIG.vehicle;
    this.driftMods = driftMods;                       // optional per-kart drift tuning
    this.drift = new DriftSystem(driftMods);
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

    this.mods = null;                      // per-frame item-system modifiers
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

    // Item-system modifiers (null when items are disabled).
    const mods = this.mods;
    if (mods && mods.noDrift) input = { ...input, drift: false };

    // --- surface at previous position (used for drag/limits this frame) ---
    const prevSurf = this.surf || track.surface(this.pos, this.hint);

    const fwd = this.forward(_fwd);
    const right = this.right(_right);
    let fSpeed = this.vel.dot(fwd);
    let latSpeed = this.vel.dot(right);

    const b = this.boost.update(dt);

    // --- engine / brakes / reverse -----------------------------------
    const maxEff = this.params.maxSpeed * b.speedMult * (mods?.speedMult ?? 1);
    if (input.throttle > 0) {
      const accel = this.params.accel * (b.active ? b.accelMult : 1) * (mods?.accelMult ?? 1);
      if (fSpeed < maxEff) fSpeed += accel * dt * Math.max(0.35, 1 - Math.max(0, fSpeed) / maxEff);
      else fSpeed -= (fSpeed - maxEff) * 2.2 * dt;           // soft overspeed decay
    } else if (input.brake > 0) {
      if (fSpeed > 0.4) fSpeed -= this.params.braking * dt;
      else fSpeed = Math.max(-this.params.reverseMax, fSpeed - this.params.reverseAccel * dt);
    } else {
      const s = Math.sign(fSpeed);
      fSpeed -= s * Math.min(Math.abs(fSpeed), this.params.coastDrag * dt);
    }
    fSpeed -= fSpeed * this.params.drag * dt;

    // --- off-road penalty ------------------------------------------------
    const onRoad = prevSurf.onRoad, onShoulder = prevSurf.onShoulder;
    if (!onRoad) {
      const cap = this.params.offTrackMaxSpeed;
      if (fSpeed > cap) fSpeed -= (fSpeed - cap) * 3.0 * dt;
      fSpeed *= Math.exp(-this.params.offTrackDrag * (onShoulder ? 0.25 : 1) * dt);
    }

    // --- steering ---------------------------------------------------------
    this.steer += (input.steer - this.steer) * Math.min(1, this.params.steerSmoothing * dt);

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
      const speedFactor = Math.min(1, speedAbs / this.params.steerRefSpeed);
      const highDamp = 1 - this.params.steerHighSpeedDamp *
        Math.min(1, Math.max(0, (speedAbs - this.params.steerRefSpeed) / (this.params.maxSpeed - this.params.steerRefSpeed)));
      const dirSign = fSpeed >= -0.5 ? 1 : -1;
      let steerAuth = drifting ? (this.driftMods?.steerMult ?? CONFIG.drift.steerMult) : 1;
      if (b.active) steerAuth *= CONFIG.boost.steerRetention;
      yawRate = this.steer * this.params.steerRate * speedFactor * highDamp * steerAuth * dirSign;
      if (mods) {
        yawRate *= mods.steerMult ?? 1;
        if (mods.jitter) yawRate += (Math.random() - 0.5) * mods.jitter * 6;
      }
      if (drifting) {
        yawRate += this.drift.dir * CONFIG.drift.driftStrength * Math.min(1, speedAbs / 16);
      }
    } else {
      yawRate = this.steer * this.params.steerRate * CONFIG.air.airSteer;
    }
    this.yaw += yawRate * dt;

    // --- lateral grip -------------------------------------------------------
    let grip = onRoad ? this.params.traction : this.params.offTrackTraction;
    if (mods?.gripMult) grip *= mods.gripMult;
    if (drifting) grip *= this.driftMods?.gripMult ?? CONFIG.drift.gripMult;
    const zoneFx = prevSurf.fx;
    if (zoneFx && zoneFx.gripMult !== 1) grip *= zoneFx.gripMult;   // slippery track zones
    latSpeed *= Math.exp(-grip * dt);

    // --- integrate horizontal ----------------------------------------------
    const nf = this.forward(_fwd);   // yaw may have changed
    const nr = this.right(_right);
    this.vel.copy(nf).multiplyScalar(fSpeed).addScaledVector(nr, latSpeed);
    if (zoneFx) {
      if (zoneFx.wind) this.vel.addScaledVector(prevSurf.right, zoneFx.wind * dt);  // crosswind zones
      if (zoneFx.push) this.vel.addScaledVector(prevSurf.dir, zoneFx.push * dt);    // currents / conveyors
    }
    this.pos.addScaledVector(this.vel, dt);
    this.fSpeed = fSpeed;
    this.latSpeed = latSpeed;

    // --- vertical ------------------------------------------------------------
    // surface() uses pos.y to lock the deck on multi-level sections and
    // vel to keep cross-leg snaps aligned with the kart's heading.
    this.pos.y = this.y;
    const surf = track.surface(this.pos, this.hint, this.vel);
    this.surf = surf;
    const groundY = surf.y;

    if (this.grounded) {
      const prevY = this.y;
      // Snap the kart to the ground, but bound the per-step lift: a real ramp
      // can only raise the kart at ~10-14 m/s, so anything beyond that is a
      // surface discontinuity (deck snap / lane flip) and must not inject
      // climb velocity into the launch bookkeeping.
      const maxLift = 0.22; // m per 60Hz step (falls are snapped unbounded below)
      this.y = prevY + Math.min(groundY - prevY, maxLift);
      const implicit = (this.y - prevY) / dt;
      this.vy = implicit;
      // remember how fast the ground was climbing (ramp launches)
      if (implicit > 0.3) this.climbRate = Math.min(this.climbRate * 0.5 + implicit * 0.5, 14);
      else this.climbRate = Math.max(0, this.climbRate - 18 * dt);
      if (groundY < prevY - 0.4) {
        // terrain fell away - become airborne
        this.grounded = false;
        if (this.climbRate > 0.6) {
          // full launch off actual ramps; soft lip-pop elsewhere
          this.vy = Math.min(this.climbRate * (this.onRamp ? CONFIG.boost.rampLaunchMult : 1.0), this.onRamp ? 99 : 8.5);
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
      this.vy -= CONFIG.air.gravity * dt * (surf.fx?.gravMult ?? 1);   // low-gravity zones
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
    // Shoulders count as "still racing" (curb/grass drag penalises enough);
    // matches the AI's own off-course definition.
    if (onRoad || surf.onShoulder || this.resetTimer > 0) {
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
  get massFactor() { return this.params.massFactor ?? 1; }
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
