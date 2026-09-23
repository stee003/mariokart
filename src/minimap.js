// ============================================================================
// Minimap - 2D canvas overview of the current track (or battle arena) with
// live kart blips, item boxes and the player's heading.
//
// Design notes
//   * The track outline is baked ONCE per track into an offscreen canvas
//     (buildTrack). Per-frame work is then just blitting that layer and
//     drawing a handful of blips, so the minimap costs a fraction of a
//     millisecond even with a full eight-kart grid.
//   * World -> map projection is a fit-to-bounds of the centreline sample
//     cloud, with the same scale on both axes so the circuit keeps its real
//     shape. World +x maps right, world +z maps DOWN, matching how the
//     chase camera looks along +z.
//   * The map is north-up (fixed orientation). A rotating map is harder to
//     read at a glance, and the whole point here is letting the player learn
//     the circuit's shape.
// ============================================================================

const PAD = 10;               // px of padding inside the canvas
const ROAD_COLOR = 'rgba(255, 224, 180, 0.22)';
const ROAD_EDGE = 'rgba(255, 190, 120, 0.55)';
const SHORTCUT_COLOR = 'rgba(80, 240, 220, 0.6)';
const START_COLOR = '#ffe08a';
const BOX_COLOR = 'rgba(120, 230, 255, 0.85)';
const PLAYER_COLOR = '#ffffff';
const FINISH_COLOR = '#9affc8';

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas || null;
    this.ctx = canvas?.getContext ? canvas.getContext('2d') : null;
    this.track = null;
    this.layer = null;        // offscreen baked track
    this.scale = 1;
    this.ox = 0; this.oy = 0;
    this.enabled = true;
    this._w = 0; this._h = 0;
  }

  // ---------------------------------------------------------------- setup
  // Bake the static track layer. Call once per loaded track.
  setTrack(track) {
    this.track = track || null;
    this.layer = null;
    if (!this.ctx || !track || !track.samples?.length) return;

    const w = this.canvas.width, h = this.canvas.height;
    this._w = w; this._h = h;

    // fit the centreline (plus its width) into the canvas, preserving aspect
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of track.samples) {
      const half = (s.width ?? 10) / 2 + 2;
      minX = Math.min(minX, s.pos.x - half); maxX = Math.max(maxX, s.pos.x + half);
      minZ = Math.min(minZ, s.pos.z - half); maxZ = Math.max(maxZ, s.pos.z + half);
    }
    const spanX = Math.max(1, maxX - minX), spanZ = Math.max(1, maxZ - minZ);
    this.scale = Math.min((w - PAD * 2) / spanX, (h - PAD * 2) / spanZ);
    // centre the fitted circuit in the canvas
    this.ox = (w - spanX * this.scale) / 2 - minX * this.scale;
    this.oy = (h - spanZ * this.scale) / 2 - minZ * this.scale;

    this.layer = this._bake(w, h);
  }

  // world -> canvas
  _px(x) { return x * this.scale + this.ox; }
  _py(z) { return z * this.scale + this.oy; }

  _makeCanvas(w, h) {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    }
    return null;
  }

  _bake(w, h) {
    const layer = this._makeCanvas(w, h);
    const g = layer?.getContext ? layer.getContext('2d') : null;
    if (!g) return null;
    const track = this.track;
    const pts = track.samples;

    g.clearRect(0, 0, w, h);
    g.lineJoin = 'round';
    g.lineCap = 'round';

    // --- road ribbon: one stroke at the average road width ------------------
    const avgW = pts.reduce((a, s) => a + (s.width ?? 10), 0) / pts.length;
    const strokePx = Math.max(2.5, avgW * this.scale);

    const trace = (samples, close) => {
      g.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i].pos;
        const x = this._px(p.x), y = this._py(p.z);
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      if (close) g.closePath();
    };

    g.strokeStyle = ROAD_EDGE;
    g.lineWidth = strokePx + 2.2;
    trace(pts, true); g.stroke();

    g.strokeStyle = ROAD_COLOR;
    g.lineWidth = strokePx;
    trace(pts, true); g.stroke();

    // --- shortcut chute -----------------------------------------------------
    if (track.shortcut?.samples?.length) {
      g.strokeStyle = SHORTCUT_COLOR;
      g.lineWidth = Math.max(1.6, strokePx * 0.5);
      g.setLineDash([4, 3]);
      trace(track.shortcut.samples, false); g.stroke();
      g.setLineDash([]);
    }

    // --- start / finish line ------------------------------------------------
    const start = track.pointAt(0);
    if (start) {
      const hw = (start.width / 2) * this.scale;
      const rx = start.right.x, rz = start.right.z;
      g.strokeStyle = START_COLOR;
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(this._px(start.pos.x - rx * (start.width / 2)), this._py(start.pos.z - rz * (start.width / 2)));
      g.lineTo(this._px(start.pos.x + rx * (start.width / 2)), this._py(start.pos.z + rz * (start.width / 2)));
      g.stroke();
      void hw;
    }
    return layer;
  }

  // ---------------------------------------------------------------- draw
  // karts: the live kart list; player: the local kart (highlighted).
  // items: optional ItemSystem, for live item-box dots.
  draw(karts, player, items = null) {
    const g = this.ctx;
    if (!g || !this.track) return;
    const w = this._w, h = this._h;
    g.clearRect(0, 0, w, h);
    if (this.layer) g.drawImage(this.layer, 0, 0);

    // --- item boxes ---------------------------------------------------------
    if (items?.boxes?.length) {
      g.fillStyle = BOX_COLOR;
      for (const box of items.boxes) {
        if (box.respawnT > 0) continue;     // hide while respawning
        g.beginPath();
        g.arc(this._px(box.pos.x), this._py(box.pos.z), 1.6, 0, Math.PI * 2);
        g.fill();
      }
    }

    // --- rival blips (drawn first so the player sits on top) ----------------
    for (const kart of karts || []) {
      if (kart === player) continue;
      const v = kart.vehicle;
      if (!v) continue;
      this._blip(g, v, kart.minimapColor ?? 0xff8a2a, false, kart.finished);
    }
    if (player?.vehicle) this._blip(g, player.vehicle, 0xffffff, true, false);
  }

  _blip(g, v, color, isPlayer, finished) {
    const x = this._px(v.pos.x), y = this._py(v.pos.z);
    const r = isPlayer ? 4.6 : 3.4;
    const css = isPlayer ? PLAYER_COLOR
      : finished ? FINISH_COLOR
      : `#${(color >>> 0).toString(16).padStart(6, '0')}`;

    // heading wedge: shows which way the kart is pointing at a glance
    g.save();
    g.translate(x, y);
    // world yaw is measured from +z; canvas +y is world +z, so the screen
    // angle is -yaw with a quarter-turn offset.
    g.rotate(-v.yaw + Math.PI / 2);
    g.fillStyle = css;
    if (isPlayer) {
      g.beginPath();
      g.moveTo(r * 1.5, 0);
      g.lineTo(-r * 0.9, r * 0.95);
      g.lineTo(-r * 0.4, 0);
      g.lineTo(-r * 0.9, -r * 0.95);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(0, 0, 0, 0.65)';
      g.lineWidth = 1.1;
      g.stroke();
    } else {
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      g.lineWidth = 1;
      g.stroke();
    }
    g.restore();
  }

  clear() {
    if (this.ctx) this.ctx.clearRect(0, 0, this._w, this._h);
  }
}
