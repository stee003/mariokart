// ============================================================================
// AIController - drives a kart through the racing line with the SAME physics
// as the player (no speed cheats). Personalities differ in corner speed
// targets, aggression, blocking, mistake rate and boost usage.
// ============================================================================

import { CONFIG } from './config.js';
import { normalizeAngle } from './vehicle.js';
import { KART_HIT_BOTTOM, KART_HIT_TOP } from './track.js';
import { ITEMS as ITEMS_BY_ID } from './content/items.js';
import { effectiveParams, DEFAULT_DIFFICULTY } from './aiDifficulty.js';

const A = CONFIG.ai;
const NO_COLLIDERS = Object.freeze([]);

// Probe circles covering one collider, flattened into `out` as x,z,reach
// triples. A box becomes its bounding circle; a capsule (the gear arm) is
// sampled at both ends and the middle so the AI never aims for a gap that only
// exists past the end of the arm.
function colliderProbes(c, out) {
  out.length = 0;
  if (c.kind === 'capsule') {
    out.push(c.x0, c.z0, c.r,
      (c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, c.r,
      c.x1, c.z1, c.r);
  } else if (c.kind === 'box') {
    out.push(c.x, c.z, Math.hypot(c.hx, c.hz));
  } else {
    out.push(c.x, c.z, c.r);
  }
  return out;
}

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
    this._colClock = 0;         // obstacle collider refresh timer
    this._cols = null;
    this._probes = [];          // scratch, reused every frame
    this._waitT = 0;            // time spent holding short of a solid obstacle
    this.resetSide = 1;         // alternates so a stall cannot loop forever
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
    this._items = items;
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
    let lookahead = (A.lookaheadBase + speed * A.lookaheadSpeedK) * this.dp.lookaheadMult;
    // Inside sharp corners cap the lookahead so the pursuit target stays on
    // the near arc — a far target across a hairpin flips the steer sign.
    const curvNear = Math.abs(track.lineAt(s + lookahead * 0.5).curv);
    if (curvNear > 0.02) lookahead = Math.min(lookahead, Math.max(3.2, 1.2 / curvNear));
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

    // --- obstacles ----------------------------------------------------------
    const obs = this._obstacleBias(dt, v, s, speed, latTarget, lookahead);
    latTarget += obs.lat;

    const halfW = ahead.width / 2 - 1.6;
    latTarget = Math.max(-halfW, Math.min(halfW, latTarget));
    const target = ahead.pos.clone().addScaledVector(ahead.right, latTarget);

    const desired = Math.atan2(target.x - v.pos.x, target.z - v.pos.z);
    const diff = normalizeAngle(desired - v.yaw);
    input.steer = Math.max(-1, Math.min(1, diff * A.steerGain + this.wobble));
    // Airborne: holding the same steering input over-rotates the kart during
    // long drops (dives); players keep full air-steer, AI stays gentle.
    if (!v.grounded) input.steer *= 0.3;

    // --- speed target -----------------------------------------------------
    // minimum target speed along the braking distance ahead
    const horizon = Math.min(70, 12 + (speed * speed) / (2 * A.brakePlanningDecel));
    let vTarget = Infinity;
    for (let d = 0; d <= horizon; d += 3.5) {
      vTarget = Math.min(vTarget, track.lineAt(s + d).targetSpeed);
    }
    vTarget *= this.dp.cornerSpeed * this.p.targetSpeed;

    if (this.liftTimer > 0) vTarget *= 0.72;

    // Off-course: ignore corner targets and drive back onto the road with
    // intent (corner braking while stuck on grass makes recovery too slow).
    const offCourse = v.surf && !v.surf.onRoad && !v.surf.onShoulder;
    if (offCourse) vTarget = Math.max(vTarget, 16);

    // Rolling-speed floor on GENTLE sections: crawling below this before
    // drops/jumps leaves no momentum. Tight corners keep their true line
    // speed (e.g. hairpins demand braking below 6).
    const curvSoon = Math.abs(track.lineAt(s + 10).curv);
    if (!offCourse && v.surf && v.surf.onRoad && curvSoon < 0.09) vTarget = Math.max(vTarget, 10);

    // Last word on speed: an obstacle there is no room around yet. Applied
    // after the rolling-speed floor above, or the floor would drive us into it.
    if (!offCourse) vTarget *= obs.brake;

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
    // Don't burn the cooldown pressing a button the item system will refuse
    // (e.g. while phased, which blocks firing).
    if (items && this.itemCooldown <= 0 && !items.hasNoItems?.(v)) {
      const heldId = items.heldItem({ vehicle: v });
      if (heldId) {
        const def = ITEMS_BY_ID[heldId];
        if (def && this._shouldUseItem(def, karts, v, track, s)) {
          input.item = true;
          this.itemCooldown = 2.2 + Math.random() * 2.6;
        }
      }
    }

    // --- wrong direction -------------------------------------------------------
    // After landing backward off a dive crown the kart can drive along the
    // next leg against its direction while still "on road" — detect the
    // heading/dot mismatch and rescue instead of spiralling into the field.
    {
      const rd = v.surf.dir;
      const dot = v.vel.x * rd.x + v.vel.z * rd.z;
      if (dot < -2) this.wrongWayTimer = (this.wrongWayTimer || 0) + dt;
      else this.wrongWayTimer = Math.max(0, (this.wrongWayTimer || 0) - dt);
    }

    // --- recovery -------------------------------------------------------------
    const off = v.surf && !v.surf.onRoad && !v.surf.onShoulder;
    if (off) this.offRoadTimer += dt; else this.offRoadTimer = 0;
    // Holding short of a sweeping obstacle is a decision, not a stall.
    if (speed < 1.2 && !(this._waitT > 0)) this.stuckTimer += dt; else this.stuckTimer = 0;
    const stalled = this.stuckTimer > 3.5;
    if (this.offRoadTimer > A.recoveryTime || stalled || (this.wrongWayTimer || 0) > 1.6) {
      // A stall usually means something is physically in the way, so reappear
      // on the other side of the road instead of in the same trap.
      this.resetSide = -this.resetSide;
      v.doReset('ai-recover', stalled ? this.resetSide * 3.2 : 0);
      this.offRoadTimer = 0;
      this.stuckTimer = 0;
      this.wrongWayTimer = 0;
    }

    return input;
  }

  // ---------------------------------------------------------------- obstacles
  // Reads the road ahead and returns { lat, brake }: a lateral bias that
  // steers around whatever the racing line would otherwise hit, and a speed
  // multiplier that scrubs off pace when the gap is not open yet.
  //
  // Why this exists: obstacle hitboxes now match the visible geometry, so a
  // sliding block presents a FLAT face across the road. Driving the authored
  // line into it stopped the kart dead, and the recovery reset put it back
  // behind the same block - an endless stall loop. Radial push-out from the old
  // oversized circles used to deflect karts around by accident; that luck is
  // gone, so the AI dodges on purpose.
  _obstacleBias(dt, v, s, speed, latTarget, lookahead) {
    const track = this.track;
    const out = { lat: 0, brake: 1 };
    if (!v.surf) return out;
    const walls = this._itemWalls(v);
    const trackHas = !!(track.obstacles && track.obstacles.length);
    if (!trackHas && !walls.length) { this._waitT = 0; return out; }

    // Colliders move (gears turn, sliders sweep), so refresh them often - but
    // not necessarily every frame on every kart.
    if (trackHas) {
      this._colClock -= dt;
      if (this._colClock <= 0 || !this._cols) {
        this._colClock = 1 / 30;
        this._cols = track.getObstacleColliders();
      }
    } else {
      this._cols = NO_COLLIDERS;
    }
    if (!this._cols.length && !walls.length) return out;

    const kartR = CONFIG.vehicle.collisionRadius;
    // Same vertical span race.js uses for the hit test: an obstacle the kart
    // flies over is not an obstacle at all.
    const y0 = v.y + KART_HIT_BOTTOM, y1 = v.y + KART_HIT_TOP;
    const look = Math.max(lookahead + 8, Math.min(54, 15 + speed * A.obstacleLookK));
    const halfW = v.surf.width / 2 - kartR - 0.4;
    const dir = v.surf.dir;
    const probes = this._probes;

    // ---- what does the road ahead actually block? -------------------------
    // Every collider becomes a lateral interval it denies us, in track space.
    const blocks = this._blocks || (this._blocks = []);
    blocks.length = 0;
    let nearest = Infinity;
    let solidAhead = false;
    for (const c of this._cols) {
      if (c.y1 < y0 || c.y0 > y1) continue;
      colliderProbes(c, probes);
      for (let i = 0; i < probes.length; i += 3) {
        const cx = probes[i], cz = probes[i + 1], reach0 = probes[i + 2];
        const dx = cx - v.pos.x, dz = cz - v.pos.z;
        if (dx * dx + dz * dz > (look + 12) * (look + 12)) continue;
        const est = dx * dir.x + dz * dir.z;            // rough distance ahead
        if (est < -3 || est > look) continue;

        // Refine into track space at the obstacle's own progress, so lateral
        // means the same thing for it as it does for us (curves included).
        const p = track.pointAt(s + est);
        const px = cx - p.pos.x, pz = cz - p.pos.z;
        const d = est + px * p.dir.x + pz * p.dir.z;
        if (d < -3 || d > look) continue;
        const lat = px * p.right.x + pz * p.right.z;
        const reach = reach0 + kartR + A.obstacleMargin;
        blocks.push({ d, lo: lat - reach, hi: lat + reach, kind: c.hit });
        if (d < nearest) nearest = d;
        if (c.hit !== 'flame') solidAhead = true;
      }
    }
    // Brass Bulwarks: both ends of the plate go into track space, so the block
    // is the gate's exact lateral span (no false gaps between probe circles).
    // A gate never moves, so it is steered around and scrubbed for, but never
    // waited out - that is what `wallAhead` (not `solidAhead`) means below.
    let wallAhead = false, nearestWall = false;
    for (const w of walls) {
      const c = w.collider;
      if (c.y1 < y0 || c.y0 > y1) continue;
      const mx = (c.x0 + c.x1) / 2, mz = (c.z0 + c.z1) / 2;
      const dx = mx - v.pos.x, dz = mz - v.pos.z;
      if (dx * dx + dz * dz > (look + 12) * (look + 12)) continue;
      const est = dx * dir.x + dz * dir.z;
      if (est < -3 || est > look) continue;
      const p = track.pointAt(s + est);
      const d = est + (mx - p.pos.x) * p.dir.x + (mz - p.pos.z) * p.dir.z;
      if (d < -3 || d > look) continue;
      const la = (c.x0 - p.pos.x) * p.right.x + (c.z0 - p.pos.z) * p.right.z;
      const lb = (c.x1 - p.pos.x) * p.right.x + (c.z1 - p.pos.z) * p.right.z;
      const reach = c.r + kartR + A.itemWallMargin;
      blocks.push({ d, lo: Math.min(la, lb) - reach, hi: Math.max(la, lb) + reach, kind: c.hit, wall: true });
      if (d < nearest) { nearest = d; nearestWall = true; }
      wallAhead = true;
    }
    if (!blocks.length) { this._waitT = 0; return out; }

    // Only the cluster around the nearest obstacle constrains the line right
    // now; whatever is further away gets handled when it becomes the nearest.
    const windowEnd = Math.min(look, nearest + 14);
    const iv = [];
    for (const b of blocks) {
      if (b.d > windowEnd) continue;
      iv.push(b);
    }
    iv.sort((a, b) => a.lo - b.lo);
    const merged = [];
    for (const b of iv) {
      const last = merged[merged.length - 1];
      if (last && b.lo <= last[1]) { last[1] = Math.max(last[1], b.hi); last[2] = last[2] || !!b.wall; }
      else merged.push([b.lo, b.hi, !!b.wall]);
    }
    const blocked = (lat) => merged.some(([lo, hi]) => lat > lo && lat < hi);

    // ---- pick a lateral target that is actually open ----------------------
    // Candidates: hold the line, slip just past either edge of a blockage, or
    // (last resort) hug the outside of the road.
    const cands = this._cands || (this._cands = []);
    cands.length = 0;
    cands.push(latTarget);
    for (let m = 0; m < merged.length; m++) {
      const [lo, hi, gate] = merged[m];
      if (!gate) { cands.push(lo, hi); continue; }
      // A gate is static, so aim for real clearance past its end instead of
      // grazing the edge - but never more than half the free gap, so a tight
      // lane gets threaded down the middle.
      const below = lo - Math.max(-halfW, m > 0 ? merged[m - 1][1] : -halfW);
      const above = Math.min(halfW, m + 1 < merged.length ? merged[m + 1][0] : halfW) - hi;
      cands.push(lo - Math.max(0, Math.min(A.itemWallClearance, below / 2)),
        hi + Math.max(0, Math.min(A.itemWallClearance, above / 2)));
    }
    cands.push(-halfW, halfW);
    let target = null;
    let bestCost = Infinity;
    // Around a gate, where the kart already IS counts as much as the racing
    // line: a gate dropped mid-road makes both lanes equally far from the
    // line, and without this the choice flips on a hair of line drift and the
    // kart swerves across the gate into the far lane.
    const here = v.surf.lateral;
    const stick = nearestWall ? 1 : 0;
    for (const cand of cands) {
      if (cand < -halfW || cand > halfW || blocked(cand)) continue;
      // prefer a small move, and slightly prefer the middle of the road
      const cost = Math.abs(cand - latTarget) + Math.max(0, Math.abs(cand) - halfW + 0.6) * 0.8 +
        Math.abs(cand - here) * stick;
      if (cost < bestCost) { bestCost = cost; target = cand; }
    }
    const open = target !== null;
    if (!open) {
      if (wallAhead && !solidAhead) {
        // only a gate in the way and no clean lane: take whichever road edge
        // it blocks least (a glancing hit off an end post beats a head-on one)
        const pen = (lat) => {
          let worst = 0;
          for (const [lo, hi] of merged) if (lat > lo && lat < hi) worst = Math.max(worst, Math.min(lat - lo, hi - lat));
          return worst;
        };
        const pl = pen(-halfW), pr = pen(halfW);
        target = Math.abs(pl - pr) < 0.3 ? (here < 0 ? -halfW : halfW) : (pl < pr ? -halfW : halfW);
      } else {
        target = Math.sign(latTarget || 1) * halfW;
      }
    }
    target = Math.max(-halfW, Math.min(halfW, target));

    // Full authority up close, a gentle bias from far away (no twitching).
    // A gate is committed to early: it will not move out of the way.
    const urgency = 1 - Math.min(1, Math.max(0, nearest) / look);
    const authority = nearestWall ? Math.min(1, 0.75 + 0.5 * urgency) : 0.4 + 0.6 * urgency;
    out.lat = (target - latTarget) * authority;

    // Some solid obstacles sweep square across the whole road - a gear arm
    // turned broadside, a slider mid-sweep - so for a moment there is no open
    // lateral at all. That is waited out: brake to a hold just short of it and
    // go the instant a gap appears. Waiting is bounded, because taking the hit
    // and being knocked clear beats stalling forever. Flame hazards are never
    // waited for: a burn costs less than a stop.
    if (!open && solidAhead) {
      this._waitT += dt;
      if (this._waitT < A.obstacleWaitLimit) {
        out.lat *= 0.35;
        out.brake = 0;
        return out;
      }
    } else {
      this._waitT = Math.max(0, this._waitT - dt * 2);
    }

    // Scrub speed when the gap will not be open in time.
    const stopping = (speed * speed) / (2 * A.brakePlanningDecel);
    const need = Math.abs(target - v.surf.lateral);
    if (nearest < stopping + need) {
      out.brake = Math.max(solidAhead || wallAhead ? A.obstacleBrakeFloor : 0.8,
        Math.min(1, (nearest + 5) / (stopping + need + 7)));
    }
    return out;
  }

  // Solid item walls (Brass Bulwark) this kart must steer around. None while
  // the kart is phased (Glasswalk drives straight through), and none for the
  // owner while it is still inside its own gate's grace window.
  _itemWalls(v) {
    const items = this._items;
    if (!items || !items.entities || !items.entities.length) return NO_COLLIDERS;
    if (items.isIntangible && items.isIntangible(v)) return NO_COLLIDERS;
    const out = this._wallBuf || (this._wallBuf = []);
    out.length = 0;
    for (const e of items.entities) {
      if (e.kind !== 'wall' || !e.collider || e.dead) continue;
      if (e.owner === v && e.graceT > 0) continue;
      out.push(e);
    }
    return out;
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
