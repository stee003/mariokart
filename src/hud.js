// ============================================================================
// HUDManager - DOM-based racing HUD, countdown, notifications, pause and
// results screens. All text is pulled from the LocalizationManager; static
// labels re-render automatically when the language changes.
// ============================================================================

import { CONFIG } from './config.js';
import { formatTime } from './race.js';
import { ITEMS } from './content/items.js';
import { Minimap } from './minimap.js';

// Canvas-drawn original icons for every power-up (no fonts/assets needed).
export function drawItemIcon(canvas, icon, color) {
  const g = canvas.getContext('2d');
  const s = canvas.width;
  const c = `#${color.toString(16).padStart(6, '0')}`;
  g.clearRect(0, 0, s, s);
  g.save();
  g.translate(s / 2, s / 2);
  g.fillStyle = c; g.strokeStyle = c; g.lineWidth = s * 0.09; g.lineCap = 'round';
  const r = s * 0.36;
  switch (icon) {
    // ---- forward attack ---------------------------------------------------
    case 'lance': {
      // a spear on the diagonal: shaft, hot head, two barbs
      g.beginPath(); g.moveTo(-r * 0.85, r * 0.85); g.lineTo(r * 0.45, -r * 0.45); g.stroke();
      g.beginPath(); g.moveTo(r * 0.95, -r * 0.95); g.lineTo(r * 0.15, -r * 0.72);
      g.lineTo(r * 0.72, -r * 0.15); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-r * 0.1, r * 0.1); g.lineTo(-r * 0.5, r * 0.02); g.stroke();
      g.beginPath(); g.moveTo(-r * 0.45, r * 0.45); g.lineTo(-r * 0.37, r * 0.85); g.stroke();
      break;
    }
    case 'pod': {
      // hexagon shell, three wasps inside
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.closePath(); g.stroke();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        g.beginPath(); g.arc(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, r * 0.19, 0, Math.PI * 2); g.fill();
      }
      break;
    }
    case 'fang': {
      // crystal tooth with a fracture line through it
      g.beginPath(); g.moveTo(0, -r * 1.05); g.lineTo(r * 0.55, -r * 0.1);
      g.lineTo(r * 0.28, r * 0.95); g.lineTo(-r * 0.3, r * 0.9); g.lineTo(-r * 0.55, -r * 0.15);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(20,20,30,0.55)'; g.lineWidth = s * 0.045;
      g.beginPath(); g.moveTo(-r * 0.1, -r * 0.8); g.lineTo(r * 0.12, -r * 0.2);
      g.lineTo(-r * 0.14, r * 0.3); g.lineTo(r * 0.08, r * 0.85); g.stroke();
      break;
    }

    // ---- area denial ------------------------------------------------------
    case 'mortar': {
      // arcing shell onto a target mark
      g.lineWidth = s * 0.06;
      g.beginPath(); g.moveTo(-r * 0.9, r * 0.75);
      g.quadraticCurveTo(-r * 0.1, -r * 1.25, r * 0.75, -r * 0.35); g.stroke();
      g.beginPath(); g.arc(r * 0.78, -r * 0.32, r * 0.22, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(0, r * 0.78, r * 0.62, r * 0.24, 0, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(0, r * 0.45); g.lineTo(0, r * 1.1); g.stroke();
      break;
    }
    case 'mine': {
      // crucible with molten top and inward pull arrows
      g.beginPath(); g.moveTo(-r * 0.62, -r * 0.15); g.lineTo(r * 0.62, -r * 0.15);
      g.lineTo(r * 0.4, r * 0.8); g.lineTo(-r * 0.4, r * 0.8); g.closePath(); g.fill();
      g.beginPath();
      for (let x = -r * 0.66; x <= r * 0.66; x += r / 5) g.lineTo(x, -r * 0.3 + Math.sin(x * 0.16) * r * 0.14);
      g.stroke();
      for (const sgn of [-1, 1]) {
        g.beginPath(); g.moveTo(sgn * r * 1.05, -r * 0.7); g.lineTo(sgn * r * 0.5, -r * 0.62); g.stroke();
        g.beginPath(); g.moveTo(sgn * r * 0.5, -r * 0.62); g.lineTo(sgn * r * 0.72, -r * 0.85); g.stroke();
      }
      break;
    }
    case 'bulwark': {
      // staggered brick gate on a base line
      for (let row = 0; row < 3; row++) {
        const y = r * 0.55 - row * r * 0.55;
        const off = row % 2 ? r * 0.3 : 0;
        for (let i = -1; i <= 1; i++) {
          const x = i * r * 0.66 + off;
          g.fillRect(x - r * 0.29, y - r * 0.24, r * 0.58, r * 0.48);
        }
      }
      g.beginPath(); g.moveTo(-r * 1.05, r * 0.95); g.lineTo(r * 1.05, r * 0.95); g.stroke();
      break;
    }
    case 'veil': {
      // three drifting dust bands with speckles
      for (let b = 0; b < 3; b++) {
        const y = -r * 0.6 + b * r * 0.6;
        g.beginPath();
        for (let x = -r; x <= r; x += r / 5) g.lineTo(x, y + Math.sin(x * 0.13 + b * 1.6) * r * 0.2);
        g.stroke();
      }
      for (let i = 0; i < 6; i++) {
        const a = i * 1.7;
        g.beginPath(); g.arc(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7, r * 0.07, 0, Math.PI * 2); g.fill();
      }
      break;
    }
    case 'thorn': {
      // caltrop: four spikes from a hub, one foreshortened
      g.beginPath(); g.arc(0, 0, r * 0.26, 0, Math.PI * 2); g.fill();
      for (const [x, y] of [[0, -1], [-0.95, 0.62], [0.95, 0.62]]) {
        g.beginPath(); g.moveTo(0, 0); g.lineTo(x * r * 1.05, y * r * 1.05); g.stroke();
        g.beginPath(); g.arc(x * r * 1.05, y * r * 1.05, r * 0.1, 0, Math.PI * 2); g.fill();
      }
      g.beginPath(); g.moveTo(0, 0); g.lineTo(r * 0.18, r * 0.24); g.stroke();
      break;
    }

    // ---- mobility ---------------------------------------------------------
    case 'flare': {
      // sunburst: hot core, eight rays
      g.beginPath(); g.arc(0, 0, r * 0.42, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const len = i % 2 ? r * 0.78 : r * 1.05;
        g.beginPath(); g.moveTo(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58);
        g.lineTo(Math.cos(a) * len, Math.sin(a) * len); g.stroke();
      }
      break;
    }
    case 'draft': {
      // three speed chevrons driving forward
      for (let i = 0; i < 3; i++) {
        const x = -r * 0.75 + i * r * 0.62;
        const w = r * (0.34 - i * 0.05);
        g.beginPath(); g.moveTo(x, -r * 0.72); g.lineTo(x + w, 0); g.lineTo(x, r * 0.72); g.stroke();
      }
      g.beginPath(); g.moveTo(r * 0.5, 0); g.lineTo(r * 1.02, 0); g.stroke();
      break;
    }
    case 'glasswalk': {
      // a field of shards you walk over: outlined so it reads as glass
      g.lineWidth = s * 0.055;
      for (let i = 0; i < 3; i++) {
        const x = -r * 0.72 + i * r * 0.72, hh = r * (0.95 - (i % 2) * 0.32);
        g.beginPath(); g.moveTo(x, r * 0.85); g.lineTo(x - r * 0.24, r * 0.85 - hh * 0.5);
        g.lineTo(x, r * 0.85 - hh); g.lineTo(x + r * 0.24, r * 0.85 - hh * 0.5);
        g.closePath(); g.stroke();
      }
      g.beginPath(); g.moveTo(-r * 1.05, r * 0.9); g.lineTo(r * 1.05, r * 0.9); g.stroke();
      break;
    }
    case 'skip': {
      // hop over a dune line
      g.beginPath(); g.moveTo(-r * 1.05, r * 0.75);
      g.quadraticCurveTo(0, -r * 1.2, r * 1.05, r * 0.75); g.stroke();
      g.beginPath(); g.arc(0, -r * 0.42, r * 0.26, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 3; i++) {
        const x = -r * 0.85 + i * r * 0.2;
        g.beginPath(); g.moveTo(x, r * 0.15 - i * r * 0.16); g.lineTo(x - r * 0.24, r * 0.22 - i * r * 0.16); g.stroke();
      }
      break;
    }

    // ---- disruption -------------------------------------------------------
    case 'blight': {
      // corroded gear with drips
      const teeth = 8;
      g.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const rr = i % 2 ? r * 0.62 : r * 0.88;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr - r * 0.1;
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(20,16,12,0.6)'; g.lineWidth = s * 0.05;
      g.beginPath(); g.arc(0, -r * 0.1, r * 0.26, 0, Math.PI * 2); g.stroke();
      for (let i = 0; i < 2; i++) {
        const x = -r * 0.3 + i * r * 0.6;
        g.strokeStyle = c; g.beginPath(); g.moveTo(x, r * 0.62); g.lineTo(x, r * 0.95); g.stroke();
      }
      break;
    }
    case 'jinx': {
      // a spin: circular arrow with a spiral core
      g.beginPath(); g.arc(0, 0, r * 0.78, -0.6, Math.PI * 1.55); g.stroke();
      g.beginPath(); g.moveTo(r * 0.78 * Math.cos(-0.6) - r * 0.05, r * 0.78 * Math.sin(-0.6) - r * 0.34);
      g.lineTo(r * 0.78 * Math.cos(-0.6) + r * 0.3, r * 0.78 * Math.sin(-0.6));
      g.lineTo(r * 0.78 * Math.cos(-0.6) - r * 0.05, r * 0.78 * Math.sin(-0.6) + r * 0.34);
      g.closePath(); g.fill();
      g.beginPath();
      for (let a = 0; a < Math.PI * 3; a += 0.25) {
        const rr = (a / (Math.PI * 3)) * r * 0.42;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        a === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
      break;
    }
    case 'hourglass': {
      // filled top bulb, empty bottom: time running out
      g.beginPath(); g.moveTo(-r * 0.62, -r * 0.95); g.lineTo(r * 0.62, -r * 0.95); g.lineTo(0, 0); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-r * 0.62, r * 0.95); g.lineTo(r * 0.62, r * 0.95); g.lineTo(0, 0); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(-r * 0.78, -r * 0.95); g.lineTo(r * 0.78, -r * 0.95); g.stroke();
      g.beginPath(); g.moveTo(-r * 0.78, r * 0.95); g.lineTo(r * 0.78, r * 0.95); g.stroke();
      g.beginPath(); g.arc(0, r * 0.62, r * 0.1, 0, Math.PI * 2); g.fill();
      break;
    }

    // ---- protection -------------------------------------------------------
    case 'ward': {
      // shield with a hex plate inside
      g.beginPath(); g.moveTo(0, -r * 1.02); g.lineTo(r * 0.82, -r * 0.5); g.lineTo(r * 0.7, r * 0.42);
      g.lineTo(0, r * 1.02); g.lineTo(-r * 0.7, r * 0.42); g.lineTo(-r * 0.82, -r * 0.5); g.closePath(); g.stroke();
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(a) * r * 0.36, y = Math.sin(a) * r * 0.36;
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.closePath(); g.fill();
      break;
    }
    case 'bell': {
      // bell with sound arcs
      g.beginPath(); g.moveTo(-r * 0.62, r * 0.4);
      g.quadraticCurveTo(-r * 0.55, -r * 0.85, 0, -r * 0.85);
      g.quadraticCurveTo(r * 0.55, -r * 0.85, r * 0.62, r * 0.4);
      g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-r * 0.85, r * 0.55); g.lineTo(r * 0.85, r * 0.55); g.stroke();
      g.beginPath(); g.arc(0, r * 0.78, r * 0.16, 0, Math.PI * 2); g.fill();
      g.lineWidth = s * 0.055;
      for (const sgn of [-1, 1]) {
        g.beginPath(); g.arc(sgn * r * 0.9, -r * 0.1, r * 0.34, sgn > 0 ? -1.1 : Math.PI - 1.1, sgn > 0 ? 1.1 : Math.PI + 1.1); g.stroke();
      }
      break;
    }
    case 'decoy': {
      // hollow kart silhouette with a shimmer bar
      g.lineWidth = s * 0.07;
      g.beginPath();
      g.moveTo(-r * 0.95, r * 0.1); g.lineTo(-r * 0.7, -r * 0.35); g.lineTo(r * 0.35, -r * 0.35);
      g.lineTo(r * 0.95, r * 0.1); g.closePath(); g.stroke();
      g.beginPath(); g.arc(-r * 0.55, r * 0.42, r * 0.26, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(r * 0.55, r * 0.42, r * 0.26, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = s * 0.05;
      g.beginPath(); g.moveTo(-r * 0.5, -r * 0.05); g.lineTo(r * 0.6, -r * 0.05); g.stroke();
      break;
    }
    case 'cell': {
      // charged cell with a bolt inside
      g.beginPath();
      g.moveTo(-r * 0.5, -r * 0.78); g.lineTo(r * 0.5, -r * 0.78);
      g.lineTo(r * 0.5, r * 0.78); g.lineTo(-r * 0.5, r * 0.78); g.closePath(); g.stroke();
      g.fillRect(-r * 0.18, -r * 1.02, r * 0.36, r * 0.24);
      g.beginPath(); g.moveTo(r * 0.12, -r * 0.5); g.lineTo(-r * 0.24, r * 0.05);
      g.lineTo(0, r * 0.05); g.lineTo(-r * 0.12, r * 0.55); g.lineTo(r * 0.26, -r * 0.05);
      g.lineTo(0, -r * 0.05); g.closePath(); g.fill();
      break;
    }
    case 'mirror': {
      // reflective sigil: axis line, mirrored chevrons, diamond
      g.beginPath(); g.moveTo(0, -r * 1.05); g.lineTo(0, r * 1.05); g.stroke();
      for (const sgn of [-1, 1]) {
        g.beginPath(); g.moveTo(sgn * r * 0.9, -r * 0.55); g.lineTo(sgn * r * 0.34, 0);
        g.lineTo(sgn * r * 0.9, r * 0.55); g.stroke();
      }
      g.beginPath(); g.moveTo(0, -r * 0.34); g.lineTo(r * 0.26, 0); g.lineTo(0, r * 0.34);
      g.lineTo(-r * 0.26, 0); g.closePath(); g.fill();
      break;
    }

    // ---- gamble -----------------------------------------------------------
    case 'dice': {
      // a die: rounded square, five pips
      g.lineWidth = s * 0.07;
      const k = r * 0.86, rr = r * 0.24;
      g.beginPath();
      g.moveTo(-k + rr, -k); g.lineTo(k - rr, -k); g.quadraticCurveTo(k, -k, k, -k + rr);
      g.lineTo(k, k - rr); g.quadraticCurveTo(k, k, k - rr, k);
      g.lineTo(-k + rr, k); g.quadraticCurveTo(-k, k, -k, k - rr);
      g.lineTo(-k, -k + rr); g.quadraticCurveTo(-k, -k, -k + rr, -k);
      g.closePath(); g.stroke();
      for (const [x, y] of [[-0.42, -0.42], [0.42, -0.42], [0, 0], [-0.42, 0.42], [0.42, 0.42]]) {
        g.beginPath(); g.arc(x * r, y * r, r * 0.13, 0, Math.PI * 2); g.fill();
      }
      break;
    }
    case 'heart': {
      // a heart with a flame at its centre
      g.beginPath(); g.moveTo(0, r * 0.95);
      g.bezierCurveTo(-r * 1.35, r * 0.05, -r * 0.8, -r * 1.05, 0, -r * 0.4);
      g.bezierCurveTo(r * 0.8, -r * 1.05, r * 1.35, r * 0.05, 0, r * 0.95);
      g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,250,220,0.92)';
      g.beginPath(); g.moveTo(0, r * 0.35);
      g.quadraticCurveTo(-r * 0.3, -r * 0.05, -r * 0.06, -r * 0.42);
      g.quadraticCurveTo(r * 0.02, -r * 0.12, r * 0.12, -r * 0.2);
      g.quadraticCurveTo(r * 0.3, r * 0.05, 0, r * 0.35);
      g.closePath(); g.fill();
      break;
    }
    default:
      g.beginPath(); g.arc(0, 0, r * 0.7, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

export class HUDManager {
  constructor(i18n) {
    this.i18n = i18n;
    this.el = {
      hud: document.getElementById('hud'),
      pos: document.getElementById('hud-pos'),
      lap: document.getElementById('hud-lap'),
      time: document.getElementById('hud-time'),
      countdown: document.getElementById('countdown'),
      notify: document.getElementById('notify'),
      wrongway: document.getElementById('wrongway'),
      boostLabel: document.getElementById('boost-label'),
      boostMeter: document.getElementById('boost-meter'),
      segs: [...document.querySelectorAll('#boost-meter .seg .fill')],
      speedBox: document.getElementById('speed-box'),
      speedVal: document.getElementById('speed-val'),
      speedUnit: document.getElementById('speed-unit'),
      resultsHeadline: document.getElementById('results-headline'),
      resultsRows: document.getElementById('results-rows'),
      resultsStats: document.getElementById('results-stats'),
      resultsMedal: document.getElementById('results-medal'),
      resultsMedalRank: document.getElementById('results-medal-rank'),
      resultsConfetti: document.getElementById('results-confetti'),
      finishFx: document.getElementById('finish-fx'),
      finishKicker: document.getElementById('finish-kicker'),
      finishPlace: document.getElementById('finish-place'),
      finishSub: document.getElementById('finish-sub'),
      itemBox: document.getElementById('item-box'),
      itemIcon: document.getElementById('item-icon'),
      itemName: document.getElementById('item-name'),
      minimapBox: document.getElementById('minimap-box'),
      minimap: document.getElementById('minimap'),
    };
    // Track overview. Hidden until a race starts and while the player has
    // turned it off in the settings.
    this.minimap = new Minimap(this.el.minimap);
    this.lastReveal = null;     // timing of the last results reveal (see below)
    this._currentItem = null;
    this.notifyTimer = 0;
    this._lastPos = -1;
    this._lastLap = -1;
    this._lastSpeed = -1;
    this._lastTime = '';

    i18n.onChange(() => this.applyLanguage());
    this.applyLanguage();
  }

  // ---------------------------------------------------------------- language
  applyLanguage() {
    for (const node of document.querySelectorAll('[data-i18n]')) {
      node.textContent = this.i18n.t(node.dataset.i18n);
    }
    for (const node of document.querySelectorAll('[data-i18n-aria-label]')) {
      node.setAttribute('aria-label', this.i18n.t(node.dataset.i18nAriaLabel));
    }
    this.el.boostLabel.textContent = this.i18n.t('hud.boost');
    this.el.wrongway.textContent = this.i18n.t('race.wrongWay');
    this._lastPos = -1;
    this._lastLap = -1;
    this._currentItem = null;   // force item slot re-render in new language
  }

  // Falls back to a plain number if a lobby ever grows past the ordinal
  // dictionary (t() echoes the key when it is missing).
  ordinal(p) {
    const key = `ordinal.${p}`;
    const s = this.i18n.t(key);
    return s === key ? `${p}` : s;
  }

  // ------------------------------------------------------------------ state
  showHUD(visible) {
    this.el.hud.classList.toggle('hidden', !visible);
    // the minimap lives inside the HUD, so it follows it in and out
    this.showMinimap(visible);
  }

  // Exactly one screen is visible at a time. Every element with the
  // .screen class participates, so new screens (mode/track/cup select,
  // garage...) are managed automatically when added to index.html.
  showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) {
      s.classList.toggle('hidden', s.id !== id);
    }
  }

  hideScreens() { this.showScreen(''); }

  onRaceStart() {
    this.el.notify.className = '';
    this.el.countdown.className = '';
    this.hideFinishFx();
    this.lastReveal = null;
    this.el.wrongway.classList.add('hidden');
    this._lastPos = -1; this._lastLap = -1; this._lastSpeed = -1; this._lastTime = '';
  }

  // ------------------------------------------------------------------ updates
  updateRace(race) {
    const player = race.karts.find((k) => k.isPlayer);
    if (!player || !player.vehicle.surf) return;
    const v = player.vehicle;
    const st = race.kartState.get(v);

    // position: rank-coloured chip + a bump animation (and a brief green/red
    // tint) whenever the standing changes
    const pos = race.playerStanding();
    if (pos !== this._lastPos) {
      const wasPos = this._lastPos;
      this._lastPos = pos;
      this.el.pos.textContent = this.ordinal(pos);
      this.el.pos.dataset.rank = String(pos);
      if (wasPos > 0 && race.raceTime > 0.1) {
        const el = this.el.pos;
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
        el.classList.toggle('pos-up', pos < wasPos);
        el.classList.toggle('pos-down', pos > wasPos);
        clearTimeout(this._posTintT);
        this._posTintT = setTimeout(() => el.classList.remove('pos-up', 'pos-down'), 620);
      } else {
        this.el.pos.classList.remove('pos-up', 'pos-down');
      }
    }

    // lap: flash + hot styling when the final lap starts
    const lapShown = Math.min(st.lap + 1, st.laps);
    if (lapShown !== this._lastLap) {
      this._lastLap = lapShown;
      this.el.lap.textContent = this.i18n.t('hud.lapFormat', { lap: lapShown, total: st.laps });
      this.el.lap.dataset.final = lapShown === st.laps ? '1' : '0';
      if (lapShown === st.laps && st.laps > 1) {
        this.el.lap.classList.remove('final-pop');
        void this.el.lap.offsetWidth;
        this.el.lap.classList.add('final-pop');
      }
    }

    // timer (cheap DOM write only when the rendered string changes)
    const timeStr = formatTime(race.raceTime);
    if (timeStr !== this._lastTime) {
      this._lastTime = timeStr;
      this.el.time.textContent = timeStr;
    }

    // speed: digital readout + the radial gauge fill (0..140 km/h range)
    const kmh = Math.round(v.speedKmh);
    if (kmh !== this._lastSpeed) {
      this._lastSpeed = kmh;
      this.el.speedVal.textContent = String(kmh);
      this.el.speedBox?.style?.setProperty?.('--petrol', Math.max(0, Math.min(1, kmh / 150)).toFixed(3));
    }
    this.el.speedBox?.classList?.toggle?.('boosting', v.boost.boosting);

    // boost meter
    const levels = CONFIG.drift.levels;
    const charge = v.drift.charge;
    let prev = 0;
    for (let i = 0; i < 3; i++) {
      const span = levels[i] - prev;
      const frac = Math.max(0, Math.min(1, (charge - prev) / span));
      this.el.segs[i].style.width = `${frac * 100}%`;
      prev = levels[i];
    }
    const meter = this.el.boostMeter;
    meter.classList.toggle('charged', v.drift.level >= 3);
    meter.classList.toggle('boost-active', v.boost.boosting);

    // minimap
    this.drawMinimap(race.karts, player, race.items);
  }

  // ------------------------------------------------------------- minimap
  // Bake the overview for a freshly loaded track (or arena).
  setMinimapTrack(track) {
    this.minimap?.setTrack(track);
  }

  showMinimap(show) {
    const box = this.el.minimapBox;
    if (!box) return;
    const on = !!show && this.minimapEnabled !== false;
    box.classList.toggle('hidden', !on);
    if (!on) this.minimap?.clear();
  }

  // Settings toggle: remembered by the caller, applied here.
  setMinimapEnabled(on) {
    this.minimapEnabled = !!on;
    if (!on) this.showMinimap(false);
  }

  drawMinimap(karts, player, items = null) {
    if (this.minimapEnabled === false) return;
    if (this.el.minimapBox?.classList.contains('hidden')) return;
    this.minimap?.draw(karts, player, items);
  }

  // ------------------------------------------------------------------ center
  countdown(text, isGo = false) {
    const el = this.el.countdown;
    el.textContent = text;
    el.classList.remove('pop');
    el.classList.toggle('go', !!isGo);
    void el.offsetWidth; // restart animation
    el.classList.add('pop');
  }

  notify(text) {
    const el = this.el.notify;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  setWrongWay(on) {
    this.el.wrongway.classList.toggle('hidden', !on);
  }

  // Held power-up slot -------------------------------------------------------
  setItem(itemId) {
    if (!this.el.itemBox) return;
    if (!itemId) {
      this._currentItem = null;
      this.el.itemBox.classList.add('hidden');
      return;
    }
    if (itemId === this._currentItem) return;
    this._currentItem = itemId;
    const def = ITEMS[itemId];
    if (!def) { this.el.itemBox.classList.add('hidden'); return; }
    this.el.itemBox.classList.remove('hidden');
    drawItemIcon(this.el.itemIcon, def.icon, def.color);
    this.el.itemName.textContent = this.i18n.t(def.nameKey);
  }

  // ------------------------------------------------------- finish cinematic
  // Kicked off the instant the player crosses the line (RaceManager
  // ._kartFinished). Every beat is a CSS animation on #finish-fx started by a
  // single class toggle - light flash, checkered flag wipe, sunburst rays,
  // then the placing banner slamming in - so the sequence costs nothing per
  // frame and stays in step with the camera sweep underneath it. The layer is
  // pointer-transparent and is retired by hideFinishFx() when the results card
  // takes over; it also self-fades via animation-fill-mode if that never
  // happens (e.g. the player quits to the menu mid-cinematic).
  finishFx(pos) {
    const box = this.el.finishFx;
    if (!box) return null;
    const win = pos === 1;
    const podium = pos <= 3;
    box.classList.toggle('fx-win', win);
    box.classList.toggle('fx-podium', podium && !win);
    box.classList.toggle('fx-back', !podium);
    if (this.el.finishKicker) this.el.finishKicker.textContent = this.i18n.t('race.finishKicker');
    if (this.el.finishPlace) this.el.finishPlace.textContent = this.ordinal(pos);
    if (this.el.finishSub) {
      this.el.finishSub.textContent = this.i18n.t(
        win ? 'race.finishSubWin' : podium ? 'race.finishSubPodium' : 'race.finishSubDone');
    }
    box.classList.remove('hidden');
    box.classList.remove('play');
    void box.offsetWidth;                 // force reflow: restarts the timeline
    box.classList.add('play');
    return box;
  }

  hideFinishFx() {
    const box = this.el.finishFx;
    if (!box) return;
    box.classList.remove('play');
    box.classList.add('hidden');
  }

  // Dim the race chrome while the finish cinematic plays, so the banner and
  // the sweeping camera are the only things on screen. The overlay itself
  // lives inside #hud and is deliberately not affected.
  setCinematic(on) {
    const hud = this.el.hud;
    if (!hud) return;
    const want = !!on;
    if (this._cine === want) return;
    this._cine = want;
    hud.classList.toggle('cine', want);
  }

  // Stagger helpers, shared with callers that build their own results table
  // (battle mode writes rows straight into #results-rows).
  revealRow(el, index) {
    if (!el) return;
    el.classList.add('row-in');
    if (el.style) {
      el.style.animationDelay =
        `${(RESULTS_REVEAL.rowFirst + index * RESULTS_REVEAL.rowStep).toFixed(3)}s`;
    }
  }

  revealHeadline(el, delay = RESULTS_REVEAL.headline) { this._restart(el, 'reveal', delay); }

  // Restart a CSS animation on an element that may already be playing it,
  // with an optional delay. `void offsetWidth` is the standard reflow trick.
  _restart(el, cls, delay = 0) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    if (el.style) el.style.animationDelay = delay ? `${delay.toFixed(3)}s` : '';
    el.classList.add(cls);
  }

  // Count a race time up from zero for the reveal. Without rAF (headless
  // tests) the final value is written straight away.
  _countUp(el, seconds, delay = 0, dur = 0.62) {
    if (!el) return;
    const text = formatTime(seconds);
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
    if (!raf || !Number.isFinite(seconds) || seconds <= 0) { el.textContent = text; return; }
    const t0 = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) + delay * 1000;
    const tick = () => {
      const now = performance.now ? performance.now() : Date.now();
      const k = (now - t0) / (dur * 1000);
      if (k < 0) { raf(tick); return; }
      if (k >= 1) { el.textContent = text; return; }
      el.textContent = formatTime(seconds * (1 - Math.pow(1 - k, 3)));
      raf(tick);
    };
    raf(tick);
  }

  // DOM confetti over the results card. Pieces are created once, then left to
  // CSS: each falls from above the card with its own sway, spin and colour.
  //
  // The scatter comes from a SEEDED generator, never Math.random: gameplay
  // (AI lines, item roulette, dust) draws from the global stream, and a
  // cosmetic effect silently re-rolling it would change how the next race
  // drives. Seeding from the result itself keeps a given finish looking the
  // same on a replay.
  spawnConfetti(n, seed = 1) {
    const layer = this.el.resultsConfetti;
    if (!layer) return;
    layer.innerHTML = '';
    if (!n) { layer.classList.add('hidden'); return; }
    layer.classList.remove('hidden');
    const rnd = mulberry32(seed);
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = `spark s${i % 5}`;
      const st = p.style;
      st.left = `${(2 + rnd() * 96).toFixed(2)}%`;
      st.animationDelay = `${(rnd() * 1.5).toFixed(2)}s`;
      st.animationDuration = `${(2.6 + rnd() * 2).toFixed(2)}s`;
      const size = (6 + rnd() * 7).toFixed(1);
      st.width = size; st.height = size;
      // custom property drives the horizontal sway; harmless when absent
      if (st.setProperty) st.setProperty('--drift', `${(rnd() * 2 - 1).toFixed(2)}`);
      layer.appendChild(p);
    }
  }

  // ------------------------------------------------------------------ results
  showResults(data) {
    const i18n = this.i18n;
    const playerPos = data.playerPos || 1;
    const win = playerPos === 1;
    const podium = playerPos <= 3;
    const headline = win ? i18n.t('results.victory')
      : podium ? i18n.t('results.podium')
      : i18n.t('results.done');

    // the finish banner has had its moment; hand the screen to the card
    this.hideFinishFx();

    const rows = data.rows || [];
    const T = RESULTS_REVEAL;
    const rowAt = (i) => T.rowFirst + i * T.rowStep;
    const statsAt = rowAt(rows.length) + T.statsGap;
    const buttonsAt = statsAt + T.buttonsGap;

    // headline
    this.el.resultsHeadline.textContent = headline;
    this.revealHeadline(this.el.resultsHeadline, T.headline);

    // medal plate for a podium finish
    const medal = this.el.resultsMedal;
    if (medal) {
      medal.classList.toggle('hidden', !podium);
      medal.classList.remove('gold');
      medal.classList.remove('silver');
      medal.classList.remove('bronze');
      if (podium) medal.classList.add(['gold', 'silver', 'bronze'][playerPos - 1]);
      if (this.el.resultsMedalRank) this.el.resultsMedalRank.textContent = this.ordinal(playerPos);
      this._restart(medal, 'drop', T.medal);
    }

    // Rows are appended synchronously (callers assert on them immediately);
    // the stagger lives entirely in per-row animation-delay.
    this.el.resultsRows.innerHTML = '';
    rows.forEach((row, i) => {
      const div = document.createElement('div');
      div.className = 'result-row' + (row.isPlayer ? ' you' : '');
      this.revealRow(div, i);
      const pos = document.createElement('span');
      pos.className = 'result-pos';
      pos.textContent = this.ordinal(row.pos);
      const name = document.createElement('span');
      name.className = 'result-name';
      name.textContent = i18n.t(row.nameKey);
      const time = document.createElement('span');
      time.className = 'result-time';
      time.textContent = row.finished ? formatTime(row.time) : '—';
      div.append(pos, name, time);
      this.el.resultsRows.appendChild(div);
      // the player's own time counts up as its row lands
      if (row.isPlayer && row.finished) this._countUp(time, row.time, rowAt(i) + 0.12);
    });

    // stats, built as nodes so each value can count up
    const stats = this.el.resultsStats;
    stats.innerHTML = '';
    const totalEl = this._statLine(stats, `${i18n.t('results.time')}:`, data.totalTime, statsAt);
    this._statLine(stats, `${i18n.t('results.bestLap')}:`, data.bestLap, statsAt + 0.12);
    this._restart(stats, 'stat-in', statsAt);

    // buttons arrive last so the eye reads the table first
    const card = stats.parentNode;
    const buttons = card && card.querySelector ? card.querySelector('.menu-buttons') : null;
    if (buttons) this._restart(buttons, 'btns-in', buttonsAt);

    this.spawnConfetti(win ? T.confettiWin : podium ? T.confettiPodium : 0,
      revealSeed(data));

    this.showScreen('screen-results');

    // Timing of this reveal, so the caller can schedule matching audio.
    this.lastReveal = {
      win, podium, playerPos, rows: rows.length,
      medal: T.medal, rowAt, statsAt, buttonsAt,
      rowTimes: rows.map((r) => (r.isPlayer && r.finished ? r.time : null)),
      totalEl,
    };
    return this.lastReveal;
  }

  // One "Label: value" stats row; the value counts up on reveal.
  _statLine(parent, label, seconds, delay) {
    const line = document.createElement('div');
    line.className = 'stat-line';
    const k = document.createElement('span');
    k.textContent = label;
    const v = document.createElement('b');
    v.textContent = formatTime(seconds);
    line.append(k, v);
    parent.appendChild(line);
    this._countUp(v, seconds, delay + 0.1);
    return v;
  }
}

// Small deterministic PRNG (mulberry32) for cosmetic scatter.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Turn a result into a stable 32-bit seed: same finish, same confetti.
function revealSeed(data) {
  const ms = Math.round((Number(data.totalTime) || 0) * 1000);
  const lap = Math.round((Number(data.bestLap) || 0) * 1000);
  return ((ms * 2654435761) ^ (lap * 40503) ^ ((data.playerPos || 1) * 97)
    ^ ((data.rows?.length || 0) * 31)) >>> 0;
}

// Reveal timeline for the results card, in seconds from the moment the card
// appears. Exported because main.js schedules the audio (medal bell, one tick
// per row, the closing "locked in" pair) against exactly these numbers, so the
// two stay in step if the pacing is ever retuned.
export const RESULTS_REVEAL = {
  medal: 0.14,        // podium plate drops in
  headline: 0.26,     // headline sweeps up
  rowFirst: 0.38,     // first row
  rowStep: 0.085,     // per-row stagger
  statsGap: 0.14,     // stats after the last row
  buttonsGap: 0.16,   // buttons after the stats
  confettiWin: 44,
  confettiPodium: 26,
};
