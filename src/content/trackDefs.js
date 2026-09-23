import { REFINEMENT_MUSIC } from './refinementMusic.js';
import { EXPEDITION_MUSIC } from './expeditionMusic.js';

// ============================================================================
// Track definitions - pure data. TrackManager (src/track.js) builds any of
// these; with no argument it builds SUNFORGE_DEF exactly as the original
// vertical slice. Each track teaches a different racing skill and carries
// its own theme, signature mechanic, hazards, ramps, pads, shortcut and
// item-box rows. No two tracks are reskins: layouts, widths, elevation,
// obstacles and zones all differ.
//
// Field guide
//   points:       {x, y, z, w} closed-loop control points (Catmull-Rom)
//   shortcut:     optional {entry, exit, latEntry, latExit, halfW} (fractions of L)
//   ramps:        [{f, len, lat, halfW, rise}]  f = fraction of L for ramp start
//   pads:         [{f, lat, halfW?, len?}] boost pads
//   checkpoints:  fractions of L, strictly increasing, index 0 = finish line
//   cpExtras:     per-index half-width extras (default +7)
//   obstacles:    [{type:'gear'|'slider'|'pendulum'|'flamejet', s, ...}]
//   zones:        [{f0, f1, type:'wind'|'lowgrav'|'slippery'|'current', v}]
//   boxes:        fractions of L for 3-lane item box rows
//   ranges:       {tunnel:[a,b], bridge:[a,b], canyon:[a,b]} for themed renderers
//   music:        optional hand-arranged soundtrack spec (see src/music.js,
//                 "Rich theme specs"). When present it replaces the
//                 seeded-generated theme for this track; other tracks keep
//                 the generator.
// ============================================================================

export const SUNFORGE_DEF = {
  id: 'sunforge_circuit', nameKey: 'track.sunforge', theme: 'desert',
  teachKey: 'track.sunforge.teach', mechanicKey: 'track.sunforge.mechanic',
  musicSeed: 11, laps: 3, difficulty: 1,
  // Rebuilt 2026 pass: ~20% wider lanes for a more comfortable flow, softer
  // ramp grades, roomier pads, and a hand-arranged "sun anthem" soundtrack.
  points: [
    { x: -202, y: 0,    z: -162, w: 30 },
    { x: -27,  y: 0,    z: -162, w: 30 },
    { x: 105,  y: 0,    z: -157, w: 25 },
    { x: 205,  y: 1.5,  z: -140, w: 20 },
    { x: 267,  y: 3,    z: -84,  w: 17.5 },
    { x: 224,  y: 5.5,  z: 11,   w: 17.5 },
    { x: 178,  y: 9.5,  z: 186,  w: 16.5 },
    { x: 81,   y: 12,   z: 251,  w: 15.5 },
    { x: -41,  y: 11.5, z: 273,  w: 15.5 },
    { x: -162, y: 8.5,  z: 259,  w: 14.5 },
    { x: -232, y: 5.5,  z: 200,  w: 14 },
    { x: -259, y: 3.5,  z: 105,  w: 13.5 },
    { x: -230, y: 2.5,  z: 14,   w: 13.5 },
    { x: -273, y: 1.5,  z: -73,  w: 14.5 },
    { x: -267, y: 0.5,  z: -140, w: 21 },
  ],
  shortcut: { entry: 0.805, exit: 0.885, latEntry: 3.4, latExit: 4.6, halfW: 4.1 },
  shortcutPads: [0.35, 0.72],
  ramps: [
    { f: 0.40, len: 14, lat: 0, halfW: 4.6, rise: 2.3 },
    { f: 0.59, len: 10, lat: 0, halfW: 4.2, rise: 1.8 },
    { f: 0.058, len: 9, lat: -3.5, halfW: 3.8, rise: 1.4 },
  ],
  pads: [
    { f: 0.13, lat: 3, halfW: 2.6, len: 5 },
    { f: 0.13, lat: -3, halfW: 2.6, len: 5 },
    { f: 0.375, lat: 0, halfW: 2.8, len: 5 },
    { f: 0.555, lat: 0, halfW: 2.8, len: 5 },
    { f: 0.625, lat: 0, halfW: 2.6, len: 5 },
    { f: 0.935, lat: 0, halfW: 2.8, len: 5 },
  ],
  checkpoints: [0, 0.10, 0.355, 0.385, 0.53, 0.625, 0.712, 0.765, 0.905, 0.965],
  cpExtras: { 0: 6, 8: 14 },
  obstacles: [
    { type: 'gear', s: 0.84, lat: 2.0, armRadius: 6.4, speed: 0.85 },
    { type: 'slider', s: 0.645, ampExtra: 0.8, speed: 2.1, radius: 1.6 },
  ],
  zones: [],
  boxes: [0.085, 0.26, 0.44, 0.62, 0.805, 0.94],
  ranges: { tunnel: [0.657, 0.705], bridge: [0.48, 0.585], canyon: [0.72, 0.915] },
  music: {
    // "Sun Anthem" - mixolydian desert groove @ 128 BPM
    bpm: 128, mode: 'mixo', root: 110,
    leadType: 'square', bassType: 'sawtooth', drive: 1.0, arp: true,
    chords: [[0, 2, 4], [4, 6, 1], [5, 7, 9], [4, 6, 1]],
    drums: {
      kick:  [1,0,1,0,1,0,1,0, 1,0,1,0,1,0,1,0, 1,0,1,0,1,0,1,0, 1,0,1,0,1,0,1,0],
      snare: [0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0],
      hat:   [1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1],
      open:  [0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1],
    },
    bass: [
      0,null,null,0, 0,null,4,null,  4,null,null,4, 4,null,9,null,
      5,null,null,5, 5,null,7,null,  4,null,null,4, 4,null,9,null,
    ],
    lead: [
      4,4,3,2, 3,4,5,null,  5,4,3,null, 4,3,2,null,
      7,5,4,3, 4,3,2,null,  9,7,5,4, 3,2,0,null,
    ],
  },
};

