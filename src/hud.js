// ============================================================================
// HUDManager - DOM-based racing HUD, countdown, notifications, pause and
// results screens. All text is pulled from the LocalizationManager; static
// labels re-render automatically when the language changes.
// ============================================================================

import { CONFIG } from './config.js';
import { formatTime } from './race.js';
import { ITEMS } from './content/items.js';

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
    case 'bolt':
      g.beginPath(); g.moveTo(r * 0.3, -r); g.lineTo(-r * 0.5, r * 0.15); g.lineTo(0, r * 0.15);
      g.lineTo(-r * 0.3, r); g.lineTo(r * 0.5, -r * 0.15); g.lineTo(0, -r * 0.15); g.closePath(); g.fill();
      break;
    case 'anchor':
      g.beginPath(); g.arc(0, -r * 0.6, r * 0.28, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(0, -r * 0.3); g.lineTo(0, r * 0.7); g.stroke();
      g.beginPath(); g.arc(0, r * 0.3, r * 0.6, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
      break;
    case 'ghost':
      g.beginPath(); g.arc(0, -r * 0.2, r * 0.6, Math.PI, 0); g.lineTo(r * 0.6, r * 0.7);
      for (let i = 2; i >= -2; i--) g.lineTo(i * r * 0.3, r * (0.7 - (i % 2 === 0 ? 0 : -0.2)));
      g.closePath(); g.fill();
      break;
    case 'ring':
      g.beginPath(); g.arc(0, 0, r * 0.8, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(0, 0, r * 0.35, 0, Math.PI * 2); g.stroke();
      break;
    case 'core':
      g.beginPath(); g.arc(0, 0, r * 0.5, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.beginPath(); g.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.stroke();
      }
      break;
    case 'spiral':
      g.beginPath();
      for (let a = 0; a < Math.PI * 4; a += 0.2) {
        const rr = (a / (Math.PI * 4)) * r;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        a === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
      break;
    case 'shield':
      g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.8, -r * 0.5); g.lineTo(r * 0.7, r * 0.4);
      g.lineTo(0, r); g.lineTo(-r * 0.7, r * 0.4); g.lineTo(-r * 0.8, -r * 0.5); g.closePath(); g.stroke();
      break;
    case 'hourglass':
      g.beginPath(); g.moveTo(-r * 0.6, -r); g.lineTo(r * 0.6, -r); g.lineTo(0, 0); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-r * 0.6, r); g.lineTo(r * 0.6, r); g.lineTo(0, 0); g.closePath(); g.stroke();
      break;
    case 'magnet':
      g.beginPath(); g.arc(0, -r * 0.1, r * 0.65, Math.PI, 0); g.stroke();
      g.fillRect(-r * 0.78, -r * 0.1, r * 0.28, r * 0.8);
      g.fillRect(r * 0.5, -r * 0.1, r * 0.28, r * 0.8);
      break;
    case 'drone':
      g.beginPath(); g.arc(0, 0, r * 0.35, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(-r, -r * 0.6); g.lineTo(r, r * 0.6); g.moveTo(r, -r * 0.6); g.lineTo(-r, r * 0.6); g.stroke();
      break;
    case 'snare':
      g.beginPath(); g.arc(0, -r * 0.2, r * 0.55, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(0, r * 0.35); g.quadraticCurveTo(r * 0.4, r * 0.8, 0, r); g.stroke();
      break;
    case 'wall':
      for (let i = -1; i <= 1; i++) g.fillRect(i * r * 0.62 - r * 0.14, -r * 0.8, r * 0.28, r * 1.6);
      break;
    case 'harpoon':
      g.beginPath(); g.moveTo(-r * 0.8, r * 0.8); g.lineTo(r * 0.6, -r * 0.6); g.stroke();
      g.beginPath(); g.moveTo(r * 0.7, -r * 0.7); g.lineTo(r * 0.2, -r * 0.75); g.lineTo(r * 0.75, -r * 0.2); g.closePath(); g.fill();
      break;
    case 'bloom':
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        g.beginPath(); g.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.3, 0, Math.PI * 2); g.fill();
      }
      break;
    case 'shard':
      g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.5, 0); g.lineTo(0, r); g.lineTo(-r * 0.5, 0); g.closePath(); g.fill();
      break;
    case 'lash':
      g.beginPath(); g.moveTo(-r * 0.8, r * 0.6);
      g.quadraticCurveTo(-r * 0.2, -r * 0.9, r * 0.3, -r * 0.2);
      g.quadraticCurveTo(r * 0.9, r * 0.4, r * 0.6, -r * 0.8); g.stroke();
      break;
    case 'beacon':
      g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.5, r * 0.5); g.lineTo(-r * 0.5, r * 0.5); g.closePath(); g.fill();
      g.beginPath(); g.arc(0, -r, r * 0.2, 0, Math.PI * 2); g.fill();
      break;
    case 'well':
      g.beginPath(); g.arc(0, 0, r * 0.35, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(0, 0, r, r * 0.4, 0.4, 0, Math.PI * 2); g.stroke();
      break;
    case 'cell':
      g.fillRect(-r * 0.4, -r * 0.8, r * 0.8, r * 1.6);
      g.fillRect(-r * 0.15, -r, r * 0.3, r * 0.2);
      break;
    case 'swarm':
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4, rr = r * (0.3 + (i % 3) * 0.25);
        g.beginPath(); g.arc(Math.cos(a) * rr, Math.sin(a) * rr, r * 0.14, 0, Math.PI * 2); g.fill();
      }
      break;
    case 'veil':
      g.beginPath();
      for (let x = -r; x <= r; x += r / 4) g.lineTo(x, Math.sin(x * 0.12) * r * 0.35);
      g.stroke();
      g.beginPath();
      for (let x = -r; x <= r; x += r / 4) g.lineTo(x, r * 0.6 + Math.sin(x * 0.12 + 1) * r * 0.3);
      g.stroke();
      break;
    case 'siphon':
      g.beginPath(); g.moveTo(-r * 0.8, -r * 0.5); g.lineTo(r * 0.2, -r * 0.2); g.stroke();
      g.beginPath(); g.moveTo(-r * 0.8, r * 0.5); g.lineTo(r * 0.2, r * 0.2); g.stroke();
      g.beginPath(); g.arc(r * 0.5, 0, r * 0.35, 0, Math.PI * 2); g.fill();
      break;
    default:
      g.beginPath(); g.arc(0, 0, r * 0.7, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

// Every full-screen panel the state machine can show. Listed here (instead of
// hardcoding a subset inside showScreen) so adding a screen can never leave
// the previous one visible on top of it.
export const SCREEN_IDS = [
  'screen-main', 'screen-settings', 'screen-pause', 'screen-results',
  'screen-mode', 'screen-trackselect', 'screen-cupselect', 'screen-battleselect',
  'screen-garage', 'screen-records', 'screen-online',
];

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
      speedVal: document.getElementById('speed-val'),
      speedUnit: document.getElementById('speed-unit'),
      resultsHeadline: document.getElementById('results-headline'),
      resultsRows: document.getElementById('results-rows'),
      resultsStats: document.getElementById('results-stats'),
      battleBoard: document.getElementById('battle-board'),
      itemBox: document.getElementById('item-box'),
      itemIcon: document.getElementById('item-icon'),
      itemName: document.getElementById('item-name'),
    };
    this._currentItem = null;
    this.notifyTimer = 0;
    this._lastPos = -1;
    this._lastLap = -1;
    this._lastSpeed = -1;

    i18n.onChange(() => this.applyLanguage());
    this.applyLanguage();
  }

  // ---------------------------------------------------------------- language
  applyLanguage() {
    for (const node of document.querySelectorAll('[data-i18n]')) {
      node.textContent = this.i18n.t(node.dataset.i18n);
    }
    this.el.boostLabel.textContent = this.i18n.t('hud.boost');
    this.el.wrongway.textContent = this.i18n.t('race.wrongWay');
    this._lastPos = -1;
    this._lastLap = -1;
    this._currentItem = null;   // force item slot re-render in new language
  }

  ordinal(p) { return this.i18n.t(`ordinal.${p}`) || `${p}`; }

  // ------------------------------------------------------------------ state
  showHUD(visible) { this.el.hud.classList.toggle('hidden', !visible); }

  showScreen(id) {
    for (const s of SCREEN_IDS) {
      const node = document.getElementById(s);
      if (node) node.classList.toggle('hidden', s !== id);
    }
  }

  hideScreens() { this.showScreen(''); }

  onRaceStart() {
    this.el.notify.className = '';
    this.el.countdown.className = '';
    this.el.wrongway.classList.add('hidden');
    this._lastPos = -1; this._lastLap = -1; this._lastSpeed = -1;
  }

  // ------------------------------------------------------------------ updates
  updateRace(race) {
    const player = race.karts.find((k) => k.isPlayer);
    if (!player || !player.vehicle.surf) return;
    const v = player.vehicle;
    const st = race.kartState.get(v);

    // position
    const pos = race.playerStanding();
    if (pos !== this._lastPos) {
      this._lastPos = pos;
      this.el.pos.textContent = this.ordinal(pos);
    }

    // lap
    const lapShown = Math.min(st.lap + 1, st.laps);
    if (lapShown !== this._lastLap) {
      this._lastLap = lapShown;
      this.el.lap.textContent = this.i18n.t('hud.lapFormat', { lap: lapShown, total: st.laps });
    }

    // timer
    this.el.time.textContent = formatTime(race.raceTime);

    // speed
    const kmh = Math.round(v.speedKmh);
    if (kmh !== this._lastSpeed) {
      this._lastSpeed = kmh;
      this.el.speedVal.textContent = String(kmh);
    }

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
  }

  // ------------------------------------------------------------- battle board
  // rows: [{ name, value, bar (0..1 | null), isPlayer, eliminated }]
  setBattleBoard(rows) {
    const box = this.el.battleBoard;
    if (!box) return;
    box.innerHTML = '';
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'board-row' + (row.isPlayer ? ' you' : '') + (row.eliminated ? ' out' : '');
      const name = document.createElement('span');
      name.className = 'board-name';
      name.textContent = row.name;
      const value = document.createElement('span');
      value.className = 'board-value';
      value.textContent = row.eliminated ? this.i18n.t('battle.out') : row.value;
      line.append(name, value);
      if (typeof row.bar === 'number') {
        const track = document.createElement('span');
        track.className = 'board-bar';
        const fill = document.createElement('span');
        fill.className = 'board-fill';
        fill.style.width = `${Math.max(0, Math.min(1, row.bar)) * 100}%`;
        track.appendChild(fill);
        line.append(track);
      }
      box.appendChild(line);
    }
  }

  showBattleBoard(on) {
    this.el.battleBoard?.classList.toggle('hidden', !on);
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

  // ------------------------------------------------------------------ results
  showResults(data) {
    const i18n = this.i18n;
    const headline = data.playerPos === 1 ? i18n.t('results.victory')
      : data.playerPos <= 3 ? i18n.t('results.podium')
      : i18n.t('results.done');
    this.el.resultsHeadline.textContent = headline;

    this.el.resultsRows.innerHTML = '';
    for (const row of data.rows) {
      const div = document.createElement('div');
      div.className = 'result-row' + (row.isPlayer ? ' you' : '');
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
    }

    this.el.resultsStats.innerHTML =
      `${i18n.t('results.time')}: <b>${formatTime(data.totalTime)}</b><br>` +
      `${i18n.t('results.bestLap')}: <b>${formatTime(data.bestLap)}</b>`;

    this.showScreen('screen-results');
  }
}
