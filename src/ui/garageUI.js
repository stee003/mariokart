// ============================================================================
// GarageUI - DOM layer for the garage / character-select screen.
//
// Renders the seven customization pages, the live attribute comparison, the
// derived performance preview and the pilot caption next to the rotating 3D
// model. Every visible string comes from the LocalizationManager, so live
// EN/IT switching re-renders the whole screen.
//
// No game logic lives here: Garage (src/garage.js) owns state, this module
// only draws it and forwards clicks.
// ============================================================================

import { GARAGE_TABS } from '../garage.js';
import { STAT_KEYS } from '../content/stats.js';

const $ = (id) => document.getElementById(id);

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function fmtNum(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export class GarageUI {
  constructor({ i18n, garage, preview = null, onBack, onRace, onPreviewChange }) {
    this.i18n = i18n;
    this.garage = garage;
    this.preview = preview;
    this.onBack = onBack || (() => {});
    this.onRace = onRace || (() => {});
    this.onPreviewChange = onPreviewChange || (() => {});
    this.visible = false;
    this.bind();
    i18n.onChange(() => { if (this.visible) this.render(); });
  }

  // ------------------------------------------------------------------ chrome
  bind() {
    const click = (id, fn) => {
      const node = $(id);
      if (node) node.addEventListener('click', fn);
    };
    click('btn-garage-back', () => this.onBack());
    click('btn-garage-race', () => this.onRace());
    click('btn-garage-focus', () => {
      this.garage.toggleFocus();
      this.preview?.setFocus(this.garage.focus);
      this.render();
    });
    click('btn-garage-randomize', () => {
      this.garage.randomize();
      this.syncPreview();
      this.render();
    });
    click('btn-garage-reset', () => {
      this.garage.reset();
      this.syncPreview();
      this.render();
    });
  }

  show() { this.visible = true; this.render(); }
  hide() { this.visible = false; }

  // Pushes the current build into the 3D preview.
  syncPreview() {
    if (!this.preview || !this.preview.ok) return;
    this.preview.setLoadout(this.garage.loadout, this.garage.signature);
    this.preview.setFocus(this.garage.focus);
    this.onPreviewChange(this.garage.loadout);
  }

  // ------------------------------------------------------------------ render
  render() {
    this.syncPreview();
    this._renderTabs();
    this._renderList();
    this._renderDetail();
    this._renderStats();
    this._renderPerformance();
    this._renderCaption();
    const focusBtn = $('btn-garage-focus');
    if (focusBtn) {
      focusBtn.textContent = this.i18n.t(this.garage.focus === 'kart' ? 'garage.focusPilot' : 'garage.focusKart');
    }
  }

  _renderTabs() {
    const box = $('garage-tabs');
    if (!box) return;
    box.innerHTML = '';
    for (const tab of GARAGE_TABS) {
      const btn = el('button', 'btn btn-small garage-tab' + (tab.id === this.garage.tab ? ' selected' : ''));
      btn.textContent = this.i18n.t(tab.labelKey);
      btn.addEventListener('click', () => {
        this.garage.setTab(tab.id);
        this.render();
      });
      box.appendChild(btn);
    }
  }

  _renderList() {
    const list = $('garage-list');
    if (!list) return;
    list.innerHTML = '';
    for (const entry of this.garage.items()) {
      const row = el('button', 'garage-row' + (entry.equipped ? ' equipped' : '') + (entry.unlocked ? '' : ' locked'));
      row.disabled = !entry.unlocked;

      if (entry.swatch !== null) {
        const dot = el('span', 'garage-swatch');
        dot.style.background = `#${entry.swatch.toString(16).padStart(6, '0')}`;
        row.appendChild(dot);
      }
      const text = el('span', 'garage-row-text');
      text.appendChild(el('span', 'garage-row-name', this.i18n.t(entry.nameKey)));
      if (!entry.unlocked && entry.hint) {
        text.appendChild(el('span', 'garage-row-sub', this._hintText(entry.hint)));
      } else if (entry.equipped) {
        text.appendChild(el('span', 'garage-row-sub', this.i18n.t('garage.equipped')));
      }
      row.appendChild(text);

      const chips = el('span', 'garage-chips');
      if (entry.stats) {
        for (const k of STAT_KEYS) {
          const v = entry.stats[k];
          if (!v) continue;
          const chip = el('span', 'stat-chip ' + (v > 0 ? 'up' : 'down'),
            `${v > 0 ? '+' : ''}${v} ${this.i18n.t(`stat.short.${k}`)}`);
          chips.appendChild(chip);
        }
      }
      row.appendChild(chips);

      if (entry.unlocked) {
        row.addEventListener('click', () => {
          if (this.garage.select(entry.tabId, entry.id)) this.render();
        });
      }
      list.appendChild(row);
    }
  }

  _hintText(hint) {
    const vars = { ...hint.vars };
    if (hint.nameKey) vars.name = this.i18n.t(hint.nameKey);
    return this.i18n.t(hint.key, vars);
  }

  _renderDetail() {
    const box = $('garage-detail');
    if (!box) return;
    const rows = this.garage.items();
    const active = rows.find((r) => r.equipped) || rows[0];
    const build = this.garage.loadout;
    box.innerHTML = '';

    if (!active) return;
    const title = el('div', 'garage-detail-title', this.i18n.t(active.nameKey));
    box.appendChild(title);
    if (active.descKey) {
      box.appendChild(el('div', 'garage-detail-desc', this.i18n.t(active.descKey)));
    } else {
      const c = build.character;
      box.appendChild(el('div', 'garage-detail-desc',
        `${this.i18n.t(c.nameKey)}, ${this.i18n.t(c.speciesKey)}`));
    }
    box.appendChild(el('div', 'garage-detail-note', this.i18n.t('garage.statHint')));
  }

  _renderStats() {
    const box = $('garage-stats');
    if (!box) return;
    box.innerHTML = '';
    box.appendChild(el('div', 'garage-section', this.i18n.t('garage.attributes')));
    for (const row of this.garage.statRows()) {
      const line = el('div', 'stat-line');
      line.appendChild(el('span', 'stat-name', this.i18n.t(row.labelKey)));
      const track = el('span', 'stat-track');
      const fill = el('span', 'stat-fill');
      fill.style.width = `${(row.value / row.max) * 100}%`;
      track.appendChild(fill);
      line.appendChild(track);
      line.appendChild(el('span', 'stat-value', fmtNum(row.value)));
      const delta = el('span', 'stat-delta');
      if (row.delta > 0) { delta.textContent = `+${fmtNum(row.delta)}`; delta.classList.add('up'); }
      else if (row.delta < 0) { delta.textContent = fmtNum(row.delta); delta.classList.add('down'); }
      line.appendChild(delta);
      box.appendChild(line);
    }
  }

  _renderPerformance() {
    const box = $('garage-perf');
    if (!box) return;
    box.innerHTML = '';
    const head = el('div', 'garage-section', this.i18n.t('garage.performance'));
    box.appendChild(head);
    for (const row of this.garage.performance()) {
      const line = el('div', 'perf-line');
      line.appendChild(el('span', 'perf-name', this.i18n.t(row.labelKey)));
      const value = el('span', 'perf-value',
        `${fmtNum(row.value)} ${this.i18n.t(`unit.${row.unit}`)}`);
      line.appendChild(value);
      const diff = Math.round((row.value - row.ref) * 10) / 10;
      const badge = el('span', 'perf-delta');
      if (Math.abs(diff) < 0.05) {
        badge.textContent = '—';
        badge.classList.add('flat');
      } else {
        const improved = row.better === 'high' ? diff > 0 : diff < 0;
        badge.textContent = `${diff > 0 ? '+' : ''}${fmtNum(diff)}`;
        badge.classList.add(improved ? 'up' : 'down');
      }
      line.appendChild(badge);
      box.appendChild(line);
    }
  }

  _renderCaption() {
    const box = $('garage-caption');
    if (!box) return;
    const cap = this.garage.caption();
    box.innerHTML = '';
    box.appendChild(el('div', 'caption-name', this.i18n.t(cap.nameKey)));
    box.appendChild(el('div', 'caption-sub', this.i18n.t(cap.speciesKey)));
    box.appendChild(el('div', 'caption-personality', this.i18n.t(cap.personalityKey)));
    const parts = el('div', 'caption-parts',
      `${this.i18n.t(cap.chassisNameKey)} · ${this.i18n.t(cap.wheelNameKey)}`);
    box.appendChild(parts);
    const summary = $('garage-build');
    if (summary) {
      summary.textContent = `${this.i18n.t('garage.selection')}: ${this.garage.statSummary()}`;
    }
    const saveHint = $('garage-save-hint');
    if (saveHint) saveHint.textContent = this.i18n.t('garage.saveHint');
  }
}
