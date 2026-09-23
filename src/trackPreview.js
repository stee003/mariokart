// ============================================================================
// Track preview thumbnails for the map-selection screens.
//
// Previews are drawn from the REAL track geometry (the same TrackManager the
// race uses), so what the player studies in the menu is exactly the circuit
// they are about to drive - no hand-authored artwork to fall out of sync.
//
// Building a TrackManager costs ~1.3 ms, and each preview is rendered once
// and cached by track id, so opening the menu never stutters.
// ============================================================================

import { TrackManager } from './track.js';

// Per-theme palettes: the thumbnail reads as the world it represents.
const THEMES = {
  desert:  { bg: '#3b2412', road: '#e8b878', edge: '#ffd9a0', accent: '#ff9a3c' },
  forest:  { bg: '#16301f', road: '#8fc79a', edge: '#d6f5cf', accent: '#66e8a0' },
  city:    { bg: '#161a2e', road: '#8fa0d8', edge: '#cfe0ff', accent: '#66c8ff' },
  ice:     { bg: '#162a36', road: '#a8d8ea', edge: '#e6f7ff', accent: '#7fe8ff' },
  volcano: { bg: '#33130e', road: '#d88a6a', edge: '#ffc9a0', accent: '#ff6a3c' },
  sky:     { bg: '#1c2440', road: '#9fb4e8', edge: '#dce8ff', accent: '#8ad0ff' },
  ruins:   { bg: '#2b2418', road: '#c8b98f', edge: '#eee0bc', accent: '#e8c86a' },
  space:   { bg: '#0f1024', road: '#8f8fd8', edge: '#d8d8ff', accent: '#c08aff' },
  ARENA:   { bg: '#241428', road: '#d0a0e0', edge: '#f0d8ff', accent: '#ff5df1' },
};
const DEFAULT_THEME = THEMES.desert;

const PAD = 12;
const _cache = new Map();          // `${id}@${w}x${h}` -> canvas

function paletteFor(def) {
  if (def?.id === 'granite_pass') return { bg: '#203f4b', road: '#99b5bd', edge: '#fff1d4', accent: '#cc7847' };
  if (def?.id === 'abyss_dock') return { bg: '#103344', road: '#6bc1c5', edge: '#d8fff2', accent: '#32aab1' };
  return THEMES[def?.theme] || DEFAULT_THEME;
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  return null;
}

