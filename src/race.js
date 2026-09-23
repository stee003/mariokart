// ============================================================================
// RaceManager - race state machine (countdown → racing → finished → results),
// checkpoint/lap/position tracking, kart-vs-kart and obstacle collisions,
// wrong-way detection, rocket starts and race restarts.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { CONFIG } from './config.js';
import { normalizeAngle } from './vehicle.js';

const R = CONFIG.race;

export class RaceManager {
  constructor({ track, hud, audio, i18n, onEvent, items = null }) {
    this.track = track;
    this.hud = hud;
    this.audio = audio;
    this.i18n = i18n;
    this.onEvent = onEvent;               // fx hook: (type, payload)
    this.items = items;                   // optional ItemSystem (power-ups)
    this.itemsEnabled = !!items;

    this.karts = [];                      // {vehicle, ai, nameKey, isPlayer, color}
    this.kartState = new Map();           // per-kart race data
    this.state = 'idle';                  // idle | countdown | racing | finished | results
    this.countdownT = R.countdownTime;
    this.raceTime = 0;
    this.timeScale = 1;
    this.playerArmed = false;
    this.playerInput = { throttle: 0, brake: 0, steer: 0, drift: false, trick: false };
    this.lastCountInt = -1;
    this.finishTimer = 0;
    this.wrongWayTimer = 0;
    this.paused = false;
    this.lapsOverride = null;   // modes (GP escalation, time trial) set this
  }

  registerKart(kart) {
    this.karts.push(kart);
    this.kartState.set(kart.vehicle, this._freshKartState());
  }

  _freshKartState() {
    return {
      nextCp: 1, lap: 0, laps: this.lapsOverride ?? R.laps,
      lapStart: 0, bestLap: null, lapTimes: [],
      prevProg: 0, finished: false, finishTime: null,
    };
  }

  // ------------------------------------------------------------------ start
  start(grid) {
    this.state = 'countdown';
    this.countdownT = R.countdownTime;
    this.raceTime = 0;
    this.timeScale = 1;
    this.playerArmed = false;
    this.lastCountInt = -1;
    this.finishTimer = 0;
    this.wrongWayTimer = 0;
    this.karts.forEach((kart, i) => {
      kart.vehicle.place(grid[i]);
      this.kartState.set(kart.vehicle, this._freshKartState());
    });
    if (this.itemsEnabled) this.items.reset();
    this.hud.onRaceStart();
  }

  restart() { this.start(this.track.startGrid()); }

  // ----------------------------------------------------------------- update
  update(rawDt) {
    if (this.state === 'idle' || this.state === 'results' || this.paused) return;

    const dt = rawDt * this.timeScale;

    if (this.state === 'countdown') this._updateCountdown(rawDt);

    const racing = this.state === 'racing' || this.state === 'finished';
    if (!racing) return;

    this.raceTime += dt;

    // inputs + physics -------------------------------------------------------
    const racing2 = this.state === 'racing' || this.state === 'finished';
    const order = this.itemsEnabled ? this.positions() : null;
    for (const kart of this.karts) {
      if (order) {
        kart._racePos = order.indexOf(kart) + 1;
        kart._raceTotal = this.karts.length;
        kart._raceLap = this.kartState.get(kart.vehicle).lap;
      }
      let input;
      if (kart.isPlayer) {
        input = { ...this.playerInput };
      } else {
        // AI keeps driving during the slow-mo finish sequence
        input = kart.ai.update(dt, this.karts, racing2, this.items);
      }
      kart.vehicle.step(dt, input, false);
      this._fxForKart(kart);

      // item activation (player key or AI decision)
      if (this.itemsEnabled && racing2 && input.item) {
        this.items.useItem(kart, this.karts);
      }
    }

    this._collideKarts();
    this._collideObstacles();
    if (this.itemsEnabled && racing2) this.items.update(dt, this.karts, this.raceTime);

    if (this.state === 'racing') {
      for (const kart of this.karts) this._checkpoints(kart);
      this._wrongWay(dt);
    }

    this.hud.updateRace(this);

    if (this.state === 'finished') {
      this.finishTimer += rawDt;
      if (this.finishTimer > R.resultsDelay) this._showResults();
    }
  }

  _updateCountdown(rawDt) {
    this.countdownT -= rawDt;
    const ceil = Math.ceil(this.countdownT);
    if (ceil !== this.lastCountInt && ceil >= 1) {
      this.lastCountInt = ceil;
      this.hud.countdown(String(ceil));
      this.audio.countBeep(false);
    }
    // rocket start arming
    if (this.playerInput.throttle && this.countdownT <= R.startBoostArmWindow) {
      this.playerArmed = true;
    }
    if (this.countdownT <= 0) {
      this.state = 'racing';
      this.hud.countdown(this.i18n.t('race.go'), true);
      this.audio.countBeep(true);
      this.onEvent && this.onEvent('raceGo', {});
      // player rocket start
      const player = this.karts.find((k) => k.isPlayer);
      if (player && this.playerArmed && this.playerInput.throttle &&
          this.countdownT > -R.startBoostGrace) {
        player.vehicle.boost.trigger(0, 'start');
        this.hud.notify(this.i18n.t('race.rocketStart'));
      }
      // AI rocket starts by personality
      for (const kart of this.karts) {
        if (!kart.isPlayer && kart.ai && Math.random() < kart.ai.p.startBoostChance) {
          kart.vehicle.boost.trigger(0, 'start');
        }
      }
    }
  }

