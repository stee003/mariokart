// ============================================================================
// AudioManager - 100% procedurally synthesized original sounds (WebAudio).
// No audio files, no copyrighted material. One engine voice for the player
// plus one-shot effects.
//
// Mix policy: the engine is a CONTINUOUS drone, so it masks the music and the
// one-shot effects far more than its peak amplitude suggests. It therefore
// lives on its own bus (ENGINE_VOLUME_DEFAULT of full scale) and its envelope
// is tuned to sit *under* the music's loudest transient rather than over it.
// Players who want it louder can raise Settings -> Engine volume to 100 %,
// which still stays below the old always-on level.
// ============================================================================

// Default level of the dedicated engine bus (0..1).
export const ENGINE_VOLUME_DEFAULT = 0.6;

const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

export class AudioManager {
  constructor(saveManager) {
    this.save = saveManager;
    this.ctx = null;
    this.master = null;
    this.ready = false;
    this.volume = saveManager.get('volume', 0.8);
    this.engineVolume = clamp01(saveManager.get('engineVolume', ENGINE_VOLUME_DEFAULT));
    this.engine = null;
    this.driftNoise = null;
  }

  // Must be called from a user gesture (button click).
  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume * this.volume;
    this.master.connect(this.ctx.destination);

    this._noiseBuffer = this._makeNoise(1.5);
    this._buildEngine();
    this._buildDriftLoop();
    this.ready = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setVolume(v) {
    this.volume = v;
    this.save.set('volume', v);
    if (this.master) this.master.gain.value = v * v;
  }

  // Engine-only level. Persisted so a player who tunes the mix once keeps it.
  setEngineVolume(v) {
    this.engineVolume = clamp01(v);
    this.save.set('engineVolume', this.engineVolume);
    if (this.engine?.bus) {
      const t = this.ctx.currentTime;
      this.engine.bus.gain.setTargetAtTime(this.engineVolume, t, 0.05);
    }
    return this.engineVolume;
  }

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _buildEngine() {
    const ctx = this.ctx;
    // bus: the player-facing engine level, independent of the master volume
    const bus = ctx.createGain(); bus.gain.value = this.engineVolume;
    bus.connect(this.master);

    const gain = ctx.createGain(); gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 620; filter.Q.value = 0.9;
    const oscA = ctx.createOscillator(); oscA.type = 'sawtooth'; oscA.frequency.value = 60;
    const oscB = ctx.createOscillator(); oscB.type = 'square'; oscB.frequency.value = 30;
    const bGain = ctx.createGain(); bGain.gain.value = 0.4;
    oscA.connect(filter); oscB.connect(bGain); bGain.connect(filter);
    filter.connect(gain); gain.connect(bus);
    oscA.start(); oscB.start();
    this.engine = { gain, bus, filter, oscA, oscB };
  }

  // speedRatio 0..1+, throttle 0..1, boosting bool.
  // Amplitudes are deliberately small: this loop runs every frame of a race,
  // so it is mixed as a bed under the music rather than as a lead voice.
  // Peak envelope 0.070 (idle 0.018) x engine bus x master.
  updateEngine(speedRatio, throttle, boosting) {
    if (!this.ready || !this.engine) return;
    const e = this.engine;
    const t = this.ctx.currentTime;
    const rpm = 52 + Math.min(speedRatio, 1.35) * 135 + (boosting ? 42 : 0);
    e.oscA.frequency.setTargetAtTime(rpm, t, 0.06);
    e.oscB.frequency.setTargetAtTime(rpm * 0.5, t, 0.06);
    e.filter.frequency.setTargetAtTime(420 + Math.min(speedRatio, 1.35) * 620 + (boosting ? 380 : 0), t, 0.08);
    const load = Math.min(1, speedRatio);
    const vol = 0.018 + load * 0.028 + Math.min(1, throttle) * 0.024 + (boosting ? 0.012 : 0);
    e.gain.gain.setTargetAtTime(vol, t, 0.08);
  }

  stopEngine() {
    if (this.ready && this.engine) {
      this.engine.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    }
  }

