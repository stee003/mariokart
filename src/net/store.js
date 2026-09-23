// ============================================================================
// OnlineStore - the backend the HTTP provider contract talks to.
//
// Zero dependencies and framework-free on purpose: it is plain data + rules so
// it can be unit-tested without sockets, embedded in server.mjs, and swapped
// for a real database later (every method is async-friendly).
//
// It owns three things:
//   * time-trial leaderboards per track (top 25, with an optional ghost)
//   * a ranked ladder per season (monthly, Elo-style deltas)
//   * validation + sanitisation of everything a client sends
//
// All ranking MATH lives here, never on the client: a client can only report
// "I raced and finished 1st of 8", the store decides what that is worth.
// ============================================================================

export const LEADERBOARD_SIZE = 25;
export const LADDER_SIZE = 100;
export const MAX_GHOST_FRAMES = 3600;      // ~60 s at 60 Hz
export const NAME_MAX = 16;
export const STARTING_POINTS = 1000;
export const K_FACTOR = 32;
export const MIN_DELTA = 5;

export function seasonId(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Client-supplied names are untrusted: strip control characters, collapse
// whitespace, cap the length, and never allow an empty name.
export function sanitizeName(raw) {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return s || 'Racer';
}

export function sanitizeTime(raw) {
  const t = Number(raw);
  if (!Number.isFinite(t) || t <= 0 || t > 60 * 60 * 1000) return null;
  return Math.round(t * 1000) / 1000;      // ms precision
}

// Ghosts are plain arrays of [dx, dz, yaw, speed] samples. Clamp the count and
// each value so one client cannot blow up the process memory.
export function sanitizeGhost(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const frame of raw.slice(0, MAX_GHOST_FRAMES)) {
    if (!Array.isArray(frame) || frame.length < 2) continue;
    const row = frame.slice(0, 4).map((v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 1000) / 1000 : 0));
    out.push(row);
  }
  return out.length >= 2 ? out : null;
}

// Elo-style expectation: 0..1 chance that `me` beats `them`.
export function winExpectation(me, them) {
  return 1 / (1 + Math.pow(10, (them - me) / 400));
}

// Ranked delta for a match. Beating a stronger opponent pays more than beating
// a weaker one, and losing to a much weaker opponent costs more.
export function matchDelta(mePoints, oppPoints, won) {
  const expected = winExpectation(mePoints, oppPoints);
  const raw = K_FACTOR * ((won ? 1 : 0) - expected);
  const magnitude = Math.max(MIN_DELTA, Math.round(Math.abs(raw)));
  return won ? magnitude : -magnitude;
}

export class OnlineStore {
  // opts.now  - injectable clock (tests)
  // opts.dataFile - optional JSON persistence target
  constructor({ now = () => Date.now(), dataFile = null } = {}) {
    this.now = now;
    this.dataFile = dataFile;
    this.boards = new Map();     // trackId -> [{name, time, date, ghost}]
    this.ranked = new Map();     // season -> { player -> {points, wins, matches, best} }
    this.dirty = false;
    this._saveTimer = null;
  }

  // -------------------------------------------------------------- persistence
  toJSON() {
    return {
      boards: [...this.boards.entries()],
      ranked: [...this.ranked.entries()].map(([season, players]) => [season, [...players.entries()]]),
    };
  }

  static fromJSON(data, opts = {}) {
    const store = new OnlineStore(opts);
    if (!data) return store;
    for (const [trackId, rows] of data.boards || []) store.boards.set(trackId, rows);
    for (const [season, players] of data.ranked || []) store.ranked.set(season, new Map(players));
    return store;
  }

  // ------------------------------------------------------------- leaderboard
  topScores(trackId, limit = 10) {
    const rows = this.boards.get(trackId) || [];
    return rows.slice(0, Math.max(1, Math.min(limit, LEADERBOARD_SIZE)))
      .map(({ name, time, date, characterId }) => ({ name, time, date, characterId }));
  }

  submitScore(trackId, entry = {}) {
    const time = sanitizeTime(entry.time);
    if (time === null) throw Object.assign(new Error('invalid time'), { status: 400 });
    const name = sanitizeName(entry.name);
    const ghost = sanitizeGhost(entry.ghost);
    const row = {
      name, time,
      date: Number.isFinite(entry.date) ? entry.date : this.now(),
      characterId: typeof entry.characterId === 'string' ? entry.characterId.slice(0, 32) : null,
      ghost,
    };
    const rows = this.boards.get(trackId) || [];
    rows.push(row);
    rows.sort((a, b) => a.time - b.time);
    this.boards.set(trackId, rows.slice(0, LEADERBOARD_SIZE));
    this._touch();
    const rank = rows.indexOf(row) + 1;
    return { rank: rank <= LEADERBOARD_SIZE ? rank : null, total: Math.min(rows.length, LEADERBOARD_SIZE) };
  }

