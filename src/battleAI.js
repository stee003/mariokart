// ============================================================================
// BattleAI - arena drivers.
//
// Racing AI follows the racing line; that is the wrong brain for a battle
// arena, where the goal is an objective (cores, opponents, zones, survival)
// rather than the next corner. BattleAI therefore picks a target POINT from
// the current mode state and free-roams towards it with the same
// VehicleController input contract the player uses - no physics cheats, no
// teleporting, same speed caps.
//
// chooseObjective() is pure (plain numbers in / plain numbers out) so the
// tactical layer is unit-testable without a renderer or a race.
// ============================================================================

import { CONFIG } from './config.js';
import { normalizeAngle } from './vehicle.js';
import { shouldUseItem, itemDef } from './itemAI.js';
import { effectiveParams, DEFAULT_DIFFICULTY } from './aiDifficulty.js';

const A = CONFIG.ai;

// --------------------------------------------------------------------------
// Tactics (pure): returns { kind, target:{x,z}, reason }
//   kind: 'box' | 'hunt' | 'flee' | 'zone' | 'patrol'
// --------------------------------------------------------------------------
export function chooseObjective(mode, self, others, { boxes = [], zones = [], rng = Math.random } = {}) {
  const here = self.pos;
  const dist = (p) => Math.hypot(p.x - here.x, p.z - here.z);
  const nearest = (list) => {
    let best = null, bestD = Infinity;
    for (const item of list) {
      const d = dist(item.pos || item);
      if (d < bestD) { bestD = d; best = item; }
    }
    return best ? { item: best, d: bestD } : null;
  };
  const alive = others.filter((o) => !o.eliminated);

  // survival: keep away from whoever is closest, unless a crate is right there
  if (mode === 'survival') {
    const threat = nearest(alive);
    if (threat && threat.d < 26) {
      const away = {
        x: here.x - (threat.item.pos.x - here.x),
        z: here.z - (threat.item.pos.z - here.z),
      };
      // steer away from the attacker but stay inside the arena
      return { kind: 'flee', target: away, reason: 'threat' };
    }
    const box = nearest(boxes);
    if (box) return { kind: 'box', target: box.item.pos || box.item, reason: 'cores' };
    return { kind: 'patrol', target: alive.length ? alive[0].pos : { x: 0, z: 0 }, reason: 'idle' };
  }

  // Zone control: defend first, then expand while expansion is cheap, then
  // simply hold what we own (ownership only banks points while occupied).
  if (mode === 'zones') {
    const mine = zones.filter((z) => z.owner === self.kart);
    const stolen = mine.filter((z) => z.contestedBy && z.contestedBy !== self.kart);
    if (stolen.length) {
      const pick = nearest(stolen);
      return { kind: 'zone', target: pick.item.pos, reason: 'defend' };
    }
    // a free zone is only worth leaving for when it is close (or we hold none)
    const expandRange = mine.length >= 2 ? 22 : 34;
    // a zone we are ourselves capturing still counts as free (don't abandon it)
    const free = zones.filter((z) => z.owner !== self.kart && (!z.contestedBy || z.contestedBy === self.kart));
    const freePick = nearest(free);
    if (freePick && (mine.length === 0 || freePick.d < expandRange)) {
      return { kind: 'zone', target: freePick.item.pos, reason: 'capture' };
    }
    // nobody owns anything yet: break up a rival's capture attempt
    const contested = zones.filter((z) => z.owner !== self.kart && z.contestedBy);
    const contestPick = nearest(contested);
    if (mine.length === 0 && contestPick && contestPick.d < 26) {
      return { kind: 'zone', target: contestPick.item.pos, reason: 'contest' };
    }
    if (mine.length) {
      const hold = nearest(mine);
      return { kind: 'zone', target: hold.item.pos, reason: 'hold' };
    }
    if (freePick) return { kind: 'zone', target: freePick.item.pos, reason: 'capture' };
  }

  // elimination / score: hunt. Prefer the weakest, then the closest.
  if (mode === 'elimination' || mode === 'score') {
    const hurt = alive.filter((o) => o.hp <= 1);
    const pool = hurt.length ? hurt : alive;
    let best = null, bestScore = -Infinity;
    for (const o of pool) {
      const d = dist(o.pos);
      const score = -d - o.hp * 6;               // close + damaged = attractive
      if (score > bestScore) { bestScore = score; best = o; }
    }
    if (best) {
      const box = nearest(boxes);
      // grab a crate when it is clearly closer than the fight
      if (box && box.d < dist(best.pos) * 0.6) {
        return { kind: 'box', target: box.item.pos || box.item, reason: 'cores' };
      }
      return { kind: 'hunt', target: best.pos, reason: 'hunt' };
    }
  }

  // energy: crates first, then intercept the leader
  if (mode === 'energy') {
    const box = nearest(boxes);
    if (box) return { kind: 'box', target: box.item.pos || box.item, reason: 'cores' };
    const leader = others
      .filter((o) => !o.eliminated)
      .sort((a, b) => (b.cores || 0) - (a.cores || 0))[0];
    if (leader) return { kind: 'hunt', target: leader.pos, reason: 'leader' };
  }

  const box = nearest(boxes);
  if (box) return { kind: 'box', target: box.item.pos || box.item, reason: 'cores' };
  return { kind: 'patrol', target: alive.length ? alive[0].pos : { x: 0, z: 0 }, reason: 'idle' };
}

