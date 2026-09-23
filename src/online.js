// ============================================================================
// Online architecture.
//
// Sunforge Racers is a static, zero-dependency game. Online features are
// built behind a PROVIDER CONTRACT so a backend can be attached without
// touching game code. Two providers ship:
//
//   LocalProvider  - fully offline; wraps LocalLeaderboard in async calls.
//                    Always available; the default.
//   HttpProvider   - speaks a small REST contract against any backend:
//                      GET  {base}/leaderboard/{trackId}?limit=N
//                      POST {base}/leaderboard/{trackId}        {name,time}
//                      GET  {base}/ranked/season                {season,rank,points}
//                      POST {base}/ranked/match                 {trackId,winner,delta}
//                    Every call is idempotent-safe and fails soft (throws
//                    OnlineUnavailable; the UI falls back to local).
//
//   OnlineService  - picks the provider at runtime: it pings the game server
//                    and uses HttpProvider when the server answers, otherwise
//                    it stays on LocalProvider. The UI only ever talks to the
//                    service, so a dropped backend degrades gracefully.
//
// Ranked mode: monthly seasons (season id = YYYY-MM). Match results feed a
// points ladder; deltas are computed by the provider, never by clients.
// ============================================================================

export class OnlineUnavailable extends Error {
  constructor(msg) { super(msg); this.name = 'OnlineUnavailable'; }
}

export function seasonId(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- contract
// Any provider must implement (all async):
//   name                     -> string
//   ping()                   -> {ok, latencyMs}
//   fetchLeaderboard(trackId, limit) -> [{name, time, date}]
//   submitScore(trackId, entry)      -> {rank} | {rank: null}
//   getRanked(playerName)    -> {season, rank, points} | null
//   submitMatch(playerName, {trackId, won}) -> {season, rank, points, delta}

// ------------------------------------------------------------------ local
export class LocalProvider {
  constructor(leaderboard) {
    this.leaderboard = leaderboard;
    this._ranked = new Map();   // playerName -> {points}
  }

  get name() { return 'local'; }

  async ping() { return { ok: true, latencyMs: 0 }; }

  async fetchLeaderboard(trackId, limit = 10) {
    return this.leaderboard.top(trackId, limit);
  }

  async submitScore(trackId, entry) {
    return { rank: this.leaderboard.submit(trackId, entry) };
  }

  async getRanked(playerName) {
    const r = this._ranked.get(playerName);
    if (!r) return null;
    return { season: seasonId(), rank: null, points: r.points };
  }

  async submitMatch(playerName, { won }) {
    const r = this._ranked.get(playerName) || { points: 1000 };
    const delta = won ? 25 : -18;
    r.points = Math.max(0, r.points + delta);
    this._ranked.set(playerName, r);
    return { season: seasonId(), rank: null, points: r.points, delta };
  }
}

// ------------------------------------------------------------------- http
export class HttpProvider {
  constructor(baseUrl, fetchImpl = fetch) {
    this.base = baseUrl.replace(/\/$/, '');
    this._fetch = fetchImpl;
  }

  get name() { return 'http'; }

  async _req(path, opts = {}) {
    let res;
    try {
      res = await this._fetch(this.base + path, {
        ...opts,
        signal: AbortSignal.timeout(6000),
        headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
      });
    } catch (e) {
      throw new OnlineUnavailable(`network: ${e.message || e}`);
    }
    if (!res.ok) throw new OnlineUnavailable(`status ${res.status}`);
    return res.json();
  }

  async ping() {
    const t0 = Date.now();
    await this._req('/ping');
    return { ok: true, latencyMs: Date.now() - t0 };
  }

  async fetchLeaderboard(trackId, limit = 10) {
    return this._req(`/leaderboard/${encodeURIComponent(trackId)}?limit=${limit}`);
  }

  async submitScore(trackId, entry) {
    return this._req(`/leaderboard/${encodeURIComponent(trackId)}`, {
      method: 'POST', body: JSON.stringify(entry),
    });
  }

  async getRanked(playerName) {
    return this._req(`/ranked/season?player=${encodeURIComponent(playerName)}`);
  }

  async submitMatch(playerName, result) {
    return this._req('/ranked/match', {
      method: 'POST',
      body: JSON.stringify({ player: playerName, ...result }),
    });
  }
}

// ------------------------------------------------------------------ service
// The URL the browser should talk to when the game is served over http(s).
export function defaultBaseUrl(location = globalThis.location) {
  if (!location || !location.origin || location.origin === 'null') return null;
  if (!/^https?:$/.test(location.protocol || '')) return null;
  return `${location.origin}/api`;
}

// Runtime provider switch. Implements the same provider contract it wraps, so
// every existing consumer (records screen, leaderboard submit) keeps working
// without knowing whether a backend exists.
export class OnlineService {
  constructor({ leaderboard, fetchImpl = globalThis.fetch, baseUrl = defaultBaseUrl(), timeoutMs = 2500 } = {}) {
    this.local = new LocalProvider(leaderboard);
    this.http = baseUrl && fetchImpl ? new HttpProvider(baseUrl, fetchImpl) : null;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this._online = false;
    this.latency = null;
    this.status = this.http ? 'unknown' : 'offline';
    this.info = null;
  }

  get provider() { return this._online && this.http ? this.http : this.local; }
  get online() { return this._online; }
  get name() { return this.provider.name; }

  async probe() {
    if (!this.http) { this.status = 'offline'; return false; }
    this.status = 'checking';
    try {
      const res = await this.http._fetch(`${this.baseUrl}/ping`, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const t0 = Date.now();
      const info = await res.json();
      this.latency = Date.now() - t0;
      this.info = info;
      this._online = true;
      this.status = 'online';
      return true;
    } catch {
      this._online = false;
      this.status = 'offline';
      return false;
    }
  }

  // ---- provider contract (delegates to whichever provider is active) -------
  async ping() {
    if (this._online && this.http) {
      const t0 = Date.now();
      await this.http.ping();
      return { ok: true, latencyMs: Date.now() - t0 };
    }
    return { ok: false, latencyMs: null };
  }

  fetchLeaderboard(trackId, limit = 10) { return this.provider.fetchLeaderboard(trackId, limit); }
  submitScore(trackId, entry) { return this.provider.submitScore(trackId, entry); }
  getRanked(player) { return this.provider.getRanked(player); }
  submitMatch(player, result) { return this.provider.submitMatch(player, result); }

  // ---- online-only helpers (records browser / online screen) --------------
  async fetchWorldGhost(trackId, rank = 1) {
    if (!this._online || !this.http) return null;
    try {
      const data = await this.http._req(`/leaderboard/${encodeURIComponent(trackId)}/ghost?rank=${rank}`);
      if (!data || !Array.isArray(data.frames)) return null;
      // server frame format: [x, y, z, yaw] -> GhostPlayer's {x,y,z,yaw}
      return {
        name: data.name, time: data.time,
        frames: data.frames.map(([x, y, z, yaw]) => ({ x, y, z, yaw })),
      };
    } catch {
      return null;
    }
  }

  async fetchLadder(limit = 10) {
    if (!this._online || !this.http) return [];
    try {
      const data = await this.http._req(`/ranked/ladder?limit=${limit}`);
      return data.rows || [];
    } catch {
      return [];
    }
  }

  async fetchRooms() {
    if (!this._online || !this.http) return [];
    try {
      const data = await this.http._req('/rooms');
      return data.open || [];
    } catch {
      return [];
    }
  }
}
