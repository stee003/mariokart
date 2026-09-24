#!/usr/bin/env node
// Sunforge Racers - static file server + online multiplayer server.
// Zero external dependencies (Node built-ins only).
//
// Static serving:
//   Serves index.html, src/, css/, lib/ etc.
//   GET / -> index.html
//   Same as before.
//
// Multiplayer API:
//   GET  /api/health
//   GET  /api/tracks
//   GET  /api/lobbies
//   POST /api/lobbies         {name, trackId, maxPlayers, playerName}
//   GET  /api/lobbies/:id
//   POST /api/lobbies/:id/join {playerName}
//
// WebSocket:
//   WS /ws   - real-time lobby + race sync (JSON text frames)
//   Protocol documented in MULTIPLAYER.md and below.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.argv[2] || 8000);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
};

// ------------------------------------------------------------------ tracks
// Hard-coded list mirrors src/content/trackDefs.js + arenas for validation.
// Server does not need full defs, just ids.
const TRACK_IDS = [
  'sunforge_circuit','ashfall_run','verdant_loop','neon_cascade','skyline_helix',
  'granite_pass','magma_coil','abyss_dock','forge_line','skyreach',
  'ruins_of_vael','sandstone_crown','tempest_ridge','glimmer_deep','orbital_ring','void_terminal',
  // arenas for battle
  'ember_forge','cryo_hall','neon_plaza','sky_atoll',
];
const DEFAULT_TRACK = 'sunforge_circuit';

// ------------------------------------------------------------------ utils
function sendError(res, status, message) {
  const body = `<!DOCTYPE html><meta charset="utf-8"><title>${status}</title>` +
    `<body style="font-family:system-ui;background:#1b1206;color:#f6e0b5;padding:2rem">` +
    `<h1>${status} ${message}</h1><p><a style="color:#ffb347" href="/">Back to the game</a></p>`;
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}
function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders,
  });
  res.end(body);
}
function resolvePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch { return null; }
  if (decoded.includes('\0')) return null;
  if (decoded.split(/[/\\]+/).includes('..')) return null;
  const rel = path.normalize(decoded).replace(/^([/\\])+/, '');
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}
function statOrNull(p) {
  try { return fs.statSync(p); } catch { return null; }
}
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function randomId(len = 8) {
  return crypto.randomBytes(len).toString('hex').slice(0, len);
}
function now() { return Date.now(); }

// ------------------------------------------------------------------ lobby
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const LOBBY_TTL_MS = 5 * 60 * 1000; // empty lobby dies after 5 min
const PLAYER_TIMEOUT_MS = 30000;
const TICK_RATE = 20; // Hz server tick for racing lobbies

