// ============================================================================
// Loadout - assembles a full kart configuration from
// (character, chassis, wheels, paint, decal, exhaust, effect) and derives:
//   - effective stats (soft-capped combination)
//   - vehicle physics parameters (per-kart, via vehicleParamsFromStats)
//   - drift modifiers
//   - a visual spec consumed by kartMesh.js / characterMesh.js
// Pure data in / pure data out: fully unit-testable without Three.js.
// ============================================================================

import { getCharacter } from './characters.js';
import { getChassis } from './chassis.js';
import { getWheels } from './wheels.js';
import { getPaint, getDecal, getExhaust, getEffect } from './cosmetics.js';
import { combineStats, vehicleParamsFromStats, driftModsFromStats, STAT_KEYS } from './stats.js';

export const DEFAULT_LOADOUT = {
  characterId: 'ember',
  chassisId: 'dune_blazer',
  wheelId: 'standard_treads',
  paintId: 'sunset_orange',
  decalId: 'none',
  exhaustId: 'twin_pipes',
  effectId: 'classic_flame',
};

export function buildLoadout(spec = {}) {
  const s = { ...DEFAULT_LOADOUT, ...spec };
  const character = getCharacter(s.characterId);
  const chassis = getChassis(s.chassisId);
  const wheels = getWheels(s.wheelId);
  const paint = getPaint(s.paintId);
  const decal = getDecal(s.decalId);
  const exhaust = getExhaust(s.exhaustId);
  const effect = getEffect(s.effectId);

  const stats = combineStats(character.stats, chassis.stats, wheels.stats);

  return {
    spec: s,
    character, chassis, wheels, paint, decal, exhaust, effect,
    stats,
    params: vehicleParamsFromStats(stats),
    driftMods: driftModsFromStats(stats),
    visual: {
      bodyColor: paint.color,
      accentColor: character.colors.accent,
      pilotColor: character.colors.fur,
      suitColor: character.colors.suit,
      finish: paint.finish,
      decalPattern: decal.pattern,
      exhaustStyle: exhaust.style,
      effectFlame: effect.flame,
      effectTrail: effect.trail,
      wheel: wheels.geo,
      chassisBody: chassis.body,
      silhouette: character.silhouette,
    },
  };
}

// Summary of the effective build for UI display (0..10 values).
export function loadoutStatSummary(loadout) {
  const out = {};
  for (const k of STAT_KEYS) out[k] = Math.round(loadout.stats[k] * 10) / 10;
  return out;
}
