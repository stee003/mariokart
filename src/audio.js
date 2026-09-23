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
  finish(win) {
    if (!this.ready) return;
    const notes = win ? [523, 659, 784, 1046] : [392, 494, 587];
    notes.forEach((f, i) => setTimeout(() => this._tone({ type: 'triangle', f0: f, peak: 0.12, decay: 0.3 }), i * 130));
  }
}
