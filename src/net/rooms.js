// ============================================================================
// RoomManager - live netplay lobbies on top of the WebSocket relay.
//
// Netcode model (honest about what it is): a RELAY with client authority.
// Every peer simulates its own kart with the normal physics and broadcasts a
// small state sample ~20x/second. Remote karts are rendered from interpolated
// snapshots and never collide physically, so no rollback is needed and a bad
// connection degrades into a laggy ghost instead of desyncing the race.
//
// The server owns everything a client must not: the room roster, the track,
// the start signal, the finish order and the final standings.
// ============================================================================

export const MAX_PLAYERS = 8;
export const STATE_HZ = 20;              // accepted state messages per second
export const ROOM_IDLE_MS = 5 * 60 * 1000;
export const RACE_TIMEOUT_MS = 12 * 60 * 1000;

export function roomCode(rng = Math.random) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no look-alikes
  let out = '';
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Client state samples are untrusted: keep them finite and inside the world.
export function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pos = raw.pos;
  if (!Array.isArray(pos) || pos.length < 3) return null;
  const nums = pos.slice(0, 3).map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [x, y, z] = nums.map((n) => clamp(n, -5000, 5000));
  const yaw = Number(raw.yaw);
  return {
    pos: [Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(z * 100) / 100],
    yaw: Number.isFinite(yaw) ? Math.round(yaw * 1000) / 1000 : 0,
    speed: Number.isFinite(Number(raw.speed)) ? clamp(Number(raw.speed), 0, 200) : 0,
    lap: Number.isFinite(Number(raw.lap)) ? clamp(Math.floor(Number(raw.lap)), 0, 99) : 0,
    progress: Number.isFinite(Number(raw.progress)) ? clamp(Number(raw.progress), 0, 100000) : 0,
    drifting: !!raw.drifting,
    boosting: !!raw.boosting,
    item: typeof raw.item === 'string' ? raw.item.slice(0, 32) : null,
  };
}

export function sanitizeProfile(raw = {}) {
  // clients can send anything (including null): treat non-objects as empty
  if (!raw || typeof raw !== 'object') raw = {};
  const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').slice(0, max) : null);
  return {
    name: str(raw.name, 16) || 'Racer',
    characterId: str(raw.characterId, 32),
    chassisId: str(raw.chassisId, 32),
    wheelId: str(raw.wheelId, 32),
    paintId: str(raw.paintId, 32),
  };
}

export class RoomManager {
  constructor({ now = () => Date.now(), codeGen = roomCode } = {}) {
    this.now = now;
    this.codeGen = codeGen;
    this.rooms = new Map();     // code -> room
    this.byConn = new Map();    // conn.id -> room
  }

  get size() { return this.rooms.size; }

  list() {
    return [...this.rooms.values()].map((r) => ({
      code: r.code, players: r.players.size, started: r.started, trackId: r.trackId,
    }));
  }

  create({ trackId = null, laps = 3, mode = 'race' } = {}) {
    let code = this.codeGen();
    let guard = 0;
    while (this.rooms.has(code) && guard++ < 50) code = this.codeGen();
    const room = {
      code, trackId, laps, mode, started: false, startedAt: null,
      createdAt: this.now(), players: new Map(), finishes: [], finishDeadline: null,
    };
    this.rooms.set(code, room);
    return room;
  }

  get(code) { return this.rooms.get(String(code || '').toUpperCase()) || null; }

  // Adds a connection to a room (creating it when `create` is set). A player
  // already in another room is moved, so one socket is always in one lobby.
  join(conn, { room: code, create = false, profile = {}, host = false } = {}) {
    let room = code ? this.get(code) : null;
    if (!room && !create) return { error: 'no-room' };
    if (room && room.players.size >= MAX_PLAYERS) return { error: 'full' };
    if (room && room.started) return { error: 'started' };
    if (!room) {
      if (!host && !create) return { error: 'no-room' };
      room = this.create();
    }
    this.leave(conn);

    const player = {
      id: conn.id,
      profile: sanitizeProfile(profile),
      joinedAt: this.now(),
      state: null,
      finished: false,
      time: null,
      position: null,
      lastStateAt: 0,
      isHost: room.players.size === 0,
      conn,
    };
    room.players.set(player.id, player);
    this.byConn.set(conn.id, room);
    return { room, player };
  }

