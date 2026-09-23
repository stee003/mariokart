// ============================================================================
// BoostSystem - manages active boost effects (drift boosts, pads, tricks,
// rocket starts). Provides speed/acceleration multipliers to the vehicle.
// ============================================================================

import { CONFIG } from './config.js';

export class BoostSystem {
  constructor(onBoost = null) {
    this.onBoost = onBoost;            // callback(level, source)
    this.active = null;                // {timeLeft, duration, speedMult, accelMult, level}
    this.padCooldown = 0;
  }

  get boosting() { return this.active !== null; }

  // level: 0..2 drift levels; source: 'drift' | 'pad' | 'trick' | 'start'
  trigger(level, source) {
    const spec = source === 'pad' ? CONFIG.boost.pad
      : source === 'trick' ? CONFIG.air.trickBoost
      : source === 'start' ? CONFIG.race.startBoost
      : CONFIG.boost.levels[Math.min(level, CONFIG.boost.levels.length - 1)];
    if (!spec) return;
    const next = {
      timeLeft: spec.duration, duration: spec.duration,
      speedMult: spec.speedMult, accelMult: spec.accelMult,
      level, source,
    };
    // stronger boost wins; equal-or-stronger refreshes
    if (this.active && this.active.speedMult > next.speedMult && this.active.timeLeft > 0.25) return;
    this.active = next;
    if (this.onBoost) this.onBoost(level, source);
  }

  pad() {
    if (this.padCooldown > 0) return;
    this.padCooldown = CONFIG.boost.pad.cooldown;
    this.trigger(1, 'pad');
  }

  update(dt) {
    this.padCooldown = Math.max(0, this.padCooldown - dt);
    if (!this.active) return { active: false, speedMult: 1, accelMult: 1, t: 0 };
    this.active.timeLeft -= dt;
    if (this.active.timeLeft <= 0) {
      this.active = null;
      return { active: false, speedMult: 1, accelMult: 1, t: 0 };
    }
    const a = this.active;
    return {
      active: true,
      speedMult: a.speedMult,
      accelMult: a.accelMult,
      t: 1 - a.timeLeft / a.duration,
      level: a.level, source: a.source,
    };
  }

  cancel() { this.active = null; }
}