export class BattleAI {
  constructor(vehicle, track, personalityKey = 'balanced') {
    this.vehicle = vehicle;
    this.track = track;
    this.personalityKey = personalityKey;
    this.p = A.personalities[personalityKey] || A.personalities.balanced;
    this.difficulty = DEFAULT_DIFFICULTY;
    this.dp = effectiveParams(this.p, this.difficulty);
    this.seed = Math.random() * 1000;
    this.mistakeTimer = 3 + Math.random() * 6;
    this.liftTimer = 0;
    this.driftHold = 0;
    this.driftCooldown = 0;
    this.itemCooldown = 1.5 + Math.random() * 2;
    this.stuckTimer = 0;
    this.objective = null;
    this.objectiveT = 0;
  }

  setDifficulty(tier) {
    this.difficulty = tier;
    this.dp = effectiveParams(this.p, tier);
  }

  // Same input contract as InputManager / AIController.
  update(dt, karts, battle, items = null, arenaDef = null) {
    const v = this.vehicle;
    const input = { throttle: 0, brake: 0, steer: 0, drift: false, trick: false, item: false };
    if (!v.surf || !battle) return input;

    const mode = battle.mode.id;
    const st = battle.per.get(this._wrapper(karts)) || null;
    if (st && st.eliminated) return input;

    // ---- tactical layer (refreshed a few times a second) ----------------
    this.objectiveT -= dt;
    if (!this.objective || this.objectiveT <= 0) {
      this.objectiveT = 0.35;
      this.objective = this._objective(karts, battle, items);
    }

    // ---- mistakes: even a good driver over-commits sometimes -------------
    this.mistakeTimer -= dt;
    if (this.mistakeTimer <= 0) {
      this.mistakeTimer = 5 + Math.random() * 7;
      if (Math.random() < this.dp.mistakeRate * 8) this.liftTimer = 0.3 + Math.random() * 0.5;
    }
    if (this.liftTimer > 0) this.liftTimer -= dt;

    // ---- steer towards the objective -------------------------------------
    let target = this.objective ? this.objective.target : { x: 0, z: 0 };
    let tx = target.x, tz = target.z;

    // keep the aim point inside the arena so we never pin ourselves on a wall
    if (arenaDef && arenaDef.arenaRadius) {
      const r = Math.hypot(tx, tz);
      const lim = arenaDef.arenaRadius - 4;
      if (r > lim) { tx = (tx / r) * lim; tz = (tz / r) * lim; }
      // too close to the barrier: blend the aim point back toward the middle
      const mine = Math.hypot(v.pos.x, v.pos.z);
      if (mine > arenaDef.arenaRadius - 6) {
        tx = tx * 0.6 + 0; tz = tz * 0.6 + 0;   // arena centre is the origin
      }
    }

    // obstacle avoidance: look 9 m ahead in a 3 m corridor
    const hazard = this._avoidHazard();
    if (hazard) {
      const side = hazard.side >= 0 ? -1 : 1;
      tx += side * 6;
      tz += side * 6;
    }

    const desired = Math.atan2(tx - v.pos.x, tz - v.pos.z);
    const diff = normalizeAngle(desired - v.yaw);
    const speed = v.speedAbs;
    // Steering authority scales with speed: a stopped kart should not spin on
    // the spot, a fast one steers as sharply as it can.
    const authority = 0.35 + Math.min(1, speed / 7);
    input.steer = Math.max(-1, Math.min(1, diff * (A.steerGain + 0.4) * authority));

    // ---- throttle / brake -------------------------------------------------
    const distance = Math.hypot(tx - v.pos.x, tz - v.pos.z);
    const turnSharp = Math.abs(diff) > 0.85;

    // Objectives you must HOLD (rings, crates) get an arrival curve so the
    // driver parks on the point instead of orbiting out of capture range.
    const holding = this.objective && (this.objective.kind === 'zone' || this.objective.kind === 'box');
    const maxSpeed = CONFIG.vehicle.maxSpeed * this.dp.targetSpeed;
    let desiredSpeed = maxSpeed;
    if (holding) desiredSpeed = Math.min(maxSpeed, distance * 1.7 + 1.5);
    else if (distance < 5) desiredSpeed = Math.min(maxSpeed, distance * 2.2);

    if (this.liftTimer > 0) {
      input.throttle = 0.25;
      input.brake = 0;
    } else if (turnSharp && speed > 9 && !holding) {
      input.throttle = 0;
      input.brake = 1;
    } else if (speed > desiredSpeed + 1.2) {
      input.throttle = 0;
      input.brake = speed > desiredSpeed + 3 ? 1 : 0.4;
    } else if (speed < desiredSpeed - 0.6) {
      input.throttle = 1;
    } else {
      input.throttle = 0.55;   // hold the point / cruise the last few metres
    }

    // ---- drifting around big direction changes ---------------------------
    this.driftCooldown -= dt;
    if (!v.drift.drifting && this.driftCooldown <= 0 && Math.abs(diff) > 0.5 && !holding &&
        speed > CONFIG.drift.minSpeed && Math.random() < this.dp.driftEagerness) {
      this.driftHold = 0.45 + Math.abs(diff) * 0.5;
      this.driftCooldown = 2.2;
    }
    if (this.driftHold > 0) {
      this.driftHold -= dt;
      input.drift = true;
      if (v.drift.level >= 2) this.driftHold = Math.min(this.driftHold, 0.12);
    }

    // ---- items ------------------------------------------------------------
    this.itemCooldown -= dt;
    if (items && this.itemCooldown <= 0) {
      const held = items.heldItem({ vehicle: v });
      const def = held ? itemDef(held) : null;
      if (def && shouldUseItem({
        def, karts, v, track: this.track, eagerness: this.dp.boostUse,
        skill: this.dp.itemSkill, mode: 'battle',
      })) {
        input.item = true;
        this.itemCooldown = 1.8 + Math.random() * 2.4;
      }
    }

    // ---- unstick ----------------------------------------------------------
    if (speed < 1.0) this.stuckTimer += dt; else this.stuckTimer = 0;
    if (this.stuckTimer > 2.5) { v.doReset('ai-battle-recover'); this.stuckTimer = 0; }

    return input;
  }

