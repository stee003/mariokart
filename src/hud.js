// ============================================================================
// HUDManager - DOM-based racing HUD, countdown, notifications, pause and
// results screens. All text is pulled from the LocalizationManager; static
// labels re-render automatically when the language changes.
// ============================================================================

import { CONFIG } from './config.js';
import { formatTime } from './race.js';

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
    };
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
  }

  ordinal(p) { return this.i18n.t(`ordinal.${p}`) || `${p}`; }

  // ------------------------------------------------------------------ state
  showHUD(visible) { this.el.hud.classList.toggle('hidden', !visible); }

  showScreen(id) {
    for (const s of ['screen-main', 'screen-settings', 'screen-pause', 'screen-results']) {
      document.getElementById(s).classList.toggle('hidden', s !== id);
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
