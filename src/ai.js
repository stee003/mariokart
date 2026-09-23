// ============================================================================
// AIController - drives a kart through the racing line with the SAME physics
// as the player (no speed cheats). Personalities differ in corner speed
// targets, aggression, blocking, mistake rate and boost usage.
// ============================================================================

import { CONFIG } from './config.js';
import { normalizeAngle } from './vehicle.js';
import { ITEMS as ITEMS_BY_ID } from './content/items.js';
import { effectiveParams, DEFAULT_DIFFICULTY } from './aiDifficulty.js';

const A = CONFIG.ai;

export class AIController {
  constructor(vehicle, track, personalityKey) {
    this.vehicle = vehicle;
    this.track = track;
    this.personalityKey = personalityKey;
    this.p = A.personalities[personalityKey];
    this.difficulty = DEFAULT_DIFFICULTY;
    this.dp = effectiveParams(this.p, this.difficulty);
    this.mistakeTimer = 0;
    this.liftTimer = 0;
    this.wobble = 0;
    this.driftCooldown = 0;
    this.driftHold = 0;
    this.offRoadTimer = 0;
    this.stuckTimer = 0;
    this.seed = Math.random() * 1000;
    this.itemCooldown = 1 + Math.random() * 2;
  }

  // Difficulty changes decision quality only - never top speed.
  setDifficulty(tier) {
    this.difficulty = tier;
    this.dp = effectiveParams(this.p, tier);
  }

