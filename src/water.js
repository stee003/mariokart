// Shallow-water footprint shared by the rendered pool and fixed-step kart
// physics. The irregular shoreline is deterministic, so a wheel only splashes
// when it is over visible water (not a bounding circle around the mesh).
export function shorelineRadius(angle) {
  return 1 + 0.055 * Math.sin(3 * angle + 0.7)
           + 0.032 * Math.cos(7 * angle - 0.4);
}

export function waterFootprint(pool, pos) {
  const dx = pos.x - pool.center.x, dz = pos.z - pool.center.z;
  const across = (dx * pool.right.x + dz * pool.right.z) / pool.across;
  const along = (dx * pool.dir.x + dz * pool.dir.z) / pool.along;
  return Math.hypot(across, along) / shorelineRadius(Math.atan2(along, across));
}

// Smooth transition over the outer 25% of the pool: no impulse on entry/exit.
export function waterCoverage(pool, pos) {
  const edge = Math.max(0, Math.min(1, (1 - waterFootprint(pool, pos)) * 4));
  return edge * edge * (3 - 2 * edge);
}
