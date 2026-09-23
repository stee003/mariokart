// ============================================================================
// Wheel catalog - 12 wheel types. Like chassis, each is a trade-off and
// also changes the kart's look (radius, width, hub style).
// ============================================================================

export const WHEELS = [
  { id: 'standard_treads', nameKey: 'wheel.standard', unlock: { type: 'default' },
    stats: {},
    geo: { radius: 0.42, width: 0.34, hub: 'disc', color: 0x26222a } },
  { id: 'slimline', nameKey: 'wheel.slimline', unlock: { type: 'default' },
    stats: { topSpeed: 1, handling: -1 },
    geo: { radius: 0.44, width: 0.22, hub: 'disc', color: 0x303036 } },
  { id: 'dune_rollers', nameKey: 'wheel.duneRollers', unlock: { type: 'default' },
    stats: { offRoad: 2, topSpeed: -1, acceleration: -1 },
    geo: { radius: 0.52, width: 0.5, hub: 'spoke', color: 0x3a3026 } },
  { id: 'gyro_rings', nameKey: 'wheel.gyroRings', unlock: { type: 'level', level: 2 },
    stats: { handling: 2, acceleration: -1, topSpeed: -1 },
    geo: { radius: 0.4, width: 0.3, hub: 'ring', color: 0x2a3a44 } },
  { id: 'iron_drums', nameKey: 'wheel.ironDrums', unlock: { type: 'default' },
    stats: { weight: 2, acceleration: -1, handling: -1 },
    geo: { radius: 0.42, width: 0.46, hub: 'drum', color: 0x44403c } },
  { id: 'slick_comets', nameKey: 'wheel.slickComets', unlock: { type: 'level', level: 3 },
    stats: { acceleration: 2, weight: -1, offRoad: -1 },
    geo: { radius: 0.38, width: 0.36, hub: 'disc', color: 0x1e1e26 } },
  { id: 'storm_spikes', nameKey: 'wheel.stormSpikes', unlock: { type: 'level', level: 5 },
    stats: { offRoad: 1, handling: 1, topSpeed: -2 },
    geo: { radius: 0.46, width: 0.4, hub: 'spike', color: 0x2c3a2e } },
  { id: 'chrome_halos', nameKey: 'wheel.chromeHalos', unlock: { type: 'level', level: 7 },
    stats: { topSpeed: 1, driftControl: 1, acceleration: -1, offRoad: -1 },
    geo: { radius: 0.43, width: 0.28, hub: 'ring', color: 0x50505c } },
  { id: 'moss_grippers', nameKey: 'wheel.mossGrippers', unlock: { type: 'default' },
    stats: { handling: 1, driftControl: 1, topSpeed: -1, weight: -1 },
    geo: { radius: 0.41, width: 0.42, hub: 'spoke', color: 0x2e3a24 } },
  { id: 'turbo_sprockets', nameKey: 'wheel.turboSprockets', unlock: { type: 'level', level: 4 },
    stats: { acceleration: 1, topSpeed: 1, handling: -1, offRoad: -1 },
    geo: { radius: 0.4, width: 0.32, hub: 'gear', color: 0x3a2e26 } },
  { id: 'balloon_floaters', nameKey: 'wheel.balloonFloaters', unlock: { type: 'level', level: 6 },
    stats: { offRoad: 2, driftControl: 1, acceleration: -2, topSpeed: -1 },
    geo: { radius: 0.55, width: 0.55, hub: 'disc', color: 0x40323a } },
  { id: 'rally_hex', nameKey: 'wheel.rallyHex', unlock: { type: 'level', level: 9 },
    stats: { driftControl: 2, handling: -1, topSpeed: -1 },
    geo: { radius: 0.44, width: 0.38, hub: 'hex', color: 0x32263a } },
];

export function getWheels(id) {
  return WHEELS.find((w) => w.id === id) || WHEELS[0];
}