// Render `def` into an offscreen canvas of the given size. Cached by id+size.
export function renderTrackPreview(def, w = 420, h = 236) {
  if (!def) return null;
  const key = `${def.id}@${w}x${h}`;
  if (_cache.has(key)) return _cache.get(key);

  const canvas = makeCanvas(w, h);
  const g = canvas?.getContext ? canvas.getContext('2d') : null;
  if (!g) return null;

  let track;
  try { track = new TrackManager(def); } catch (_e) { return null; }
  const pts = track.samples;
  if (!pts?.length) return null;
  const pal = paletteFor(def);

  // ---------------------------------------------------- fit to bounds
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of pts) {
    const half = (s.width ?? 10) / 2 + 3;
    minX = Math.min(minX, s.pos.x - half); maxX = Math.max(maxX, s.pos.x + half);
    minZ = Math.min(minZ, s.pos.z - half); maxZ = Math.max(maxZ, s.pos.z + half);
  }
  const spanX = Math.max(1, maxX - minX), spanZ = Math.max(1, maxZ - minZ);
  const scale = Math.min((w - PAD * 2) / spanX, (h - PAD * 2) / spanZ);
  const ox = (w - spanX * scale) / 2 - minX * scale;
  const oy = (h - spanZ * scale) / 2 - minZ * scale;
  const px = (x) => x * scale + ox;
  const py = (z) => z * scale + oy;

  // ---------------------------------------------------- background
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, pal.bg);
  grad.addColorStop(1, '#0c0705');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  g.lineJoin = 'round';
  g.lineCap = 'round';

  const trace = (samples, close) => {
    g.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i].pos;
      i === 0 ? g.moveTo(px(p.x), py(p.z)) : g.lineTo(px(p.x), py(p.z));
    }
    if (close) g.closePath();
  };

  const avgW = pts.reduce((a, s) => a + (s.width ?? 10), 0) / pts.length;
  const roadPx = Math.max(3.5, avgW * scale);

  // soft drop shadow so the ribbon lifts off the background
  g.save();
  g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  g.lineWidth = roadPx + 5;
  trace(pts, true); g.stroke();
  g.restore();

  g.strokeStyle = pal.edge;
  g.lineWidth = roadPx + 2;
  trace(pts, true); g.stroke();

  g.strokeStyle = pal.road;
  g.lineWidth = roadPx;
  trace(pts, true); g.stroke();

  // centre dashes for a road-like read
  g.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  g.lineWidth = Math.max(0.8, roadPx * 0.08);
  g.setLineDash([5, 7]);
  trace(pts, true); g.stroke();
  g.setLineDash([]);

  // ---------------------------------------------------- shortcut
  if (track.shortcut?.samples?.length) {
    g.strokeStyle = 'rgba(80, 240, 220, 0.85)';
    g.lineWidth = Math.max(1.6, roadPx * 0.45);
    g.setLineDash([5, 4]);
    trace(track.shortcut.samples, false); g.stroke();
    g.setLineDash([]);
  }

  // ---------------------------------------------------- boost pads
  for (const pad of track.pads || []) {
    const p = track.pointAt(pad.s ?? 0);
    if (!p) continue;
    const x = px(p.pos.x + p.right.x * (pad.lat ?? 0));
    const y = py(p.pos.z + p.right.z * (pad.lat ?? 0));
    g.fillStyle = 'rgba(64, 240, 224, 0.95)';
    g.beginPath(); g.arc(x, y, 2.3, 0, Math.PI * 2); g.fill();
  }

  // ---------------------------------------------------- ramps
  for (const r of track.ramps || []) {
    const p = track.pointAt(r.s0);
    if (!p) continue;
    const x = px(p.pos.x + p.right.x * r.lat);
    const y = py(p.pos.z + p.right.z * r.lat);
    g.fillStyle = 'rgba(255, 224, 138, 0.95)';
    g.beginPath();
    g.moveTo(x, y - 3.4); g.lineTo(x + 3, y + 2.2); g.lineTo(x - 3, y + 2.2);
    g.closePath(); g.fill();
  }

  // ---------------------------------------------------- item boxes
  g.fillStyle = 'rgba(120, 230, 255, 0.8)';
  for (const box of track.itemBoxes || []) {
    const p = track.pointAt(box.s);
    if (!p) continue;
    const x = px(p.pos.x + p.right.x * box.lat);
    const y = py(p.pos.z + p.right.z * box.lat);
    g.fillRect(x - 1.3, y - 1.3, 2.6, 2.6);
  }

  // ---------------------------------------------------- start / finish
  const start = track.pointAt(0);
  if (start) {
    const hw = start.width / 2;
    const ax = px(start.pos.x - start.right.x * hw), ay = py(start.pos.z - start.right.z * hw);
    const bx = px(start.pos.x + start.right.x * hw), by = py(start.pos.z + start.right.z * hw);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    // direction arrow so the player knows which way the lap runs
    g.fillStyle = pal.accent;
    const dx = start.dir.x, dz = start.dir.z;
    const cx = px(start.pos.x + dx * 12), cy = py(start.pos.z + dz * 12);
    const ang = Math.atan2(dz, dx);
    g.save();
    g.translate(cx, cy); g.rotate(ang);
    g.beginPath(); g.moveTo(7, 0); g.lineTo(-4, 4); g.lineTo(-4, -4); g.closePath(); g.fill();
    g.restore();
  }

  _cache.set(key, canvas);
  return canvas;
}

// Blit a preview into a visible canvas element, scaling to fit it.
export function drawPreviewInto(canvasEl, def) {
  if (!canvasEl?.getContext) return false;
  const g = canvasEl.getContext('2d');
  if (!g) return false;
  const w = canvasEl.width, h = canvasEl.height;
  g.clearRect(0, 0, w, h);
  const src = renderTrackPreview(def, w, h);
  if (!src) return false;
  g.drawImage(src, 0, 0, w, h);
  return true;
}

export function clearPreviewCache() { _cache.clear(); }

// At-a-glance facts for the preview pane, measured from the real geometry.
const _stats = new Map();
export function trackPreviewStats(def) {
  if (!def) return null;
  if (_stats.has(def.id)) return _stats.get(def.id);
  let out;
  try {
    const t = new TrackManager(def);
    out = {
      length: t.L,
      laps: def.laps ?? 3,
      difficulty: Math.max(1, Math.min(5, def.difficulty ?? 1)),
      hasShortcut: !!t.shortcut,
      ramps: (t.ramps || []).length,
      pads: (t.pads || []).length,
      boxes: (t.itemBoxes || []).length,
      theme: def.theme || 'desert',
    };
  } catch (_e) {
    out = { length: 0, laps: def.laps ?? 3, difficulty: def.difficulty ?? 1,
            hasShortcut: false, ramps: 0, pads: 0, boxes: 0, theme: def.theme || 'desert' };
  }
  _stats.set(def.id, out);
  return out;
}
