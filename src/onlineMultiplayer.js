// ===========================================================================
// Online Multiplayer Client - WebSocket + HTTP fallback, lobby management,
// remote kart interpolation, and race sync.
// ===========================================================================

import { SnapshotInterpolator, NET_SNAPSHOT } from './netSnapshots.js';

export const ONLINE_CONFIG = {
  // WebSocket endpoint - same host, /ws
  wsPath: '/ws',
  // Local state is published at the server tick rate (20 Hz). At the old
  // 100 ms it took up to two server ticks for a peer to learn you had moved,
  // which read as lag and rubber-banding on every other screen.
  pollInterval: 50,
  snapshotInterpDelay: NET_SNAPSHOT.interpDelayMs, // ms behind server to smooth
  maxChatHistory: 100,
};

function randomColor() {
  return Math.floor(Math.random() * 0xffffff);
}

export class OnlineClient {
  constructor({ onEvent = () => {}, onSnapshot = () => {}, onLobbyUpdate = () => {}, onChat = () => {}, onError = () => {} } = {}) {
    this.onEvent = onEvent;
    this.onSnapshot = onSnapshot;
    this.onLobbyUpdate = onLobbyUpdate;
    this.onChat = onChat;
    this.onError = onError;

    this.ws = null;
    this.connected = false;
    this.playerId = null;
    this.lobby = null;
    this.playerName = 'Player';
    this.color = randomColor();
    this.status = 'disconnected'; // disconnected | connecting | lobby | countdown | racing | finished
    this.serverUrl = null; // explicit ws:// endpoint (tests / dedicated server)
    // Snapshots land on a server timeline and are replayed slightly in the
    // past, so peers always have two states to glide between.
    this.interpolator = new SnapshotInterpolator({ interpDelayMs: ONLINE_CONFIG.snapshotInterpDelay });
    this._lastInputSend = 0;
    this._inputSeq = 0;
    this._pendingInput = null;
    this._reconnectAttempts = 0;
    this.lastSnapshot = null;
    this.snapshotsReceived = 0;
  }

