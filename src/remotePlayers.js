// ============================================================================
// RemotePlayerSync - turns authoritative snapshots into moving karts.
//
// Remote racers are kinematic: their physics is owned by the server, so the
// local simulation never steps them. That is exactly why they used to sit
// frozen on the grid - the renderer latches a new pose only when the vehicle's
// `stepId` advances, and a kart that is never stepped never advances it.
//
// This module owns the peer lifecycle (join/leave), eases each peer towards
// the interpolated network pose on the local fixed-step timeline, replicates
// movement state (drift, boost, airborne, steering) and bumps `stepId` so the
// renderer interpolates peers exactly like the local kart.
//
// No THREE/DOM imports: it only touches the vehicle interface, which keeps it
// unit-testable in Node.
// ============================================================================

export const REMOTE_SYNC = {
  // Residual-error decay rates (1/s). A peer FOLLOWS the authoritative motion
  // one-to-one - smoothing is applied only to the leftover error (collisions,
  // clamped corrections, packet loss), so peers never trail their true pose.
  posSmoothRate: 12,
  yawSmoothRate: 14,
  ySmoothRate: 12,
  // Per-step travel is capped at what the replicated speed can plausibly
  // cover; anything beyond that is a correction, not motion, and is eased in
  // instead of being applied as a jump.
  travelMargin: 6,      // m/s of slack on top of the replicated speed
  travelTolerance: 1.6, // multiplier on the plausible per-step distance
  // Above this positional error the peer is snapped instead of eased: a
  // respawn or a long stall must not produce a slide across the track.
  snapDistance: 9,
  // Speeds outside this band are ignored as corrupt.
  maxSpeed: 90,
};

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function shortestAngleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function normalizeAngle(a) {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
}

// 1 - e^(-rate*dt): frame-rate independent exponential smoothing.
function smoothing(rate, dt) {
  if (!(rate > 0)) return 1;
  return 1 - Math.exp(-rate * Math.max(0, dt));
}

export class RemotePlayerSync {
  /**
   * @param {object} opts
   * @param {(player:object)=>object} opts.createEntry  builds {vehicle, ...} for a new peer
   * @param {(entry:object)=>void} [opts.disposeEntry]  tears a peer down again
   * @param {object} [opts.track]   TrackManager used to resolve ground height
   * @param {string} [opts.localId] player id that must never be replicated
   */
  constructor({ createEntry, disposeEntry = () => {}, track = null, localId = null, config = {} } = {}) {
    if (typeof createEntry !== 'function') throw new Error('RemotePlayerSync needs a createEntry factory');
    this.createEntry = createEntry;
    this.disposeEntry = disposeEntry;
    this.track = track;
    this.localId = localId;
    this.config = { ...REMOTE_SYNC, ...config };
    this.entries = new Map(); // playerId -> entry
    this._stepToken = 0;      // marks which peers were touched by the current step
  }

  setLocalId(id) { this.localId = id; }
  setTrack(track) { this.track = track; }

  get size() { return this.entries.size; }
  has(id) { return this.entries.has(id); }
  get(id) { return this.entries.get(id) || null; }
  ids() { return [...this.entries.keys()]; }
  values() { return [...this.entries.values()]; }

  /**
   * Reconcile the local peer roster with the authoritative player list:
   * everyone who joined gets a kart, everyone who left loses theirs.
   */
  syncRoster(players = []) {
    const added = [];
    const removed = [];
    const seen = new Set();

    for (const p of players) {
      if (!p || p.id === undefined || p.id === null) continue;
      if (this.localId !== null && p.id === this.localId) continue;
      seen.add(p.id);
      if (this.entries.has(p.id)) {
        const entry = this.entries.get(p.id);
        entry.info = { ...entry.info, ...p };
        continue;
      }
      const entry = this.createEntry(p);
      if (!entry || !entry.vehicle) continue;
      entry.id = p.id;
      entry.info = { ...p };
      entry.hasPose = false;
      entry.lastAppliedT = null;
      this.entries.set(p.id, entry);
      added.push(entry);
    }

    for (const [id, entry] of [...this.entries]) {
      if (seen.has(id)) continue;
      this.entries.delete(id);
      removed.push(entry);
      this.disposeEntry(entry);
    }

    return { added, removed };
  }

  /**
   * Advance every peer one fixed step towards its interpolated network pose.
   * Must run inside the same fixed-timestep loop as the local physics so the
   * renderer can blend peers between steps.
   *
   * @param {number} dt      fixed step in seconds
   * @param {Array}  players interpolated player states (from SnapshotInterpolator)
   */
  step(dt, players = []) {
    this._stepToken++;
    const token = this._stepToken;
    let applied = 0;
    for (const p of players) {
      if (!p || (this.localId !== null && p.id === this.localId)) continue;
      const entry = this.entries.get(p.id);
      if (!entry) continue;
      if (this.applyPose(entry, p, dt)) applied++;
    }
    // Peers absent from this view still need a fresh render latch, otherwise
    // the renderer would keep blending towards a pose they already reached.
    for (const entry of this.entries.values()) {
      if (entry._steppedAt === token) continue;
      entry.vehicle.stepId = (entry.vehicle.stepId || 0) + 1;
      entry._steppedAt = token;
    }
    return applied;
  }