class Lobby {
  constructor({ id, name, trackId, maxPlayers, hostId, hostName }) {
    this.id = id || randomId(6);
    this.name = (name || 'Race').slice(0, 48);
    this.trackId = TRACK_IDS.includes(trackId) ? trackId : DEFAULT_TRACK;
    this.maxPlayers = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, maxPlayers || MAX_PLAYERS));
    this.hostId = hostId;
    this.players = new Map(); // playerId -> player
    this.state = 'lobby'; // lobby | countdown | racing | finished
    this.countdown = 0;
    this.raceTime = 0;
    this.tick = 0;
    this.createdAt = now();
    this.startedAt = 0;
    this.messages = []; // chat
    this.laps = 3;
    this.mode = 'online'; // online | battle (if arena)
    if (['ember_forge','cryo_hall','neon_plaza','sky_atoll'].includes(this.trackId)) {
      this.mode = 'battle';
    }
    this.finishedPlayers = []; // order of finish
  }

  addPlayer(player) {
    if (this.players.size >= this.maxPlayers) return false;
    if (this.state !== 'lobby') return false;
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    return true;
  }

  removePlayer(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    this.players.delete(playerId);
    // reassign host
    if (this.hostId === playerId) {
      const next = [...this.players.keys()][0];
      this.hostId = next || null;
      if (next) {
        const np = this.players.get(next);
        if (np) np.isHost = true;
      }
    }
    if (p) p.isHost = false;
  }

  getPlayer(playerId) { return this.players.get(playerId); }

  isEmpty() { return this.players.size === 0; }
  isExpired() { return this.isEmpty() && (now() - this.createdAt > LOBBY_TTL_MS); }

  // snapshot for lobby list (public)
  publicInfo() {
    return {
      id: this.id,
      name: this.name,
      trackId: this.trackId,
      maxPlayers: this.maxPlayers,
      playerCount: this.players.size,
      state: this.state,
      mode: this.mode,
      hostId: this.hostId,
      createdAt: this.createdAt,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, color: p.color, ready: p.ready, isHost: p.isHost, connected: p.connected,
      })),
    };
  }

  // detailed for members
  fullInfo() {
    return {
      ...this.publicInfo(),
      laps: this.laps,
      countdown: this.countdown,
      raceTime: this.raceTime,
      tick: this.tick,
      messages: this.messages.slice(-50),
      standings: this.computeStandings(),
    };
  }

  computeStandings() {
    const arr = [...this.players.values()];
    // sort: finished first by finishTime, then by lap+checkpoint, then progress proxy (distance)
    arr.sort((a, b) => {
      if (a.finished && b.finished) return (a.finishTime || 0) - (b.finishTime || 0);
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.lap !== b.lap) return b.lap - a.lap;
      if (a.checkpoint !== b.checkpoint) return b.checkpoint - a.checkpoint;
      // if we have progress estimate
      return (b.progress || 0) - (a.progress || 0);
    });
    return arr.map((p, i) => ({
      id: p.id, name: p.name, position: i+1, lap: p.lap, checkpoint: p.checkpoint,
      finished: p.finished, finishTime: p.finishTime || null,
      x: p.x, z: p.z, yaw: p.yaw, speed: p.speed,
    }));
  }

  startCountdown() {
    if (this.state !== 'lobby') return false;
    if (this.players.size < 1) return false;
    // require at least host ready or all ready? For simplicity host can start anytime.
    this.state = 'countdown';
    this.countdown = 3.5; // seconds
    this.raceTime = 0;
    this.tick = 0;
    this.finishedPlayers = [];
    for (const p of this.players.values()) {
      p.lap = 0;
      p.checkpoint = -1;
      p.finished = false;
      p.finishTime = null;
      p.progress = 0;
      p.raceReady = false;
      p.hasPose = false;
    }
    return true;
  }

  update(dt) {
    this.tick++;
    if (this.state === 'countdown') {
      // Loading a track is asynchronous and can vary greatly between clients.
      // Do not consume the countdown until every connected racer has built its
      // track, kart and physics state and explicitly acknowledged readiness.
      const connected = [...this.players.values()].filter(p => p.connected);
      if (!connected.length || connected.some(p => !p.raceReady)) return;
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = 'racing';
        this.startedAt = now();
        this.countdown = 0;
      }
    } else if (this.state === 'racing') {
      this.raceTime += dt;
      // check finish: if all finished or raceTime > max
      const allFinished = [...this.players.values()].every(p => p.finished || !p.connected);
      if (allFinished && this.players.size > 0) {
        this.state = 'finished';
      }
      // auto finish after 5 minutes
      if (this.raceTime > 300) {
        this.state = 'finished';
      }
    } else if (this.state === 'finished') {
      // after 15 sec, go back to lobby
      if (this.raceTime > 0 && (now() - this.startedAt) > 315000) { // 5 min + 15 sec
        this.state = 'lobby';
        this.raceTime = 0;
        this.tick = 0;
        for (const p of this.players.values()) {
          p.ready = false;
          p.finished = false;
          p.finishTime = null;
        }
      }
    }
  }

  // validate and apply player position update
  applyPlayerUpdate(playerId, update) {
    const p = this.players.get(playerId);
    if (!p) return { valid: false, reason: 'unknown player' };
    if (this.state !== 'racing' && this.state !== 'countdown') {
      // allow position updates in lobby for preview? ignore
      // but we still allow x,z for lobby character preview
      if (update.x !== undefined) {
        p.x = Number(update.x) || 0;
        p.z = Number(update.z) || 0;
        p.yaw = Number(update.yaw) || 0;
      }
      return { valid: true };
    }

    // Anti-cheat simple checks
    const nx = Number(update.x), nz = Number(update.z);
    const yaw = Number(update.yaw);
    const speed = Number(update.speed);
    const lap = Math.floor(Number(update.lap) || 0);
    const checkpoint = Math.floor(Number(update.checkpoint) ?? -1);
    const progress = Number(update.progress) || 0;

    if (Number.isFinite(nx) && Number.isFinite(nz)) {
      const dx = nx - (p.x || 0), dz = nz - (p.z || 0);
      const dist = Math.hypot(dx, dz);
      const dt = 1 / TICK_RATE;
      const estSpeed = dist / dt;
      // teleport check: if dist > 25m in one tick, reject unless near start
      if (dist > 30 && this.raceTime > 2) {
        return { valid: false, reason: 'teleport' };
      }
      // speed check
      if (estSpeed > 55 && speed > 45) {
        // allow but flag
        // we don't reject, just clamp
      }
      p.x = nx; p.z = nz;
      p.hasPose = true;
      p.lastUpdate = now();
      if (Number.isFinite(yaw)) p.yaw = yaw;
      if (Number.isFinite(speed)) p.speed = Math.min(60, Math.max(0, speed));
      p.progress = progress;
    }

    if (Number.isFinite(lap)) {
      // lap should not go backwards by more than 1, nor jump more than 1 ahead without checkpoints
      if (lap >= p.lap && lap <= p.lap + 1) {
        if (lap > p.lap) {
          // require some checkpoint progress? simple: allow
          p.lap = lap;
        }
      } else if (lap === p.lap) {
        // ok
      }
      // else ignore lap regression
    }
    if (Number.isFinite(checkpoint)) {
      if (checkpoint >= p.checkpoint && checkpoint <= p.checkpoint + 1) {
        p.checkpoint = checkpoint;
      } else if (checkpoint === -1) {
        // reset
      }
    }

    // finish
    if (update.finished && !p.finished) {
      // validate: must have completed required laps
      if (p.lap >= this.laps) {
        p.finished = true;
        p.finishTime = this.raceTime;
        this.finishedPlayers.push(p.id);
        if (this.finishedPlayers.length === 1) {
          // first finisher
        }
      }
    }

    p.lastUpdate = now();
    return { valid: true };
  }

  addChat(playerId, message) {
    const p = this.players.get(playerId);
    if (!p) return null;
    const entry = {
      id: randomId(4),
      playerId,
      name: p.name,
      message: String(message).slice(0, 200),
      ts: now(),
    };
    this.messages.push(entry);
    if (this.messages.length > 100) this.messages.shift();
    return entry;
  }
}

