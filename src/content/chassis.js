// ============================================================================
// Kart chassis catalog. Every chassis is a TRADE-OFF: gains are offset by
// losses (enforced by validateDeltas in tests), so no chassis is a pure
// upgrade. Stats are deltas applied on top of the pilot's base stats.
// `body` drives the procedural chassis geometry in kartMesh.js.
// ============================================================================

export const CHASSIS = [
  {
    id: 'dune_blazer', nameKey: 'chassis.duneBlazer', unlock: { type: 'default' },
    stats: {},
    body: { hull: 'classic', nose: 'wedge', pods: 'side', wing: 'low', scale: 1.0 },
    descKey: 'chassis.duneBlazer.desc',
  },
  {
    id: 'featherwing', nameKey: 'chassis.featherwing', unlock: { type: 'default' },
    stats: { acceleration: 2, handling: 1, topSpeed: -2, weight: -1 },
    body: { hull: 'slim', nose: 'dart', pods: 'none', wing: 'fin', scale: 0.92 },
    descKey: 'chassis.featherwing.desc',
  },
  {
    id: 'ironclad_hauler', nameKey: 'chassis.ironcladHauler', unlock: { type: 'default' },
    stats: { topSpeed: 2, weight: 2, acceleration: -2, handling: -1 },
    body: { hull: 'wide', nose: 'ram', pods: 'armor', wing: 'none', scale: 1.16 },
    descKey: 'chassis.ironcladHauler.desc',
  },
  {
    id: 'tempest_bolt', nameKey: 'chassis.tempestBolt', unlock: { type: 'level', level: 4 },
    stats: { topSpeed: 3, acceleration: -2, handling: -1 },
    body: { hull: 'needle', nose: 'lance', pods: 'side', wing: 'tall', scale: 1.0 },
    descKey: 'chassis.tempestBolt.desc',
  },
  {
    id: 'bumblewisp', nameKey: 'chassis.bumblewisp', unlock: { type: 'default' },
    stats: { handling: 2, driftControl: 1, topSpeed: -2, weight: -1 },
    body: { hull: 'round', nose: 'beetle', pods: 'round', wing: 'low', scale: 0.9 },
    descKey: 'chassis.bumblewisp.desc',
  },
  {
    id: 'rockjaw', nameKey: 'chassis.rockjaw', unlock: { type: 'level', level: 6 },
    stats: { offRoad: 3, weight: 1, topSpeed: -2, acceleration: -1 },
    body: { hull: 'wide', nose: 'ram', pods: 'armor', wing: 'rollbar', scale: 1.08 },
    descKey: 'chassis.rockjaw.desc',
  },
  {
    id: 'comet_courier', nameKey: 'chassis.cometCourier', unlock: { type: 'level', level: 3 },
    stats: { acceleration: 2, topSpeed: 1, handling: -2, driftControl: -1 },
    body: { hull: 'classic', nose: 'dart', pods: 'side', wing: 'tall', scale: 1.0 },
    descKey: 'chassis.cometCourier.desc',
  },
  {
    id: 'gearwork_royale', nameKey: 'chassis.gearworkRoyale', unlock: { type: 'level', level: 8 },
    stats: { driftControl: 2, acceleration: 1, topSpeed: -1, handling: -1, offRoad: -1 },
    body: { hull: 'slim', nose: 'wedge', pods: 'round', wing: 'fin', scale: 1.02 },
    descKey: 'chassis.gearworkRoyale.desc',
  },
];

export function getChassis(id) {
  return CHASSIS.find((c) => c.id === id) || CHASSIS[0];
}
