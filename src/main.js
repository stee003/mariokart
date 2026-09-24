// ============================================================================
// SUNFORGE RACERS - main entry point.
// Wires renderer, track, karts, race manager, HUD, audio, music, camera,
// particles, items and the app state machine (menus -> modes -> race ->
// results). Fixed-timestep physics.
//
// Modes: quick race, grand prix (cup progression + scoring), time trial
// (records + ghost playback), battle arenas. Garage customization, settings
// (language / a11y / remap) and records all flow through the same plumbing.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { CONFIG } from './config.js';
import { SaveManager } from './save.js';
import { LocalizationManager } from './i18n.js';
import { InputManager, keyLabel, REMAPPABLE_ACTIONS } from './input.js';
import { AudioManager, ENGINE_VOLUME_DEFAULT } from './audio.js';
import { GamepadUINavigator } from './uiNav.js';
import { MusicManager } from './music.js';
import { TrackManager, resolveObstacleContact, KART_HIT_BOTTOM, KART_HIT_TOP } from './track.js';
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
import { driftColors } from './drift.js';
import { ItemSystem } from './items.js';
import { ItemVisuals } from './itemMesh.js';
import { ITEMS } from './content/items.js';
import { CUPS, getCup, trophyAtLeast } from './content/cups.js';
import { GrandPrixSession } from './grandprix.js';
import { TimeTrialSession, RecordsStore } from './timetrial.js';
import { GhostPlayer } from './ghost.js';
import { DIFFICULTY_TIERS, getDifficulty } from './aiDifficulty.js';
import { applyEvent, getProgress, isUnlocked } from './progression.js';
import { recordStats, checkAchievements, trackPlayed } from './achievements.js';
import { LocalLeaderboard } from './leaderboard.js';
import { LocalProvider } from './online.js';
import { buildLoadout } from './content/loadout.js';
import { rosterFor } from './content/roster.js';
import { drawPreviewInto, trackPreviewStats } from './trackPreview.js';
import { CHARACTERS } from './content/characters.js';
import { CHASSIS } from './content/chassis.js';
import { WHEELS } from './content/wheels.js';
import { PAINTS } from './content/cosmetics.js';
import { OnlineClient } from './onlineMultiplayer.js';
import { RemotePlayerSync } from './remotePlayers.js';
import { GAMEPLAY_ASPECT, fitAspectViewport, detectMobileDevice } from './mobile.js';

const FIXED_DT = 1 / 60;
// Neutral controls, published while an online race is paused locally.
const IDLE_INPUT = Object.freeze({ throttle: 0, brake: 0, steer: 0, drift: false, trick: false, item: false });

// Developer tools (FPS overlay + verbose logging) stay OFF unless ?debug=1
// is present in the URL - release builds never show them.
const DEBUG = typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has('debug');

class Game {
  constructor() {
    this.save = new SaveManager();
    this.i18n = new LocalizationManager(this.save);
    this.input = new InputManager(this.save);
    this.isMobileDevice = detectMobileDevice(window, navigator);
    this.audio = new AudioManager(this.save);
    this.music = new MusicManager(this.save);
    this.records = new RecordsStore(this.save);
    this.leaderboard = new LocalLeaderboard(this.save);
    this.provider = new LocalProvider(this.leaderboard);
    this.appState = 'menu';          // menu | race
    this.settingsReturn = 'screen-main';

    // mode state -------------------------------------------------------------
    this.mode = 'quick';             // quick | grandprix | timetrial | battle | online
    this.gpSession = null;
    this.ttSession = null;
    this.ghostPlayer = null;
    this.ghostVis = null;
    this._lastRaceState = 'idle';
    this._celebrate = null;          // staged finish-confetti schedule
    this._revealTimers = [];         // pending results-reveal audio cues
    this.battle = null;
    this._battleInput = { throttle: 0, brake: 0, steer: 0, drift: false, trick: false, item: false };

    // online multiplayer ------------------------------------------------------
    this.onlineClient = null;
    this.onlineLobby = null;
    this.onlinePlayerId = null;
    this.onlineRemoteKarts = new Map();
    this.remoteSync = null;          // RemotePlayerSync (peer karts + interpolation)
    this._onlineRosterSig = null;
    this.onlineRaceState = 'idle';
    this.onlineCountdown = 0;
    this.onlineRaceTime = 0;
    this._onlineLastSnapshot = null;
    this._onlinePing = 0;
    this._onlineChatHistory = [];
    this._onlineLastCount = null;
    this._onlineFinishedShown = false;

    // renderer ---------------------------------------------------------------
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const devicePixelRatio = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.isMobileDevice ? 1.5 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.camera.fovBase, GAMEPLAY_ASPECT, 0.1, 1600);

    // shared render resources (survive track switches) ---------------------------
    this.dust = new ParticlePool(this.scene, CONFIG.particles.dustCount, false);
    this.sparks = new ParticlePool(this.scene, CONFIG.particles.sparkCount, true);
    this.hud = new HUDManager(this.i18n);
    // Controller support for every menu screen (D-pad/stick + A/B).
    this.uiNav = new GamepadUINavigator({ input: this.input, audio: this.audio });

    // accessibility settings reapplied over everything below
    this._applyA11y();
    this.i18n.onChange(() => {
      document.documentElement.lang = this.i18n.lang;
      this._refreshFullscreenUI?.();
      this._syncMobileUI?.();
    });
    document.documentElement.lang = this.i18n.lang;

    this.trackId = this.save.get('lastTrack', 'sunforge_circuit');
    this._loadTrack(this.trackId, true);

