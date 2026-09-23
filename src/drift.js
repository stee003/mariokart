// ============================================================================
// DriftSystem - state machine for initiating, holding, charging and
// releasing drifts. Physics effects are applied by VehicleController.
// ============================================================================

import { CONFIG } from './config.js';

const D = CONFIG.drift;

export const DRIFT_COLORS = [0xcfd6df, 0x3fd2d8, 0xffb830, 0xff5df1];

export class DriftSystem {
  // Optional per-kart mods {chargeRate, gripMult, steerMult} from loadouts.
  constructor(mods = null) {
    this.mods = mods;
    this.state = 'idle';      // idle | drifting
    this.dir = 1;             // locked drift direction
    this.charge = 0;          // accumulated boost charge
    this.level = 0;           // 0..3 (0 = not charged enough for any boost)
    this.time = 0;
  }

  get drifting() { return this.state === 'drifting'; }

  chargeFraction() {
    const max = D.levels[2];
    return Math.min(1, this.charge / max);
  }

  // events: started / ended(level, boosted) / levelChanged
  update(dt, { steer, speed, grounded, driftHeld, brake, airTime = 0 }) {
    const ev = {};

    if (this.state === 'idle') {
      if (driftHeld && grounded && Math.abs(steer) >= D.steerThreshold && speed >= D.minSpeed) {
        this.state = 'drifting';
        this.dir = Math.sign(steer) || 1;
        this.charge = 0;
        this.level = 0;
        this.time = 0;
        ev.started = true;
        ev.hop = D.hopImpulse;
      }
      return ev;
    }

    // drifting --------------------------------------------------------------
    this.time += dt;
    let ended = false, boosted = false;

    if (!driftHeld) { ended = true; boosted = this.level > 0; }
    else if (brake) { ended = true; boosted = false; this.charge = 0; } // deliberate cancel
    else if (speed < D.exitSpeedFloor || (!grounded && airTime > 0.6)) {
      // too slow, or genuinely airborne (the initial drift hop lasts ~0.5s)
      ended = true; boosted = false; this.charge = 0;
    }

    if (ended) {
      const lvl = this.level;
      this.state = 'idle';
      this.charge = 0;
      this.level = 0;
      ev.ended = { level: lvl, boosted };
      return ev;
    }

    this.charge += (this.mods?.chargeRate ?? D.chargeRate) * dt;
    let newLevel = 0;
    for (let i = 0; i < D.levels.length; i++) if (this.charge >= D.levels[i]) newLevel = i + 1;
    if (newLevel !== this.level) {
      this.level = newLevel;
      ev.levelChanged = newLevel;
    }
    return ev;
  }

  cancel() {
    this.state = 'idle';
    this.charge = 0;
    this.level = 0;
  }
}