  getGhost(trackId, rank = 1) {
    const rows = this.boards.get(trackId) || [];
    const idx = Math.max(1, Math.floor(rank)) - 1;
    if (idx >= rows.length) return null;          // no such rank on this board
    const row = rows[idx];
    if (!row || !row.ghost) return null;
    return { name: row.name, time: row.time, frames: row.ghost };
  }

  // ------------------------------------------------------------------ ranked
  _season(season = seasonId(new Date(this.now()))) {
    if (!this.ranked.has(season)) this.ranked.set(season, new Map());
    return this.ranked.get(season);
  }

  getRanked(player, season) {
    const s = season || seasonId(new Date(this.now()));
    const players = this.ranked.get(s);
    if (!players || !players.has(player)) return null;
    const me = players.get(player);
    return {
      season: s, points: me.points, matches: me.matches, wins: me.wins,
      best: me.best, rank: this._rankOf(player, s),
      players: players.size,
    };
  }

  _rankOf(player, season) {
    const players = this.ranked.get(season);
    if (!players) return null;
    const sorted = [...players.entries()].sort((a, b) => b[1].points - a[1].points);
    const idx = sorted.findIndex(([name]) => name === player);
    return idx === -1 ? null : idx + 1;
  }

  ladder(season, limit = 20) {
    const players = this.ranked.get(season || seasonId(new Date(this.now())));
    if (!players) return [];
    return [...players.entries()]
      .sort((a, b) => b[1].points - a[1].points)
      .slice(0, limit)
      .map(([name, p], i) => ({ rank: i + 1, name, points: p.points, wins: p.wins, matches: p.matches }));
  }

  submitMatch(playerRaw, { trackId = null, won = false, opponent = null, opponentPoints = null } = {}) {
    const player = sanitizeName(playerRaw);
    const season = seasonId(new Date(this.now()));
    const players = this._season(season);
    const me = players.get(player) || { points: STARTING_POINTS, wins: 0, matches: 0, best: STARTING_POINTS };
    // Unknown opponent points (null/undefined) means "the ladder average";
    // Number(null) is 0, so this must be checked before coercion.
    let opp = opponentPoints === null || opponentPoints === undefined ? NaN : Number(opponentPoints);
    if (!Number.isFinite(opp) || opp <= 0) opp = STARTING_POINTS;
    const delta = matchDelta(me.points, opp, !!won);
    me.points = Math.max(0, me.points + delta);
    me.best = Math.max(me.best, me.points);
    me.matches += 1;
    if (won) me.wins += 1;
    players.set(player, me);
    this._touch();
    return {
      season, points: me.points, delta, matches: me.matches, wins: me.wins,
      rank: this._rankOf(player, season), opponent: opponent ? sanitizeName(opponent) : null,
      trackId: typeof trackId === 'string' ? trackId.slice(0, 48) : null,
    };
  }

  // ------------------------------------------------------------------ upkeep
  // Old seasons are kept (hall of fame) but the ladder is pruned to the top N
  // so a long-running server cannot grow without bound.
  prune({ seasons = 12, ladder = LADDER_SIZE } = {}) {
    const ids = [...this.ranked.keys()].sort();
    for (const id of ids.slice(0, Math.max(0, ids.length - seasons))) {
      if (!this.ranked.has(id)) continue;
      this.ranked.delete(id);
    }
    for (const players of this.ranked.values()) {
      if (players.size <= ladder) continue;
      const kept = [...players.entries()].sort((a, b) => b[1].points - a[1].points).slice(0, ladder);
      players.clear();
      for (const [name, p] of kept) players.set(name, p);
    }
    return this;
  }

  stats() {
    let entries = 0;
    let ghosts = 0;
    for (const rows of this.boards.values()) {
      entries += rows.length;
      ghosts += rows.filter((r) => r.ghost).length;
    }
    return {
      tracks: this.boards.size, entries, ghosts,
      seasons: [...this.ranked.keys()].sort(),
      players: [...this.ranked.values()].reduce((a, m) => a + m.size, 0),
    };
  }

  _touch() {
    this.dirty = true;
    if (this.dataFile) this.scheduleSave();
  }

  // Debounced atomic save; injected by server.mjs so the store stays pure.
  setPersister(fn) { this._persist = fn; }
  scheduleSave(delay = 400) {
    if (!this._persist) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.flush(); }, delay);
  }
  flush() {
    if (!this._persist || !this.dirty) return;
    this.dirty = false;
    this._persist(this.toJSON());
  }
}