// Global lobby store
const lobbies = new Map(); // id -> Lobby

function createLobby({ name, trackId, maxPlayers, hostId, hostName }) {
  const id = randomId(6);
  const lobby = new Lobby({ id, name, trackId, maxPlayers, hostId, hostName });
  lobbies.set(id, lobby);
  return lobby;
}
function getLobby(id) { return lobbies.get(id); }
function listLobbies() { return [...lobbies.values()].map(l => l.publicInfo()); }
function cleanupLobbies() {
  for (const [id, lobby] of lobbies) {
    if (lobby.isExpired()) {
      lobbies.delete(id);
    }
  }
}
setInterval(cleanupLobbies, 30000);

// ------------------------------------------------------------------ WebSocket
// Minimal WS implementation (no external deps)

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const wsConnections = new Set(); // Set of WSConn

class WSConn {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.playerId = null;
    this.lobbyId = null;
    this.name = null;
    this.connected = true;
    this.isAlive = true;
    this.lastPing = now();
    this.sendQueue = [];
  }

  send(obj) {
    if (!this.connected) return;
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    const payload = Buffer.from(text);
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81; // FIN + text
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {}
  }

  sendRaw(opcode, payloadBuf) {
    const len = payloadBuf.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { this.socket.write(Buffer.concat([header, payloadBuf])); } catch {}
  }

  close(code = 1000, reason = '') {
    if (!this.connected) return;
    this.connected = false;
    try {
      const reasonBuf = Buffer.from(reason);
      const buf = Buffer.alloc(2 + reasonBuf.length);
      buf.writeUInt16BE(code, 0);
      reasonBuf.copy(buf, 2);
      this.sendRaw(0x8, buf);
    } catch {}
    try { this.socket.end(); } catch {}
    wsConnections.delete(this);
    handleDisconnect(this);
  }

  handleFrame(opcode, payload) {
    if (opcode === 0x8) { // close
      this.close();
      return;
    }
    if (opcode === 0x9) { // ping
      this.sendRaw(0xA, payload); // pong
      return;
    }
    if (opcode === 0xA) { // pong
      this.isAlive = true;
      return;
    }
    if (opcode === 0x1) { // text
      const text = payload.toString('utf8');
      try {
        const msg = JSON.parse(text);
        handleWsMessage(this, msg);
      } catch (e) {
        this.send({ type: 'error', message: 'invalid json' });
      }
      return;
    }
    // ignore others
  }

  // Append data and try to parse frames
  pushData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0F;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7F;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) break;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) break;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(10 * 1024 * 1024)) { this.close(1009, 'too big'); return; }
        payloadLen = Number(big);
        offset = 10;
      }

      const maskKeyLen = masked ? 4 : 0;
      if (this.buffer.length < offset + maskKeyLen + payloadLen) break;

      let maskKey;
      if (masked) {
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      let payload = this.buffer.subarray(offset, offset + payloadLen);
      if (masked) {
        // unmask in place
        const unmasked = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
        payload = unmasked;
      }

      // consume
      this.buffer = this.buffer.subarray(offset + payloadLen);

      // For simplicity we only support unfragmented messages (FIN=1)
      if (!fin) {
        // we don't support fragmentation, but we can still handle by buffering?
        // For now ignore and close if we see non-FIN text without handling
        // We'll just process as if FIN
      }

      this.handleFrame(opcode, payload);
    }
  }
}

