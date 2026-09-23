// ============================================================================
// ItemSystem - runtime for the original power-up arsenal.
//
// Responsibilities:
//   - item boxes (pickup, respawn)
//   - position-weighted roulette (rollItem in content/items.js)
//   - held item (one slot per kart) + activation
//   - entity simulation: projectiles, hazards, zones, decoys, walls
//   - timed statuses -> per-frame vehicle mods (vehicle.mods)
//   - events out (onEvent) for particles / HUD, audio hooks in
//
// The vehicle controller is NOT rewritten: it simply consumes a `mods`
// object (speedMult, accelMult, steerMult, gripMult, jitter, noDrift,
// intangible) that this system fills every frame.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { ITEMS, rollItem } from './content/items.js';
import { normalizeAngle } from './vehicle.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

const HARMFUL = new Set(['anchor', 'snare', 'slip', 'stagger', 'siphonVictim', 'jitterZone']);

export class ItemSystem {
  constructor({ track, scene = null, onEvent = null, audio = null, i18n = null, rng = Math.random }) {
    this.track = track;
    this.scene = scene;
    this.onEvent = onEvent;
    this.audio = audio;
    this.i18n = i18n;
    this.rng = rng;
    this.enabled = true;

    this.boxes = [];                // {pos, respawnT, mesh}
    this.held = new Map();          // vehicle -> itemId | null
    this.statuses = new Map();      // vehicle -> [{type, t, dur, data}]
    this.entities = [];             // projectiles / hazards / zones / decoys / walls
    this.shieldCharges = new Map(); // vehicle -> n
    this._tmp = new THREE.Vector3();
  }

  // ------------------------------------------------------------- setup
  setBoxes(defs) {
    this.boxes = defs.map((d) => {
      const p = this.track.pointAt(d.s);
      const pos = p.pos.clone().addScaledVector(p.right, d.lat);
      pos.y = p.pos.y + 1.1;
      return { pos, respawnT: 0, mesh: null, s: d.s, lat: d.lat };
    });
  }

  heldItem(kart) { return this.held.get(kart.vehicle) ?? null; }

