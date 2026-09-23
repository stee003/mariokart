// ============================================================================
// TrackManager - "Sunforge Circuit": an original desert-canyon loop.
// Builds the centerline spline, road samples, ramps, boost pads, moving
// obstacles, checkpoints, a shortcut and the AI racing line.
// All gameplay queries (ground height, on-road tests, progress) live here.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { CONFIG } from './config.js';

// Control points of the closed loop: x, elevation y, z, road width w.
const CONTROL_POINTS = [
  { x: -202, y: 0,    z: -162, w: 26 },  // 0  start/finish straight (wide intro)
  { x: -27,  y: 0,    z: -162, w: 26 },  // 1
  { x: 105,  y: 0,    z: -157, w: 22 },  // 2
  { x: 205,  y: 1.5,  z: -140, w: 17 },  // 3  approach to the drift corner
  { x: 267,  y: 3,    z: -84,  w: 15 },  // 4  drifting corner apex (tight)
  { x: 224,  y: 5.5,  z: 11,   w: 15 },  // 5  east straight, ramp zone
  { x: 178,  y: 9.5,  z: 186,  w: 14 },  // 6  climb to the bridge
  { x: 81,   y: 12,   z: 251,  w: 13 },  // 7  bridge deck over the gap
  { x: -41,  y: 11.5, z: 273,  w: 13 },  // 8  north straight, tunnel ahead
  { x: -162, y: 8.5,  z: 259,  w: 12 },  // 9
  { x: -232, y: 5.5,  z: 200,  w: 11.5 },// 10 narrow canyon entrance
  { x: -259, y: 3.5,  z: 105,  w: 11 },  // 11 canyon chicane (shortcut splits)
  { x: -230, y: 2.5,  z: 14,   w: 11 },  // 12 chicane bulge
  { x: -273, y: 1.5,  z: -73,  w: 12 },  // 13 canyon exit (shortcut rejoins)
  { x: -267, y: 0.5,  z: -140, w: 18 },  // 14 large final sweeper
];