  // battle.per is keyed by kart wrapper; find ours once per call.
  _wrapper(karts) {
    if (!this._cachedWrapper || !karts.includes(this._cachedWrapper)) {
      this._cachedWrapper = karts.find((k) => k.vehicle === this.vehicle) || null;
    }
    return this._cachedWrapper;
  }

  _objective(karts, battle, items = null) {
    const selfKart = this._wrapper(karts);
    const state = battle.per.get(selfKart) || {};
    const others = karts.filter((k) => k !== selfKart).map((k) => ({
      kart: k,
      pos: k.vehicle.pos,
      eliminated: battle.per.get(k)?.eliminated,
      hp: battle.per.get(k)?.hp ?? 99,
      cores: battle.per.get(k)?.cores ?? 0,
    }));
    // live crates from the item system (skip ones already taken)
    const boxes = items
      ? items.boxes.filter((b) => b.respawnT <= 0).map((b) => ({ pos: b.pos, s: b.s }))
      : [];
    const self = {
      kart: selfKart, pos: this.vehicle.pos,
      cores: state.cores || 0, hp: state.hp ?? 99,
    };
    return chooseObjective(battle.mode.id, self, others, {
      boxes, zones: battle.zones || [], rng: Math.random,
    });
  }

  // Returns { side } of the nearest obstacle directly ahead, or null.
  _avoidHazard() {
    const cols = this.track.getObstacleColliders ? this.track.getObstacleColliders() : [];
    if (!cols.length) return null;
    const v = this.vehicle;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    for (const c of cols) {
      const dx = c.x - v.pos.x, dz = c.z - v.pos.z;
      const along = dx * fx + dz * fz;
      if (along < 1 || along > 11) continue;
      const side = dx * fz - dz * fx;
      if (Math.abs(side) < c.r + 2.0) return { side, along };
    }
    return null;
  }
}
