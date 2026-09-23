// ============================================================================
// SUNFORGE RACERS - main entry point.
// Wires renderer, track, karts, race manager, HUD, audio, music, camera,
// particles, items and the app state machine (menus -> modes -> race ->
// results). Fixed-timestep physics.
//
// Modes: quick race, grand prix (cup progression + scoring), time trial
// (records + ghost playback). Battle / garage / online flow in later
// increments reuse the same _loadTrack/startRace plumbing.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { CONFIG } from './config.js';
import { SaveManager } from './save.js';
import { LocalizationManager } from './i18n.js';
import { InputManager } from './input.js';
import { AudioManager } from './audio.js';
import { MusicManager } from './music.js';
import { TrackManager } from './track.js';
import { buildEnvironment } from './environment.js';
import { buildThemedEnvironment } from './environment2.js';
import { TRACK_DEFS } from './content/trackDefs.js';
import { ARENAS, getArena, enforceArenaWalls } from './content/arenas.js';
import { BATTLE_MODES, BattleManager } from './battle.js';
import { buildKart, updateKartVisual } from './kartMesh.js';
import { animateCharacter } from './characterMesh.js';
import { VehicleController } from './vehicle.js';
import { AIController } from './ai.js';
import { CameraController } from './camera.js';
import { RaceManager, formatTime } from './race.js';
import { HUDManager } from './hud.js';
import { ParticlePool } from './particles.js';
import { DRIFT_COLORS } from './drift.js';
import { ItemSystem } from './items.js';
import { ItemVisuals } from './itemMesh.js';
import { ITEMS } from './content/items.js';
import { CUPS, getCup, trophyAtLeast } from './content/cups.js';
import { GrandPrixSession } from './grandprix.js';
import { TimeTrialSession, RecordsStore } from './timetriial.js';
import { GhostPlayer, deserializeGhost } from './ghost.js';
import { DIFFICULTY_TIERS, getDifficulty } from './aiDifficulty.js';
import { applyEvent, getProgress } from './progression.js';
import { recordStats, checkAchievements, trackPlayed } from './achievements.js';
import { LocalLeaderboard } from './leaderboard.js';
import { LocalProvider } from './online.js';

const FIXED_DT = 1 / 60;

class Game {
  constructor() {
    this.save = new SaveManager();
    this.i18n = new LocalizationManager(this.save);
    this.input = new InputManager();
    this.audio = new AudioManager(this.save);
    this.music = new MusicManager(this.save);
    this.records = new RecordsStore(this.save);
    this.leaderboard = new LocalLeaderboard(this.save);
    this.provider = new LocalProvider(this.leaderboard);
    this.appState = 'menu';          // menu | race
    this.settingsReturn = 'screen-main';

    // mode state -------------------------------------------------------------
    this.mode = 'quick';             // quick | grandprix | timetrial
    this.gpSession = null;
    this.ttSession = null;
    this.ghostPlayer = null;
    this.ghostVis = null;
    this._lastRaceState = 'idle';
    this.battle = null;
    this._battleInput = { throttle: 0, brake: 0, steer: 0, drift: false, trick: false, item: false };

    // renderer ---------------------------------------------------------------
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.camera.fovBase, window.innerWidth / window.innerHeight, 0.1, 1600);

    // shared render resources (survive track switches) ---------------------------
    this.dust = new ParticlePool(this.scene, CONFIG.particles.dustCount, false);
    this.sparks = new ParticlePool(this.scene, CONFIG.particles.sparkCount, true);
    this.hud = new HUDManager(this.i18n);

    this.trackId = this.save.get('lastTrack', 'sunforge_circuit');
    this._loadTrack(this.trackId, true);

    this.bindUI();
    window.addEventListener('resize', () => this.onResize());

    this.clock = new THREE.Clock();
    this.accumulator = 0;
    this.time = 0;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // --------------------------------------------------------------- world load
  // (Re)builds track + environment + items + karts for a track definition id.
  // The vehicle physics, drift, camera and race systems are reused untouched;
  // only world content swaps. `solo` registers only the player (time trials);
  // `rivals` (0-3) trims the AI grid for custom quick races.
  _loadTrack(trackId, first = false, { solo = false, rivals = 3 } = {}) {
    const def = TRACK_DEFS.find((d) => d.id === trackId) || getArena(trackId);
    this.trackId = def.id;
    if (TRACK_DEFS.some((d) => d.id === def.id)) this.save.set('lastTrack', def.id);

    // dispose previous world (environment group + kart meshes)
    if (this.env) this.scene.remove(this.env.group);
    if (this.kartVisuals) {
      for (const vis of this.kartVisuals.values()) {
        this.scene.remove(vis.group);
        this.scene.remove(vis.shadow);
      }
    }
    if (this.itemVisuals) this.itemVisuals.dispose();
    this._removeGhostVis();

    this.track = new TrackManager(def);

    // Route rendering: the original Sunforge desert keeps its bespoke
    // renderer; every other theme uses the generic themed builder.
    if (def.id === 'sunforge_circuit') {
      this.env = buildEnvironment(this.scene, this.track);
    } else {
      this.env = buildThemedEnvironment(this.scene, this.track,
        this.i18n.t(def.nameKey).toUpperCase());
    }

    if (first) {
      this.camCtl = new CameraController(this.camera, this.track);
      this.camCtl.distance = this.save.get('cameraDistance', CONFIG.camera.distance);
      this.camCtl.height = this.save.get('cameraHeight', CONFIG.camera.height);
    } else {
      this.camCtl.track = this.track;
    }
    this.camCtl.setColliders(this.env.colliders);

    // items (power-ups) --------------------------------------------------------
    this.items = new ItemSystem({
      track: this.track,
      onEvent: (type, payload) => this.onRaceEvent(type, payload),
      audio: this.audio,
      i18n: this.i18n,
    });
    this.items.setBoxes(this.track.itemBoxes);
    this.itemVisuals = new ItemVisuals(this.scene);
    this.itemVisuals.setBoxes(this.items.boxes);
    for (const m of this.itemVisuals.boxMeshes) m.visible = false;   // shown on race start

    // karts ---------------------------------------------------------------------
    this.kartVisuals = new Map();
    const roster = [
      { nameKey: 'ai.cinder',  color: 0xd9452f, accent: 0xffd23f, pilot: 0x53302a, ai: 'aggressive' },
      { nameKey: 'ai.zephyr',  color: 0x2fa877, accent: 0xd8f4e6, pilot: 0x3c5c4e, ai: 'balanced' },
      { nameKey: 'ai.bastion', color: 0x4159c9, accent: 0x9fb4ff, pilot: 0x37406e, ai: 'defensive' },
    ].slice(0, solo ? 0 : Math.max(0, Math.min(3, rivals)));
    roster.push({ nameKey: 'ai.you', color: 0xff8a2a, accent: 0x2fd8c8, pilot: 0xf2a65a, ai: null });

    this.race = new RaceManager({
      track: this.track, hud: this.hud, audio: this.audio, i18n: this.i18n,
      items: this.items,
      onEvent: (type, payload) => this.onRaceEvent(type, payload),
    });
    for (const d of roster) {
      const vehicle = new VehicleController(this.track, d.ai === null);
      const vis = buildKart(d.color, d.accent, d.pilot);
      this.scene.add(vis.group);
      this.scene.add(vis.shadow);
      this.kartVisuals.set(vehicle, vis);
      const kart = {
        vehicle,
        ai: d.ai ? new AIController(vehicle, this.track, d.ai) : null,
        nameKey: d.nameKey,
        isPlayer: d.ai === null,
        charVis: vis.charVis || null,
      };
      if (kart.ai) kart.ai.setDifficulty(this.save.get('difficulty', 'normal'));
      this.race.registerKart(kart);
    }
    this.playerKart = this.race.karts.find((k) => k.isPlayer);

    // place karts on the grid for the menu backdrop
    this._placeOnGrid();

    trackPlayed(this.save, def.id);
    this.music.setTheme(def.musicSeed, def.theme);
  }

