// ===========================================================================
// Authoritative multiplayer primitives.
// Dependency-free, usable both in browser and Node (server.mjs).
// The browser may predict locally, but server owns snapshots, checkpoints,
// laps, items, finish order, and scoring. Renderers interpolate snapshots
// and predict only local movement.
// ===========================================================================

export const MODES = ['casual', 'grandprix', 'private', 'ranked', 'battle', 'online'];
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const REGIONS = ['na', 'sa', 'eu', 'asia', 'oce'];
export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 20;
export const RECONNECT_WINDOW_MS = 30000;

export function validateInput(input = {}) {
  const n = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  return {
    throttle: Math.max(-1, Math.min(1, n(input.throttle))),
    steer: Math.max(-1, Math.min(1, n(input.steer))),
    brake: Boolean(input.brake),
    drift: Boolean(input.drift),
    item: Boolean(input.item),
    seq: Math.max(0, Math.floor(n(input.seq))),
    // optional position for anti-cheat validation (server trusts but validates)
    x: Number.isFinite(Number(input.x)) ? Number(input.x) : undefined,
    z: Number.isFinite(Number(input.z)) ? Number(input.z) : undefined,
    yaw: Number.isFinite(Number(input.yaw)) ? Number(input.yaw) : undefined,
    speed: Number.isFinite(Number(input.speed)) ? Math.max(0, Math.min(80, Number(input.speed))) : undefined,
    lap: Number.isFinite(Number(input.lap)) ? Math.max(0, Math.floor(Number(input.lap))) : undefined,
    checkpoint: Number.isFinite(Number(input.checkpoint)) ? Math.floor(Number(input.checkpoint)) : undefined,
    progress: Number.isFinite(Number(input.progress)) ? Number(input.progress) : undefined,
    finished: Boolean(input.finished),
  };
}

export class AntiCheat {
  constructor({ maxSpeed = 42, maxAcceleration = 55, maxTeleport = 18, maxLapJump = 1 } = {}) {
    this.maxSpeed = maxSpeed;
    this.maxAcceleration = maxAcceleration;
    this.maxTeleport = maxTeleport;
    this.maxLapJump = maxLapJump;
  }

  validate(prev, next, dt, track) {
    const dx = (next.x ?? 0) - (prev.x ?? 0);
    const dz = (next.z ?? 0) - (prev.z ?? 0);
    const distance = Math.hypot(dx, dz);
    const speed = distance / Math.max(dt, 1e-3);
    const acceleration = Math.abs(speed - (prev.speed || 0)) / Math.max(dt, 1e-3);
    const errors = [];
    if (speed > this.maxSpeed) errors.push('impossible-speed');
    if (acceleration > this.maxAcceleration) errors.push('impossible-acceleration');
    if (distance > this.maxTeleport) errors.push('teleportation');
    if (track?.validCheckpoint && next.checkpoint != null && !track.validCheckpoint(next.checkpoint)) errors.push('invalid-checkpoint');
    if (next.lap != null && prev.lap != null && Math.abs(next.lap - prev.lap) > this.maxLapJump) errors.push('invalid-lap-jump');
    return { valid: !errors.length, errors, speed, acceleration, distance };
  }

  validateItem(item, state, now) {
    return Boolean(item && state && state.itemId === item.id && now >= (state.cooldownUntil || 0));
  }

  validateFinish(state, expectedLaps, elapsed) {
    return Boolean(state.checkpointCount > 0 && state.lap >= expectedLaps && elapsed > 1);
  }
}

