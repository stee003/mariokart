// ============================================================================
// TrackManager - data-driven track builder.
//
// `new TrackManager()` with no argument builds SUNFORGE_DEF exactly as the
// original vertical slice (same samples, features, racing line). Any def
// from src/content/trackDefs.js builds a different track through the same
// code path. All gameplay queries (ground height, on-road tests, progress,
// racing line) live here.
//
// Feature support: ramps, boost pads, one optional shortcut, ordered
// checkpoints, item-box rows, themed render ranges, zone effects
// (wind / low gravity / slippery / current) and moving obstacles
// (gear, slider, pendulum, flamejet).
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { CONFIG } from './config.js';
import { SUNFORGE_DEF } from './content/trackDefs.js';

// 1D Catmull-Rom interpolation used for road width.
function catmull1(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

const UP = new THREE.Vector3(0, 1, 0);

export class TrackManager {
  constructor(def = SUNFORGE_DEF) {
    this.def = def;
    this.step = 1.5;
    this.samples = [];
    this.time = 0;
    this._buildCenterline();
    this._buildShortcut();
    this._buildFeatures();
    this._buildRacingLine();
  }

  get id() { return this.def.id; }
  get laps() { return this.def.laps ?? CONFIG.race.laps; }

  // ------------------------------------------------------------------ spline
  _buildCenterline() {
    const CONTROL_POINTS = this.def.points;
    const pts = CONTROL_POINTS.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    this.L = this.curve.getLength();
    this.ncp = CONTROL_POINTS.length;

    const n = Math.floor(this.L / this.step);
    const widths = CONTROL_POINTS.map((p) => p.w);
    const v = new THREE.Vector3();
    const tan = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const u = i / n;
      this.curve.getPointAt(u, v);
      this.curve.getTangentAt(u, tan);
      tan.y = 0; tan.normalize();
      const right = new THREE.Vector3().crossVectors(UP, tan).normalize(); // up x fwd
      const width = this._widthAtU(u, widths);
      this.samples.push({
        pos: v.clone(), dir: tan.clone(), right,
        width, s: u * this.L,
      });
    }
    this.n = n;
  }

  _widthAtU(u, widths) {
    const f = u * this.ncp;
    const i = Math.floor(f) % this.ncp;
    const t = f - Math.floor(f);
    const n = this.ncp;
    return catmull1(widths[(i - 1 + n) % n], widths[i], widths[(i + 1) % n], widths[(i + 2) % n], t);
  }

  // --------------------------------------------------------------- shortcut
  _buildShortcut() {
    const sc = this.def.shortcut;
    if (!sc) { this.shortcut = null; return; }
    const entryProg = this.L * sc.entry;
    const exitProg = this.L * sc.exit;
    const a = this.pointAt(entryProg), b = this.pointAt(exitProg);
    const entry = a.pos.clone().addScaledVector(a.right, sc.latEntry);
    const exit = b.pos.clone().addScaledVector(b.right, sc.latExit);
    entry.y = a.pos.y; exit.y = b.pos.y;

    const samples = [];
    const len = entry.distanceTo(exit);
    const m = Math.max(2, Math.floor(len / this.step));
    const dir = exit.clone().sub(entry).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(UP, dir).normalize();
    for (let i = 0; i < m; i++) {
      const t = i / (m - 1);
      const pos = entry.clone().lerp(exit, t);
      // keep the chute flush with the surrounding terrain
      const near = this.pointAt(entryProg + (exitProg - entryProg) * t);
      pos.y = near.pos.y - 0.15;
      samples.push({ pos, dir: dir.clone(), right: right.clone(), s: t * len, width: sc.halfW * 2 });
    }
    this.shortcut = { samples, entryProg, exitProg, halfW: sc.halfW, len };
  }

  // ---------------------------------------------------------------- features
  _buildFeatures() {
    const L = this.L;
    const def = this.def;

    // Ramps: {s0, s1, lat, halfW, rise}. Surface climbs from road to lip.
    this.ramps = (def.ramps || []).map((r) => this._mkRamp(r.f * L, r.len, r.lat, r.halfW, r.rise));

    // Boost pads: {s, lat, halfW, len}
    this.pads = (def.pads || []).map((p) => ({
      s: p.f * L, lat: p.lat, halfW: p.halfW ?? 2.6, len: p.len ?? 5,
    }));
    // pads inside the shortcut
    if (this.shortcut && def.shortcutPads) {
      for (const f of def.shortcutPads) {
        this.pads.push({ s: 0, lat: 0, halfW: 2.6, len: 4.5, shortcut: true, scFrac: f });
      }
    } else if (this.shortcut && def.id === 'sunforge_circuit') {
      // legacy Sunforge shortcut pads (kept bit-identical)
      for (const f of [0.35, 0.72]) {
        this.pads.push({ s: 0, lat: 0, halfW: 2.6, len: 4.5, shortcut: true, scFrac: f });
      }
    }

    // Checkpoints in strict order; index 0 is the start/finish line.
    this.checkpoints = def.checkpoints.map((f, idx) => {
      const p = this.pointAt(f * L);
      const extra = def.cpExtras?.[idx] ?? 7;
      return { s: f * L, halfW: p.width / 2 + extra, idx };
    });

    // Themed render ranges (fractions of L in the def -> arc length here,
    // exactly as the original slice stored them for the environment/camera)
    const toLen = (r) => (r ? [r[0] * L, r[1] * L] : null);
    this.tunnelRange = toLen(def.ranges?.tunnel);
    this.bridgeRange = toLen(def.ranges?.bridge);
    this.canyonRange = toLen(def.ranges?.canyon);

    // Item box rows
    this.itemBoxes = [];
    for (const f of def.boxes || []) {
      for (const lat of [-4, 0, 4]) this.itemBoxes.push({ s: f * L, lat });
    }

    // Zones (wind / low gravity / slippery / current)
    this.zones = (def.zones || []).map((z) => ({
      s0: z.f0 * L, s1: z.f1 * L, type: z.type, v: z.v,
    }));

    // Moving obstacles ---------------------------------------------------
    this.obstacles = [];
    this.gear = null;      // legacy accessors (first of each type)
    this.slider = null;
    for (const o of def.obstacles || []) {
      const at = this.pointAt(o.s * L);
      if (o.type === 'gear') {
        const center = at.pos.clone().addScaledVector(at.right, o.lat ?? 0);
        center.y = at.pos.y;
        const gear = { type: 'gear', center, armRadius: o.armRadius, angle: 0, speed: o.speed };
        this.obstacles.push(gear);
        if (!this.gear) this.gear = gear;
      } else if (o.type === 'slider') {
        const slider = {
          type: 'slider',
          base: at.pos.clone(), right: at.right.clone(),
          amp: at.width / 2 + (o.ampExtra ?? 0.8), phase: o.phase ?? 0, speed: o.speed, radius: o.radius,
          pos: at.pos.clone(),
        };
        slider.pos.y = at.pos.y + 1.0;
        slider.baseY = at.pos.y;
        this.obstacles.push(slider);
        if (!this.slider) { this.slider = slider; this.baseY = at.pos.y; }
      } else if (o.type === 'pendulum') {
        const pend = {
          type: 'pendulum',
          base: at.pos.clone(), right: at.right.clone(),
          swing: o.swing, speed: o.speed, phase: o.phase ?? 0, radius: o.radius,
          pos: at.pos.clone(),
        };
        pend.pos.y = at.pos.y + 0.8;
        pend.baseY = at.pos.y;
        this.obstacles.push(pend);
      } else if (o.type === 'flamejet') {
        const jet = {
          type: 'flamejet',
          pos: at.pos.clone(), period: o.period, duty: o.duty, radius: o.radius,
          active: false,
        };
        jet.pos.y = at.pos.y;
        this.obstacles.push(jet);
      }
    }
  }

  _mkRamp(s0, len, lat, halfW, rise) {
    const p = this.pointAt(s0);
    return { s0, s1: s0 + len, lat, halfW, rise, baseY: p.pos.y, dir: p.dir.clone(), len };
  }

  update(dt, time) {
    this.time = time;
    for (const o of this.obstacles) {
      if (o.type === 'gear') {
        o.angle += o.speed * dt;
      } else if (o.type === 'slider') {
        o.phase += o.speed * dt;
        const off = Math.sin(o.phase) * o.amp;
        o.pos.copy(o.base).addScaledVector(o.right, off);
        o.pos.y = o.baseY + 1.0;
      } else if (o.type === 'pendulum') {
        const off = Math.sin(time * o.speed + o.phase) * o.swing;
        o.pos.copy(o.base).addScaledVector(o.right, off);
        o.pos.y = o.baseY + 0.8;
      } else if (o.type === 'flamejet') {
        o.active = (time % o.period) < o.period * o.duty;
      }
    }
  }

  // Circular colliders for the moving obstacles this frame.
  getObstacleColliders() {
    const out = [];
    for (const o of this.obstacles) {
      if (o.type === 'gear') {
        for (let k = 1; k <= 2; k++) {
          const r = (o.armRadius * k) / 2;
          out.push({ x: o.center.x + Math.cos(o.angle) * r, z: o.center.z + Math.sin(o.angle) * r, r: k === 2 ? 1.5 : 1.2, hit: 'gear' });
          out.push({ x: o.center.x - Math.cos(o.angle) * r, z: o.center.z - Math.sin(o.angle) * r, r: k === 2 ? 1.5 : 1.2, hit: 'gear' });
        }
      } else if (o.type === 'slider' || o.type === 'pendulum') {
        out.push({ x: o.pos.x, z: o.pos.z, r: o.radius, hit: o.type });
      } else if (o.type === 'flamejet' && o.active) {
        out.push({ x: o.pos.x, z: o.pos.z, r: o.radius, hit: 'flame' });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ zones
  _zoneFxAt(progress) {
    const fx = { wind: 0, gravMult: 1, gripMult: 1, push: 0 };
    for (const z of this.zones) {
      let rel = progress - z.s0;
      if (rel < -this.L / 2) rel += this.L;
      if (rel > this.L / 2) rel -= this.L;
      if (rel < 0 || rel > z.s1 - z.s0) continue;
      if (z.type === 'wind') fx.wind += z.v;
      else if (z.type === 'lowgrav') fx.gravMult = Math.min(fx.gravMult, z.v);
      else if (z.type === 'slippery') fx.gripMult = Math.min(fx.gripMult, z.v);
      else if (z.type === 'current') fx.push += z.v;
    }
    return fx;
  }

  // ----------------------------------------------------------------- queries
  sToIdx(s) {
    const n = this.n;
    let i = Math.round((s / this.L) * n) % n;
    if (i < 0) i += n;
    return i;
  }

  // Interpolated centerline point/dir/right/width at progress s.
  pointAt(s) {
    const n = this.n;
    s = ((s % this.L) + this.L) % this.L;
    const f = (s / this.L) * n;
    const i = Math.floor(f) % n;
    const j = (i + 1) % n;
    const t = f - Math.floor(f);
    const a = this.samples[i], b = this.samples[j];
    return {
      pos: a.pos.clone().lerp(b.pos, t),
      dir: a.dir.clone().lerp(b.dir, t).normalize(),
      right: a.right.clone().lerp(b.right, t).normalize(),
      width: a.width + (b.width - a.width) * t,
      idx: i,
    };
  }

  _nearest(pos, samples, hintIdx, window) {
    const m = samples.length;
    // Height band: when the query carries a usable altitude (karts always do),
    // samples whose ground is way above/below it are only considered if NO
    // in-band candidate exists. On multi-level sections (helixes, elevated
    // cities, island hops) this locks the query to the deck the kart is
    // actually on; single-level behaviour is unchanged.
    const py = pos.y;
    const hasY = typeof py === 'number' && Number.isFinite(py);
    const BAND = 2.2;
    let best = -1, bestD = Infinity, bestAlong = 0, bestLat = 0;
    let bestB = -1, bestBD = Infinity, bestBAlong = 0, bestBLat = 0;
    const test = (i) => {
      const sm = samples[((i % m) + m) % m];
      const dx = pos.x - sm.pos.x, dz = pos.z - sm.pos.z;
      const along = dx * sm.dir.x + dz * sm.dir.z;
      const lat = dx * sm.right.x + dz * sm.right.z;
      const d = lat * lat + Math.min(0, along) * Math.min(0, along) * 0.25 + Math.max(0, along - this.step) ** 2 * 0.25;
      const idx = ((i % m) + m) % m;
      if (hasY && Math.abs(sm.pos.y - py) <= BAND) {
        if (d < bestBD) { bestBD = d; bestB = idx; bestBAlong = along; bestBLat = lat; }
      } else {
        if (d < bestD) { bestD = d; best = idx; bestAlong = along; bestLat = lat; }
      }
    };
    if (hintIdx >= 0) {
      for (let k = -window; k <= window; k++) test(hintIdx + k);
    } else {
      for (let i = 0; i < m; i += 2) test(i);
      const h = bestB >= 0 ? bestB : best;
      for (let k = -2; k <= 2; k++) test(h + k);
    }
    return bestB >= 0
      ? { idx: bestB, along: bestBAlong, lat: bestBLat }
      : { idx: best, along: bestAlong, lat: bestLat };
  }

  // Full surface query: main loop + shortcut + ramps + zones.
  // Note: pos.y (when present) selects the deck on multi-level sections.
  // When `vel` is given, cross-leg snaps only adopt segments the mover is
  // actually heading along (chicanes run legs in opposite directions).
  // Returns progress, lateral, ground y, direction, road state, zone fx.
  surface(pos, hint = { main: -1, sc: -1 }, vel = null) {
    // ±12 samples (18m): wide enough for 40+ m/s travel per step, narrow
    // enough that hairpin legs / stacked decks don't steal the match.
    let main = this._nearest(pos, this.samples, hint.main, 12);
    let sm = this.samples[main.idx];
    // Leg-cross hysteresis: if the continuous match says the kart is way off
    // the road, but a full scan finds it comfortably INSIDE another segment's
    // road (e.g. cutting a hairpin pinch onto the other leg), re-attach —
    // unless that segment points against the kart's movement.
    if (hint.main >= 0 && Math.abs(main.lat) > sm.width / 2 + 3) {
      const g = this._nearest(pos, this.samples, -1, 0);
      const gm = this.samples[g.idx];
      if (Math.abs(g.lat) < gm.width / 2 - 1) {
        const sp = vel ? Math.hypot(vel.x, vel.z) : 0;
        if (!vel || sp < 2 || (gm.dir.x * vel.x + gm.dir.z * vel.z) > 0.25 * sp) main = g;
      }
    }
    hint.main = main.idx;
    sm = this.samples[main.idx];

    let useShortcut = false;
    let sc = null;
    if (this.shortcut) {
      sc = this._nearest(pos, this.shortcut.samples, hint.sc, 12);
      hint.sc = sc.idx;
      const scW = this.shortcut.halfW + 4;
      const mainW = sm.width / 2 + 4;
      if (Math.abs(sc.lat) < Math.min(Math.abs(main.lat), scW) && Math.abs(sc.lat) < mainW) {
        if (Math.abs(sc.lat) < Math.abs(main.lat)) useShortcut = true;
      }
    }

    let progress, lateral, dir, right, width, y, onRoad, onShoulder;
    if (useShortcut) {
      const scS = this.shortcut.samples[sc.idx];
      const frac = Math.min(1, Math.max(0, (sc.idx * this.step + sc.along) / this.shortcut.len));
      progress = this.shortcut.entryProg + frac * (this.shortcut.exitProg - this.shortcut.entryProg);
      lateral = sc.lat; dir = scS.dir; right = scS.right; width = scS.width;
      y = scS.pos.y;
      onRoad = Math.abs(lateral) <= width / 2;
      onShoulder = Math.abs(lateral) <= width / 2 + 2.2;
    } else {
      const frac = Math.min(1, Math.max(-1, main.along / this.step));
      const j = (main.idx + 1) % this.n;
      const sj = this.samples[j];
      progress = ((sm.s + main.along) % this.L + this.L) % this.L;
      lateral = main.lat;
      dir = sm.dir; right = sm.right;
      width = sm.width + (sj.width - sm.width) * Math.max(0, frac);
      y = sm.pos.y + (sj.pos.y - sm.pos.y) * Math.max(0, frac);
      onRoad = Math.abs(lateral) <= width / 2;
      onShoulder = Math.abs(lateral) <= width / 2 + 2.5;
    }

    // Ramp surface overrides the road height.
    let onRamp = false, rampExitSoon = false;
    for (const r of this.ramps) {
      let rel = progress - r.s0;
      if (rel < -this.L / 2) rel += this.L;
      if (rel > this.L / 2) rel -= this.L;
      if (rel >= -0.5 && rel <= r.len + 0.5 && Math.abs(lateral - r.lat) <= r.halfW) {
        const t = Math.min(1, Math.max(0, rel / r.len));
        const rampY = r.baseY + t * r.rise;
        if (rampY >= y - 0.05) { y = Math.max(y, rampY); onRamp = rel >= 0 && rel <= r.len; rampExitSoon = rel > r.len - 2.5; }
      }
    }

    return { progress, lateral, y, dir, right, width, onRoad, onShoulder, onRamp, rampExitSoon, useShortcut,
             fx: this.zones.length ? this._zoneFxAt(progress) : EMPTY_FX,
             hintMain: main.idx, hintSc: sc ? sc.idx : -1 };
  }

  // Pad overlapping (progress, lateral)? Returns pad object or null.
  padAt(progress, lateral, pos) {
    for (const pad of this.pads) {
      if (pad.shortcut) {
        // shortcut pads: proximity test in world space
        const sc = this.shortcut;
        const idx = Math.min(sc.samples.length - 1, Math.floor(pad.scFrac * sc.samples.length));
        const sm = sc.samples[idx];
        if (pos && sm.pos.distanceTo(pos) < 3.6) return pad;
        continue;
      }
      let rel = progress - pad.s;
      if (rel < -this.L / 2) rel += this.L;
      if (rel > this.L / 2) rel -= this.L;
      if (Math.abs(rel) <= pad.len / 2 && Math.abs(lateral - pad.lat) <= pad.halfW) return pad;
    }
    return null;
  }

  // World position for a respawn / start slot.
  placeAt(progress, lateral) {
    const p = this.pointAt(progress);
    return {
      pos: p.pos.clone().addScaledVector(p.right, lateral),
      yaw: Math.atan2(p.dir.x, p.dir.z),
      dir: p.dir,
    };
  }

  startGrid() {
    const L = this.L;
    return [
      this.placeAt(L - 7, -2.4),   // front right
      this.placeAt(L - 7, 2.4),    // front left
      this.placeAt(L - 12.5, -2.4),// back right
      this.placeAt(L - 12.5, 2.4), // back left (player)
    ];
  }

  // ------------------------------------------------------------------ racing line
  _buildRacingLine() {
    const n = this.n, step = this.step;
    const vmax = CONFIG.vehicle.maxSpeed;
    const latA = CONFIG.ai.cornerLatAccel;
    const curv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.samples[i].dir;
      const b = this.samples[(i + 4) % n].dir;
      const cross = a.x * b.z - a.z * b.x;
      const dot = a.x * b.x + a.z * b.z;
      const ang = Math.atan2(cross, dot);
      curv[i] = ang / (4 * step);
    }
    const target = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c = Math.abs(curv[i]);
      target[i] = c > 1e-4 ? Math.min(vmax, Math.sqrt(latA / c)) : vmax;
    }
    // backward braking passes so corners are reachable
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 2 * n - 1; i >= 0; i--) {
        const j = i % n, k = (i + 1) % n;
        const reach = Math.sqrt(target[k] * target[k] + 2 * CONFIG.ai.brakePlanningDecel * step);
        if (target[j] > reach) target[j] = reach;
      }
    }
    // preferred lateral offset: hug the inside of corners a little
    const prefLat = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const inside = Math.max(-2.6, Math.min(2.6, -curv[i] * 60));
      const lim = this.samples[i].width / 2 - 2.4;
      prefLat[i] = Math.max(-lim, Math.min(lim, inside));
    }
    this.line = { curv, target, prefLat };
  }

  // Interpolated racing-line info at progress s (progress may exceed L).
  lineAt(s) {
    s = ((s % this.L) + this.L) % this.L;
    const f = (s / this.L) * this.n;
    const i = Math.floor(f) % this.n;
    const j = (i + 1) % this.n;
    const t = f - Math.floor(f);
    const line = this.line;
    return {
      idx: i,
      targetSpeed: line.target[i] + (line.target[j] - line.target[i]) * t,
      prefLat: line.prefLat[i] + (line.prefLat[j] - line.prefLat[i]) * t,
      curv: line.curv[i] + (line.curv[j] - line.curv[i]) * t,
    };
  }
}

const EMPTY_FX = Object.freeze({ wind: 0, gravMult: 1, gripMult: 1, push: 0 });
