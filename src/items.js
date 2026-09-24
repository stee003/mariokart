// ============================================================================
// ItemSystem - runtime for the Sunforge arsenal (see content/items.js).
//
// Responsibilities:
//   - item boxes (pickup, respawn)
//   - position-weighted roulette (rollItem in content/items.js)
//   - held item (one slot per kart) + activation
//   - entity simulation: projectiles, hazards, walls, zones, swarms, decoys
//   - timed statuses -> per-frame vehicle mods (vehicle.mods)
//   - events out (onEvent) for particles / HUD, audio hooks in
//
// The vehicle controller is NOT rewritten: it simply consumes a `mods` object
// (speedMult, accelMult, steerMult, gripMult, jitter, noDrift, intangible)
// that this system fills every frame.
//
// Effects are DATA, not item names. A spawned entity carries an `fx` record
// describing what it does to a kart that touches it, so several items can share
// one behaviour (a glass patch and a dust trail both slow you) and nothing in
// the simulation has to know which catalog entry created it.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { ITEMS, rollItem, rollItemExcept } from './content/items.js';
import { CONFIG } from './config.js';
import { resolveObstacleContact, KART_HIT_BOTTOM, KART_HIT_TOP } from './track.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// Statuses a cleanse (Forge Ward, Echo Bell) is allowed to remove. Anything
// the player would call "a debuff" belongs here; the signature is that it was
// put on you by somebody else.
const HARMFUL = new Set([
  'stagger', 'blight', 'jinx', 'slip', 'slow', 'thornSpin', 'burnt', 'hexSlow',
]);

// A hit's severity. Weak hits (a single hornet) only nudge; full hits spin the
// kart, dump its held item and cost real speed.
const HIT_WEAK = 0.5;
const HIT_FULL = 1;

export class ItemSystem {
  constructor({ track, scene = null, onEvent = null, audio = null, i18n = null, rng = Math.random }) {
    this.track = track;
    this.scene = scene;
    this.onEvent = onEvent;
    this.audio = audio;
    this.i18n = i18n;
    this.rng = rng;
    this.enabled = true;

    this.boxes = [];                // {pos, home, respawnT, mesh, s, lat}
    this.held = new Map();          // vehicle -> itemId | null
    this.statuses = new Map();      // vehicle -> [{type, t, dur, data}]
    this.entities = [];             // projectiles / hazards / walls / zones ...
    this.shieldCharges = new Map(); // vehicle -> n
    this._tmp = new THREE.Vector3();
  }

  // ------------------------------------------------------------- setup
  setBoxes(defs) {
    this.boxes = defs.map((d) => {
      const p = this.track.pointAt(d.s);
      const pos = p.pos.clone().addScaledVector(p.right, d.lat);
      pos.y = p.pos.y + 1.1;
      // `home` is the authored anchor the box always returns to
      return { pos, home: pos.clone(), respawnT: 0, mesh: null, s: d.s, lat: d.lat };
    });
  }

  heldItem(kart) { return this.held.get(kart.vehicle) ?? null; }

  grantBox(kart) {
    const v = kart.vehicle;
    if (this.held.get(v)) return null;
    const status = this.statuses.get(v) || [];
    if (status.some((s) => s.data?.intangible)) return null;   // phased: no pickups
    const id = this._roll(kart);
    this.held.set(v, id);
    this.audio?.itemSound('get');
    this.onEvent?.('itemGet', { itemId: id, kart, isPlayer: !!kart.isPlayer });
    return id;
  }

  // Position-weighted pickup. Kept in one place so the Kiln Lottery rerolls
  // through exactly the same maths as a box.
  _roll(kart) {
    const pos = kart._racePos ?? 1;
    const total = kart._raceTotal ?? 4;
    return rollItem(this.rng, pos, total);
  }

  // ------------------------------------------------------------- statuses
  addStatus(vehicle, status) {
    let list = this.statuses.get(vehicle);
    if (!list) { list = []; this.statuses.set(vehicle, list); }
    // refresh same-type instead of stacking
    const existing = list.find((s) => s.type === status.type);
    if (existing) { Object.assign(existing, status, { t: 0 }); return; }
    list.push({ ...status, t: 0 });
  }

  removeStatus(vehicle, type) {
    const list = this.statuses.get(vehicle);
    if (!list) return;
    const i = list.findIndex((s) => s.type === type);
    if (i >= 0) list.splice(i, 1);
  }