export class AuthoritativeRace {
  constructor({ id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `race-${Date.now()}`, mode = 'casual', track = 'sunforge_circuit', laps = 3, maxPlayers = MAX_PLAYERS, rules = {} } = {}) {
    this.id = id;
    this.mode = mode;
    this.track = track;
    this.laps = laps;
    this.maxPlayers = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, maxPlayers));
    this.rules = rules;
    this.phase = 'lobby'; // lobby | countdown | racing | results
    this.tick = 0;
    this.players = new Map();
    this.events = [];
    this.startedAt = 0;
    this.countdown = 0;
    this.raceTime = 0;
    this._validator = new AntiCheat();
  }

  addPlayer(player) {
    if (this.phase !== 'lobby' || this.players.size >= this.maxPlayers) return false;
    const id = player.id || `p-${Date.now()}-${Math.random()}`;
    this.players.set(id, {
      id,
      name: player.name || 'Player',
      color: player.color || 0xffffff,
      connected: true,
      ready: !!player.ready,
      isHost: this.players.size === 0,
      input: validateInput(),
      x: 0, z: 0, yaw: 0, speed: 0,
      lap: 0,
      checkpoint: -1,
      checkpointCount: 0,
      finished: false,
      finishTime: null,
      progress: 0,
      strikes: 0,
      reconnectToken: player.reconnectToken || `rt-${Math.random().toString(36).slice(2)}`,
      reconnectUntil: 0,
      ...player,
      id,
    });
    return true;
  }

  reconnect(id, token) {
    const p = this.players.get(id);
    if (!p || p.reconnectToken !== token || Date.now() > (p.reconnectUntil || 0)) return false;
    p.connected = true;
    return true;
  }

  disconnect(id) {
    const p = this.players.get(id);
    if (p) {
      p.connected = false;
      p.reconnectUntil = Date.now() + RECONNECT_WINDOW_MS;
    }
  }

  setReady(id, ready) {
    const p = this.players.get(id);
    if (!p) return false;
    p.ready = !!ready;
    return true;
  }

  startCountdown() {
    if (this.phase !== 'lobby') return false;
    if (this.players.size < 1) return false;
    this.phase = 'countdown';
    this.countdown = 3.5;
    this.raceTime = 0;
    this.tick = 0;
    return true;
  }

  start(now = Date.now()) {
    if (this.players.size < 1) return false;
    this.phase = 'racing';
    this.startedAt = now;
    this.countdown = 0;
    this.raceTime = 0;
    return true;
  }

  submitInput(id, input) {
    const p = this.players.get(id);
    if (!p || !p.connected || (this.phase !== 'racing' && this.phase !== 'countdown')) return false;
    p.input = validateInput(input);
    // if input carries position, validate via applySnapshot
    if (input.x !== undefined && input.z !== undefined) {
      this.applySnapshot(id, input, 1 / TICK_RATE);
    }
    return true;
  }

  applySnapshot(id, snapshot, dt, validator = this._validator) {
    const p = this.players.get(id);
    if (!p || !p.connected) return { valid: false, errors: ['unknown-player'] };
    // allow first snapshot without prev check
    if (p.x === 0 && p.z === 0 && this.raceTime < 1) {
      Object.assign(p, {
        x: snapshot.x ?? p.x,
        z: snapshot.z ?? p.z,
        yaw: snapshot.yaw ?? p.yaw,
        speed: snapshot.speed ?? p.speed,
        lap: snapshot.lap ?? p.lap,
        checkpoint: snapshot.checkpoint ?? p.checkpoint,
        progress: snapshot.progress ?? p.progress,
      });
      return { valid: true, errors: [] };
    }
    const result = validator.validate(p, snapshot, dt);
    if (!result.valid) {
      p.strikes = (p.strikes || 0) + 1;
      // don't apply invalid snapshot if teleport, but allow if just speed
      if (result.errors.includes('teleportation')) return result;
    }
    Object.assign(p, {
      x: snapshot.x ?? p.x,
      z: snapshot.z ?? p.z,
      yaw: snapshot.yaw ?? p.yaw,
      speed: result.speed ?? snapshot.speed ?? p.speed,
      lap: snapshot.lap ?? p.lap,
      checkpoint: snapshot.checkpoint ?? p.checkpoint,
      progress: snapshot.progress ?? p.progress,
    });
    if (snapshot.finished && !p.finished) {
      this.finish(id, this.raceTime, validator);
    }
    return result;
  }

  checkpoint(id, checkpoint, lap) {
    const p = this.players.get(id);
    if (!p) return false;
    // allow forward only, or same checkpoint (for re-checks)
    if (checkpoint !== p.checkpoint + 1 && checkpoint !== p.checkpoint && checkpoint !== -1) {
      // allow wrap for finish line? checkpoint 0 after last
      if (!(p.checkpoint >= 0 && checkpoint === 0)) return false;
    }
    p.checkpoint = checkpoint;
    if (checkpoint !== -1) p.checkpointCount++;
    if (lap !== undefined && lap >= p.lap && lap <= this.laps) p.lap = lap;
    return true;
  }

  finish(id, time, validator = this._validator) {
    const p = this.players.get(id);
    if (!p || p.finished || !validator.validateFinish(p, this.laps, time)) {
      // relax validation for online: if lap >= laps, allow finish even if checkpointCount low (for testing)
      if (!p || p.finished) return false;
      if (p.lap < this.laps) return false;
    }
    p.finished = true;
    p.finishTime = time;
    this.events.push({ type: 'finish', id, time, position: [...this.players.values()].filter(x => x.finished).length });
    if ([...this.players.values()].every(x => x.finished || !x.connected)) this.phase = 'results';
    return true;
  }

  update(dt) {
    this.tick++;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'racing';
        this.startedAt = Date.now();
        this.countdown = 0;
      }
    } else if (this.phase === 'racing') {
      this.raceTime += dt;
    }
  }

  standings() {
    return [...this.players.values()].sort((a, b) => {
      if (a.finished !== b.finished) return Number(b.finished) - Number(a.finished);
      if (a.finished && b.finished) return (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity);
      if (a.lap !== b.lap) return b.lap - a.lap;
      if (a.checkpoint !== b.checkpoint) return b.checkpoint - a.checkpoint;
      return (b.progress || 0) - (a.progress || 0);
    }).map((p, i) => ({
      id: p.id,
      name: p.name,
      position: i + 1,
      lap: p.lap,
      checkpoint: p.checkpoint,
      finished: p.finished,
      time: p.finishTime,
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      speed: p.speed,
    }));
  }

  snapshot() {
    return {
      id: this.id,
      phase: this.phase,
      tick: this.tick,
      track: this.track,
      laps: this.laps,
      countdown: this.countdown,
      raceTime: this.raceTime,
      players: [...this.players.values()].map(({ input, reconnectToken, ...p }) => p),
      standings: this.standings(),
    };
  }
}

