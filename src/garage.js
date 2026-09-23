// ============================================================================
// Garage - customization logic (no DOM, no Three.js).
//
// Owns the editable loadout, the seven customization pages, unlock gating
// against progression/achievements/cups, the live stat comparison and the
// derived "performance preview" numbers shown next to the rotating kart.
//
// The UI (src/ui/garageUI.js) and the 3D preview (src/kartPreview.js) are
// thin layers on top of this module, so all balance-relevant behaviour is
// unit-testable in plain node.
// ============================================================================

import { CONFIG } from './config.js';
import { CHARACTERS, getCharacter } from './content/characters.js';
import { CHASSIS, getChassis } from './content/chassis.js';
import { WHEELS, getWheels } from './content/wheels.js';
import {
  PAINTS, DECALS, EXHAUSTS, EFFECTS,
  getPaint, getDecal, getExhaust, getEffect,
} from './content/cosmetics.js';
import { buildLoadout, DEFAULT_LOADOUT } from './content/loadout.js';
import { STAT_KEYS, combineStats, vehicleParamsFromStats, driftModsFromStats } from './content/stats.js';
import { getProgress } from './progression.js';
import { earnedAchievements, ACHIEVEMENTS } from './achievements.js';
import { CUPS, trophyAtLeast } from './content/cups.js';

// ---------------------------------------------------------------------------
// Pages. Each page maps to one field of the loadout spec.
// ---------------------------------------------------------------------------
export const GARAGE_TABS = [
  { id: 'pilot', specKey: 'characterId', labelKey: 'garage.tab.pilot', items: () => CHARACTERS },
  { id: 'chassis', specKey: 'chassisId', labelKey: 'garage.tab.chassis', items: () => CHASSIS },
  { id: 'wheels', specKey: 'wheelId', labelKey: 'garage.tab.wheels', items: () => WHEELS },
  { id: 'paint', specKey: 'paintId', labelKey: 'garage.tab.paint', items: () => PAINTS },
  { id: 'decal', specKey: 'decalId', labelKey: 'garage.tab.decal', items: () => DECALS },
  { id: 'exhaust', specKey: 'exhaustId', labelKey: 'garage.tab.exhaust', items: () => EXHAUSTS },
  { id: 'effect', specKey: 'effectId', labelKey: 'garage.tab.effect', items: () => EFFECTS },
];

const TAB_BY_ID = new Map(GARAGE_TABS.map((t) => [t.id, t]));

export function getTab(tabId) {
  return TAB_BY_ID.get(tabId) || GARAGE_TABS[0];
}

// Descriptive key for the item's flavour text (characters use their
// personality line; parts use their own desc key).
function pageDescKey(tabId, item) {
  if (tabId === 'pilot') return item.personalityKey;
  if (tabId === 'paint' || tabId === 'decal' || tabId === 'exhaust' || tabId === 'effect') return null;
  return item.descKey || null;
}

// Swatch colour used by the list UI (paints are the obvious case).
export function itemSwatch(tabId, item) {
  if (tabId === 'paint') return item.color;
  if (tabId === 'pilot') return item.colors.fur;
  if (tabId === 'wheels') return item.geo.color;
  return null;
}

// ---------------------------------------------------------------------------
// Unlocks
// ---------------------------------------------------------------------------
export function unlockContext(save) {
  return {
    level: getProgress(save).level,
    trophies: save.get('trophies', {}),
    achievements: new Set(earnedAchievements(save)),
  };
}

// Supports every unlock rule content declares today:
//   {type:'default'}                       always available
//   {type:'level', level:n}                player level >= n
//   {type:'cup', cupId, minTrophy?}        cup finished (or better trophy)
//   {type:'achievement', achievementId}    achievement earned
export function entryUnlocked(entry, ctx) {
  const u = entry.unlock;
  if (!u || u.type === 'default') return true;
  if (u.type === 'level') return ctx.level >= u.level;
  if (u.type === 'achievement') return ctx.achievements.has(u.achievementId);
  if (u.type === 'cup') {
    const have = ctx.trophies[u.cupId];
    if (!have) return false;
    return u.minTrophy ? trophyAtLeast(have, u.minTrophy) : true;
  }
  return false;
}

