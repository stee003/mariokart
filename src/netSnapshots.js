// ============================================================================
// Snapshot buffering and interpolation for networked players.
//
// The server publishes authoritative snapshots at a fixed rate (20 Hz). A
// renderer that simply teleports peers onto the newest snapshot moves them in
// visible 50 ms jumps and freezes them completely whenever a packet is late.
// This module keeps a small history of snapshots on a SERVER timeline and
// samples it slightly in the past, so every render frame has two snapshots to
// blend between - remote karts then glide instead of stuttering.
//
// Deliberately free of DOM/THREE dependencies so the netcode can be unit
// tested in plain Node.
// ============================================================================

export const NET_SNAPSHOT = {
  // How far behind the newest server state remote players are rendered.
  // One snapshot interval (50 ms) plus jitter headroom: large enough to always
  // have a "next" snapshot to interpolate towards, small enough to stay
  // responsive.
  interpDelayMs: 110,
  // When the next snapshot is late, peers keep coasting for at most this long
  // before they are allowed to stall (prevents micro freezes on jitter).
  maxExtrapolationMs: 160,
  // Ring buffer length (~2 s of history at 20 Hz).
  bufferSize: 40,
  // How quickly the estimated clock offset is allowed to drift upwards.
  clockDriftRate: 0.02,
};

// Discrete, non-interpolatable player fields. They are copied verbatim from
// the newer of the two blended snapshots.
const DISCRETE_KEYS = [
  'id', 'name', 'color', 'ready', 'isHost', 'connected', 'raceReady', 'hasPose',
  'lap', 'checkpoint', 'finished', 'finishTime', 'slot', 'seq',
  'drift', 'driftLevel', 'boost', 'boostLevel', 'airborne', 'item',
];

