// ===========================================================================
// MultiplayerClient - transport-agnostic client for Sunforge Racers online.
// Supports:
//   - WebSocket real-time (primary): /ws
//   - HTTP polling fallback: /api/lobbies
// The client sends inputs only; server owns snapshots, checkpoints, laps,
// finish order. Renderers interpolate snapshots and predict only local movement.
// ===========================================================================

import { validateInput } from './multiplayer.js';

export class MultiplayerClient {
  constructor({ url = '', fetchImpl = fetch, WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : null, onSnapshot = () => {}, onEvent = () => {}, onLobbyUpdate = () => {} } = {}) {
    this.url = url.replace(/\/$/, ''); // base http url, e.g. http://localhost:8000
    this.fetch = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.onSnapshot = onSnapshot;
    this.onEvent = onEvent;
    this.onLobbyUpdate = onLobbyUpdate;
    this.seq = 0;
    this.connected = false;
    this.session = null;
    this.ws = null;
    this.lobbyId = null;
    this.playerId = null;
    this._listeners = new Map();
  }

  get wsUrl() {
    if (!this.url) {
      const proto = (typeof location !== 'undefined' && location.protocol === 'https:') ? 'wss:' : 'ws:';
      const host = (typeof location !== 'undefined') ? location.host : 'localhost:8000';
      return `${proto}//${host}/ws`;
    }
    // convert http(s) to ws(s)
    return this.url.replace(/^http/, 'ws') + '/ws';
  }

  // ---- WebSocket path (new server)
  async connectWs({ lobbyId, playerName, color } = {}) {
    if (!this.WebSocketImpl) throw new Error('WebSocket not available');
    return new Promise((resolve, reject) => {
      this.ws = new this.WebSocketImpl(this.wsUrl);
      this.ws.onopen = () => {
        this.connected = true;
        if (lobbyId) {
          this.ws.send(JSON.stringify({ type: 'joinLobby', lobbyId, playerName, color }));
        }
        resolve();
      };
      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          this._handleWsMessage(msg);
        } catch {}
      };
      this.ws.onclose = () => {
        this.connected = false;
        this.onEvent('disconnected', {});
      };
      this.ws.onerror = (e) => {
        this.connected = false;
        reject(e);
      };
      setTimeout(() => reject(new Error('ws timeout')), 5000);
    });
  }

  _handleWsMessage(msg) {
    if (msg.type === 'connected') {
      this.playerId = msg.playerId;
    }
    if (msg.type === 'lobbyJoined' || msg.type === 'lobbyCreated') {
      this.lobbyId = msg.lobby?.id;
      this.playerId = msg.playerId || this.playerId;
      this.session = { raceId: msg.lobby?.id, playerId: this.playerId };
    }
    if (msg.type === 'lobbyUpdate' || msg.type === 'lobbyJoined') {
      this.onLobbyUpdate(msg.lobby);
    }
    if (msg.type === 'snapshot') {
      this.onSnapshot(msg);
    }
    if (msg.type === 'lobbyList') {
      this.onEvent('lobbyList', msg);
    }
    this.onEvent(msg.type, msg);
    // internal listeners
    for (const fn of this._listeners.get(msg.type) || []) fn(msg);
  }

  on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }
  off(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }

  // ---- HTTP legacy path (for tests / fallback)
  async join({ mode = 'casual', region = 'auto', track, laps = 3, rules = {} } = {}) {
    // try new lobby API first
    try {
      const r = await this.fetch(`${this.url}/api/lobbies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: `${mode} race`, trackId: track || 'sunforge_circuit', maxPlayers: 8, playerName: 'Player' }),
      });
      if (r.ok) {
        const data = await r.json();
        this.session = { raceId: data.lobby.id, playerId: data.playerId };
        this.lobbyId = data.lobby.id;
        this.playerId = data.playerId;
        this.connected = true;
        return this.session;
      }
    } catch {}
    // fallback to old /api/multiplayer/races endpoint (if exists)
    const r = await this.fetch(`${this.url}/api/multiplayer/races`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, region, track, laps, rules }),
    });
    if (!r.ok) throw new Error(`join failed: ${r.status}`);
    this.session = await r.json();
    this.connected = true;
    return this.session;
  }

  async sendInput(input) {
    if (this.ws && this.ws.readyState === 1) {
      const payload = validateInput({ ...input, seq: ++this.seq });
      this.ws.send(JSON.stringify({ type: 'input', ...payload, x: input.x, z: input.z, yaw: input.yaw, lap: input.lap, checkpoint: input.checkpoint }));
      return;
    }
    if (!this.session) return;
    const payload = validateInput({ ...input, seq: ++this.seq });
    await this.fetch(`${this.url}/api/multiplayer/races/${this.session.raceId}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => { this.connected = false; });
  }

  async poll() {
    if (!this.session) return null;
    const r = await this.fetch(`${this.url}/api/multiplayer/races/${this.session.raceId}/snapshot`);
    if (!r.ok) return null;
    const snapshot = await r.json();
    this.onSnapshot(snapshot);
    return snapshot;
  }

  async reconnect() {
    if (!this.session) return false;
    const r = await this.fetch(`${this.url}/api/multiplayer/races/${this.session.raceId}/reconnect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: this.session.reconnectToken }),
    });
    this.connected = r.ok;
    return r.ok;
  }

  // new lobby helpers
  async listLobbies() {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'listLobbies' }));
      return new Promise(resolve => {
        const handler = (msg) => {
          this.off('lobbyList', handler);
          resolve(msg.lobbies || []);
        };
        this.on('lobbyList', handler);
        setTimeout(() => { this.off('lobbyList', handler); resolve([]); }, 3000);
      });
    }
    const r = await this.fetch(`${this.url}/api/lobbies`);
    if (!r.ok) return [];
    const data = await r.json();
    return data.lobbies || [];
  }

  disconnect() {
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.connected = false;
  }
}