    this.bindUI();
    this._bindTouchControls();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => this.onResize());
    window.visualViewport?.addEventListener?.('resize', () => this.onResize());
    window.matchMedia?.('(pointer: coarse)')?.addEventListener?.('change', () => this.onResize());
    document.addEventListener('fullscreenchange', () => {
      this._refreshFullscreenUI();
      this.onResize();
    });
    document.addEventListener('webkitfullscreenchange', () => {
      this._refreshFullscreenUI();
      this.onResize();
    });
    this.onResize();
    this._syncMobileUI();

    // Browser autoplay policy: unlock audio on the first real interaction,
    // whichever device it comes from (button clicks already do this too).
    const unlockAudio = () => {
      this.audio.init(); this.audio.resume();
      this.music.init(); this.music.resume();
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    // A mouse/touch click hands control back from the gamepad cursor.
    window.addEventListener('pointerdown', () => this.uiNav.suppress());

    // adaptive resolution: keep 60 fps on weaker GPUs by stepping the render
    // pixel ratio down (and back up when the headroom returns)
    const maxPixelRatio = Math.min(window.devicePixelRatio || 1, this.isMobileDevice ? 1.5 : 2);
    const pixelRatioCandidates = [...(this.isMobileDevice ? [0.75, 1, 1.25] : [1, 1.25, 1.5]), maxPixelRatio];
    this._prLevels = pixelRatioCandidates
      .filter((v, i, arr) => v > 0 && v <= maxPixelRatio && arr.indexOf(v) === i)
      .sort((a, b) => a - b);
    if (!this._prLevels.length) this._prLevels = [maxPixelRatio];
    this._prIndex = this._prLevels.length - 1;
    this._prAcc = 0; this._prN = 0;

    // developer FPS overlay (?debug=1 only)
    this._fpsEl = null;
    if (DEBUG) {
      this._fpsEl = document.createElement('div');
      this._fpsEl.id = 'fps-overlay';
      document.body.appendChild(this._fpsEl);
    }
    this._fpsAcc = 0; this._fpsN = 0;

    this.clock = new THREE.Clock();
    this.accumulator = 0;
    this.time = 0;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------- accessibility setup
  _applyA11y() {
    const uiScale = this.save.get('uiScale', 100);
    document.body.dataset.uiscale = String(uiScale);
    const reduceFx = this.save.get('reducedFx', false);
    const colorblind = this.save.get('colorblind', false);
    document.body.classList.toggle('cb', colorblind);
    document.body.classList.toggle('reduce-fx', reduceFx);
    this.fxDensity = reduceFx ? 0.35 : 1;
    this.dust.setDensity(this.fxDensity);
    this.sparks.setDensity(this.fxDensity);
    if (this.camCtl) {
      this.camCtl.shakeScale = reduceFx ? 0.12 : 1;
      this.camCtl.fovScale = reduceFx ? 0.3 : 1;
    }
    this.driftPalette = driftColors(colorblind);
    this.hud.setMinimapEnabled(this.save.get('minimap', true));
    this.hud.showMinimap(this.appState === 'race');
  }

  // --------------------------------------------------------------- world load
  // (Re)builds track + environment + items + karts for a track definition id.
  // The vehicle physics, drift, camera and race systems are reused untouched;
  // only world content swaps. `solo` registers only the player (time trials);
  // `rivals` (0..maxPlayers-1) trims the AI grid for custom quick races.
  _loadTrack(trackId, first = false, { solo = false, rivals = CONFIG.race.maxPlayers - 1 } = {}) {
    const def = TRACK_DEFS.find((d) => d.id === trackId) || getArena(trackId);
    this.trackId = def.id;
    if (TRACK_DEFS.some((d) => d.id === def.id)) this.save.set('lastTrack', def.id);

    // dispose previous world (environment group + kart meshes) so a long
    // session of track-hopping does not leak GPU buffers
    if (this.env) {
      this.env.dispose?.();
      this.scene.remove(this.env.group);
      disposeTree(this.env.group);
    }
    if (this.kartVisuals) {
      for (const vis of this.kartVisuals.values()) {
        this.scene.remove(vis.group);
        this.scene.remove(vis.shadow);
        disposeTree(vis.group);
        disposeTree(vis.shadow);
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
    this.camCtl.shakeScale = this.save.get('reducedFx', false) ? 0.12 : 1;
    this.camCtl.fovScale = this.save.get('reducedFx', false) ? 0.3 : 1;

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
    // The player drives the loadout configured in the garage (colors, stats
    // and drift tuning); AI rivals use their fixed personalities.
    this.loadout = buildLoadout(this.save.get('loadout', {}));
    this.kartVisuals = new Map();
    const maxRivals = CONFIG.race.maxPlayers - 1;
    const roster = rosterFor(CONFIG.race.maxPlayers)
      .slice(0, solo ? 0 : Math.max(0, Math.min(maxRivals, rivals)));
    roster.push({
      nameKey: 'ai.you',
      color: this.loadout.visual.bodyColor,
      accent: this.loadout.visual.accentColor,
      pilot: this.loadout.visual.pilotColor,
      ai: null,
      params: this.loadout.params,
      driftMods: this.loadout.driftMods,
    });

    this.race = new RaceManager({
      track: this.track, hud: this.hud, audio: this.audio, i18n: this.i18n,
      items: this.items,
      onEvent: (type, payload) => this.onRaceEvent(type, payload),
    });
    for (const d of roster) {
      const vehicle = new VehicleController(this.track, d.ai === null, d.params ?? null, d.driftMods ?? null);
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
        minimapColor: d.color,      // blip colour matches the kart's paint
      };
      if (kart.ai) kart.ai.setDifficulty(this.save.get('difficulty', 'normal'));
      this.race.registerKart(kart);
    }
    this.playerKart = this.race.karts.find((k) => k.isPlayer);

    // place karts on the grid for the menu backdrop
    this._placeOnGrid();

    // bake the minimap overview for this world
    this.hud.setMinimapTrack(this.track);

    trackPlayed(this.save, def.id);
    // Tracks shipping a hand-arranged soundtrack (def.music) opt into the
    // rich engine; every other track keeps the seeded generator.
    this.music.setTheme(def.musicSeed, def.theme, def.music || null);
  }

  // AI takes the front slots; the player always starts from the back slot
  // of the grid actually in use (so a trimmed rival count still lines up).
  _placeOnGrid() {
    const n = this.race.karts.length;
    const grid = this.track.startGrid(n);
    const ais = this.race.karts.filter((k) => !k.isPlayer);
    ais.forEach((k, i) => k.vehicle.place(grid[i]));
    this.playerKart.vehicle.place(grid[n - 1]);
  }

  _removeGhostVis() {
    if (this.ghostVis) {
      this.scene.remove(this.ghostVis.group);
      this.scene.remove(this.ghostVis.shadow);
      disposeTree(this.ghostVis.group);
      disposeTree(this.ghostVis.shadow);
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
    click('btn-fullscreen', () => this._toggleFullscreen());
    $('touch-fullscreen').addEventListener('click', () => this._toggleFullscreen());
    click('btn-settings-back', () => this.hud.showScreen(this.settingsReturn));
    click('btn-resume', () => this.setPaused(false));
    // Settings stay reachable mid-race: the pause menu opens the same screen
    // as the main menu, and Back returns to the pause menu (still paused).
    click('btn-pause-settings', () => this.openSettingsFromPause());
    click('btn-pause-restart', () => { this.setPaused(false); this.restartCurrentRace(); });
    click('btn-pause-menu', () => this.returnToMenu());
    click('btn-results-restart', () => this.onResultsPrimary());
    click('btn-results-menu', () => this.returnToMenu());

    // mode select
    click('btn-mode-quick', () => this.openTrackSelect('quick'));
    click('btn-mode-gp', () => this.openCupSelect());
    click('btn-mode-tt', () => this.openTrackSelect('timetrial'));
    click('btn-mode-battle', () => this.openBattleSelect());
    click('btn-mode-online', () => this.openOnlineBrowser());
    click('btn-mode-back', () => this.hud.showScreen('screen-main'));
    click('btn-tracksel-back', () => this.openModeSelect());
    click('btn-cupsel-back', () => this.openModeSelect());
    click('btn-battlesel-back', () => this.openModeSelect());

    // online browser
    click('btn-online-back', () => {
      this._onlineDisconnectIfNeeded();
      this.hud.showScreen('screen-mode');
    });
    click('btn-online-create', () => this._onlineCreateLobby());
    click('btn-online-refresh', () => this._onlineRefreshLobbies());
    click('btn-online-join-id', () => this._onlineJoinById());
    click('btn-online-leave', () => this._onlineLeaveLobby());
    click('btn-online-ready', () => this._onlineToggleReady());
    click('btn-online-start', () => this._onlineStartRace());
    click('btn-online-chat-send', () => this._onlineSendChat());
    $('online-chat-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._onlineSendChat();
    });
    $('online-name')?.addEventListener('change', (e) => {
      this.save.set('onlineName', e.target.value.slice(0,24));
    });
    $('online-create-name')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._onlineCreateLobby();
    });
    $('online-join-id')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._onlineJoinById();
    });
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
    $('engine-volume').value = this.save.get('engineVolume', ENGINE_VOLUME_DEFAULT);
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
    $('engine-volume').addEventListener('input', (e) => {
      this.audio.init();
      this.audio.setEngineVolume(parseFloat(e.target.value));
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
      Array.from({ length: CONFIG.race.maxPlayers }, (_, n) => ({ value: n, label: String(n) })),
      () => this._quickRivals(),
      (v) => this.save.set('quickRivals', v));

    // garage
    click('btn-garage', () => this.openGarage());
    click('btn-garage-back', () => { this.hud.showScreen('screen-main'); });

    // accessibility toggles -------------------------------------------------
    const syncToggle = (key, onId, offId, onChange, dflt = false) => {
      const sync = () => {
        const on = this.save.get(key, dflt);
        $(onId).classList.toggle('selected', on);
        $(offId).classList.toggle('selected', !on);
      };
      $(onId).addEventListener('click', () => { this.audio.init(); this.audio.click(); this.save.set(key, true); sync(); onChange(); });
      $(offId).addEventListener('click', () => { this.audio.init(); this.audio.click(); this.save.set(key, false); sync(); onChange(); });
      sync();
    };
    syncToggle('reducedFx', 'reducefx-on', 'reducefx-off', () => this._applyA11y());
    syncToggle('colorblind', 'colorblind-on', 'colorblind-off', () => this._applyA11y());
    // minimap defaults ON: it is a navigation aid, not an effect
    syncToggle('minimap', 'minimap-on', 'minimap-off', () => this._applyA11y(), true);

    this._buildOptionGroup('uiscale-list',
      [{ value: 100, labelKey: 'settings.size.normal' },
       { value: 115, labelKey: 'settings.size.large' },
       { value: 130, labelKey: 'settings.size.xlarge' }],
      () => this.save.get('uiScale', 100),
      (v) => { this.save.set('uiScale', v); this._applyA11y(); });

    this._buildOptionGroup('control-mode-list',
      [{ value: 'auto', labelKey: 'settings.control.auto' },
       { value: 'touch', labelKey: 'settings.control.touch' },
       { value: 'gamepad', labelKey: 'settings.control.gamepad' }],
      () => this.save.get('controlMode', 'auto'),
      (v) => { this.save.set('controlMode', v); this._syncMobileUI(); });
    this._buildOptionGroup('touch-layout-list',
      [{ value: 'joystick', labelKey: 'settings.layout.joystick' },
       { value: 'buttons', labelKey: 'settings.layout.buttons' }],
      () => this.save.get('touchLayout', 'joystick'),
      (v) => { this.save.set('touchLayout', v); this._syncMobileUI(); });

    // key remapping
    this._renderKeysList();
    $('btn-keys-reset').addEventListener('click', () => {
      this.audio.init(); this.audio.click();
      this.input.resetBindings();
      $('keys-status').textContent = '';
      this._renderKeysList();
    });

    this._refreshMenuMeta();
  }

  // The pilot/kart summary shown on the main menu reflects the garage loadout.
  _refreshMenuMeta() {
    const lo = buildLoadout(this.save.get('loadout', {}));
    const pilot = document.getElementById('menu-pilot');
    const kart = document.getElementById('menu-kart');
    if (pilot) pilot.textContent = this.i18n.t('menu.pilotOf', {
      name: `${this.i18n.t(lo.character.nameKey)} ${this.i18n.t(lo.character.speciesKey)}`,
    });
    if (kart) kart.textContent = this.i18n.t('menu.kartOf', { name: this.i18n.t(lo.chassis.nameKey) });
  }

  // ---------------------------------------------------------------- keys map
  _renderKeysList() {
    const list = document.getElementById('keys-list');
    if (!list) return;
    list.innerHTML = '';
    const bindings = this.input.bindings();
    for (const action of REMAPPABLE_ACTIONS) {
      const row = document.createElement('div');
      row.className = 'keys-row';
      const label = document.createElement('span');
      label.textContent = this.i18n.t('keys.action.' + action);
      const btn = document.createElement('button');
      btn.className = 'btn btn-small';
      btn.textContent = keyLabel(bindings[action]);
      btn.addEventListener('click', () => {
        this.audio.init(); this.audio.click();
        btn.classList.add('selected');
        document.getElementById('keys-status').textContent = this.i18n.t('keys.press');
        this.input.captureNextKey((code) => {
          document.getElementById('keys-status').textContent = '';
          if (code) {
            // a code may only drive one action: steal it from the old owner
            for (const other of REMAPPABLE_ACTIONS) {
              if (other !== action && this.input.bindings()[other] === code &&
                  this.input._custom[other]) {
                this.input.setBinding(other, null);
              }
            }
            this.input.setBinding(action, code);
          }
          this._renderKeysList();
        });
      });
      row.append(label, btn);
      list.appendChild(row);
    }
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

  // Saved rival count, clamped to the current lobby capacity. Defaults to a
  // full grid so existing saves (written when the cap was 4) still fill the
  // new 8-kart lobby rather than silently racing three rivals forever.
  _quickRivals() {
    const max = CONFIG.race.maxPlayers - 1;
    const saved = this.save.get('quickRivals', null);
    if (saved === null || saved === undefined) return max;
    return Math.max(0, Math.min(max, saved));
  }

  openSettings() { this.hud.showScreen('screen-settings'); }

  // Pause -> Settings. The race stays paused; Back returns to the pause menu
  // rather than to the main menu, so nothing about the session is lost.
  openSettingsFromPause() {
    this.settingsReturn = 'screen-pause';
    this.openSettings();
  }

  // ESC (keyboard) / START (pad) while a race or battle is running.
  // Pausing is a stack: Race -> Pause -> Settings, and each press of the pause
  // key pops one level instead of dumping the player back into traffic from
  // inside the settings screen.
  _handlePauseToggle() {
    if (this.appState !== 'race') return;
    const vis = this._visibleScreenId();
    if (this.race.paused) {
      if (vis && vis !== 'screen-pause') {
        this.audio.click();
        this.hud.showScreen('screen-pause');
        return;
      }
      this.setPaused(false);
      return;
    }
    if (vis) return;                       // a screen is already on top
    const busy = this.mode === 'battle'
      ? (!!this.battle && this.battle.state !== 'over' && !this._battleResultsShown)
      : (this.race.state !== 'idle' && this.race.state !== 'results');
    if (busy) this.setPaused(true);
  }

  // Id of the screen currently on top (or '' while racing).
  _visibleScreenId() {
    for (const s of document.querySelectorAll('.screen')) {
      if (!s.classList.contains('hidden')) return s.id;
    }
    return '';
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
    const visible = (id) => {
      const el = document.getElementById(id);
      return el && !el.classList.contains('hidden');
    };
    if (visible('screen-trackselect')) this._renderTrackList();
    if (visible('screen-cupselect')) this._renderCupList();
    if (visible('screen-battleselect')) this._renderBattleLists();
    if (visible('screen-garage')) this._renderGarage();
    if (visible('screen-online')) this._populateOnlineTrackSelects();
    if (visible('screen-onlinelobby')) this._populateOnlineTrackSelects();
    this._renderKeysList();
    this._refreshMenuMeta();
  }

  // --------------------------------------------------------------- garage UI
  openGarage() {
    this._renderGarage();
    this.hud.showScreen('screen-garage');
  }

  _unlockHint(entry, level) {
    const u = entry.unlock;
    if (!u) return this.i18n.t('garage.locked');
    if (u.type === 'level') return this.i18n.t('garage.lockedLevel', { level: u.level });
    if (u.noteKey) return this.i18n.t(u.noteKey);
    return this.i18n.t('garage.locked');
  }

  _renderGarage() {
    const level = getProgress(this.save).level;
    const spec = { ...(this.save.get('loadout', {}) || {}) };
    const lo = buildLoadout(spec);

    const renderGrid = (containerId, entries, currentId, key, opts = {}) => {
      const box = document.getElementById(containerId);
      if (!box) return;
      box.innerHTML = '';
      for (const entry of entries) {
        const unlocked = isUnlocked(entry, level, this.save);
        const btn = document.createElement('button');
        btn.className = 'btn list-row garage-cell' + (entry.id === currentId ? ' selected' : '') + (unlocked ? '' : ' locked');
        btn.disabled = !unlocked;
        if (opts.swatch) {
          const sw = document.createElement('span');
          sw.className = 'swatch';
          sw.style.background = `#${entry.color.toString(16).padStart(6, '0')}`;
          btn.appendChild(sw);
        }
        const name = document.createElement('span');
        name.className = 'garage-name';
        name.textContent = this.i18n.t(entry.nameKey);
        name.title = entry.personalityKey ? this.i18n.t(entry.personalityKey)
          : entry.descKey ? this.i18n.t(entry.descKey) : '';
        btn.appendChild(name);
        const meta = document.createElement('span');
        meta.className = 'list-meta';
        if (opts.swatch) meta.textContent = unlocked ? '' : this._unlockHint(entry, level);
        else meta.textContent = unlocked
          ? (entry.descKey ? this.i18n.t(entry.descKey) : (entry.personalityKey ? this.i18n.t(entry.personalityKey) : ''))
          : this._unlockHint(entry, level);
        btn.appendChild(meta);
        if (unlocked) {
          btn.addEventListener('click', () => {
            this.audio.click();
            spec[key] = entry.id;
            this.save.set('loadout', spec);
            this.loadout = buildLoadout(spec);
            this._refreshPlayerKart();
            this._renderGarage();
            this._refreshMenuMeta();
          });
        }
        box.appendChild(btn);
      }
    };

    renderGrid('garage-characters', CHARACTERS, lo.character.id, 'characterId');
    renderGrid('garage-chassis', CHASSIS, lo.chassis.id, 'chassisId');
    renderGrid('garage-wheels', WHEELS, lo.wheels.id, 'wheelId');
    renderGrid('garage-paints', PAINTS, lo.paint.id, 'paintId', { swatch: true });

    // effective-stat bars
    const statsBox = document.getElementById('garage-stats');
    statsBox.innerHTML = '';
    for (const key of ['acceleration', 'topSpeed', 'handling', 'weight', 'driftControl', 'offRoad']) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      const label = document.createElement('span');
      label.className = 'stat-label';
      label.textContent = this.i18n.t('stat.' + key);
      const bar = document.createElement('div');
      bar.className = 'stat-bar';
      const fill = document.createElement('div');
      fill.className = 'stat-fill';
      const v = Math.max(0, Math.min(10, lo.stats[key]));
      fill.style.width = `${(v / 10) * 100}%`;
      const val = document.createElement('span');
      val.className = 'stat-val';
      val.textContent = (Math.round(v * 10) / 10).toFixed(1);
      bar.appendChild(fill);
      row.append(label, bar, val);
      statsBox.appendChild(row);
    }
  }

  // Swap the player kart's visuals/params in place (menu backdrop + garage
  // preview) without rebuilding the whole world.
  _refreshPlayerKart() {
    const kart = this.playerKart;
    if (!kart || !this.loadout) return;
    const old = this.kartVisuals.get(kart.vehicle);
    if (old) {
      this.scene.remove(old.group);
      this.scene.remove(old.shadow);
      disposeTree(old.group);
      disposeTree(old.shadow);
    }
    const vis = buildKart(this.loadout.visual.bodyColor,
      this.loadout.visual.accentColor, this.loadout.visual.pilotColor);
    this.scene.add(vis.group);
    this.scene.add(vis.shadow);
    this.kartVisuals.set(kart.vehicle, vis);
    kart.charVis = vis.charVis || null;
    kart.vehicle.params = this.loadout.params;
    kart.vehicle.drift.mods = this.loadout.driftMods;
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
    const rows = [];
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

      // Preview before committing: hovering or focusing a row shows that
      // track's map, so the player can compare circuits without starting a
      // race. Clicking still starts it.
      const preview = () => {
        for (const r of rows) r.classList.toggle('active', r === btn);
        this._showTrackPreview(def);
      };
      btn.addEventListener('mouseenter', preview);
      btn.addEventListener('focus', preview);
      btn.addEventListener('click', () => {
        this.audio.click();
        this._startModeOnTrack(this._trackSelectMode, def.id);
      });
      rows.push(btn);
      list.appendChild(btn);
    }

    // open on the last track played (or the first) so the pane is never blank
    const lastId = this.save.get('lastTrack', null);
    const idx = Math.max(0, TRACK_DEFS.findIndex((d) => d.id === lastId));
    rows[idx]?.classList.add('active');
    this._showTrackPreview(TRACK_DEFS[idx]);
  }

  // Paint the preview pane for a track definition.
  _showTrackPreview(def) {
    if (!def) return;
    const canvas = document.getElementById('track-preview-canvas');
    const nameEl = document.getElementById('track-preview-name');
    const teachEl = document.getElementById('track-preview-teach');
    const statsEl = document.getElementById('track-preview-stats');
    if (canvas) drawPreviewInto(canvas, def);
    if (nameEl) nameEl.textContent = this.i18n.t(def.nameKey);
    if (teachEl) teachEl.textContent = this.i18n.t(def.teachKey);
    if (!statsEl) return;

    // A few at-a-glance facts pulled from the real definition.
    const stats = trackPreviewStats(def);
    const rec = this.records.get(def.id);
    const parts = [
      this.i18n.t('preview.length', { km: (stats.length / 1000).toFixed(2) }),
      this.i18n.t('preview.laps', { laps: stats.laps }),
      this.i18n.t('preview.difficulty', { stars: '★'.repeat(stats.difficulty) + '☆'.repeat(Math.max(0, 5 - stats.difficulty)) }),
    ];
    if (rec?.bestTotal) parts.push(this.i18n.t('preview.record', { time: formatTime(rec.bestTotal) }));
    statsEl.innerHTML = '';
    for (const text of parts) {
      const span = document.createElement('span');
      span.textContent = text;
      statsEl.appendChild(span);
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
    const rivals = mode === 'quick' ? this._quickRivals() : CONFIG.race.maxPlayers - 1;
    this._loadTrack(trackId, false, { solo: mode === 'timetrial', rivals });
    if (mode === 'timetrial') {
      const ghost = this.records.ghostFor(trackId);
      this.ghostPlayer = ghost
        ? new GhostPlayer(ghost.frames, FIXED_DT * ghost.step)
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
      const preview = () => this._showArenaPreview(a);
      btn.addEventListener('mouseenter', preview);
      btn.addEventListener('focus', preview);
      btn.addEventListener('click', () => {
        this.audio.click();
        this._battleArenaId = a.id;
        this._renderBattleLists();
      });
      arenaList.appendChild(btn);
    }
    this._showArenaPreview(ARENAS.find((a) => a.id === this._battleArenaId) || ARENAS[0]);
  }

  // Preview pane for the battle arena picker (same renderer as tracks).
  _showArenaPreview(def) {
    if (!def) return;
    const canvas = document.getElementById('arena-preview-canvas');
    const nameEl = document.getElementById('arena-preview-name');
    const teachEl = document.getElementById('arena-preview-teach');
    if (canvas) drawPreviewInto(canvas, def);
    if (nameEl) nameEl.textContent = this.i18n.t(def.nameKey);
    if (teachEl) teachEl.textContent = this.i18n.t(def.teachKey);
  }

  _startBattle() {
    this.mode = 'battle';
    this._loadTrack(this._battleArenaId, false, { rivals: CONFIG.race.maxPlayers - 1 });
    this.startBattle();
  }

  // ------------------------------------------------------------------ online
  _ensureOnlineClient() {
    if (this.onlineClient) return this.onlineClient;
    this.onlineClient = new OnlineClient({
      onEvent: (type, payload) => this._onOnlineEvent(type, payload),
      onSnapshot: (snap) => this._onOnlineSnapshot(snap),
      onLobbyUpdate: (lobby) => this._onOnlineLobbyUpdate(lobby),
      onChat: (msg) => this._onOnlineChat(msg),
      onError: (err) => {
        console.warn('[online]', err);
        const el = document.getElementById('online-status-text');
        if (el) el.textContent = err;
        this.hud.notify(err);
      },
    });
    return this.onlineClient;
  }

  openOnlineBrowser() {
    this.mode = 'online';
    const nameInput = document.getElementById('online-name');
    if (nameInput) {
      const saved = this.save.get('onlineName', '') || this.save.get('playerName', '') || `Racer${Math.floor(Math.random()*999)}`;
      nameInput.value = saved;
      this.save.set('onlineName', saved);
    }
    this._populateOnlineTrackSelects();
    this.hud.showScreen('screen-online');
    this._onlineConnectAndRefresh();
  }

  _populateOnlineTrackSelects() {
    const selIds = ['online-create-track', 'online-lobby-track-select'];
    for (const id of selIds) {
      const sel = document.getElementById(id);
      if (!sel) continue;
      const cur = sel.value;
      sel.innerHTML = '';
      for (const def of TRACK_DEFS) {
        const opt = document.createElement('option');
        opt.value = def.id;
        opt.textContent = this.i18n.t(def.nameKey);
        sel.appendChild(opt);
      }
      for (const a of ARENAS) {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = `${this.i18n.t(a.nameKey)} [Battle]`;
        sel.appendChild(opt);
      }
      if (cur) sel.value = cur;
      else if (id === 'online-create-track') sel.value = this.save.get('lastTrack', 'sunforge_circuit');
    }
  }

  async _onlineConnectAndRefresh() {
    const client = this._ensureOnlineClient();
    const statusEl = document.getElementById('online-status-text');
    const pingEl = document.getElementById('online-ping');
    if (statusEl) statusEl.textContent = this.i18n.t('online.connecting');
    try {
      await client.connect();
      if (statusEl) statusEl.textContent = this.i18n.t('online.connected');
      const t0 = performance.now();
      const res = await fetch('/api/health').then(r=>r.json()).catch(()=>null);
      if (res && pingEl) {
        const ms = Math.round(performance.now() - t0);
        this._onlinePing = ms;
        pingEl.textContent = this.i18n.t('online.ping', { ms });
      }
      this._onlineRefreshLobbies();
    } catch (e) {
      if (statusEl) statusEl.textContent = this.i18n.t('online.disconnected');
      this._onlineRefreshLobbiesHttp();
    }
  }

  async _onlineRefreshLobbies() {
    const client = this._ensureOnlineClient();
    try {
      await client.listLobbies();
      this._onlineRefreshLobbiesHttp();
    } catch {
      this._onlineRefreshLobbiesHttp();
    }
  }

  async _onlineRefreshLobbiesHttp() {
    try {
      const res = await fetch('/api/lobbies');
      const data = await res.json();
      this._renderOnlineLobbyList(data.lobbies || []);
    } catch {}
  }

  _renderOnlineLobbyList(lobbies) {
    const list = document.getElementById('online-lobby-list');
    const count = document.getElementById('online-lobby-count');
    if (!list) return;
    list.innerHTML = '';
    if (count) count.textContent = `${lobbies.length} ${lobbies.length===1?'lobby':'lobbies'}`;
    if (!lobbies.length) {
      const empty = document.createElement('div');
      empty.className = 'online-status';
      empty.textContent = this.i18n.t('online.noLobbies');
      list.appendChild(empty);
      return;
    }
    for (const lobby of lobbies) {
      const row = document.createElement('button');
      row.className = 'btn online-lobby-row';
      const left = document.createElement('div');
      left.className = 'lobby-left';
      const name = document.createElement('div');
      name.className = 'lobby-name';
      name.textContent = lobby.name;
      const meta = document.createElement('div');
      meta.className = 'lobby-meta';
      const trackDef = TRACK_DEFS.find(d=>d.id===lobby.trackId);
      const arenaDef = ARENAS.find(a=>a.id===lobby.trackId);
      const trackName = trackDef ? this.i18n.t(trackDef.nameKey) : (arenaDef ? this.i18n.t(arenaDef.nameKey) : lobby.trackId);
      const stateKey = lobby.state==='lobby'?'inLobby': lobby.state==='countdown'?'countdownState': lobby.state==='racing'?'racing':'finished';
      meta.textContent = `${trackName} · ${lobby.playerCount}/${lobby.maxPlayers} · ${this.i18n.t('online.'+stateKey)}`;
      left.append(name, meta);
      const right = document.createElement('div');
      right.className = 'lobby-right';
      right.textContent = lobby.id;
      row.append(left, right);
      row.addEventListener('click', () => {
        this.audio.click();
        this._onlineJoinLobby(lobby.id);
      });
      list.appendChild(row);
    }
  }

  _onlineGetPlayerName() {
    const input = document.getElementById('online-name');
    const name = (input?.value || this.save.get('onlineName','') || 'Player').trim().slice(0,24) || 'Player';
    this.save.set('onlineName', name);
    return name;
  }

  async _onlineCreateLobby() {
    const nameInput = document.getElementById('online-create-name');
    const trackSel = document.getElementById('online-create-track');
    const maxSel = document.getElementById('online-create-max');
    const lobbyName = (nameInput?.value || `${this._onlineGetPlayerName()}'s Race`).trim().slice(0,48) || 'Race';
    const trackId = trackSel?.value || 'sunforge_circuit';
    const maxPlayers = parseInt(maxSel?.value || '8', 10);
    const playerName = this._onlineGetPlayerName();
    const loadout = buildLoadout(this.save.get('loadout', {}));
    const color = loadout.visual.bodyColor || Math.floor(Math.random()*0xffffff);
    const client = this._ensureOnlineClient();
    const statusEl = document.getElementById('online-status-text');
    if (statusEl) statusEl.textContent = this.i18n.t('online.connecting');
    try {
      const lobby = await client.createLobby({ name: lobbyName, trackId, maxPlayers, playerName, color });
      this.onlineLobby = lobby;
      this.onlinePlayerId = client.playerId;
      this.hud.showScreen('screen-onlinelobby');
      this._renderOnlineLobby(lobby);
      if (statusEl) statusEl.textContent = this.i18n.t('online.connected');
    } catch (e) {
      if (statusEl) statusEl.textContent = e.message;
      this.hud.notify(e.message);
    }
  }

  async _onlineJoinLobby(lobbyId) {
    const playerName = this._onlineGetPlayerName();
    const loadout = buildLoadout(this.save.get('loadout', {}));
    const color = loadout.visual.bodyColor || Math.floor(Math.random()*0xffffff);
    const client = this._ensureOnlineClient();
    try {
      const lobby = await client.joinLobby(lobbyId, playerName, color);
      this.onlineLobby = lobby;
      this.onlinePlayerId = client.playerId;
      this.hud.showScreen('screen-onlinelobby');
      this._renderOnlineLobby(lobby);
    } catch (e) {
      this.hud.notify(e.message);
      const statusEl = document.getElementById('online-status-text');
      if (statusEl) statusEl.textContent = e.message;
    }
  }

  _onlineJoinById() {
    const input = document.getElementById('online-join-id');
    const id = (input?.value || '').trim();
    if (!id) return;
    this._onlineJoinLobby(id);
  }

  _onlineLeaveLobby() {
    const client = this.onlineClient;
    if (client) client.leaveLobby();
    client?.resetInterpolation();
    this.onlineLobby = null;
    this.onlinePlayerId = null;
    this._onlineClearRemotes();
    this.hud.showScreen('screen-online');
    this._onlineRefreshLobbies();
  }

  _onlineDisconnectIfNeeded() {
    if (!this.onlineLobby) {
      this.onlineClient?.disconnect();
      this.onlineClient = null;
    }
  }

  _onlineToggleReady() {
    const client = this.onlineClient;
    if (!client || !this.onlineLobby) return;
    const me = this.onlineLobby.players.find(p=>p.id===this.onlinePlayerId);
    const newReady = me ? !me.ready : true;
    client.setReady(newReady);
  }

  _onlineStartRace() {
    const client = this.onlineClient;
    if (!client) return;
    client.startRace();
  }

  _onlineSendChat() {
    const input = document.getElementById('online-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    this.onlineClient?.sendChat(text);
    input.value = '';
  }

  _renderOnlineLobby(lobby) {
    if (!lobby) return;
    this.onlineLobby = lobby;
    const nameEl = document.getElementById('online-lobby-name');
    const idEl = document.getElementById('online-lobby-id');
    const trackEl = document.getElementById('online-lobby-track');
    const countEl = document.getElementById('online-lobby-count2');
    const playerList = document.getElementById('online-player-list');
    const trackSel = document.getElementById('online-lobby-track-select');
    const statusEl = document.getElementById('online-lobby-status');
    const readyBtn = document.getElementById('btn-online-ready');
    const startBtn = document.getElementById('btn-online-start');

    if (nameEl) nameEl.textContent = lobby.name;
    if (idEl) idEl.textContent = `ID: ${lobby.id}`;
    const trackDef = TRACK_DEFS.find(d=>d.id===lobby.trackId) || ARENAS.find(a=>a.id===lobby.trackId);
    const trackName = trackDef ? this.i18n.t(trackDef.nameKey) : lobby.trackId;
    if (trackEl) trackEl.textContent = trackName;
    if (countEl) countEl.textContent = `${lobby.playerCount||lobby.players.length}/${lobby.maxPlayers}`;
    if (trackSel) {
      trackSel.value = lobby.trackId;
      const me = lobby.players.find(p=>p.id===this.onlinePlayerId);
      trackSel.disabled = !me?.isHost;
      trackSel.onchange = () => {
        if (me?.isHost) this.onlineClient?.updateTrack(trackSel.value);
      };
    }

    if (playerList) {
      playerList.innerHTML = '';
      for (const p of lobby.players) {
        const row = document.createElement('div');
        row.className = 'online-player-row' + (p.id===this.onlinePlayerId ? ' you' : '');
        const col = document.createElement('span');
        col.className = 'player-color';
        col.style.background = `#${(p.color||0).toString(16).padStart(6,'0')}`;
        const name = document.createElement('span');
        name.className = 'player-name';
        name.textContent = p.name + (p.id===this.onlinePlayerId ? ` (${this.i18n.t('online.you')})` : '');
        const stat = document.createElement('span');
        stat.className = 'player-status';
        if (p.isHost) { stat.classList.add('host'); stat.textContent = this.i18n.t('online.host'); }
        else if (p.ready) { stat.classList.add('ready'); stat.textContent = this.i18n.t('online.ready'); }
        else { stat.textContent = this.i18n.t('online.notReady'); }
        if (!p.connected) stat.textContent += ' (dc)';
        row.append(col, name, stat);
        playerList.appendChild(row);
      }
    }

    if (readyBtn && startBtn && statusEl) {
      const me = lobby.players.find(p=>p.id===this.onlinePlayerId);
      if (me?.isHost) {
        readyBtn.classList.add('hidden');
        startBtn.classList.remove('hidden');
        startBtn.disabled = lobby.players.length < 1;
        statusEl.textContent = lobby.players.every(pl=>pl.ready || pl.isHost) ? 'All ready!' : 'Waiting for players to ready…';
      } else {
        readyBtn.classList.remove('hidden');
        startBtn.classList.add('hidden');
        if (me) {
          readyBtn.textContent = me.ready ? this.i18n.t('online.notReady') : this.i18n.t('online.ready');
          readyBtn.classList.toggle('selected', !!me.ready);
        }
        statusEl.textContent = this.i18n.t('online.waiting');
      }
    }

    this._renderOnlineChat(lobby.messages || []);
  }

  _renderOnlineChat(messages) {
    const log = document.getElementById('online-chat-log');
    if (!log) return;
    log.innerHTML = '';
    for (const m of (messages||[]).slice(-50)) {
      const div = document.createElement('div');
      div.className = 'chat-msg';
      const name = document.createElement('span');
      name.className = 'chat-name';
      name.textContent = m.name + ': ';
      const text = document.createElement('span');
      text.className = 'chat-text';
      text.textContent = m.message;
      div.append(name, text);
      log.appendChild(div);
    }
    log.scrollTop = log.scrollHeight;
  }

  _onOnlineChat(msg) {
    const log = document.getElementById('online-chat-log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = 'chat-msg';
    const name = document.createElement('span');
    name.className = 'chat-name';
    name.textContent = msg.name + ': ';
    const text = document.createElement('span');
    text.className = 'chat-text';
    text.textContent = msg.message;
    div.append(name, text);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  _onOnlineLobbyUpdate(lobby) {
    this._renderOnlineLobby(lobby);
  }

  _onOnlineEvent(type, payload) {
    if (type === 'lobbyList') {
      this._renderOnlineLobbyList(payload.lobbies || []);
    } else if (type === 'countdown') {
      this.onlineRaceState = 'countdown';
      this.onlineCountdown = payload.value || payload.countdown || 3;
      this.onlineLobby = payload.lobby || this.onlineLobby;
      if (this.appState !== 'race') {
        const statusEl = document.getElementById('online-lobby-status');
        if (statusEl) statusEl.textContent = this.i18n.t('online.countdown', { n: Math.ceil(this.onlineCountdown) });
        this.hud.countdown(String(Math.ceil(this.onlineCountdown)));
        // Build the world during the server's readiness barrier, not after the
        // countdown has elapsed. Every client acknowledges only after its
        // track, grid and physics objects are ready.
        this._onlineBeginRace(payload.lobby || this.onlineLobby);
      }
    } else if (type === 'raceStart') {
      if (this.appState !== 'race' || this.mode !== 'online') {
        this._onlineBeginRace(payload.lobby || this.onlineLobby);
      } else {
        this.onlineRaceState = 'racing';
        this.race.state = 'racing';
        this.race.countdownT = 0;
      }
    } else if (type === 'raceFinished') {
      this._onOnlineRaceFinished(payload);
    } else if (type === 'playerJoined' || type === 'playerLeft' || type === 'playerDisconnected') {
      if (payload.lobby) this._renderOnlineLobby(payload.lobby);
      const log = document.getElementById('online-chat-log');
      if (log) {
        const div = document.createElement('div');
        div.className = 'chat-msg system';
        div.textContent = type === 'playerJoined' ? `${payload.player?.name} joined` : `${payload.playerId} left`;
        log.appendChild(div);
      }
    } else if (type === 'error') {
      this.hud.notify(payload.message);
    }
  }

  _onlineBeginRace(lobby) {
    if (!lobby) lobby = this.onlineLobby;
    if (!lobby) return;
    this.onlineLobby = lobby;
    this.mode = 'online';
    this.onlineRaceState = 'racing';
    const trackId = lobby.trackId;
    this._loadTrack(trackId, false, { rivals: Math.max(0, lobby.players.length - 1) });
    this._setupOnlineRaceKarts(lobby);
    this.startOnlineRace();
  }

  // Peer lifecycle is owned by RemotePlayerSync: it builds a kart when a
  // player appears in the authoritative roster, tears it down when they leave,
  // and drives every surviving peer from interpolated snapshots.
  _ensureRemoteSync() {
    if (this.remoteSync) {
      this.remoteSync.setTrack(this.track);
      this.remoteSync.setLocalId(this.onlinePlayerId);
      return this.remoteSync;
    }
    this.remoteSync = new RemotePlayerSync({
      track: this.track,
      localId: this.onlinePlayerId,
      createEntry: (p) => this._createRemoteKart(p),
      disposeEntry: (entry) => this._disposeRemoteKart(entry),
    });
    return this.remoteSync;
  }

  _createRemoteKart(p) {
    const veh = new VehicleController(this.track, false);
    const col = p.color || 0xffaa00;
    const vis = buildKart(col, 0xffffff, 0xcccccc);
    this.scene.add(vis.group);
    this.scene.add(vis.shadow);
    this.kartVisuals.set(veh, vis);
    const kart = {
      vehicle: veh,
      ai: null,
      nameKey: p.name,
      isPlayer: false,
      charVis: vis.charVis || null,
      minimapColor: col,
      playerId: p.id,
      playerName: p.name,
      remote: true,
    };
    this.race.registerKart(kart);
    // Peers start on their authoritative grid slot, so the world looks right
    // before their first pose packet arrives.
    const slot = this._onlineGridSlot(p);
    if (slot) veh.place(slot);
    const entry = { kart, vehicle: veh, visual: vis, lastPos: null };
    this.onlineRemoteKarts.set(p.id, entry);
    return entry;
  }

  _disposeRemoteKart(entry) {
    if (!entry) return;
    const { kart, vehicle, visual } = entry;
    if (visual) {
      this.scene.remove(visual.group);
      this.scene.remove(visual.shadow);
      disposeTree(visual.group);
      disposeTree(visual.shadow);
    }
    this.kartVisuals.delete(vehicle);
    this.race.kartState.delete(vehicle);
    const idx = this.race.karts.indexOf(kart);
    if (idx >= 0) this.race.karts.splice(idx, 1);
    this.onlineRemoteKarts.delete(kart?.playerId ?? entry.id);
  }

  // Start grid slot for a networked player. The server hands out the slot
  // index so every client agrees on who starts where.
  _onlineGridSlot(p, total = null) {
    const players = this.onlineLobby?.players || [];
    const count = total ?? Math.max(1, players.length || 1);
    const grid = this.track.startGrid(count);
    let idx = Number.isFinite(p?.slot) ? p.slot : players.findIndex(pl => pl.id === p?.id);
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    return grid[Math.min(grid.length - 1, idx)];
  }

  // Re-place every kart on its authoritative slot. RaceManager.start() places
  // karts by registration order, which differs per client (each client
  // registers itself first), so the grid has to be rebuilt from server slots.
  _placeOnlineGrid() {
    const players = this.onlineLobby?.players || [];
    if (!players.length) return;
    const grid = this.track.startGrid(players.length);
    players.forEach((p, i) => {
      const idx = Number.isFinite(p.slot) ? Math.min(grid.length - 1, Math.max(0, p.slot)) : i;
      const slot = grid[idx];
      if (!slot) return;
      const vehicle = p.id === this.onlinePlayerId
        ? this.playerKart?.vehicle
        : this.onlineRemoteKarts.get(p.id)?.vehicle;
      vehicle?.place(slot);
    });
    for (const entry of this.onlineRemoteKarts.values()) entry.hasPose = false;
    for (const entry of this.remoteSync?.values() || []) entry.hasPose = false;
  }

  _setupOnlineRaceKarts(lobby) {
    const players = lobby.players || [];
    const localId = this.onlinePlayerId;
    if (this.kartVisuals) {
      for (const vis of this.kartVisuals.values()) {
        this.scene.remove(vis.group);
        this.scene.remove(vis.shadow);
        disposeTree(vis.group);
        disposeTree(vis.shadow);
      }
    }
    this.kartVisuals = new Map();
    this.race.karts = [];
    this.race.kartState.clear();
    this.onlineRemoteKarts.clear();
    this.remoteSync = null;
    this.onlineClient?.resetInterpolation();

    const loadout = buildLoadout(this.save.get('loadout', {}));
    const localPlayerInfo = players.find(p=>p.id===localId);

    const localVehicle = new VehicleController(this.track, true, loadout.params, loadout.driftMods);
    const localVis = buildKart(loadout.visual.bodyColor, loadout.visual.accentColor, loadout.visual.pilotColor);
    this.scene.add(localVis.group);
    this.scene.add(localVis.shadow);
    this.kartVisuals.set(localVehicle, localVis);
    const localKart = {
      vehicle: localVehicle,
      ai: null,
      nameKey: 'ai.you',
      isPlayer: true,
      charVis: localVis.charVis || null,
      minimapColor: loadout.visual.bodyColor,
      playerId: localId,
      playerName: localPlayerInfo?.name || 'You',
    };
    this.race.registerKart(localKart);
    this.playerKart = localKart;

    this._ensureRemoteSync().syncRoster(players);
    this._placeOnlineGrid();
  }

  startOnlineRace() {
    this.appState = 'race';
    this.hud.hideScreens();
    this.hud.showHUD(true);
    this.audio.resume();
    this.music.resume();

    this.race.lapsOverride = this.onlineLobby?.laps || 3;
    this.race.itemsEnabled = false;
    this.race.restart();
    // restart() lines karts up by registration order; the server's slots are
    // the only ordering every client shares.
    this._placeOnlineGrid();
    this.hud.setItem(null);
    for (const m of this.itemVisuals.boxMeshes) m.visible = false;
    this.camCtl.snapTo(this.playerKart.vehicle);
    this.accumulator = 0;
    this._lastRaceState = 'countdown';
    this._celebrate = null;
    this._clearRevealTimers();
    this.hud.setCinematic(false);
    this.music.setState('countdown');
    this.onlineRaceState = 'countdown';
    this.onlineCountdown = this.onlineLobby?.countdown || 3.5;
    this.onlineRaceTime = 0;
    this._onlineLastSnapshot = null;
    this._onlineFinishedShown = false;
    this._onlineLastCount = null;
    this._onlineLocalFinishedSent = false;

    // This is deliberately last: once sent, the server may immediately begin
    // consuming the synchronized countdown and publishing racing snapshots.
    this.onlineClient?.raceReady();
  }

  _onOnlineSnapshot(snap) {
    this._onlineLastSnapshot = snap;
    this.onlineRaceState = snap.state;
    this.onlineRaceTime = snap.raceTime;
    this.onlineCountdown = snap.countdown;

    // The server owns the phase clock. Keep local input/physics gating on the
    // same phase instead of starting a second independent 3.5 second timer.
    if (this.appState === 'race') {
      if (snap.state === 'countdown') {
        this.race.state = 'countdown';
        this.race.countdownT = Math.max(0, Number(snap.countdown) || 0);
      } else if (snap.state === 'racing' && this.race.state === 'countdown') {
        this.race.state = 'racing';
        this.race.countdownT = 0;
      }
    }

    // The roster in a snapshot is authoritative: it is what tells this client
    // that somebody joined, left or dropped out - in the lobby as well as on
    // track.
    if (Array.isArray(snap.players)) this._onlineUpdateRoster(snap.players);

    if (this.appState !== 'race') {
      if (snap.lobby) this._renderOnlineLobby(snap.lobby);
      return;
    }

    // Poses are NOT applied here. A snapshot lands 20 times per second, so
    // writing straight into the karts would move them in visible jumps.
    // frame() samples the interpolated timeline every physics step instead;
    // only discrete race progress is copied across now.
    if (Array.isArray(snap.players)) {
      for (const p of snap.players) {
        if (p.id === this.onlinePlayerId) continue;
        const remote = this.onlineRemoteKarts.get(p.id);
        if (!remote) continue;
        remote.lastPos = p;
        const st = this.race.kartState.get(remote.vehicle);
        if (st) {
          st.lap = p.lap || 0;
          st.finished = !!p.finished;
          if (p.finished) st.finishTime = p.finishTime;
        }
      }
    }

    if (snap.state === 'countdown') {
      const ceil = Math.ceil(snap.countdown);
      if (ceil !== this._onlineLastCount && ceil >= 1) {
        this._onlineLastCount = ceil;
        this.hud.countdown(String(ceil));
        this.audio.countBeep(false);
      }
    } else if (snap.state === 'racing' && this._onlineLastCount !== -1) {
      if (this._onlineLastCount !== null && this._onlineLastCount !== undefined) {
        this.hud.countdown(this.i18n.t('race.go'), true);
        this.audio.countBeep(true);
        this.music.setState('racing');
      }
      this._onlineLastCount = -1;
    }
  }

  // ------------------------------------------------------- peer replication
  // Keep the local world in step with the authoritative roster: build karts
  // for players who appeared, drop karts for players who left, and refresh the
  // lobby panel when the roster actually changed.
  _onlineUpdateRoster(players) {
    if (!Array.isArray(players) || !players.length) return;
    if (this.onlineLobby) {
      // Merge the live roster into the cached lobby so slots, readiness and
      // connection state stay current between lobbyUpdate messages.
      const byId = new Map(players.map(p => [p.id, p]));
      this.onlineLobby.players = (this.onlineLobby.players || []).map(p => ({ ...p, ...(byId.get(p.id) || {}) }));
      for (const p of players) {
        if (!this.onlineLobby.players.some(existing => existing.id === p.id)) {
          this.onlineLobby.players.push({ ...p });
        }
      }
      this.onlineLobby.players = this.onlineLobby.players.filter(p => byId.has(p.id));
      this.onlineLobby.playerCount = this.onlineLobby.players.length;
    }

    const signature = players
      .map(p => `${p.id}:${p.ready ? 1 : 0}${p.isHost ? 'h' : ''}${p.connected ? 'c' : ''}`)
      .join('|');
    if (signature !== this._onlineRosterSig) {
      this._onlineRosterSig = signature;
      if (this.appState !== 'race' && this.onlineLobby) this._renderOnlineLobby(this.onlineLobby);
    }

    if (this.appState !== 'race' || this.mode !== 'online' || !this.remoteSync) return;
    // Peers that joined get a kart on their authoritative slot; peers that
    // left lose theirs (visuals, race registration and minimap blip).
    this.remoteSync.syncRoster(players);
  }

  // Advance every peer one fixed step along the interpolated server timeline.
  // Runs inside the same fixed-step loop as the local physics so the renderer
  // can blend peers between steps exactly like the local kart.
  _onlineStepRemotes(dt) {
    const client = this.onlineClient;
    if (!client || !this.remoteSync || this.remoteSync.size === 0) return;
    const view = client.sampleRemoteStates();
    if (!view || !Array.isArray(view.players)) return;
    this.remoteSync.step(dt, view.players);
  }

  // Publish the local kart: pose, movement state and race progress.
  _onlineSendLocalState(playerInput) {
    const client = this.onlineClient;
    if (!client || !this.playerKart) return;
    const v = this.playerKart.vehicle;
    const st = this.race.kartState.get(v);
    client.sendInput({
      input: playerInput,
      pos: { x: v.pos.x, y: v.y, z: v.pos.z, yaw: v.yaw, speed: v.fSpeed },
      motion: {
        steer: v.steer,
        throttle: playerInput?.throttle ?? 0,
        brake: playerInput?.brake ?? 0,
        drift: v.drift.drifting,
        driftLevel: v.drift.level,
        boost: v.boost.boosting,
        boostLevel: v.boost.active?.level ?? 0,
        airborne: !v.grounded,
      },
      lap: st?.lap || 0,
      checkpoint: st?.nextCp ? st.nextCp - 1 : -1,
      progress: v.surf ? v.surf.progress : 0,
      finished: st?.finished || false,
    });
    // if we finished locally, notify server
    if (st?.finished && !this._onlineLocalFinishedSent) {
      this._onlineLocalFinishedSent = true;
      client.sendFinish();
    }
  }

  _onOnlineRaceFinished(payload) {
    if (this._onlineFinishedShown) return;
    this._onlineFinishedShown = true;
    const standings = payload.standings || this.onlineLobby?.standings || [];
    const i18n = this.i18n;
    this.hud.showHUD(false);
    const headline = document.getElementById('results-headline');
    const winner = standings[0];
    headline.textContent = winner ? i18n.t('battle.win', { name: winner.name }) : i18n.t('battle.timeUp');

    const rowsEl = document.getElementById('results-rows');
    rowsEl.innerHTML = '';
    standings.forEach((row, idx) => {
      const div = document.createElement('div');
      div.className = 'result-row' + (row.id === this.onlinePlayerId ? ' you' : '');
      const pos = document.createElement('span');
      pos.className = 'result-pos';
      pos.textContent = row.finished ? i18n.t('ordinal.' + Math.min(8, idx+1)) : 'DNF';
      const name = document.createElement('span');
      name.className = 'result-name';
      name.textContent = row.name;
      const stat = document.createElement('span');
      stat.className = 'result-time';
      stat.textContent = row.finished && row.finishTime ? formatTime(row.finishTime) : (row.finished ? '' : i18n.t('online.racing'));
      div.append(pos, name, stat);
      this.hud.revealRow(div, idx);
      rowsEl.appendChild(div);
    });
    this.hud.revealHeadline(headline);
    document.getElementById('results-stats').textContent = `Track: ${payload.lobby?.trackId || this.onlineLobby?.trackId} · ${this.i18n.t('online.race')}`;
    const extra = document.getElementById('results-extra');
    extra.innerHTML = '';
    const btnRestart = document.getElementById('btn-results-restart');
    btnRestart.textContent = this.i18n.t('online.returnToLobby');
    const self = this;
    btnRestart.onclick = () => {
      self.audio.click();
      self._onlineReturnToLobby();
    };
    document.getElementById('btn-results-menu').onclick = () => {
      self.audio.click();
      self._onlineLeaveRaceToMenu();
    };

    this.hud.showScreen('screen-results');
    const playerWon = winner && winner.id === this.onlinePlayerId;
    this.hud.spawnConfetti(playerWon ? 44 : winner ? 22 : 0, Math.round((payload.lobby?.raceTime||0)*1000));
    this.music.setState(playerWon ? 'victory' : 'defeat');
  }

  _onlineReturnToLobby() {
    this.onlineClient?.returnToLobby();
    this.appState = 'menu';
    this.race.state = 'idle';
    this.hud.showHUD(false);
    this.hud.setItem(null);
    this.hud.showScreen('screen-onlinelobby');
    this.audio.stopEngine();
    this.music.setState('menu');
    this.items.reset();
    this._onlineFinishedShown = false;
    if (this.onlineLobby) this._renderOnlineLobby(this.onlineLobby);
  }

  _onlineLeaveRaceToMenu() {
    this.onlineClient?.leaveLobby();
    this.onlineClient?.resetInterpolation();
    this.onlineLobby = null;
    this.onlinePlayerId = null;
    this._onlineClearRemotes();
    this._onlineFinishedShown = false;
    this.returnToMenu();
  }

  // Drop every peer kart (visuals, race registration and interpolation state).
  _onlineClearRemotes() {
    if (this.remoteSync) this.remoteSync.clear();
    this.remoteSync = null;
    this.onlineRemoteKarts.clear();
    this._onlineRosterSig = null;
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

    // Battle mode never calls hud.updateRace(), so the minimap is driven
    // here instead. Eliminated karts drop off the map.
    const live = this.race.karts.filter((k) => !b.per.get(k)?.eliminated);
    this.hud.drawMinimap(live, this.playerKart, this.items);
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
      // Same geometry-accurate resolver the race uses: battles no longer hand
      // out hits from an invisible full-height circle around each obstacle.
      const y0 = v.y + KART_HIT_BOTTOM, y1 = v.y + KART_HIT_TOP;
      for (const c of cols) {
        if (resolveObstacleContact(c, v.pos.x, v.pos.z, y0, y1, 1.2)) {
          b.hitLanded(null, kart);
          v.vel.multiplyScalar(0.45);
          kart._hitCd = 1.2;
          this.camCtl.addTrauma(0.3);
          this.burstAt(v.pos, c.hit === 'flame' ? 0xff7a2a : 0xff8a5a, 10);
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
      pos.textContent = row.eliminated ? 'KO' : i18n.t('ordinal.' + Math.min(CONFIG.race.maxPlayers, idx + 1));
      const name = document.createElement('span');
      name.className = 'result-name';
      name.textContent = i18n.t(row.kart.nameKey);
      const stat = document.createElement('span');
      stat.className = 'result-time';
      if (b.mode.id === 'energy') stat.textContent = i18n.t('battle.cores', { cores: row.cores, goal: b.mode.goal });
      else if (b.mode.id === 'zones' || b.mode.id === 'score') stat.textContent = i18n.t('gp.points', { points: Math.floor(row.score) });
      else stat.textContent = row.eliminated ? '' : i18n.t('battle.hp') + ' ' + Math.ceil(row.hp);
      div.append(pos, name, stat);
      this.hud.revealRow(div, idx);
      rowsEl.appendChild(div);
    });
    this.hud.revealHeadline(headline);
    document.getElementById('results-stats').textContent = '';
    document.getElementById('results-extra').innerHTML = '';
    document.getElementById('btn-results-restart').textContent = i18n.t('menu.restart');
    this.hud.showScreen('screen-results');

    const playerWon = !!winner && winner.isPlayer;
    this.hud.spawnConfetti(playerWon ? 44 : winner ? 22 : 0,
      Math.round(b.timeLeft * 1000) + order.length * 7 + (playerWon ? 1 : 0));
    this._clearRevealTimers();
    if (this.audio.ready) {
      const at = (sec, fn) => this._revealTimers.push(setTimeout(fn, sec * 1000));
      if (playerWon) at(0.14, () => this.audio.podiumChime(1));
      order.forEach((r, i) => at(0.38 + i * 0.085, () => this.audio.resultsTick(i, order.length)));
      at(0.38 + order.length * 0.085 + 0.3, () => this.audio.resultsLock(playerWon));
    }
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
    this.camCtl.snapTo(this.playerKart.vehicle);   // also ends any cinematic
    this.accumulator = 0;
    this._lastRaceState = 'countdown';
    this._celebrate = null;
    this._clearRevealTimers();
    this.hud.setCinematic(false);
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
    this._celebrate = null;
    this._clearRevealTimers();
    this.camCtl.endCinematic();
    this.hud.hideFinishFx();
    this.hud.setCinematic(false);
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
    // online cleanup
    if (this.mode === 'online') {
      this._onlineClearRemotes();
      this.onlineClient?.resetInterpolation();
      this._onlineFinishedShown = false;
      this._onlineLocalFinishedSent = false;
      // restore result buttons to default handlers
      const btnRestart = document.getElementById('btn-results-restart');
      const btnMenu = document.getElementById('btn-results-menu');
      if (btnRestart) btnRestart.onclick = null;
      if (btnMenu) btnMenu.onclick = null;
      // re-bind default
      const $ = (id) => document.getElementById(id);
      const click = (id, fn) => {
        const el = $(id);
        if (!el) return;
        // remove previous listeners by cloning? simple add again (will stack but ok for now)
        el.addEventListener('click', () => {
          this.audio.init(); this.audio.resume(); this.audio.click();
          this.music.init(); this.music.resume();
          fn();
        });
      };
      // ensure default handlers still work via onResultsPrimary
    }
    this._placeOnGrid();
  }

  setPaused(on) {
    if (this.appState !== 'race') return;
    if (this.race.state === 'results') return;
    this.race.paused = on;
    if (on) {
      // the pause card says what is waiting behind it
      const tag = document.getElementById('pause-race-tag');
      if (tag) {
        tag.textContent = this.i18n.t(this.mode === 'battle'
          ? 'pause.battleInProgress' : 'pause.raceInProgress');
      }
      this.settingsReturn = 'screen-pause';
    }
    this.hud.showScreen(on ? 'screen-pause' : '');
    if (!on) this.hud.hideScreens();
  }

  // ---------------------------------------------------------- touch controls
  _bindTouchControls() {
    const root = document.getElementById('touch-controls');
    const joystick = document.getElementById('touch-joystick');
    if (!root || !joystick) return;

    this._touchActionPointers = new Map();
    this._touchStickPointer = null;
    this._touchControlsVisible = null;

    const releaseAction = (button, e) => {
      const action = button.dataset.touchAction;
      const pointers = this._touchActionPointers.get(action);
      if (!pointers) return;
      pointers.delete(e.pointerId ?? 1);
      if (!pointers.size) {
        this._touchActionPointers.delete(action);
        this.input.setTouchAction(action, false);
        button.classList.remove('is-pressed');
      }
    };

    for (const button of root.querySelectorAll('[data-touch-action]')) {
      button.addEventListener('pointerdown', (e) => {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        const action = button.dataset.touchAction;
        const pointerId = e.pointerId ?? 1;
        let pointers = this._touchActionPointers.get(action);
        if (!pointers) this._touchActionPointers.set(action, pointers = new Set());
        if (!pointers.size) this.input.setTouchAction(action, true);
        pointers.add(pointerId);
        button.classList.add('is-pressed');
        try { button.setPointerCapture?.(pointerId); } catch (_e) { /* capture is optional */ }
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(type, (e) => releaseAction(button, e));
      }
    }

    const knob = document.getElementById('touch-stick-knob');
    const updateStick = (e) => {
      const rect = joystick.getBoundingClientRect();
      const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.34);
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const magnitude = Math.hypot(dx, dy);
      const scale = magnitude > radius ? radius / magnitude : 1;
      let x = dx * scale / radius;
      let y = dy * scale / radius;
      const amount = Math.min(1, Math.hypot(x, y));
      const deadZone = 0.12;
      if (amount <= deadZone) {
        x = 0; y = 0;
      } else {
        const remap = ((amount - deadZone) / (1 - deadZone)) / amount;
        x *= remap; y *= remap;
      }
      this.input.setTouchStick(x, y);
      if (knob) {
        const displayRadius = radius * 0.78;
        knob.style.transform = `translate(calc(-50% + ${x * displayRadius}px), calc(-50% + ${y * displayRadius}px))`;
      }
    };
    const endStick = (e) => {
      if (this._touchStickPointer !== (e.pointerId ?? 1)) return;
      this._touchStickPointer = null;
      this.input.setTouchStick(0, 0);
      joystick.classList.remove('is-active');
      if (knob) knob.style.transform = 'translate(-50%, -50%)';
    };
    joystick.addEventListener('pointerdown', (e) => {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      if (this._touchStickPointer !== null) return;
      this._touchStickPointer = e.pointerId ?? 1;
      joystick.classList.add('is-active');
      updateStick(e);
      try { joystick.setPointerCapture?.(this._touchStickPointer); } catch (_e) { /* capture is optional */ }
    });
    joystick.addEventListener('pointermove', (e) => {
      if (this._touchStickPointer === (e.pointerId ?? 1)) {
        if (e.cancelable) e.preventDefault();
        updateStick(e);
      }
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      joystick.addEventListener(type, endStick);
    }

    window.addEventListener('blur', () => this._clearTouchControlState());
  }

  _clearTouchControlState() {
    this.input.clearTouch();
    this._touchActionPointers?.clear();
    this._touchStickPointer = null;
    for (const button of document.querySelectorAll('#touch-controls [data-touch-action]')) {
      button.classList.remove('is-pressed');
    }
    document.getElementById('touch-joystick')?.classList.remove('is-active');
    const knob = document.getElementById('touch-stick-knob');
    if (knob) knob.style.transform = 'translate(-50%, -50%)';
  }

  _syncMobileUI() {
    const mobile = !!this.isMobileDevice;
    const layout = this.save.get('touchLayout', 'joystick') === 'buttons' ? 'buttons' : 'joystick';
    if (document.body.dataset.touchLayout !== layout) document.body.dataset.touchLayout = layout;

    const preference = this.save.get('controlMode', 'auto');
    const hasPad = this.input.gamepadConnected;
    // Auto prefers an attached pad; Touch keeps the overlay alongside a pad;
    // Gamepad priority falls back to touch if no controller is actually found.
    const touchAvailable = mobile && (preference === 'touch' || !hasPad);
    const overlay = this._visibleScreenId();
    const canDrive = this.appState === 'race' && !this.race.paused &&
      this.race.state !== 'results' && !overlay;
    const visible = touchAvailable && canDrive;
    const controls = document.getElementById('touch-controls');
    if (controls && this._touchControlsVisible !== visible) {
      controls.classList.toggle('hidden', !visible);
      controls.setAttribute('aria-hidden', visible ? 'false' : 'true');
      if (!visible) this._clearTouchControlState();
      this._touchControlsVisible = visible;
    }

    const status = document.getElementById('gamepad-status');
    if (status) {
      const key = preference === 'gamepad' && !hasPad
        ? 'settings.gamepadFallback'
        : (hasPad ? 'settings.gamepadConnected' : 'settings.gamepadNotConnected');
      const text = this.i18n.t(key);
      if (status.textContent !== text) status.textContent = text;
    }

    const help = document.getElementById('main-controls-help');
    if (help) {
      const text = this.i18n.t(mobile ? 'controls.mobile' : 'controls.help');
      if (help.textContent !== text) help.textContent = text;
    }
    this._refreshFullscreenUI();
  }

  _refreshFullscreenUI() {
    if (typeof document === 'undefined') return;
    const fullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.webkitIsFullScreen);
    const label = this.i18n.t(fullscreen ? 'display.exitFullscreen' : 'display.fullscreen');
    if (this._fullscreenUiState === fullscreen && this._fullscreenUiLabel === label) return;
    this._fullscreenUiState = fullscreen;
    this._fullscreenUiLabel = label;
    const settingsButton = document.getElementById('btn-fullscreen');
    if (settingsButton) {
      if (settingsButton.textContent !== label) settingsButton.textContent = label;
      settingsButton.setAttribute('aria-label', label);
      settingsButton.classList.toggle('selected', fullscreen);
    }
    const touchButton = document.getElementById('touch-fullscreen');
    if (touchButton) {
      touchButton.textContent = fullscreen ? '⤢' : '⛶';
      touchButton.setAttribute('aria-label', label);
      touchButton.title = label;
    }
  }

  _showFullscreenMessage(key) {
    const message = this.i18n.t(key);
    const status = document.getElementById('fullscreen-status');
    if (status && this._visibleScreenId() === 'screen-settings') {
      status.textContent = message;
      status.classList.remove('hidden');
    } else {
      this.hud.notify(message);
    }
  }

  async _toggleFullscreen() {
    const doc = document;
    const fullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.webkitIsFullScreen);
    try {
      if (fullscreen) {
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
        if (!exit) {
          this._showFullscreenMessage('display.fullscreenUnsupported');
          return false;
        }
        await exit.call(doc);
      } else {
        const target = doc.documentElement;
        const request = target?.requestFullscreen || target?.webkitRequestFullscreen;
        if (!request) {
          this._showFullscreenMessage('display.fullscreenUnsupported');
          return false;
        }
        try {
          await request.call(target, { navigationUI: 'hide' });
        } catch (_e) {
          await request.call(target);
        }
      }
      const status = document.getElementById('fullscreen-status');
      status?.classList.add('hidden');
      if (status) status.textContent = '';
      this._refreshFullscreenUI();
      this.onResize();
      return true;
    } catch (_e) {
      this._showFullscreenMessage('display.fullscreenFailed');
      this._refreshFullscreenUI();
      return false;
    }
  }

  onResize() {
    const width = window.innerWidth || 1;
    const height = window.innerHeight || 1;
    this.isMobileDevice = detectMobileDevice(window, navigator);
    document.body.classList.toggle('mobile-device', this.isMobileDevice);
    this.gameViewport = fitAspectViewport(width, height, GAMEPLAY_ASPECT);
    this.camera.aspect = GAMEPLAY_ASPECT;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);

    const style = document.documentElement.style;
    style.setProperty('--game-left', `${this.gameViewport.x}px`);
    style.setProperty('--game-top', `${this.gameViewport.y}px`);
    style.setProperty('--game-width', `${this.gameViewport.width}px`);
    style.setProperty('--game-height', `${this.gameViewport.height}px`);
    document.body.dataset.orientation = height > width ? 'portrait' : 'landscape';
    this._syncMobileUI();
  }

  _renderGameFrame() {
    const width = window.innerWidth || 1;
    const height = window.innerHeight || 1;
    const view = this.gameViewport || fitAspectViewport(width, height, GAMEPLAY_ASPECT);
    const bottom = height - view.y - view.height;

    // Clear the full device surface to the letterbox tone, then render the
    // scene into a strict 16:9 scissor viewport (also on portrait devices).
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, width, height);
    this.renderer.setClearColor(0x0d0705, 1);
    this.renderer.clear(true, true, true);
    this.renderer.setScissorTest(true);
    this.renderer.setViewport(view.x, bottom, view.width, view.height);
    this.renderer.setScissor(view.x, bottom, view.width, view.height);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setScissorTest(false);
  }

  // ------------------------------------------------------------- race events
  onRaceEvent(type, payload) {
    if (type === 'raceGo') {
      this.music.setState('racing');
    } else if (type === 'playerFinalLap') {
      this.music.setState('finalLap');
    } else if (type === 'playerFinished') {
      this.music.setState(payload.pos <= 3 ? 'victory' : 'defeat');
      // Hand the camera to the finish sweep and start the banner timeline.
      // Both run off their own clocks so they stay in step with the slow-mo
      // curve in RaceManager rather than with the frame rate.
      this.camCtl.beginCinematic();
      this.hud.finishFx(payload.pos);
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
      // Confetti is staged across the whole cinematic instead of dumped in one
      // lump at the crossing - see _finishCelebration().
      this._celebrate = { t: 0, i: 0, win: !!payload.win };
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
  // Audio for the results reveal, scheduled against the very timeline the CSS
  // animations use (HUDManager.RESULTS_REVEAL, handed back as hud.lastReveal)
  // so every row ticks as it lands and the medal bell rings with the drop.
  _resultsRevealAudio() {
    this._clearRevealTimers();
    const rv = this.hud.lastReveal;
    const audio = this.audio;
    if (!rv || !audio || !audio.ready) return;
    const at = (sec, fn) => this._revealTimers.push(setTimeout(fn, Math.max(0, sec * 1000)));
    if (rv.podium) at(rv.medal, () => audio.podiumChime(rv.playerPos));
    for (let i = 0; i < rv.rows; i++) at(rv.rowAt(i), () => audio.resultsTick(i, rv.rows));
    at(rv.buttonsAt, () => audio.resultsLock(rv.win));
  }

  _clearRevealTimers() {
    for (const id of this._revealTimers) clearTimeout(id);
    this._revealTimers.length = 0;
  }

  _onResultsShown() {
    this.hud.setCinematic(false);
    this._celebrate = null;
    this._resultsRevealAudio();
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
      const col = ITEMS[payload.itemId]?.color ?? 0xffffff;
      this.burstAt(payload.pos, col, payload.weak ? 9 : 16);
      this.camCtl.addTrauma(payload.weak ? 0.18 : 0.35);
      // A hit the Hex Mirror turned back on its own thrower scores for nobody
      // (otherwise battle mode would award a point for hitting yourself).
      const attacker = payload.attacker && payload.attacker !== payload.victim ? payload.attacker : null;
      if (this.mode === 'battle' && this.battle && payload.victim) {
        this.battle.hitLanded(attacker, payload.victim);
      }
      if (payload.victim?.isPlayer) {
        // weak hits and debuffs leave the item in hand: show what is really held
        this.hud.setItem(this.items.heldItem(player));
        this.hud.notify(this.i18n.t('race.hitBy', { item: this.i18n.t(ITEMS[payload.itemId].nameKey) }));
      } else if (attacker?.isPlayer && payload.victim) {
        // the payload names the thrower; no more guessing from distance
        this.hud.notify(this.i18n.t('race.youHit', { victim: this.i18n.t(payload.victim.nameKey) }));
      }
    } else if (type === 'itemBlocked') {
      this.burstAt(payload.pos, 0x7deede, 14);
      this._shockRing(payload.pos, 0x7deede, 4.5);
      if (payload.victim?.isPlayer) this.hud.notify(this.i18n.t('race.itemBlocked'));
    } else if (type === 'boxPickup') {
      this.burstAt(payload.pos, 0xbaffec, 10);
      if (this.mode === 'battle' && this.battle && payload.kart) {
        this.battle.boxPicked(payload.kart);
      }
    } else if (type === 'itemBurst') {
      // Sunflare / Dune Skip / Echo Bell: an outward shockwave, not a hit
      const col = ITEMS[payload.itemId]?.color ?? 0xffb830;
      this._shockRing(payload.pos, col, payload.radius ?? 8, 26);
      this.burstAt(payload.pos, col, 18);
      if (payload.kart?.isPlayer) this.camCtl.addTrauma(0.22);
    } else if (type === 'itemWard') {
      // Forge Ward / Hex Mirror going up: a shell closing around the kart
      const col = ITEMS[payload.itemId]?.color ?? 0x7deede;
      this._shockRing(payload.pos, col, 3.2, 12, true);
      if (payload.kart?.isPlayer) {
        this.hud.notify(this.i18n.t('race.itemReady', { item: this.i18n.t(ITEMS[payload.itemId].nameKey) }));
      }
    } else if (type === 'itemHex') {
      const col = ITEMS[payload.itemId]?.color ?? 0x8ad0ff;
      this._shockRing(payload.pos, col, 6, 16, true);
      if (payload.victim?.isPlayer) {
        this.hud.notify(this.i18n.t('race.hexed', { item: this.i18n.t(ITEMS[payload.itemId].nameKey) }));
        this.camCtl.addTrauma(0.2);
      }
    } else if (type === 'itemReroll') {
      // the Kiln Lottery resolving: a flare of sparks, then the new item's name
      this.burstAt(payload.pos, 0xf0e04a, 22);
      this._shockRing(payload.pos, 0xf0e04a, 5, 18);
      if (payload.kart?.isPlayer) {
        this.hud.notify(this.i18n.t('race.rerolled', { item: this.i18n.t(ITEMS[payload.itemId].nameKey) }));
      }
    } else if (type === 'itemReflect') {
      // the mirror doing its job: a bright snap at the victim, then at the thrower
      this.burstAt(payload.pos, 0xff5df1, 20);
      this._shockRing(payload.pos, 0xff5df1, 6, 22);
      const back = payload.attacker?.vehicle?.pos;
      if (back) {
        this.burstAt(back, 0xff5df1, 20);
        this._shockRing(back, 0xff5df1, 6, 22);
      }
      if (payload.victim?.isPlayer) {
        this.hud.notify(this.i18n.t('race.reflected', { item: this.i18n.t(ITEMS[payload.itemId]?.nameKey ?? 'item.forgeWard') }));
      } else if (payload.attacker?.isPlayer) {
        this.camCtl.addTrauma(0.25);
      }
    } else if (type === 'itemShatter') {
      // Glass Fang breaking up: low, wide, and it stays on the road
      this._glassSpray(payload.pos, payload.radius ?? 3);
    } else if (type === 'cloneFlash' || type === 'tempestZap') {
      this.burstAt(payload.pos, type === 'cloneFlash' ? 0xbaf0ff : 0x8ac8ff, 20);
      this.camCtl.addTrauma(0.3);
    }
  }

  // An expanding ring of sparks on the ground - the shared "something just
  // went off here" read, used by every radius effect in the arsenal.
  _shockRing(pos, color, radius = 8, count = 22, rise = false) {
    if (!pos) return;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const sp = radius * (rise ? 0.55 : 1.5);
      this.sparks.spawn(_pp.set(pos.x, pos.y + 0.45, pos.z), _pv.set(
        Math.cos(a) * sp, rise ? 2.6 : 0.8, Math.sin(a) * sp,
      ), { color, size: 0.3, life: 0.34 + Math.random() * 0.18, gravity: rise ? 5 : 12, drag: 2.4 });
    }
  }

  // Shards flying out of a broken Glass Fang: fast, flat, catching the light.
  _glassSpray(pos, radius) {
    if (!pos) return;
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * radius * 2.2;
      this.sparks.spawn(_pp.set(pos.x, pos.y + 0.5, pos.z), _pv.set(
        Math.cos(a) * sp, 2.5 + Math.random() * 3.5, Math.sin(a) * sp,
      ), { color: i % 3 ? 0xbaf0ff : 0xffffff, size: 0.26, life: 0.4 + Math.random() * 0.3, gravity: 11, drag: 1.6 });
    }
  }

  // Staged finish celebration: confetti bursts on beats that line up with the
  // camera sweep, so the slow-motion shot keeps having things happen in it.
  _finishCelebration(rawDt) {
    const c = this._celebrate;
    if (!c) return;
    c.t += rawDt;
    const beats = c.win ? [0, 0.5, 1.05, 1.65, 2.3, 3.0] : [0, 0.8, 1.7, 2.6];
    const v = this.playerKart ? this.playerKart.vehicle : null;
    while (c.i < beats.length && c.t >= beats[c.i]) {
      if (v) this._confettiBurst(v, c.i, c.win);
      c.i++;
    }
    if (c.i >= beats.length && c.t > beats[beats.length - 1] + 1.8) this._celebrate = null;
  }

  _confettiBurst(v, index, win) {
    const colors = win
      ? [0xffd23f, 0xff9a3c, 0x2fd8c8, 0xfff3d0, 0xff5df1]
      : [0xff9a3c, 0x2fd8c8, 0xffd23f, 0x8aff6a, 0xfff3d0];
    const n = index === 0 ? 90 : 44;
    const spread = 5.5 + index * 1.6;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.dust.spawn(_pp.set(
        v.pos.x + Math.cos(a) * r,
        v.y + 5.5 + Math.random() * 6,
        v.pos.z + Math.sin(a) * r,
      ), _pv.set(
        Math.cos(a) * (0.5 + Math.random()),
        -1.2 - Math.random() * 2.2,
        Math.sin(a) * (0.5 + Math.random()),
      ), {
        color: colors[(i + index) % colors.length],
        size: 0.28 + Math.random() * 0.34,
        life: 1.5 + Math.random() * 1.4,
        gravity: 1.4, drag: 0.45,
      });
    }
    if (index === 0) {
      // a ring of sparks at the line reads as the moment of crossing
      const ring = win ? 30 : 18;
      for (let i = 0; i < ring; i++) {
        const a = (i / ring) * Math.PI * 2;
        this.sparks.spawn(_pp.set(v.pos.x, v.y + 0.6, v.pos.z),
          _pv.set(Math.cos(a) * 6.5, 2 + Math.random() * 3.2, Math.sin(a) * 6.5),
          { color: win ? 0xffe9b0 : 0x9be8ff, size: 0.32, life: 0.45 + Math.random() * 0.2, gravity: 8, drag: 1.7 });
      }
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
        const col = this.driftPalette[v.drift.level];
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

      // Water: Verdant's contact/drag is integrated by VehicleController at
      // 60 Hz. Render frames only generate wheel spray and bounded ripples;
      // legacy worlds keep their existing visual-only puddle handling.
      if (this.env?.state?.puddles?.length) {
        for (const pud of this.env.state.puddles) {
          if (pud.stepped) {
            if (v.waterSurface !== pud.surface || v.waterDepth < .08 || !v.grounded) continue;
            const intensity = Math.min(1, v.speedAbs / 24) * v.waterDepth;
            if (intensity < .1) continue;
            // Spray travels behind the two rear tyres, not radially out of a
            // single point. Emission is seconds-based, not frames-based.
            v._waterSpray = (v._waterSpray || 0) + dt * (6 + 24 * intensity);
            const count = Math.min(5, Math.floor(v._waterSpray));
            v._waterSpray -= count;
            const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
            const rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
            for (let i = 0; i < count; i++) {
              const side = i % 2 ? 1 : -1;
              const x = v.pos.x - fx * 1.05 + rx * side * .72;
              const z = v.pos.z - fz * 1.05 + rz * side * .72;
              this.dust.spawn(_pp.set(x, v.surf.y + .19, z), _pv.set(
                -fx * (2 + v.speedAbs * .24) + rx * side * (2 + Math.random()),
                1.4 + Math.random() * 2.2 * intensity,
                -fz * (2 + v.speedAbs * .24) + rz * side * (2 + Math.random()),
              ), { color: i % 3 ? 0xb5e7d9 : 0xecf8d8, size: .32 + .24 * intensity,
                life: .43, growth: .55, gravity: 6, drag: 2.2 });
            }
            if (this.time - (v._lastPuddleRipple || 0) > .14) {
              v._lastPuddleRipple = this.time;
              for (const side of [-1, 1]) {
                this.env.state.spawnPuddleRipple(_pp.set(
                  v.pos.x - fx * .8 + rx * side * .65, v.surf.y,
                  v.pos.z - fz * .8 + rz * side * .65), v.speedAbs);
              }
            }
            continue;
          }
          const dx = v.pos.x - pud.center.x;
          const dz = v.pos.z - pud.center.z;
          const distSq = dx*dx + dz*dz;
          const r = pud.radius + 0.9;
          if (distSq < r*r && v.grounded && Math.abs(v.y - pud.center.y) < 1.4) {
            // hydrodynamic drag - water resists forward motion proportionally
            if (v.speedAbs > 1) {
              const drag = Math.min(0.75, v.speedAbs * 0.028);
              v.vel.multiplyScalar(1 - drag * dt * 2.0);
              v.fSpeed *= (1 - drag * dt * 1.1);
            }
            const intensity = Math.min(1, v.speedAbs / 18);
            if (intensity > 0.12 && Math.random() < 0.52) {
              const n = Math.floor(2 + intensity*5);
              for (let i=0;i<n;i++) {
                const ang = Math.random()*Math.PI*2;
                const sp = 1.8 + Math.random()*3.5*intensity;
                this.dust.spawn(_pp.set(v.pos.x, pud.center.y+0.12, v.pos.z), _pv.set(
                  Math.cos(ang)*sp*0.7,
                  1.1 + Math.random()*2.4,
                  Math.sin(ang)*sp*0.7
                ), { color: 0xa0d8e8, size: 0.46 + intensity*0.12, life: 0.52, growth: 0.85, drag: 1.7, gravity: 4.2 });
                if (Math.random()<0.45) {
                  this.sparks.spawn(_pp.set(v.pos.x + (Math.random()-0.5)*1.1, pud.center.y+0.20, v.pos.z + (Math.random()-0.5)*1.1), _pv.set(
                    (Math.random()-0.5)*5*intensity,
                    2 + Math.random()*2.8,
                    (Math.random()-0.5)*5*intensity
                  ), { color: 0xffffff, size: 0.22, life: 0.38, gravity: 9, drag: 1.9 });
                }
              }
            }
            pud._lastRipple = pud._lastRipple || 0;
            if (this.time - pud._lastRipple > 0.16 && v.speedAbs > 3.5) {
              pud._lastRipple = this.time;
              if (this.env.state.spawnPuddleRipple) this.env.state.spawnPuddleRipple(v.pos);
            }
          }
        }
      }
    }
  }

  // Adaptive render scale: keeps a stable frame rate on weak hardware and
  // restores full quality when the GPU has headroom. Evaluated ~every 2s.
  _adaptPixelRatio(rawDt) {
    this._prAcc += rawDt; this._prN++;
    if (this._prAcc < 2 || this._prN < 30) return;
    const avgMs = (this._prAcc / this._prN) * 1000;
    this._prAcc = 0; this._prN = 0;
    const racing = this.appState === 'race' && !this.race.paused;
    if (!racing) return;
    if (avgMs > 19 && this._prIndex > 0) this._prIndex--;
    else if (avgMs < 10.5 && this._prIndex < this._prLevels.length - 1) this._prIndex++;
    else return;
    this.renderer.setPixelRatio(this._prLevels[this._prIndex]);
    this.onResize();
  }

  // ------------------------------------------------------------------ frame
  frame() {
    let rawDt = Math.min(0.1, this.clock.getDelta());
    this.time += rawDt;
    this.input.poll();

    // Controller menu navigation runs first so an A press on a highlighted
    // button is resolved before the frame's race logic looks at the pad.
    this.uiNav.update();
    this._syncMobileUI();

    if (this.appState === 'menu') {
      this.camCtl.updateMenu(rawDt);
    } else if (this.mode === 'battle' && this.battle) {
      // ---------------------------------------------------------- battle mode
      if (this.input.wasPressed('pause')) this._handlePauseToggle();
      // Keyboard Enter keeps its shortcut; the pad's A goes through the UI
      // navigator so it activates whichever button is actually highlighted.
      if (this._battleResultsShown && this.input.keyPressed('confirm')) {
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
        // Fraction of the way into the next physics step; karts render
        // between their previous and current pose so motion stays smooth
        // even when the display rate is not a multiple of 60 Hz.
        const alpha = this.accumulator / FIXED_DT;

        for (const kart of this.race.karts) {
          updateKartVisual(this.kartVisuals.get(kart.vehicle), kart.vehicle, rawDt, this.time, alpha);
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
        this.camCtl.update(rawDt, pv, pv.boost.boosting, this.time,
          this.kartVisuals.get(pv)?.renderPose || null);
        this._updateBattleHud();

        if (this.battle.state === 'over' && !this._battleResultsShown) {
          this._battleOverT += rawDt;
          if (this._battleOverT > 1.6) {
            this._battleResultsShown = true;
            this._showBattleResults();
          }
        }
      }
    } else if (this.mode === 'online') {
      // -------------------- ONLINE RACE
      if (this.input.wasPressed('pause')) this._handlePauseToggle();
      if (this.race.state === 'results' && this.input.keyPressed('confirm')) {
        // results handled by online buttons, but allow confirm to return to lobby
        if (this._onlineFinishedShown) this._onlineReturnToLobby();
      }
      if (!this.race.paused) {
        const playerInput = this.input.snapshot();
        this.race.playerInput = playerInput;

        // Local physics + track. RaceManager skips remote karts (the server
        // owns them), so each fixed step also advances every peer along the
        // interpolated snapshot timeline - that is what makes other players
        // visibly move, and it keeps them on the same render timeline as the
        // local kart so the frame interpolation below works for everyone.
        this.accumulator += rawDt;
        let steps = 0;
        while (this.accumulator >= FIXED_DT && steps < 4) {
          this.race.update(FIXED_DT);
          this._onlineStepRemotes(FIXED_DT);
          this.track.update(FIXED_DT, this.time);
          this.accumulator -= FIXED_DT;
          steps++;
        }
        if (steps === 4) this.accumulator = 0;
        const alpha = this.accumulator / FIXED_DT;

        // publish the local kart (pose + movement state) to the server
        this._onlineSendLocalState(playerInput);

        // visuals - local + remote (remote pos already set from snapshot, but we still interpolate)
        for (const kart of this.race.karts) {
          // for remote, we already set pos directly, but still update visual
          updateKartVisual(this.kartVisuals.get(kart.vehicle), kart.vehicle, rawDt, this.time, alpha);
          if (kart.charVis) animateCharacter(kart.charVis, kart.vehicle, rawDt, this.time);
        }
        this.perFrameFX(rawDt);

        // HUD - use online standings if available
        const snap = this._onlineLastSnapshot;
        if (snap && snap.standings) {
          // compute local position from standings
          const localPos = snap.standings.findIndex(s=>s.id===this.onlinePlayerId)+1;
          if (localPos>0) {
            this.hud.el.pos.textContent = this.hud.ordinal(localPos);
          }
          // lap from local state
          const pst = this.race.kartState.get(this.playerKart.vehicle);
          if (pst) {
            const lapShown = Math.min(pst.lap + 1, pst.laps);
            this.hud.el.lap.textContent = this.i18n.t('hud.lapFormat', { lap: lapShown, total: pst.laps });
          }
          this.hud.el.time.textContent = formatTime(snap.raceTime || this.onlineRaceTime);
          this.hud.drawMinimap(this.race.karts, this.playerKart, null);
          // speed
          const kmh = Math.round(this.playerKart.vehicle.speedKmh);
          this.hud.el.speedVal.textContent = String(kmh);
        } else {
          this.hud.updateRace(this.race);
        }

        const pv = this.playerKart.vehicle;
        const racing = this.race.state === 'racing' || this.race.state === 'finished';
        if (racing) {
          this.audio.updateEngine(pv.speedAbs / CONFIG.vehicle.maxSpeed, playerInput.throttle, pv.boost.boosting);
          if (pv.boost.boosting) this.camCtl.addTrauma(CONFIG.camera.boostShake * rawDt * 3);
        } else {
          this.audio.updateEngine(0, 0, false);
        }

        const pose = this.kartVisuals.get(pv)?.renderPose || null;
        if (this.race.state === 'finished' || this.race.state === 'results') {
          this.camCtl.updateCinematic(rawDt, pv, this.time, pose);
        } else {
          this.camCtl.update(rawDt, pv, pv.boost.boosting, this.time, pose);
        }
        this.hud.setCinematic(this.race.state === 'finished');
        this._finishCelebration(rawDt);

        // if server says finished, show results
        if (snap && snap.state === 'finished' && !this._onlineFinishedShown) {
          // _onOnlineRaceFinished will be called via event, but as backup
          if (this.race.state !== 'results') {
            this.race.state = 'results';
          }
        }
      } else {
        // A local pause never pauses an online race. Peers keep being
        // replicated and our own (stationary) pose keeps being published, so
        // nobody freezes on anybody else's screen and unpausing does not snap
        // the whole field back into place.
        this._onlineStepRemotes(Math.min(rawDt, 0.05));
        for (const kart of this.race.karts) {
          if (!kart.remote) continue;
          updateKartVisual(this.kartVisuals.get(kart.vehicle), kart.vehicle, rawDt, this.time, 1);
          if (kart.charVis) animateCharacter(kart.charVis, kart.vehicle, rawDt, this.time);
        }
        this._onlineSendLocalState(IDLE_INPUT);
      }

      if (this.race.state === 'results' && this._lastRaceState !== 'results') {
        // online results already shown via snapshot, but keep hook
        if (!this._onlineFinishedShown) this._onResultsShown();
      }
      this._lastRaceState = this.race.state;

    } else {
      // pause toggle
      if (this.input.wasPressed('pause')) this._handlePauseToggle();
      if (this.race.state === 'results' && this.input.keyPressed('confirm')) {
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
        const alpha = this.accumulator / FIXED_DT;

        // visuals
        for (const kart of this.race.karts) {
          updateKartVisual(this.kartVisuals.get(kart.vehicle), kart.vehicle, rawDt, this.time, alpha);
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

        const pose = this.kartVisuals.get(pv)?.renderPose || null;
        if (this.race.state === 'finished' || this.race.state === 'results') {
          this.camCtl.updateCinematic(rawDt, pv, this.time, pose);
        } else {
          this.camCtl.update(rawDt, pv, pv.boost.boosting, this.time, pose);
        }
        this.hud.setCinematic(this.race.state === 'finished');
        this._finishCelebration(rawDt);
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

    // Pause/results/menu transitions can happen during this frame; update the
    // on-screen controller immediately so stale held buttons are released.
    this._syncMobileUI();
    this._renderGameFrame();
    this.input.endFrame();

    // perf adaptation + developer overlay (?debug=1)
    this._adaptPixelRatio(rawDt);
    if (this._fpsEl) {
      this._fpsAcc += rawDt; this._fpsN++;
      if (this._fpsAcc >= 0.25) {
        this._fpsEl.textContent =
          `${(this._fpsN / this._fpsAcc).toFixed(0)} fps · ${this._prLevels[this._prIndex]}x · ${this.renderer.info.render.calls} dc`;
        this._fpsAcc = 0; this._fpsN = 0;
      }
    }
  }
}

const _pv = new THREE.Vector3();
const _pp = new THREE.Vector3();
const _wp = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// Recursively release GPU resources (geometries, materials, textures) below
// a removed subtree. Called on every track/kart swap so long sessions don't
// accumulate VRAM usage.
function disposeTree(root) {
  if (!root) return;
  const seenGeo = new Set();
  const seenMat = new Set();
  root.traverse((o) => {
    if (o.geometry && !seenGeo.has(o.geometry)) {
      seenGeo.add(o.geometry);
      o.geometry.dispose();
    }
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (seenMat.has(m)) continue;
        seenMat.add(m);
        for (const key of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap']) {
          m[key]?.dispose?.();
        }
        m.dispose();
      }
    }
  });
}

try {
  new Game();
} catch (err) {
  console.error(err);
  document.getElementById('webgl-error').classList.remove('hidden');
  for (const s of ['screen-main']) document.getElementById(s).classList.add('hidden');
}
