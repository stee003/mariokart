// Original eight-bar scores, exclusively for the eight refined courses.
// Scale degrees on an eighth-note grid; '-' is a deliberate rest.
const notes = text => text.trim().split(/\s+/).map(n => n === '-' ? null : Number(n));
const beats = text => text.replace(/\s/g, '').split('').map(Number);
function score(title, bpm, mode, root, leadType, cutoff, echo, roots, melody, groove) {
  const driving = groove === 'drive', floating = groove === 'float';
  return {
    title, bpm, mode, root, loopSteps: 64, leadType, bassType: floating ? 'sine' : 'triangle',
    drive: driving ? .94 : floating ? .74 : .84, arp: true,
    voice: { cutoff, attack: floating ? .03 : .018, echo },
    chords: roots.map(r => floating ? [r, r+2, r+4, r+6] : [r, r+2, r+4]),
    bass: roots.flatMap((r, i) => driving ? [r,r,null,r,r+4,null,r,i===7?r-1:null]
      : floating ? [r,null,null,r+4,null,r,null,i===7?r-1:r+4]
      : [r,null,r,null,r+4,null,i%2?r+2:r+4,null]),
    lead: notes(melody),
    drums: {
      kick: beats(driving ? '10011010 10001010 10011010 10010100 10011010 10001010 10011010 10110101'
        : floating ? '10000100 10001000 10000100 10001010 10000100 10001000 10000100 10010100'
        : '10010010 10001010 10010010 10001100 10010010 10001010 10010010 10010101'),
      snare: beats('00100010 00100010 00100010 00100110 00100010 00100010 00100010 00100101'),
      hat: beats(floating ? '10101010 10101011 10101010 10101110 10101010 10101011 10101010 10101111'
        : '10111011 10111011 10111011 11111111 10111011 10111011 10111011 10111111'),
      open: beats('00000000 00000001 00000000 00000001 00000000 00000001 00000000 00000001'),
    },
  };
}
export const REFINEMENT_MUSIC = {
  forge_line: score('Copper and Clockwork', 136, 'minor', 110, 'sawtooth', 1650, .12,
    [0,0,3,4,0,2,5,4], `
      0 - 4 0 7 - 6 4   0 4 - 7 9 - 7 -   3 - 7 5 10 - 7 -   4 6 - 8 6 4 - -
      7 - 11 7 14 - 13 11   9 6 - 9 11 - 9 -   12 - 9 7 5 7 9 -   8 6 4 - 1 - 0 -`, 'drive'),
  skyreach: score('Sails Above the Sun', 128, 'major', 146.832, 'triangle', 3400, .25,
    [0,4,5,3,0,2,3,4], `
      4 - 7 9 11 - 9 7   8 - 11 - 13 11 8 -   9 - 12 11 9 - 7 -   10 7 - 5 3 - 5 -
      11 - 14 13 11 9 7 -   9 - 11 13 16 - 13 -   14 - 12 10 7 - 5 -   8 6 4 - 2 - 0 -`, 'float'),
  ruins_of_vael: score('Memory of the Sundial', 122, 'dorian', 130.813, 'triangle', 2400, .3,
    [0,3,0,4,5,3,2,4], `
      0 - 2 4 7 - 4 -   3 - 5 7 10 - 7 -   7 6 4 - 2 - 0 -   4 - 6 8 6 - 4 -
      9 - 12 9 7 - 5 -   10 - 7 5 3 5 7 -   9 6 4 - 2 - 4 -   8 - 6 4 2 1 0 -`, 'step'),
  sandstone_crown: score('Procession of Gold', 132, 'mixo', 123.471, 'triangle', 2800, .16,
    [0,5,3,4,0,5,2,4], `
      4 4 - 7 6 - 4 -   5 - 9 7 5 7 - -   3 5 - 7 10 - 7 5   4 - 6 8 6 4 - -
      11 11 - 14 13 - 11 7   12 - 9 7 5 7 9 -   9 6 - 4 2 - 4 -   8 6 4 2 1 - 0 -`, 'step'),
  tempest_ridge: score('Riders of the Front', 140, 'minor', 146.832, 'sawtooth', 1800, .2,
    [0,5,3,4,0,2,5,4], `
      7 - 7 6 4 - 2 4   9 - 9 7 5 - 7 -   10 7 - 5 3 - 5 7   8 - 6 4 1 - 4 -
      14 - 14 13 11 - 9 11   13 - 11 9 6 - 9 -   12 9 - 7 5 7 9 -   8 6 4 - 1 2 0 -`, 'drive'),
  glimmer_deep: score('Prismatic Echoes', 118, 'dorian', 164.814, 'sine', 3800, .38,
    [0,2,3,5,0,3,2,4], `
      7 - - 11 9 - 7 -   9 - 6 - 4 - 6 -   10 - - 7 5 - 3 -   9 - 12 - 11 9 - -
      14 - - 11 9 - 7 9   10 - 14 - 12 - 10 -   13 - - 9 6 - 4 -   8 - 6 4 2 - 0 -`, 'float'),
  orbital_ring: score('Blue Planet Velocity', 130, 'major', 130.813, 'triangle', 3100, .24,
    [0,3,5,4,0,2,3,4], `
      0 - 4 7 11 - 9 7   3 - 7 10 12 - 10 -   5 - 9 12 14 - 12 9   8 - 6 4 6 - 8 -
      7 - 11 14 16 - 14 11   9 - 13 11 9 - 6 -   10 - 12 14 12 10 7 -   8 6 4 - 2 1 0 -`, 'step'),
  void_terminal: score('Last Departure', 134, 'minor', 98, 'sawtooth', 1350, .28,
    [0,0,5,4,0,3,5,4], `
      0 - - 7 6 - 4 0   4 - 7 - 9 7 - -   5 - - 9 12 - 9 7   8 - 6 - 4 1 - -
      7 - - 14 13 - 11 7   10 - 7 - 5 7 10 -   12 - - 9 7 - 5 7   8 6 4 - 1 - 0 -`, 'drive'),
};
