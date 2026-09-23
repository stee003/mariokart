// ============================================================================
// RecordsUI - records / leaderboard / achievements / statistics browser.
//
// Four panels over the same save file:
//   tracks        personal time-trial records (total, best lap, splits, ghost)
//   leaderboard   top-10 for the selected track, local by default and global
//                 through the online provider contract when one is attached
//   achievements  the full list with earned state
//   stats         persistent counters, XP/level progress and cup trophies
//
// All strings come from the LocalizationManager; the screen also owns the
// provider plumbing (ping -> fetch -> graceful offline fallback) so the online
// code never leaks into game systems.
// ============================================================================

import { ACHIEVEMENTS, getStats } from '../achievements.js';
import { getProgress, UNLOCKABLES } from '../progression.js';
import { CUPS } from '../content/cups.js';
import { TRACK_DEFS } from '../content/trackDefs.js';
import { formatTime } from '../race.js';

const $ = (id) => document.getElementById(id);

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// Counter keys shown in the statistics panel, in reading order.
const STAT_ROWS = [
  'races', 'wins', 'podiums', 'laps', 'fastestLaps',
  'records', 'ghostsRaced', 'tracksPlayed',
  'cups', 'cupsGold', 'cupsPlatinum',
  'itemsTaken', 'itemsUsed', 'battles', 'battleWins', 'nightWins',
];

export class RecordsUI {
  constructor({ i18n, save, provider = null, records = null, onBack = null, onPractice = null }) {
    this.i18n = i18n;
    this.save = save;
    this.provider = provider;
    this.records = records;
    this.onBack = onBack || (() => {});
    this.onPractice = onPractice || (() => {});
    this.visible = false;
    this.trackId = null;
    this.onlineState = 'idle';      // idle | loading | ok | offline
    this.onlineRows = null;
    this.onlineNote = null;
    this.bind();
    i18n.onChange(() => { if (this.visible) this.render(); });
  }

  bind() {
    const back = $('btn-records-back');
    if (back) back.addEventListener('click', () => this.onBack());
    const practice = $('btn-records-practice');
    if (practice) practice.addEventListener('click', () => this.onPractice(this.selectedTrackId));
  }

  get selectedTrackId() {
    if (this.trackId && TRACK_DEFS.some((d) => d.id === this.trackId)) return this.trackId;
    return TRACK_DEFS[0].id;
  }

  setTrack(trackId) {
    this.trackId = trackId;
    this.onlineRows = null;
    this.onlineState = 'idle';
    if (this.visible) this.render();
  }

  show() {
    this.visible = true;
    if (!this.trackId) this.trackId = this.save.get('lastTrack', TRACK_DEFS[0].id);
    this.render();
    this.refreshOnline();
  }

  hide() { this.visible = false; }

  // ------------------------------------------------------------ online layer
  // Never blocks the screen: renders local data first, then upgrades the panel
  // when (and if) the provider answers.
  async refreshOnline() {
    if (!this.provider) { this.onlineState = 'offline'; return; }
    const trackId = this.selectedTrackId;
    this.onlineState = 'loading';
    try {
      const rows = await this.provider.fetchLeaderboard(trackId, 10);
      if (trackId !== this.selectedTrackId) return;    // selection moved on
      this.onlineRows = Array.isArray(rows) ? rows : null;
      this.onlineState = 'ok';
      this.onlineNote = this.provider.name === 'local' ? 'records.sourceLocal' : 'records.sourceRemote';
    } catch (_e) {
      if (trackId !== this.selectedTrackId) return;
      this.onlineState = 'offline';
      this.onlineRows = null;
    }
    if (this.visible) this._renderBoard();
  }

  // ------------------------------------------------------------------ render
  render() {
    this._renderSummary();
    this._renderTracks();
    this._renderBoard();
    this._renderAchievements();
    this._renderStats();
  }

  _renderSummary() {
    const box = $('records-summary');
    if (!box) return;
    const i18n = this.i18n;
    const prog = getProgress(this.save);
    const earned = this.save.get('achievements', []).length;
    box.innerHTML = '';

    const line = el('div', 'records-headline');
    line.appendChild(el('span', 'records-level', i18n.t('records.level', { level: prog.level })));
    const span = prog.nextThreshold - prog.prevThreshold;
    const into = Math.max(0, prog.xp - prog.prevThreshold);
    const bar = el('span', 'xp-track');
    const fill = el('span', 'xp-fill');
    fill.style.width = `${span > 0 ? Math.min(100, (into / span) * 100) : 100}%`;
    bar.appendChild(fill);
    line.appendChild(bar);
    line.appendChild(el('span', 'records-xp',
      i18n.t('records.xp', { xp: Math.floor(into), next: span })));
    box.appendChild(line);

    const sub = el('div', 'records-sub');
    sub.appendChild(el('span', 'records-chip',
      i18n.t('records.achievementsCount', { earned, total: ACHIEVEMENTS.length })));
    const unlocked = UNLOCKABLES.filter((u) => u.level <= prog.level).length;
    sub.appendChild(el('span', 'records-chip',
      i18n.t('records.unlocksCount', { unlocked, total: UNLOCKABLES.length })));
    const cups = CUPS.filter((c) => this.save.get('trophies', {})[c.id]).length;
    sub.appendChild(el('span', 'records-chip',
      i18n.t('records.cupsCount', { earned: cups, total: CUPS.length })));
    box.appendChild(sub);
  }