  /** Apply one interpolated player state to a peer's vehicle. */
  applyPose(entry, p, dt) {
    const v = entry.vehicle;
    if (!v) return false;
    entry.info = { ...entry.info, ...p };

    // A peer that has not published a pose yet keeps its deterministic start
    // grid placement instead of snapping to the server object's origin.
    const hasPose = p.hasPose === undefined ? (Number.isFinite(p.x) && Number.isFinite(p.z)) : !!p.hasPose;
    if (!hasPose || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.z))) {
      v.stepId = (v.stepId || 0) + 1;
      entry._steppedAt = this._stepToken;
      return false;
    }

    const tx = num(p.x, v.pos.x);
    const tz = num(p.z, v.pos.z);
    const tyaw = num(p.yaw, v.yaw);
    const speed = Math.max(-this.config.maxSpeed, Math.min(this.config.maxSpeed, num(p.speed, 0)));

    const error = Math.hypot(tx - v.pos.x, tz - v.pos.z);
    // First pose, respawn or a hard lag spike: snap. Everything else is
    // followed exactly and corrected smoothly.
    const snap = !entry.hasPose || error > this.config.snapDistance;

    if (snap) {
      v.pos.x = tx;
      v.pos.z = tz;
      v.yaw = normalizeAngle(tyaw);
    } else {
      // 1. Follow the authoritative motion one-to-one. A pure "ease towards
      //    the target" follower always trails a moving kart by speed/rate -
      //    half a metre at racing speed - which reads as lag on every peer.
      const moveX = tx - entry.netX;
      const moveZ = tz - entry.netZ;
      const move = Math.hypot(moveX, moveZ);
      const maxTravel = (Math.abs(speed) + this.config.travelMargin) * dt * this.config.travelTolerance;
      const scale = move > maxTravel && move > 1e-9 ? maxTravel / move : 1;
      v.pos.x += moveX * scale;
      v.pos.z += moveZ * scale;
      // 2. Decay whatever error is left: local collisions, the clamped part of
      //    a correction, or a catch-up after packet loss.
      const kPos = smoothing(this.config.posSmoothRate, dt);
      v.pos.x += (tx - v.pos.x) * kPos;
      v.pos.z += (tz - v.pos.z) * kPos;

      const yawMove = shortestAngleDelta(entry.netYaw, tyaw);
      const kYaw = smoothing(this.config.yawSmoothRate, dt);
      let yaw = v.yaw + yawMove;
      yaw += shortestAngleDelta(yaw, tyaw) * kYaw;
      v.yaw = normalizeAngle(yaw);
    }
    entry.netX = tx;
    entry.netZ = tz;
    entry.netYaw = tyaw;

    // Ground clearance: replicated Y when available, otherwise the track
    // surface under the peer. Airborne peers keep the replicated height.
    let surf = null;
    if (this.track && typeof this.track.surface === 'function') {
      if (!v.hint) v.hint = { main: -1, sc: -1 };
      surf = this.track.surface(v.pos, v.hint);
      v.surf = surf;
    }
    const groundY = surf ? surf.y : v.y;
    let targetY = Number.isFinite(Number(p.y)) ? Number(p.y) : groundY;
    if (!p.airborne && surf) targetY = Math.max(groundY, Math.min(targetY, groundY + 0.5));
    const kY = snap ? 1 : smoothing(this.config.ySmoothRate, dt);
    v.y += (targetY - v.y) * kY;
    v.pos.y = v.y;

    // Velocity drives collision response, engine audio and the shadow, so it
    // has to track the replicated speed rather than stay at zero.
    v.fSpeed = speed;
    if (v.vel && typeof v.vel.set === 'function') {
      v.vel.set(Math.sin(v.yaw) * speed, 0, Math.cos(v.yaw) * speed);
    }
    v.latSpeed = num(p.latSpeed, 0);

    // Movement state - what makes a peer *look* like it is driving.
    v.steer = Math.max(-1, Math.min(1, num(p.steer, 0)));
    v.grounded = !p.airborne;
    if (v.drift) {
      v.drift.state = p.drift ? 'drifting' : 'idle';
      v.drift.level = Math.max(0, Math.min(3, Math.floor(num(p.driftLevel, 0))));
      if (!p.drift) v.drift.charge = 0;
    }
    if (v.boost) {
      if (p.boost) {
        const level = Math.max(0, Math.floor(num(p.boostLevel, 0)));
        // Replicated flag, not a local timer: refreshed while the peer boosts.
        v.boost.active = v.boost.active || { timeLeft: 0.4, duration: 0.4, speedMult: 1, accelMult: 1, level, source: 'net' };
        v.boost.active.level = level;
        v.boost.active.timeLeft = 0.4;
      } else {
        v.boost.active = null;
      }
    }
    if (typeof v._updateAttitude === 'function' && surf) {
      if (!v.fx) v.fx = {};
      v._updateAttitude(dt, surf);
    }

    entry.hasPose = true;
    entry.lastAppliedT = p.t ?? entry.lastAppliedT;
    entry._steppedAt = this._stepToken;
    // Renderers latch the previous pose once per step: without this the peer
    // never visually moves, however good the network data is.
    v.stepId = (v.stepId || 0) + 1;
    return true;
  }

  /** Hard-place one peer (used for grid placement before the first snapshot). */
  snapTo(id, pose) {
    const entry = this.entries.get(id);
    if (!entry || !pose) return false;
    const v = entry.vehicle;
    if (typeof v.place === 'function' && pose.pos) {
      v.place(pose);
    } else {
      v.pos.x = num(pose.x, v.pos.x);
      v.pos.z = num(pose.z, v.pos.z);
      v.yaw = num(pose.yaw, v.yaw);
    }
    entry.hasPose = false;
    v.stepId = (v.stepId || 0) + 1;
    return true;
  }

  clear() {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
  }
}
