// ============================================================================
// Battle arenas.
//
// An arena is a track def shaped as a wide flat loop (a disc): the road
// ribbon is so wide relative to its radius that it fills the interior, giving
// karts a free-roaming battle floor through the untouched vehicle physics.
// Rendered by the themed environment kits like any track.
// ============================================================================

function ringPoints(R, n = 10, w = 40, y = 0, wobble = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = R + (wobble ? Math.sin(a * 3) * wobble : 0);
    pts.push({ x: Math.sin(a) * r, y, z: Math.cos(a) * r, w });
  }
  return pts;
}

export const ARENAS = [
  {
    id: 'ember_forge',
    nameKey: 'arena.emberForge',
    theme: 'volcano',
    musicSeed: 901,
    difficulty: 0,
    teachKey: 'arena.emberForge.desc',
    mechanicKey: 'arena.emberForge.desc',
    laps: 0,
    points: ringPoints(22, 10, 40, 0, 1.5),
    checkpoints: [0, 0.25, 0.5, 0.75],
    boxes: [0.05, 0.3, 0.55, 0.8],
    obstacles: [
      { type: 'flamejet', s: 0.125, period: 3.2, duty: 0.35, radius: 3.2 },
      { type: 'flamejet', s: 0.625, period: 4.0, duty: 0.35, radius: 3.2 },
    ],
  },
  {
    id: 'cryo_hall',
    nameKey: 'arena.cryoHall',
    theme: 'crystal',
    musicSeed: 902,
    difficulty: 0,
    teachKey: 'arena.cryoHall.desc',
    mechanicKey: 'arena.cryoHall.desc',
    laps: 0,
    points: ringPoints(23, 10, 42, 0, 0),
    checkpoints: [0, 0.25, 0.5, 0.75],
    boxes: [0.1, 0.35, 0.6, 0.85],
    obstacles: [
      { type: 'slider', s: 0.0, ampExtra: 6, speed: 1.1, radius: 1.6 },
      { type: 'slider', s: 0.5, ampExtra: 6, speed: 1.3, phase: 1.6, radius: 1.6 },
    ],
  },
  {
    id: 'neon_plaza',
    nameKey: 'arena.neonPlaza',
    theme: 'city',
    musicSeed: 903,
    difficulty: 0,
    teachKey: 'arena.neonPlaza.desc',
    mechanicKey: 'arena.neonPlaza.desc',
    laps: 0,
    points: ringPoints(21, 8, 38, 0, 2.5),
    checkpoints: [0, 0.25, 0.5, 0.75],
    boxes: [0.08, 0.33, 0.58, 0.83],
    obstacles: [
      { type: 'pendulum', s: 0.25, swing: 8, speed: 1.6, radius: 1.8 },
      { type: 'pendulum', s: 0.75, swing: 8, speed: 1.6, phase: 2.1, radius: 1.8 },
    ],
  },
  {
    id: 'sky_atoll',
    nameKey: 'arena.skyAtoll',
    theme: 'islands',
    musicSeed: 904,
    difficulty: 0,
    teachKey: 'arena.skyAtoll.desc',
    mechanicKey: 'arena.skyAtoll.desc',
    laps: 0,
    points: ringPoints(22, 10, 40, 0, 1.0),
    checkpoints: [0, 0.25, 0.5, 0.75],
    boxes: [0.12, 0.37, 0.62, 0.87],
    zones: [{ f0: 0.0, f1: 1.0, type: 'lowgrav', v: 0.62 }],
  },
];

export function getArena(id) {
  return ARENAS.find((a) => a.id === id) || ARENAS[0];
}

// Arena ring radius (control-point radius). The ribbon extends roughly
// +/- half its width around this circle.
for (const a of ARENAS) {
  const R = Math.hypot(a.points[0].x, a.points[0].z);
  a.arenaRadius = R + a.points[0].w / 2 + 2;
}

// Invisible energy wall: keeps karts on the arena disc. The step loop calls
// this after vehicle.step(). Returns true when the wall pushed the kart.
export function enforceArenaWalls(def, vehicle) {
  const r = Math.hypot(vehicle.pos.x, vehicle.pos.z);
  if (r <= def.arenaRadius || r < 0.001) return false;
  const s = def.arenaRadius / r;
  vehicle.pos.x *= s;
  vehicle.pos.z *= s;
  vehicle.vel.multiplyScalar(0.4);
  return true;
}
