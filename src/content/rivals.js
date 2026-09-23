// ============================================================================
// Rival setups - the kart each pilot brings to the grid.
//
// Every character owns a signature chassis / wheel / cosmetic combination so
// the grid reads as fourteen distinct machines, and so AI karts inherit the
// same stat-driven physics the player gets from the garage (src/roster.js
// feeds buildLoadout -> VehicleController params).
//
// `personality` selects a driving profile from CONFIG.ai.personalities.
// Balance rule (verified in test/garage.test.mjs): every chassis and wheel
// referenced here is a trade-off, so no rival setup is a pure upgrade.
// ============================================================================

export const RIVAL_SETUPS = {
  ember: {
    chassisId: 'dune_blazer', wheelId: 'standard_treads',
    paintId: 'sunset_orange', decalId: 'racing_stripe',
    exhaustId: 'twin_pipes', effectId: 'classic_flame',
    personality: 'balanced',
  },
  cinder: {
    chassisId: 'ironclad_hauler', wheelId: 'iron_drums',
    paintId: 'ember_red', decalId: 'flame_trail',
    exhaustId: 'stack_vents', effectId: 'ember_trail',
    personality: 'aggressive',
  },
  zephyr: {
    chassisId: 'featherwing', wheelId: 'slimline',
    paintId: 'dune_teal', decalId: 'wave_crest',
    exhaustId: 'quad_burst', effectId: 'frost_wake',
    personality: 'speedster',
  },
  bastion: {
    chassisId: 'ironclad_hauler', wheelId: 'chrome_halos',
    paintId: 'bronze_gear', decalId: 'gear_stamp',
    exhaustId: 'stack_vents', effectId: 'classic_flame',
    personality: 'defensive',
  },
  nova: {
    chassisId: 'tempest_bolt', wheelId: 'slimline',
    paintId: 'glacier_blue', decalId: 'star_field',
    exhaustId: 'turbine_ring', effectId: 'void_shimmer',
    personality: 'speedster',
  },
  thistle: {
    chassisId: 'bumblewisp', wheelId: 'moss_grippers',
    paintId: 'forest_moss', decalId: 'racing_stripe',
    exhaustId: 'twin_pipes', effectId: 'venom_spark',
    personality: 'technical',
  },
  coral: {
    chassisId: 'rockjaw', wheelId: 'balloon_floaters',
    paintId: 'coral_pink', decalId: 'wave_crest',
    exhaustId: 'quad_burst', effectId: 'frost_wake',
    personality: 'balanced',
  },
  volt: {
    chassisId: 'comet_courier', wheelId: 'turbo_sprockets',
    paintId: 'storm_yellow', decalId: 'storm_bolt',
    exhaustId: 'turbine_ring', effectId: 'classic_flame',
    personality: 'wildcard',
  },
  obsidian: {
    chassisId: 'gearwork_royale', wheelId: 'rally_hex',
    paintId: 'royal_violet', decalId: 'star_field',
    exhaustId: 'turbine_ring', effectId: 'void_shimmer',
    personality: 'technical',
  },
  juniper: {
    chassisId: 'rockjaw', wheelId: 'moss_grippers',
    paintId: 'forest_moss', decalId: 'flame_trail',
    exhaustId: 'twin_pipes', effectId: 'venom_spark',
    personality: 'balanced',
  },
  ratchet: {
    chassisId: 'dune_blazer', wheelId: 'turbo_sprockets',
    paintId: 'bronze_gear', decalId: 'gear_stamp',
    exhaustId: 'stack_vents', effectId: 'ember_trail',
    personality: 'guardian',
  },
  lumi: {
    chassisId: 'bumblewisp', wheelId: 'gyro_rings',
    paintId: 'silver_mist', decalId: 'wave_crest',
    exhaustId: 'quad_burst', effectId: 'frost_wake',
    personality: 'technical',
  },
  aurelia: {
    chassisId: 'tempest_bolt', wheelId: 'chrome_halos',
    paintId: 'gold_forge', decalId: 'sun_emblem',
    exhaustId: 'turbine_ring', effectId: 'ember_trail',
    personality: 'aggressive',
  },
  umbra: {
    chassisId: 'gearwork_royale', wheelId: 'storm_spikes',
    paintId: 'magma_black', decalId: 'star_field',
    exhaustId: 'turbine_ring', effectId: 'void_shimmer',
    personality: 'wildcard',
  },
};

// Fallback used if a character ever ships without a hand-tuned setup.
export const DEFAULT_RIVAL_SETUP = {
  chassisId: 'dune_blazer', wheelId: 'standard_treads',
  paintId: 'sunset_orange', decalId: 'none',
  exhaustId: 'twin_pipes', effectId: 'classic_flame',
  personality: 'balanced',
};

export function getRivalSetup(characterId) {
  return RIVAL_SETUPS[characterId] || DEFAULT_RIVAL_SETUP;
}

// A rival's full loadout spec for buildLoadout().
export function rivalSpec(characterId) {
  const s = getRivalSetup(characterId);
  return {
    characterId,
    chassisId: s.chassisId,
    wheelId: s.wheelId,
    paintId: s.paintId,
    decalId: s.decalId,
    exhaustId: s.exhaustId,
    effectId: s.effectId,
  };
}