  // ------------------------------------------------------------- checkpoints
  _checkpoints(kart) {
    const v = kart.vehicle;
    const st = this.kartState.get(v);
    if (!v.surf || st.finished) { if (v.surf) st.prevProg = v.surf.progress; return; }

    const L = this.track.L;
    const prog = v.surf.progress;
    const cps = this.track.checkpoints;
    const cp = cps[st.nextCp];

    const fPrev = (cp.s - st.prevProg + L) % L;   // forward distance to cp before
    const fNow = (cp.s - prog + L) % L;            // forward distance to cp after
    const crossed = fPrev <= 40 && fNow > fPrev;

    if (crossed && Math.abs(v.surf.lateral) <= cp.halfW) {
      if (st.nextCp === 0) this._lapCompleted(kart);
      st.nextCp = (st.nextCp + 1) % cps.length;
    }
    st.prevProg = prog;
  }

  _lapCompleted(kart) {
    const st = this.kartState.get(kart.vehicle);
    const lapTime = this.raceTime - st.lapStart;
    st.lapStart = this.raceTime;
    st.lapTimes.push(lapTime);
    if (st.bestLap === null || lapTime < st.bestLap) {
      st.bestLap = lapTime;
      if (kart.isPlayer && st.lapTimes.length > 1) {
        this.hud.notify(this.i18n.t('race.bestLap'));
      }
    }
    st.lap++;
    this.onEvent && this.onEvent('lapComplete', { kart, lap: st.lap, lapTime });
    if (st.lap >= st.laps) {
      st.finished = true;
      st.finishTime = this.raceTime;
      this._kartFinished(kart);
    } else if (kart.isPlayer && st.lap === st.laps - 1) {
      this.hud.notify(this.i18n.t('race.finalLap'));
      this.audio.click();
      this.onEvent && this.onEvent('playerFinalLap', {});
    }
  }

  _kartFinished(kart) {
    if (kart.isPlayer) {
      this.state = 'finished';
      this.finishTimer = 0;
      this.timeScale = R.slowMoOnFinish;
      this.hud.notify(this.i18n.t('race.finished'));
      const pos = this.positions().findIndex((k) => k === kart) + 1;
      this.audio.finish(pos === 1);
      this.onEvent && this.onEvent('celebrate', {
        pos: kart.vehicle.pos.clone(), win: pos === 1,
      });
      this.onEvent && this.onEvent('playerFinished', { pos });
    }
  }

  // -------------------------------------------------------------- collisions
  _collideKarts() {
    const rest = CONFIG.vehicle.kartRestitution;
    for (let i = 0; i < this.karts.length; i++) {
      for (let j = i + 1; j < this.karts.length; j++) {
        const a = this.karts[i].vehicle, b = this.karts[j].vehicle;
        // phased (intangible) karts pass through everything
        if (this.itemsEnabled && (this.items.isIntangible(a) || this.items.isIntangible(b))) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const distSq = dx * dx + dz * dz;
        const minDist = CONFIG.vehicle.collisionRadius * 2;
        if (distSq >= minDist * minDist || distSq < 1e-6) continue;
        const dist = Math.sqrt(distSq);
        const nx = dx / dist, nz = dz / dist;
        const overlap = minDist - dist;
        // separate
        a.pos.x -= nx * overlap * 0.5; a.pos.z -= nz * overlap * 0.5;
        b.pos.x += nx * overlap * 0.5; b.pos.z += nz * overlap * 0.5;
        // impulse along normal
        const rvx = b.vel.x - a.vel.x, rvz = b.vel.z - a.vel.z;
        const relN = rvx * nx + rvz * nz;
        if (relN < 0) {
          // Mass-weighted impulse: with equal masses this is exactly the
          // original even-split impulse from the vertical slice.
          const ma = a.massFactor ?? 1, mb = b.massFactor ?? 1;
          const invA = 1 / ma, invB = 1 / mb;
          const jimp = -(1 + rest) * relN / (invA + invB);
          a.vel.x -= nx * jimp * invA; a.vel.z -= nz * jimp * invA;
          b.vel.x += nx * jimp * invB; b.vel.z += nz * jimp * invB;
          const strength = Math.min(2, Math.abs(relN) / 8);
          if (strength > 0.15) {
            this.audio.collision(strength);
            this.onEvent && this.onEvent('kartHit', {
              pos: _mid.set((a.pos.x + b.pos.x) / 2, Math.max(a.y, b.y) + 0.7, (a.pos.z + b.pos.z) / 2),
              strength,
            });
            // slight destabilization, never a big spin
            a.yaw += (Math.random() - 0.5) * CONFIG.vehicle.bumpYawJitter * 2;
            b.yaw += (Math.random() - 0.5) * CONFIG.vehicle.bumpYawJitter * 2;
          }
        }
      }
    }
  }