function handleWsMessage(conn, msg) {
  if (!msg || typeof msg.type !== 'string') {
    conn.send({ type: 'error', message: 'missing type' });
    return;
  }

  switch (msg.type) {
    case 'ping': {
      conn.send({ type: 'pong', t: msg.t || now() });
      break;
    }
    case 'createLobby': {
      const name = String(msg.name || `${msg.playerName || 'Player'}'s Race`).slice(0, 48);
      const trackId = String(msg.trackId || DEFAULT_TRACK);
      const maxPlayers = Number(msg.maxPlayers) || MAX_PLAYERS;
      const playerName = String(msg.playerName || 'Player').slice(0, 24) || 'Player';
      const playerId = randomId(8);
      const lobby = createLobby({ name, trackId, maxPlayers, hostId: playerId, hostName: playerName });
      const player = {
        id: playerId,
        name: playerName,
        color: msg.color || Math.floor(Math.random()*0xffffff),
        ready: true,
        isHost: true,
        connected: true,
        x: 0, z: 0, yaw: 0, speed: 0, lap: 0, checkpoint: -1, progress: 0,
        finished: false, finishTime: null,
        lastUpdate: now(),
        conn,
      };
      lobby.addPlayer(player);
      conn.playerId = playerId;
      conn.lobbyId = lobby.id;
      conn.name = playerName;
      conn.send({ type: 'connected', playerId });
      conn.send({ type: 'lobbyJoined', lobby: lobby.fullInfo(), playerId });
      broadcastLobby(lobby.id, { type: 'lobbyUpdate', lobby: lobby.fullInfo() }, null);
      break;
    }
    case 'joinLobby': {
      const lobbyId = String(msg.lobbyId || '');
      const playerName = String(msg.playerName || 'Player').slice(0, 24) || 'Player';
      const lobby = getLobby(lobbyId);
      if (!lobby) { conn.send({ type: 'error', message: 'lobby not found' }); return; }
      if (lobby.players.size >= lobby.maxPlayers) { conn.send({ type: 'error', message: 'lobby full' }); return; }
      if (lobby.state !== 'lobby') { conn.send({ type: 'error', message: 'race already started' }); return; }
      const playerId = randomId(8);
      const player = {
        id: playerId,
        name: playerName,
        color: msg.color || Math.floor(Math.random()*0xffffff),
        ready: false,
        isHost: false,
        connected: true,
        x: 0, z: 0, yaw: 0, speed: 0, lap: 0, checkpoint: -1, progress: 0,
        finished: false, finishTime: null,
        lastUpdate: now(),
        conn,
      };
      if (!lobby.addPlayer(player)) { conn.send({ type: 'error', message: 'cannot join' }); return; }
      conn.playerId = playerId;
      conn.lobbyId = lobby.id;
      conn.name = playerName;
      conn.send({ type: 'connected', playerId });
      conn.send({ type: 'lobbyJoined', lobby: lobby.fullInfo(), playerId });
      broadcastLobby(lobby.id, { type: 'playerJoined', player: { id: player.id, name: player.name, color: player.color, isHost: player.isHost }, lobby: lobby.fullInfo() }, playerId);
      broadcastLobby(lobby.id, { type: 'lobbyUpdate', lobby: lobby.fullInfo() }, null);
      break;
    }
    case 'listLobbies': {
      conn.send({ type: 'lobbyList', lobbies: listLobbies() });
      break;
    }
    case 'leaveLobby': {
      if (conn.lobbyId) {
        const lobby = getLobby(conn.lobbyId);
        if (lobby) {
          lobby.removePlayer(conn.playerId);
          broadcastLobby(lobby.id, { type: 'playerLeft', playerId: conn.playerId, lobby: lobby.fullInfo() }, null);
          if (lobby.isEmpty()) {
            // keep for TTL, but we can also delete immediately if desired
            // lobbies.delete(lobby.id);
          }
        }
        conn.lobbyId = null;
      }
      conn.send({ type: 'leftLobby' });
      break;
    }
    case 'ready': {
      const lobby = getLobby(conn.lobbyId);
      if (!lobby) return;
      const p = lobby.getPlayer(conn.playerId);
      if (!p) return;
      p.ready = msg.ready !== undefined ? !!msg.ready : !p.ready;
      broadcastLobby(lobby.id, { type: 'lobbyUpdate', lobby: lobby.fullInfo() }, null);
      break;
    }
    case 'startRace': {
      const lobby = getLobby(conn.lobbyId);
      if (!lobby) return;
      const p = lobby.getPlayer(conn.playerId);
      if (!p || !p.isHost) { conn.send({ type: 'error', message: 'only host can start' }); return; }
      if (!lobby.startCountdown()) { conn.send({ type: 'error', message: 'cannot start' }); return; }
      broadcastLobby(lobby.id, { type: 'countdown', value: lobby.countdown, lobby: lobby.fullInfo() }, null);
      break;
    }
    case 'raceReady': {
      const lobby = getLobby(conn.lobbyId);
      const p = lobby?.getPlayer(conn.playerId);
      if (!p || lobby.state !== 'countdown') return;
      // The acknowledgement is scoped to this countdown; startCountdown
      // resets it, preventing stale readiness from a previous race.
      p.raceReady = true;
      broadcastLobby(lobby.id, { type: 'raceReadyUpdate', playerId: p.id }, null);
      break;
    }
    case 'input': {
      const lobby = getLobby(conn.lobbyId);
      if (!lobby) return;
      // msg contains pos, input, lap, checkpoint, etc
      lobby.applyPlayerUpdate(conn.playerId, msg);
      // we don't broadcast input individually; snapshot will include
      break;
    }
    case 'chat': {
      const lobby = getLobby(conn.lobbyId);
      if (!lobby) return;
      const entry = lobby.addChat(conn.playerId, msg.message);
      if (entry) broadcastLobby(lobby.id, { type: 'chat', message: entry }, null);
      break;
    }
    case 'updateTrack': {
      // host can change track in lobby
      const lobby = getLobby(conn.lobbyId);
      if (!lobby || lobby.state !== 'lobby') return;
      const p = lobby.getPlayer(conn.playerId);
      if (!p || !p.isHost) return;
      const trackId = String(msg.trackId || '');
      if (TRACK_IDS.includes(trackId)) {
        lobby.trackId = trackId;
        lobby.mode = ['ember_forge','cryo_hall','neon_plaza','sky_atoll'].includes(trackId) ? 'battle' : 'online';
        broadcastLobby(lobby.id, { type: 'lobbyUpdate', lobby: lobby.fullInfo() }, null);
      }
      break;
    }
    case 'finish': {
      const lobby = getLobby(conn.lobbyId);
      if (!lobby) return;
      const p = lobby.getPlayer(conn.playerId);
      if (!p) return;
      if (!p.finished) {
        p.finished = true;
        p.finishTime = lobby.raceTime;
        lobby.finishedPlayers.push(p.id);
      }
      // if all finished, move to finished state quickly
      const remaining = [...lobby.players.values()].filter(pl => !pl.finished && pl.connected);
      if (remaining.length === 0) {
        lobby.state = 'finished';
        broadcastLobby(lobby.id, { type: 'raceFinished', standings: lobby.computeStandings(), lobby: lobby.fullInfo() }, null);
      }
      break;
    }
    case 'returnToLobby': {
      const lobby = getLobby(conn.lobbyId);
      if (!lobby) return;
      const p = lobby.getPlayer(conn.playerId);
      if (!p || !p.isHost) return;
      lobby.state = 'lobby';
      lobby.raceTime = 0;
      lobby.tick = 0;
      for (const pl of lobby.players.values()) {
        pl.ready = false;
        pl.finished = false;
        pl.finishTime = null;
        pl.lap = 0;
        pl.checkpoint = -1;
      }
      broadcastLobby(lobby.id, { type: 'lobbyUpdate', lobby: lobby.fullInfo() }, null);
      break;
    }
    default: {
      conn.send({ type: 'error', message: `unknown type ${msg.type}` });
    }
  }
}

