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
// Ranked mode: monthly seasons (season id = YYYY-MM). Match results feed a
// points ladder; deltas are computed by the provider, never by clients.
// ============================================================================

// Multiplayer simulation, validation and matchmaking live in a separate
// dependency-free module so the offline provider remains unchanged.
export { MODES, REGIONS, TICK_RATE, validateInput, AntiCheat, AuthoritativeRace, Matchmaker, Rating, ReportStore, leaderboardRows } from './multiplayer.js';
export { MultiplayerClient } from './multiplayerClient.js';

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