  _collideObstacles() {
    const colliders = this.track.getObstacleColliders();
    for (const kart of this.karts) {
      const v = kart.vehicle;
      for (const c of colliders) {
        const dx = v.pos.x - c.x, dz = v.pos.z - c.z;
        const minD = c.r + CONFIG.vehicle.collisionRadius;
        const dSq = dx * dx + dz * dz;
        if (dSq >= minD * minD || dSq < 1e-6) continue;
        const d = Math.sqrt(dSq);
        const nx = dx / d, nz = dz / d;
        v.pos.x = c.x + nx * minD;
        v.pos.z = c.z + nz * minD;
        const relN = v.vel.x * -nx + v.vel.z * -nz;
        if (relN > 0) {
          // moving into the obstacle: bounce (heavier karts shrug it off more)
          const rest = 0.55;
          const massScale = 1 / (v.massFactor ?? 1);
          v.vel.x += nx * relN * (1 + rest) * massScale;
          v.vel.z += nz * relN * (1 + rest) * massScale;
        }
        this.audio.collision(1.2);
        this.onEvent && this.onEvent('obstacleHit', {
          pos: _mid.set(v.pos.x, v.y + 0.7, v.pos.z),
          strength: 1.4,
        });
      }
    }
  }

  // ---------------------------------------------------------------- wrong way
  _wrongWay(dt) {
    const player = this.karts.find((k) => k.isPlayer);
    if (!player || !player.vehicle.surf) return;
    const v = player.vehicle;
    const dir = v.surf.dir;
    const dot = v.vel.x * dir.x + v.vel.z * dir.z;
    if (dot < -2 && v.speedAbs > 2) this.wrongWayTimer += dt;
    else this.wrongWayTimer = Math.max(0, this.wrongWayTimer - dt * 2);
    this.hud.setWrongWay(this.wrongWayTimer > R.wrongWayTime);
  }

  // --------------------------------------------------------------- positions
  positions() {
    const L = this.track.L;
    const scored = this.karts.map((kart) => {
      const st = this.kartState.get(kart.vehicle);
      let score;
      if (st.finished) score = 1e7 - st.finishTime * 1000;
      else score = st.lap * L + (kart.vehicle.surf ? kart.vehicle.surf.progress : 0);
      return { kart, st, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.kart);
  }

  playerStanding() {
    const order = this.positions();
    const player = this.karts.find((k) => k.isPlayer);
    return order.findIndex((k) => k === player) + 1;
  }

  // ---------------------------------------------------------------- fx hooks
  _fxForKart(kart) {
    const v = kart.vehicle;
    const fx = v.fx;
    if (!fx) return;
    const player = this.karts.find((k) => k.isPlayer);
    const nearPlayer = player &&
      v.pos.distanceToSquared(player.vehicle.pos) < 55 * 55;

    if (fx.landing && fx.landing > 4.6) {   // ignore the tiny drift-hop touchdown
      this.audio.landing(fx.landing);
      this.onEvent && this.onEvent('landing', { vehicle: v, fall: fx.landing });
    }
    if (fx.trickLanded && kart.isPlayer) {
      this.audio.trick();
      this.hud.notify(this.i18n.t('race.trick'));
    }
    if (fx.pad && (kart.isPlayer || nearPlayer)) this.audio.pad();
    if (fx.boostStart && (kart.isPlayer || nearPlayer)) this.audio.boost(fx.boostStart.level + 1);
    if (fx.driftLevel && kart.isPlayer) this.audio.driftLevelUp(fx.driftLevel);
    if (fx.reset) {
      this.audio.reset();
      // Checkpoint state is intentionally left untouched on resets:
      // respawns always happen BEHIND the kart's current position, and
      // checkpoints only count on a forward crossing, so no cp can be
      // gained or lost by resetting.
      if (kart.isPlayer) this.hud.notify(this.i18n.t('race.recovering'));
    }
  }

  // ----------------------------------------------------------------- results
  _showResults() {
    if (this.state === 'results') return;
    this.state = 'results';
    this.timeScale = 0;
    const order = this.positions();
    const rows = order.map((kart, i) => {
      const st = this.kartState.get(kart.vehicle);
      return {
        pos: i + 1,
        nameKey: kart.nameKey,
        isPlayer: kart.isPlayer,
        finished: st.finished,
        time: st.finishTime,
        bestLap: st.bestLap,
      };
    });
    const player = this.karts.find((k) => k.isPlayer);
    const pst = this.kartState.get(player.vehicle);
    this.hud.showResults({
      rows,
      playerPos: rows.findIndex((r) => r.isPlayer) + 1,
      totalTime: pst.finishTime ?? this.raceTime,
      bestLap: pst.bestLap,
    });
  }
}

const _mid = new THREE.Vector3();

export function formatTime(t) {
  if (t === null || t === undefined) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t * 1000) % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
