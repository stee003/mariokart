// ============================================================================
// AudioManager - 100% procedurally synthesized original sounds (WebAudio).
// No audio files, no copyrighted material. One engine voice for the player
// plus one-shot effects.
// ============================================================================

export class AudioManager {
  constructor(saveManager) {
    this.save = saveManager;
    this.ctx = null;
    this.master = null;
    this.ready = false;
    this.volume = saveManager.get('volume', 0.8);
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

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _buildEngine() {
    const ctx = this.ctx;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 750; filter.Q.value = 1.2;
    const oscA = ctx.createOscillator(); oscA.type = 'sawtooth'; oscA.frequency.value = 60;
    const oscB = ctx.createOscillator(); oscB.type = 'square'; oscB.frequency.value = 30;
    const bGain = ctx.createGain(); bGain.gain.value = 0.45;
    oscA.connect(filter); oscB.connect(bGain); bGain.connect(filter);
    filter.connect(gain); gain.connect(this.master);
    oscA.start(); oscB.start();
    this.engine = { gain, filter, oscA, oscB };
  }

  // speedRatio 0..1+, throttle 0..1, boosting bool
  updateEngine(speedRatio, throttle, boosting) {
    if (!this.ready || !this.engine) return;
    const e = this.engine;
    const t = this.ctx.currentTime;
    const rpm = 52 + Math.min(speedRatio, 1.35) * 135 + (boosting ? 42 : 0);
    e.oscA.frequency.setTargetAtTime(rpm, t, 0.06);
    e.oscB.frequency.setTargetAtTime(rpm * 0.5, t, 0.06);
    e.filter.frequency.setTargetAtTime(520 + speedRatio * 900 + (boosting ? 500 : 0), t, 0.08);
    const vol = 0.035 + Math.min(1, speedRatio) * 0.05 + throttle * 0.045 + (boosting ? 0.03 : 0);
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

  _noiseBurst({ peak = 0.2, attack = 0.005, decay = 0.2, freq = 800, type = 'lowpass', q = 1 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuffer;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, t, peak, attack, decay);
    src.start(t); src.stop(t + attack + decay + 0.05);
  }

  _tone({ type = 'square', f0 = 440, f1 = null, peak = 0.12, attack = 0.005, decay = 0.15 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
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

  // ---- power-up sounds (all synthesized, unique per item) -------------------
  itemSound(id) {
    switch (id) {
      case 'get':       this._tone({ type: 'triangle', f0: 620, f1: 940, peak: 0.09, decay: 0.12 }); break;
      case 'roulette':  this._tone({ type: 'square', f0: 480, peak: 0.05, decay: 0.05 }); break;
      case 'flux':      this._tone({ type: 'sawtooth', f0: 900, f1: 220, peak: 0.12, decay: 0.3 }); break;
      case 'anchor':    this._tone({ type: 'sine', f0: 420, f1: 90, peak: 0.13, decay: 0.4 }); break;
      case 'mirage':    this._tone({ type: 'sine', f0: 700, f1: 1400, peak: 0.08, decay: 0.35 }); break;
      case 'pulse':     this._noiseBurst({ peak: 0.12, decay: 0.35, freq: 2400, type: 'bandpass', q: 2 });
                        this._tone({ type: 'sine', f0: 880, f1: 440, peak: 0.09, decay: 0.3 }); break;
      case 'overdrive': this._tone({ type: 'sawtooth', f0: 200, f1: 720, peak: 0.13, decay: 0.4 }); break;
      case 'vortex':    this._tone({ type: 'square', f0: 300, f1: 60, peak: 0.14, decay: 0.45 }); break;
      case 'phase':     this._tone({ type: 'sine', f0: 1200, f1: 1800, peak: 0.07, decay: 0.3 }); break;
      case 'ripple':    this._tone({ type: 'sine', f0: 500, f1: 250, peak: 0.1, decay: 0.5 }); break;
      case 'magnet':    this._tone({ type: 'square', f0: 240, f1: 480, peak: 0.1, decay: 0.25 }); break;
      case 'repair':    this._tone({ type: 'triangle', f0: 520, f1: 780, peak: 0.09, decay: 0.28 }); break;
      case 'snare':     this._noiseBurst({ peak: 0.12, decay: 0.2, freq: 900, type: 'bandpass', q: 1.5 }); break;
      case 'prism':     this._tone({ type: 'triangle', f0: 1500, f1: 900, peak: 0.08, decay: 0.3 }); break;
      case 'harpoon':   this._tone({ type: 'sawtooth', f0: 500, f1: 1100, peak: 0.11, decay: 0.22 }); break;
      case 'bloom':     this._tone({ type: 'square', f0: 660, f1: 330, peak: 0.1, decay: 0.3 }); break;
      case 'chrono':    this._tone({ type: 'sine', f0: 1046, f1: 523, peak: 0.09, decay: 0.4 }); break;
      case 'lash':      this._noiseBurst({ peak: 0.14, decay: 0.16, freq: 3200, type: 'highpass' }); break;
      case 'beacon':    this._tone({ type: 'square', f0: 880, peak: 0.08, decay: 0.15 }); break;
      case 'well':      this._tone({ type: 'sine', f0: 180, f1: 60, peak: 0.13, decay: 0.5 }); break;
      case 'tempest':   this._noiseBurst({ peak: 0.13, decay: 0.3, freq: 1800, type: 'bandpass', q: 3 }); break;
      case 'swarm':     this._noiseBurst({ peak: 0.07, decay: 0.4, freq: 1400, type: 'bandpass', q: 4 }); break;
      case 'aurora':    this._tone({ type: 'sine', f0: 760, f1: 1520, peak: 0.07, decay: 0.45 }); break;
      case 'siphon':    this._tone({ type: 'sawtooth', f0: 700, f1: 140, peak: 0.11, decay: 0.4 }); break;
      default:          this._tone({ type: 'square', f0: 600, peak: 0.08, decay: 0.15 }); break;
    }
  }
  finish(win) {
    if (!this.ready) return;
    const notes = win ? [523, 659, 784, 1046] : [392, 494, 587];
    notes.forEach((f, i) => setTimeout(() => this._tone({ type: 'triangle', f0: f, peak: 0.12, decay: 0.3 }), i * 130));
  }

  // ---- character vocalizations ----------------------------------------------
  // Every pilot carries a voice profile ({pitch, rasp, chattiness}); these are
  // wordless synthesized reactions (whoops, grunts, cheers) built from a
  // pitch-swept formant pair plus a breath layer. `distance` (metres) fades
  // rival reactions so a busy grid does not turn into noise.
  vocalize(profile, kind = 'greet', { distance = 0 } = {}) {
    if (!this.ready || !profile) return;
    const now = this.ctx.currentTime;
    const cool = VOCAL_COOLDOWN[kind] ?? 0.35;
    this._vocalT = this._vocalT || {};
    if ((this._vocalT[kind] || -99) + cool > now) return;
    this._vocalT[kind] = now;

    const atten = distance > 0 ? Math.max(0, 1 - distance / 55) : 1;
    if (atten <= 0.02) return;
    const chat = profile.chattiness ?? 0.6;
    if (distance > 0 && Math.random() > chat * atten) return;

    const base = (profile.pitch ?? 400) * (VOICE_SHAPE[kind]?.pitch ?? 1);
    const bend = VOICE_SHAPE[kind]?.bend ?? 1.25;
    const dur = VOICE_SHAPE[kind]?.dur ?? 0.22;
    const rasp = Math.max(0, Math.min(1, profile.rasp ?? 0.2)) * (VOICE_SHAPE[kind]?.rasp ?? 1);
    const peak = Math.min(0.16, (VOICE_SHAPE[kind]?.peak ?? 0.09) * atten * (0.75 + chat * 0.35));

    const g = this.ctx.createGain();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = base * 1.6;
    hp.Q.value = 1.1 + rasp * 3.5;
    g.connect(hp);
    hp.connect(this.master);

    // two detuned voices = a creature rather than a beep
    for (const [mul, type, mix] of [[1, 'sawtooth', 1], [1.5, 'triangle', 0.5], [2.02, 'sine', 0.28]]) {
      const o = this.ctx.createOscillator();
      o.type = type;
      const f0 = base * mul;
      o.frequency.setValueAtTime(f0, now);
      o.frequency.exponentialRampToValueAtTime(Math.max(40, f0 * bend), now + dur);
      const vg = this.ctx.createGain();
      vg.gain.value = mix;
      o.connect(vg);
      vg.connect(g);
      o.start(now);
      o.stop(now + dur + 0.05);
    }

    // breath / rasp layer scaled by the pilot's voice profile
    if (rasp > 0.05 && this._noiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      const nf = this.ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = base * (kind === 'hit' ? 1.1 : 2.2);
      nf.Q.value = 1.2;
      const ng = this.ctx.createGain();
      ng.gain.value = 0.6 * rasp;
      src.connect(nf); nf.connect(ng); ng.connect(g);
      src.start(now);
      src.stop(now + dur + 0.05);
    }

    this._env(g, now, peak, 0.02, dur);
  }
}

// Wordless reaction shapes: relative pitch, pitch bend, length, rasp and
// loudness per emotional beat.
const VOICE_SHAPE = {
  greet:    { pitch: 1.00, bend: 1.35, dur: 0.20, peak: 0.07, rasp: 0.6 },
  start:    { pitch: 1.05, bend: 1.55, dur: 0.34, peak: 0.11, rasp: 0.8 },
  boost:    { pitch: 1.25, bend: 1.70, dur: 0.26, peak: 0.10, rasp: 1.0 },
  hype:     { pitch: 1.15, bend: 1.85, dur: 0.40, peak: 0.12, rasp: 1.1 },
  hit:      { pitch: 0.72, bend: 0.55, dur: 0.30, peak: 0.13, rasp: 1.4 },
  overtake: { pitch: 1.10, bend: 1.45, dur: 0.24, peak: 0.09, rasp: 0.9 },
  win:      { pitch: 1.30, bend: 2.10, dur: 0.55, peak: 0.13, rasp: 0.9 },
  lose:     { pitch: 0.80, bend: 0.62, dur: 0.50, peak: 0.10, rasp: 1.2 },
};

const VOCAL_COOLDOWN = {
  greet: 0.5, start: 1.2, boost: 1.4, hype: 2.5, hit: 0.45, overtake: 1.2, win: 3, lose: 3,
};
