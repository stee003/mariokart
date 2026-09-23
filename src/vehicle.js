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
    this.rampContact = 0;          // 0..1 share of the canonical ramp profile
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

    // Terrain attitude, resolved into the KART's frame (not the road's) so
    // the chassis and the pilot lean with the actual slope they are on.
    // Consumed by kartMesh/characterMesh; physics never reads these back.
    this.terrainPitch = 0;      // rad, positive = nose up
    this.terrainRoll = 0;       // rad, positive = right side down
    this.suspension = 0;        // 0..1 compression from the last impact
    this.stepId = 0;            // physics steps taken (render interpolation)

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
    this.pos.y = this.y;
    this.onRamp = !!this.surf.onRamp;
    this.rampContact = this.surf.rampContact || 0;
    this._prevOnSc = this.surf.useShortcut;
    this.drift.cancel();
    this.boost.cancel();
    this.resetTimer = 0;
    this.offTrackTimer = 0;
    this.stuckTimer = 0;
    this.trick.active = false;
    this.airTime = 0;
    this.climbRate = 0;
    this.lastFallSpeed = 0;
    // clear the terrain attitude so a respawn never inherits the pose the
    // kart had when it fell off the track
    this.terrainPitch = 0;
    this.terrainRoll = 0;
    this.suspension = 0;
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
    // Monotonic step counter. Renderers use it to latch the previous pose
    // exactly once per physics step so they can interpolate between steps.
    this.stepId++;
    this.fx = { ...this.pendingFx };
    this.pendingFx = {};
    const track = this.track;

    if (this.resetTimer > 0) {
      this.resetTimer -= dt;
      this.surf = track.surface(this.pos, this.hint);
      this.y = this.surf.y;
      this.pos.y = this.y;
      this._updateAttitude(dt, this.surf);
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
    //
    // Terrain following is driven by DISTANCE TRAVELLED, not by frame count:
    // how far the kart may climb or drop this step scales with how far it
    // actually moved, so bumps and elevation changes feel identical at any
    // frame rate and at any speed. Two distinct cases are separated:
    //   * a real slope        -> follow it smoothly, no air time at all
    //   * a discontinuity     -> re-seat instantly, never inject fake velocity
    this.pos.y = this.y;
    const surf = track.surface(this.pos, this.hint, this.vel);
    this.surf = surf;
    const groundY = surf.y;
    const T = CONFIG.terrain;
    // Horizontal distance covered this step (floored so a stationary kart
    // still settles onto the ground instead of hovering above it).
    const travel = Math.max(0.05, Math.hypot(this.vel.x, this.vel.z) * dt);

    if (this.grounded) {
      const prevY = this.y;
      const delta = groundY - prevY;

      if (delta >= 0) {
        // -------------------------------------------------- climbing
        // A genuine slope can lift the kart at most maxClimbRate; anything
        // steeper is a surface discontinuity (deck snap, lane flip, kerb
        // edge) and is re-seated WITHOUT feeding the launch bookkeeping.
        const maxLift = T.maxClimbRate * dt;
        if (delta > maxLift + T.popThreshold) {
          // Surface discontinuity (deck snap / chute mouth). Re-seat FAST but
          // still continuously: an instant teleport is visible as a pop, while
          // gliding over a few frames reads as the suspension taking the step.
          // No climb credit either way, so this can never fake a ramp launch.
          this.y = prevY + Math.min(delta, T.reseatRate * dt);
          this.vy = 0;
          this.climbRate = 0;
        } else {
          this.y = prevY + Math.min(delta, maxLift);
          const implicit = (this.y - prevY) / dt;
          this.vy = implicit;
          // Remember the REAL rate at which the contact point climbs. The
          // surface gradient is projected onto velocity, so crossing a ramp
          // diagonally (or along its feathered shoulder) cannot receive the
          // full centre-deck launch impulse. This is the same gradient used
          // to pose the chassis below.
          const geometric = Math.max(0,
            (surf.slope ?? 0) * this.vel.dot(surf.dir)
            + (surf.bank ?? 0) * this.vel.dot(surf.right));
          const climb = Math.max(implicit, geometric);
          if (climb > 0.3) this.climbRate = Math.min(this.climbRate * 0.4 + climb * 0.6, T.maxClimbRate);
          else this.climbRate = Math.max(0, this.climbRate - T.liftDecay * dt);
        }
      } else {
        // -------------------------------------------------- descending
        // Drops the wheels can absorb scale with distance travelled: a slope
        // the kart is driving down stays glued, a genuine edge launches it.
        const follow = T.snapBase + T.snapPerMetre * travel;
        // A drop only counts as "the terrain fell away" if the surface the
        // kart is standing on is still the SAME surface. Crossing onto or
        // off a shortcut deck reports a step that is an artefact of the
        // query, not real geometry, so it is re-seated instead of launching
        // the kart off a seam.
        const deckChanged = surf.useShortcut !== this._prevOnSc;
        if (-delta > follow && deckChanged) {
          this.y = prevY - Math.min(-delta, T.reseatRate * dt);
          this.vy = 0;
          this.climbRate = 0;
        } else if (-delta <= follow) {
          this.y = groundY;
          // Inherit the descent as (bounded) downward velocity so crests
          // roll over smoothly instead of chattering between air/ground.
          this.vy = Math.max(delta / dt, -T.crestFallSpeed);
          this.climbRate = Math.max(0, this.climbRate - T.liftDecay * dt);
        } else {
          // terrain genuinely fell away - become airborne
          this.grounded = false;
          this.airTime = 0;
          if (this.climbRate > 0.6) {
            // Launch strength follows how much of the physical ramp the wheels
            // were touching on the previous step. The visible feathered edge
            // therefore produces a proportionally smaller hop than the deck.
            const contact = this.onRamp ? Math.max(0, Math.min(1, this.rampContact)) : 0;
            const launchMult = 1 + (CONFIG.boost.rampLaunchMult - 1) * contact;
            this.vy = Math.min(
              this.climbRate * launchMult,
              contact > 0.01 ? 99 : 8.5);
            this.fx.launch = this.vy;
          } else {
            // rolled off an edge: carry the slope's descent, not a hard 0
            this.vy = Math.max(-T.crestFallSpeed, Math.min(0, this.vy));
          }
          this.climbRate = 0;
        }
      }
      if (this.grounded) {
        this.onRamp = surf.onRamp;
        this.rampContact = surf.rampContact || 0;
      }
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
        const fall = -this.vy;
        this.y = groundY;
        this.grounded = true;
        this.onRamp = surf.onRamp;
        this.rampContact = surf.rampContact || 0;
        const airTime = this.airTime;
        this.airTime = 0;
        this.lastFallSpeed = Math.max(0, fall);
        this.vy = 0;
        // Only a real flight reports a landing. Grazing touchdowns (rolling
        // over a bump, the drift hop) used to spam landing FX/audio every
        // few frames, which is what made the kart look like it was
        // stuttering over uneven ground.
        if (airTime >= T.minAirTime || fall > T.minLandingSpeed) {
          this.fx.landing = this.lastFallSpeed;
        }
        if (this.trick.active) { this.trick.active = false; this.trick.landed = false; }
        if (this.trick.landed) {
          this.trick.landed = false;
          this.boost.trigger(0, 'trick');
          this.fx.trickLanded = true;
        }
        // NOTE: an active drift survives landings (hop-drifts & ramp landings)
      }
    }

    // Keep the public transform coherent with the vertical solver. Several
    // systems (items, particles, ghosts and rendering) read pos as a complete
    // world-space point; leaving pos.y one physics step behind made jump FX
    // visibly detach from the kart and terrain.
    this.pos.y = this.y;
    this._prevOnSc = surf.useShortcut;

    // --- terrain attitude (visual, but simulated on the fixed step) ----------
    this._updateAttitude(dt, surf);

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

  // Resolve the surface gradient into the kart's own frame and smooth it.
  //
  // The surface reports its slope along the ROAD direction and its bank
  // across it. A kart crossing a ramp diagonally therefore needs both
  // projected onto its heading, otherwise the chassis pitches when it
  // should roll (and snaps back the instant the kart straightens up) -
  // that mismatch is what made the animations look broken on elevation
  // changes. Airborne karts level out instead of freezing at the last
  // ground angle. In flight it follows the ballistic velocity instead of
  // playing a disconnected, fixed "jump" pose.
  _updateAttitude(dt, surf) {
    const T = CONFIG.terrain;
    let targetPitch = 0, targetRoll = 0;
    let pitchSmooth = T.pitchSmooth;
    if (this.grounded && surf) {
      const slope = surf.slope || 0;      // rise per metre along road dir
      const bank = surf.bank || 0;        // rise per metre along road right
      // kart heading vs road frame
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const alongDot = fx * surf.dir.x + fz * surf.dir.z;
      const rightDot = fx * surf.right.x + fz * surf.right.z;
      // gradient component the kart drives INTO -> pitch
      const gradFwd = slope * alongDot + bank * rightDot;
      // gradient component across the kart -> roll
      const gradSide = slope * -rightDot + bank * alongDot;
      targetPitch = Math.max(-T.maxPitch, Math.min(T.maxPitch, Math.atan(gradFwd)));
      targetRoll = Math.max(-T.maxRoll, Math.min(T.maxRoll, Math.atan(gradSide)));
    } else if (!this.grounded) {
      // Positive terrainPitch means nose-up. atan2 ties the visual arc to the
      // same vy/gravity integration that determines the physical jump.
      targetPitch = Math.max(-T.maxPitch, Math.min(T.maxPitch,
        Math.atan2(this.vy, Math.max(5, this.speedAbs))));
      pitchSmooth = T.airPitchSmooth;
    }
    this.terrainPitch += (targetPitch - this.terrainPitch) * Math.min(1, pitchSmooth * dt);
    this.terrainRoll += (targetRoll - this.terrainRoll) * Math.min(1, T.rollSmooth * dt);

    // suspension: compress on impact, recover smoothly
    if (this.fx.landing) {
      this.suspension = Math.min(1, this.suspension + this.fx.landing * T.squashPerFallSpeed);
    }
    this.suspension = Math.max(0, this.suspension - T.squashRecover * dt * Math.max(0.2, this.suspension));
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