export const TRACK_DEFS = [
  SUNFORGE_DEF,

  // ------------------------------------------------------------------ desert
  {
    id: 'ashfall_run', nameKey: 'track.ashfall', theme: 'desert',
    teachKey: 'track.ashfall.teach', mechanicKey: 'track.ashfall.mechanic',
    musicSeed: 23, laps: 3, difficulty: 2,
    // Rebuilt 2026 pass: wider lanes through the chicane, a third ramp for
    // end-of-lap rhythm, two extra boost pads, and a dedicated "ember march"
    // soundtrack. Ashfall now renders with its own volcanic-ash desert kit.
    points: [
      { x: -160, y: 0, z: -120, w: 28 },
      { x: 40,  y: 0, z: -150, w: 25 },
      { x: 185, y: 2, z: -115, w: 19 },
      { x: 245, y: 4, z: -10, w: 15.5 },
      { x: 195, y: 3, z: 95,  w: 16.5 },
      { x: 60,  y: 1, z: 150, w: 21 },
      { x: -60, y: 0, z: 165, w: 17.5 },
      { x: -130, y: 1, z: 105, w: 14 },   // chicane mouth
      { x: -95, y: 2, z: 50,  w: 13.5 },
      { x: -160, y: 3, z: -5, w: 13.5 },
      { x: -215, y: 2, z: -65, w: 17.5 },
    ],
    shortcut: { entry: 0.52, exit: 0.62, latEntry: -3.2, latExit: -3.8, halfW: 4.0 },
    ramps: [
      { f: 0.18, len: 12, lat: 0, halfW: 4.4, rise: 2.2 },
      { f: 0.70, len: 9, lat: 2.5, halfW: 3.6, rise: 1.5 },
      { f: 0.86, len: 10, lat: 0, halfW: 4.2, rise: 1.7 },
    ],
    pads: [
      { f: 0.08, lat: 0, halfW: 2.8, len: 5 },
      { f: 0.30, lat: 0, halfW: 2.6, len: 5 },
      { f: 0.42, lat: 0, halfW: 2.6, len: 5 },
      { f: 0.65, lat: 0, halfW: 2.6, len: 5 },
      { f: 0.90, lat: 0, halfW: 2.8, len: 5 },
    ],
    checkpoints: [0, 0.11, 0.27, 0.40, 0.56, 0.66, 0.78, 0.88, 0.955],
    cpExtras: { 0: 6, 5: 13 },
    obstacles: [{ type: 'slider', s: 0.34, ampExtra: 0.6, speed: 2.4, radius: 1.5 }],
    zones: [],
    boxes: [0.05, 0.24, 0.47, 0.57, 0.68, 0.86],
    ranges: { canyon: [0.60, 0.80] },
    music: {
      // "Ember March" - minor ash-field march @ 116 BPM
      bpm: 116, mode: 'minor', root: 98,
      leadType: 'sawtooth', bassType: 'sawtooth', drive: 0.9, arp: false,
      chords: [[0, 2, 4], [5, 7, 9], [2, 4, 6], [4, 5, 7]],
      drums: {
        kick:  [1,0,0,0,1,0,0,1, 1,0,0,0,1,0,0,1, 1,0,0,0,1,0,0,1, 1,0,0,0,1,0,0,1],
        snare: [0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0],
        hat:   [1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1],
        open:  [0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1],
      },
      bass: [
        0,null,null,0, 0,null,null,5,   5,null,null,5, 5,null,null,0,
        2,null,null,2, 2,null,null,4,   4,null,null,4, 4,null,null,5,
      ],
      lead: [
        14,null,12,null, 11,null,10,null,  12,null,14,null, 16,null,14,null,
        10,null,12,null, 14,null,12,null,  8,null,11,null, 14,null,13,null,
      ],
    },
  },

  // ------------------------------------------------------------------ forest
  {
    id: 'verdant_loop', nameKey: 'track.verdant', theme: 'forest',
    teachKey: 'track.verdant.teach', mechanicKey: 'track.verdant.mechanic',
    musicSeed: 31, laps: 3, difficulty: 1,
    // Rebuilt 2026 pass: wider S-bends, a second hop after the leaf-tunnel,
    // softer moss-slick grip, more boost pads, and a "sunlit gallop" track.
    points: [
      { x: -180, y: 0, z: -140, w: 25 },
      { x: 0,   y: 0, z: -170, w: 23 },
      { x: 150, y: 2, z: -140, w: 19 },
      { x: 225, y: 5, z: -40, w: 16 },
      { x: 150, y: 7, z: 60,  w: 15.5 },
      { x: 20,  y: 6, z: 90,  w: 16 },
      { x: -65, y: 4, z: 55,  w: 15.5 },
      { x: -125, y: 3, z: 110, w: 16 },
      { x: -55, y: 2, z: 175, w: 17.5 },
      { x: -185, y: 1, z: 150, w: 19 },
      { x: -245, y: 0, z: 30,  w: 20 },
    ],
    shortcut: { entry: 0.44, exit: 0.55, latEntry: 3.0, latExit: 3.4, halfW: 3.8 },
    ramps: [
      { f: 0.30, len: 10, lat: 0, halfW: 4.2, rise: 1.9 },
      { f: 0.66, len: 9, lat: 0, halfW: 4.0, rise: 1.7 },
    ],
    pads: [
      { f: 0.12, lat: 2.5, halfW: 2.6, len: 5 },
      { f: 0.12, lat: -2.5, halfW: 2.6, len: 5 },
      { f: 0.44, lat: 0, halfW: 2.6, len: 5 },
      { f: 0.62, lat: 0, halfW: 2.6, len: 5 },
      { f: 0.78, lat: 0, halfW: 2.6, len: 5 },
      { f: 0.92, lat: 0, halfW: 2.8, len: 5 },
    ],
    checkpoints: [0, 0.10, 0.24, 0.36, 0.50, 0.63, 0.76, 0.88, 0.955],
    cpExtras: { 0: 6, 5: 12 },
    obstacles: [{ type: 'pendulum', s: 0.70, lat: 0, swing: 5.6, speed: 1.1, radius: 1.4 }],
    zones: [{ f0: 0.30, f1: 0.42, type: 'slippery', v: 0.6 }],   // moss slicks
    boxes: [0.06, 0.22, 0.34, 0.45, 0.66, 0.85],
    ranges: { tunnel: [0.56, 0.61] },
    music: {
      // "Sunlit Gallop" - major bouncy chase @ 132 BPM
      bpm: 132, mode: 'major', root: 130.81,
      leadType: 'square', bassType: 'triangle', drive: 0.85, arp: true,
      chords: [[0, 2, 4], [4, 6, 1], [5, 7, 9], [3, 5, 7]],
      drums: {
        kick:  [1,0,0,1,0,0,1,0, 1,0,0,1,0,0,1,0, 1,0,0,1,0,0,1,0, 1,0,0,1,0,0,1,0],
        snare: [0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0],
        hat:   [1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1],
        open:  [0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1],
      },
      bass: [
        0,null,0,null, null,4,null,4,   4,null,4,null, null,9,null,9,
        5,null,5,null, null,10,null,10,  3,null,3,null, null,8,null,8,
      ],
      lead: [
        9,null,11,null, 12,null,11,9,   11,null,9,null, 8,null,7,null,
        10,null,9,null, 7,null,8,9,     8,9,10,null, 7,null,null,null,
      ],
    },
  },

  // -------------------------------------------------------------- neon city
  {
    id: 'neon_cascade', nameKey: 'track.neon', theme: 'city',
    teachKey: 'track.neon.teach', mechanicKey: 'track.neon.mechanic',
    musicSeed: 41, laps: 3, difficulty: 3,
    // Rebuilt 2026 pass: wider rooftop straights for confident 90° entries,
    // more pads to carry speed through the climb, neon-tunnel + signage
    // overhaul, and a synthwave "cascade" track.
    points: [
      { x: -200, y: 0, z: -160, w: 28 },
      { x: 60,  y: 0, z: -160, w: 23 },
      { x: 200, y: 0, z: -150, w: 17.5 },    // hard 90° right
      { x: 205, y: 4, z: -20, w: 16 },
      { x: 120, y: 6, z: 40,  w: 15 },
      { x: 205, y: 10, z: 120, w: 15 },
      { x: 60,  y: 12, z: 180, w: 16 },
      { x: -80, y: 10, z: 185, w: 16.5 },
      { x: -200, y: 6, z: 120, w: 17 },
      { x: -260, y: 3, z: 0,  w: 17.5 },
      { x: -260, y: 1, z: -90, w: 21 },
    ],
    ramps: [
      { f: 0.20, len: 11, lat: 0, halfW: 4.0, rise: 2.4 },
      { f: 0.56, len: 9, lat: 0, halfW: 3.8, rise: 2.0 },
    ],
    pads: [
      { f: 0.10, lat: 0, halfW: 2.8, len: 5 },
      { f: 0.30, lat: 0, halfW: 2.6, len: 5 },
      { f: 0.47, lat: 0, halfW: 2.6, len: 5 },
      { f: 0.80, lat: 0, halfW: 2.8, len: 5 },
      { f: 0.90, lat: 0, halfW: 2.6, len: 5 },
    ],
    checkpoints: [0, 0.09, 0.18, 0.30, 0.42, 0.55, 0.68, 0.80, 0.91, 0.965],
    cpExtras: { 0: 6 },
    obstacles: [{ type: 'slider', s: 0.735, ampExtra: 0.5, speed: 2.6, radius: 1.4 }],
    zones: [],
    boxes: [0.05, 0.23, 0.40, 0.58, 0.76, 0.92],
    ranges: { tunnel: [0.32, 0.38] },
    music: {
      // "Cascade" - synthwave descent @ 120 BPM (i - VI - VII - V)
      bpm: 120, mode: 'minor', root: 110,
      leadType: 'sawtooth', bassType: 'sawtooth', drive: 1.0, arp: true,
      chords: [[0, 2, 4], [5, 7, 9], [4, 6, 1], [6, 8, 10]],
      drums: {
        kick:  [1,0,1,0,1,0,1,0, 1,0,1,0,1,0,1,0, 1,0,1,0,1,0,1,0, 1,0,1,0,1,0,1,0],
        snare: [0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0],
        hat:   [0,1,0,1,0,1,0,1, 0,1,0,1,0,1,0,1, 0,1,0,1,0,1,0,1, 0,1,0,1,0,1,0,1],
        open:  [0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1],
      },
      bass: [
        0,0,0,0, 7,0,0,0,    5,5,5,5, 12,5,5,5,
        4,4,4,4, 11,4,4,4,   6,6,6,6, 13,6,6,6,
      ],
      lead: [
        14,null,11,null, 14,12,11,null,  12,null,9,null, 12,11,9,null,
        11,null,8,null, 11,null,8,null,  13,11,8,null, 10,null,8,null,
      ],
    },
  },

  {
    id: 'skyline_helix', nameKey: 'track.skyline', theme: 'city',
    teachKey: 'track.skyline.teach', mechanicKey: 'track.skyline.mechanic',
    musicSeed: 43, laps: 3, difficulty: 4,
    // Rebuilt 2026 pass: wider helix lanes so elevation changes stay in
    // control, a mid-climb pad, and a "towering ascent" dorian theme. The
    // world gains the mega-tower and light-helix the circuit spirals around.
    points: [
      { x: -170, y: 0,  z: -120, w: 21 },
      { x: 0,   y: 2,  z: -170, w: 19 },
      { x: 150, y: 5,  z: -120, w: 16.5 },
      { x: 190, y: 9,  z: 10,   w: 15.5 },
      { x: 130, y: 13, z: 130,  w: 15 },
      { x: 0,   y: 16, z: 175,  w: 14.5 },
      { x: -130, y: 18, z: 130, w: 14.5 },
      { x: -185, y: 15, z: 0,   w: 15 },
      { x: -135, y: 10, z: -95, w: 15.5 },
      { x: -85,  y: 7,  z: -78, w: 16.5 },    // helix rim
      // switchback crown (dive-down): pushed 8m south + kept at w17 so the
      // U-turn's two legs stay clear of each other - at full width the
      // overlapping decks let the surface match flip between legs.
      { x: -45,  y: 5,  z: -32, w: 17 },
    ],
    shortcut: { entry: 0.78, exit: 0.90, latEntry: -2.8, latExit: -3.2, halfW: 3.6 },
    ramps: [{ f: 0.35, len: 10, lat: 0, halfW: 4.0, rise: 2.1 }],
    pads: [
      { f: 0.15, lat: 0, halfW: 2.6, len: 5 },
      { f: 0.40, lat: 0, halfW: 2.6, len: 5 },
      { f: 0.60, lat: 0, halfW: 2.6, len: 5 },
      { f: 0.95, lat: 0, halfW: 2.8, len: 5 },
    ],
    checkpoints: [0, 0.11, 0.24, 0.37, 0.50, 0.62, 0.74, 0.87, 0.95],
    cpExtras: { 0: 6, 8: 12 },
    obstacles: [{ type: 'gear', s: 0.56, lat: -1.5, armRadius: 5.2, speed: 1.0 }],
    zones: [],
    boxes: [0.07, 0.30, 0.41, 0.52, 0.72, 0.90],
    ranges: {},
    music: {
      // "Towering Ascent" - dorian climb @ 124 BPM
      bpm: 124, mode: 'dorian', root: 146.83,
      leadType: 'sawtooth', bassType: 'sawtooth', drive: 1.0, arp: true,
      chords: [[0, 2, 4], [3, 5, 7], [4, 5, 7], [0, 2, 4]],
      drums: {
        kick:  [1,0,0,0,1,0,0,1, 1,0,0,0,1,0,0,1, 1,0,0,0,1,0,0,1, 1,0,0,0,1,0,0,1],
        snare: [0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0, 0,0,1,0,0,0,1,0],
        hat:   [1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1, 1,1,1,1,1,1,1,1],
        open:  [0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1, 0,0,0,0,0,0,0,1],
      },
      bass: [
        0,null,0,null, 0,null,4,null,  3,null,3,null, 3,null,7,null,
        4,null,4,null, 4,null,7,null,  0,null,0,null, 2,null,4,null,
      ],
      lead: [
        7,null,8,null,  9,null,10,null,  10,null,9,null, 10,11,10,null,
        11,null,13,null, 11,null,10,null, 14,null,13,11, 10,9,7,null,
      ],
    },
  },

  // ---------------------------------------------------------------- mountain
  {
    id: 'granite_pass', nameKey: 'track.granite', theme: 'mountain',
    teachKey: 'track.granite.teach', mechanicKey: 'track.granite.mechanic',
    musicSeed: 53, laps: 3, difficulty: 3,
    obstacleLaneOffsets: true,
    music: EXPEDITION_MUSIC.granite_pass,
    // Wider shoulders and deliberate hazard/recovery spacing; retain track identity.
    points: [
      { x: -220, y: 0,  z: -100, w: 20 },
      { x: -80,  y: 2,  z: -150, w: 18 },
      { x: 60,   y: 7,  z: -165, w: 16 },
      { x: 185,  y: 13, z: -115, w: 14.5 },
      { x: 225,  y: 19, z: -15,  w: 14 },
      { x: 140,  y: 25, z: 65,   w: 14 },
      { x: 20,   y: 29, z: 35,   w: 13.5 },   // hairpin lookout
      { x: -70,  y: 32, z: 100,   w: 14 },
      { x: -165, y: 31, z: 145,  w: 14.5 },
      { x: -235, y: 23, z: 95,   w: 15.5 },
      { x: -245, y: 13, z: -5,   w: 16.5 },
      { x: -265, y: 5,  z: -70,  w: 18 },
    ],
    ramps: [
      { f: 0.045, len: 10, lat: 0, halfW: 4.0, rise: 1.6 },
      { f: 0.72, len: 12, lat: -2, halfW: 3.8, rise: 1.5 },
    ],
    pads: [
      { f: 0.13, lat: 0, halfW: 2.8, len: 6 },
      { f: 0.62, lat: 0, halfW: 2.6, len: 5 },
      { f: 0.84, lat: 0, halfW: 2.8, len: 6 },
    ],
    checkpoints: [0, 0.10, 0.22, 0.34, 0.46, 0.58, 0.70, 0.82, 0.92, 0.965],
    cpExtras: { 0: 6 },
    obstacles: [
      { type: 'pendulum', s: 0.47, lat: -1.5, swing: 4.2, speed: 1.0, radius: 1.3 },
      { type: 'flamejet', s: 0.93, lat: 2.8, period: 3.2, duty: 0.35, radius: 2.6 },
    ],
    zones: [],
    boxes: [0.075, 0.28, 0.54, 0.78, 0.89],
    ranges: { canyon: [0.31, 0.40] },
  },

  // ------------------------------------------------------------------ volcano
  {
    id: 'magma_coil', nameKey: 'track.magma', theme: 'volcano',
    teachKey: 'track.magma.teach', mechanicKey: 'track.magma.mechanic',
    musicSeed: 61, laps: 3, difficulty: 5,
    obstacleLaneOffsets: true,
    music: EXPEDITION_MUSIC.magma_coil,
    // Wider shoulders and deliberate hazard/recovery spacing; retain track identity.
    points: [
      { x: -165, y: 0, z: -165, w: 19 },
      { x: 10,  y: 1, z: -160, w: 17 },
      { x: 140, y: 3, z: -95, w: 14.5 },
      { x: 175, y: 5, z: 15,  w: 13.5 },
      { x: 110, y: 6, z: 110, w: 13 },
      { x: 0,   y: 5, z: 140, w: 13 },
      { x: -105, y: 4, z: 105, w: 13 },
      { x: -150, y: 3, z: 15,  w: 13 },
      { x: -90,  y: 2, z: -55, w: 14 },     // inner coil
      { x: 12,   y: 2, z: -24, w: 14.5 },
      { x: 46,   y: 2, z: -53, w: 14.5 },
      { x: 12,   y: 1, z: -86, w: 15 },
      { x: -55, y: 1, z: -94, w: 15 }, // recovery bend out of the inner coil
      { x: -145, y: 0, z: -80, w: 16 },
      { x: -205, y: 0, z: -115, w: 18 },
    ],
    ramps: [{ f: 0.32, len: 12, lat: -1.5, halfW: 3.8, rise: 1.6 }],
    pads: [
      { f: 0.10, lat: 0, halfW: 2.7, len: 5.5 },
      { f: 0.55, lat: 0, halfW: 2.7, len: 5.5 },
      { f: 0.87, lat: 0, halfW: 2.8, len: 5.5 },
    ],
    checkpoints: [0, 0.12, 0.26, 0.40, 0.54, 0.68, 0.82, 0.93],
    cpExtras: { 0: 6 },
    obstacles: [
      { type: 'flamejet', s: 0.22, lat: 2.4, period: 2.6, duty: 0.34, radius: 2.4 },
      { type: 'flamejet', s: 0.62, lat: -2.4, period: 2.9, duty: 0.34, radius: 2.4 },
      { type: 'gear', s: 0.71, lat: 2.8, armRadius: 3.6, speed: 0.95 },
    ],
    zones: [],
    boxes: [0.05, 0.33, 0.58, 0.80],
    ranges: {},
  },

  // ------------------------------------------------------- underwater facility
  {
    id: 'abyss_dock', nameKey: 'track.abyss', theme: 'underwater',
    teachKey: 'track.abyss.teach', mechanicKey: 'track.abyss.mechanic',
    musicSeed: 71, laps: 3, difficulty: 2,
    obstacleLaneOffsets: true,
    music: EXPEDITION_MUSIC.abyss_dock,
    // Wider shoulders and deliberate hazard/recovery spacing; retain track identity.
    points: [
      { x: -190, y: 0, z: -120, w: 24 },
      { x: 20,  y: 0, z: -140, w: 22 },
      { x: 180, y: -2, z: -90, w: 18 },
      { x: 220, y: -4, z: 40,  w: 16 },
      { x: 120, y: -5, z: 130, w: 16 },
      { x: -15, y: -4, z: 105,  w: 16 },
      { x: -95, y: -3, z: 155, w: 17 },
      { x: -220, y: -2, z: 120, w: 17 },
      { x: -260, y: 0, z: 0,   w: 19 },
    ],
    shortcut: { entry: 0.36, exit: 0.48, latEntry: 2.5, latExit: 2.8, halfW: 4.0 },
    shortcutPads: [0.45],
    ramps: [{ f: 0.69, len: 13, lat: 0, halfW: 4.2, rise: 1.4 }],
    pads: [
      { f: 0.10, lat: 3, halfW: 2.4, len: 5 },
      { f: 0.10, lat: -3, halfW: 2.4, len: 5 },
      { f: 0.55, lat: 0, halfW: 2.6, len: 6 },
      { f: 0.88, lat: 0, halfW: 2.6, len: 5 },
    ],
    checkpoints: [0, 0.11, 0.25, 0.39, 0.52, 0.64, 0.77, 0.90, 0.96],
    cpExtras: { 0: 6, 4: 12 },
    obstacles: [{ type: 'slider', s: 0.34, ampExtra: 0.5, speed: 1.55, radius: 1.5 }],
    zones: [
      { f0: 0.52, f1: 0.66, type: 'current', v: 3.0 },   // water jet pushes forward
      { f0: 0.18, f1: 0.28, type: 'lowgrav', v: 0.55 },  // buoyancy chamber
    ],
    boxes: [0.06, 0.16, 0.48, 0.74, 0.86],
    ranges: { tunnel: [0.40, 0.47] },
  },

  // ---------------------------------------------------------- industrial zone
  {
    id: 'forge_line', nameKey: 'track.forge', theme: 'factory',
    teachKey: 'track.forge.teach', mechanicKey: 'track.forge.mechanic',
    musicSeed: 83, laps: 3, difficulty: 4,
    // Refined pass: +2m physical width, rounded transitions and recovery space.
    points: [
      { x: -210, y: 0, z: -130, w: 22 },
      { x: 30,  y: 0, z: -130, w: 20 },
      { x: 190, y: 0, z: -110, w: 16 },
      { x: 220, y: 2, z: 10,   w: 15 },
      { x: 160, y: 3, z: 80,   w: 14.5 },   // press alley
      { x: 160, y: 4, z: 150,  w: 14.5 },
      { x: 60,  y: 3, z: 175,  w: 15.5 },
      { x: -90, y: 2, z: 140,  w: 15 },
      { x: -140, y: 1, z: 40,  w: 15 },     // conveyor chicane
      { x: -230, y: 0, z: -20, w: 17 },
    ],
    ramps: [{ f: 0.54, len: 12, lat: 0, halfW: 4.2, rise: 1.8 }],
    pads: [
      { f: 0.46, lat: 0, halfW: 2.7, len: 5.5 },
      { f: 0.09, lat: 0, halfW: 2.5, len: 5 },
      { f: 0.62, lat: 0, halfW: 2.4, len: 5 },
      { f: 0.93, lat: 0, halfW: 2.5, len: 5 },
    ],
    checkpoints: [0, 0.10, 0.22, 0.34, 0.47, 0.59, 0.72, 0.85, 0.94],
    cpExtras: { 0: 6 },
    obstacles: [
      { type: 'pendulum', s: 0.375, lat: -2.8, swing: 4.0, speed: 1.15, radius: 1.5 },
      { type: 'pendulum', s: 0.405, lat: 2.8, swing: 4.0, speed: 1.15, phase: 1.6, radius: 1.5 },
      { type: 'slider', s: 0.71, ampExtra: 0.3, speed: 2.0, radius: 1.4 },
    ],
    zones: [{ f0: 0.74, f1: 0.86, type: 'current', v: 3.4 }],  // conveyor belt
    boxes: [0.05, 0.26, 0.50, 0.70, 0.88],
    ranges: { tunnel: [0.13, 0.19] },
    music: REFINEMENT_MUSIC.forge_line,
  },

  // ----------------------------------------------------------- floating isles
  {
    id: 'skyreach', nameKey: 'track.skyreach', theme: 'islands',
    teachKey: 'track.skyreach.teach', mechanicKey: 'track.skyreach.mechanic',
    musicSeed: 97, laps: 3, difficulty: 3,
    // Refined pass: +2m physical width, rounded transitions and recovery space.
    points: [
      { x: -180, y: 0, z: -110, w: 20 },
      { x: -20, y: 2, z: -140, w: 17 },
      { x: 120, y: 8, z: -120, w: 15 },     // island hop climb
      { x: 200, y: 14, z: -30, w: 14 },
      { x: 150, y: 10, z: 80,  w: 14 },
      { x: 20,  y: 8, z: 78,   w: 14.5 },
      { x: -60, y: 12, z: 130, w: 14 },
      { x: -190, y: 14, z: 110, w: 14.5 },
      { x: -240, y: 8, z: 10,  w: 16 },
    ],
    ramps: [
      { f: 0.16, len: 15, lat: 0, halfW: 4.5, rise: 2.4 },
      { f: 0.49, len: 14, lat: 0, halfW: 4.2, rise: 2.2 },
      { f: 0.70, len: 14, lat: 0, halfW: 4.2, rise: 2.3 },
    ],
    pads: [
      { f: 0.77, lat: 0, halfW: 2.7, len: 5.5 },
      { f: 0.10, lat: 0, halfW: 2.4, len: 5 },
      { f: 0.40, lat: 0, halfW: 2.3, len: 4.5 },
      { f: 0.90, lat: 0, halfW: 2.5, len: 5 },
    ],
    checkpoints: [0, 0.12, 0.26, 0.40, 0.54, 0.68, 0.82, 0.93],
    cpExtras: { 0: 6 },
    obstacles: [],
    zones: [{ f0: 0.30, f1: 0.46, type: 'lowgrav', v: 0.6 }],   // updraft between isles
    boxes: [0.06, 0.32, 0.58, 0.84],
    ranges: {},
    music: REFINEMENT_MUSIC.skyreach,
  },

  // ------------------------------------------------------------- ancient ruins
  {
    id: 'ruins_of_vael', nameKey: 'track.vael', theme: 'ruins',
    teachKey: 'track.vael.teach', mechanicKey: 'track.vael.mechanic',
    musicSeed: 101, laps: 3, difficulty: 2,
    // Refined pass: +2m physical width, rounded transitions and recovery space.
    points: [
      { x: -170, y: 0, z: -130, w: 24 },
      { x: 30,  y: 0, z: -150, w: 21 },
      { x: 180, y: 1, z: -100, w: 16 },    // colonnade right angle
      { x: 190, y: 2, z: 30,   w: 15 },
      { x: 125, y: 3, z: 94,   w: 14.5 },
      { x: 140, y: 4, z: 174,  w: 15 },
      { x: 0,   y: 3, z: 190,  w: 15.5 },
      { x: -110, y: 2, z: 130, w: 14.5 },
      { x: -85, y: 1, z: 40,   w: 14 },    // temple chicane
      { x: -160, y: 0, z: -20, w: 16 },
    ],
    shortcut: { entry: 0.60, exit: 0.70, latEntry: -2.8, latExit: -3.0, halfW: 3.8 },
    shortcutPads: [0.52],
    ramps: [{ f: 0.25, len: 12, lat: 0, halfW: 4.2, rise: 1.8 }],
    pads: [
      { f: 0.73, lat: 0, halfW: 2.7, len: 5.5 },
      { f: 0.09, lat: 0, halfW: 2.5, len: 5 },
      { f: 0.50, lat: 0, halfW: 2.4, len: 5 },
      { f: 0.92, lat: 0, halfW: 2.5, len: 5 },
    ],
    checkpoints: [0, 0.10, 0.22, 0.34, 0.46, 0.58, 0.70, 0.82, 0.92, 0.965],
    cpExtras: { 0: 6, 6: 12 },
    obstacles: [{ type: 'gear', s: 0.81, lat: -2.6, armRadius: 4.5, speed: 0.9 }],
    zones: [],
    boxes: [0.05, 0.27, 0.48, 0.66, 0.89],
    ranges: { tunnel: [0.35, 0.41] },
    music: REFINEMENT_MUSIC.ruins_of_vael,
  },

  {
    id: 'sandstone_crown', nameKey: 'track.crown', theme: 'ruins',
    teachKey: 'track.crown.teach', mechanicKey: 'track.crown.mechanic',
    musicSeed: 103, laps: 3, difficulty: 5,
    // Refined pass: +2m physical width, rounded transitions and recovery space.
    points: [
      { x: -140, y: 0, z: -140, w: 22 },
      { x: 60,  y: 0, z: -140, w: 18 },
      { x: 160, y: 2, z: -60, w: 15 },
      { x: 130, y: 4, z: 60,  w: 14 },     // amphitheatre bowl
      { x: 20,  y: 5, z: 110, w: 13.5 },
      { x: -100, y: 5, z: 72,  w: 13.5 },
      { x: -65, y: 4, z: -8, w: 13 },     // infield thread
      { x: -145, y: 2, z: -62, w: 13.5 },
    ],
    ramps: [{ f: 0.14, len: 12, lat: 0, halfW: 4.0, rise: 1.9 }],
    pads: [
      { f: 0.63, lat: 0, halfW: 2.7, len: 5.5 },
      { f: 0.07, lat: 0, halfW: 2.4, len: 4.5 },
      { f: 0.52, lat: 0, halfW: 2.2, len: 4.5 },
      { f: 0.94, lat: 0, halfW: 2.4, len: 4.5 },
    ],
    checkpoints: [0, 0.13, 0.27, 0.42, 0.57, 0.72, 0.87, 0.955],
    cpExtras: { 0: 6 },
    obstacles: [
      { type: 'pendulum', s: 0.37, lat: 2.4, swing: 4.0, speed: 1.15, radius: 1.3 },
      { type: 'slider', s: 0.82, ampExtra: 0.2, speed: 2.2, radius: 1.3 },
    ],
    zones: [],
    boxes: [0.04, 0.29, 0.58, 0.91],
    ranges: {},
    music: REFINEMENT_MUSIC.sandstone_crown,
  },

  // -------------------------------------------------------------- storm world
  {
    id: 'tempest_ridge', nameKey: 'track.tempest', theme: 'storm',
    teachKey: 'track.tempest.teach', mechanicKey: 'track.tempest.mechanic',
    musicSeed: 113, laps: 3, difficulty: 4,
    // Refined pass: +2m physical width, rounded transitions and recovery space.
    points: [
      { x: -230, y: 0, z: -120, w: 22 },
      { x: 0,   y: 2, z: -150, w: 19 },
      { x: 200, y: 6, z: -110, w: 16 },
      { x: 270, y: 10, z: 24,  w: 15 },    // exposed ridge (wind!)
      { x: 170, y: 12, z: 130, w: 14.5 },
      { x: 0,   y: 9, z: 160,  w: 15 },
      { x: -150, y: 6, z: 120, w: 15.5 },  // second ridge
      { x: -260, y: 3, z: 10,  w: 17 },
    ],
    ramps: [{ f: 0.51, len: 14, lat: 0, halfW: 4.4, rise: 2.2 }],
    pads: [
      { f: 0.85, lat: 0, halfW: 2.7, len: 5.5 },
      { f: 0.09, lat: 0, halfW: 2.5, len: 5 },
      { f: 0.62, lat: 0, halfW: 2.4, len: 5 },
      { f: 0.93, lat: 0, halfW: 2.5, len: 5 },
    ],
    checkpoints: [0, 0.12, 0.26, 0.40, 0.54, 0.68, 0.82, 0.93],
    cpExtras: { 0: 6 },
    obstacles: [],
    zones: [
      { f0: 0.30, f1: 0.46, type: 'wind', v: 4.2 },     // crosswind right -> left
      { f0: 0.66, f1: 0.80, type: 'wind', v: -3.4 },    // and back
    ],
    boxes: [0.05, 0.26, 0.58, 0.84],
    ranges: {},
    music: REFINEMENT_MUSIC.tempest_ridge,
  },

  // ------------------------------------------------------------ crystal caves
  {
    id: 'glimmer_deep', nameKey: 'track.glimmer', theme: 'crystal',
    teachKey: 'track.glimmer.teach', mechanicKey: 'track.glimmer.mechanic',
    musicSeed: 127, laps: 3, difficulty: 3,
    // Refined pass: +2m physical width, rounded transitions and recovery space.
    points: [
      { x: -160, y: 0, z: -100, w: 20 },
      { x: 10,  y: -2, z: -130, w: 18 },
      { x: 150, y: -4, z: -80, w: 15 },
      { x: 185, y: -5, z: 40,  w: 14.5 },
      { x: 90,  y: -6, z: 110, w: 14 },
      { x: -30, y: -6.5, z: 80,  w: 13.5 },  // crystal chicane
      { x: -110, y: -6, z: 130, w: 14 },
      { x: -210, y: -4, z: 60,  w: 15 },
      { x: -215, y: -2, z: -40, w: 16 },
    ],
    shortcut: { entry: 0.48, exit: 0.58, latEntry: 2.4, latExit: 2.6, halfW: 3.6 },
    shortcutPads: [0.52],
    ramps: [
      { f: 0.20, len: 14, lat: 0, halfW: 4.1, rise: 2.3 },   // crystal spring (tall hop)
      { f: 0.72, len: 13, lat: 0, halfW: 4.0, rise: 2.1 },
    ],
    pads: [
      { f: 0.46, lat: 0, halfW: 2.7, len: 5.5 },
      { f: 0.10, lat: 0, halfW: 2.3, len: 4.5 },
      { f: 0.62, lat: 0, halfW: 2.3, len: 4.5 },
      { f: 0.92, lat: 0, halfW: 2.4, len: 4.5 },
    ],
    checkpoints: [0, 0.12, 0.25, 0.38, 0.51, 0.64, 0.77, 0.90, 0.96],
    cpExtras: { 0: 6, 5: 11 },
    obstacles: [{ type: 'gear', s: 0.85, lat: -2.6, armRadius: 4.2, speed: 1.05 }],
    zones: [],
    boxes: [0.06, 0.30, 0.54, 0.78],
    ranges: { tunnel: [0.30, 0.44] },
    music: REFINEMENT_MUSIC.glimmer_deep,
  },

  // ------------------------------------------------------------ space station
  {
    id: 'orbital_ring', nameKey: 'track.orbital', theme: 'space',
    teachKey: 'track.orbital.teach', mechanicKey: 'track.orbital.mechanic',
    musicSeed: 131, laps: 3, difficulty: 2,
    // Refined pass: +2m physical width, rounded transitions and recovery space.
    points: [
      { x: -220, y: 0, z: -140, w: 26 },
      { x: 40,  y: 0, z: -170, w: 24 },
      { x: 240, y: 3, z: -90, w: 19 },
      { x: 292, y: 6, z: 84,  w: 17 },
      { x: 120, y: 8, z: 190, w: 17 },
      { x: -100, y: 8, z: 210, w: 17 },
      { x: -260, y: 5, z: 110, w: 18 },
      { x: -290, y: 2, z: -30, w: 20 },
    ],
    ramps: [{ f: 0.45, len: 15, lat: 0, halfW: 4.8, rise: 2.2 }],
    pads: [
      { f: 0.67, lat: 0, halfW: 2.7, len: 5.5 },
      { f: 0.10, lat: 3, halfW: 2.5, len: 6 },
      { f: 0.10, lat: -3, halfW: 2.5, len: 6 },
      { f: 0.55, lat: 0, halfW: 2.6, len: 6 },
      { f: 0.90, lat: 0, halfW: 2.6, len: 6 },
    ],
    checkpoints: [0, 0.12, 0.27, 0.42, 0.57, 0.72, 0.87, 0.955],
    cpExtras: { 0: 6 },
    obstacles: [],
    zones: [{ f0: 0.44, f1: 0.62, type: 'lowgrav', v: 0.45 }],   // hull breach low-g
    boxes: [0.06, 0.26, 0.53, 0.74, 0.95],
    ranges: {},
    music: REFINEMENT_MUSIC.orbital_ring,
  },

  {
    id: 'void_terminal', nameKey: 'track.void', theme: 'space',
    teachKey: 'track.void.teach', mechanicKey: 'track.void.mechanic',
    musicSeed: 137, laps: 3, difficulty: 5,
    // Refined pass: +2m physical width, rounded transitions and recovery space.
    points: [
      { x: -180, y: 0, z: -130, w: 20 },
      { x: 20,  y: 1, z: -155, w: 18 },
      { x: 170, y: 4, z: -95, w: 15 },
      { x: 190, y: 8, z: 40,  w: 14 },
      { x: 80,  y: 10, z: 110, w: 13.5 },
      { x: -30, y: 8, z: 76,  w: 13.5 },   // docking chicane
      { x: -110, y: 10, z: 130, w: 14 },
      { x: -220, y: 6, z: 60,  w: 15 },
      { x: -230, y: 2, z: -50, w: 16 },
    ],
    shortcut: { entry: 0.62, exit: 0.73, latEntry: -2.5, latExit: -2.8, halfW: 3.6 },
    shortcutPads: [0.52],
    ramps: [
      { f: 0.30, len: 14, lat: 0, halfW: 4.2, rise: 2.3 },
      { f: 0.80, len: 13, lat: 0, halfW: 4.0, rise: 2.0 },
    ],
    pads: [
      { f: 0.83, lat: 0, halfW: 2.7, len: 5.5 },
      { f: 0.09, lat: 0, halfW: 2.4, len: 5 },
      { f: 0.50, lat: 0, halfW: 2.3, len: 4.5 },
      { f: 0.94, lat: 0, halfW: 2.4, len: 5 },
    ],
    checkpoints: [0, 0.11, 0.24, 0.37, 0.50, 0.63, 0.76, 0.89, 0.96],
    cpExtras: { 0: 6, 7: 12 },
    obstacles: [
      { type: 'gear', s: 0.54, lat: 2.8, armRadius: 4.4, speed: 1.05 },
      { type: 'flamejet', s: 0.89, lat: -3.2, period: 3.0, duty: 0.36, radius: 2.3 },
    ],
    zones: [{ f0: 0.33, f1: 0.47, type: 'lowgrav', v: 0.5 }],
    boxes: [0.05, 0.26, 0.60, 0.75, 0.96],
    ranges: { tunnel: [0.17, 0.23] },
    music: REFINEMENT_MUSIC.void_terminal,
  },
];

export function getTrackDef(id) {
  return TRACK_DEFS.find((t) => t.id === id) || SUNFORGE_DEF;
}