  leave(conn) {
    const room = this.byConn.get(conn.id);
    if (!room) return null;
    room.players.delete(conn.id);
    this.byConn.delete(conn.id);
    if (room.players.size === 0) this.rooms.delete(room.code);
    else if (!room.started) {
      // host passes to the longest-serving player
      const next = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      for (const p of room.players.values()) p.isHost = p === next;
    }
    return room;
  }

  // -------------------------------------------------------------- race flow
  start(conn, { trackId = null } = {}) {
    const room = this.byConn.get(conn.id);
    if (!room) return { error: 'no-room' };
    const player = room.players.get(conn.id);
    if (!player || !player.isHost) return { error: 'not-host' };
    if (room.started) return { error: 'already-started' };
    room.started = true;
    room.trackId = trackId || room.trackId;
    room.startedAt = this.now();
    room.finishDeadline = room.startedAt + RACE_TIMEOUT_MS;
    return { room };
  }

  state(conn, raw) {
    const room = this.byConn.get(conn.id);
    if (!room) return { error: 'no-room' };
    const player = room.players.get(conn.id);
    if (!player) return { error: 'no-player' };
    const now = this.now();
    if (now - player.lastStateAt < 1000 / (STATE_HZ * 1.5)) return { dropped: true };  // gentle flood guard
    player.lastStateAt = now;
    const state = sanitizeState(raw);
    if (!state) return { error: 'bad-state' };
    player.state = state;
    return { room, player, state };
  }

  finish(conn, { time = null, position = null } = {}) {
    const room = this.byConn.get(conn.id);
    if (!room) return { error: 'no-room' };
    const player = room.players.get(conn.id);
    if (!player) return { error: 'no-player' };
    if (player.finished) return { room, player };
    player.finished = true;
    player.time = Number.isFinite(Number(time)) ? Math.max(0, Number(time)) : null;
    player.position = Number.isFinite(Number(position)) ? Math.floor(Number(position)) : null;
    room.finishes.push({ id: player.id, name: player.profile.name, time: player.time, position: player.position, at: this.now() });
    return { room, player };
  }

  // Standings: finishers by time (then position), then anyone still driving.
  standings(room) {
    const rows = [...room.players.values()].map((p) => ({
      id: p.id, name: p.profile.name, finished: p.finished,
      time: p.time, position: p.position,
      lap: p.state ? p.state.lap : 0,
      progress: p.state ? p.state.progress : 0,
    }));
    rows.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) {
        if (a.time != null && b.time != null && a.time !== b.time) return a.time - b.time;
        return (a.position ?? 99) - (b.position ?? 99);
      }
      return b.progress - a.progress;
    });
    return rows.map((row, i) => ({ ...row, rank: i + 1 }));
  }

  // Host may end the race early; the server also ends it when everyone has
  // finished or the hard timeout hits.
  shouldEnd(room) {
    if (!room.started) return false;
    const players = [...room.players.values()];
    if (players.length && players.every((p) => p.finished)) return true;
    if (room.finishDeadline && this.now() > room.finishDeadline) return true;
    return false;
  }

  // Housekeeping: drop idle rooms so a long-running server stays small.
  sweep() {
    const now = this.now();
    for (const [code, room] of [...this.rooms.entries()]) {
      const idle = room.players.size === 0 || now - room.createdAt > ROOM_IDLE_MS && !room.started;
      if (idle && room.players.size === 0) this.rooms.delete(code);
    }
    return this;
  }
}