  _renderTracks() {
    const box = $('records-tracks');
    if (!box) return;
    box.innerHTML = '';
    const i18n = this.i18n;
    box.appendChild(el('div', 'records-section', i18n.t('records.tracks')));
    const scroll = el('div', 'records-scroll');
    let any = false;
    for (const def of TRACK_DEFS) {
      const rec = this.records ? this.records.get(def.id) : null;
      const row = el('button', 'btn list-row records-track-row' + (def.id === this.selectedTrackId ? ' selected' : ''));
      const name = el('span', '', i18n.t(def.nameKey));
      const meta = el('span', 'list-meta');
      if (rec && rec.bestTotal) {
        any = true;
        meta.textContent = `${formatTime(rec.bestTotal)}${rec.ghost ? ` · ${i18n.t('records.ghostTag')}` : ''}`;
      } else {
        meta.textContent = i18n.t('tt.noRecord');
      }
      row.append(name, meta);
      row.addEventListener('click', () => this.setTrack(def.id));
      scroll.appendChild(row);
    }
    box.appendChild(scroll);
    if (!any) box.appendChild(el('div', 'records-note', i18n.t('records.noRecords')));
  }

  _renderBoard() {
    const box = $('records-board');
    if (!box) return;
    const i18n = this.i18n;
    box.innerHTML = '';
    box.appendChild(el('div', 'records-section', i18n.t('records.leaderboard')));

    const trackDef = TRACK_DEFS.find((d) => d.id === this.selectedTrackId);
    box.appendChild(el('div', 'records-note', trackDef ? i18n.t(trackDef.nameKey) : ''));

    const rows = this.onlineRows || (this.records ? this.records.top(this.selectedTrackId, 10) : []);
    if (!rows.length) {
      box.appendChild(el('div', 'records-note', i18n.t('records.noRecords')));
    } else {
      rows.slice(0, 10).forEach((entry, i) => {
        const row = el('div', 'records-row');
        row.appendChild(el('span', 'records-rank', String(i + 1)));
        row.appendChild(el('span', 'records-name', entry.name || '—'));
        row.appendChild(el('span', 'records-time', formatTime(entry.time)));
        box.appendChild(row);
      });
    }

    const status = el('div', 'records-note records-status' + (this.onlineState === 'offline' ? ' offline' : ''));
    if (this.onlineState === 'loading') status.textContent = i18n.t('records.loading');
    else if (this.onlineState === 'offline') status.textContent = i18n.t('records.offline');
    else if (this.onlineState === 'ok') status.textContent = 'ok';
    box.appendChild(status);
    if (this.onlineState === 'ok' && this.onlineNote) status.textContent = i18n.t(this.onlineNote);
  }

  _renderAchievements() {
    const box = $('records-achievements');
    if (!box) return;
    box.innerHTML = '';
    const i18n = this.i18n;
    const earned = new Set(this.save.get('achievements', []));
    box.appendChild(el('div', 'records-section', i18n.t('records.achievements')));
    for (const ach of ACHIEVEMENTS) {
      const got = earned.has(ach.id);
      const row = el('div', 'ach-row' + (got ? ' earned' : ' locked'));
      row.appendChild(el('span', 'ach-name', i18n.t(ach.nameKey)));
      row.appendChild(el('span', 'ach-desc', i18n.t(ach.descKey)));
      row.appendChild(el('span', 'ach-state', i18n.t(got ? 'records.earned' : 'records.locked')));
      box.appendChild(row);
    }
  }

  _renderStats() {
    const box = $('records-stats');
    if (!box) return;
    box.innerHTML = '';
    const i18n = this.i18n;
    const stats = getStats(this.save);
    box.appendChild(el('div', 'records-section', i18n.t('records.stats')));
    for (const key of STAT_ROWS) {
      const row = el('div', 'records-stat-row');
      row.appendChild(el('span', 'records-stat-name', i18n.t(`records.stat.${key}`)));
      row.appendChild(el('span', 'records-stat-value', String(Math.floor(stats[key] || 0))));
      box.appendChild(row);
    }
    const trophyBox = el('div', 'records-trophies');
    trophyBox.appendChild(el('div', 'records-section', i18n.t('records.trophies')));
    for (const cup of CUPS) {
      const trophy = this.save.get('trophies', {})[cup.id];
      const row = el('div', 'records-stat-row');
      row.appendChild(el('span', 'records-stat-name', i18n.t(cup.nameKey)));
      row.appendChild(el('span', 'records-stat-value', trophy ? i18n.t(`trophy.${trophy}`) : i18n.t('records.locked')));
      trophyBox.appendChild(row);
    }
    box.appendChild(trophyBox);
  }
}