function handleDisconnect(conn) {
  if (conn.lobbyId) {
    const lobby = getLobby(conn.lobbyId);
    if (lobby) {
      const player = lobby.getPlayer(conn.playerId);
      if (player) {
        player.connected = false;
        player.conn = null;
        // grace period: if racing, keep player as disconnected for 30 sec, else remove immediately if lobby state
        if (lobby.state === 'lobby') {
          lobby.removePlayer(conn.playerId);
          broadcastLobby(lobby.id, { type: 'playerLeft', playerId: conn.playerId, lobby: lobby.fullInfo() }, null);
        } else {
          // mark disconnected, broadcast
          broadcastLobby(lobby.id, { type: 'playerDisconnected', playerId: conn.playerId, lobby: lobby.fullInfo() }, null);
          // schedule removal after timeout if not reconnected
          setTimeout(() => {
            const l = getLobby(conn.lobbyId);
            if (!l) return;
            const pl = l.getPlayer(conn.playerId);
            if (pl && !pl.connected) {
              l.removePlayer(conn.playerId);
              broadcastLobby(l.id, { type: 'playerLeft', playerId: conn.playerId, lobby: l.fullInfo() }, null);
            }
          }, PLAYER_TIMEOUT_MS);
        }
      }
    }
  }
}

function broadcastLobby(lobbyId, msg, excludePlayerId = null) {
  const lobby = getLobby(lobbyId);
  if (!lobby) return;
  const text = JSON.stringify(msg);
  for (const p of lobby.players.values()) {
    if (excludePlayerId && p.id === excludePlayerId) continue;
    if (p.conn && p.conn.connected) {
      p.conn.send(text);
    }
  }
}