// i18n descriptor for "why is this locked?".
// {key, vars} plus an optional nameKey the UI translates into vars.name.
export function unlockHint(entry) {
  const u = entry.unlock;
  if (!u || u.type === 'default') return null;
  if (u.noteKey) return { key: u.noteKey, vars: {} };
  if (u.type === 'level') return { key: 'garage.lockedLevel', vars: { level: u.level } };
  if (u.type === 'achievement') {
    const ach = ACHIEVEMENTS.find((a) => a.id === u.achievementId);
    return { key: 'garage.lockedAchievement', vars: {}, nameKey: ach ? ach.nameKey : null };
  }
  if (u.type === 'cup') {
    const cup = CUPS.find((c) => c.id === u.cupId);
    return { key: 'garage.lockedCup', vars: {}, nameKey: cup ? cup.nameKey : null };
  }
  return { key: 'menu.locked', vars: {} };
}

// ---------------------------------------------------------------------------
// Stat + performance preview
// ---------------------------------------------------------------------------
export function statRows(spec, compareSpec = null) {
  const build = buildLoadout(spec);
  const base = compareSpec ? buildLoadout(compareSpec) : null;
  return STAT_KEYS.map((k) => ({
    key: k,
    labelKey: `stat.${k}`,
    value: Math.round(build.stats[k] * 10) / 10,
    max: 10,
    delta: base ? Math.round((build.stats[k] - base.stats[k]) * 10) / 10 : 0,
  }));
}