// 1D Catmull-Rom interpolation used for road width.
function catmull1(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

const UP = new THREE.Vector3(0, 1, 0);

export class TrackManager {
  constructor() {
    this.step = 1.5;
    this.samples = [];
    this._buildCenterline();
    this._buildShortcut();
    this._buildFeatures();
    this._buildRacingLine();
  }

  // ------------------------------------------------------------------ spline
  _buildCenterline() {
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
    const entryProg = this.L * 0.805;
    const exitProg = this.L * 0.885;
    const a = this.pointAt(entryProg), b = this.pointAt(exitProg);
    const entry = a.pos.clone().addScaledVector(a.right, 3.4);
    const exit = b.pos.clone().addScaledVector(b.right, 4.6);
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
      samples.push({ pos, dir: dir.clone(), right: right.clone(), s: t * len, width: 7.2 });
    }
    this.shortcut = { samples, entryProg, exitProg, halfW: 3.6, len };
  }

  // ---------------------------------------------------------------- features
  _buildFeatures() {
    const L = this.L;
    // Ramps: {s0, s1, lat, halfW, rise}. Surface climbs from road to lip.
    this.ramps = [
      this._mkRamp(0.40 * L, 14, 0, 4.2, 2.6),      // east straight, onto the bridge
      this._mkRamp(0.59 * L, 10, 0, 4.0, 1.8),      // end of the bridge deck hop
      this._mkRamp(0.058 * L, 9, -3.5, 3.5, 1.4),   // small kicker after the start
    ];

    // Boost pads: {s, lat, halfW, len}
    this.pads = [
      { s: 0.13 * L, lat: 3, halfW: 2.3, len: 5 },
      { s: 0.13 * L, lat: -3, halfW: 2.3, len: 5 },
      { s: 0.375 * L, lat: 0, halfW: 2.6, len: 5 },
      { s: 0.555 * L, lat: 0, halfW: 2.6, len: 5 },
      { s: 0.935 * L, lat: 0, halfW: 2.6, len: 5 },
    ];
    // pads inside the shortcut
    const sc = this.shortcut;
    for (const f of [0.35, 0.72]) {
      const idx = Math.min(sc.samples.length - 1, Math.floor(f * sc.samples.length));
      const sm = sc.samples[idx];
      this.pads.push({ s: sm.pos.x, lat: 0, halfW: 2.6, len: 4.5, shortcut: true, scFrac: f });
    }

    // Checkpoints in strict order; index 0 is the start/finish line.
    this.checkpoints = [0, 0.10, 0.355, 0.385, 0.53, 0.625, 0.712, 0.765, 0.905, 0.965]
      .map((f, idx) => {
        const p = this.pointAt(f * L);
        const halfW = idx === 0 ? p.width / 2 + 6
          : idx === 8 ? p.width / 2 + 14   // must also cover the shortcut exit
          : p.width / 2 + 7;
        return { s: f * L, halfW, idx };
      });

    // Item box rows (used by ItemSystem when power-ups are enabled).
    // Three-lane rows at rhythm points around the lap.
    this.itemBoxes = [];
    for (const f of [0.085, 0.26, 0.44, 0.62, 0.805, 0.94]) {
      for (const lat of [-4, 0, 4]) {
        this.itemBoxes.push({ s: f * L, lat });
      }
    }

    // Decorative / collision ranges (used by environment + camera)
    this.tunnelRange = [0.657 * L, 0.705 * L];
    this.bridgeRange = [0.48 * L, 0.585 * L];
    this.canyonRange = [0.72 * L, 0.915 * L];

    // Moving obstacles -------------------------------------------------
    const gearAt = this.pointAt(0.84 * L);
    this.gear = {
      center: gearAt.pos.clone().addScaledVector(gearAt.right, 2.0),
      armRadius: 6.4, angle: 0, speed: 0.85,
    };
    this.gear.center.y = gearAt.pos.y;

    const sliderAt = this.pointAt(0.645 * L);
    this.slider = {
      base: sliderAt.pos.clone(), right: sliderAt.right.clone(),
      amp: sliderAt.width / 2 + 0.8, phase: 0, speed: 2.2, radius: 1.6,
      pos: sliderAt.pos.clone(),
    };
    this.slider.pos.y = sliderAt.pos.y + 1.0;
    this.baseY = sliderAt.pos.y;
  }

  _mkRamp(s0, len, lat, halfW, rise) {
    const p = this.pointAt(s0);
    return { s0, s1: s0 + len, lat, halfW, rise, baseY: p.pos.y, dir: p.dir.clone(), len };
  }

  update(dt, time) {
    this.gear.angle += this.gear.speed * dt;
    const t = this.slider;
    t.phase += t.speed * dt;
    const off = Math.sin(t.phase) * t.amp;
    t.pos.copy(t.base).addScaledVector(t.right, off);
    t.pos.y = this.baseY + 1.0;
  }

  // Circular colliders for the moving obstacles this frame.
  getObstacleColliders() {
    const g = this.gear, out = [];
    for (let k = 1; k <= 2; k++) {
      const r = (g.armRadius * k) / 2;
      out.push({
        x: g.center.x + Math.cos(g.angle) * r,
        z: g.center.z + Math.sin(g.angle) * r,
        r: k === 2 ? 1.5 : 1.2, hit: 'gear',
      });
      out.push({
        x: g.center.x - Math.cos(g.angle) * r,
        z: g.center.z - Math.sin(g.angle) * r,
        r: k === 2 ? 1.5 : 1.2, hit: 'gear',
      });
    }
    out.push({ x: this.slider.pos.x, z: this.slider.pos.z, r: this.slider.radius, hit: 'slider' });
    return out;
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
    let best = -1, bestD = Infinity, bestAlong = 0, bestLat = 0;
    const test = (i) => {
      const sm = samples[((i % m) + m) % m];
      const dx = pos.x - sm.pos.x, dz = pos.z - sm.pos.z;
      const along = dx * sm.dir.x + dz * sm.dir.z;
      const lat = dx * sm.right.x + dz * sm.right.z;
      const d = lat * lat + Math.min(0, along) * Math.min(0, along) * 0.25 + Math.max(0, along - this.step) ** 2 * 0.25;
      if (d < bestD) { bestD = d; best = ((i % m) + m) % m; bestAlong = along; bestLat = lat; }
    };
    if (hintIdx >= 0) {
      for (let k = -window; k <= window; k++) test(hintIdx + k);
    } else {
      for (let i = 0; i < m; i += 2) test(i);
      const h = best;
      for (let k = -2; k <= 2; k++) test(h + k);
    }
    return { idx: best, along: bestAlong, lat: bestLat };
  }

  // Full surface query: main loop + shortcut + ramps.
  // Returns progress, lateral, ground y, direction, road state.
  surface(pos, hint = { main: -1, sc: -1 }) {
    const main = this._nearest(pos, this.samples, hint.main, 24);
    hint.main = main.idx;
    const sm = this.samples[main.idx];

    let useShortcut = false;
    let sc = null;
    if (this.shortcut) {
      sc = this._nearest(pos, this.shortcut.samples, hint.sc, 24);
      hint.sc = sc.idx;
      const scS = this.shortcut.samples[sc.idx];
      const mainW = sm.width / 2 + 4;
      const scW = this.shortcut.halfW + 4;
      if (Math.abs(sc.lat) < Math.min(Math.abs(main.lat), scW) && Math.abs(sc.lat) < mainW) {
        if (Math.abs(sc.lat) < Math.abs(main.lat)) useShortcut = true;
      }
    }

    let progress, lateral, dir, width, y, onRoad, onShoulder;
    if (useShortcut) {
      const scS = this.shortcut.samples[sc.idx];
      const frac = Math.min(1, Math.max(0, (sc.idx * this.step + sc.along) / this.shortcut.len));
      progress = this.shortcut.entryProg + frac * (this.shortcut.exitProg - this.shortcut.entryProg);
      lateral = sc.lat; dir = scS.dir; width = scS.width;
      y = scS.pos.y;
      onRoad = Math.abs(lateral) <= width / 2;
      onShoulder = Math.abs(lateral) <= width / 2 + 2.2;
    } else {
      const frac = Math.min(1, Math.max(-1, main.along / this.step));
      const j = (main.idx + 1) % this.n;
      const sj = this.samples[j];
      progress = ((sm.s + main.along) % this.L + this.L) % this.L;
      lateral = main.lat;
      dir = sm.dir;
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

    return { progress, lateral, y, dir, width, onRoad, onShoulder, onRamp, rampExitSoon, useShortcut,
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