  cleanse(vehicle) {
    const list = this.statuses.get(vehicle);
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) {
      if (HARMFUL.has(list[i].type)) list.splice(i, 1);
    }
  }

  hasStatus(vehicle, type) {
    return (this.statuses.get(vehicle) || []).some((s) => s.type === type);
  }

  // Merge statuses into the vehicle.mods object the physics consumes.
  applyMods(karts) {
    for (const kart of karts) {
      const v = kart.vehicle;
      const list = this.statuses.get(v) || [];
      if (list.length === 0) { v.mods = null; continue; }
      const m = {
        speedMult: 1, accelMult: 1, steerMult: 1, gripMult: 1,
        jitter: 0, noDrift: false, intangible: false, noItems: false,
      };
      for (const s of list) {
        const d = s.data || {};
        m.speedMult *= d.speedMult ?? 1;
        m.accelMult *= d.accelMult ?? 1;
        m.steerMult *= d.steerMult ?? 1;
        m.gripMult *= d.gripMult ?? 1;
        m.jitter += d.jitter ?? 0;
        m.noDrift = m.noDrift || !!d.noDrift;
        m.intangible = m.intangible || !!d.intangible;
        m.noItems = m.noItems || !!d.noItems;
      }
      v.mods = m;
    }
  }

  isIntangible(vehicle) {
    return (this.statuses.get(vehicle) || []).some((s) => s.data?.intangible);
  }

  // True while a status forbids this kart from firing its held item.
  hasNoItems(vehicle) {
    return (this.statuses.get(vehicle) || []).some((s) => s.data?.noItems);
  }

  // ------------------------------------------------------------- use
  useItem(kart, karts) {
    const v = kart.vehicle;
    const id = this.held.get(v);
    if (!id) return false;
    // Glasswalk is a defensive trade-off: untouchable, but unable to act.
    if (this.hasNoItems(v)) return false;
    const def = ITEMS[id];
    if (!def) { this.held.set(v, null); return false; }
    this.held.set(v, null);
    this.audio?.itemSound(def.sound);
    this.onEvent?.('itemUse', { itemId: id, kart });
    this._activate(def, kart, karts);
    return true;
  }

  // Catalogue entry -> behaviour. Every branch is short: the interesting part
  // lives in the shared spawners and in the entity update below.
  _activate(def, kart, karts) {
    const v = kart.vehicle;
    const p = def.params;
    switch (def.id) {
      // ---- forward attack -------------------------------------------------
      case 'cinder_lance':
        this._spawnProjectile(def, v, null, { pierce: p.pierce });
        break;
      case 'hornet_pod':
        for (let i = 0; i < p.count; i++) {
          const target = this._targetAhead(kart, karts, 62);
          this._spawnProjectile(def, v, target, {
            offset: (i - (p.count - 1) / 2) * p.spread,
            speed: p.speed - i * 1.6,
            weak: p.weakHit,
          });
        }
        break;
      case 'glass_fang':
        this._spawnProjectile(def, v, this._targetAhead(kart, karts, 60), { shatter: p.shatter });
        break;
      case 'kiln_mortar': {
        const target = this._leaderAhead(kart, karts) ?? this._targetAhead(kart, karts, 90);
        if (!target) {
          // nobody ahead: drop it far enough up the road that the karts coming
          // behind have to deal with it (and that it is armed when they arrive)
          const dist = Math.max(28, (v.fSpeed || 20) * p.flight * p.noTargetAhead);
          this._spawnHazard(def, v, this._ahead(v, dist), { ...CRATER, radius: p.radius, armT: p.flight, flight: p.flight });
          break;
        }
        const tv = target.vehicle;
        // lead the target: where it will be when the shell lands
        const land = _v1.copy(tv.pos)
          .addScaledVector(_v2.copy(tv.vel).setY(0), p.flight * p.lead).clone();
        land.y = this.track.surface(land, { main: -1, sc: -1 }).y + 0.4;
        this._spawnHazard(def, v, land, { ...CRATER, radius: p.radius, armT: p.flight, flight: p.flight });
        break;
      }

      // ---- area denial ----------------------------------------------------
      case 'slag_mine':
        this._spawnHazard(def, v, this._behind(v, 4.5), ERUPT(p));
        break;
      case 'thorn_scatter':
        for (let i = 0; i < p.count; i++) {
          const side = (i - (p.count - 1) / 2) * p.spread;
          this._spawnHazard(def, v, this._behindLateral(v, p.back, side), THORNS(p));
        }
        break;
      case 'brass_bulwark':
        this._spawnWall(def, v, { solid: true, slowMult: p.slowMult });
        break;
      case 'dust_veil':
        this._spawnWall(def, v, { gripMult: p.gripMult, jitter: p.jitter, slipDur: p.slipDur });
        break;

      // ---- mobility -------------------------------------------------------
      case 'sunflare':
        v.boost.trigger(p.boostLevel, 'drift');
        // shorter than the boost it comes with: the immunity is a launch
        // window, not a licence
        this.addStatus(v, { type: 'flare', dur: p.immune, data: { intangible: true } });
        this.onEvent?.('itemBurst', { itemId: def.id, kart, pos: v.pos.clone(), radius: 7 });
        break;
      case 'ember_draft':
        this.addStatus(v, {
          type: 'draft', dur: p.duration,
          data: { speedMult: p.speedMult, accelMult: p.accelMult, noDrift: true },
        });
        v.boost.trigger(1, 'pad');
        break;
      case 'glasswalk':
        this.addStatus(v, {
          type: 'glasswalk', dur: p.duration,
          data: { intangible: true, noItems: true, trail: p.trail, trailT: 0 },
        });
        break;
      case 'dune_skip': {
        const fwd = _v1.set(Math.sin(v.yaw), 0, Math.cos(v.yaw));
        v.vel.addScaledVector(fwd, p.forward);
        v.vy = Math.max(v.vy, p.launch);
        v.grounded = false;
        v.pendingFx.spin = false;
        // a little less steering authority while airborne; it ends on landing
        this.addStatus(v, { type: 'skip', dur: 1.4, data: { steerMult: p.airSteer } });
        this.onEvent?.('itemBurst', { itemId: def.id, kart, pos: v.pos.clone(), radius: 5 });
        break;
      }

      // ---- disruption -----------------------------------------------------
      case 'rust_blight': {
        const target = this._leaderAhead(kart, karts);
        if (target) {
          this._applyHit(def, target, 'blight',
            { accelMult: p.accelMult, gripMult: p.gripMult }, p.duration, kart);
        }
        break;
      }
      case 'gyro_jinx': {
        const target = this._targetAhead(kart, karts, 55);
        if (target && this._hitKart(def, target, kart, HIT_FULL)) {
          this.addStatus(target.vehicle, {
            type: 'jinx', dur: p.duration,
            data: { steerMult: p.steerMult, speedMult: p.speedMult },
          });
          target.vehicle._spinT = p.duration;
        }
        break;
      }
      case 'hourglass_hex': {
        const target = this._targetAhead(kart, karts, 70) ?? this._leaderAhead(kart, karts);
        if (!target) break;
        if (this.isIntangible(target.vehicle)) break;
        // the bubble hangs on the VICTIM, so drafting past them is punished too
        this.entities.push({
          kind: 'zone', def, owner: v, follow: target.vehicle,
          pos: target.vehicle.pos.clone(), radius: p.radius,
          windup: p.windup, duration: p.duration,
          life: p.windup + p.duration, slowMult: p.slowMult,
        });
        this.onEvent?.('itemHex', { itemId: def.id, kart, victim: target, pos: target.vehicle.pos.clone() });
        break;
      }

      // ---- protection -----------------------------------------------------
      case 'forge_ward':
        this.cleanse(v);
        this.shieldCharges.set(v, (this.shieldCharges.get(v) || 0) + p.shieldCharge);
        this.onEvent?.('itemWard', { itemId: def.id, kart, pos: v.pos.clone() });
        break;
      case 'echo_bell': {
        this.entities.push({ kind: 'pulse', def, owner: v, life: 0.6, pos: v.pos.clone(), radius: 0 });
        // snapshot: _kill mutates the list
        let broken = 0;
        for (const e of this.entities.slice()) {
          if (e.kind === 'pulse' || e.owner === v) continue;
          const hostile = e.kind === 'hazard' || e.kind === 'wall' || e.kind === 'zone';
          if (hostile && e.pos.distanceTo(v.pos) < p.radius) { this._kill(e); broken++; }
        }
        // pay back a little charge per trap broken
        if (broken >= 3) v.boost.trigger(1, 'drift');
        else if (broken > 0) v.boost.trigger(0, 'trick');
        this.cleanse(v);
        this.onEvent?.('itemBurst', { itemId: def.id, kart, pos: v.pos.clone(), radius: p.radius });
        break;
      }
      case 'mirage_decoy':
        this.entities.push({
          kind: 'decoy', def, owner: v, life: p.duration,
          pos: this._behind(v, 5.5), flashRadius: p.flashRadius, absorbHits: p.absorbHits,
        });
        break;
      case 'storm_cell':
        this.addStatus(v, {
          type: 'storm', dur: p.duration,
          data: { charges: p.charges, zapRadius: p.zapRadius },
        });
        break;
      case 'hex_mirror':
        this.addStatus(v, { type: 'mirror', dur: p.duration, data: { reflects: p.reflects } });
        this.onEvent?.('itemWard', { itemId: def.id, kart, pos: v.pos.clone() });
        break;

      // ---- gamble ---------------------------------------------------------
      case 'kiln_lottery': {
        const nextId = rollItemExcept(this.rng, kart._racePos ?? 1, kart._raceTotal ?? 4, def.id);
        const next = ITEMS[nextId];
        this.audio?.itemSound(next.sound);
        this.onEvent?.('itemReroll', { itemId: nextId, kart, pos: v.pos.clone() });
        this._activate(next, kart, karts);
        break;
      }
      case 'sunforge_heart':
        this.addStatus(v, {
          type: 'heart', dur: p.duration,
          data: { speedMult: p.speedMult, accelMult: p.accelMult, noDrift: true, jitter: 0.06 },
        });
        v.boost.trigger(2, 'drift');
        // the trail is the weapon: a cone of fire behind a kart that is
        // already accelerating away from you
        this.entities.push({
          kind: 'swarm', def, owner: v, life: p.duration, pos: v.pos.clone(), follows: true,
          coneLen: p.burn.coneLen, coneHalfAngle: p.burn.coneHalfAngle,
          dragMult: p.burn.dragMult, burn: true,
        });
        break;

      default: break;
    }
  }

  // ------------------------------------------------------------- helpers
  _ahead(v, dist) {
    return _v1.set(v.pos.x + Math.sin(v.yaw) * dist, v.y, v.pos.z + Math.cos(v.yaw) * dist).clone();
  }
  _behind(v, dist) {
    return _v1.set(v.pos.x - Math.sin(v.yaw) * dist, v.y, v.pos.z - Math.cos(v.yaw) * dist).clone();
  }
  // behind and `side` metres to the kart's right (used for scatter fans)
  _behindLateral(v, back, side) {
    const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
    return _v1.set(v.pos.x - s * back + c * side, v.y, v.pos.z - c * back - s * side).clone();
  }

  _targetAhead(kart, karts, maxDist) {
    const v = kart.vehicle;
    let best = null, bestD = maxDist;
    const fwd = _v1.set(Math.sin(v.yaw), 0, Math.cos(v.yaw));
    for (const other of karts) {
      if (other.vehicle === v || this.isIntangible(other.vehicle)) continue;
      const d = other.vehicle.pos.distanceTo(v.pos);
      if (d > bestD) continue;
      const to = _v2.copy(other.vehicle.pos).sub(v.pos).setY(0).normalize();
      if (to.dot(fwd) < 0.55) continue;
      best = other; bestD = d;
    }
    return best;
  }

  _leaderAhead(kart, karts) {
    // the highest-progress kart ahead of us
    const v = kart.vehicle;
    const myProg = (kart._raceLap ?? 0) * this.track.L + (v.surf?.progress ?? 0);
    let best = null, bestProg = -Infinity;
    for (const other of karts) {
      if (other.vehicle === v || this.isIntangible(other.vehicle)) continue;
      const prog = (other._raceLap ?? 0) * this.track.L + (other.vehicle.surf?.progress ?? 0);
      if (prog > myProg && prog > bestProg) { best = other; bestProg = prog; }
    }
    return best;
  }

  // `opts` carries the per-shot variation: pierce, lateral offset, weak hit,
  // or a shatter effect to leave behind on impact.
  _spawnProjectile(def, v, target, opts = {}) {
    const pos = v.pos.clone(); pos.y += 0.8;
    const yaw = v.yaw + (opts.offset ?? 0);
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.entities.push({
      kind: 'projectile', def, owner: v, target: target?.vehicle ?? null,
      pos, vel: dir.multiplyScalar(opts.speed ?? def.params.speed),
      life: def.params.life,
      pierce: opts.pierce ?? 0, hits: null, weak: !!opts.weak, shatter: opts.shatter ?? null,
    });
  }

  _spawnHazard(def, v, pos, fx, armT = null) {
    pos.y = (this.track.surface(pos, { main: -1, sc: -1 })?.y ?? v.y) + 0.4;
    this.entities.push({
      kind: 'hazard', def, owner: v, pos, fx,
      life: fx.life ?? def.params.life,
      armT: armT ?? fx.armT ?? def.params.armTime ?? 0.8,
      flight: fx.flight ?? 0,
    });
  }

  // Walls take effect immediately. `armT`/`riseT` drive the rise animation;
  // `graceT` is how long the owner is exempt from their own gate (long enough
  // to clear it, not long enough to use it as free cover).
  _spawnWall(def, v, fx) {
    const p = def.params;
    const surf = v.surf || { dir: _v1.set(Math.sin(v.yaw), 0, Math.cos(v.yaw)) };
    const dir = surf.dir ? surf.dir.clone() : _v1.set(Math.sin(v.yaw), 0, Math.cos(v.yaw)).clone();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const pos = this._behind(v, 3);
    const wall = {
      kind: 'wall', def, owner: v, life: p.life, pos,
      dir, right, width: p.width,
      armT: p.riseTime ?? 0.5, riseT: p.riseTime ?? 0.5, graceT: p.ownerGrace ?? 2, fx,
    };
    if (fx.solid) {
      // The hitbox IS the visible gate: a capsule along the plate whose
      // rounded ends sit on the end posts, in the same format race.js uses for
      // track obstacles. A kart whose body touches a post is stopped; one that
      // is clear of it drives past; one that hops high enough flies over.
      const hw = p.width / 2;
      wall.collider = {
        kind: 'capsule',
        x0: pos.x - right.x * hw, z0: pos.z - right.z * hw,
        x1: pos.x + right.x * hw, z1: pos.z + right.z * hw,
        r: p.thickness ?? 0.25,
        y0: pos.y - 0.5, y1: pos.y + (p.height ?? 2.3),
        hit: 'bulwark',
      };
    }
    this.entities.push(wall);
  }

  // ------------------------------------------------------------- hitting
  // Hex Mirror: the first hostile effect that would land on a warded kart is
  // turned around and delivered to whoever threw it. Returns the kart the
  // effect should actually be applied to.
  _resolveVictim(victimKart, attackerKart, def) {
    if (!victimKart || !attackerKart || attackerKart === victimKart) return victimKart;
    const list = this.statuses.get(victimKart.vehicle) || [];
    const mirror = list.find((s) => s.type === 'mirror');
    if (!mirror || mirror.data.reflects <= 0) return victimKart;
    mirror.data.reflects--;
    if (mirror.data.reflects <= 0) this.removeStatus(victimKart.vehicle, 'mirror');
    this.audio?.itemSound('mirror');
    this.onEvent?.('itemReflect', { itemId: def?.id, victim: victimKart, attacker: attackerKart, pos: victimKart.vehicle.pos.clone() });
    return attackerKart;
  }

  // Returns true only when the debuff actually landed (false = phased,
  // shielded), so callers can make the attacker's reward conditional.
  _applyHit(def, victim, statusType, data, duration, attacker = null) {
    const target = this._resolveVictim(victim, attacker, def);
    const tv = target.vehicle;
    if (this.isIntangible(tv)) return false;
    const charges = this.shieldCharges.get(tv) || 0;
    if (charges > 0) {
      this.shieldCharges.set(tv, charges - 1);
      this.onEvent?.('itemBlocked', { itemId: def.id, victim: target, pos: tv.pos });
      this.audio?.itemSound('block');
      return false;
    }
    this.addStatus(tv, { type: statusType, dur: duration, data });
    this.onEvent?.('itemHit', { itemId: def.id, victim: target, attacker, pos: tv.pos });
    return true;
  }

  // The standard "you got hit": spin, speed loss, and - on a full hit - the
  // held item goes out of the slot.
  _hitKart(def, kart, attacker, strength = HIT_FULL) {
    const target = this._resolveVictim(kart, attacker, def);
    const v = target.vehicle;
    if (this.isIntangible(v)) return false;
    const charges = this.shieldCharges.get(v) || 0;
    if (charges > 0) {
      this.shieldCharges.set(v, charges - 1);
      this.onEvent?.('itemBlocked', { itemId: def.id, victim: target, pos: v.pos });
      this.audio?.itemSound('block');
      return false;
    }
    const full = strength >= HIT_FULL;
    if (full) this.held.set(v, null);
    v.vel.multiplyScalar(full ? 0.45 : 0.78);
    this.addStatus(v, {
      type: 'stagger', dur: full ? 0.85 : 0.4,
      data: { speedMult: full ? 0.5 : 0.82, steerMult: full ? 0.25 : 0.7 },
    });
    if (full) {
      v.pendingFx.spin = true;
      v._spinT = 0.85;                    // visual spin consumed by kartMesh
    }
    this.audio?.collision(full ? 1.1 : 0.6);
    this.onEvent?.('itemHit', {
      itemId: def.id, victim: target, attacker, pos: v.pos.clone(), weak: !full,
    });
    return true;
  }

  _removeEntity(i) {
    const e = this.entities[i];
    if (e) e.dead = true;
    this.entities.splice(i, 1);
    return e;
  }

  // Identity-based removal. Index-based splices were unsafe: a handler that
  // despawned its OWN entity mid-iteration shifted the array, and the caller's
  // follow-up splice at the same index then deleted an unrelated entity.
  _kill(entity) {
    if (!entity || entity.dead) return;
    entity.dead = true;
    const at = this.entities.indexOf(entity);
    if (at >= 0) this.entities.splice(at, 1);
  }

  _ownerKart(karts, vehicle) {
    return karts.find((k) => k.vehicle === vehicle) || null;
  }

  // ------------------------------------------------------------- update
  update(dt, karts, raceTime) {
    if (!this.enabled) return;

    this._updateStatuses(dt, karts);
    this._updateBoxes(dt, karts);

    // --- entities -----------------------------------------------------------
    // Snapshot the list: handlers may add or remove entities while running,
    // and every removal is by identity so indices can never go stale.
    for (const e of this.entities.slice()) {
      if (e.dead) continue;
      e.life -= dt;
      if (e.armT !== undefined) e.armT -= dt;
      if (e.graceT !== undefined) e.graceT -= dt;

      switch (e.kind) {
        case 'projectile': this._updateProjectile(e, dt, karts); break;
        case 'hazard': this._updateHazard(e, dt, karts); break;
        case 'wall': this._updateWall(e, dt, karts); break;
        case 'zone': this._updateZone(e, dt, karts); break;
        case 'swarm': this._updateSwarm(e, dt, karts); break;
        case 'pulse': e.radius = (1 - e.life / 0.6) * e.def.params.radius; break;
        case 'decoy': break;
        default: break;
      }

      if (!e.dead && e.life <= 0) this._kill(e);
    }

    this.applyMods(karts);
  }

  _updateStatuses(dt, karts) {
    for (const [vehicle, list] of this.statuses) {
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        s.t += dt;
        const d = s.data || {};

        if (s.type === 'storm' && vehicle.fx?.driftEnd?.boosted && d.charges > 0) {
          // a charged cell arcs backwards every time the owner releases a drift
          d.charges--;
          this._zapBehind(vehicle, d.zapRadius, karts, ITEMS.storm_cell);
          if (d.charges <= 0) { list.splice(i, 1); continue; }
        }

        if (s.type === 'glasswalk' && d.trail) {
          // shedding glass while phased: the cost of being untouchable
          d.trailT = (d.trailT || 0) + dt;
          if (d.trailT >= d.trail.every) {
            d.trailT = 0;
            const at = _v1.set(
              vehicle.pos.x - Math.sin(vehicle.yaw) * 1.6,
              vehicle.y,
              vehicle.pos.z - Math.cos(vehicle.yaw) * 1.6,
            ).clone();
            this._spawnHazard(ITEMS.glass_fang, vehicle, at, {
              kind: 'shards', radius: d.trail.radius, life: d.trail.life,
              slowMult: d.trail.slowMult, slowDur: d.trail.slipDur, armT: 0.15,
            }, 0.15);
          }
        }

        if (s.t >= s.dur) list.splice(i, 1);
      }
      if (list.length === 0) this.statuses.delete(vehicle);
    }
  }

  _updateBoxes(dt, karts) {
    for (const box of this.boxes) {
      if (box.respawnT > 0) { box.respawnT -= dt; continue; }
      for (const kart of karts) {
        const v = kart.vehicle;
        if (this.held.get(v) || this.isIntangible(v)) continue;
        if (Math.abs(v.pos.x - box.pos.x) < 2.4 && Math.abs(v.pos.z - box.pos.z) < 2.4 &&
            Math.abs(v.y - box.pos.y) < 2.5) {
          this.grantBox(kart);
          box.respawnT = 6.5;
          this.onEvent?.('boxPickup', { pos: box.pos, kart });
          break;
        }
      }
      // a box always sits at its authored anchor
      if (box.home && box.pos.distanceToSquared(box.home) > 1e-6) box.pos.copy(box.home);
    }
  }

  _updateProjectile(e, dt, karts) {
    const p = e.def.params;
    // a mirage decoy steals targeting from anything in range
    let target = e.target;                 // a VehicleController (or null)
    let beaconed = false;
    for (const o of this.entities) {
      if (o.kind === 'decoy' && o.owner !== e.owner && o.pos.distanceTo(e.pos) < 40) {
        target = { pos: o.pos }; beaconed = true; break;
      }
    }
    if (target) {
      let keep = true;
      if (!beaconed && p.lockBreakDrift && target.drift?.drifting) keep = false;
      if (keep) {
        _v1.copy(target.pos).sub(e.pos).setY(0).normalize();
        const cur = _v2.copy(e.vel).normalize();
        cur.lerp(_v1, Math.min(1, (p.homing ?? 0) * dt * 14)).normalize();
        e.vel.copy(cur).multiplyScalar(p.speed);
      } else {
        e.target = null;
      }
    }
    e.pos.addScaledVector(e.vel, dt);
    // stay glued to the road surface
    const surf = this.track.surface(e.pos, e._hint || (e._hint = { main: -1, sc: -1 }));
    e.pos.y = surf.y + 0.8;
    // despawn once it has clearly flown past its target
    if (e.target && e.target.pos) {
      const dT = e.pos.distanceTo(e.target.pos);
      e._closest = Math.min(e._closest ?? Infinity, dT);
      if (e._closest < 12 && dT > e._closest + 14) { this._kill(e); return; }
    }

    // mirage decoys absorb hits
    for (let j = this.entities.length - 1; j >= 0; j--) {
      const c = this.entities[j];
      if (c.kind !== 'decoy' || c.owner === e.owner) continue;
      if (c.pos.distanceTo(e.pos) < 2.2) {
        this._kill(e);
        this._kill(c);                     // the decoy is spent absorbing it
        this.onEvent?.('cloneFlash', { pos: c.pos, radius: c.flashRadius });
        for (const kart of karts) {
          if (kart.vehicle !== c.owner && kart.vehicle.pos.distanceTo(c.pos) < c.flashRadius) {
            this._hitKart(c.def, kart, this._ownerKart(karts, c.owner), HIT_WEAK);
          }
        }
        return;
      }
    }

    const attacker = this._ownerKart(karts, e.owner);
    for (const kart of karts) {
      const v = kart.vehicle;
      if (v === e.owner) continue;
      if (v.pos.distanceTo(e.pos) > 2.4) continue;
      if (e.hits && e.hits.has(v)) continue;         // already pierced this one

      if (e.shatter) {
        // the fang breaks up where it lands and leaves the road dirty - but a
        // hit that was denied (shield, phase) earns the thrower no glass
        const landed = this._hitKart(e.def, kart, attacker, HIT_FULL);
        if (!landed) {
          if (this.isIntangible(v)) continue;          // flew through a ghost
          this._kill(e);                               // absorbed by a ward
          return;
        }
        this._spawnHazard(e.def, e.owner, e.pos.clone(), {
          kind: 'shards', radius: e.shatter.radius, life: e.shatter.life,
          slowMult: e.shatter.slowMult, slowDur: e.shatter.slipDur, armT: 0.1,
        }, 0.1);
        this.onEvent?.('itemShatter', { itemId: e.def.id, pos: e.pos.clone(), radius: e.shatter.radius });
        this._kill(e);
        return;
      }

      const applied = this._hitKart(e.def, kart, attacker, e.weak ? HIT_WEAK : HIT_FULL);
      if (!applied && this.isIntangible(v)) continue;   // phased: fly straight through
      if (e.pierce > 0) {
        e.pierce--;
        (e.hits || (e.hits = new Set())).add(v);
        continue;                                        // keep going
      }
      this._kill(e);
      return;
    }
  }

  _updateHazard(e, dt, karts) {
    const fx = e.fx;
    if (e.armT > 0) return;                       // still arming / still in the air
    if (e._burnCd) for (const [v, t] of e._burnCd) e._burnCd.set(v, t - dt);
    const attacker = this._ownerKart(karts, e.owner);
    for (const kart of karts) {
      const v = kart.vehicle;
      if (v === e.owner || this.isIntangible(v)) continue;
      const d = v.pos.distanceTo(e.pos);
      if (d > fx.radius) continue;

      switch (fx.kind) {
        case 'erupt':
          // drag them in, then blow
          _v1.copy(e.pos).sub(v.pos).setY(0).normalize().multiplyScalar(fx.pull * dt * 6);
          v.vel.add(_v1);
          if (d < fx.triggerRadius) {
            v.vy = Math.max(v.vy, fx.launch);
            v.grounded = false;
            this._hitKart(e.def, kart, attacker, HIT_FULL);
            this._kill(e);
            return;
          }
          break;
        case 'thorns':
          this._hitKart(e.def, kart, attacker, HIT_FULL);
          this.addStatus(v, {
            type: 'thornSpin', dur: fx.spinDur,
            data: { steerMult: 0.12, speedMult: 0.68 },
          });
          v._spinT = Math.max(v._spinT || 0, fx.spinDur);
          this._kill(e);
          return;
        case 'shards':
          this.addStatus(v, {
            type: 'slip', dur: fx.slowDur ?? 0.4,
            data: { speedMult: fx.slowMult, gripMult: fx.gripMult ?? 1 },
          });
          break;
        case 'crater': {
          // a burning patch: a weak hit the first time you cross it, then a
          // drag while you stay in. Per-kart cooldown, so it cannot chain-stun.
          e._burnCd = e._burnCd || new Map();
          if ((e._burnCd.get(v) || 0) <= 0) {
            this._hitKart(e.def, kart, attacker, HIT_WEAK);
            e._burnCd.set(v, 1.1);
          }
          this.addStatus(v, {
            type: 'burnt', dur: fx.burnDur ?? 0.8,
            data: { speedMult: 0.62, jitter: 0.22 },
          });
          break;
        }
        default: break;
      }
    }
  }

  _updateWall(e, dt, karts) {
    const fx = e.fx || {};
    const owner = e.owner;
    for (const kart of karts) {
      const v = kart.vehicle;
      // the owner gets a moment of grace leaving their own gate, then it is
      // solid for them too - a Bulwark costs a lane, it is not free cover
      if (v === owner && e.graceT > 0) continue;
      if (this.isIntangible(v)) continue;

      if (fx.solid) {
        // physical gate: the kart's body against the gate's visible volume,
        // resolved exactly like a track obstacle - push out along the contact
        // normal (straight back off the plate, sideways off an end post)
        const hit = e.collider && resolveObstacleContact(e.collider, v.pos.x, v.pos.z,
          v.y + KART_HIT_BOTTOM, v.y + KART_HIT_TOP, CONFIG.vehicle.collisionRadius);
        if (!hit) continue;
        v.pos.x += hit.nx * hit.pen;
        v.pos.z += hit.nz * hit.pen;
        const relN = -(v.vel.x * hit.nx + v.vel.z * hit.nz);
        if (relN > 0) {
          // moving into it: kill that momentum and bounce a little back
          const k = 1.25 / (v.massFactor ?? 1);
          v.vel.x += hit.nx * relN * k;
          v.vel.z += hit.nz * relN * k;
        }
        this.addStatus(v, { type: 'slow', dur: 0.35, data: { speedMult: fx.slowMult ?? 0.5 } });
        this.audio?.collision(0.8);
        continue;
      }
      _v1.copy(v.pos).sub(e.pos);
      const along = _v1.dot(e.dir), lat = _v1.dot(e.right);
      if (Math.abs(lat) > e.width / 2) continue;
      if (Math.abs(along) < 1.4) {
        this.addStatus(v, {
          type: 'slip', dur: fx.slipDur ?? 1.0,
          data: { gripMult: fx.gripMult ?? 1, jitter: fx.jitter ?? 0 },
        });
      }
    }
  }

  _updateZone(e, dt, karts) {
    // a zone either rides with its owner or hangs on its victim
    if (e.follow) e.pos.copy(e.follow.pos);
    else if (e.follows && e.owner) e.pos.copy(e.owner.pos);
    if (e.life > e.duration) return;              // windup phase
    for (const kart of karts) {
      const v = kart.vehicle;
      if (v === e.owner || this.isIntangible(v)) continue;
      if (v.pos.distanceTo(e.pos) < e.radius) {
        this.addStatus(v, {
          type: 'hexSlow', dur: 0.25,
          data: { speedMult: e.slowMult, steerMult: 0.92 },
        });
      }
    }
  }

  _updateSwarm(e, dt, karts) {
    if (e.follows && e.owner) e.pos.copy(e.owner.pos);
    const ownerYaw = e.owner ? e.owner.yaw : 0;
    const attacker = this._ownerKart(karts, e.owner);
    for (const kart of karts) {
      const v = kart.vehicle;
      if (v === e.owner || this.isIntangible(v)) continue;
      _v1.copy(v.pos).sub(e.pos);
      const d = _v1.length();
      if (d > e.coneLen || d < 0.5) continue;
      _v1.normalize();
      const back = _v2.set(-Math.sin(ownerYaw), 0, -Math.cos(ownerYaw));
      if (_v1.dot(back) < Math.cos(e.coneHalfAngle)) continue;
      if (e.burn) {
        // molten wake: a real hit, but rate-limited so one pass is one burn
        if ((e._lastBurn ?? 0) <= 0) {
          this._hitKart(e.def, kart, attacker, HIT_WEAK);
          e._lastBurn = 0.5;
        }
      } else {
        this.addStatus(v, { type: 'slow', dur: 0.3, data: { speedMult: e.dragMult } });
      }
    }
    if (e._lastBurn > 0) e._lastBurn -= dt;
  }

  _zapBehind(vehicle, radius, karts, def) {
    const back = _v1.set(-Math.sin(vehicle.yaw), 0, -Math.cos(vehicle.yaw));
    const attacker = this._ownerKart(karts, vehicle);
    for (const kart of karts) {
      const v = kart.vehicle;
      if (v === vehicle || this.isIntangible(v)) continue;
      const d = v.pos.distanceTo(vehicle.pos);
      if (d > radius) continue;
      _v2.copy(v.pos).sub(vehicle.pos).normalize();
      if (_v2.dot(back) < 0.1) continue;
      this._hitKart(def, kart, attacker, HIT_FULL);
    }
    this.onEvent?.('tempestZap', { pos: vehicle.pos, radius });
  }

  // Convenience for race-mode restarts.
  reset() {
    this.held.clear();
    this.statuses.clear();
    for (const e of this.entities) e.dead = true;   // invalidate stale handles
    this.entities.length = 0;
    this.shieldCharges.clear();
    for (const box of this.boxes) {
      box.respawnT = 0;
      const p = this.track.pointAt(box.s);
      box.pos.copy(p.pos).addScaledVector(p.right, box.lat);
      box.pos.y = p.pos.y + 1.1;
      if (box.home) box.home.copy(box.pos);
    }
  }
}

// ---------------------------------------------------------------------------
// Shared hazard effects. A hazard entity carries one of these as `fx`, so the
// simulation never has to know which catalog entry spawned it.
// ---------------------------------------------------------------------------
const ERUPT = (p) => ({
  kind: 'erupt', radius: p.radius, pull: p.pull, launch: p.launch,
  triggerRadius: 2.2, life: p.life,
});
const THORNS = (p) => ({
  kind: 'thorns', radius: p.radius, spinDur: p.spinDur, life: p.life,
});
const CRATER = {
  kind: 'crater', radius: 5.0, burnDur: 0.8, life: 6.5,
};

export { HARMFUL };
