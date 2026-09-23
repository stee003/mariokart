// ============================================================================
// Progression - XP, levels and level-based unlocks.
//
// No pay-to-win: every unlock is earned by playing. Content declares its own
// unlock rule ({type:'default'} or {type:'level', level}); this module is the
// single authority that reads those declarations and awards them.
// ============================================================================

import { CHARACTERS } from './content/characters.js';
import { CHASSIS } from './content/chassis.js';
import { WHEELS } from './content/wheels.js';
import { PAINTS, DECALS, EXHAUSTS, EFFECTS } from './content/cosmetics.js';

// ------------------------------------------------------------------- levels
// Cumulative XP needed to REACH a level (level 1 is free).
// L: 2=150, 3=360, 4=630, 5=960, 6=1350, 7=1800, 8=2310, 9=2880, 10=3510 ...
export function xpForLevel(level) {
  if (level <= 1) return 0;
  const n = level - 1;
  return 120 * n + 30 * n * n;
}

export function levelFromXp(xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}

export function getProgress(save) {
  const xp = save.get('xp', 0);
  const level = levelFromXp(xp);
  return {
    xp, level,
    prevThreshold: xpForLevel(level),
    nextThreshold: xpForLevel(level + 1),
  };
}

// ----------------------------------------------------------------- XP awards
export const XP = {
  raceBase: 30,             // just finishing
  perPlaceAhead: 6,         // +6 per rival you beat
  fastestLap: 12,
  ttTotalRecord: 35,
  ttLapRecord: 15,
  trophy: { bronze: 50, silver: 80, gold: 120, platinum: 170 },
};

// event kinds:
//   {kind:'race', pos, rivals}                      quick race finished
//   {kind:'gpRace', pos, rivals}                    grand prix race finished
//   {kind:'trophy', trophy}                         cup finished, trophy won
//   {kind:'tt', totalRecord, lapRecord}             time trial submitted
export function xpForEvent(event) {
  switch (event.kind) {
    case 'race':
    case 'gpRace': {
      const ahead = Math.max(0, event.rivals + 1 - event.pos);
      return XP.raceBase + ahead * XP.perPlaceAhead;
    }
    case 'trophy':
      return XP.trophy[event.trophy] ?? 0;
    case 'tt':
      return (event.totalRecord ? XP.ttTotalRecord : 0)
        + (event.lapRecord ? XP.ttLapRecord : 0);
    default:
      return 0;
  }
}

// ------------------------------------------------------- unlock derivation
function collect(kind, list) {
  return list
    .filter((c) => c.unlock && c.unlock.type === 'level')
    .map((c) => ({ kind, id: c.id, nameKey: c.nameKey, level: c.unlock.level }));
}

export const UNLOCKABLES = [
  ...collect('character', CHARACTERS),
  ...collect('chassis', CHASSIS),
  ...collect('wheels', WHEELS),
  ...collect('paint', PAINTS),
  ...collect('decal', DECALS),
  ...collect('exhaust', EXHAUSTS),
  ...collect('effect', EFFECTS),
].sort((a, b) => a.level - b.level || a.kind.localeCompare(b.kind));

export function unlocksAtLevel(level) {
  return UNLOCKABLES.filter((u) => u.level === level);
}

// Is an unlock entry available at the given level?
export function isUnlocked(entry, level) {
  if (!entry.unlock || entry.unlock.type === 'default') return true;
  if (entry.unlock.type === 'level') return level >= entry.unlock.level;
  return false;
}

// ---------------------------------------------------------------- apply XP
// Returns {xp, levelBefore, levelAfter, gained, newUnlocks}.
export function applyEvent(save, event) {
  const gained = xpForEvent(event) + (event.bonusXp || 0);
  const before = getProgress(save);
  const xp = before.xp + gained;
  save.set('xp', xp);
  const after = getProgress(save);
  const newUnlocks = [];
  for (let lvl = before.level + 1; lvl <= after.level; lvl++) {
    newUnlocks.push(...unlocksAtLevel(lvl));
  }
  return {
    xp, gained,
    levelBefore: before.level,
    levelAfter: after.level,
    newUnlocks,
  };
}
