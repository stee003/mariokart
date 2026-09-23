// ============================================================================
// AI difficulty tiers.
//
// Design rule: difficulty NEVER grants the AI extra speed. Every tier uses
// exactly the same kart physics and the same speed caps as the player.
// Tiers only scale DECISION QUALITY:
//   - mistakeMult     how often the driver lapses (lifts / wobbles)
//   - lookaheadMult   how far ahead the driver plans braking & lines
//   - cornerDecision  corner-entry speed judgement (<= 1: only ever brakes
//                     EARLIER than the personality baseline, never faster)
//   - driftMult       willingness/skill to charge drift boosts
//   - boostMult       eagerness & timing of boost usage (also item eagerness)
//   - itemSkill       multiplies the success roll of the item-usage heuristic
//   - startBoostMult  chance of nailing the rocket-start window
// ============================================================================

export const DIFFICULTY_TIERS = [
  {
    tier: 'beginner', nameKey: 'difficulty.beginner',
    mistakeMult: 3.2, lookaheadMult: 0.55, cornerDecision: 0.86,
    driftMult: 0.35, boostMult: 0.45, itemSkill: 0.4, startBoostMult: 0.25,
  },
  {
    tier: 'easy', nameKey: 'difficulty.easy',
    mistakeMult: 2.2, lookaheadMult: 0.72, cornerDecision: 0.92,
    driftMult: 0.55, boostMult: 0.6, itemSkill: 0.6, startBoostMult: 0.5,
  },
  {
    tier: 'normal', nameKey: 'difficulty.normal',
    mistakeMult: 1.0, lookaheadMult: 1.0, cornerDecision: 1.0,
    driftMult: 1.0, boostMult: 1.0, itemSkill: 1.0, startBoostMult: 1.0,
  },
  {
    tier: 'hard', nameKey: 'difficulty.hard',
    mistakeMult: 0.55, lookaheadMult: 1.18, cornerDecision: 1.0,
    driftMult: 1.15, boostMult: 1.12, itemSkill: 1.3, startBoostMult: 1.2,
  },
  {
    tier: 'expert', nameKey: 'difficulty.expert',
    mistakeMult: 0.25, lookaheadMult: 1.32, cornerDecision: 1.0,
    driftMult: 1.3, boostMult: 1.22, itemSkill: 1.6, startBoostMult: 1.35,
  },
  {
    tier: 'master', nameKey: 'difficulty.master',
    mistakeMult: 0.08, lookaheadMult: 1.45, cornerDecision: 1.0,
    driftMult: 1.45, boostMult: 1.3, itemSkill: 2.0, startBoostMult: 1.5,
  },
];

const BY_TIER = new Map(DIFFICULTY_TIERS.map((d) => [d.tier, d]));

export function getDifficulty(tier) {
  return BY_TIER.get(tier) || BY_TIER.get('normal');
}

export const DEFAULT_DIFFICULTY = 'normal';

// Effective per-AI parameters: personality folded with difficulty.
// Corner judgement can only get WORSE than the personality baseline
// (multiplier <= 1), and nothing here ever increases the kart's maxSpeed.
export function effectiveParams(personality, tier) {
  const d = getDifficulty(tier);
  return {
    mistakeRate: personality.mistakeRate * d.mistakeMult,
    lookaheadMult: d.lookaheadMult,
    cornerSpeed: Math.min(personality.cornerSpeed, personality.cornerSpeed * d.cornerDecision),
    driftEagerness: Math.min(1, personality.driftEagerness * d.driftMult),
    boostUse: Math.min(1.3, personality.boostUse * d.boostMult),
    itemSkill: d.itemSkill,
    startBoostChance: Math.min(0.98, personality.startBoostChance * d.startBoostMult),
    targetSpeed: personality.targetSpeed,     // never scaled by difficulty
    aggression: personality.aggression,
    blockiness: personality.blockiness,
  };
}