  grantBox(kart) {
    const v = kart.vehicle;
    if (this.held.get(v)) return;
    const status = this.statuses.get(v) || [];
    if (status.some((s) => s.data?.intangible)) return;   // phased: no pickups
    // position-based roulette
    const pos = kart._racePos ?? 1;
    const total = kart._raceTotal ?? 4;
    const id = rollItem(this.rng, pos, total);
    this.held.set(v, id);
    this.audio?.itemSound('get');
    this.onEvent?.('itemGet', { itemId: id, kart, isPlayer: !!kart.isPlayer });
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
      const m = { speedMult: 1, accelMult: 1, steerMult: 1, gripMult: 1, jitter: 0, noDrift: false, intangible: false, noItems: false };
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
        if (s.type === 'snare') m.steerMult *= -1;        // reversed steering
      }
      v.mods = m;
    }
  }

  isIntangible(vehicle) {
    return (this.statuses.get(vehicle) || []).some((s) => s.data?.intangible);
  }

  // ------------------------------------------------------------- use
  useItem(kart, karts) {
    const v = kart.vehicle;
    const id = this.held.get(v);
    if (!id) return false;
    const def = ITEMS[id];
    if (!def) { this.held.set(v, null); return false; }
    this.held.set(v, null);
    this.audio?.itemSound(def.sound);
    this.onEvent?.('itemUse', { itemId: id, kart });
    this._activate(def, kart, karts);
    return true;
  }

  _activate(def, kart, karts) {
    const v = kart.vehicle;
    const p = def.params;
    switch (def.id) {
      case 'flux_bolt':
      case 'echo_snare':
      case 'slipstream_harpoon': {
        const target = this._targetAhead(kart, karts, 60);
        this._spawnProjectile(def, v, target);
        break;
      }
      case 'gravity_anchor': {
        const target = this._leaderAhead(kart, karts);
        if (target) this._applyHit(def, target, 'anchor', { speedMult: p.speedMult, noDrift: true }, p.duration);
        break;
      }
      case 'kinetic_siphon': {
        const target = this._targetAhead(kart, karts, p.maxRange);
        if (target) {
          this._applyHit(def, target, 'siphonVictim', { speedMult: 1 - p.drain }, p.duration);
          this.addStatus(v, { type: 'siphonOwner', dur: p.duration, data: { speedMult: 1 + p.drain, sourceVehicle: target.vehicle } });
        }
        break;
      }
      case 'mirage_clone':
        this.entities.push({ kind: 'decoy', def, owner: v, life: p.duration,
          pos: this._behind(v, 5.5), flashRadius: p.flashRadius, absorbHits: p.absorbHits });
        break;
      case 'pulse_ring': {
        this.entities.push({ kind: 'pulse', def, owner: v, life: 0.6, pos: v.pos.clone(), radius: 0 });
        // cleanse + convert nearby hazards
        for (let i = this.entities.length - 2; i >= 0; i--) {
          const e = this.entities[i];
          if (e.kind === 'hazard' && e.owner !== v && e.pos.distanceTo(v.pos) < p.radius) {
            this._removeEntity(i);
            v.boost.trigger(0, 'trick'); // small charge reward
          }
        }
        this.cleanse(v);
        break;
      }
      case 'overdrive_core':
        this.addStatus(v, { type: 'overdrive', dur: p.duration,
          data: { speedMult: p.speedMult, accelMult: p.accelMult, steerMult: p.steerPenalty, noDrift: true, jitter: 0.08 } });
        v.boost.trigger(1, 'pad');
        break;
      case 'vortex_mine':
        this._spawnHazard(def, v, this._behind(v, 4.5));
        break;
      case 'static_bloom':
        this._spawnHazard(def, v, this._ahead(v, p.throwDist));
        break;
      case 'graviton_well':
        this._spawnHazard(def, v, this._ahead(v, p.throwDist));
        break;
      case 'prism_wall':
      case 'aurora_veil': {
        const surf = v.surf || { dir: _v1.set(Math.sin(v.yaw), 0, Math.cos(v.yaw)), progress: 0 };
        const dir = surf.dir ? surf.dir.clone() : _v1.set(Math.sin(v.yaw), 0, Math.cos(v.yaw)).clone();
        const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
        this.entities.push({ kind: 'wall', def, owner: v, life: p.life, pos: this._behind(v, 3),
          dir, right, width: p.width, armT: 1.0 });
        break;
      }
      case 'phase_shield':
        this.addStatus(v, { type: 'phase', dur: p.duration, data: { intangible: true, noItems: true } });
        break;
      case 'time_ripple':
        this.entities.push({ kind: 'zone', def, owner: v, life: p.windup + p.duration,
          pos: v.pos.clone(), radius: p.radius, slowMult: p.slowMult, windup: p.windup, follows: true });
        break;
      case 'magnet_surge':
        this.addStatus(v, { type: 'magnet', dur: p.duration, data: { pullRadius: p.pullRadius, pullForce: p.pullForce } });
        break;
      case 'repair_drone':
        this.cleanse(v);
        this.shieldCharges.set(v, (this.shieldCharges.get(v) || 0) + p.shieldCharge);
        v.boost.trigger(0, 'trick');
        this.entities.push({ kind: 'drone', def, owner: v, life: 1.6, pos: v.pos.clone() });
        break;
      case 'ion_lash': {
        for (const other of karts) {
          if (other.vehicle === v || this.isIntangible(other.vehicle)) continue;
          const d = other.vehicle.pos.distanceTo(v.pos);
          if (d > p.arcRadius) continue;
          const toOther = _v1.copy(other.vehicle.pos).sub(v.pos).setY(0).normalize();
          const fwd = _v2.set(Math.sin(v.yaw), 0, Math.cos(v.yaw));
          if (toOther.dot(fwd) < Math.cos(p.arcHalfAngle)) continue;
          other.vehicle.vel.addScaledVector(toOther, p.knockback);
          // steal a slice of their drift charge as boost
          const stolen = Math.min(other.vehicle.drift.charge, 1.2) * p.stealBoost;
          other.vehicle.drift.charge = Math.max(0, other.vehicle.drift.charge - 1.2);
          if (stolen > 0.3) v.boost.trigger(0, 'trick');
          this.onEvent?.('itemHit', { itemId: def.id, victim: other, attacker: kart, pos: other.vehicle.pos });
        }
        break;
      }
      case 'decoy_beacon':
        this.entities.push({ kind: 'beacon', def, owner: v, life: p.life, pos: this._ahead(v, p.throwDist), retarget: true });
        break;
      case 'tempest_cell':
        this.addStatus(v, { type: 'tempest', dur: p.duration, data: { charges: p.charges, zapRadius: p.zapRadius } });
        break;
      case 'nano_swarm':
        this.entities.push({ kind: 'swarm', def, owner: v, life: p.duration, pos: v.pos.clone(),
          coneLen: p.coneLen, coneHalfAngle: p.coneHalfAngle, dragMult: p.dragMult, follows: true });
        break;
      case 'chrono_shard':
        this.addStatus(v, { type: 'chrono', dur: 4, data: { snapshot: Math.max(10, v.speedAbs), speedMult: p.speedMult } });
        v.boost.trigger(0, 'trick');
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
    // the highest-progress kart ahead of us (or race leader if we lead)
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

  _spawnProjectile(def, v, target) {
    const pos = v.pos.clone(); pos.y += 0.8;
    const dir = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
    this.entities.push({
      kind: 'projectile', def, owner: v, target: target?.vehicle ?? null,
      pos, vel: dir.multiplyScalar(def.params.speed), life: def.params.life,
    });
  }

  _spawnHazard(def, v, pos) {
    pos.y = (v.surf?.y ?? v.y) + 0.4;
    this.entities.push({ kind: 'hazard', def, owner: v, pos, life: def.params.life, armT: def.params.armTime ?? 0.8 });
  }

  _applyHit(def, victim, statusType, data, duration) {
    const vv = victim.vehicle;
    if (this.isIntangible(vv)) return;
    const charges = this.shieldCharges.get(vv) || 0;
    if (charges > 0) {
      this.shieldCharges.set(vv, charges - 1);
      this.onEvent?.('itemBlocked', { itemId: def.id, victim, pos: vv.pos });
      this.audio?.itemSound('phase');
      return;
    }
    this.addStatus(vv, { type: statusType, dur: duration, data });
    this.onEvent?.('itemHit', { itemId: def.id, victim, pos: vv.pos });
  }

  _hitKart(def, kart, attacker) {
    const v = kart.vehicle;
    if (this.isIntangible(v)) return false;
    const charges = this.shieldCharges.get(v) || 0;
    if (charges > 0) {
      this.shieldCharges.set(v, charges - 1);
      this.onEvent?.('itemBlocked', { itemId: def.id, victim: kart, pos: v.pos });
      return false;
    }
    // stagger: brief spin + slowdown; held item dropped
    this.held.set(v, null);
    v.vel.multiplyScalar(0.45);
    this.addStatus(v, { type: 'stagger', dur: 0.85, data: { speedMult: 0.5, steerMult: 0.25 } });
    v.pendingFx.spin = true;
    v._spinT = 0.85;                      // visual spin consumed by kartMesh
    this.audio?.collision(1.1);
    this.onEvent?.('itemHit', { itemId: def.id, victim: kart, attacker, pos: v.pos.clone() });
    return true;
  }

  _removeEntity(i) {
    const e = this.entities[i];
    this.entities.splice(i, 1);
    return e;
  }

  // ------------------------------------------------------------- update
  update(dt, karts, raceTime) {
    if (!this.enabled) return;

    // --- statuses ticking ---------------------------------------------------
    for (const [vehicle, list] of this.statuses) {
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        s.t += dt;
        if (s.type === 'tempest') {
          // zap on drift-boost release
          if (vehicle.fx?.driftEnd?.boosted && s.data.charges > 0) {
            s.data.charges--;
            this._zapBehind(vehicle, s.data.zapRadius, karts);
            if (s.data.charges <= 0) { list.splice(i, 1); continue; }
          }
        }
        if (s.type === 'chrono') {
          // restore snapshot speed if slowed hard
          if (vehicle.speedAbs < s.data.snapshot * 0.55 && vehicle.grounded) {
            const fwd = _v1.set(Math.sin(vehicle.yaw), 0, Math.cos(vehicle.yaw));
            vehicle.vel.copy(fwd).multiplyScalar(s.data.snapshot);
            this.onEvent?.('chronoRestore', { vehicle, pos: vehicle.pos });
            list.splice(i, 1); continue;
          }
        }
        if (s.t >= s.dur) list.splice(i, 1);
      }
      if (list.length === 0) this.statuses.delete(vehicle);
    }

    // --- item boxes -----------------------------------------------------------
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
    }

    // --- magnet surge pulls boxes toward the kart ------------------------------
    for (const kart of karts) {
      const mag = (this.statuses.get(kart.vehicle) || []).find((s) => s.type === 'magnet');
      if (!mag) continue;
      for (const box of this.boxes) {
        if (box.respawnT > 0) continue;
        const d = box.pos.distanceTo(kart.vehicle.pos);
        if (d < mag.data.pullRadius && d > 1.5) {
          _v1.copy(kart.vehicle.pos).sub(box.pos).normalize().multiplyScalar(mag.data.pullForce * dt);
          box.pos.add(_v1);
        }
      }
    }

    // --- entities ----------------------------------------------------------------
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      e.life -= dt;
      if (e.armT !== undefined) e.armT -= dt;

      switch (e.kind) {
        case 'projectile': this._updateProjectile(e, dt, karts, i); break;
        case 'hazard': this._updateHazard(e, dt, karts); break;
        case 'wall': this._updateWall(e, dt, karts); break;
        case 'zone': this._updateZone(e, dt, karts); break;
        case 'swarm': this._updateSwarm(e, dt, karts); break;
        case 'pulse': e.radius = (1 - e.life / 0.6) * e.def.params.radius; break;
        case 'decoy': case 'beacon': case 'drone': break;
        default: break;
      }

      if (e.life <= 0) this._removeEntity(i);
    }

    this.applyMods(karts);
  }

  _updateProjectile(e, dt, karts, idx) {
    const p = e.def.params;
    // decoy beacons steal targeting
    let target = e.target;                 // a VehicleController (or null)
    let beaconed = false;
    for (const o of this.entities) {
      if (o.kind === 'beacon' && o.retarget && o.pos.distanceTo(e.pos) < 40) {
        target = { pos: o.pos }; beaconed = true; break;
      }
    }
    if (target) {
      let keep = true;
      if (!beaconed) {
        // flux bolt lock breaks if the target drifts; harpoon breaks on boost
        if (p.lockBreakDrift && target.drift?.drifting) keep = false;
        else if (p.breakOnTargetBoost && target.boost?.boosting) keep = false;
      }
      if (keep) {
        _v1.copy(target.pos).sub(e.pos).setY(0).normalize();
        const cur = _v2.copy(e.vel).normalize();
        cur.lerp(_v1, Math.min(1, p.homing * dt * 14)).normalize();
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
      if (e._closest < 12 && dT > e._closest + 14) {
        this._removeEntity(this.entities.indexOf(e));
        return;
      }
    }

    // mirage clones absorb hits
    for (let j = this.entities.length - 1; j >= 0; j--) {
      const c = this.entities[j];
      if (c.kind !== 'decoy' || c.owner === e.owner) continue;
      if (c.pos.distanceTo(e.pos) < 2.2) {
        this._removeEntity(this.entities.indexOf(e));
        this.onEvent?.('cloneFlash', { pos: c.pos, radius: c.flashRadius });
        for (const kart of karts) {
          if (kart.vehicle !== c.owner && kart.vehicle.pos.distanceTo(c.pos) < c.flashRadius) {
            this.addStatus(kart.vehicle, { type: 'stagger', dur: 0.5, data: { speedMult: 0.6, steerMult: 0.4 } });
          }
        }
        return;
      }
    }

    for (const kart of karts) {
      const v = kart.vehicle;
      if (v === e.owner) continue;
      if (v.pos.distanceTo(e.pos) < 2.4) {
        let applied = false;
        if (e.def.id === 'echo_snare') {
          applied = this._hitKart(e.def, kart, this._ownerKart(karts, e.owner));
          if (applied) this.addStatus(v, { type: 'snare', dur: e.def.params.reverseSteerDur, data: {} });
        } else if (e.def.id === 'slipstream_harpoon') {
          // tether: pull the OWNER toward the target instead of punishing it
          this.addStatus(e.owner, { type: 'harpoon', dur: e.def.params.pullDuration,
            data: { targetVehicle: v, pullForce: e.def.params.pullForce } });
          applied = true;
        } else {
          applied = this._hitKart(e.def, kart, this._ownerKart(karts, e.owner));
        }
        if (applied || e.def.id === 'slipstream_harpoon') {
          const at = this.entities.indexOf(e);
          if (at >= 0) this._removeEntity(at);
          return;
        }
      }
    }
  }

  _updateHazard(e, dt, karts) {
    const p = e.def.params;
    if (e.armT > 0) return;
    for (const kart of karts) {
      const v = kart.vehicle;
      if (v === e.owner || this.isIntangible(v)) continue;
      const d = v.pos.distanceTo(e.pos);
      if (e.def.id === 'vortex_mine') {
        if (d < p.radius) {
          _v1.copy(e.pos).sub(v.pos).setY(0).normalize().multiplyScalar(p.pull * dt * 6);
          v.vel.add(_v1);
        }
        if (d < 2.2) {
          v.vy = Math.max(v.vy, p.launch);
          v.grounded = false;
          this._hitKart(e.def, kart, this._ownerKart(karts, e.owner));
          const at = this.entities.indexOf(e);
          if (at >= 0) this._removeEntity(at);
          return;
        }
      } else if (e.def.id === 'static_bloom') {
        if (d < p.radius) {
          this.addStatus(v, { type: 'bloom', dur: 0.5, data: { noDrift: true, jitter: p.jitter } });
        }
      } else if (e.def.id === 'graviton_well') {
        if (d < p.radius && d > 0.8) {
          _v1.copy(e.pos).sub(v.pos).setY(0).normalize().multiplyScalar(p.pull * dt);
          v.vel.add(_v1);
        }
      }
    }
  }

  _updateWall(e, dt, karts) {
    const p = e.def.params;
    for (const kart of karts) {
      const v = kart.vehicle;
      if (v === e.owner && e.armT > -1.5) continue;
      _v1.copy(v.pos).sub(e.pos);
      const along = _v1.dot(e.dir), lat = _v1.dot(e.right);
      if (Math.abs(along) < 1.4 && Math.abs(lat) < p.width / 2) {
        if (e.def.id === 'aurora_veil') {
          this.addStatus(v, { type: 'slip', dur: p.slipDur, data: { gripMult: p.gripMult } });
        } else {
          // prism wall: heavy slow while crossing
          this.addStatus(v, { type: 'prism', dur: 0.4, data: { speedMult: p.slowMult } });
        }
      }
    }
  }

  _updateZone(e, dt, karts) {
    const p = e.def.params;
    if (e.follows && e.owner) e.pos.copy(e.owner.pos);
    if (e.life > e.def.params.duration) return; // windup phase
    for (const kart of karts) {
      const v = kart.vehicle;
      if (v === e.owner || this.isIntangible(v)) continue;
      if (v.pos.distanceTo(e.pos) < e.radius) {
        this.addStatus(v, { type: 'ripple', dur: 0.25, data: { speedMult: p.slowMult, steerMult: 0.9 } });
      }
    }
  }

  _updateSwarm(e, dt, karts) {
    if (e.follows && e.owner) e.pos.copy(e.owner.pos);
    const ownerYaw = e.owner ? e.owner.yaw : 0;
    for (const kart of karts) {
      const v = kart.vehicle;
      if (v === e.owner || this.isIntangible(v)) continue;
      _v1.copy(v.pos).sub(e.pos);
      const d = _v1.length();
      if (d > e.coneLen || d < 0.5) continue;
      _v1.normalize();
      const back = _v2.set(-Math.sin(ownerYaw), 0, -Math.cos(ownerYaw));
      if (_v1.dot(back) < Math.cos(e.coneHalfAngle)) continue;
      this.addStatus(v, { type: 'swarmDrag', dur: 0.3, data: { speedMult: e.dragMult } });
    }
  }

  _zapBehind(vehicle, radius, karts) {
    const back = _v1.set(-Math.sin(vehicle.yaw), 0, -Math.cos(vehicle.yaw));
    for (const kart of karts) {
      const v = kart.vehicle;
      if (v === vehicle || this.isIntangible(v)) continue;
      const d = v.pos.distanceTo(vehicle.pos);
      if (d > radius) continue;
      _v2.copy(v.pos).sub(vehicle.pos).normalize();
      if (_v2.dot(back) < 0.1) continue;
      this._hitKart(ITEMS.tempest_cell, kart, null);
    }
    this.onEvent?.('tempestZap', { pos: vehicle.pos, radius });
  }

  _ownerKart(karts, vehicle) {
    return karts.find((k) => k.vehicle === vehicle) || null;
  }

  // Convenience for race-mode restarts.
  reset() {
    this.held.clear();
    this.statuses.clear();
    this.entities.length = 0;
    this.shieldCharges.clear();
    for (const box of this.boxes) {
      box.respawnT = 0;
      const p = this.track.pointAt(box.s);
      box.pos.copy(p.pos).addScaledVector(p.right, box.lat);
      box.pos.y = p.pos.y + 1.1;
    }
  }
}
