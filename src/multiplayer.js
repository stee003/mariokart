// Authoritative multiplayer primitives. The browser may predict locally, but these
// objects are deliberately usable on a server (no THREE/browser dependencies).
export const MODES = ['casual', 'grandprix', 'private', 'ranked', 'battle'];
export const REGIONS = ['na', 'sa', 'eu', 'asia', 'oce'];
export const TICK_RATE = 30;

export function validateInput(input = {}) {
  const n = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  return { throttle: Math.max(-1, Math.min(1, n(input.throttle))), steer: Math.max(-1, Math.min(1, n(input.steer))), brake: Boolean(input.brake), drift: Boolean(input.drift), item: Boolean(input.item), seq: Math.max(0, Math.floor(n(input.seq))) };
}

export class AntiCheat {
  constructor({ maxSpeed = 42, maxAcceleration = 55, maxTeleport = 12 } = {}) { this.maxSpeed = maxSpeed; this.maxAcceleration = maxAcceleration; this.maxTeleport = maxTeleport; }
  validate(prev, next, dt, track) {
    const dx = (next.x ?? 0) - (prev.x ?? 0), dz = (next.z ?? 0) - (prev.z ?? 0);
    const distance = Math.hypot(dx, dz), speed = distance / Math.max(dt, 1e-3);
    const acceleration = Math.abs(speed - (prev.speed || 0)) / Math.max(dt, 1e-3);
    const errors = [];
    if (speed > this.maxSpeed) errors.push('impossible-speed');
    if (acceleration > this.maxAcceleration) errors.push('impossible-acceleration');
    if (distance > this.maxTeleport) errors.push('teleportation');
    if (track?.validCheckpoint && next.checkpoint != null && !track.validCheckpoint(next.checkpoint)) errors.push('invalid-checkpoint');
    return { valid: !errors.length, errors, speed, acceleration };
  }
  validateItem(item, state, now) { return Boolean(item && state && state.itemId === item.id && now >= (state.cooldownUntil || 0)); }
  validateFinish(state, expectedLaps, elapsed) { return Boolean(state.checkpointCount > 0 && state.lap >= expectedLaps && elapsed > 1); }
}

export class AuthoritativeRace {
  constructor({ id = crypto.randomUUID?.() || `race-${Date.now()}`, mode = 'casual', track = 'sunforge_circuit', laps = 3, maxPlayers = 12, rules = {} } = {}) {
    this.id = id; this.mode = mode; this.track = track; this.laps = laps; this.maxPlayers = Math.min(12, Math.max(2, maxPlayers)); this.rules = rules; this.phase = 'lobby'; this.tick = 0; this.players = new Map(); this.events = []; this.startedAt = 0;
  }
  addPlayer(player) { if (this.phase !== 'lobby' || this.players.size >= this.maxPlayers) return false; this.players.set(player.id, { ...player, connected: true, input: validateInput(), x: 0, z: 0, speed: 0, lap: 0, checkpoint: -1, checkpointCount: 0, finished: false, finishTime: null, itemId: null }); return true; }
  reconnect(id, token) { const p = this.players.get(id); if (!p || p.reconnectToken !== token || Date.now() > (p.reconnectUntil || 0)) return false; p.connected = true; return true; }
  disconnect(id) { const p = this.players.get(id); if (p) { p.connected = false; p.reconnectUntil = Date.now() + 30000; } }
  start(now = Date.now()) { if (this.players.size < 1) return false; this.phase = 'racing'; this.startedAt = now; return true; }
  submitInput(id, input) { const p = this.players.get(id); if (!p || !p.connected || this.phase !== 'racing') return false; p.input = validateInput(input); return true; }
  applySnapshot(id, snapshot, dt, validator = new AntiCheat()) { const p = this.players.get(id); if (!p || !p.connected) return { valid: false, errors: ['unknown-player'] }; const result = validator.validate(p, snapshot, dt); if (!result.valid) { p.strikes = (p.strikes || 0) + 1; return result; } Object.assign(p, { x: snapshot.x, z: snapshot.z, speed: result.speed }); return result; }
  checkpoint(id, checkpoint, lap) { const p = this.players.get(id); if (!p || checkpoint !== p.checkpoint + 1 && checkpoint !== p.checkpoint) return false; p.checkpoint = checkpoint; p.checkpointCount++; if (lap >= p.lap && lap <= this.laps) p.lap = lap; return true; }
  finish(id, time, validator = new AntiCheat()) { const p = this.players.get(id); if (!p || p.finished || !validator.validateFinish(p, this.laps, time)) return false; p.finished = true; p.finishTime = time; this.events.push({ type: 'finish', id, time, position: [...this.players.values()].filter(x => x.finished).length }); if ([...this.players.values()].every(x => x.finished || !x.connected)) this.phase = 'results'; return true; }
  standings() { return [...this.players.values()].sort((a, b) => (a.finished !== b.finished ? Number(b.finished) - Number(a.finished) : (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity))).map((p, i) => ({ id: p.id, position: i + 1, lap: p.lap, finished: p.finished, time: p.finishTime })); }
  snapshot() { return { id: this.id, phase: this.phase, tick: this.tick, track: this.track, players: [...this.players.values()].map(({ input, reconnectToken, ...p }) => p), standings: this.standings() }; }
}

export class Matchmaker { constructor() { this.queue = []; } enqueue(player) { this.queue.push({ ...player, queuedAt: Date.now() }); } match({ mode, region } = {}) { const candidates = this.queue.filter(p => (!mode || p.mode === mode) && (!region || p.region === region)); if (!candidates.length) return null; const group = candidates.splice(0, Math.min(12, candidates.length)); this.queue = this.queue.filter(p => !group.includes(p)); return group; } }

export class Rating { static delta(place, field = 0, consistency = 0) { return Math.round((field * 0.15) + (consistency * 0.1) + (12 - Math.min(12, place)) * 8 - 30); } static rank(rating) { return rating >= 1800 ? 'Nova Vanguard' : rating >= 1500 ? 'Skyline Ace' : rating >= 1200 ? 'Sunforge Rider' : rating >= 900 ? 'Track Scout' : 'Rookie Spark'; } }

export class ReportStore { constructor() { this.reports = []; } add(report) { const entry = { matchId: report.matchId, playerId: report.playerId, timestamp: report.timestamp || Date.now(), reason: report.reason, telemetry: report.telemetry || null }; if (!entry.matchId || !entry.playerId || !entry.reason) throw new Error('invalid report'); this.reports.push(entry); return entry; } }

export function leaderboardRows(results, scope = 'global') { return results.filter(r => !scope || r.scope === scope).sort((a, b) => b.rating - a.rating).map((r, i) => ({ ...r, position: i + 1 })); }
