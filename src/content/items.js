// ============================================================================
// Original power-up catalog (22 items). None are copies of existing kart
// games - each defines a NEW mechanic with: purpose, counterplay, visual
// identity (color + icon shape), sound id, and runtime parameters consumed
// by ItemSystem (src/items.js).
//
// category: projectile | hazard | buff | debuff | zone | utility
// ============================================================================

export const ITEMS = {
  flux_bolt: {
    id: 'flux_bolt', nameKey: 'item.fluxBolt', descKey: 'item.fluxBolt.desc',
    counterKey: 'item.fluxBolt.counter',
    category: 'projectile', targeting: 'forward', weight: 10,
    color: 0x66e8ff, icon: 'bolt', sound: 'flux',
    params: { speed: 46, homing: 0.62, lockBreakDrift: true, life: 3.2 },
  },
  gravity_anchor: {
    id: 'gravity_anchor', nameKey: 'item.gravityAnchor', descKey: 'item.gravityAnchor.desc',
    counterKey: 'item.gravityAnchor.counter',
    category: 'debuff', targeting: 'leaderAhead', weight: 7,
    color: 0x8a9ab5, icon: 'anchor', sound: 'anchor',
    params: { duration: 3.5, speedMult: 0.8, noDrift: true },
  },
  mirage_clone: {
    id: 'mirage_clone', nameKey: 'item.mirageClone', descKey: 'item.mirageClone.desc',
    counterKey: 'item.mirageClone.counter',
    category: 'utility', targeting: 'self', weight: 8,
    color: 0xbaf0ff, icon: 'ghost', sound: 'mirage',
    params: { duration: 9, flashRadius: 6, absorbHits: 1 },
  },
  pulse_ring: {
    id: 'pulse_ring', nameKey: 'item.pulseRing', descKey: 'item.pulseRing.desc',
    counterKey: 'item.pulseRing.counter',
    category: 'utility', targeting: 'self', weight: 8,
    color: 0x2fd8c8, icon: 'ring', sound: 'pulse',
    params: { radius: 13, cleanse: true, boostPerHazard: 0.35 },
  },
  overdrive_core: {
    id: 'overdrive_core', nameKey: 'item.overdriveCore', descKey: 'item.overdriveCore.desc',
    counterKey: 'item.overdriveCore.counter',
    category: 'buff', targeting: 'self', weight: 9,
    color: 0xffb830, icon: 'core', sound: 'overdrive',
    params: { duration: 2.8, speedMult: 1.3, accelMult: 2.2, steerPenalty: 0.94, noDrift: true },
  },
  vortex_mine: {
    id: 'vortex_mine', nameKey: 'item.vortexMine', descKey: 'item.vortexMine.desc',
    counterKey: 'item.vortexMine.counter',
    category: 'hazard', targeting: 'drop', weight: 9,
    color: 0xff5df1, icon: 'spiral', sound: 'vortex',
    params: { radius: 4.6, pull: 9, armTime: 0.9, life: 22, launch: 7.5 },
  },
  phase_shield: {
    id: 'phase_shield', nameKey: 'item.phaseShield', descKey: 'item.phaseShield.desc',
    counterKey: 'item.phaseShield.counter',
    category: 'buff', targeting: 'self', weight: 7,
    color: 0x9a8aff, icon: 'shield', sound: 'phase',
    params: { duration: 4.0, intangible: true, noItems: true },
  },
  time_ripple: {
    id: 'time_ripple', nameKey: 'item.timeRipple', descKey: 'item.timeRipple.desc',
    counterKey: 'item.timeRipple.counter',
    category: 'zone', targeting: 'self', weight: 6,
    color: 0x8ad0ff, icon: 'hourglass', sound: 'ripple',
    params: { radius: 15, duration: 2.0, slowMult: 0.6, windup: 0.5 },
  },
  magnet_surge: {
    id: 'magnet_surge', nameKey: 'item.magnetSurge', descKey: 'item.magnetSurge.desc',
    counterKey: 'item.magnetSurge.counter',
    category: 'buff', targeting: 'self', weight: 7,
    color: 0xff8a2a, icon: 'magnet', sound: 'magnet',
    params: { duration: 4.5, pullRadius: 26, pullForce: 34 },
  },
  repair_drone: {
    id: 'repair_drone', nameKey: 'item.repairDrone', descKey: 'item.repairDrone.desc',
    counterKey: 'item.repairDrone.counter',
    category: 'utility', targeting: 'self', weight: 7,
    color: 0x8aff6a, icon: 'drone', sound: 'repair',
    params: { cleanse: true, shieldCharge: 1, boostDuration: 1.4 },
  },
  echo_snare: {
    id: 'echo_snare', nameKey: 'item.echoSnare', descKey: 'item.echoSnare.desc',
    counterKey: 'item.echoSnare.counter',
    category: 'projectile', targeting: 'forward', weight: 8,
    color: 0xd8f4a0, icon: 'snare', sound: 'snare',
    params: { speed: 40, homing: 0.35, life: 2.6, reverseSteerDur: 1.15, driftCancel: true },
  },
  prism_wall: {
    id: 'prism_wall', nameKey: 'item.prismWall', descKey: 'item.prismWall.desc',
    counterKey: 'item.prismWall.counter',
    category: 'hazard', targeting: 'drop', weight: 7,
    color: 0xf0d0ff, icon: 'wall', sound: 'prism',
    params: { width: 9, life: 9, slowMult: 0.55, refract: true },
  },
  slipstream_harpoon: {
    id: 'slipstream_harpoon', nameKey: 'item.slipstreamHarpoon', descKey: 'item.slipstreamHarpoon.desc',
    counterKey: 'item.slipstreamHarpoon.counter',
    category: 'projectile', targeting: 'forward', weight: 6,
    color: 0x40f0e0, icon: 'harpoon', sound: 'harpoon',
    params: { speed: 52, homing: 0.5, life: 2.2, pullForce: 26, pullDuration: 1.8, breakOnTargetBoost: true },
  },
  static_bloom: {
    id: 'static_bloom', nameKey: 'item.staticBloom', descKey: 'item.staticBloom.desc',
    counterKey: 'item.staticBloom.counter',
    category: 'hazard', targeting: 'throwForward', weight: 8,
    color: 0xf0e04a, icon: 'bloom', sound: 'bloom',
    params: { throwDist: 18, radius: 4.2, life: 7, noDrift: true, jitter: 0.5 },
  },
  chrono_shard: {
    id: 'chrono_shard', nameKey: 'item.chronoShard', descKey: 'item.chronoShard.desc',
    counterKey: 'item.chronoShard.counter',
    category: 'utility', targeting: 'self', weight: 6,
    color: 0xc8b0ff, icon: 'shard', sound: 'chrono',
    params: { snapshotOnUse: true, boostDuration: 0.9, speedMult: 1.15 },
  },
  ion_lash: {
    id: 'ion_lash', nameKey: 'item.ionLash', descKey: 'item.ionLash.desc',
    counterKey: 'item.ionLash.counter',
    category: 'utility', targeting: 'self', weight: 7,
    color: 0x66ffb8, icon: 'lash', sound: 'lash',
    params: { arcRadius: 6.5, arcHalfAngle: 1.0, knockback: 9, stealBoost: 0.5 },
  },
  decoy_beacon: {
    id: 'decoy_beacon', nameKey: 'item.decoyBeacon', descKey: 'item.decoyBeacon.desc',
    counterKey: 'item.decoyBeacon.counter',
    category: 'utility', targeting: 'throwForward', weight: 6,
    color: 0xffd24a, icon: 'beacon', sound: 'beacon',
    params: { throwDist: 22, life: 4.5, retargetProjectiles: true },
  },
  graviton_well: {
    id: 'graviton_well', nameKey: 'item.gravitonWell', descKey: 'item.gravitonWell.desc',
    counterKey: 'item.gravitonWell.counter',
    category: 'hazard', targeting: 'throwForward', weight: 6,
    color: 0x5a4a8a, icon: 'well', sound: 'well',
    params: { throwDist: 20, radius: 6.5, pull: 6.5, life: 8, noDamage: true },
  },
  tempest_cell: {
    id: 'tempest_cell', nameKey: 'item.tempestCell', descKey: 'item.tempestCell.desc',
    counterKey: 'item.tempestCell.counter',
    category: 'buff', targeting: 'self', weight: 6,
    color: 0x8ac8ff, icon: 'cell', sound: 'tempest',
    params: { charges: 3, zapRadius: 6, zapBehind: true, duration: 12 },
  },
  nano_swarm: {
    id: 'nano_swarm', nameKey: 'item.nanoSwarm', descKey: 'item.nanoSwarm.desc',
    counterKey: 'item.nanoSwarm.counter',
    category: 'hazard', targeting: 'self', weight: 7,
    color: 0xa0d8a0, icon: 'swarm', sound: 'swarm',
    params: { duration: 4, coneLen: 11, coneHalfAngle: 0.55, dragMult: 0.7 },
  },
  aurora_veil: {
    id: 'aurora_veil', nameKey: 'item.auroraVeil', descKey: 'item.auroraVeil.desc',
    counterKey: 'item.auroraVeil.counter',
    category: 'hazard', targeting: 'drop', weight: 7,
    color: 0xa0ffd8, icon: 'veil', sound: 'aurora',
    params: { width: 8, life: 8, gripMult: 0.45, slipDur: 1.4 },
  },
  kinetic_siphon: {
    id: 'kinetic_siphon', nameKey: 'item.kineticSiphon', descKey: 'item.kineticSiphon.desc',
    counterKey: 'item.kineticSiphon.counter',
    category: 'debuff', targeting: 'nearestAhead', weight: 6,
    color: 0xff9a6a, icon: 'siphon', sound: 'siphon',
    params: { duration: 3.0, drain: 0.08, maxRange: 45 },
  },
};

export const ITEM_LIST = Object.values(ITEMS);

// Position-weighted roulette: backmarkers get stronger help, leaders get
// utility/defensive options. `pos` is 1-based, `total` kart count.
export function rollItem(rng, pos, total) {
  const t = total > 1 ? (pos - 1) / (total - 1) : 0.5; // 0 = leader
  const pool = [];
  for (const item of ITEM_LIST) {
    let w = item.weight;
    if (item.category === 'debuff' || item.category === 'zone') w *= 1.4 - t;       // leaders more likely to be targeted tools
    if (item.category === 'buff' || item.category === 'utility') w *= 0.7 + t;      // backmarkers get help
    if (item.category === 'hazard') w *= 0.8 + 0.4 * (t < 0.5 ? 1 : 0.4);           // traps favor mid-front
    pool.push({ item, w: Math.max(0.1, w) });
  }
  let sum = pool.reduce((s, p) => s + p.w, 0);
  let r = rng() * sum;
  for (const p of pool) {
    r -= p.w;
    if (r <= 0) return p.item.id;
  }
  return pool[pool.length - 1].item.id;
}
