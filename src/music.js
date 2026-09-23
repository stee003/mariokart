// ============================================================================
// MusicManager - 100% procedural, dynamic original soundtrack.
//
// Every track theme gets its own generated identity from (musicSeed, theme):
// scale root + mode, tempo, bass pattern and lead motif - deterministic per
// seed so a track always sounds like itself.
//
// Dynamic states with crossfading:
//   menu | countdown | racing | finalLap | battle | victory | defeat
// Countdown adds a tension riser, final lap lifts tempo + adds an octave
// layer, victory/defeat play one-shot stingers over a soft bed.
// No audio assets - pure WebAudio scheduling.
// ============================================================================

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixo: [0, 2, 4, 5, 7, 9, 10],
  penta: [0, 3, 5, 7, 10],
};

const THEME_MODES = {
  desert: 'mixo', forest: 'major', city: 'minor', mountain: 'dorian',
  volcano: 'minor', underwater: 'dorian', factory: 'mixo', islands: 'major',
  ruins: 'dorian', storm: 'minor', crystal: 'penta', space: 'penta',
};

function seeded(seed) {
  let s = Math.max(1, Math.floor(seed));
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// Pure-data pattern generation (tested headless).
export function buildTheme(musicSeed, theme) {
  const rnd = seeded(musicSeed * 7919 + 17);
  const mode = THEME_MODES[theme] || 'major';
  const scale = SCALES[mode];
  const root = 110 * Math.pow(2, Math.floor(rnd() * 12) / 12); // ~110..220 Hz
  const tempo = 108 + Math.floor(rnd() * 44);                  // 108..152 BPM
  const bass = [];
  for (let i = 0; i < 8; i++) {
    bass.push(rnd() < 0.72 ? scale[Math.floor(rnd() * 3)] + (rnd() < 0.2 ? -12 : 0) : null);
  }
  const lead = [];
  for (let i = 0; i < 16; i++) {
    lead.push(rnd() < 0.55 ? scale[Math.floor(rnd() * scale.length)] + (rnd() < 0.3 ? 12 : 0) : null);
  }
  const drive = theme === 'city' || theme === 'volcano' || theme === 'storm' ? 1 :
    theme === 'forest' || theme === 'underwater' ? 0.5 : 0.75;
  return { mode, root, tempo, bass, lead, drive, theme };
}

// ----------------------------------------------------------------------------
// Rich theme specs.
//
// A handful of flagship tracks ship a hand-arranged soundtrack instead of a
// seeded pattern. The spec (def.music in trackDefs.js) is a 4-bar loop on an
// 8th-note grid (32 steps; steps 0-7 = bar 1, 8-15 = bar 2, ...):
//
//   bpm, mode, root        - clock + scale + bass-octave reference (Hz)
//   chords                 - 4 chords, one per bar, as scale degrees
//   drums {kick,snare,hat,open} - 32 boolean step patterns
//   bass, lead             - 32 scale degrees or null (rests)
//   leadType, bassType     - oscillator waveforms
//   drive                  - 0..1.2 master energy (drums + layer loudness)
//   arp                    - weave 8th-note chord arpeggio between lead notes
//
// Everything is deterministic: a track always plays the same arrangement.
// Tracks WITHOUT a rich spec keep going through buildTheme() unchanged.
// ----------------------------------------------------------------------------
function buildRichTheme(spec) {
  return {
    rich: true,
    theme: spec.theme,
    mode: spec.mode,
    root: spec.root,
    tempo: spec.bpm,
    bass: spec.bass,
    lead: spec.lead,
    chords: spec.chords,
    drums: spec.drums,
    leadType: spec.leadType || 'square',
    bassType: spec.bassType || 'sawtooth',
    drive: spec.drive ?? 1,
    arp: !!spec.arp,
  };
}

export class MusicManager {
  constructor(saveManager) {
    this.save = saveManager;
    this.ctx = null;
    this.ready = false;
    this.state = 'menu';
    this.theme = buildTheme(11, 'desert');
    this.volume = saveManager.get('musicVolume', 0.55);
    this._timer = null;
    this._step = 0;
    this._nextNoteTime = 0;
    this._layerGains = {};
    this._tempoMult = 1;
  }

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume * this.volume;
    this.master.connect(this.ctx.destination);
    this._noise = this._makeNoise();
    this.ready = true;
    this._startScheduler();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setVolume(v) {
    this.volume = v;
    this.save.set('musicVolume', v);
    if (this.master) this.master.gain.setTargetAtTime(v * v, this.ctx.currentTime, 0.1);
  }

  // `richSpec` (def.music) opts the track into the hand-arranged engine;
  // without it the seeded generator is used, exactly as before.
  setTheme(musicSeed, theme, richSpec = null) {
    this.theme = richSpec
      ? buildRichTheme({ ...richSpec, theme })
      : buildTheme(musicSeed, theme);
  }

  setState(state) {
    if (state === this.state) return;
    this.state = state;
    if (state === 'finalLap') this._tempoMult = 1.12;
    else if (state === 'countdown') this._tempoMult = 0.9;
    else this._tempoMult = 1;
    if (state === 'victory') this._stinger([523, 659, 784, 1046, 1318], 0.16);
    if (state === 'defeat') this._stinger([392, 370, 311, 233], 0.22);
  }

  stop() {
    this.state = 'off';
  }

  // ------------------------------------------------------------------ engine
  _makeNoise() {
    const len = Math.floor(this.ctx.sampleRate * 1.2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _startScheduler() {
    this._nextNoteTime = this.ctx.currentTime + 0.1;
    this._timer = setInterval(() => this._schedule(), 60);
  }

  _schedule() {
    if (!this.ctx || this.state === 'off') return;
    const spb = 60 / (this.theme.tempo * this._tempoMult) / 2;  // 8th notes
    while (this._nextNoteTime < this.ctx.currentTime + 0.22) {
      this._playStep(this._step, this._nextNoteTime, spb);
      this._nextNoteTime += spb;
      this._step = (this._step + 1) % 16;
    }
  }

  _tone(f, t, dur, type, peak, dest) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _hat(t, peak, open = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 6500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.14 : 0.035));
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.2);
  }

  _kick(t, peak) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.2);
  }

  _snare(t, peak) {
    // noise crack + short body thump, bandpassed for a dry snare
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.18);
    const o = this.ctx.createOscillator();
    o.type = 'triangle'; o.frequency.value = 190;
    const g2 = this.ctx.createGain();
    g2.gain.setValueAtTime(peak * 0.7, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g2); g2.connect(this.master);
    o.start(t); o.stop(t + 0.08);
  }

  // Map a scale-degree index to semitones above the root (wraps octaves).
  _scaleSemis(d) {
    const sc = SCALES[this.theme.mode] || SCALES.major;
    const n = sc.length;
    const i = ((d % n) + n) % n;
    return sc[i] + 12 * Math.floor(d / n);
  }

  // ----------------------------------------------------------- rich engine
  // Plays the hand-arranged 4-bar loop. Same states as the generator path:
  // menu = pad bed, racing = full arrangement, finalLap = +12% tempo and an
  // octave lead layer, countdown = riser, victory/defeat = stinger + bed.
  _playStepRich(step, t, spb) {
    const th = this.theme;
    const s = this.state;
    const racing = s === 'racing' || s === 'finalLap' || s === 'battle';
    const calm = s === 'menu' || s === 'victory' || s === 'defeat' || s === 'countdown';
    const drive = (s === 'countdown') ? th.drive * 0.55
      : calm ? 0.38 : th.drive;
    const bar = Math.floor(step / 8) % 4;
    const chord = th.chords[bar] || [0, 2, 4];
    const freq = (base, d) => base * Math.pow(2, this._scaleSemis(d) / 12);

    // drums ---------------------------------------------------------------
    if (racing) {
      const d = th.drums;
      if (d.kick[step]) this._kick(t, 0.2 * drive);
      if (d.snare[step]) this._snare(t, 0.085 * drive);
      if (d.hat[step]) this._hat(t, (step % 2 === 0 ? 0.038 : 0.022) * drive);
      if (d.open[step]) this._hat(t, 0.05 * drive, true);
    } else if (s === 'countdown') {
      // ticking pulse under the riser
      if (step % 2 === 0) this._hat(t, 0.03 * drive, step === 14 || step === 30);
    }

    // sustained pad chord, one per bar ------------------------------------
    if (step % 8 === 0) {
      const padDur = spb * 7.6;
      const padGain = calm ? 0.02 : 0.026 * drive;
      for (const d of chord) {
        this._tone(freq(th.root, d), t, padDur, 'triangle', padGain);
        this._tone(freq(th.root * 2, d), t, padDur, 'sine', padGain * 0.5);
      }
    }

    // 8th-note arp weaving the chord (racing only) -------------------------
    if (th.arp && racing && step % 2 === 1) {
      const idx = [0, 1, 2, 1][Math.floor(step / 2) % 4];
      this._tone(freq(th.root * 2, chord[idx % chord.length]), t, spb * 0.9, 'triangle', 0.02 * drive);
    }

    // bass -------------------------------------------------------------------
    const bd = th.bass[step];
    if (bd !== null && (racing || calm || s === 'countdown')) {
      const f = freq(th.root, bd);
      this._tone(f, t, spb * 1.9, th.bassType, 0.075 * (calm ? 0.6 : 1) * (s === 'countdown' ? 0.8 : 1));
      if (racing && th.drums.kick[step]) this._tone(f * 0.5, t, spb * 1.9, 'triangle', 0.05 * drive);
    }

    // lead motif -------------------------------------------------------------
    const ld = th.lead[step];
    if (ld !== null) {
      const play = racing || (calm && step % 4 === 0) || s === 'countdown';
      if (play) {
        const f = freq(th.root * 2, ld);
        const gain = (calm || s === 'countdown') ? 0.035 : 0.05;
        this._tone(f, t, spb * (s === 'finalLap' ? 1.5 : 1.05), th.leadType, gain * (s === 'countdown' ? 0.6 : 1));
        if (s === 'finalLap') this._tone(f * 2, t, spb * 0.8, 'triangle', 0.018);
      }
    }

    // countdown tension riser ------------------------------------------------
    if (s === 'countdown' && step % 2 === 0) {
      this._tone(th.root * 2 * Math.pow(2, step / 16), t, spb * 0.9, 'sine', 0.045);
    }
  }

  _playStep(step, t, spb) {
    if (this.theme.rich) { this._playStepRich(step, t, spb); return; }
    const th = this.theme;
    const s = this.state;
    const racing = s === 'racing' || s === 'finalLap' || s === 'battle' || s === 'countdown';
    const calm = s === 'menu' || s === 'victory' || s === 'defeat';
    const drive = calm ? 0.35 : th.drive;

    // drums
    if (racing) {
      if (step % 4 === 0) this._kick(t, 0.16 * drive);
      if (step % 4 === 2 && s === 'battle') this._kick(t, 0.12);
      this._hat(t, (step % 2 === 0 ? 0.05 : 0.03) * drive, step === 14);
    } else if (s === 'menu') {
      if (step === 0) this._kick(t, 0.07);
      if (step % 4 === 2) this._hat(t, 0.02);
    }

    // bass (steps 0..7 doubled)
    const bassStep = step % 8;
    const bd = th.bass[bassStep];
    if (bd !== null && (racing || step % 2 === 0)) {
      const f = th.root * Math.pow(2, bd / 12);
      this._tone(f, t, spb * 1.7, 'sawtooth', 0.085 * (calm ? 0.5 : 1));
      if (racing) this._tone(f * 0.5, t, spb * 1.7, 'triangle', 0.06);
    }

    // lead motif
    const ld = th.lead[step];
    if (ld !== null) {
      const play = racing || (calm && step % 4 === 0);
      if (play) {
        const f = th.root * 2 * Math.pow(2, ld / 12);
        this._tone(f, t, spb * (s === 'finalLap' ? 1.4 : 1.0), calm ? 'sine' : 'square',
          (calm ? 0.045 : 0.05) * (s === 'finalLap' ? 1.2 : 1));
        if (s === 'finalLap') this._tone(f * 2, t, spb * 0.8, 'triangle', 0.02);
      }
    }

    // countdown tension riser
    if (s === 'countdown' && step % 2 === 0) {
      this._tone(th.root * 4 * Math.pow(2, step / 16), t, spb * 0.9, 'sine', 0.04);
    }
  }

  _stinger(notes, gap) {
    if (!this.ready) return;
    notes.forEach((f, i) => {
      setTimeout(() => this._tone(f, this.ctx.currentTime, 0.5, 'triangle', 0.12), i * gap * 1000);
    });
  }

  dispose() {
    if (this._timer) clearInterval(this._timer);
  }
}