export function shortestAngleDelta(from, to) {
  let d = (Number(to) || 0) - (Number(from) || 0);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function lerpAngle(from, to, t) {
  return (Number(from) || 0) + shortestAngleDelta(from, to) * t;
}

function lerp(a, b, t) {
  const x = Number(a) || 0;
  const y = Number(b) || 0;
  return x + (y - x) * t;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function defaultNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export class SnapshotInterpolator {
  constructor({
    interpDelayMs = NET_SNAPSHOT.interpDelayMs,
    maxExtrapolationMs = NET_SNAPSHOT.maxExtrapolationMs,
    bufferSize = NET_SNAPSHOT.bufferSize,
    clockDriftRate = NET_SNAPSHOT.clockDriftRate,
    now = defaultNow,
  } = {}) {
    this.interpDelayMs = interpDelayMs;
    this.maxExtrapolationMs = maxExtrapolationMs;
    this.bufferSize = Math.max(2, bufferSize);
    this.clockDriftRate = clockDriftRate;
    this.now = now;
    this.reset();
  }

  reset() {
    this.snapshots = [];
    // localNow - serverTime of the least delayed packet seen so far. The
    // minimum (rather than the average) is used because it is the sample with
    // the least queueing delay, which keeps the render clock stable.
    this.clockOffset = null;
    this.lastServerT = -Infinity;
    this.received = 0;
    this.dropped = 0;
    this.lastArrivalGap = 0;
    this._lastReceivedAt = null;
  }

  get size() { return this.snapshots.length; }

  get latest() { return this.snapshots.length ? this.snapshots[this.snapshots.length - 1] : null; }

  /**
   * Add a server snapshot. Out-of-order and duplicate frames are dropped:
   * rewinding the timeline would make every peer jitter backwards.
   * @returns {boolean} true when the snapshot was accepted.
   */
  push(snap, localNow = this.now()) {
    if (!snap || !Array.isArray(snap.players)) return false;
    const t = Number.isFinite(Number(snap.t)) ? Number(snap.t)
      : (this.latest ? this.latest.t + 1 : localNow);
    if (t <= this.lastServerT) { this.dropped++; return false; }

    this.lastServerT = t;
    this.received++;
    if (this._lastReceivedAt !== null) this.lastArrivalGap = localNow - this._lastReceivedAt;
    this._lastReceivedAt = localNow;

    this.snapshots.push({ ...snap, t, receivedAt: localNow });
    while (this.snapshots.length > this.bufferSize) this.snapshots.shift();

    const offset = localNow - t;
    if (this.clockOffset === null || offset < this.clockOffset) this.clockOffset = offset;
    else this.clockOffset += (offset - this.clockOffset) * this.clockDriftRate;
    return true;
  }

  /** Server-timeline instant that should be rendered right now. */
  renderTime(localNow = this.now()) {
    if (this.clockOffset === null) return null;
    return localNow - this.clockOffset - this.interpDelayMs;
  }

  /**
   * Interpolated world view for the current render instant.
   * @returns {null|{t:number, players:Array, interpolated:boolean, extrapolatedMs:number}}
   */
  sample(localNow = this.now()) {
    const n = this.snapshots.length;
    if (!n) return null;
    const oldest = this.snapshots[0];
    const newest = this.snapshots[n - 1];

    let renderT = this.renderTime(localNow);
    if (renderT === null) renderT = newest.t;

    // Buffer has not filled yet (or the clock jumped backwards): show the
    // oldest state rather than inventing one.
    if (renderT <= oldest.t) return this._single(oldest, 0, null);

    let before = oldest;
    let after = null;
    for (let i = 0; i < n; i++) {
      const s = this.snapshots[i];
      if (s.t <= renderT) before = s;
      else { after = s; break; }
    }

    if (!after) {
      // Starved: coast forwards from the newest snapshot for a short while.
      const ahead = Math.max(0, Math.min(renderT - newest.t, this.maxExtrapolationMs));
      const prev = n > 1 ? this.snapshots[n - 2] : null;
      return this._single(newest, ahead, prev);
    }

    const span = after.t - before.t;
    const f = span > 0 ? clamp01((renderT - before.t) / span) : 1;
    const beforeMap = new Map(before.players.map((p) => [p.id, p]));

    const players = after.players.map((a) => {
      const b = beforeMap.get(a.id);
      if (!b) return { ...a, interpolated: false };
      return {
        ...a,
        x: lerp(b.x, a.x, f),
        y: lerp(b.y ?? a.y, a.y, f),
        z: lerp(b.z, a.z, f),
        yaw: lerpAngle(b.yaw, a.yaw, f),
        speed: lerp(b.speed, a.speed, f),
        steer: lerp(b.steer, a.steer, f),
        progress: lerp(b.progress, a.progress, f),
        interpolated: true,
      };
    });

    return {
      ...after,
      t: before.t + span * f,
      players,
      interpolated: true,
      extrapolatedMs: 0,
      alpha: f,
    };
  }

  /** Single snapshot view, optionally coasted `aheadMs` into the future. */
  _single(snap, aheadMs = 0, prev = null) {
    if (!aheadMs) {
      return {
        ...snap,
        players: snap.players.map((p) => ({ ...p, interpolated: false })),
        interpolated: false,
        extrapolatedMs: 0,
        alpha: 0,
      };
    }
    const dt = aheadMs / 1000;
    const prevMap = prev ? new Map(prev.players.map((p) => [p.id, p])) : null;
    const prevSpan = prev ? Math.max(1, snap.t - prev.t) / 1000 : 0;
    const players = snap.players.map((p) => {
      let vx = 0;
      let vz = 0;
      const old = prevMap ? prevMap.get(p.id) : null;
      if (old && Number.isFinite(old.x) && Number.isFinite(old.z)) {
        // Velocity measured from the last two snapshots follows slides and
        // drifts, which a yaw-aligned guess would not.
        vx = ((Number(p.x) || 0) - (Number(old.x) || 0)) / prevSpan;
        vz = ((Number(p.z) || 0) - (Number(old.z) || 0)) / prevSpan;
      } else {
        const speed = Number(p.speed) || 0;
        vx = Math.sin(Number(p.yaw) || 0) * speed;
        vz = Math.cos(Number(p.yaw) || 0) * speed;
      }
      return {
        ...p,
        x: (Number(p.x) || 0) + vx * dt,
        z: (Number(p.z) || 0) + vz * dt,
        interpolated: false,
        extrapolated: true,
      };
    });
    return {
      ...snap,
      players,
      interpolated: false,
      extrapolatedMs: aheadMs,
      alpha: 0,
    };
  }

  /** Interpolated state of one player, or null. */
  playerState(id, localNow = this.now()) {
    const view = this.sample(localNow);
    if (!view) return null;
    return view.players.find((p) => p.id === id) || null;
  }

  stats(localNow = this.now()) {
    const newest = this.latest;
    return {
      buffered: this.snapshots.length,
      received: this.received,
      dropped: this.dropped,
      clockOffset: this.clockOffset,
      interpDelayMs: this.interpDelayMs,
      arrivalGapMs: this.lastArrivalGap,
      ageMs: newest ? localNow - newest.receivedAt : null,
    };
  }
}
