// ============================================================================
// Original character roster. Every pilot:
//  - distributes exactly CHARACTER_STAT_BUDGET points (no objective bests,
//    verified by test/content.test.mjs via Pareto domination checks)
//  - has a unique silhouette (head shape / ears / tail / accessory combo)
//  - has a personality key (drives AI flavor + UI flavor text)
//  - has a procedural voice profile (pitch/rasp) used by AudioManager
//    for vocal reactions (no recorded audio, all synthesized)
// ============================================================================

import { CHARACTER_STAT_BUDGET } from './stats.js';

export const CHARACTERS = [
  {
    id: 'ember', nameKey: 'char.ember', speciesKey: 'char.ember.species',
    personalityKey: 'char.ember.personality', unlock: { type: 'default' },
    stats: { acceleration: 6, topSpeed: 6, handling: 6, weight: 5, driftControl: 6, offRoad: 5 },
    colors: { fur: 0xf2a65a, suit: 0xff8a2a, accent: 0x2fd8c8 },
    silhouette: { head: 'fox', ears: 'pointed', tail: 'bushy', accessory: 'goggles', build: 1.0 },
    voice: { pitch: 430, rasp: 0.25, chattiness: 0.7 },
  },
  {
    id: 'cinder', nameKey: 'char.cinder', speciesKey: 'char.cinder.species',
    personalityKey: 'char.cinder.personality', unlock: { type: 'default' },
    stats: { acceleration: 4, topSpeed: 6, handling: 4, weight: 9, driftControl: 5, offRoad: 6 },
    colors: { fur: 0x8a4a32, suit: 0xd9452f, accent: 0xffd23f },
    silhouette: { head: 'bear', ears: 'round', tail: 'stub', accessory: 'scar', build: 1.28 },
    voice: { pitch: 180, rasp: 0.6, chattiness: 0.5 },
  },
  {
    id: 'zephyr', nameKey: 'char.zephyr', speciesKey: 'char.zephyr.species',
    personalityKey: 'char.zephyr.personality', unlock: { type: 'default' },
    stats: { acceleration: 8, topSpeed: 5, handling: 6, weight: 2, driftControl: 6, offRoad: 7 },
    colors: { fur: 0xd8f4e6, suit: 0x2fa877, accent: 0xbaffec },
    silhouette: { head: 'bird', ears: 'feathers', tail: 'feathers', accessory: 'scarf', build: 0.86 },
    voice: { pitch: 660, rasp: 0.1, chattiness: 0.8 },
  },
  {
    id: 'bastion', nameKey: 'char.bastion', speciesKey: 'char.bastion.species',
    personalityKey: 'char.bastion.personality', unlock: { type: 'default' },
    stats: { acceleration: 3, topSpeed: 7, handling: 3, weight: 9, driftControl: 4, offRoad: 8 },
    colors: { fur: 0x6e7fae, suit: 0x4159c9, accent: 0x9fb4ff },
    silhouette: { head: 'shell', ears: 'none', tail: 'stub', accessory: 'helmet', build: 1.34 },
    voice: { pitch: 140, rasp: 0.7, chattiness: 0.3 },
  },
  {
    id: 'nova', nameKey: 'char.nova', speciesKey: 'char.nova.species',
    personalityKey: 'char.nova.personality', unlock: { type: 'default' },
    stats: { acceleration: 5, topSpeed: 9, handling: 5, weight: 3, driftControl: 6, offRoad: 6 },
    colors: { fur: 0xcfd8ff, suit: 0x5a6fe8, accent: 0xffe08a },
    silhouette: { head: 'lynx', ears: 'pointed', tail: 'long', accessory: 'visor', build: 0.94 },
    voice: { pitch: 540, rasp: 0.15, chattiness: 0.6 },
  },
  {
    id: 'thistle', nameKey: 'char.thistle', speciesKey: 'char.thistle.species',
    personalityKey: 'char.thistle.personality', unlock: { type: 'default' },
    stats: { acceleration: 7, topSpeed: 4, handling: 9, weight: 2, driftControl: 6, offRoad: 6 },
    colors: { fur: 0xb7e08a, suit: 0x4f9e4f, accent: 0xfff0a8 },
    silhouette: { head: 'bunny', ears: 'tall', tail: 'puff', accessory: 'bandana', build: 0.82 },
    voice: { pitch: 720, rasp: 0.05, chattiness: 0.9 },
  },
  {
    id: 'coral', nameKey: 'char.coral', speciesKey: 'char.coral.species',
    personalityKey: 'char.coral.personality', unlock: { type: 'default' },
    stats: { acceleration: 5, topSpeed: 5, handling: 6, weight: 6, driftControl: 5, offRoad: 7 },
    colors: { fur: 0x7fd4d4, suit: 0x2a8fa8, accent: 0xff9ab0 },
    silhouette: { head: 'dragon', ears: 'fins', tail: 'fin', accessory: 'none', build: 1.06 },
    voice: { pitch: 360, rasp: 0.3, chattiness: 0.55 },
  },
  {
    id: 'volt', nameKey: 'char.volt', speciesKey: 'char.volt.species',
    personalityKey: 'char.volt.personality', unlock: { type: 'default' },
    stats: { acceleration: 9, topSpeed: 4, handling: 6, weight: 3, driftControl: 6, offRoad: 6 },
    colors: { fur: 0xfff08a, suit: 0xf0c820, accent: 0x66e8ff },
    silhouette: { head: 'weasel', ears: 'pointed', tail: 'bolt', accessory: 'goggles', build: 0.88 },
    voice: { pitch: 800, rasp: 0.08, chattiness: 1.0 },
  },
  {
    id: 'obsidian', nameKey: 'char.obsidian', speciesKey: 'char.obsidian.species',
    personalityKey: 'char.obsidian.personality', unlock: { type: 'default' },
    stats: { acceleration: 5, topSpeed: 6, handling: 5, weight: 5, driftControl: 9, offRoad: 4 },
    colors: { fur: 0x4a3a5e, suit: 0x2c2138, accent: 0xff5df1 },
    silhouette: { head: 'bat', ears: 'horns', tail: 'long', accessory: 'none', build: 1.0 },
    voice: { pitch: 240, rasp: 0.5, chattiness: 0.35 },
  },
  {
    id: 'juniper', nameKey: 'char.juniper', speciesKey: 'char.juniper.species',
    personalityKey: 'char.juniper.personality', unlock: { type: 'default' },
    stats: { acceleration: 6, topSpeed: 5, handling: 6, weight: 4, driftControl: 5, offRoad: 8 },
    colors: { fur: 0x9ab06a, suit: 0x6a8f3f, accent: 0xffe6b0 },
    silhouette: { head: 'cat', ears: 'pointed', tail: 'bushy', accessory: 'leaf', build: 0.96 },
    voice: { pitch: 480, rasp: 0.2, chattiness: 0.65 },
  },
  {
    id: 'ratchet', nameKey: 'char.ratchet', speciesKey: 'char.ratchet.species',
    personalityKey: 'char.ratchet.personality', unlock: { type: 'default' },
    stats: { acceleration: 7, topSpeed: 6, handling: 5, weight: 6, driftControl: 4, offRoad: 6 },
    colors: { fur: 0xb0a090, suit: 0xc96f2a, accent: 0x8ad0ff },
    silhouette: { head: 'rat', ears: 'round', tail: 'long', accessory: 'wrench', build: 0.98 },
    voice: { pitch: 560, rasp: 0.35, chattiness: 0.75 },
  },
  {
    id: 'lumi', nameKey: 'char.lumi', speciesKey: 'char.lumi.species',
    personalityKey: 'char.lumi.personality', unlock: { type: 'default' },
    stats: { acceleration: 5, topSpeed: 5, handling: 8, weight: 3, driftControl: 8, offRoad: 5 },
    colors: { fur: 0xe8f4ff, suit: 0x8ab8e8, accent: 0xbaf0ff },
    silhouette: { head: 'owl', ears: 'tufts', tail: 'feathers', accessory: 'none', build: 0.9 },
    voice: { pitch: 390, rasp: 0.12, chattiness: 0.4 },
  },
  {
    id: 'aurelia', nameKey: 'char.aurelia', speciesKey: 'char.aurelia.species',
    personalityKey: 'char.aurelia.personality',
    unlock: { type: 'cup', cupId: 'crown', noteKey: 'unlock.aurelia' },
    stats: { acceleration: 6, topSpeed: 8, handling: 6, weight: 4, driftControl: 6, offRoad: 4 },
    colors: { fur: 0xffd98a, suit: 0xe8a020, accent: 0xfff6d8 },
    silhouette: { head: 'sphinx', ears: 'pointed', tail: 'long', accessory: 'crown', build: 1.1 },
    voice: { pitch: 320, rasp: 0.18, chattiness: 0.5 },
  },
  {
    id: 'umbra', nameKey: 'char.umbra', speciesKey: 'char.umbra.species',
    personalityKey: 'char.umbra.personality',
    unlock: { type: 'achievement', achievementId: 'night_shift', noteKey: 'unlock.umbra' },
    stats: { acceleration: 6, topSpeed: 5, handling: 5, weight: 7, driftControl: 5, offRoad: 6 },
    colors: { fur: 0x3a3242, suit: 0x241f2c, accent: 0x9a8aff },
    silhouette: { head: 'mole', ears: 'none', tail: 'stub', accessory: 'lamp', build: 1.14 },
    voice: { pitch: 210, rasp: 0.55, chattiness: 0.25 },
  },
];

export function getCharacter(id) {
  return CHARACTERS.find((c) => c.id === id) || null;
}

// Sanity guard at import time (cheap; the full validation lives in tests).
for (const c of CHARACTERS) {
  const total = Object.values(c.stats).reduce((a, b) => a + b, 0);
  if (total !== CHARACTER_STAT_BUDGET) {
    throw new Error(`Character ${c.id} stat budget ${total} != ${CHARACTER_STAT_BUDGET}`);
  }
}