  // AI takes the front slots; the player always starts from the back slot.
  _placeOnGrid() {
    const grid = this.track.startGrid();
    const ais = this.race.karts.filter((k) => !k.isPlayer);
    ais.forEach((k, i) => k.vehicle.place(grid[i]));
    this.playerKart.vehicle.place(grid[3]);
  }

  _removeGhostVis() {
    if (this.ghostVis) {
      this.scene.remove(this.ghostVis.group);
      this.scene.remove(this.ghostVis.shadow);
      this.ghostVis = null;
    }
  }

  _setupGhostVis() {
    this._removeGhostVis();
    if (!this.ghostPlayer || this.mode !== 'timetrial') return;
    const vis = buildKart(0x9aa0b8, 0xd8e0f8, 0xb8c0d8);
    vis.group.traverse((o) => {
      if (o.material) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.4;
        o.material.depthWrite = false;
      }
    });
    vis.shadow.visible = false;
    this.scene.add(vis.group);
    this.ghostVis = vis;
  }

  // --------------------------------------------------------------------- UI
  bindUI() {
    const $ = (id) => document.getElementById(id);
    const click = (id, fn) => {
      $(id).addEventListener('click', () => {
        this.audio.init(); this.audio.resume(); this.audio.click();
        this.music.init(); this.music.resume();
        fn();
      });
    };

    click('btn-start', () => this.openModeSelect());
    click('btn-settings', () => { this.settingsReturn = 'screen-main'; this.openSettings(); });
    click('btn-settings-back', () => this.hud.showScreen(this.settingsReturn));
    click('btn-resume', () => this.setPaused(false));
    click('btn-pause-restart', () => { this.setPaused(false); this.restartCurrentRace(); });
    click('btn-pause-menu', () => this.returnToMenu());
    click('btn-results-restart', () => this.onResultsPrimary());
    click('btn-results-menu', () => this.returnToMenu());

    // mode select
    click('btn-mode-quick', () => this.openTrackSelect('quick'));
    click('btn-mode-gp', () => this.openCupSelect());
    click('btn-mode-tt', () => this.openTrackSelect('timetrial'));
    click('btn-mode-battle', () => this.openBattleSelect());
    click('btn-mode-back', () => this.hud.showScreen('screen-main'));
    click('btn-tracksel-back', () => this.openModeSelect());
    click('btn-cupsel-back', () => this.openModeSelect());
    click('btn-battlesel-back', () => this.openModeSelect());
    click('btn-battle-start', () => this._startBattle());

    // language
    const syncLang = () => {
      $('lang-en').classList.toggle('selected', this.i18n.lang === 'en');
      $('lang-it').classList.toggle('selected', this.i18n.lang === 'it');
    };
    $('lang-en').addEventListener('click', () => { this.audio.init(); this.i18n.setLanguage('en'); this.audio.click(); syncLang(); this._refreshLists(); this._refreshOptionGroups(); });
    $('lang-it').addEventListener('click', () => { this.audio.init(); this.i18n.setLanguage('it'); this.audio.click(); syncLang(); this._refreshLists(); this._refreshOptionGroups(); });
    syncLang();

    // sliders
    $('cam-dist').value = this.camCtl.distance;
    $('cam-height').value = this.camCtl.height;
    $('volume').value = this.save.get('volume', 0.8);
    $('music-volume').value = this.save.get('musicVolume', 0.55);
    $('cam-dist').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      CONFIG.camera.distance = v;
      this.camCtl.distance = v;
      this.save.set('cameraDistance', v);
    });
    $('cam-height').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      CONFIG.camera.height = v;
      this.camCtl.height = v;
      this.save.set('cameraHeight', v);
    });
    $('volume').addEventListener('input', (e) => {
      this.audio.init();
      this.audio.setVolume(parseFloat(e.target.value));
    });
    $('music-volume').addEventListener('input', (e) => {
      this.music.init();
      this.music.setVolume(parseFloat(e.target.value));
    });

    // power-ups toggle
    const syncItems = () => {
      const on = this.save.get('itemsEnabled', true);
      $('items-on').classList.toggle('selected', on);
      $('items-off').classList.toggle('selected', !on);
    };
    $('items-on').addEventListener('click', () => { this.audio.init(); this.audio.click(); this.save.set('itemsEnabled', true); syncItems(); });
    $('items-off').addEventListener('click', () => { this.audio.init(); this.audio.click(); this.save.set('itemsEnabled', false); syncItems(); });
    syncItems();

    // option groups: difficulty tiers, quick-race laps, rival count
    this._buildOptionGroup('difficulty-list',
      DIFFICULTY_TIERS.map((d) => ({ value: d.tier, labelKey: d.nameKey })),
      () => this.save.get('difficulty', 'normal'),
      (v) => {
        this.save.set('difficulty', v);
        for (const kart of this.race.karts) {
          if (kart.ai) kart.ai.setDifficulty(v);
        }
      });
    this._buildOptionGroup('laps-list',
      [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) })),
      () => this.save.get('quickLaps', 3),
      (v) => this.save.set('quickLaps', v));
    this._buildOptionGroup('rivals-list',
      [0, 1, 2, 3].map((n) => ({ value: n, label: String(n) })),
      () => this.save.get('quickRivals', 3),
      (v) => this.save.set('quickRivals', v));
  }

  _buildOptionGroup(containerId, options, getCurrent, onSet) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    const buttons = [];
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-small';
      btn.textContent = opt.labelKey ? this.i18n.t(opt.labelKey) : opt.label;
      btn.addEventListener('click', () => {
        this.audio.init(); this.audio.click();
        onSet(opt.value);
        sync();
      });
      container.appendChild(btn);
      buttons.push({ btn, opt });
    }
    const sync = () => {
      const cur = getCurrent();
      for (const { btn, opt } of buttons) {
        btn.textContent = opt.labelKey ? this.i18n.t(opt.labelKey) : opt.label;
        btn.classList.toggle('selected', opt.value === cur);
      }
    };
    sync();
    this._optionGroups = this._optionGroups || [];
    this._optionGroups.push(sync);
  }

  _refreshOptionGroups() {
    for (const sync of this._optionGroups || []) sync();
  }

  openSettings() { this.hud.showScreen('screen-settings'); }

  // ------------------------------------------------------------ mode selection
  openModeSelect() {
    this.music.setState('menu');
    this.hud.showScreen('screen-mode');
  }

  openTrackSelect(mode) {
    this._trackSelectMode = mode;
    this._renderTrackList();
    this.hud.showScreen('screen-trackselect');
  }

  openCupSelect() {
    this._renderCupList();
    this.hud.showScreen('screen-cupselect');
  }

  _refreshLists() {
    const vis = document.getElementById('screen-trackselect');
    if (vis && !vis.classList.contains('hidden')) this._renderTrackList();
    const cup = document.getElementById('screen-cupselect');
    if (cup && !cup.classList.contains('hidden')) this._renderCupList();
  }

  _trophies() { return this.save.get('trophies', {}); }

  _cupUnlocked(cup) {
    if (cup.unlock.type === 'default') return true;
    const have = this._trophies()[cup.unlock.cupId];
    return trophyAtLeast(have, cup.unlock.minTrophy);
  }

  _renderTrackList() {
    const list = document.getElementById('track-list');
    list.innerHTML = '';
    for (const def of TRACK_DEFS) {
      const btn = document.createElement('button');
      btn.className = 'btn list-row';
      const name = document.createElement('span');
      name.textContent = this.i18n.t(def.nameKey);
      const meta = document.createElement('span');
      meta.className = 'list-meta';
      const rec = this.records.get(def.id);
      meta.textContent = this._trackSelectMode === 'timetrial'
        ? (rec?.bestTotal ? formatTime(rec.bestTotal) : this.i18n.t('tt.noRecord'))
        : this.i18n.t(def.teachKey);
      btn.append(name, meta);
      btn.addEventListener('click', () => {
        this.audio.click();
        this._startModeOnTrack(this._trackSelectMode, def.id);
      });
      list.appendChild(btn);
    }
  }

  _renderCupList() {
    const list = document.getElementById('cup-list');
    list.innerHTML = '';
    for (const cup of CUPS) {
      const btn = document.createElement('button');
      const unlocked = this._cupUnlocked(cup);
      btn.className = 'btn list-row' + (unlocked ? '' : ' locked');
      btn.disabled = !unlocked;
      const name = document.createElement('span');
      const trophy = this._trophies()[cup.id];
      name.textContent = `${this.i18n.t(cup.nameKey)}${trophy ? ` · ${this.i18n.t('trophy.' + trophy)}` : ''}`;
      const meta = document.createElement('span');
      meta.className = 'list-meta';
      meta.textContent = unlocked ? this.i18n.t(cup.descKey) : this.i18n.t('menu.locked');
      btn.append(name, meta);
      if (unlocked) {
        btn.addEventListener('click', () => {
          this.audio.click();
          this.gpSession = new GrandPrixSession(cup.id, 'ai.you');
          this._startModeOnTrack('grandprix', this.gpSession.trackId);
        });
      }
      list.appendChild(btn);
    }
  }

  _startModeOnTrack(mode, trackId) {
    this.mode = mode;
    const rivals = mode === 'quick' ? this.save.get('quickRivals', 3) : 3;
    this._loadTrack(trackId, false, { solo: mode === 'timetrial', rivals });
    if (mode === 'timetrial') {
      const rec = this.records.get(trackId);
      this.ghostPlayer = rec?.ghost
        ? new GhostPlayer(deserializeGhost(rec.ghost), FIXED_DT)
        : null;
    } else {
      this.ghostPlayer = null;
    }
    this.startRace();
  }

  // ------------------------------------------------------------------ battle
  openBattleSelect() {
    if (!this._battleModeId) this._battleModeId = BATTLE_MODES[0].id;
    if (!this._battleArenaId) this._battleArenaId = ARENAS[0].id;
    this._renderBattleLists();
    this.hud.showScreen('screen-battleselect');
  }

  _renderBattleLists() {
    const modeList = document.getElementById('battle-mode-list');
    modeList.innerHTML = '';
    for (const m of BATTLE_MODES) {
      const btn = document.createElement('button');
      btn.className = 'btn list-row' + (m.id === this._battleModeId ? ' selected' : '');
      const name = document.createElement('span');
      name.textContent = this.i18n.t(m.nameKey);
      const meta = document.createElement('span');
      meta.className = 'list-meta';
      meta.textContent = this.i18n.t(m.descKey);
      btn.append(name, meta);
      btn.addEventListener('click', () => {
        this.audio.click();
        this._battleModeId = m.id;
        this._renderBattleLists();
      });
      modeList.appendChild(btn);
    }
    const arenaList = document.getElementById('battle-arena-list');
    arenaList.innerHTML = '';
    for (const a of ARENAS) {
      const btn = document.createElement('button');
      btn.className = 'btn list-row' + (a.id === this._battleArenaId ? ' selected' : '');
      const name = document.createElement('span');
      name.textContent = this.i18n.t(a.nameKey);
      const meta = document.createElement('span');
      meta.className = 'list-meta';
      meta.textContent = this.i18n.t(a.teachKey);
      btn.append(name, meta);
      btn.addEventListener('click', () => {
        this.audio.click();
        this._battleArenaId = a.id;
        this._renderBattleLists();
      });
      arenaList.appendChild(btn);
    }
  }

  _startBattle() {
    this.mode = 'battle';
    this._loadTrack(this._battleArenaId, false, { rivals: 3 });
    this.startBattle();
  }

  startBattle() {
    this.appState = 'race';
    this.hud.hideScreens();
    this.hud.showHUD(true);
    this.audio.resume();
    this.music.resume();

    this.battle = new BattleManager({
      track: this.track,
      modeId: this._battleModeId,
      karts: this.race.karts,
      onEvent: (type, payload) => this.onRaceEvent(type, payload),
    });
    this._battleOverT = 0;
    this._bLastCount = 99;
    this._battleResultsShown = false;
    this.race.itemsEnabled = true;
    this.items.reset();
    this.items.setBoxes(this.track.itemBoxes);
    this.itemVisuals.setBoxes(this.items.boxes);
    for (const m of this.itemVisuals.boxMeshes) m.visible = true;
    this._setBattleHud(true);
    this.camCtl.snapTo(this.playerKart.vehicle);
    this.accumulator = 0;
    this.music.setState('countdown');
  }

  _setBattleHud(on) {
    document.getElementById('hud-pos').classList.toggle('hidden', on);
    document.getElementById('hud-lap').classList.toggle('hidden', on);
    document.getElementById('battle-info').classList.toggle('hidden', !on);
  }

  _updateBattleHud() {
    const b = this.battle;
    const el = document.getElementById('battle-info');
    if (!b) { el.textContent = ''; return; }
    const info = b.hudInfo();
    let line = this.i18n.t(b.mode.nameKey);
    if (info.timer > 0) line += ` · ${formatTime(info.timer)}`;
    if (b.mode.id === 'energy') {
      line += ` · ${this.i18n.t('battle.cores', { cores: info.primary, goal: info.goal })}`;
    } else if (b.mode.id === 'zones' || b.mode.id === 'score') {
      line += ` · ${this.i18n.t('gp.points', { points: info.primary })} · ${this.i18n.t('battle.hp')} ${info.hp}`;
    } else {
      line += ` · ${this.i18n.t('battle.hp')} ${info.hp}`;
    }
    el.textContent = line;
  }

  _battleStep(dt) {
    const b = this.battle;
    const wasCounting = b.state === 'countdown';
    b.update(dt);
    if (wasCounting && b.state === 'running') {
      this.hud.countdown(this.i18n.t('race.go'), true);
      this.audio.countBeep(true);
      this.music.setState('battle');
    }
    if (b.state === 'countdown') {
      const ceil = Math.ceil(b.countdownT);
      if (ceil !== this._bLastCount && ceil >= 1) {
        this._bLastCount = ceil;
        this.hud.countdown(String(ceil));
        this.audio.countBeep(false);
      }
    }

    const racing = b.state === 'running';
    const ZERO = { throttle: 0, brake: 1, steer: 0, drift: false, trick: false, item: false };
    for (const kart of this.race.karts) {
      const st = b.per.get(kart);
      let input = ZERO;
      if (racing && !st.eliminated) {
        input = kart.isPlayer ? this._battleInput : kart.ai.update(dt, this.race.karts, true, this.items);
      }
      kart.vehicle.step(dt, input, false);
      enforceArenaWalls(this.track.def, kart.vehicle);
      if (racing && input.item) this.items.useItem(kart, this.race.karts);
    }
    if (racing) {
      this.items.update(dt, this.race.karts, b.time);
      this._battleObstacleHits(b, dt);
    }
    this.track.update(dt, this.time);
  }

  _battleObstacleHits(b, dt) {
    const cols = this.track.getObstacleColliders();
    if (!cols.length) return;
    for (const kart of this.race.karts) {
      const st = b.per.get(kart);
      if (st.eliminated) continue;
      kart._hitCd = (kart._hitCd || 0) - dt;
      if (kart._hitCd > 0) continue;
      const v = kart.vehicle;
      for (const c of cols) {
        const dx = v.pos.x - c.x, dz = v.pos.z - c.z;
        if (dx * dx + dz * dz < (c.r + 1.2) * (c.r + 1.2)) {
          b.hitLanded(null, kart);
          v.vel.multiplyScalar(0.45);
          kart._hitCd = 1.2;
          this.camCtl.addTrauma(0.3);
          this.burstAt(v.pos, 0xff8a5a, 10);
          break;
        }
      }
    }
  }

  _showBattleResults() {
    const b = this.battle;
    const i18n = this.i18n;
    const order = b.standings();
    const winner = b.winner;
    this.hud.showHUD(false);
    this._setBattleHud(false);
    document.getElementById('hud-pos').classList.remove('hidden');
    document.getElementById('hud-lap').classList.remove('hidden');

    const headline = document.getElementById('results-headline');
    headline.textContent = winner
      ? i18n.t('battle.win', { name: i18n.t(winner.nameKey) })
      : i18n.t('battle.timeUp');
    const rowsEl = document.getElementById('results-rows');
    rowsEl.innerHTML = '';
    order.forEach((row, idx) => {
      const div = document.createElement('div');
      div.className = 'result-row' + (row.kart.isPlayer ? ' you' : '');
      const pos = document.createElement('span');
      pos.className = 'result-pos';
      pos.textContent = row.eliminated ? 'KO' : i18n.t('ordinal.' + Math.min(4, idx + 1));
      const name = document.createElement('span');
      name.className = 'result-name';
      name.textContent = i18n.t(row.kart.nameKey);
      const stat = document.createElement('span');
      stat.className = 'result-time';
      if (b.mode.id === 'energy') stat.textContent = i18n.t('battle.cores', { cores: row.cores, goal: b.mode.goal });
      else if (b.mode.id === 'zones' || b.mode.id === 'score') stat.textContent = i18n.t('gp.points', { points: Math.floor(row.score) });
      else stat.textContent = row.eliminated ? '' : i18n.t('battle.hp') + ' ' + Math.ceil(row.hp);
      div.append(pos, name, stat);
      rowsEl.appendChild(div);
    });
    document.getElementById('results-stats').textContent = '';
    document.getElementById('results-extra').innerHTML = '';
    document.getElementById('btn-results-restart').textContent = i18n.t('battle.start');
    this.hud.showScreen('screen-results');

    const playerWon = !!winner && winner.isPlayer;
    this.music.setState(playerWon ? 'victory' : 'defeat');
    recordStats(this.save, { battles: 1, battleWins: playerWon ? 1 : 0 });
    this._finishProgression({ kind: 'battle', won: playerWon }, {});
  }

  // ---------------------------------------------------------------- race flow
  startRace() {
    this.appState = 'race';
    this.hud.hideScreens();
    this.hud.showHUD(true);
    this.audio.resume();
    this.music.resume();

    // mode-specific setup
    if (this.mode === 'grandprix' && this.gpSession) {
      this.race.lapsOverride = this.gpSession.laps;
    } else if (this.mode === 'quick') {
      this.race.lapsOverride = this.save.get('quickLaps', 3);
    } else if (this.mode === 'timetrial') {
      this.race.lapsOverride = 3;
      this.ttSession = new TimeTrialSession(this.trackId);
      this.ttSession.start(0);
      this.ghostPlayer?.reset();
      this._setupGhostVis();
      if (this.ghostPlayer) {
        this.hud.notify(this.i18n.t('tt.raceGhost'));
        recordStats(this.save, { ghostsRaced: 1 });
      }
    } else {
      this.race.lapsOverride = null;
    }
    this._gpLap1Marked = false;

    this.race.itemsEnabled = this.save.get('itemsEnabled', true) && !!this.race.items
      && this.mode !== 'timetrial';   // time trials stay pure
    this.race.restart();
    this.hud.setItem(null);
    for (const m of this.itemVisuals.boxMeshes) m.visible = this.race.itemsEnabled;
    this.camCtl.snapTo(this.playerKart.vehicle);
    this.accumulator = 0;
    this._lastRaceState = 'countdown';
    this.music.setState('countdown');
  }

  restartCurrentRace() {
    if (this.mode === 'battle') {
      this._startBattle();
      return;
    }
    if (this.mode === 'grandprix' && this.gpSession && this.gpSession.finished) {
      this.returnToMenu();
      return;
    }
    this.startRace();
  }

  // Primary button on the results screen (mode-aware).
  onResultsPrimary() {
    if (this.mode === 'grandprix' && this.gpSession) {
      if (!this.gpSession.finished) {
        // advance to the next cup race
        this._loadTrack(this.gpSession.trackId, false, {});
        this.startRace();
        return;
      }
      this.returnToMenu();
      return;
    }
    this.restartCurrentRace();
  }

  returnToMenu() {
    this.appState = 'menu';
    this.race.state = 'idle';
    this.race.paused = false;
    this.hud.showHUD(false);
    this.hud.setItem(null);
    this.hud.showScreen('screen-main');
    this.audio.stopEngine();
    this.music.setState('menu');
    this.items.reset();
    this.itemVisuals.update(0, this.time, this.items);
    for (const m of this.itemVisuals.boxMeshes) m.visible = false;
    this._removeGhostVis();
    if (this.battle) {
      this.battle = null;
      this._setBattleHud(false);
      document.getElementById('hud-pos').classList.remove('hidden');
      document.getElementById('hud-lap').classList.remove('hidden');
    }
    this._placeOnGrid();
  }

  setPaused(on) {
    if (this.appState !== 'race') return;
    if (this.race.state === 'results') return;
    this.race.paused = on;
    this.hud.showScreen(on ? 'screen-pause' : '');
    if (!on) this.hud.hideScreens();
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------- race events
  onRaceEvent(type, payload) {
    if (type === 'raceGo') {
      this.music.setState('racing');
    } else if (type === 'playerFinalLap') {
      this.music.setState('finalLap');
    } else if (type === 'playerFinished') {
      this.music.setState(payload.pos <= 3 ? 'victory' : 'defeat');
    } else if (type === 'lapComplete') {
      if (payload.kart.isPlayer) recordStats(this.save, { laps: 1 });
      if (this.mode === 'timetrial' && this.ttSession && payload.kart.isPlayer) {
        this.ttSession.onLap(this.race.raceTime, payload.lapTime);
      }
      if (this.mode === 'grandprix' && this.gpSession && !this._gpLap1Marked && payload.lap === 1) {
        this._gpLap1Marked = true;
        this.gpSession.markLap1Leader(payload.kart.nameKey);
      }
    } else if (type === 'kartHit' || type === 'obstacleHit') {
      const n = Math.min(22, Math.floor(6 + payload.strength * 8));
      for (let i = 0; i < n; i++) {
        this.sparks.spawn(payload.pos, _pv.set(
          (Math.random() - 0.5) * 7,
          Math.random() * 5 + 1,
          (Math.random() - 0.5) * 7,
        ), { color: Math.random() > 0.4 ? 0xffc46a : 0xfff3d0, size: 0.32, life: 0.3 + Math.random() * 0.25, gravity: 9, drag: 2 });
      }
      this.camCtl.addTrauma(CONFIG.camera.collisionShake * Math.min(1.5, payload.strength));
    } else if (type === 'celebrate') {
      const colors = [0xff9a3c, 0x2fd8c8, 0xff5df1, 0xffd23f, 0x8aff6a];
      for (let i = 0; i < 90; i++) {
        this.dust.spawn(_pp.set(
          payload.pos.x + (Math.random() - 0.5) * 8,
          payload.pos.y + 6 + Math.random() * 5,
          payload.pos.z + (Math.random() - 0.5) * 8,
        ), _pv.set(
          (Math.random() - 0.5) * 3,
          -1 - Math.random() * 2,
          (Math.random() - 0.5) * 3,
        ), {
          color: colors[i % colors.length],
          size: 0.3 + Math.random() * 0.3,
          life: 1.6 + Math.random() * 1.2,
          gravity: 1.5, drag: 0.4,
        });
      }
    } else if (type === 'battleKO') {
      this.hud.notify(this.i18n.t('battle.ko', { name: this.i18n.t(payload.kart.nameKey) }));
      this.burstAt(payload.kart.vehicle.pos, 0xff5d5d, 24);
      this.camCtl.addTrauma(0.4);
    } else if (type === 'zoneCaptured') {
      if (payload.kart.isPlayer) {
        this.hud.notify(this.i18n.t('battle.zones'));
      }
      this.burstAt(payload.zone.pos, 0x2fd8c8, 18);
    } else if (type === 'battleOver') {
      this.music.setState(payload.winner?.isPlayer ? 'victory' : 'defeat');
      if (payload.winner) this.burstAt(payload.winner.vehicle.pos, 0xffd23f, 30);
    } else if (type === 'itemGet' || type === 'itemUse' || type === 'itemHit' || type === 'itemBlocked' ||
               type === 'boxPickup' || type === 'cloneFlash' || type === 'tempestZap' || type === 'chronoRestore') {
      this.onItemEvent(type, payload);
    } else if (type === 'landing') {
      const v = payload.vehicle;
      const n = Math.min(20, Math.floor(4 + payload.fall * 1.4));
      for (let i = 0; i < n; i++) {
        this.dust.spawn(_pp.set(v.pos.x, v.y + 0.15, v.pos.z), _pv.set(
          (Math.random() - 0.5) * 5,
          Math.random() * 2.2,
          (Math.random() - 0.5) * 5,
        ), { color: 0xd9b077, size: 0.55, life: 0.5 + Math.random() * 0.3, growth: 1.8, drag: 2.5 });
      }
      this.camCtl.addTrauma(Math.min(0.5, payload.fall * CONFIG.air.landingShakePerFallSpeed));
    }
  }

  // ----------------------------------------------------------- results (modes)
  _onResultsShown() {
    const extra = document.getElementById('results-extra');
    extra.innerHTML = '';
    const i18n = this.i18n;
    const restartBtn = document.getElementById('btn-results-restart');

    if (this.mode === 'grandprix' && this.gpSession) {
      // build result rows from current finishing order
      const order = this.race.positions();
      const rows = order.map((kart, i) => ({
        nameKey: kart.nameKey,
        pos: i + 1,
        bestLap: this.race.kartState.get(kart.vehicle).bestLap,
      }));
      const standings = this.gpSession.recordRace(rows);
      const playerPos = rows.find((r) => r.nameKey === 'ai.you')?.pos ?? rows.length;
      const pst = this.race.kartState.get(this.playerKart.vehicle);
      const fastest = pst.bestLap !== null && rows.every((r) => (pst.bestLap ?? Infinity) <= (r.bestLap ?? Infinity));
      recordStats(this.save, {
        races: 1, wins: playerPos === 1 ? 1 : 0,
        podiums: playerPos <= 3 ? 1 : 0, fastestLaps: fastest ? 1 : 0,
      });

      const div = document.createElement('div');
      div.className = 'gp-extra';
      const head = document.createElement('div');
      head.className = 'gp-head';
      head.textContent = this.gpSession.finished
        ? i18n.t('gp.standings')
        : i18n.t('gp.raceOf', { race: this.gpSession.raceIndex + 1, total: this.gpSession.cup.tracks.length });
      div.appendChild(head);

      for (const row of this.gpSession.standings()) {
        const line = document.createElement('div');
        line.className = 'gp-row' + (row.nameKey === 'ai.you' ? ' you' : '');
        const nm = document.createElement('span');
        nm.textContent = i18n.t(row.nameKey);
        const pts = document.createElement('span');
        pts.className = 'gp-pts';
        pts.textContent = i18n.t('gp.points', { points: row.points });
        line.append(nm, pts);
        div.appendChild(line);
      }

      if (standings) {
        const trophyLine = document.createElement('div');
        trophyLine.className = 'gp-trophy';
        if (standings.trophy) {
          trophyLine.textContent = i18n.t('gp.trophyWon', { trophy: i18n.t('trophy.' + standings.trophy) });
          const trophies = this._trophies();
          const prev = trophies[this.gpSession.cup.id];
          const trophyOrder = ['bronze', 'silver', 'gold', 'platinum'];
          if (!prev || trophyOrder.indexOf(standings.trophy) > trophyOrder.indexOf(prev)) {
            trophies[this.gpSession.cup.id] = standings.trophy;
            this.save.set('trophies', trophies);
          }
          recordStats(this.save, {
            cups: 1,
            cupsGold: standings.trophy === 'gold' ? 1 : 0,
            cupsPlatinum: standings.trophy === 'platinum' ? 1 : 0,
          });
          this.music.setState('victory');
        } else {
          trophyLine.textContent = i18n.t('gp.noTrophy');
          this.music.setState('defeat');
        }
        div.appendChild(trophyLine);
      }
      extra.appendChild(div);
      restartBtn.textContent = this.gpSession.finished
        ? i18n.t('menu.main')
        : i18n.t('menu.continue');
      this._finishProgression(
        { kind: 'gpRace', pos: playerPos, rivals: rows.length - 1 },
        {
          boardTime: pst.finishTime,
          trophy: standings ? standings.trophy : null,
        },
      );
    } else if (this.mode === 'timetrial' && this.ttSession) {
      const result = this.ttSession.finish();
      const updated = this.records.submit({
        trackId: result.trackId,
        totalTime: result.totalTime,
        bestLap: result.bestLap,
        lapTimes: result.lapTimes,
        ghostFrames: result.ghostFrames,
      });
      const rec = this.records.get(this.trackId);
      const div = document.createElement('div');
      div.className = 'gp-extra';
      const mk = (txt) => {
        const line = document.createElement('div');
        line.className = 'gp-row';
        line.textContent = txt;
        div.appendChild(line);
      };
      mk(`${i18n.t('tt.bestTotal')}: ${formatTime(rec.bestTotal)}`);
      mk(`${i18n.t('tt.bestLap')}: ${formatTime(rec.bestLap)}`);
      mk(`${i18n.t('tt.splits')}: ${result.lapTimes.map(formatTime).join(' · ')}`);
      if (updated.length > 0) {
        const banner = document.createElement('div');
        banner.className = 'gp-trophy';
        banner.textContent = i18n.t('race.newRecord');
        div.appendChild(banner);
      }
      extra.appendChild(div);
      restartBtn.textContent = i18n.t('menu.restart');
      this.music.setState(updated.length ? 'victory' : 'menu');
      recordStats(this.save, {
        races: 1,
        records: updated.length,
        fastestLaps: updated.includes('lap') ? 1 : 0,
      });
      this._finishProgression({
        kind: 'tt',
        totalRecord: updated.includes('total'),
        lapRecord: updated.includes('lap'),
      }, { boardTime: result.totalTime });
    } else {
      restartBtn.textContent = i18n.t('menu.restart');
      const order = this.race.positions();
      const pos = order.findIndex((k) => k.isPlayer) + 1;
      const pst = this.race.kartState.get(this.playerKart.vehicle);
      const fastest = pst.bestLap !== null && order.every((k) => {
        const st = this.race.kartState.get(k.vehicle);
        return pst.bestLap <= (st.bestLap ?? Infinity);
      });
      recordStats(this.save, {
        races: 1, wins: pos === 1 ? 1 : 0,
        podiums: pos <= 3 ? 1 : 0, fastestLaps: fastest ? 1 : 0,
      });
      this._finishProgression({ kind: 'race', pos, rivals: order.length - 1 },
        { boardTime: pst.finishTime });
    }
  }

  // XP + level-ups + unlocks + achievements + local leaderboard, with toasts.
  _finishProgression(event, { boardTime = null, trophy = null } = {}) {
    const i18n = this.i18n;
    if (boardTime != null) {
      const rank = this.leaderboard.submit(this.trackId, {
        name: i18n.t('ai.you'), time: boardTime,
      });
      if (rank) this.hud.notify(i18n.t('race.boardRank', { rank }));
    }
    const res = applyEvent(this.save, event);
    if (res.gained > 0) this.hud.notify(i18n.t('progression.xp', { xp: res.gained }));
    if (trophy) {
      const trophyRes = applyEvent(this.save, { kind: 'trophy', trophy });
      if (trophyRes.gained > 0) this.hud.notify(i18n.t('progression.xp', { xp: trophyRes.gained }));
      res.levelAfter = Math.max(res.levelAfter, trophyRes.levelAfter);
      res.newUnlocks.push(...trophyRes.newUnlocks);
    }
    if (res.levelAfter > res.levelBefore) {
      this.hud.notify(i18n.t('progression.levelUp', { level: res.levelAfter }));
      for (const u of res.newUnlocks.slice(0, 2)) {
        this.hud.notify(i18n.t('progression.unlocked', { item: i18n.t(u.nameKey) }));
      }
    }
    const fresh = checkAchievements(this.save, getProgress(this.save));
    if (fresh.length) {
      this.hud.notify(i18n.t('achievement.earned', { name: i18n.t(fresh[0].nameKey) }));
    }
  }

  // ------------------------------------------------------------- item events
  onItemEvent(type, payload) {
    const player = this.playerKart;
    if (type === 'itemGet') {
      this.burstAt(payload.pos ?? payload.kart?.vehicle?.pos, 0x2fd8c8, 8);
      if (payload.isPlayer) {
        recordStats(this.save, { itemsTaken: 1 });
        this.hud.setItem(payload.itemId);
        this.hud.notify(this.i18n.t('race.gotItem', { item: this.i18n.t(ITEMS[payload.itemId].nameKey) }));
      }
    } else if (type === 'itemUse') {
      if (payload.kart?.isPlayer) {
        recordStats(this.save, { itemsUsed: 1 });
        this.hud.setItem(this.items.heldItem(player));
      }
    } else if (type === 'itemHit') {
      this.burstAt(payload.pos, ITEMS[payload.itemId]?.color ?? 0xffffff, 16);
      this.camCtl.addTrauma(0.35);
      if (this.mode === 'battle' && this.battle && payload.victim) {
        this.battle.hitLanded(payload.attacker || null, payload.victim);
      }
      if (payload.victim?.isPlayer) {
        this.hud.setItem(null);
        this.hud.notify(this.i18n.t('race.hitBy', { item: this.i18n.t(ITEMS[payload.itemId].nameKey) }));
      } else if (payload.victim && !payload.kart?.isPlayer) {
        const near = payload.pos && payload.pos.distanceTo(player.vehicle.pos) < 60;
        if (near) this.hud.notify(this.i18n.t('race.youHit', { victim: this.i18n.t(payload.victim.nameKey) }));
      }
    } else if (type === 'itemBlocked') {
      this.burstAt(payload.pos, 0x9a8aff, 14);
      if (payload.victim?.isPlayer) this.hud.notify(this.i18n.t('race.itemBlocked'));
    } else if (type === 'boxPickup') {
      this.burstAt(payload.pos, 0xbaffec, 10);
      if (this.mode === 'battle' && this.battle && payload.kart) {
        this.battle.boxPicked(payload.kart);
      }
    } else if (type === 'cloneFlash' || type === 'tempestZap') {
      this.burstAt(payload.pos, type === 'cloneFlash' ? 0xbaf0ff : 0x8ac8ff, 20);
      this.camCtl.addTrauma(0.3);
    } else if (type === 'chronoRestore') {
      this.burstAt(payload.pos, 0xc8b0ff, 12);
      this.hud.notify(this.i18n.t('race.chronoRestore'));
    }
  }

  burstAt(pos, color, n) {
    if (!pos) return;
    for (let i = 0; i < n; i++) {
      this.sparks.spawn(_pp.set(pos.x, pos.y + 0.5, pos.z), _pv.set(
        (Math.random() - 0.5) * 7, Math.random() * 5 + 1, (Math.random() - 0.5) * 7,
      ), { color, size: 0.34, life: 0.3 + Math.random() * 0.25, gravity: 8, drag: 2 });
    }
  }

  // -------------------------------------------------------------------- FX
  perFrameFX(dt) {
    for (const kart of this.race.karts) {
      const v = kart.vehicle;
      if (!v.surf) continue;

      // drift smoke at rear wheels, tinted by charge level
      if (v.drift.drifting && v.grounded) {
        const col = DRIFT_COLORS[v.drift.level];
        for (const side of [1, -1]) {
          _wp.set(side * 0.82, 0, -0.95).applyAxisAngle(_up, v.yaw).add(v.pos);
          _wp.y = v.y + 0.18;
          this.dust.spawn(_wp, _pv.set(
            -Math.sin(v.yaw) * 2.2 + (Math.random() - 0.5) * 1.6,
            0.8 + Math.random() * 1.2,
            -Math.cos(v.yaw) * 2.2 + (Math.random() - 0.5) * 1.6,
          ), { color: col, size: 0.5, life: 0.45 + Math.random() * 0.25, growth: 2.2, drag: 2.2 });
        }
        this.audio.setDrift(true, v.drift.level);
      } else if (kart.isPlayer) {
        this.audio.setDrift(false, 0);
      }

      // boost exhaust flames
      if (v.boost.boosting) {
        for (let i = 0; i < 2; i++) {
          const side = i === 0 ? 1 : -1;
          _wp.set(side * 0.34, 0, -1.5).applyAxisAngle(_up, v.yaw).add(v.pos);
          _wp.y = v.y + 0.5;
          this.sparks.spawn(_wp, _pv.set(
            -Math.sin(v.yaw) * 9 + (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 1.5,
            -Math.cos(v.yaw) * 9 + (Math.random() - 0.5) * 2,
          ), { color: Math.random() > 0.5 ? 0x66e8ff : 0xffb830, size: 0.42, life: 0.22, drag: 1.2 });
        }
      }

      // off-road sand spray
      if (!v.surf.onRoad && v.speedAbs > 4 && v.grounded && Math.random() < 0.6) {
        _wp.set((Math.random() - 0.5) * 1.4, 0, (Math.random() - 0.5) * 1.4).add(v.pos);
        _wp.y = v.y + 0.12;
        this.dust.spawn(_wp, _pv.set(
          (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3,
        ), { color: 0xd9a86a, size: 0.5, life: 0.5, growth: 1.5, drag: 2 });
      }

      // boost-pad zap
      if (v.fx && v.fx.pad) {
        for (let i = 0; i < 10; i++) {
          this.sparks.spawn(_pp.set(v.pos.x, v.y + 0.2, v.pos.z), _pv.set(
            (Math.random() - 0.5) * 6, Math.random() * 4 + 2, (Math.random() - 0.5) * 6,
          ), { color: 0x40f0e0, size: 0.35, life: 0.3, gravity: 6, drag: 1.5 });
        }
      }
    }
  }

  // ------------------------------------------------------------------ frame
  frame() {
    let rawDt = Math.min(0.1, this.clock.getDelta());
    this.time += rawDt;

    if (this.appState === 'menu') {
      this.camCtl.updateMenu(rawDt);
    } else if (this.mode === 'battle' && this.battle) {
      // ---------------------------------------------------------- battle mode
      if (this.input.wasPressed('pause')) {
        if (this.battle.state !== 'over' && !this._battleResultsShown) {
          this.setPaused(!this.race.paused);
        }
      }
      if (this._battleResultsShown && this.input.wasPressed('confirm')) {
        this.onResultsPrimary();
      }

      if (!this.race.paused) {
        this._battleInput = this.input.snapshot();
        this.accumulator += rawDt;
        let steps = 0;
        while (this.accumulator >= FIXED_DT && steps < 4) {
          this._battleStep(FIXED_DT);
          this.accumulator -= FIXED_DT;
          steps++;
        }
        if (steps === 4) this.accumulator = 0;

        for (const kart of this.race.karts) {
          updateKartVisual(this.kartVisuals.get(kart.vehicle), kart.vehicle, rawDt, this.time);
          if (kart.charVis) animateCharacter(kart.charVis, kart.vehicle, rawDt, this.time);
        }
        this.perFrameFX(rawDt);
        if (this.race.itemsEnabled) {
          this.itemVisuals.update(rawDt, this.time, this.items);
          this.hud.setItem(this.items.heldItem(this.playerKart));
        }

        const pv = this.playerKart.vehicle;
        if (this.battle.state === 'running') {
          this.audio.updateEngine(pv.speedAbs / CONFIG.vehicle.maxSpeed,
            this._battleInput.throttle, pv.boost.boosting);
        } else {
          this.audio.updateEngine(0, 0, false);
        }
        this.camCtl.update(rawDt, pv, pv.boost.boosting, this.time);
        this._updateBattleHud();

        if (this.battle.state === 'over' && !this._battleResultsShown) {
          this._battleOverT += rawDt;
          if (this._battleOverT > 1.6) {
            this._battleResultsShown = true;
            this._showBattleResults();
          }
        }
      }
    } else {
      // pause toggle
      if (this.input.wasPressed('pause')) {
        if (this.race.state !== 'idle' && this.race.state !== 'results') {
          this.setPaused(!this.race.paused);
        }
      }
      if (this.race.state === 'results' && this.input.wasPressed('confirm')) {
        this.onResultsPrimary();
      }
      // manual reset
      if (!this.race.paused && this.race.state === 'racing' && this.input.wasPressed('reset')) {
        this.playerKart.vehicle.doReset('manual');
      }

      if (!this.race.paused) {
        this.race.playerInput = this.input.snapshot();

        // fixed-timestep simulation
        this.accumulator += rawDt;
        let steps = 0;
        while (this.accumulator >= FIXED_DT && steps < 4) {
          this.race.update(FIXED_DT);
          this.track.update(FIXED_DT, this.time);
          if (this.mode === 'timetrial' && this.ttSession && this.race.state === 'racing') {
            this.ttSession.captureGhost(this.playerKart.vehicle);
          }
          this.accumulator -= FIXED_DT;
          steps++;
        }
        if (steps === 4) this.accumulator = 0;

        // visuals
        for (const kart of this.race.karts) {
          updateKartVisual(this.kartVisuals.get(kart.vehicle), kart.vehicle, rawDt, this.time);
          if (kart.charVis) animateCharacter(kart.charVis, kart.vehicle, rawDt, this.time);
        }
        this.perFrameFX(rawDt);

        // ghost playback (time trial)
        if (this.ghostPlayer && this.ghostVis && this.race.state !== 'idle') {
          const pose = this.ghostPlayer.update(rawDt);
          if (pose) {
            this.ghostVis.group.position.set(pose.x, pose.y, pose.z);
            this.ghostVis.group.rotation.y = pose.yaw;
            this.ghostVis.group.visible = true;
          }
        } else if (this.ghostVis) {
          this.ghostVis.group.visible = false;
        }

        // item visuals + held-item slot
        if (this.race.itemsEnabled) {
          this.itemVisuals.update(rawDt, this.time, this.items);
          this.hud.setItem(this.items.heldItem(this.playerKart));
        }

        // player engine audio
        const pv = this.playerKart.vehicle;
        const racing = this.race.state === 'racing' || this.race.state === 'finished';
        if (racing) {
          this.audio.updateEngine(pv.speedAbs / CONFIG.vehicle.maxSpeed,
            this.race.playerInput.throttle, pv.boost.boosting);
          if (pv.boost.boosting) this.camCtl.addTrauma(CONFIG.camera.boostShake * rawDt * 3);
        } else {
          this.audio.updateEngine(0, 0, false);
        }

        this.camCtl.update(rawDt, pv, pv.boost.boosting, this.time);
      }

      // results transition hook (once per race)
      if (this.race.state === 'results' && this._lastRaceState !== 'results') {
        this._onResultsShown();
      }
      this._lastRaceState = this.race.state;
    }

    this.dust.update(rawDt);
    this.sparks.update(rawDt);
    this.env.state.update(rawDt, this.time);

    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }
}

const _pv = new THREE.Vector3();
const _pp = new THREE.Vector3();
const _wp = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

try {
  new Game();
} catch (err) {
  console.error(err);
  document.getElementById('webgl-error').classList.remove('hidden');
  for (const s of ['screen-main']) document.getElementById(s).classList.add('hidden');
}
