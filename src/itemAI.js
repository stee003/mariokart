// ============================================================================
// itemAI - shared "should I fire this now?" heuristic.
//
// Extracted from AIController (Increment 8) so racing AI and battle AI make
// item decisions through the same code path instead of drifting apart. Never
// grants anything: skill only scales WHEN to use an item the kart already
// holds, and eagerness is a personality trait.
// ============================================================================

import { ITEMS as ITEMS_BY_ID } from './content/items.js';

// Distance to the closest kart ahead within a corridor of `halfWidth` metres.
export function nearestAhead(v, karts, halfWidth = 4) {
  const fwdX = Math.sin(v.yaw), fwdZ = Math.cos(v.yaw);
  let best = Infinity;
  for (const other of karts) {
    if (other.vehicle === v) continue;
    const dx = other.vehicle.pos.x - v.pos.x;
    const dz = other.vehicle.pos.z - v.pos.z;
    const along = dx * fwdX + dz * fwdZ;
    const side = Math.abs(dx * fwdZ - dz * fwdX);
    if (along > 0 && side < halfWidth && along < best) best = along;
  }
  return best;
}

export function nearestBehind(v, karts) {
  const fwdX = Math.sin(v.yaw), fwdZ = Math.cos(v.yaw);
  let best = Infinity;
  for (const other of karts) {
    if (other.vehicle === v) continue;
    const dx = other.vehicle.pos.x - v.pos.x;
    const dz = other.vehicle.pos.z - v.pos.z;
    const along = dx * fwdX + dz * fwdZ;
    if (along < 0 && -along < best) best = -along;
  }
  return best;
}

// How many rivals sit inside a radius (used to time area-effect items).
export function nearbyCount(v, karts, radius) {
  let n = 0;
  for (const other of karts) {
    if (other.vehicle === v) continue;
    const dx = other.vehicle.pos.x - v.pos.x;
    const dz = other.vehicle.pos.z - v.pos.z;
    if (dx * dx + dz * dz <= radius * radius) n++;
  }
  return n;
}

// ctx: { def, karts, v, track, s, eagerness, skill, mode }
export function shouldUseItem(ctx) {
  const { def, karts, v, track, eagerness = 1, skill = 1, mode = 'race' } = ctx;
  if (!def) return false;
  const eag = Math.min(1.3, eagerness);
  const roll = (base) => Math.random() < Math.min(1, base * skill);
  const aheadDist = nearestAhead(v, karts, mode === 'battle' ? 9 : 4);
  const behindDist = nearestBehind(v, karts);
  const straight = mode === 'battle'
    ? true
    : Math.abs(track.lineAt((ctx.s ?? 0) + 6).curv) < 0.015;

  switch (def.category) {
    case 'projectile': {
      if (mode === 'battle') return aheadDist < 26 && roll(0.75 + eag * 0.2);
      if (aheadDist < 42 && straight && roll(0.5 + eag * 0.4)) return true;
      return aheadDist < 20 && roll(0.3);
    }
    case 'hazard': {
      if (mode === 'battle') return behindDist < 16 && roll(0.5) || roll(0.15);
      if (behindDist < 22 && roll(0.4 + eag * 0.3)) return true;
      return straight && roll(0.12);
    }
    case 'buff':
      if (mode === 'battle') return roll(0.5 + eag * 0.35);
      return straight && roll(0.35 + eag * 0.45);
    case 'debuff':
    case 'zone': {
      if (mode === 'battle') {
        // area denial pays off when the arena is crowded
        const crowd = nearbyCount(v, karts, def.params?.radius ?? 12);
        return (crowd >= 1 || behindDist < 20) && roll(0.5 + eag * 0.4);
      }
      return (aheadDist < 48 || behindDist < 30) && roll(0.3 + eag * 0.4);
    }
    case 'utility':
      if (mode === 'battle') return roll(0.35 + eag * 0.3);
      return roll(0.25 + eag * 0.3);
    default:
      return roll(0.2);
  }
}

export function itemDef(id) {
  return ITEMS_BY_ID[id] || null;
}
