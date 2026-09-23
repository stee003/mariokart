// ============================================================================
// NetSession - the browser side of the netplay relay.
//
// Responsibilities stay deliberately small: connect, join a lobby, broadcast
// our own kart state ~20x/second, and keep an interpolated picture of everyone
// else. Remote karts are rendered from snapshots (never simulated), which is
// what makes packet loss a cosmetic problem instead of a desync.
//
// The renderer asks for remote karts through sampleRemote(): it returns the
// interpolated transform ~120 ms in the past, which hides jitter without any
// prediction on our side.
// ============================================================================

export const SEND_HZ = 20;
export const INTERP_DELAY_MS = 120;
export const MAX_SNAPSHOTS = 12;

export function wsUrlFrom(location) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

// Pure interpolation helper so the smoothing is unit-testable.
// `snapshots` is a time-ordered array of {t, pos:[x,y,z], yaw}. Returns
// {pos:[x,y,z], yaw} or null when there is nothing to interpolate yet.
export function interpolate(snapshots, targetTime) {
  if (!snapshots || snapshots.length === 0) return null;
  if (snapshots.length === 1) return { pos: snapshots[0].pos.slice(), yaw: snapshots[0].yaw };
  if (targetTime <= snapshots[0].t) return { pos: snapshots[0].pos.slice(), yaw: snapshots[0].yaw };
  const last = snapshots[snapshots.length - 1];
  if (targetTime >= last.t) return { pos: last.pos.slice(), yaw: last.yaw };

  for (let i = 1; i < snapshots.length; i++) {
    const b = snapshots[i];
    if (b.t < targetTime) continue;
    const a = snapshots[i - 1];
    const span = b.t - a.t || 1;
    const f = (targetTime - a.t) / span;
    // shortest-arc yaw blend so karts never spin the long way round
    let dy = ((b.yaw - a.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (dy < -Math.PI) dy += Math.PI * 2;
    return {
      pos: [
        a.pos[0] + (b.pos[0] - a.pos[0]) * f,
        a.pos[1] + (b.pos[1] - a.pos[1]) * f,
        a.pos[2] + (b.pos[2] - a.pos[2]) * f,
      ],
      yaw: a.yaw + dy * f,
    };
  }
  return { pos: last.pos.slice(), yaw: last.yaw };
}

export class NetSession {
  constructor({ url = null, now = () => Date.now(), socketFactory = null } = {}) {
    this.url = url;
    this.now = now;
    this.socketFactory = socketFactory || ((u) => new WebSocket(u));
    this.socket = null;
    this.connected = false;
    this.joined = false;
    this.room = null;
    this.id = null;
    this.host = false;
    this.trackId = null;
    this.laps = 3;
    this.players = new Map();      // id -> {id, name, characterId, ..., snapshots[]}
    this.startedAt = null;
    this.standings = null;
    this.lastError = null;
    this._lastSend = 0;
    this._handlers = Object.create(null);
    this._closing = false;
  }

  on(type, fn) {
    (this._handlers[type] ||= []).push(fn);
    return this;
  }

  _emit(type, payload) {
    for (const fn of this._handlers[type] || []) fn(payload);
  }

  connect() {
    if (this.socket) return this.socket;
    this._closing = false;
    const sock = this.socketFactory(this.url || wsUrlFrom(window.location));
    sock.addEventListener('open', () => { this.connected = true; this._emit('open', {}); });
    sock.addEventListener('close', () => {
      this.connected = false;
      this.joined = false;
      this._emit('close', { intentional: this._closing });
    });
    sock.addEventListener('error', () => this._emit('error', { code: 'socket' }));
    sock.addEventListener('message', (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.handleMessage(msg);
    });
    this.socket = sock;
    return sock;
  }

  send(obj) {
    if (!this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(JSON.stringify(obj));
    return true;
  }

  // --------------------------------------------------------------- outbound
  join({ room = null, create = false, profile = {}, trackId = null, laps = 3 } = {}) {
    this.connect();
    const go = () => this.send({ t: 'join', room, create, profile, trackId, laps });
    if (this.connected) go();
    else this.socket.addEventListener('open', go, { once: true });
    return this;
  }

  startRace(trackId = null) { return this.send({ t: 'start', trackId }); }
  reportFinish({ time, position }) { return this.send({ t: 'finish', time, position }); }
  leave() {
    this.send({ t: 'leave' });
    this.joined = false;
    this.players.clear();
  }
  disconnect() {
    this._closing = true;
    if (this.socket) { try { this.socket.close(); } catch { /* already gone */ } }
    this.socket = null;
    this.connected = false;
    this.joined = false;
  }

  // Broadcast our own kart. `state` uses the same field names the relay
  // sanitises (pos/yaw/speed/lap/progress/drifting/boosting/item).
  sendState(state) {
    const t = this.now();
    if (t - this._lastSend < 1000 / SEND_HZ) return false;
    this._lastSend = t;
    return this.send({ t: 'state', ...state });
  }

  // ---------------------------------------------------------------- inbound
  handleMessage(msg) {
    switch (msg.t) {
      case 'welcome':
        this.joined = true;
        this.id = msg.id;
        this.room = msg.room;
        this.host = !!msg.host;
        this.trackId = msg.trackId;
        this.laps = msg.laps || 3;
        this._syncPlayers(msg.players || []);
        this._emit('welcome', msg);
        break;
      case 'players':
        this._syncPlayers(msg.players || []);
        this._emit('players', [...this.players.values()]);
        break;
      case 'started':
        this.startedAt = msg.at || this.now();
        this.trackId = msg.trackId || this.trackId;
        this.laps = msg.laps || this.laps;
        this._syncPlayers(msg.players || []);
        this._emit('started', msg);
        break;
      case 'state': {
        const p = this.players.get(msg.id);
        if (!p) break;
        p.snapshots.push({
          t: this.now(), pos: msg.pos, yaw: msg.yaw,
          speed: msg.speed, lap: msg.lap, progress: msg.progress,
          drifting: !!msg.drifting, boosting: !!msg.boosting, item: msg.item,
        });
        if (p.snapshots.length > MAX_SNAPSHOTS) p.snapshots.shift();
        break;
      }
      case 'finished':
        this.standings = msg.standings || null;
        this._emit('finished', msg);
        break;
      case 'over':
        this.standings = msg.standings || null;
        this._emit('over', msg);
        break;
      case 'error':
        this.lastError = msg.code;
        this._emit('serverError', msg);
        break;
      default:
        break;
    }
  }

  _syncPlayers(list) {
    for (const info of list) {
      const existing = this.players.get(info.id);
      if (existing) Object.assign(existing, info);
      else this.players.set(info.id, { ...info, snapshots: [] });
    }
    const ids = new Set(list.map((p) => p.id));
    for (const id of [...this.players.keys()]) if (!ids.has(id)) this.players.delete(id);
  }

  // Remote karts (we are never in this list: our own kart is simulated).
  remotes() {
    return [...this.players.values()].filter((p) => p.id !== this.id);
  }

  sampleRemote(id, timeMs = this.now() - INTERP_DELAY_MS) {
    const p = this.players.get(id);
    if (!p) return null;
    return interpolate(p.snapshots, timeMs);
  }
}