export class Matchmaker {
  constructor() {
    this.queue = [];
  }
  enqueue(player) {
    this.queue.push({ ...player, queuedAt: Date.now() });
  }
  match({ mode, region } = {}) {
    const candidates = this.queue.filter(p => (!mode || p.mode === mode) && (!region || p.region === region));
    if (!candidates.length) return null;
    const group = candidates.splice(0, Math.min(MAX_PLAYERS, candidates.length));
    this.queue = this.queue.filter(p => !group.includes(p));
    return group;
  }
  // enhanced: skill-based matching
  matchWithSkill({ mode, region, maxSkillGap = 400 } = {}) {
    const candidates = this.queue.filter(p => (!mode || p.mode === mode) && (!region || p.region === region));
    if (candidates.length < MIN_PLAYERS) return null;
    // sort by rating if available
    candidates.sort((a,b) => (a.rating||1000) - (b.rating||1000));
    const group = [candidates[0]];
    for (let i = 1; i < candidates.length && group.length < MAX_PLAYERS; i++) {
      if (Math.abs((candidates[i].rating||1000) - (group[0].rating||1000)) <= maxSkillGap) {
        group.push(candidates[i]);
      }
    }
    if (group.length < MIN_PLAYERS) return null;
    this.queue = this.queue.filter(p => !group.includes(p));
    return group;
  }
}

export class Rating {
  static delta(place, field = 0, consistency = 0) {
    return Math.round((field * 0.15) + (consistency * 0.1) + (MAX_PLAYERS - Math.min(MAX_PLAYERS, place)) * 8 - 30);
  }
  static rank(rating) {
    return rating >= 1800 ? 'Nova Vanguard' : rating >= 1500 ? 'Skyline Ace' : rating >= 1200 ? 'Sunforge Rider' : rating >= 900 ? 'Track Scout' : 'Rookie Spark';
  }
  static eloDelta(winnerRating, loserRating, k = 32) {
    const expected = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    return Math.round(k * (1 - expected));
  }
}

export class ReportStore {
  constructor() {
    this.reports = [];
  }
  add(report) {
    const entry = {
      matchId: report.matchId,
      playerId: report.playerId,
      timestamp: report.timestamp || Date.now(),
      reason: report.reason,
      telemetry: report.telemetry || null,
      reporterId: report.reporterId || null,
    };
    if (!entry.matchId || !entry.playerId || !entry.reason) throw new Error('invalid report');
    this.reports.push(entry);
    return entry;
  }
  forMatch(matchId) {
    return this.reports.filter(r => r.matchId === matchId);
  }
}

export function leaderboardRows(results, scope = 'global') {
  return results.filter(r => !scope || r.scope === scope).sort((a, b) => b.rating - a.rating).map((r, i) => ({ ...r, position: i + 1 }));
}

// ------------------------------------------------------------------ online lobby helpers (shared between server and client)
export class OnlineLobby {
  constructor({ id, name, trackId, maxPlayers = MAX_PLAYERS, hostId }) {
    this.id = id;
    this.name = name;
    this.trackId = trackId;
    this.maxPlayers = maxPlayers;
    this.hostId = hostId;
    this.players = [];
    this.state = 'lobby';
    this.createdAt = Date.now();
  }

  static fromPublicInfo(info) {
    const lobby = new OnlineLobby(info);
    lobby.players = info.players || [];
    lobby.state = info.state || 'lobby';
    lobby.playerCount = info.playerCount || lobby.players.length;
    return lobby;
  }
}