// Server tick for racing lobbies
setInterval(() => {
  const dt = 1 / TICK_RATE;
  for (const lobby of lobbies.values()) {
    if (lobby.state === 'countdown' || lobby.state === 'racing') {
      const prevState = lobby.state;
      lobby.update(dt);
      if (prevState === 'countdown' && lobby.state === 'racing') {
        broadcastLobby(lobby.id, { type: 'raceStart', lobby: lobby.fullInfo() }, null);
      }
      // broadcast snapshot
      const snapshot = {
        type: 'snapshot',
        tick: lobby.tick,
        state: lobby.state,
        raceTime: lobby.raceTime,
        countdown: lobby.countdown,
        players: [...lobby.players.values()].map(p => ({
          id: p.id, name: p.name, color: p.color,
          x: p.x, z: p.z, yaw: p.yaw, speed: p.speed,
          lap: p.lap, checkpoint: p.checkpoint, progress: p.progress,
          finished: p.finished, finishTime: p.finishTime,
          connected: p.connected, raceReady: !!p.raceReady, hasPose: !!p.hasPose,
        })),
        standings: lobby.computeStandings(),
      };
      broadcastLobby(lobby.id, snapshot, null);
      if (lobby.state === 'finished' && prevState !== 'finished') {
        broadcastLobby(lobby.id, { type: 'raceFinished', standings: lobby.computeStandings(), lobby: lobby.fullInfo() }, null);
      }
    }
  }
}, 1000 / TICK_RATE);

