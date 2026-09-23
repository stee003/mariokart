// ============================================================================
// Grand Prix cups. 6 cups x 4 races. The first four cups cover all 16
// tracks once; the last two are escalation cups (longer races / harder AI)
// that remix the toughest circuits - progression gates, not filler.
//
// Scoring (original curve - not a copy of any existing kart game):
//   finish position points: 1st 15 · 2nd 11 · 3rd 8 · 4th 6 · 5th 5 ·
//                           6th 4 · 7th 3 · 8th 2
//   +2 bonus: fastest lap of the race
//   +1 bonus: leading when lap 1 ends
// Trophies by total (max 72 over 4 races):
//   PLATINUM >= 60 · GOLD >= 48 · SILVER >= 36 · BRONZE >= 24
// ============================================================================

export const POSITION_POINTS = [15, 11, 8, 6, 5, 4, 3, 2];
export const FASTEST_LAP_BONUS = 2;
export const LAP1_LEAD_BONUS = 1;

export function pointsForPosition(pos) {
  return POSITION_POINTS[Math.min(pos, POSITION_POINTS.length) - 1] ?? 1;
}

export const TROPHY_THRESHOLDS = [
  { id: 'platinum', min: 60, nameKey: 'trophy.platinum' },
  { id: 'gold', min: 48, nameKey: 'trophy.gold' },
  { id: 'silver', min: 36, nameKey: 'trophy.silver' },
  { id: 'bronze', min: 24, nameKey: 'trophy.bronze' },
];

export function trophyForPoints(points) {
  for (const t of TROPHY_THRESHOLDS) if (points >= t.min) return t.id;
  return null;
}

export const CUPS = [
  {
    id: 'ember', nameKey: 'cup.ember', trophyNameKey: 'cup.ember.trophy',
    descKey: 'cup.ember.desc', difficulty: 1,
    tracks: ['sunforge_circuit', 'verdant_loop', 'ruins_of_vael', 'abyss_dock'],
    unlock: { type: 'default' },
  },
  {
    id: 'gear', nameKey: 'cup.gear', trophyNameKey: 'cup.gear.trophy',
    descKey: 'cup.gear.desc', difficulty: 2,
    tracks: ['ashfall_run', 'glimmer_deep', 'skyreach', 'forge_line'],
    unlock: { type: 'cup', cupId: 'ember', minTrophy: 'bronze' },
  },
  {
    id: 'neon', nameKey: 'cup.neon', trophyNameKey: 'cup.neon.trophy',
    descKey: 'cup.neon.desc', difficulty: 3,
    tracks: ['neon_cascade', 'orbital_ring', 'granite_pass', 'sandstone_crown'],
    unlock: { type: 'cup', cupId: 'gear', minTrophy: 'bronze' },
  },
  {
    id: 'storm', nameKey: 'cup.storm', trophyNameKey: 'cup.storm.trophy',
    descKey: 'cup.storm.desc', difficulty: 4,
    tracks: ['tempest_ridge', 'magma_coil', 'skyline_helix', 'void_terminal'],
    unlock: { type: 'cup', cupId: 'neon', minTrophy: 'silver' },
  },
  {
    id: 'crown', nameKey: 'cup.crown', trophyNameKey: 'cup.crown.trophy',
    descKey: 'cup.crown.desc', difficulty: 5, laps: 4,
    tracks: ['sandstone_crown', 'granite_pass', 'magma_coil', 'sunforge_circuit'],
    unlock: { type: 'cup', cupId: 'storm', minTrophy: 'silver' },
  },
  {
    id: 'sunforge', nameKey: 'cup.sunforge', trophyNameKey: 'cup.sunforge.trophy',
    descKey: 'cup.sunforge.desc', difficulty: 6, laps: 4,
    tracks: ['void_terminal', 'skyline_helix', 'tempest_ridge', 'neon_cascade'],
    unlock: { type: 'cup', cupId: 'crown', minTrophy: 'gold' },
  },
];

export function getCup(id) {
  return CUPS.find((c) => c.id === id) || CUPS[0];
}

const TROPHY_ORDER = ['bronze', 'silver', 'gold', 'platinum'];
export function trophyAtLeast(have, min) {
  if (!have) return false;
  return TROPHY_ORDER.indexOf(have) >= TROPHY_ORDER.indexOf(min);
}
