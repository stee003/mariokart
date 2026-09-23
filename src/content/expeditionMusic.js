// Original eight-bar arrangements, on an eighth-note grid. The second phrase
// answers the first; the final bar turns back into the opening without a cut.
// Opt-in only: legacy tracks retain their existing instruments and clock.
const notes = (bars) => bars.trim().split(/\s+/).map(n => n === '-' ? null : Number(n));
const rhythm = (bars) => bars.replace(/\s/g, '').split('').map(Number);
const drums = (kick, hat, open) => ({
  kick: rhythm(kick), hat: rhythm(hat), open: rhythm(open),
  snare: rhythm('00100010 00100010 00100010 00100010 00100010 00100010 00100010 00100111'),
});
export const EXPEDITION_MUSIC = {
  granite_pass: {
    title: 'Above the Cloudline', bpm: 124, mode: 'dorian', root: 146.832,
    loopSteps: 64, leadType: 'triangle', bassType: 'triangle', drive: 0.85, arp: true,
    voice: { cutoff: 2600, attack: 0.025, echo: 0.22 },
    chords: [[0,2,4], [5,7,9], [3,5,7], [4,6,8], [0,2,4], [2,4,6], [3,5,7], [4,6,8]],
    drums: drums('10001000 10001010 10001000 10010100 10001000 10001010 10001000 10010101',
      '10111011 10111011 10111011 10111111 10111011 10111011 10111011 10111111',
      '00000000 00000001 00000000 00000001 00000000 00000001 00000000 00000001'),
    bass: notes(`0 - 0 - 4 - 0 -   -2 - -2 - 2 - 5 -   -4 - -4 - 0 - 3 -   -3 - -3 - 1 - 4 -
                 0 - 0 - 4 - 7 -   2 - 2 - 6 - 2 -   3 - 3 - 0 - 3 -   4 - 4 - 1 - -3 -`),
    lead: notes(`4 - 7 6 4 - 2 -   5 - 7 - 9 7 5 -   7 - 5 3 2 - 3 -   4 - 6 8 6 - 4 -
                 7 - 9 8 7 4 2 -   6 - 9 - 11 9 6 -   10 - 7 5 3 - 5 -   6 4 2 - 1 - 0 -`),
  },
  magma_coil: {
    title: 'Heart of the Furnace', bpm: 138, mode: 'minor', root: 110,
    loopSteps: 64, leadType: 'sawtooth', bassType: 'triangle', drive: 0.96, arp: true,
    voice: { cutoff: 1450, attack: 0.016, echo: 0.12 },
    chords: [[0,2,4], [0,2,4], [5,7,9], [4,6,8], [0,2,4], [2,4,6], [5,7,9], [4,6,8]],
    drums: drums('10011010 10011010 10001010 10011100 10011010 10011010 10001010 10110101',
      '11111111 11111111 11111111 11111111 11111111 11111111 11111111 11111111',
      '00000010 00000010 00000010 00000001 00000010 00000010 00000010 00000001'),
    bass: notes(`0 0 - 0 4 - 0 -   0 - 0 0 4 - -3 -   -2 - -2 - 2 - -2 2   -3 - -3 - 1 - 4 -
                 0 0 - 0 4 - 7 -   2 - 2 2 6 - 2 -   -2 - -2 - 2 - 5 2   -3 - 1 - 4 1 -3 -`),
    lead: notes(`0 - 4 7 - 6 4 -   0 - 4 7 9 - 7 -   5 - 9 7 - 5 4 -   4 6 - 8 6 - 4 -
                 7 - 11 14 - 13 11 -   9 - 11 13 11 - 9 -   12 - 9 7 5 - 7 -   8 6 4 - 1 - 0 -`),
  },
  abyss_dock: {
    title: 'Signals in the Blue', bpm: 116, mode: 'dorian', root: 130.813,
    loopSteps: 64, leadType: 'sine', bassType: 'sine', drive: 0.72, arp: true,
    voice: { cutoff: 3200, attack: 0.035, echo: 0.32 },
    chords: [[0,2,4,6], [3,5,7,9], [5,7,9,11], [4,6,8,10], [0,2,4,6], [2,4,6,8], [3,5,7,9], [4,6,8,10]],
    drums: drums('10000100 10001001 10000100 10001010 10000100 10001001 10000100 10001010',
      '10101011 10101010 10101011 10101110 10101011 10101010 10101011 10101111',
      '00000000 00000001 00000000 00000001 00000000 00000001 00000000 00000001'),
    bass: notes(`0 - - 4 - 0 - 4   3 - - 7 - 3 - 7   -2 - - 2 - 5 - 2   -3 - - 1 - 4 - 1
                 0 - - 4 - 7 - 4   2 - - 6 - 2 - 6   3 - - 7 - 3 - 7   4 - - 1 - -3 - -`),
    lead: notes(`7 - - 9 11 - 9 -   10 - 7 - - 5 7 -   9 - - 12 11 - 9 -   8 - 6 - 4 - - -
                 11 - - 14 13 - 11 -   13 - 11 - - 9 6 -   10 - - 7 5 - 7 -   8 - 6 4 - 2 0 -`),
  },
};