  _buildDriftLoop() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 850; bp.Q.value = 0.9;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(bp); bp.connect(gain); gain.connect(this.master);
    src.start();
    this.driftNoise = { gain, bp };
  }

  setDrift(active, chargeLevel) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.driftNoise.gain.gain.setTargetAtTime(active ? 0.05 : 0, t, 0.05);
    this.driftNoise.bp.frequency.setTargetAtTime(700 + chargeLevel * 300, t, 0.1);
  }

  // ---- one-shots -----------------------------------------------------------
  _env(gainNode, t, peak, attack, decay) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.linearRampToValueAtTime(peak, t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _noiseBurst(opts) { this._noiseAt(this.ctx ? this.ctx.currentTime : 0, opts); }

  // Noise one-shot starting at an absolute ctx time. `f1` sweeps the filter,
  // which is how the whooshes (finish line, flag wipe) are made.
  _noiseAt(t, { peak = 0.2, attack = 0.005, decay = 0.2, freq = 800, f1 = null, type = 'lowpass', q = 1 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuffer;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(20, freq), t);
    if (f1 !== null) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, t, peak, attack, decay);
    src.start(t); src.stop(t + attack + decay + 0.05);
  }

  _tone(opts) { this._toneAt(this.ctx ? this.ctx.currentTime : 0, opts); }

  // Tonal one-shot at an absolute ctx time. Scheduling on the audio clock (not
  // setTimeout) keeps multi-note cues - the finish fanfare, the results
  // reveal - locked to the visuals even if the tab throttles timers.
  _toneAt(t, { type = 'square', f0 = 440, f1 = null, peak = 0.12, attack = 0.005, decay = 0.15 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + attack + decay);
    const g = ctx.createGain();
    o.connect(g); g.connect(this.master);
    this._env(g, t, peak, attack, decay);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }

  click()        { this._tone({ type: 'square', f0: 660, peak: 0.07, decay: 0.07 }); }
  countBeep(fin) { this._tone({ type: 'square', f0: fin ? 880 : 440, peak: 0.14, decay: fin ? 0.4 : 0.16 }); }
  boost(level = 1) {
    this._noiseBurst({ peak: 0.16, decay: 0.5, freq: 1600, type: 'highpass' });
    this._tone({ type: 'sawtooth', f0: 180 + level * 60, f1: 520 + level * 160, peak: 0.1, decay: 0.45 });
  }
  driftLevelUp(level) { this._tone({ type: 'square', f0: 360 + level * 190, peak: 0.1, decay: 0.09 }); }
  collision(strength = 1) {
    this._noiseBurst({ peak: Math.min(0.3, 0.12 * strength), decay: 0.18, freq: 420 });
    this._tone({ type: 'sine', f0: 130, f1: 42, peak: Math.min(0.25, 0.1 * strength), decay: 0.2 });
  }
  landing(fall)  { this._noiseBurst({ peak: Math.min(0.2, 0.04 + fall * 0.012), decay: 0.12, freq: 260 }); }
  pad()          { this._tone({ type: 'sawtooth', f0: 220, f1: 980, peak: 0.1, decay: 0.28 }); }
  trick()        {
    this._tone({ type: 'triangle', f0: 720, f1: 1440, peak: 0.1, decay: 0.2 });
    this._tone({ type: 'sine', f0: 1080, peak: 0.06, decay: 0.3 });
  }
  reset()        { this._tone({ type: 'sine', f0: 300, f1: 120, peak: 0.08, decay: 0.25 }); }

  // ---- menu / gamepad navigation (short, quiet: they repeat while held) ----
  uiMove()  { this._tone({ type: 'sine', f0: 540, peak: 0.035, decay: 0.05 }); }
  uiTick()  { this._tone({ type: 'square', f0: 900, peak: 0.028, decay: 0.035 }); }
  uiBack()  { this._tone({ type: 'sine', f0: 430, f1: 250, peak: 0.05, decay: 0.1 }); }

  // ---- power-up sounds (all synthesized, unique per item) -------------------
  // One cue per Sunforge item, plus `get` (box pickup) and `block` (a hit
  // absorbed by a Forge Ward). Every cue owns a distinct texture so a player
  // can identify what happened with their eyes on the road:
  //   attack   -> sharp, fast, rising (lance, wasps, fang, mortar)
  //   denial   -> heavy, low, metallic or gritty (slag, bulwark, thorns)
  //   mobility -> bright and poppy (flare, draft, skip)
  //   debuff   -> sour, wobbling, downward (blight, jinx, hex)
  //   defence  -> clean, bell-like, resonant (ward, bell, mirror, decoy)
  //   signature-> the only cue that builds a chord (sunforge heart)
  itemSound(id) {
    const t0 = this.ctx ? this.ctx.currentTime : 0;
    switch (id) {
      case 'get':
        this._tone({ type: 'triangle', f0: 620, f1: 940, peak: 0.09, decay: 0.12 });
        break;
      case 'block': {
        // a ward taking a hit: dull clunk, no ring, so it never sounds like a
        // successful attack
        this._tone({ type: 'square', f0: 300, f1: 120, peak: 0.1, decay: 0.12 });
        this._noiseBurst({ peak: 0.08, decay: 0.1, freq: 500, type: 'lowpass' });
        break;
      }

      // ---- attack ---------------------------------------------------------
      case 'lance':
        this._noiseBurst({ peak: 0.1, attack: 0.004, decay: 0.22, freq: 900, f1: 3200, type: 'bandpass', q: 1.6 });
        this._tone({ type: 'sawtooth', f0: 520, f1: 1250, peak: 0.1, decay: 0.2 });
        break;
      case 'pod':
        // insect cluster: a low buzz under a fast-filtered hiss
        this._tone({ type: 'square', f0: 240, f1: 170, peak: 0.075, decay: 0.28 });
        this._noiseBurst({ peak: 0.085, decay: 0.3, freq: 1500, f1: 2600, type: 'bandpass', q: 6 });
        break;
      case 'fang':
        this._tone({ type: 'sine', f0: 1750, f1: 2650, peak: 0.075, decay: 0.22 });
        this._tone({ type: 'triangle', f0: 880, f1: 1320, peak: 0.05, decay: 0.3 });
        break;
      case 'mortar':
        // thump of the launch, then the whistle of the shell going over
        this._toneAt(t0, { type: 'sine', f0: 170, f1: 70, peak: 0.12, decay: 0.18 });
        this._noiseAt(t0, { peak: 0.07, decay: 0.14, freq: 700, type: 'lowpass' });
        this._toneAt(t0 + 0.07, { type: 'triangle', f0: 620, f1: 1500, peak: 0.06, attack: 0.06, decay: 0.5 });
        break;

      // ---- denial ---------------------------------------------------------
      case 'slag':
        this._tone({ type: 'square', f0: 130, f1: 74, peak: 0.11, decay: 0.4 });
        this._noiseBurst({ peak: 0.06, decay: 0.45, freq: 320, type: 'lowpass', q: 1.2 });
        break;
      case 'bulwark':
        // brass gate slamming down
        this._tone({ type: 'square', f0: 390, f1: 190, peak: 0.12, decay: 0.3 });
        this._noiseBurst({ peak: 0.11, decay: 0.16, freq: 2800, type: 'bandpass', q: 2 });
        this._toneAt(t0 + 0.02, { type: 'sine', f0: 110, f1: 60, peak: 0.09, decay: 0.3 });
        break;
      case 'veil':
        // dry air, no pitch: you hear it, you cannot see through it
        this._noiseBurst({ peak: 0.075, attack: 0.08, decay: 0.6, freq: 900, f1: 380, type: 'lowpass', q: 0.8 });
        break;
      case 'scatter':
        // three thorns hitting the road
        for (let i = 0; i < 3; i++) {
          this._noiseAt(t0 + i * 0.055, { peak: 0.085, decay: 0.07, freq: 2600 + i * 500, type: 'highpass' });
          this._toneAt(t0 + i * 0.055, { type: 'square', f0: 700 + i * 180, peak: 0.045, decay: 0.06 });
        }
        break;

      // ---- mobility -------------------------------------------------------
      case 'flare':
        this._tone({ type: 'triangle', f0: 520, f1: 1450, peak: 0.11, decay: 0.24 });
        this._noiseBurst({ peak: 0.08, decay: 0.2, freq: 2200, type: 'highpass' });
        break;
      case 'draft':
        this._tone({ type: 'sawtooth', f0: 300, f1: 720, peak: 0.1, attack: 0.03, decay: 0.5 });
        this._noiseBurst({ peak: 0.05, attack: 0.05, decay: 0.5, freq: 1200, f1: 2400, type: 'bandpass', q: 1.2 });
        break;
      case 'glass':
        this._tone({ type: 'sine', f0: 1600, f1: 2450, peak: 0.07, attack: 0.05, decay: 0.55 });
        this._tone({ type: 'sine', f0: 2400, f1: 3200, peak: 0.03, attack: 0.08, decay: 0.45 });
        break;
      case 'skip':
        // springy hop
        this._tone({ type: 'sine', f0: 190, f1: 560, peak: 0.1, decay: 0.22 });
        this._noiseBurst({ peak: 0.06, decay: 0.12, freq: 1600, f1: 600, type: 'bandpass', q: 1 });
        break;

      // ---- debuff ---------------------------------------------------------
      case 'blight':
        // corrosion: gritty, downward, unpleasant on purpose
        this._tone({ type: 'sawtooth', f0: 230, f1: 88, peak: 0.1, decay: 0.45 });
        this._noiseBurst({ peak: 0.07, decay: 0.4, freq: 760, type: 'bandpass', q: 1.3 });
        break;
      case 'jinx':
        this._tone({ type: 'square', f0: 720, f1: 130, peak: 0.1, decay: 0.32 });
        this._toneAt(t0 + 0.03, { type: 'square', f0: 540, f1: 100, peak: 0.055, decay: 0.28 });
        break;
      case 'hex':
        // a cold two-note interval: the bubble hanging on somebody
        this._tone({ type: 'sine', f0: 1046, f1: 523, peak: 0.085, decay: 0.45 });
        this._toneAt(t0 + 0.04, { type: 'triangle', f0: 622, peak: 0.05, attack: 0.03, decay: 0.6 });
        break;

      // ---- defence --------------------------------------------------------
      case 'ward':
        this._tone({ type: 'triangle', f0: 400, f1: 820, peak: 0.095, decay: 0.26 });
        this._tone({ type: 'sine', f0: 1240, peak: 0.045, decay: 0.35 });
        break;
      case 'bell':
        // a real struck bell: fundamental plus two partials and a transient
        this._tone({ type: 'sine', f0: 880, peak: 0.1, decay: 0.9 });
        this._toneAt(t0, { type: 'sine', f0: 1762, peak: 0.045, decay: 0.6 });
        this._toneAt(t0, { type: 'sine', f0: 2640, peak: 0.022, decay: 0.34 });
        this._noiseAt(t0, { peak: 0.05, decay: 0.06, freq: 4200, type: 'highpass' });
        this._toneAt(t0 + 0.06, { type: 'triangle', f0: 660, peak: 0.04, attack: 0.02, decay: 0.7 });
        break;
      case 'decoy':
        // heat haze: a soft warble that never quite settles
        this._tone({ type: 'sine', f0: 900, f1: 1320, peak: 0.07, attack: 0.04, decay: 0.4 });
        this._noiseBurst({ peak: 0.04, attack: 0.06, decay: 0.45, freq: 2000, type: 'bandpass', q: 5 });
        break;
      case 'storm':
        this._noiseBurst({ peak: 0.11, decay: 0.26, freq: 3400, type: 'highpass' });
        this._tone({ type: 'square', f0: 250, f1: 620, peak: 0.085, decay: 0.22 });
        break;
      case 'mirror':
        // the cue plays forwards and back: the reflection is the item
        this._tone({ type: 'sine', f0: 520, f1: 1900, peak: 0.08, attack: 0.02, decay: 0.22 });
        this._toneAt(t0 + 0.2, { type: 'sine', f0: 1900, f1: 520, peak: 0.07, decay: 0.3 });
        break;

      // ---- gamble ---------------------------------------------------------
      case 'dice':
        // a clatter of brass, then the result
        for (let i = 0; i < 4; i++) {
          this._noiseAt(t0 + i * 0.045, { peak: 0.075, decay: 0.06, freq: 1800 + i * 700, type: 'highpass' });
        }
        this._toneAt(t0 + 0.2, { type: 'triangle', f0: 700, f1: 1050, peak: 0.085, decay: 0.25 });
        break;
      case 'heart':
        // the signature: the only item cue that stacks into a chord and swells
        this._noiseAt(t0, { peak: 0.09, attack: 0.06, decay: 0.8, freq: 700, f1: 3000, type: 'bandpass', q: 0.9 });
        this._toneAt(t0, { type: 'sawtooth', f0: 196, f1: 784, peak: 0.1, attack: 0.05, decay: 0.75 });
        this._toneAt(t0 + 0.05, { type: 'triangle', f0: 392, f1: 1176, peak: 0.07, attack: 0.06, decay: 0.7 });
        this._toneAt(t0 + 0.1, { type: 'sine', f0: 587, f1: 1568, peak: 0.05, attack: 0.08, decay: 0.8 });
        break;

      default:
        this._tone({ type: 'square', f0: 600, peak: 0.08, decay: 0.15 });
        break;
    }
  }
  // ---- finish sequence ----------------------------------------------------
  // Crossing the line. Three layers, all on the audio clock:
  //   1. a downward-swept noise whoosh  - the flag whipping past the camera
  //   2. a low thump                    - the moment of crossing
  //   3. a placing-dependent fanfare    - the celebration
  // Peaks stay under the music's own transient so the victory sting never
  // fights the victory music layer.
  finishLine(pos = 1) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime;
    this._noiseAt(t0, { peak: 0.13, attack: 0.02, decay: 0.55, freq: 2800, f1: 300, type: 'bandpass', q: 1.1 });
    this._toneAt(t0 + 0.05, { type: 'sine', f0: 196, f1: 56, peak: 0.16, decay: 0.45 });
    this._noiseAt(t0 + 0.05, { peak: 0.06, attack: 0.004, decay: 0.14, freq: 1800, type: 'highpass' });

    // Fanfare: win = full four-note rise plus a held chord; podium = three
    // notes; outside the podium a gentler two-note resolve (never a jeer).
    const win = pos === 1, podium = pos <= 3;
    const arp = win ? [523.25, 659.25, 783.99, 1046.5]
      : podium ? [440, 554.37, 659.25]
      : [392, 493.88];
    const step = win ? 0.115 : 0.13;
    arp.forEach((f, i) => {
      const t = t0 + 0.16 + i * step;
      this._toneAt(t, { type: 'triangle', f0: f, peak: 0.11, attack: 0.008, decay: 0.34 });
      this._toneAt(t, { type: 'sawtooth', f0: f / 2, peak: 0.035, attack: 0.01, decay: 0.22 });
    });
    if (win) {
      // held C major with a shimmering octave on top
      const t = t0 + 0.16 + arp.length * step;
      [[523.25, 0.075], [659.25, 0.06], [783.99, 0.055], [1046.5, 0.035]].forEach(([f, pk]) => {
        this._toneAt(t, { type: 'sine', f0: f, peak: pk, attack: 0.03, decay: 1.1 });
      });
      this._toneAt(t + 0.02, { type: 'triangle', f0: 2093, f1: 2637, peak: 0.025, attack: 0.06, decay: 0.7 });
    }
  }

  // Legacy two-state cue, kept for anything still calling it.
  finish(win) { this.finishLine(win ? 1 : 5); }

  // Bell struck as the results medal drops in (rank 1 rings brightest/highest).
  podiumChime(rank = 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const base = rank === 1 ? 1046.5 : rank === 2 ? 880 : rank === 3 ? 783.99 : 659.25;
    this._toneAt(t, { type: 'sine', f0: base, peak: 0.1, attack: 0.006, decay: 0.9 });
    this._toneAt(t, { type: 'sine', f0: base * 2.01, peak: 0.035, attack: 0.006, decay: 0.5 });
    this._toneAt(t + 0.05, { type: 'triangle', f0: base * 1.5, peak: 0.04, attack: 0.01, decay: 0.6 });
    this._noiseAt(t, { peak: 0.03, attack: 0.002, decay: 0.08, freq: 5200, type: 'highpass' });
  }

  // One quiet tick per revealed results row; pitch climbs with the row so a
  // ladder of positions reads as rising even before the text is legible.
  resultsTick(index = 0, total = 8) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const k = total > 1 ? index / (total - 1) : 0;
    this._toneAt(t, { type: 'square', f0: 620 + k * 420, peak: 0.045, attack: 0.003, decay: 0.07 });
    this._noiseAt(t, { peak: 0.018, attack: 0.002, decay: 0.05, freq: 2600 + k * 1600, type: 'highpass' });
  }

  // Soft two-note "locked in" once the last row and the stats have landed.
  resultsLock(win = false) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const a = win ? 783.99 : 587.33, b = win ? 1174.66 : 783.99;
    this._toneAt(t, { type: 'triangle', f0: a, peak: 0.07, attack: 0.008, decay: 0.24 });
    this._toneAt(t + 0.1, { type: 'triangle', f0: b, peak: 0.07, attack: 0.008, decay: 0.4 });
  }
}
