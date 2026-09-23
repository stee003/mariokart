// ============================================================================
// LocalLeaderboard - per-track top-N local times.
// Entries: {name, time, date}. Lower time is better. Persisted in save.
// ============================================================================

const KEY = 'leaderboards';
const MAX_ENTRIES = 10;

export class LocalLeaderboard {
  constructor(save) {
    this.save = save;
    this.data = save.get(KEY, {});
  }

  _flush() { this.save.set(KEY, this.data); }

  top(trackId, n = MAX_ENTRIES) {
    return (this.data[trackId] || []).slice(0, n);
  }

  best(trackId) {
    const list = this.data[trackId];
    return list && list.length ? list[0] : null;
  }

  // Returns the rank (1-based) the entry earned, or null if it didn't chart.
  submit(trackId, entry) {
    if (!entry || !Number.isFinite(entry.time)) return null;
    const list = this.data[trackId] || [];
    const stamped = { ...entry, date: entry.date || Date.now() };
    list.push(stamped);
    list.sort((a, b) => a.time - b.time);
    const trimmed = list.slice(0, MAX_ENTRIES);
    this.data[trackId] = trimmed;
    this._flush();
    const idx = trimmed.indexOf(stamped);
    return idx === -1 ? null : idx + 1;
  }

  // Would this time make the board?
  qualifies(trackId, time) {
    const list = this.data[trackId] || [];
    return list.length < MAX_ENTRIES || time < list[list.length - 1].time;
  }
}
