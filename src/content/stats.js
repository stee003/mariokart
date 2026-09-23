// ============================================================================
// Stat model - the single source of truth for character/kart balance.
//
// Every pilot, chassis and wheel expresses itself through the same six
// attributes (0..10 scale). Effective stats are combined with soft-capping
// so that stacking +stat parts yields diminishing returns and NO loadout
// can dominate every other loadout.
//
//   acceleration  -> engine force
//   topSpeed      -> max speed
//   handling      -> steer rate + lateral grip
//   weight        -> collision mass (push / resistance), never a free win
//   driftControl  -> drift grip + charge rate
//   offRoad       -> off-track speed cap + drag
// ============================================================================

import { CONFIG } from '../config.js';

export const STAT_KEYS = ['acceleration', 'topSpeed', 'handling', 'weight', 'driftControl', 'offRoad'];

// Point budget every character distributes across the six stats.
export const CHARACTER_STAT_BUDGET = 34;
export const STAT_MIN = 2;
export const STAT_MAX = 9;

const lerp = (a, b, t) => a + (b - a) * t;

// Soft cap: above 8 points each extra point counts only half. Keeps
// stacked builds from running away while still rewarding them a little.
export function compress(raw) {
  if (raw <= 8) return raw;
  return 8 + (raw - 8) * 0.5;
}

export function clampStat(v) {
  return Math.max(1, Math.min(10, v));
}

// Combine character + chassis + wheels into effective stats.
// parts: array of stat-delta objects, e.g. [{acceleration:+1, topSpeed:-2}, ...]
export function combineStats(characterStats, ...deltas) {
  const raw = { ...characterStats };
  for (const d of deltas) {
    for (const k of STAT_KEYS) {
      if (typeof d[k] === 'number') raw[k] += d[k];
    }
  }
  const eff = {};
  for (const k of STAT_KEYS) eff[k] = clampStat(compress(raw[k]));
  return eff;
}

// ---------------------------------------------------------------------------
// Map effective stats onto vehicle physics parameters. The baseline (all
// stats = 5.66, i.e. the even split of the 34 budget) reproduces the
// stock CONFIG values closely; variations are deliberately gentle so the
// core driving feel is preserved.
// ---------------------------------------------------------------------------
export function vehicleParamsFromStats(stats) {
  const V = CONFIG.vehicle;
  const n = (k) => stats[k] / 10; // 0..1
  return {
    ...V,
    maxSpeed: V.maxSpeed * lerp(0.93, 1.085, n('topSpeed')),
    accel: V.accel * lerp(0.86, 1.17, n('acceleration')),
    steerRate: V.steerRate * lerp(0.9, 1.11, n('handling')),
    traction: V.traction * lerp(0.9, 1.13, n('handling')),
    offTrackMaxSpeed: V.offTrackMaxSpeed * lerp(0.78, 1.32, n('offRoad')),
    offTrackDrag: V.offTrackDrag * lerp(1.25, 0.68, n('offRoad')),
    massFactor: lerp(0.78, 1.32, n('weight')),
  };
}

// Drift behaviour modifiers derived from driftControl.
export function driftModsFromStats(stats) {
  const n = stats.driftControl / 10;
  return {
    gripMult: lerp(0.21, 0.33, n),        // more control = more slide grip
    chargeRate: lerp(0.88, 1.12, n),      // charges slightly faster
    steerMult: lerp(0.57, 0.68, n),       // steering authority mid-drift
  };
}

// ---------------------------------------------------------------------------
// Validation used by tests and the content registry.
// ---------------------------------------------------------------------------

// True if `a` is strictly better than or equal to `b` in every stat and
// strictly better in at least one -> `b` would be objectively worse.
export function dominates(a, b) {
  let strictlyBetter = false;
  for (const k of STAT_KEYS) {
    if (a[k] < b[k]) return false;
    if (a[k] > b[k]) strictlyBetter = true;
  }
  return strictlyBetter;
}

export function findDominationPairs(entries, statsOf) {
  const bad = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = 0; j < entries.length; j++) {
      if (i === j) continue;
      if (dominates(statsOf(entries[i]), statsOf(entries[j]))) {
        bad.push([entries[i].id, entries[j].id]);
      }
    }
  }
  return bad;
}

export function validateCharacterStats(c) {
  const errs = [];
  const total = STAT_KEYS.reduce((s, k) => s + (c.stats[k] || 0), 0);
  if (total !== CHARACTER_STAT_BUDGET) {
    errs.push(`${c.id}: stat total ${total} != budget ${CHARACTER_STAT_BUDGET}`);
  }
  for (const k of STAT_KEYS) {
    const v = c.stats[k];
    if (typeof v !== 'number' || v < STAT_MIN || v > STAT_MAX) {
      errs.push(`${c.id}: stat ${k}=${v} outside ${STAT_MIN}..${STAT_MAX}`);
    }
  }
  return errs;
}

// Deltas (chassis/wheels) must be trade-offs: they may not be pure buffs.
export function validateDeltas(part) {
  const errs = [];
  let positives = 0, negatives = 0, sumPos = 0, sumNeg = 0;
  for (const k of STAT_KEYS) {
    const v = part.stats[k] || 0;
    if (v > 0) { positives++; sumPos += v; }
    if (v < 0) { negatives++; sumNeg += -v; }
  }
  if (positives > 0 && negatives === 0) {
    errs.push(`${part.id}: pure buff (no trade-off)`);
  }
  if (sumPos > sumNeg + 1) {
    errs.push(`${part.id}: gains (+${sumPos}) outweigh losses (-${sumNeg}) too much`);
  }
  return errs;
}
