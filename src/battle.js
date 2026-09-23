// ============================================================================
// BattleManager - five original battle modes run on arena tracks.
//
//   energy       collect energy cores from item boxes (first to the goal,
//                or most cores when time runs out)
//   elimination  every kart has HP; hits spend it; last kart standing wins
//   zones        hold capture rings to bank points; most points at time-up
//   survival     HP decays over time AND from hits; last kart standing wins
//   score        +1 per hit landed, +2 per KO; most points at time-up
//
// Pure logic: consumes kart wrappers ({vehicle, nameKey, isPlayer}) and
// emits events. main.js steps vehicles/AI and feeds the hooks below.
// ============================================================================

export const BATTLE_MODES = [
  { id: 'energy', nameKey: 'battle.energy', descKey: 'battle.energy.d', time: 180, hp: Infinity, goal: 15 },
  { id: 'elimination', nameKey: 'battle.elimination', descKey: 'battle.elimination.d', time: 0, hp: 3 },
  { id: 'zones', nameKey: 'battle.zones', descKey: 'battle.zones.d', time: 180, hp: 3 },
  // Survival: HP drains down to the last point, so attrition weakens everyone
  // and the finishing blow is always a hit (never a timer).
  { id: 'survival', nameKey: 'battle.survival', descKey: 'battle.survival.d', time: 0, hp: 3, decay: 0.06 },
  { id: 'score', nameKey: 'battle.score', descKey: 'battle.score.d', time: 150, hp: 3 },
];

export function getBattleMode(id) {
  return BATTLE_MODES.find((m) => m.id === id) || BATTLE_MODES[0];
}

const ZONE_FRACTIONS = [0.125, 0.46, 0.78];
const ZONE_RADIUS = 7;
const ZONE_CAPTURE_TIME = 2.4;

export class BattleManager {
  constructor({ track, modeId, karts, onEvent = null }) {
    this.track = track;
    this.mode = getBattleMode(modeId);
    this.karts = karts;
    this.onEvent = onEvent;

    this.state = 'countdown';
    this.countdownT = 3.4;
    this.time = 0;
    this.timeLeft = this.mode.time;       // 0 = untimed (last kart standing)
    this.finished = false;
    this.winner = null;

    this.per = new Map();
    for (const k of karts) {
      this.per.set(k, {
        hp: this.mode.hp, hpMax: this.mode.hp,
        cores: 0, score: 0,
        eliminated: false, eliminatedAt: null,
      });
    }

    // capture zones (anchored to the arena ribbon)
    this.zones = [];
    if (this.mode.id === 'zones') {
      for (const f of ZONE_FRACTIONS) {
        const p = track.pointAt(f * track.L);
        this.zones.push({
          pos: p.pos.clone(), owner: null, progress: 0,
          contestedBy: null,
        });
      }
    }
  }

  get playerState() {
    const player = this.karts.find((k) => k.isPlayer);
    return player ? this.per.get(player) : null;
  }

  // -------------------------------------------------------------- lifecycle
  startCountdown(dt) {
    this.countdownT -= dt;
    if (this.countdownT <= 0) {
      this.state = 'running';
      this.onEvent && this.onEvent('battleStart', {});
    }
  }

