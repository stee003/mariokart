// ============================================================================
// Purely cosmetic customization: paints, decals, exhaust styles, boost
// effects. Zero gameplay effect by design (progression is never pay-to-win).
// ============================================================================

export const PAINTS = [
  { id: 'sunset_orange', nameKey: 'paint.sunsetOrange', color: 0xff8a2a, finish: 'gloss', unlock: { type: 'default' } },
  { id: 'dune_teal', nameKey: 'paint.duneTeal', color: 0x2fd8c8, finish: 'gloss', unlock: { type: 'default' } },
  { id: 'ember_red', nameKey: 'paint.emberRed', color: 0xd9452f, finish: 'gloss', unlock: { type: 'default' } },
  { id: 'canyon_cream', nameKey: 'paint.canyonCream', color: 0xf0dcb8, finish: 'matte', unlock: { type: 'default' } },
  { id: 'night_ink', nameKey: 'paint.nightInk', color: 0x2a2734, finish: 'gloss', unlock: { type: 'default' } },
  { id: 'forest_moss', nameKey: 'paint.forestMoss', color: 0x5a9e4f, finish: 'matte', unlock: { type: 'default' } },
  { id: 'royal_violet', nameKey: 'paint.royalViolet', color: 0x8a5fe0, finish: 'gloss', unlock: { type: 'level', level: 2 } },
  { id: 'storm_yellow', nameKey: 'paint.stormYellow', color: 0xf0c820, finish: 'gloss', unlock: { type: 'level', level: 3 } },
  { id: 'glacier_blue', nameKey: 'paint.glacierBlue', color: 0x8ab8e8, finish: 'pearl', unlock: { type: 'level', level: 4 } },
  { id: 'magma_black', nameKey: 'paint.magmaBlack', color: 0x1e1a1c, finish: 'matte', unlock: { type: 'level', level: 5 } },
  { id: 'coral_pink', nameKey: 'paint.coralPink', color: 0xff8aa0, finish: 'gloss', unlock: { type: 'level', level: 5 } },
  { id: 'bronze_gear', nameKey: 'paint.bronzeGear', color: 0xb08a4a, finish: 'metal', unlock: { type: 'level', level: 6 } },
  { id: 'silver_mist', nameKey: 'paint.silverMist', color: 0xc8ccd4, finish: 'metal', unlock: { type: 'level', level: 7 } },
  { id: 'gold_forge', nameKey: 'paint.goldForge', color: 0xffd24a, finish: 'metal', unlock: { type: 'level', level: 8 } },
  { id: 'prism_pearl', nameKey: 'paint.prismPearl', color: 0xe8e0f8, finish: 'pearl', unlock: { type: 'level', level: 9 } },
  { id: 'void_chrome', nameKey: 'paint.voidChrome', color: 0x4a4e6a, finish: 'pearl', unlock: { type: 'achievement', achievementId: 'collector' } },
];

export const DECALS = [
  { id: 'none', nameKey: 'decal.none', pattern: 'none', unlock: { type: 'default' } },
  { id: 'racing_stripe', nameKey: 'decal.racingStripe', pattern: 'stripe', unlock: { type: 'default' } },
  { id: 'sun_emblem', nameKey: 'decal.sunEmblem', pattern: 'sun', unlock: { type: 'default' } },
  { id: 'gear_stamp', nameKey: 'decal.gearStamp', pattern: 'gear', unlock: { type: 'level', level: 2 } },
  { id: 'flame_trail', nameKey: 'decal.flameTrail', pattern: 'flames', unlock: { type: 'level', level: 3 } },
  { id: 'storm_bolt', nameKey: 'decal.stormBolt', pattern: 'bolt', unlock: { type: 'level', level: 4 } },
  { id: 'wave_crest', nameKey: 'decal.waveCrest', pattern: 'wave', unlock: { type: 'level', level: 5 } },
  { id: 'star_field', nameKey: 'decal.starField', pattern: 'stars', unlock: { type: 'level', level: 7 } },
];

export const EXHAUSTS = [
  { id: 'twin_pipes', nameKey: 'exhaust.twinPipes', style: 'twin', unlock: { type: 'default' } },
  { id: 'stack_vents', nameKey: 'exhaust.stackVents', style: 'stack', unlock: { type: 'level', level: 3 } },
  { id: 'quad_burst', nameKey: 'exhaust.quadBurst', style: 'quad', unlock: { type: 'level', level: 6 } },
  { id: 'turbine_ring', nameKey: 'exhaust.turbineRing', style: 'turbine', unlock: { type: 'level', level: 9 } },
];

export const EFFECTS = [
  { id: 'classic_flame', nameKey: 'effect.classicFlame', flame: 0x66e8ff, trail: 0xffb830, unlock: { type: 'default' } },
  { id: 'ember_trail', nameKey: 'effect.emberTrail', flame: 0xff9a3c, trail: 0xff5d3c, unlock: { type: 'level', level: 2 } },
  { id: 'frost_wake', nameKey: 'effect.frostWake', flame: 0xbaf0ff, trail: 0x8ab8e8, unlock: { type: 'level', level: 4 } },
  { id: 'venom_spark', nameKey: 'effect.venomSpark', flame: 0x8aff6a, trail: 0x2fd8c8, unlock: { type: 'level', level: 6 } },
  { id: 'void_shimmer', nameKey: 'effect.voidShimmer', flame: 0xc86aff, trail: 0xff5df1, unlock: { type: 'level', level: 8 } },
];

export function getPaint(id) { return PAINTS.find((p) => p.id === id) || PAINTS[0]; }
export function getDecal(id) { return DECALS.find((d) => d.id === id) || DECALS[0]; }
export function getExhaust(id) { return EXHAUSTS.find((e) => e.id === id) || EXHAUSTS[0]; }
export function getEffect(id) { return EFFECTS.find((e) => e.id === id) || EFFECTS[0]; }
