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
import { BattleAI } from './battleAI.js';
import { BattleZoneFX } from './battleFX.js';
import { buildKart, buildKartFromLoadout, updateKartVisual } from './kartMesh.js';
import { KartPreview } from './kartPreview.js';
import { animateCharacter } from './characterMesh.js';
import { VehicleController } from './vehicle.js';
import { AIController } from './ai.js';
import { buildRaceRoster } from './roster.js';
import { buildLoadout } from './content/loadout.js';
import { Garage } from './garage.js';
import { GarageUI } from './ui/garageUI.js';
import { RecordsUI } from './ui/recordsUI.js';
import { getCharacter } from './content/characters.js';
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
import { OnlineService } from './online.js';
import { NetSession } from './netplay.js';
import { OnlineUI } from './ui/onlineUI.js';

const FIXED_DT = 1 / 60;

// Themes that count as "after dark" for the Night Shift achievement.
const NIGHT_THEMES = new Set(['space', 'crystal', 'storm']);

class Game {
  constructor() {
    this.save = new SaveManager();
    this.i18n = new LocalizationManager(this.save);
    this.input = new InputManager();
    this.audio = new AudioManager(this.save);
    this.music = new MusicManager(this.save);
    this.records = new RecordsStore(this.save);
    this.leaderboard = new LocalLeaderboard(this.save);
    // OnlineService is itself a provider: it stays on the local leaderboard
    // until the game server answers /api/ping, then switches to HTTP.
    this.online = new OnlineService({ leaderboard: this.leaderboard, save: this.save });
    this.provider = this.online;
    this.appState = 'menu';          // menu | garage | race
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

    // customization (Increment 6): the garage owns the equipped loadout, the
    // preview canvas is created lazily the first time the garage opens.
    this.garage = new Garage(this.save);
    this.garageUI = null;
    this.recordsUI = null;
    this.onlineUI = null;
    this.preview = null;

    // netplay state (live races). Remote karts are visual-only: they are
    // driven by interpolated relay snapshots and never collide with us.
    this.net = null;
    this.netRace = false;
    this.netKarts = new Map();      // net player id -> { kart, vis, id }
    this.rankedMatch = false;
    this._netSendAcc = 0;

    this.trackId = this.save.get('lastTrack', 'sunforge_circuit');
    this._loadTrack(this.trackId, true);

    this.bindUI();
    this.refreshMenuSummary();
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
    // Roster: the player drives their garage build; every rival drives their own
    // character's signature loadout (src/roster.js), so stats, silhouettes and
    // physics all differ across the grid. The player entry keeps the 'ai.you'
    // name key so Grand Prix scoring and records are unchanged.
    this.kartVisuals = new Map();
    this.roster = buildRaceRoster({
      playerSpec: this.garage.spec,
      rivals: solo ? 0 : Math.max(0, Math.min(3, rivals)),
    });

    this.race = new RaceManager({
      track: this.track, hud: this.hud, audio: this.audio, i18n: this.i18n,
      items: this.items,
      onEvent: (type, payload) => this.onRaceEvent(type, payload),
    });
    for (const d of this.roster) {
      const vehicle = new VehicleController(this.track, d.isPlayer, d.loadout.params, d.loadout.driftMods);
      const vis = buildKartFromLoadout(d.loadout);
      this.scene.add(vis.group);
      this.scene.add(vis.shadow);
      this.kartVisuals.set(vehicle, vis);
      const kart = {
        vehicle,
        ai: d.isPlayer ? null : new AIController(vehicle, this.track, d.personality),
        nameKey: d.nameKey,
        characterId: d.characterId,
        isPlayer: d.isPlayer,
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
    click('btn-garage', () => this.openGarage());
    click('btn-records', () => this.openRecords());
    click('btn-online', () => this.openOnline());
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
    this.i18n.onChange(() => this.refreshMenuSummary());

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

  // -------------------------------------------------------------- garage / UI
  // The garage is a menu-level state: the race renderer keeps its world (so
  // returning to the grid is instant) but stops drawing while the preview's
  // own canvas is on screen.
  openGarage() {
    this.appState = 'garage';
    this.hud.showHUD(false);
    if (!this.preview) this.preview = new KartPreview(document.getElementById('garage-canvas'));
    if (!this.garageUI) {
      this.garageUI = new GarageUI({
        i18n: this.i18n,
        garage: this.garage,
        preview: this.preview,
        onBack: () => this.closeGarage(),
        onRace: () => { this.closeGarage(); this.openModeSelect(); },
      });
    }
    this.hud.showScreen('screen-garage');
    this.garageUI.show();
    this.music.setState('menu');
  }

  closeGarage() {
    if (this.garageUI) this.garageUI.hide();
    this._vocalize(this.playerKart, 'greet');
    this.appState = 'menu';
    this.hud.showScreen('screen-main');
    this.refreshMenuSummary();
    this._rebuildPlayerVisual();
  }

  // Menu-level records/leaderboard/achievement browser.
  // Online screen: server status, ranked standing, world ghosts, live lobbies.
  openOnline() {
    if (!this.onlineUI) {
      this.onlineUI = new OnlineUI({
        i18n: this.i18n,
        service: this.online,
        save: this.save,
        tracks: TRACK_DEFS,
        session: this._netSession(),
        onBack: () => this.hud.showScreen('screen-main'),
        onRankedRace: (trackId) => this.startRankedRace(trackId),
        onGhostRace: (trackId, rank) => this.startGhostDuel(trackId, rank),
        onLobbyStart: () => {},
      });
    } else {
      this.onlineUI.session = this._netSession();
    }
    this.appState = 'menu';
    this.hud.showScreen('screen-online');
    this.onlineUI.show();
  }

  // One NetSession for the whole app; created lazily so a player who never
  // opens the online screen never opens a socket.
  _netSession() {
    if (!this.net) {
      this.net = new NetSession();
      this.net.on('started', (msg) => this._onNetRaceStarted(msg));
      this.net.on('finished', (msg) => {
        this.hud.notify(this.i18n.t('online.netFinished', {
          name: msg.name, time: formatTime(msg.time ?? 0),
        }));
      });
      this.net.on('over', (msg) => this._onNetRaceOver(msg));
      this.net.on('serverError', (msg) => {
        this.hud.notify(this.i18n.t(`online.error.${msg.code}`) || this.i18n.t('online.error.generic'));
      });
    }
    return this.net;
  }

  playerName() { return this.save.get('playerName', 'Racer'); }

  // ------------------------------------------------------------ ranked race
  startRankedRace(trackId) {
    this.rankedMatch = true;
    this.netRace = false;
    this._startModeOnTrack('quick', trackId || this.trackId);
  }

  async _submitRankedResult(position) {
    const won = position === 1;
    const player = this.playerName();
    try {
      if (!this.online.online) await this.online.probe();
      const res = await this.online.submitMatch(player, { trackId: this.trackId, won });
      if (res && Number.isFinite(res.delta)) {
        const delta = `${res.delta > 0 ? '+' : ''}${res.delta}`;
        this.hud.notify(this.i18n.t('online.rankedResult', { delta, points: Math.round(res.points) }));
      }
      this.online.ranked = res;
    } catch {
      this.hud.notify(this.i18n.t('online.error.generic'));
    } finally {
      this.rankedMatch = false;
    }
  }

  // --------------------------------------------------------- world ghost duel
  async startGhostDuel(trackId, rank = 1) {
    const ghost = await this.online.fetchWorldGhost(trackId, rank);
    if (!ghost || !ghost.frames.length) {
      this.hud.notify(this.i18n.t('online.noGhost'));
      return;
    }
    this.downloadedGhost = ghost;
    this._startModeOnTrack('timetrial', trackId);
  }

  // ------------------------------------------------------------- live netplay
  async _onNetRaceStarted(msg) {
    const trackId = msg.trackId || this.trackId;
    this.mode = 'quick';
    this.rankedMatch = false;
    this.netRace = true;
    this._loadTrack(trackId, false, { solo: true, rivals: 0 });
    this._buildNetKarts();
    this.hud.showScreen('');
    this.startRace();
    this.hud.notify(this.i18n.t('online.netRace'));
  }

  // Remote racers get their own kart mesh (their own garage build) and are
  // added to the scene only - no physics, no collisions, no race logic.
  _buildNetKarts() {
    for (const [, entry] of this.netKarts) {
      this.scene.remove(entry.vis.group);
      this.scene.remove(entry.vis.shadow);
    }
    this.netKarts.clear();
    if (!this.net) return;
    const grid = this.track.startGrid();
    let slot = 1;
    for (const p of this.net.remotes()) {
      const spec = {
        characterId: p.characterId || this.garage.spec.characterId,
        chassisId: p.chassisId || this.garage.spec.chassisId,
        wheelId: p.wheelId || this.garage.spec.wheelId,
        paintId: p.paintId || this.garage.spec.paintId,
        decalId: 'none',
        exhaustId: this.garage.spec.exhaustId,
        effectId: this.garage.spec.effectId,
      };
      let loadout = null;
      try { loadout = buildLoadout(spec); } catch { loadout = this.garage.loadout; }
      const vis = buildKartFromLoadout(loadout);
      const slotPos = grid[(slot + 1) % grid.length];
      if (slotPos) vis.group.position.set(slotPos.pos.x, slotPos.pos.y ?? 0, slotPos.pos.z);
      this.scene.add(vis.group);
      this.scene.add(vis.shadow);
      this.netKarts.set(p.id, { id: p.id, name: p.name, vis, loadout });
      slot++;
    }
  }

  _updateNetKarts(dt) {
    if (!this.net || !this.netRace) return;
    for (const [, entry] of this.netKarts) {
      const sample = this.net.sampleRemote(entry.id);
      if (!sample) continue;
      const g = entry.vis.group;
      g.position.set(sample.pos[0], sample.pos[1], sample.pos[2]);
      g.rotation.y = sample.yaw;
      // keep the wheels and pilot alive without a vehicle of their own
      entry.vis.wheels?.forEach((w, i) => { w.rotation.x += dt * 6 * (i % 2 ? 1 : -1) * 0.5; });
      if (entry.vis.charVis) {
        entry.vis.charVis.group.position.y = 0.6 + Math.sin(this.time * 6 + entry.id.length) * 0.03;
      }
      entry.vis.shadow.position.set(sample.pos[0], (sample.pos[1] ?? 0) + 0.02, sample.pos[2]);
    }
  }

  // Sends our own kart to the relay at a fixed rate (the session throttles).
  _sendNetState() {
    if (!this.net || !this.netRace) return;
    const v = this.playerKart.vehicle;
    const st = this.race.kartState.get(v);
    this.net.sendState({
      pos: [v.pos.x, v.pos.y, v.pos.z],
      yaw: v.yaw,
      speed: v.speedAbs,
      lap: this.race.lap ?? 0,
      progress: this.race.progressOf ? this.race.progressOf(this.playerKart) : (v.surf?.progress ?? 0),
      drifting: !!(v.drift && v.drift.drifting),
      boosting: !!v.boost.boosting,
      item: this.items.heldItem(this.playerKart),
      finished: st ? !!st.finished : false,
    });
  }

  _onNetRaceOver(msg) {
    const rows = (msg.standings || []).slice(0, 8);
    this.netStandings = rows;
    if (this.netRace) this.hud.notify(this.i18n.t('online.netRace'));
    this._renderNetStandings();
  }

  _renderNetStandings() {
    const box = document.getElementById('results-net');
    if (!box) return;
    box.innerHTML = '';
    if (!this.netStandings || !this.netStandings.length) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    const head = document.createElement('div');
    head.className = 'panel-head';
    head.textContent = this.i18n.t('online.ladder');
    box.appendChild(head);
    for (const row of this.netStandings) {
      const line = document.createElement('div');
      line.className = 'gp-row' + (row.name === this.playerName() ? ' you' : '');
      const nm = document.createElement('span');
      nm.textContent = `#${row.rank} ${row.name}`;
      const val = document.createElement('span');
      val.className = 'gp-pts';
      val.textContent = row.finished && row.time != null ? formatTime(row.time) : `${row.lap}`;
      line.append(nm, val);
      box.appendChild(line);
    }
  }

  // Leaving a live race (results screen, menu, track switch) closes the room.
  _leaveNetRace() {
    if (!this.netRace) return;
    this.netRace = false;
    if (this.net) this.net.leave();
    for (const [, entry] of this.netKarts) {
      this.scene.remove(entry.vis.group);
      this.scene.remove(entry.vis.shadow);
    }
    this.netKarts.clear();
    this.netStandings = null;
  }

  openRecords() {
    if (!document.getElementById('screen-records')) return;
    this.appState = 'menu';
    if (!this.recordsUI) {
      this.recordsUI = new RecordsUI({
        i18n: this.i18n,
        save: this.save,
        provider: this.provider,
        records: this.records,
        onBack: () => this.hud.showScreen('screen-main'),
        onPractice: (trackId) => this._startModeOnTrack('timetrial', trackId),
      });
    }
    this.hud.showScreen('screen-records');
    this.recordsUI.show();
  }

  // Player headline lines on the main menu (pilot + current build).
  refreshMenuSummary() {
    const loadout = this.garage.loadout;
    const i18n = this.i18n;
    const pilot = document.getElementById('menu-pilot');
    const kart = document.getElementById('menu-kart');
    if (pilot) {
      pilot.textContent = i18n.t('menu.pilotLine', {
        name: i18n.t(loadout.character.nameKey),
        species: i18n.t(loadout.character.speciesKey),
      });
    }
    if (kart) {
      kart.textContent = i18n.t('menu.kartLine', {
        chassis: i18n.t(loadout.chassis.nameKey),
        wheels: i18n.t(loadout.wheels.nameKey),
      });
    }
  }

  // Swaps the player's kart mesh + physics to the freshly equipped build
  // without rebuilding the world (used after the garage closes).
  _rebuildPlayerVisual() {
    const kart = this.playerKart;
    if (!kart || !this.kartVisuals) return;
    const old = this.kartVisuals.get(kart.vehicle);
    if (old) {
      this.scene.remove(old.group);
      this.scene.remove(old.shadow);
    }
    const loadout = this.garage.loadout;
    const vis = buildKartFromLoadout(loadout);
    this.scene.add(vis.group);
    this.scene.add(vis.shadow);
    this.kartVisuals.set(kart.vehicle, vis);
    kart.charVis = vis.charVis || null;
    kart.characterId = loadout.character.id;
    kart.vehicle.params = loadout.params;
    kart.vehicle.driftMods = loadout.driftMods;
    kart.vehicle.drift.mods = loadout.driftMods;
  }

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
      // a downloaded world ghost (online screen) takes priority over the
      // local record; both feed the same GhostPlayer.
      const rec = this.records.get(trackId);
      if (this.downloadedGhost && this.downloadedGhost.frames?.length) {
        this.ghostPlayer = new GhostPlayer(this.downloadedGhost.frames, FIXED_DT);
        this.ghostLabel = this.downloadedGhost.name;
      } else {
        this.ghostPlayer = rec?.ghost ? new GhostPlayer(deserializeGhost(rec.ghost), FIXED_DT) : null;
        this.ghostLabel = null;
      }
      this.downloadedGhost = null;
    } else {
      this.ghostPlayer = null;
      this.ghostLabel = null;
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

    // Arena drivers get their own brain: tactical objectives instead of the
    // racing line (which is meaningless in a free-roaming arena).
    for (const kart of this.race.karts) {
      if (!kart.isPlayer) {
        kart.battleAi = new BattleAI(kart.vehicle, this.track, kart.ai ? kart.ai.personalityKey : 'balanced');
        kart.battleAi.setDifficulty(this.save.get('difficulty', 'normal'));
      }
    }
    // capture-zone rings (only the 'zones' mode has zones)
    if (!this.zoneFX) this.zoneFX = new BattleZoneFX(this.scene);
    this.zoneFX.build(this.battle.zones || []);
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
    this.hud.showBattleBoard(!!on);
    if (!on) this.hud.setBattleBoard([]);
  }

  // Live arena scoreboard: every kart, its objective value and a progress bar.
  _updateBattleBoard() {
    const b = this.battle;
    if (!b) return;
    const mode = b.mode.id;
    const rows = b.standings().map((row) => {
      const value = mode === 'energy'
        ? this.i18n.t('battle.cores', { cores: row.cores, goal: b.mode.goal })
        : (mode === 'zones' || mode === 'score')
          ? this.i18n.t('gp.points', { points: Math.floor(row.score) })
          : `${this.i18n.t('battle.hp')} ${Math.ceil(row.hp)}`;
      let bar = null;
      if (mode === 'energy') bar = row.cores / b.mode.goal;
      else if (Number.isFinite(row.hp)) bar = row.hp / (row.hpMax || 1);
      return {
        name: this.i18n.t(row.kart.nameKey),
        value,
        bar,
        isPlayer: row.kart.isPlayer,
        eliminated: row.eliminated,
      };
    });
    this.hud.setBattleBoard(rows);
  }

  // Character vocalizations: wordless synthesized reactions using each
  // pilot's voice profile. Rival reactions fade with distance.
  _vocalize(kart, kind) {
    if (!kart || !kart.characterId) return;
    const character = getCharacter(kart.characterId);
    if (!character || !character.voice) return;
    const distance = kart.isPlayer ? 0 : kart.vehicle.pos.distanceTo(this.playerKart.vehicle.pos);
    this.audio.vocalize(character.voice, kind, { distance });
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
    } else if (b.mode.id === 'zones') {
      line += ` · ${this.i18n.t('battle.zonesHeld', { held: info.zonesHeld, total: info.zonesTotal })}`
        + ` · ${this.i18n.t('battle.hp')} ${info.hp}`;
    } else if (b.mode.id === 'score') {
      line += ` · ${this.i18n.t('gp.points', { points: info.primary })} · ${this.i18n.t('battle.hp')} ${info.hp}`;
    } else {
      line += ` · ${this.i18n.t('battle.hp')} ${info.hp}`;
    }
    el.textContent = line;
    this._updateBattleBoard();
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
        input = kart.isPlayer
          ? this._battleInput
          : (kart.battleAi || kart.ai).update(dt, this.race.karts, b, this.items, this.track.def);
      }
      kart.vehicle.step(dt, input, false);
      enforceArenaWalls(this.track.def, kart.vehicle);
      if (racing && input.item) this.items.useItem(kart, this.race.karts);
    }
    if (racing) {
      this.items.update(dt, this.race.karts, b.time);
      this._battleObstacleHits(b, dt);
    }
    if (this.zoneFX) this.zoneFX.update(this.race.karts, this.time);
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
    if (this.netRace) {
      // a live race cannot be restarted locally: leave the room instead
      this._leaveNetRace();
      this.returnToMenu();
      return;
    }
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
    this._leaveNetRace();
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
    if (this.zoneFX) this.zoneFX.clear();
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
      this._vocalize(this.playerKart, 'start');
      for (const kart of this.race.karts) if (!kart.isPlayer) this._vocalize(kart, 'start');
    } else if (type === 'playerFinalLap') {
      this.music.setState('finalLap');
      this._vocalize(this.playerKart, 'hype');
    } else if (type === 'playerFinished') {
      this.music.setState(payload.pos <= 3 ? 'victory' : 'defeat');
      this._vocalize(this.playerKart, payload.pos === 1 ? 'win' : 'lose');
      if (this.rankedMatch) this._submitRankedResult(payload.pos);
      if (this.netRace && this.net) {
        this.net.reportFinish({ time: this.race.raceTime, position: payload.pos });
      }
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
      this._vocalize(payload.kart, 'lose');
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
        nightWins: playerPos === 1 && NIGHT_THEMES.has(this.track.def.theme) ? 1 : 0,
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
        nightWins: pos === 1 && NIGHT_THEMES.has(this.track.def.theme) ? 1 : 0,
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
      if (payload.victim) this._vocalize(payload.victim, 'hit');
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

      // pilot reaction when a boost lights up
      if (v.fx && v.fx.boostStart) {
        const kart = this.race.karts.find((k) => k.vehicle === v);
        if (kart && Math.random() < 0.55) this._vocalize(kart, 'boost');
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
    } else if (this.appState === 'garage') {
      // garage: only the preview canvas animates, the race world is frozen
      if (this.input.wasPressed('pause')) this.closeGarage();
      if (this.preview) this.preview.update(rawDt, this.time);
      this.input.endFrame();
      return;
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

        // live netplay: remote karts follow relay snapshots, and our own kart
        // goes out at the session's fixed rate.
        if (this.netRace) {
          this._updateNetKarts(rawDt);
          this._sendNetState();
        }

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