  update(dt) {
    if (this.state === 'countdown') { this.startCountdown(dt); return; }
    if (this.state !== 'running') return;
    this.time += dt;

    // timed modes count down
    if (this.mode.time > 0) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this._endByTime(); return; }
    }

    // survival decay (drains to 1 HP, never eliminates: the last hit decides)
    if (this.mode.decay) {
      for (const [kart, st] of this.per) {
        if (st.eliminated) continue;
        st.hp = Math.max(1, st.hp - this.mode.decay * dt);
      }
    }

    // zone control
    if (this.mode.id === 'zones') this._updateZones(dt);
  }

  _updateZones(dt) {
    for (const zone of this.zones) {
      let inside = null, count = 0;
      for (const kart of this.karts) {
        const st = this.per.get(kart);
        if (st.eliminated) continue;
        const dx = kart.vehicle.pos.x - zone.pos.x;
        const dz = kart.vehicle.pos.z - zone.pos.z;
        if (dx * dx + dz * dz <= ZONE_RADIUS * ZONE_RADIUS) { inside = kart; count++; }
      }
      if (count !== 1) {
        // contested or empty: progress decays toward neutral
        zone.progress = Math.max(0, zone.progress - dt * 0.8);
        zone.contestedBy = null;
        if (zone.progress === 0) zone.owner = null;
        continue;
      }
      if (zone.owner === inside) { zone.contestedBy = null; continue; }   // already held
      zone.progress += dt / ZONE_CAPTURE_TIME;
      zone.contestedBy = inside;
      if (zone.progress >= 1) {
        zone.owner = inside;
        zone.progress = 1;
        this.onEvent && this.onEvent('zoneCaptured', { kart: inside, zone });
      }
    }
    // owners bank points
    for (const zone of this.zones) {
      if (!zone.owner) continue;
      const st = this.per.get(zone.owner);
      if (st.eliminated) { zone.owner = null; continue; }
      st.score += dt;
    }
  }

  // ----------------------------------------------------------------- hooks
  // Item box pickup (energy cores).
  boxPicked(kart) {
    if (this.state !== 'running') return;
    const st = this.per.get(kart);
    if (!st || st.eliminated) return;
    st.cores += 1;
    this.onEvent && this.onEvent('coreCollected', { kart, cores: st.cores, goal: this.mode.goal });
    if (this.mode.id === 'energy' && st.cores >= this.mode.goal) {
      this._finish(kart);
    }
  }

  // An item (or obstacle) hit a kart. attacker may be null (environment).
  hitLanded(attacker, victim) {
    if (this.state !== 'running') return;
    const st = this.per.get(victim);
    if (!st || st.eliminated) return;
    if (Number.isFinite(st.hp)) {
      st.hp -= 1;
      if (st.hp <= 0) {
        this._eliminate(victim, attacker);
        return;
      }
    }
    if (attacker && this.mode.id === 'score') {
      this.per.get(attacker).score += 1;
    }
    this.onEvent && this.onEvent('battleHit', { attacker, victim });
  }

  _eliminate(kart, attacker) {
    const st = this.per.get(kart);
    if (st.eliminated) return;
    st.eliminated = true;
    st.eliminatedAt = this.time;
    st.hp = 0;
    if (attacker && this.mode.id === 'score') this.per.get(attacker).score += 2;
    this.onEvent && this.onEvent('battleKO', { kart, attacker });

    const alive = this.karts.filter((k) => !this.per.get(k).eliminated);
    if ((this.mode.id === 'elimination' || this.mode.id === 'survival' || this.mode.id === 'score') &&
        alive.length <= 1) {
      this._finish(alive[0] || kart);
    }
  }

  _endByTime() {
    const order = this.standings();
    this._finish(order[0] ? order[0].kart : null);
  }

  _finish(winner) {
    if (this.finished) return;
    this.finished = true;
    this.state = 'over';
    this.winner = winner;
    this.onEvent && this.onEvent('battleOver', { winner, standings: this.standings() });
  }

  // -------------------------------------------------------------- standings
  standings() {
    const rows = this.karts.map((kart) => {
      const st = this.per.get(kart);
      return { kart, ...st };
    });
    const mode = this.mode.id;
    rows.sort((a, b) => {
      // eliminated karts sink, latest elimination first
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      if (a.eliminated && b.eliminated) return b.eliminatedAt - a.eliminatedAt;
      if (mode === 'energy') return b.cores - a.cores;
      return b.score - a.score;
    });
    return rows;
  }

  // HUD summary: short objective line values (rendering is main.js' job).
  hudInfo() {
    const mode = this.mode.id;
    const player = this.playerState;
    if (mode === 'energy') {
      const best = Math.max(...[...this.per.values()].map((s) => s.cores));
      return {
        timer: this.timeLeft, primary: player ? player.cores : 0, goal: this.mode.goal,
        leader: best, hp: player ? Math.ceil(player.hp) : 0, hpMax: player ? player.hpMax : 0,
      };
    }
    if (mode === 'zones') {
      const held = this.zones.filter((z) => z.owner && z.owner.isPlayer).length;
      return {
        timer: this.timeLeft, primary: player ? Math.floor(player.score) : 0,
        hp: player ? Math.ceil(player.hp) : 0, hpMax: player ? player.hpMax : 0,
        zonesHeld: held, zonesTotal: this.zones.length,
      };
    }
    if (mode === 'score') {
      return {
        timer: this.timeLeft, primary: player ? Math.floor(player.score) : 0,
        hp: player ? Math.ceil(player.hp) : 0, hpMax: player ? player.hpMax : 0,
      };
    }
    return {
      timer: 0, hp: player ? Math.ceil(player.hp) : 0, hpMax: player ? player.hpMax : 0,
    };
  }
}