  // Produces the same input shape the player's InputManager produces.
  update(dt, karts, racing, items = null) {
    const v = this.vehicle;
    const track = this.track;
    const input = { throttle: 0, brake: 0, steer: 0, drift: false, trick: false, item: false };
    if (!v.surf) return input;
    if (!racing) {
      input.throttle = 0;
      return input;
    }

    const s = v.surf.progress;
    const speed = v.speedAbs;

    // --- mistakes ---------------------------------------------------------
    this.mistakeTimer -= dt;
    if (this.mistakeTimer <= 0) {
      this.mistakeTimer = 4 + Math.random() * 8;
      if (Math.random() < this.dp.mistakeRate * 10) {
        this.liftTimer = 0.3 + Math.random() * 0.4;
        this.wobble = (Math.random() - 0.5) * 0.5;
      }
    }
    if (this.liftTimer > 0) this.liftTimer -= dt;

    // --- steering target -----------------------------------------------------
    const lookahead = (A.lookaheadBase + speed * A.lookaheadSpeedK) * this.dp.lookaheadMult;
    const la = track.lineAt(s + lookahead);
    const ahead = track.pointAt(s + lookahead);

    let latTarget = la.prefLat;

    // avoidance & blocking against other karts
    const fwdX = Math.sin(v.yaw), fwdZ = Math.cos(v.yaw);
    for (const other of karts) {
      if (other.vehicle === v) continue;
      const dx = other.vehicle.pos.x - v.pos.x;
      const dz = other.vehicle.pos.z - v.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > A.avoidanceRange || dist < 0.01) continue;
      const along = dx * fwdX + dz * fwdZ;
      const side = dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw);
      if (along > 0 && Math.abs(side) < 2.4) {
        // kart ahead of us: steer around it (more aggressive = closer passes)
        const away = side >= 0 ? -1 : 1;
        latTarget += away * (2.6 - this.p.aggression * 1.2);
      } else if (along < 0 && along > -6) {
        // kart behind us: defensive drivers cover their line
        const theirLat = other.vehicle.surf ? other.vehicle.surf.lateral : side;
        latTarget += Math.sign(theirLat || side) * this.p.blockiness * 1.6;
      }
    }

    const halfW = ahead.width / 2 - 1.6;
    latTarget = Math.max(-halfW, Math.min(halfW, latTarget));
    const target = ahead.pos.clone().addScaledVector(ahead.right, latTarget);

    const desired = Math.atan2(target.x - v.pos.x, target.z - v.pos.z);
    const diff = normalizeAngle(desired - v.yaw);
    input.steer = Math.max(-1, Math.min(1, diff * A.steerGain + this.wobble));

    // --- speed target -----------------------------------------------------
    // minimum target speed along the braking distance ahead, capped by THIS
    // kart's own top speed (the racing line holds the shared corner limits, so
    // a faster build is faster on the straights and identical in the corners).
    const horizon = Math.min(70, 12 + (speed * speed) / (2 * A.brakePlanningDecel));
    const kartCap = v.params.maxSpeed;
    let vTarget = Infinity;
    for (let d = 0; d <= horizon; d += 3.5) {
      vTarget = Math.min(vTarget, track.lineAt(s + d, kartCap).targetSpeed);
    }
    vTarget *= this.dp.cornerSpeed * this.p.targetSpeed;

    if (this.liftTimer > 0) vTarget *= 0.72;

    if (speed < vTarget - 0.6) { input.throttle = 1; input.brake = 0; }
    else if (speed > vTarget + 1.2) { input.throttle = 0; input.brake = 1; }
    else { input.throttle = 0.6; input.brake = 0; }

    // --- drifting through sharp corners --------------------------------------
    this.driftCooldown -= dt;
    const curvAhead = Math.abs(track.lineAt(s + 8).curv);
    if (!v.drift.drifting && this.driftCooldown <= 0 &&
        curvAhead > 0.028 && speed > CONFIG.drift.minSpeed * 0.95 &&
        Math.abs(input.steer) > 0.35 &&
        Math.random() < this.dp.driftEagerness) {
      this.driftHold = 0.5 + curvAhead * 14;
      this.driftCooldown = 2.5;
    }
    if (this.driftHold > 0) {
      this.driftHold -= dt;
      input.drift = true;
      // defensive personalities dump weak charges instead of hoarding them
      if (v.drift.level >= (this.dp.boostUse > 0.8 ? 3 : this.dp.boostUse > 0.6 ? 2 : 1)) {
        this.driftHold = Math.min(this.driftHold, 0.15);
      }
    }

    // --- tricks in the air ----------------------------------------------------
    if (!v.grounded && v.airTime > 0.15 && Math.random() < 0.025) input.trick = true;

    // --- item usage (heuristic, no raw-speed cheating) ------------------------
    this.itemCooldown -= dt;
    if (items && this.itemCooldown <= 0) {
      const heldId = items.heldItem({ vehicle: v });
      if (heldId) {
        const def = ITEMS_BY_ID[heldId];
        if (def && this._shouldUseItem(def, karts, v, track, s)) {
          input.item = true;
          this.itemCooldown = 2.2 + Math.random() * 2.6;
        }
      }
    }

    // --- recovery -------------------------------------------------------------
    const off = v.surf && !v.surf.onRoad && !v.surf.onShoulder;
    if (off) this.offRoadTimer += dt; else this.offRoadTimer = 0;
    if (speed < 1.2) this.stuckTimer += dt; else this.stuckTimer = 0;
    if (this.offRoadTimer > A.recoveryTime || this.stuckTimer > 3.5) {
      v.doReset('ai-recover');
      this.offRoadTimer = 0;
      this.stuckTimer = 0;
    }

    return input;
  }

  // Heuristic decision: should the AI fire the held item now?
  // Skill-flavored but never unfair - it only chooses WHEN to use an item
  // the roulette already gave it.
  _shouldUseItem(def, karts, v, track, s) {
    const eag = Math.min(1.3, this.dp.boostUse);   // item eagerness, skill-scaled
    const skill = this.dp.itemSkill;               // scales use-decision rolls only
    const roll = (base) => Math.random() < Math.min(1, base * skill);
    const fwdX = Math.sin(v.yaw), fwdZ = Math.cos(v.yaw);

    const aheadDist = () => {
      let best = Infinity, any = false;
      for (const other of karts) {
        if (other.vehicle === v) continue;
        const dx = other.vehicle.pos.x - v.pos.x;
        const dz = other.vehicle.pos.z - v.pos.z;
        const along = dx * fwdX + dz * fwdZ;
        const side = Math.abs(dx * fwdZ - dz * fwdX);
        if (along > 0 && side < 4 && along < best) { best = along; any = true; }
      }
      return any ? best : Infinity;
    };
    const behindDist = () => {
      let best = Infinity, any = false;
      for (const other of karts) {
        if (other.vehicle === v) continue;
        const dx = other.vehicle.pos.x - v.pos.x;
        const dz = other.vehicle.pos.z - v.pos.z;
        const along = dx * fwdX + dz * fwdZ;
        if (along < 0 && -along < best) { best = -along; any = true; }
      }
      return any ? best : Infinity;
    };
    const curvHere = Math.abs(track.lineAt(s + 6).curv);
    const straight = curvHere < 0.015;

    switch (def.category) {
      case 'projectile': {
        const d = aheadDist();
        if (d < 42 && straight && roll(0.5 + eag * 0.4)) return true;
        return d < 20 && roll(0.3);
      }
      case 'hazard': {
        // drop traps when someone is close behind or on a straight before a corner
        const bd = behindDist();
        if (bd < 22 && roll(0.4 + eag * 0.3)) return true;
        return straight && roll(0.12);
      }
      case 'buff':
        // use boosts/attack buffs on straights
        return straight && roll(0.35 + eag * 0.45);
      case 'debuff':
      case 'zone': {
        const d = aheadDist();
        return (d < 48 || behindDist() < 30) && roll(0.3 + eag * 0.4);
      }
      case 'utility':
        return roll(0.25 + eag * 0.3);
      default:
        return roll(0.2);
    }
  }
}
