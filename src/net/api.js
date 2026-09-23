// ============================================================================
// HTTP API for the online features - the server side of the HttpProvider
// contract in src/online.js.
//
//   GET  /api/ping
//   GET  /api/leaderboard/:trackId?limit=N
//   POST /api/leaderboard/:trackId        {name,time,ghost?,characterId?}
//   GET  /api/leaderboard/:trackId/ghost?rank=1
//   GET  /api/ranked/season?player=NAME
//   GET  /api/ranked/ladder?limit=N
//   POST /api/ranked/match                {player,trackId,won,opponentPoints?}
//   GET  /api/rooms                       open lobbies (for the online screen)
//   GET  /api/stats
//
// Rules: JSON only, small bodies, per-IP write budget, no CORS wildcard (the
// game is served from this same origin), and no stack traces to clients.
// ============================================================================

import { LEADERBOARD_SIZE, seasonId } from './store.js';

const MAX_BODY = 128 * 1024;       // ghosts push this a little higher than score posts
const WRITE_BUDGET = 60;           // writes per window per IP
const WINDOW_MS = 60 * 1000;

export function createApi({ store, rooms = null, now = () => Date.now(), logger = console } = {}) {
  const buckets = new Map();       // ip -> {count, resetAt}

  function rateLimited(ip) {
    const t = now();
    let b = buckets.get(ip);
    if (!b || b.resetAt <= t) { b = { count: 0, resetAt: t + WINDOW_MS }; buckets.set(ip, b); }
    b.count += 1;
    return b.count > WRITE_BUDGET;
  }

  function json(res, status, payload) {
    const body = JSON.stringify(payload ?? null);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) return resolve({});
        try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
      });
      req.on('error', (e) => reject(e));
    });
  }

  // Returns true when the request was an /api route (handled or rejected).
  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;

    const ip = (req.socket.remoteAddress || 'local');
    const seg = url.pathname.slice('/api/'.length).split('/').filter(Boolean);
    const [head, arg] = seg;
    const method = req.method || 'GET';

    try {
      if (head === 'ping') return json(res, 200, { ok: true, name: 'sunforge-racers', season: seasonId(new Date(now())), stats: store.stats() }), true;

      if (head === 'stats') return json(res, 200, store.stats()), true;

      if (head === 'rooms') {
        return json(res, 200, rooms ? { open: rooms.list() } : { open: [] }), true;
      }

      if (head === 'leaderboard' && arg) {
        if (method === 'GET' && seg[2] === 'ghost') {
          const rank = Number(url.searchParams.get('rank') || 1);
          const ghost = store.getGhost(arg, Number.isFinite(rank) ? rank : 1);
          if (!ghost) return json(res, 404, { error: 'no-ghost' }), true;
          return json(res, 200, ghost), true;
        }
        if (method === 'GET') {
          const limit = Number(url.searchParams.get('limit') || 10);
          return json(res, 200, store.topScores(arg, Number.isFinite(limit) ? limit : 10)), true;
        }
        if (method === 'POST') {
          if (rateLimited(ip)) return json(res, 429, { error: 'rate-limited' }), true;
          const body = await readBody(req);
          const out = store.submitScore(arg, body);
          return json(res, 200, out), true;
        }
        return json(res, 405, { error: 'method' }), true;
      }

      if (head === 'ranked') {
        if (arg === 'season' && method === 'GET') {
          const player = url.searchParams.get('player') || '';
          const info = store.getRanked(player);
          return json(res, 200, info || { season: seasonId(new Date(now())), rank: null, points: null }), true;
        }
        if (arg === 'ladder' && method === 'GET') {
          const season = url.searchParams.get('season') || seasonId(new Date(now()));
          const limit = Number(url.searchParams.get('limit') || 20);
          return json(res, 200, { season, rows: store.ladder(season, Number.isFinite(limit) ? limit : 20) }), true;
        }
        if (arg === 'match' && method === 'POST') {
          if (rateLimited(ip)) return json(res, 429, { error: 'rate-limited' }), true;
          const body = await readBody(req);
          const out = store.submitMatch(body.player, body);
          return json(res, 200, out), true;
        }
        return json(res, 405, { error: 'method' }), true;
      }

      return json(res, 404, { error: 'not-found' }), true;
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) logger.error?.('[api]', err.message);
      return json(res, status, { error: err.message || 'error' }), true;
    }
  }

  return { handle, json, readBody, rateLimited, buckets, LEADERBOARD_SIZE };
}