// Derived physics numbers the player can feel, shown as a "performance
// preview" table. `ref` is the stock baseline so the UI can colour the delta.
export function performanceProfile(loadout) {
  const p = loadout.params;
  const dm = loadout.driftMods;
  const stock = CONFIG.vehicle;
  const stockCharge = CONFIG.drift.chargeRate;
  const kmh = (v) => Math.round(v * 3.6);
  const r1 = (v) => Math.round(v * 10) / 10;
  const accelTime = (params) => r1((100 / 3.6) / params.accel);
  const chargeTime = (mods) => r1(CONFIG.drift.levels[2] / (stockCharge * mods.chargeRate));

  return [
    { id: 'topSpeed', labelKey: 'perf.topSpeed', unit: 'kmh', better: 'high',
      value: kmh(p.maxSpeed), ref: kmh(stock.maxSpeed) },
    { id: 'accel', labelKey: 'perf.accel', unit: 'sec', better: 'low',
      value: accelTime(p), ref: accelTime(stock) },
    { id: 'cornering', labelKey: 'perf.cornering', unit: 'degs', better: 'high',
      value: Math.round(p.steerRate * 57.3), ref: Math.round(stock.steerRate * 57.3) },
    { id: 'grip', labelKey: 'perf.grip', unit: 'x', better: 'high',
      value: r1(p.traction / stock.traction), ref: 1 },
    { id: 'offRoad', labelKey: 'perf.offRoad', unit: 'kmh', better: 'high',
      value: kmh(p.offTrackMaxSpeed), ref: kmh(stock.offTrackMaxSpeed) },
    { id: 'drift', labelKey: 'perf.driftCharge', unit: 'sec', better: 'low',
      value: chargeTime(dm), ref: chargeTime({ chargeRate: 1 }) },
    { id: 'mass', labelKey: 'perf.mass', unit: 'x', better: 'high',
      value: r1(p.massFactor ?? 1), ref: 1 },
  ];
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
export function loadEquippedSpec(save) {
  const stored = save.get('loadout', null);
  return { ...DEFAULT_LOADOUT, ...(stored || {}) };
}

export function saveEquippedSpec(save, spec) {
  const clean = { ...DEFAULT_LOADOUT, ...spec };
  // Only persist known ids so a stale save can never break a build.
  clean.characterId = (getCharacter(clean.characterId) || CHARACTERS[0]).id;
  clean.chassisId = getChassis(clean.chassisId).id;
  clean.wheelId = getWheels(clean.wheelId).id;
  clean.paintId = getPaint(clean.paintId).id;
  clean.decalId = getDecal(clean.decalId).id;
  clean.exhaustId = getExhaust(clean.exhaustId).id;
  clean.effectId = getEffect(clean.effectId).id;
  save.set('loadout', clean);
  return clean;
}

// ---------------------------------------------------------------------------
// Garage session
// ---------------------------------------------------------------------------
export class Garage {
  constructor(save, { rng = Math.random } = {}) {
    this.save = save;
    this.rng = rng;
    this.spec = loadEquippedSpec(save);
    this.equipped = { ...this.spec };
    this.tab = 'pilot';
    this.focus = 'kart';         // 'kart' | 'pilot' (preview camera target)
    this._cache = { sig: null, loadout: null };
  }

  // -- derived state ------------------------------------------------------
  get ctx() { return unlockContext(this.save); }

  get loadout() {
    const sig = this.signature;
    if (this._cache.sig !== sig) {
      this._cache = { sig, loadout: buildLoadout(this.spec) };
    }
    return this._cache.loadout;
  }

  get signature() {
    const s = this.spec;
    return [s.characterId, s.chassisId, s.wheelId, s.paintId, s.decalId, s.exhaustId, s.effectId].join('|');
  }

  get dirty() { return this.signature !== specSignature(this.equipped); }

  // -- pages --------------------------------------------------------------
  items(tabId = this.tab) {
    const tab = getTab(tabId);
    const ctx = this.ctx;
    return tab.items().map((item) => ({
      id: item.id,
      item,
      tabId: tab.id,
      nameKey: item.nameKey,
      descKey: pageDescKey(tab.id, item),
      swatch: itemSwatch(tab.id, item),
      unlocked: entryUnlocked(item, ctx),
      hint: entryUnlocked(item, ctx) ? null : unlockHint(item),
      equipped: this.spec[tab.specKey] === item.id,
      stats: item.stats || null,
    }));
  }

  setTab(tabId) {
    if (TAB_BY_ID.has(tabId)) this.tab = tabId;
    return this.tab;
  }

  // -- selection ----------------------------------------------------------
  // Selecting equips immediately (kart racers feel better with instant
  // feedback); persistence happens right away so nothing is ever lost.
  select(tabId, itemId) {
    const tab = getTab(tabId);
    const item = tab.items().find((i) => i.id === itemId);
    if (!item) return false;
    if (!entryUnlocked(item, this.ctx)) return false;
    this.spec = { ...this.spec, [tab.specKey]: item.id };
    this.save.set('loadout', { ...this.spec });
    this.equipped = { ...this.spec };
    return true;
  }

  // Every unlocked option for a page (used by randomize / tests).
  unlockedIds(tabId) {
    return this.items(tabId).filter((e) => e.unlocked).map((e) => e.id);
  }

  randomize() {
    for (const tab of GARAGE_TABS) {
      const pool = this.unlockedIds(tab.id);
      if (!pool.length) continue;
      const pick = pool[Math.floor(this.rng() * pool.length) % pool.length];
      this.spec = { ...this.spec, [tab.specKey]: pick };
    }
    this.equipped = { ...this.spec };
    this.save.set('loadout', { ...this.spec });
    return this.spec;
  }

  reset() {
    this.spec = { ...DEFAULT_LOADOUT };
    this.equipped = { ...this.spec };
    this.save.set('loadout', { ...this.spec });
    return this.spec;
  }

  toggleFocus() {
    this.focus = this.focus === 'kart' ? 'pilot' : 'kart';
    return this.focus;
  }

  // -- preview payloads ---------------------------------------------------
  statRows() { return statRows(this.spec, this.equipped); }
  performance() { return performanceProfile(this.loadout); }

  caption() {
    const c = this.loadout.character;
    return {
      nameKey: c.nameKey,
      speciesKey: c.speciesKey,
      personalityKey: c.personalityKey,
      chassisNameKey: this.loadout.chassis.nameKey,
      wheelNameKey: this.loadout.wheels.nameKey,
    };
  }

  // Stat-only summary used by the "build summary" chip in the header.
  statSummary() {
    const s = this.loadout.stats;
    return `${Math.round(s.topSpeed)}/${Math.round(s.acceleration)}/${Math.round(s.handling)}`;
  }
}

export function specSignature(spec) {
  const s = { ...DEFAULT_LOADOUT, ...spec };
  return [s.characterId, s.chassisId, s.wheelId, s.paintId, s.decalId, s.exhaustId, s.effectId].join('|');
}

// ---------------------------------------------------------------------------
// Helpers shared with tests: a build's effective stats for a raw spec set.
// ---------------------------------------------------------------------------
export function effectiveStats(spec) {
  const character = getCharacter(spec.characterId) || CHARACTERS[0];
  const chassis = getChassis(spec.chassisId);
  const wheels = getWheels(spec.wheelId);
  return combineStats(character.stats, chassis.stats, wheels.stats);
}

export { vehicleParamsFromStats, driftModsFromStats };
