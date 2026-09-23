// ============================================================================
// AI rival roster.
//
// The lobby seats CONFIG.race.maxPlayers racers: the player plus up to
// maxPlayers - 1 AI rivals drawn from this list, in order. Each entry pairs
// a localized name with kart colors and one of the three driving
// personalities defined in CONFIG.ai.personalities.
//
// The first three entries are the original vertical-slice rivals and are
// kept byte-identical so small (<= 4 kart) grids behave exactly as before.
// ============================================================================

export const AI_ROSTER = [
  { nameKey: 'ai.cinder',   color: 0xd9452f, accent: 0xffd23f, pilot: 0x53302a, ai: 'aggressive' },
  { nameKey: 'ai.zephyr',   color: 0x2fa877, accent: 0xd8f4e6, pilot: 0x3c5c4e, ai: 'balanced' },
  { nameKey: 'ai.bastion',  color: 0x4159c9, accent: 0x9fb4ff, pilot: 0x37406e, ai: 'defensive' },
  { nameKey: 'ai.nova',     color: 0x5a6fe8, accent: 0xffe08a, pilot: 0x3a4478, ai: 'balanced' },
  { nameKey: 'ai.thistle',  color: 0x4f9e4f, accent: 0xfff0a8, pilot: 0x33603a, ai: 'defensive' },
  { nameKey: 'ai.coral',    color: 0xe8557f, accent: 0xbaf0ff, pilot: 0x7a3350, ai: 'aggressive' },
  { nameKey: 'ai.volt',     color: 0xf0c020, accent: 0x66e8ff, pilot: 0x6a5410, ai: 'balanced' },
  { nameKey: 'ai.obsidian', color: 0x3a3450, accent: 0xc08aff, pilot: 0x241f33, ai: 'defensive' },
  { nameKey: 'ai.juniper',  color: 0x2f8fa8, accent: 0xa8f0d8, pilot: 0x1f5a6a, ai: 'balanced' },
  { nameKey: 'ai.ratchet',  color: 0x9a6a3a, accent: 0xffc46a, pilot: 0x5c3f22, ai: 'aggressive' },
  { nameKey: 'ai.lumi',     color: 0xd8d0f0, accent: 0xff9ad8, pilot: 0x8a82a8, ai: 'defensive' },
];

// Rivals available for a lobby of `capacity` racers (player included).
export function rosterFor(capacity) {
  return AI_ROSTER.slice(0, Math.max(0, capacity - 1));
}