  get wsUrl() {
    if (this.serverUrl) return this.serverUrl;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${ONLINE_CONFIG.wsPath}`;
  }

  // Back-compat view of the interpolation buffer (used by diagnostics/tests).
  get _snapshotBuffer() { return this.interpolator.snapshots; }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      this.status = 'connecting';
      try {
        this.ws = new WebSocket(this.wsUrl);
      } catch (e) {
        this.onError(e.message);
        reject(e);
        return;
      }

      this.ws.onopen = () => {
        this.connected = true;
        this.status = 'lobby';
        this._reconnectAttempts = 0;
        this.onEvent('connected', {});
        resolve();
      };

      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          this._handleMessage(msg);
        } catch (e) {
          console.warn('[online] bad message', e);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        if (this.status !== 'disconnected') {
          this.status = 'disconnected';
          this.onEvent('disconnected', {});
          // auto reconnect if in lobby/race
          if (this.lobby && this._reconnectAttempts < 5) {
            this._reconnectAttempts++;
            setTimeout(() => this.connect().catch(()=>{}), 1000 * this._reconnectAttempts);
          }
        }
      };

      this.ws.onerror = (ev) => {
        this.onError('WebSocket error');
        reject(new Error('ws error'));
      };
    });
  }

  disconnect() {
    this.status = 'disconnected';
    this.lobby = null;
    this.playerId = null;
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.connected = false;
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(obj));
      return true;
    } catch { return false; }
  }

  _handleMessage(msg) {
    // internal listeners for promises
    this._emitInternal(msg.type, msg);
    switch (msg.type) {
      case 'connected': {
        this.playerId = msg.playerId;
        this.onEvent('connected', msg);
        break;
      }
      case 'lobbyList': {
        this.onEvent('lobbyList', msg);
        break;
      }
      case 'lobbyCreated':
      case 'lobbyJoined': {
        if (msg.playerId) this.playerId = msg.playerId;
        this.lobby = msg.lobby;
        this.status = 'lobby';
        this.onLobbyUpdate(this.lobby);
        this.onEvent(msg.type, msg);
        break;
      }
      case 'lobbyUpdate': {
        this.lobby = msg.lobby;
        this.onLobbyUpdate(this.lobby);
        this.onEvent('lobbyUpdate', msg);
        break;
      }
      case 'playerJoined':
      case 'playerLeft':
      case 'playerDisconnected': {
        if (msg.lobby) {
          this.lobby = msg.lobby;
          this.onLobbyUpdate(this.lobby);
        }
        this.onEvent(msg.type, msg);
        break;
      }
      case 'countdown': {
        this.status = 'countdown';
        if (msg.lobby) this.lobby = msg.lobby;
        this.onEvent('countdown', msg);
        break;
      }
      case 'raceStart': {
        this.status = 'racing';
        if (msg.lobby) this.lobby = msg.lobby;
        this.onEvent('raceStart', msg);
        break;
      }
      case 'snapshot': {
        // Buffered on the server timeline; late/duplicate frames are dropped
        // by the interpolator instead of rewinding every peer.
        this.interpolator.push(msg);
        this.lastSnapshot = msg;
        this.snapshotsReceived++;
        this.lobby = msg.lobby || this.lobby;
        if (msg.state) this.status = msg.state;
        this.onSnapshot(msg);
        break;
      }
      case 'raceFinished': {
        this.status = 'finished';
        if (msg.lobby) this.lobby = msg.lobby;
        this.onEvent('raceFinished', msg);
        break;
      }
      case 'chat': {
        this.onChat(msg.message);
        this.onEvent('chat', msg);
        break;
      }
      case 'leftLobby': {
        this.lobby = null;
        this.status = 'lobby';
        this.onEvent('leftLobby', msg);
        break;
      }
      case 'error': {
        this.onError(msg.message);
        this.onEvent('error', msg);
        break;
      }
      case 'pong': {
        // ignore
        break;
      }
      default: {
        this.onEvent(msg.type, msg);
      }
    }
  }

  // ---- lobby actions
  async listLobbies() {
    if (this.connected) {
      this._send({ type: 'listLobbies' });
    } else {
      // http fallback
      try {
        const res = await fetch('/api/lobbies');
        const data = await res.json();
        this.onEvent('lobbyList', data);
        return data.lobbies;
      } catch (e) {
        this.onError('Failed to list lobbies');
        return [];
      }
    }
  }

  async createLobby({ name, trackId, maxPlayers, playerName, color }) {
    this.playerName = playerName || this.playerName;
    this.color = color !== undefined ? color : this.color;
    if (!this.connected) await this.connect();
    return new Promise((resolve, reject) => {
      const onJoined = (msg) => {
        if (msg.type === 'lobbyJoined' || msg.type === 'lobbyCreated') {
          this._off('lobbyJoined', onJoined);
          this._off('lobbyCreated', onJoined);
          this._off('error', onErr);
          resolve(msg.lobby);
        }
      };
      const onErr = (msg) => {
        this._off('lobbyJoined', onJoined);
        this._off('lobbyCreated', onJoined);
        this._off('error', onErr);
        reject(new Error(msg.message));
      };
      this._on('lobbyJoined', onJoined);
      this._on('lobbyCreated', onJoined);
      this._on('error', onErr);
      this._send({ type: 'createLobby', name, trackId, maxPlayers, playerName: this.playerName, color: this.color });
      setTimeout(() => {
        this._off('lobbyJoined', onJoined);
        this._off('lobbyCreated', onJoined);
        this._off('error', onErr);
        reject(new Error('timeout'));
      }, 5000);
    });
  }

  async joinLobby(lobbyId, playerName, color) {
    this.playerName = playerName || this.playerName;
    this.color = color !== undefined ? color : this.color;
    if (!this.connected) await this.connect();
    return new Promise((resolve, reject) => {
      const onJoined = (msg) => {
        this._off('lobbyJoined', onJoined);
        this._off('error', onErr);
        resolve(msg.lobby);
      };
      const onErr = (msg) => {
        this._off('lobbyJoined', onJoined);
        this._off('error', onErr);
        reject(new Error(msg.message));
      };
      this._on('lobbyJoined', onJoined);
      this._on('error', onErr);
      this._send({ type: 'joinLobby', lobbyId, playerName: this.playerName, color: this.color });
      setTimeout(() => {
        this._off('lobbyJoined', onJoined);
        this._off('error', onErr);
        reject(new Error('timeout'));
      }, 5000);
    });
  }

  leaveLobby() {
    this._send({ type: 'leaveLobby' });
    this.lobby = null;
    this.status = 'lobby';
  }

  setReady(ready) {
    this._send({ type: 'ready', ready });
  }

  startRace() {
    this._send({ type: 'startRace' });
  }

  raceReady() {
    return this._send({ type: 'raceReady' });
  }

  sendChat(message) {
    this._send({ type: 'chat', message });
  }

  updateTrack(trackId) {
    this._send({ type: 'updateTrack', trackId });
  }

  returnToLobby() {
    this._send({ type: 'returnToLobby' });
  }

  // Publish the local kart: pose + movement state + race progress.
  // `force` bypasses the rate limit for one-off transitions (finish, respawn).
  sendInput({ input, pos, motion, lap, checkpoint, progress, finished, force = false } = {}) {
    const payload = {
      type: 'input',
      input,
      x: pos?.x,
      y: pos?.y,
      z: pos?.z,
      yaw: pos?.yaw,
      speed: pos?.speed,
      // Movement state travels with the pose so peers animate correctly:
      // steering, drift charge, boost flames and airtime all replicate.
      steer: motion?.steer ?? input?.steer ?? 0,
      throttle: motion?.throttle ?? input?.throttle ?? 0,
      brake: motion?.brake ?? input?.brake ?? 0,
      drift: !!(motion?.drift ?? input?.drift),
      driftLevel: motion?.driftLevel ?? 0,
      boost: !!motion?.boost,
      boostLevel: motion?.boostLevel ?? 0,
      airborne: !!motion?.airborne,
      lap,
      checkpoint,
      progress,
      finished,
    };

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - this._lastInputSend < ONLINE_CONFIG.pollInterval) {
      // Keep the freshest sample around: whatever happens, the last state of
      // the frame is what the next send publishes (no dropped stops).
      this._pendingInput = payload;
      return false;
    }
    this._lastInputSend = now;
    this._pendingInput = null;
    payload.seq = ++this._inputSeq;
    return this._send(payload);
  }

  // Flush a coalesced sample (safe to call every frame).
  flushInput() {
    if (!this._pendingInput) return false;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this._lastInputSend < ONLINE_CONFIG.pollInterval) return false;
    const payload = this._pendingInput;
    this._pendingInput = null;
    this._lastInputSend = now;
    payload.seq = ++this._inputSeq;
    return this._send(payload);
  }

  sendFinish() {
    this._send({ type: 'finish' });
  }

  // simple event emitter for one-off promises
  _listeners = new Map();
  _on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }
  _off(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }
  _emitInternal(type, msg) {
    for (const fn of this._listeners.get(type) || []) fn(msg);
  }

  // wrap onEvent to also emit internal
  _wrapOnEvent() {
    const orig = this.onEvent;
    this.onEvent = (type, msg) => {
      this._emitInternal(type, msg);
      orig(type, msg);
    };
  }

  // -------------------------------------------------------- snapshot access
  // Interpolated world view for this render instant. Remote karts are drawn
  // ~1 snapshot in the past so there are always two states to blend between;
  // if the next snapshot is late they coast forwards briefly instead of
  // freezing. Returns null until the first snapshot arrives.
  sampleRemoteStates(localNow) {
    return this.interpolator.sample(localNow);
  }

  // Legacy alias kept for callers that expect the old shape.
  getInterpolatedPlayers(localNow) {
    return this.interpolator.sample(localNow);
  }

  // Interpolated state of a single peer.
  remotePlayerState(id, localNow) {
    return this.interpolator.playerState(id, localNow);
  }

  // Newest authoritative roster (membership, laps, readiness).
  get players() {
    return this.lastSnapshot?.players || this.lobby?.players || [];
  }

  netStats(localNow) {
    return { ...this.interpolator.stats(localNow), sent: this._inputSeq, snapshots: this.snapshotsReceived };
  }

  resetInterpolation() {
    this.interpolator.reset();
    this.lastSnapshot = null;
  }
}

// ------------------------------------------------------------------ remote kart visual interpolation
// Lightweight pose follower for renderers that do not own a full
// VehicleController (minimap blips, spectator views, tests). The in-game karts
// are driven by RemotePlayerSync, which applies the same smoothing to real
// vehicles.
export class RemoteKart {
  constructor(playerInfo = {}) {
    this.id = playerInfo.id;
    this.name = playerInfo.name;
    this.color = playerInfo.color;
    this.x = playerInfo.x || 0;
    this.y = playerInfo.y || 0;
    this.z = playerInfo.z || 0;
    this.yaw = playerInfo.yaw || 0;
    this.speed = 0;
    this.targetX = this.x;
    this.targetY = this.y;
    this.targetZ = this.z;
    this.targetYaw = this.yaw;
    this.lap = 0;
    this.checkpoint = -1;
    this.finished = false;
    this.drift = false;
    this.driftLevel = 0;
    this.boost = false;
    this.airborne = false;
    this.hasPose = false;
    // exponential convergence rates (1/s)
    this.posRate = 22;
    this.yawRate = 20;
    this.snapDistance = 9;
  }

  updateFromSnapshot(p) {
    if (!p) return;
    if (Number.isFinite(p.x)) this.targetX = p.x;
    if (Number.isFinite(p.y)) this.targetY = p.y;
    if (Number.isFinite(p.z)) this.targetZ = p.z;
    if (Number.isFinite(p.yaw)) this.targetYaw = p.yaw;
    this.speed = Number.isFinite(p.speed) ? p.speed : this.speed;
    this.lap = p.lap ?? this.lap;
    this.checkpoint = p.checkpoint ?? this.checkpoint;
    this.finished = !!p.finished;
    this.drift = !!p.drift;
    this.driftLevel = p.driftLevel || 0;
    this.boost = !!p.boost;
    this.airborne = !!p.airborne;
    if (!this.hasPose && (p.hasPose ?? true)) {
      // first authoritative pose: adopt it instead of sliding in from the origin
      this.x = this.targetX; this.y = this.targetY; this.z = this.targetZ; this.yaw = this.targetYaw;
      this.hasPose = true;
    }
  }

  // Frame-rate independent easing towards the last interpolated target.
  step(dt) {
    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    const far = Math.hypot(dx, dz) > this.snapDistance;
    const kPos = far ? 1 : 1 - Math.exp(-this.posRate * Math.max(0, dt));
    const kYaw = far ? 1 : 1 - Math.exp(-this.yawRate * Math.max(0, dt));
    this.x += dx * kPos;
    this.z += dz * kPos;
    this.y += (this.targetY - this.y) * kPos;
    let diff = this.targetYaw - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * kYaw;
  }
}