// ------------------------------------------------------------------ HTTP server
function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      time: now(),
      lobbies: lobbies.size,
      players: [...lobbies.values()].reduce((a, l) => a + l.players.size, 0),
      tracks: TRACK_IDS.length,
      tickRate: TICK_RATE,
      maxPlayers: MAX_PLAYERS,
    });
  }

  if (pathname === '/api/tracks') {
    return sendJson(res, 200, { tracks: TRACK_IDS.map(id => ({ id })) });
  }

  if (pathname === '/api/lobbies' && req.method === 'GET') {
    return sendJson(res, 200, { lobbies: listLobbies() });
  }

  if (pathname === '/api/lobbies' && req.method === 'POST') {
    readJsonBody(req).then(body => {
      const name = String(body.name || `${body.playerName || 'Player'}'s Race`).slice(0, 48);
      const trackId = String(body.trackId || DEFAULT_TRACK);
      const maxPlayers = Number(body.maxPlayers) || MAX_PLAYERS;
      const playerName = String(body.playerName || 'Player').slice(0, 24);
      const hostId = randomId(8);
      const lobby = createLobby({ name, trackId, maxPlayers, hostId, hostName: playerName });
      const player = {
        id: hostId, name: playerName, color: body.color || Math.floor(Math.random()*0xffffff),
        ready: true, isHost: true, connected: false,
        x: 0, z: 0, yaw: 0, speed: 0, lap: 0, checkpoint: -1, progress: 0,
        finished: false, finishTime: null, lastUpdate: now(), conn: null,
      };
      lobby.addPlayer(player);
      sendJson(res, 201, { lobby: lobby.fullInfo(), playerId: hostId });
    }).catch(() => sendJson(res, 400, { error: 'invalid json' }));
    return;
  }

  const lobbyMatch = pathname.match(/^\/api\/lobbies\/([^/]+)(\/join)?$/);
  if (lobbyMatch) {
    const lobbyId = lobbyMatch[1];
    const lobby = getLobby(lobbyId);
    if (!lobby) return sendJson(res, 404, { error: 'lobby not found' });

    if (req.method === 'GET' && !lobbyMatch[2]) {
      return sendJson(res, 200, { lobby: lobby.fullInfo() });
    }

    if (lobbyMatch[2] === '/join' && req.method === 'POST') {
      readJsonBody(req).then(body => {
        const playerName = String(body.playerName || 'Player').slice(0, 24);
        if (lobby.players.size >= lobby.maxPlayers) return sendJson(res, 400, { error: 'lobby full' });
        if (lobby.state !== 'lobby') return sendJson(res, 400, { error: 'race already started' });
        const playerId = randomId(8);
        const player = {
          id: playerId, name: playerName, color: body.color || Math.floor(Math.random()*0xffffff),
          ready: false, isHost: false, connected: false,
          x: 0, z: 0, yaw: 0, speed: 0, lap: 0, checkpoint: -1, progress: 0,
          finished: false, finishTime: null, lastUpdate: now(), conn: null,
        };
        if (!lobby.addPlayer(player)) return sendJson(res, 400, { error: 'cannot join' });
        sendJson(res, 200, { lobby: lobby.fullInfo(), playerId });
        broadcastLobby(lobby.id, { type: 'lobbyUpdate', lobby: lobby.fullInfo() }, null);
      }).catch(() => sendJson(res, 400, { error: 'invalid json' }));
      return;
    }
  }

  // fallback 404 for /api/*
  return sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  // API routes first (allow POST etc)
  if (req.url.startsWith('/api/')) {
    return handleApi(req, res);
  }

  // Only GET/HEAD for static
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Method Not Allowed\n');
  }

  let target = resolvePath(req.url || '/');
  if (target === null) return sendError(res, 403, 'Forbidden');

  let info = statOrNull(target);
  if (info?.isDirectory()) {
    target = path.join(target, 'index.html');
    info = statOrNull(target);
  }
  if (!info && !path.extname(target)) {
    const withHtml = `${target}.html`;
    if (statOrNull(withHtml)?.isFile()) {
      target = withHtml;
      info = statOrNull(target);
    }
  }
  if (!info?.isFile()) return sendError(res, 404, 'Not Found');

  const headers = {
    'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();

  const stream = fs.createReadStream(target);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});

