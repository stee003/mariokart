// ===========================================================================
// Online Multiplayer Client - WebSocket + HTTP fallback, lobby management,
// remote kart interpolation, and race sync.
// ===========================================================================

export const ONLINE_CONFIG = {
  // WebSocket endpoint - same host, /ws
  wsPath: '/ws',
  // Polling fallback
  pollInterval: 100, // ms for input send
  snapshotInterpDelay: 100, // ms behind server to smooth
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
    this.serverUrl = null; // for http fallback
    this._snapshotBuffer = []; // for interpolation
    this._lastInputSend = 0;
    this._reconnectAttempts = 0;
  }

  get wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${ONLINE_CONFIG.wsPath}`;
  }

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
        // buffer for interpolation
        this._snapshotBuffer.push({ ...msg, receivedAt: performance.now() });
        // keep only last 20
        if (this._snapshotBuffer.length > 20) this._snapshotBuffer.shift();
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

  // send local player input + position
  sendInput({ input, pos, lap, checkpoint, progress, finished }) {
    const now = performance.now();
    if (now - this._lastInputSend < ONLINE_CONFIG.pollInterval) return;
    this._lastInputSend = now;
    this._send({
      type: 'input',
      input,
      x: pos?.x,
      y: pos?.y,
      z: pos?.z,
      yaw: pos?.yaw,
      speed: pos?.speed,
      lap,
      checkpoint,
      progress,
      finished,
    });
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

  // interpolation helper: get interpolated remote players at render time
  getInterpolatedPlayers() {
    if (this._snapshotBuffer.length === 0) return null;
    const now = performance.now();
    const targetTime = now - ONLINE_CONFIG.snapshotInterpDelay;

    // find two snapshots around targetTime
    let before = null, after = null;
    for (let i = 0; i < this._snapshotBuffer.length; i++) {
      const s = this._snapshotBuffer[i];
      if (s.receivedAt <= targetTime) before = s;
      if (s.receivedAt > targetTime) { after = s; break; }
    }
    if (!before) before = this._snapshotBuffer[0];
    if (!after) return before; // no interpolation

    const dt = after.receivedAt - before.receivedAt;
    if (dt <= 0) return before;
    const t = Math.max(0, Math.min(1, (targetTime - before.receivedAt) / dt));

    // interpolate each player present in both
    const beforeMap = new Map(before.players.map(p => [p.id, p]));
    const afterMap = new Map(after.players.map(p => [p.id, p]));

    const interp = [];
    for (const [id, b] of beforeMap) {
      const a = afterMap.get(id);
      if (!a) { interp.push(b); continue; }
      // lerp position, yaw with angle wrap
      const lerp = (x, y) => x + (y - x) * t;
      let yawDiff = a.yaw - b.yaw;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      interp.push({
        ...b,
        x: lerp(b.x, a.x),
        z: lerp(b.z, a.z),
        yaw: b.yaw + yawDiff * t,
        speed: lerp(b.speed || 0, a.speed || 0),
        lap: a.lap, // lap not interpolated
        checkpoint: a.checkpoint,
        finished: a.finished,
        progress: lerp(b.progress || 0, a.progress || 0),
      });
    }
    return {
      ...before,
      players: interp,
      standings: after.standings || before.standings,
      state: after.state,
      raceTime: before.raceTime + (after.raceTime - before.raceTime) * t,
      countdown: before.countdown,
    };
  }
}

// ------------------------------------------------------------------ remote kart visual interpolation
export class RemoteKart {
  constructor(playerInfo) {
    this.id = playerInfo.id;
    this.name = playerInfo.name;
    this.color = playerInfo.color;
    this.x = playerInfo.x || 0;
    this.z = playerInfo.z || 0;
    this.yaw = playerInfo.yaw || 0;
    this.speed = 0;
    this.targetX = this.x;
    this.targetZ = this.z;
    this.targetYaw = this.yaw;
    this.lap = 0;
    this.checkpoint = -1;
    this.finished = false;
    this.smoothing = 0.15;
  }

  updateFromSnapshot(p) {
    this.targetX = p.x;
    this.targetZ = p.z;
    this.targetYaw = p.yaw;
    this.speed = p.speed;
    this.lap = p.lap;
    this.checkpoint = p.checkpoint;
    this.finished = p.finished;
  }

  // simple lerp each frame
  step(dt) {
    this.x += (this.targetX - this.x) * Math.min(1, dt * 10);
    this.z += (this.targetZ - this.z) * Math.min(1, dt * 10);
    let diff = this.targetYaw - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * 8);
  }
}
