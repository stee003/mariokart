// ============================================================================
// Achievements - persistent stat counters + declarative achievement list.
// Pure logic over SaveManager; no DOM, no audio.
// ============================================================================

import { levelFromXp } from './progression.js';

// Counters live in save key 'stats'. Use recordStats() to increment.
const STAT_DEFAULTS = {
  races: 0, wins: 0, podiums: 0, laps: 0,
  fastestLaps: 0, records: 0,
  cups: 0, cupsGold: 0, cupsPlatinum: 0,
  itemsTaken: 0, itemsUsed: 0,
  ghostsRaced: 0, tracksPlayed: 0,
  battles: 0, battleWins: 0,
};

export function getStats(save) {
  return { ...STAT_DEFAULTS, ...save.get('stats', {}) };
}

// patch: {key: amount} - additive increments.
export function recordStats(save, patch) {
  const stats = getStats(save);
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v !== 'number') continue;
    stats[k] = (stats[k] || 0) + v;
  }
  save.set('stats', stats);
  return stats;
}

export function trackPlayed(save, trackId) {
  const played = new Set(save.get('tracksPlayed', []));
  if (!played.has(trackId)) {
    played.add(trackId);
    save.set('tracksPlayed', [...played]);
    recordStats(save, { tracksPlayed: 1 });
    return true;
  }
  return false;
}

// cond receives (stats, progress) -> bool
export const ACHIEVEMENTS = [
  { id: 'first_race',   nameKey: 'ach.firstRace',   descKey: 'ach.firstRace.d',   cond: (s) => s.races >= 1 },
  { id: 'first_win',    nameKey: 'ach.firstWin',    descKey: 'ach.firstWin.d',    cond: (s) => s.wins >= 1 },
  { id: 'podium_10',    nameKey: 'ach.podium10',    descKey: 'ach.podium10.d',    cond: (s) => s.podiums >= 10 },
  { id: 'lap_50',       nameKey: 'ach.lap50',       descKey: 'ach.lap50.d',       cond: (s) => s.laps >= 50 },
  { id: 'fastest_5',    nameKey: 'ach.fastest5',    descKey: 'ach.fastest5.d',    cond: (s) => s.fastestLaps >= 5 },
  { id: 'record_1',     nameKey: 'ach.record1',     descKey: 'ach.record1.d',     cond: (s) => s.records >= 1 },
  { id: 'record_8',     nameKey: 'ach.record8',     descKey: 'ach.record8.d',     cond: (s) => s.records >= 8 },
  { id: 'cup_1',        nameKey: 'ach.cup1',        descKey: 'ach.cup1.d',        cond: (s) => s.cups >= 1 },
  { id: 'cup_gold',     nameKey: 'ach.cupGold',     descKey: 'ach.cupGold.d',     cond: (s) => s.cupsGold >= 1 },
  { id: 'cup_platinum', nameKey: 'ach.cupPlatinum', descKey: 'ach.cupPlatinum.d', cond: (s) => s.cupsPlatinum >= 1 },
  { id: 'items_20',     nameKey: 'ach.items20',     descKey: 'ach.items20.d',     cond: (s) => s.itemsUsed >= 20 },
  { id: 'items_30',     nameKey: 'ach.items30',     descKey: 'ach.items30.d',     cond: (s) => s.itemsTaken >= 30 },
  { id: 'ghost_1',      nameKey: 'ach.ghost1',      descKey: 'ach.ghost1.d',      cond: (s) => s.ghostsRaced >= 1 },
  { id: 'explorer',     nameKey: 'ach.explorer',    descKey: 'ach.explorer.d',    cond: (s) => s.tracksPlayed >= 16 },
  { id: 'level_5',      nameKey: 'ach.level5',      descKey: 'ach.level5.d',      cond: (s, p) => p.level >= 5 },
  { id: 'level_10',     nameKey: 'ach.level10',     descKey: 'ach.level10.d',     cond: (s, p) => p.level >= 10 },
];

export function earnedAchievements(save) {
  return save.get('achievements', []);
}

// Returns newly earned achievement defs (and persists them).
export function checkAchievements(save, progress) {
  const stats = getStats(save);
  const prog = progress || { level: levelFromXp(save.get('xp', 0)) };
  const earned = new Set(earnedAchievements(save));
  const fresh = [];
  for (const ach of ACHIEVEMENTS) {
    if (!earned.has(ach.id) && ach.cond(stats, prog)) {
      earned.add(ach.id);
      fresh.push(ach);
    }
  }
  if (fresh.length) save.set('achievements', [...earned]);
  return fresh;
}