// WebSocket upgrade handling
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws' && url.pathname !== '/api/multiplayer/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];
  const upgrade = (req.headers['upgrade'] || '').toLowerCase();
  if (!key || upgrade !== 'websocket' || version !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '\r\n',
  ].join('\r\n');
  socket.write(responseHeaders);

  const conn = new WSConn(socket);
  wsConnections.add(conn);

  // if there's leftover head data, push it
  if (head && head.length) conn.pushData(head);

  socket.on('data', chunk => conn.pushData(chunk));
  socket.on('close', () => { conn.connected = false; wsConnections.delete(conn); handleDisconnect(conn); });
  socket.on('error', () => { conn.connected = false; wsConnections.delete(conn); handleDisconnect(conn); });

  // ping/pong keepalive
  const interval = setInterval(() => {
    if (!conn.connected) { clearInterval(interval); return; }
    if (!conn.isAlive) { conn.close(); clearInterval(interval); return; }
    conn.isAlive = false;
    try { conn.sendRaw(0x9, Buffer.alloc(0)); } catch {}
  }, 30000);
  socket.on('close', () => clearInterval(interval));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Try another one:  PORT=${PORT + 1} npm start\n`);
  } else {
    console.error(`\n  Server error: ${err.message}\n`);
  }
  process.exit(1);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

server.listen(PORT, HOST, () => {
  const { port } = server.address();
  console.log(`\n  Sunforge Racers is running!`);
  console.log(`  Local:   http://localhost:${port}`);
  console.log(`  Network: http://${HOST}:${port}   (bound to ${HOST})`);
  console.log(`  Multiplayer: ws://localhost:${port}/ws  +  /api/lobbies`);
  console.log(`\n  Serving ${ROOT}`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
