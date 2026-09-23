// ============================================================================
// SUNFORGE RACERS - main entry point.
// Wires renderer, track, karts, race manager, HUD, audio, camera, particles
// and the app state machine (menu → race → results). Fixed-timestep physics.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { CONFIG } from './config.js';
import { SaveManager } from './save.js';
import { LocalizationManager } from './i18n.js';
import { InputManager } from './input.js';
import { AudioManager } from './audio.js';
import { TrackManager } from './track.js';
import { buildEnvironment } from './environment.js';
import { buildThemedEnvironment } from './environment2.js';
import { getTrackDef } from './content/trackDefs.js';
import { buildKart, buildKartFromLoadout, updateKartVisual } from './kartMesh.js';
import { animateCharacter } from './characterMesh.js';
import { VehicleController } from './vehicle.js';
import { AIController } from './ai.js';
import { CameraController } from './camera.js';
import { RaceManager } from './race.js';
import { HUDManager } from './hud.js';
import { ParticlePool } from './particles.js';
import { DRIFT_COLORS } from './drift.js';
import { ItemSystem } from './items.js';
import { ItemVisuals } from './itemMesh.js';
import { ITEMS } from './content/items.js';

const FIXED_DT = 1 / 60;

class Game {
  constructor() {
    this.save = new SaveManager();
    this.i18n = new LocalizationManager(this.save);
    this.input = new InputManager();
    this.audio = new AudioManager(this.save);
    this.appState = 'menu';          // menu | race
    this.settingsReturn = 'screen-main';

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
  // only world content swaps.
  _loadTrack(trackId, first = false) {
    const def = getTrackDef(trackId);
    this.trackId = def.id;

    // dispose previous world (environment group + kart meshes)
    if (this.env) this.scene.remove(this.env.group);
    if (this.kartVisuals) {
      for (const vis of this.kartVisuals.values()) {
        this.scene.remove(vis.group);
        this.scene.remove(vis.shadow);
      }
    }
    if (this.itemVisuals) this.itemVisuals.dispose();

    this.track = new TrackManager(def);

    // Route rendering: the original Sunforge desert keeps its bespoke
    // renderer; every other theme uses the generic themed builder.
    if (def.id === 'sunforge_circuit') {
      this.env = buildEnvironment(this.scene, this.track);
    } else {
      this.env = buildThemedEnvironment(this.scene, this.track, this.i18n ? this.i18n.t(def.nameKey).toUpperCase() : def.id.toUpperCase());
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
    const defs = [
      { nameKey: 'ai.cinder',  color: 0xd9452f, accent: 0xffd23f, pilot: 0x53302a, ai: 'aggressive' },
      { nameKey: 'ai.zephyr',  color: 0x2fa877, accent: 0xd8f4e6, pilot: 0x3c5c4e, ai: 'balanced' },
      { nameKey: 'ai.bastion', color: 0x4159c9, accent: 0x9fb4ff, pilot: 0x37406e, ai: 'defensive' },
      { nameKey: 'ai.you',     color: 0xff8a2a, accent: 0x2fd8c8, pilot: 0xf2a65a, ai: null },
    ];
    this.race = new RaceManager({
      track: this.track, hud: this.hud, audio: this.audio, i18n: this.i18n,
      items: this.items,
      onEvent: (type, payload) => this.onRaceEvent(type, payload),
    });
    for (const d of defs) {
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
      this.race.registerKart(kart);
    }
    this.playerKart = this.race.karts.find((k) => k.isPlayer);

    // place karts on the grid for the menu backdrop
    const grid = this.track.startGrid();
    this.race.karts.forEach((k, i) => k.vehicle.place(grid[i]));
  }

  // --------------------------------------------------------------------- UI
  bindUI() {
    const $ = (id) => document.getElementById(id);
    const click = (id, fn) => {
      $(id).addEventListener('click', () => {
        this.audio.init(); this.audio.resume(); this.audio.click();
        fn();
      });
    };

    click('btn-start', () => this.startRace());
    click('btn-settings', () => { this.settingsReturn = 'screen-main'; this.openSettings(); });
    click('btn-settings-back', () => this.hud.showScreen(this.settingsReturn));
    click('btn-resume', () => this.setPaused(false));
    click('btn-pause-restart', () => { this.setPaused(false); this.startRace(); });
    click('btn-pause-menu', () => this.returnToMenu());
    click('btn-results-restart', () => this.startRace());
    click('btn-results-menu', () => this.returnToMenu());

    // language
    const syncLang = () => {
      $('lang-en').classList.toggle('selected', this.i18n.lang === 'en');
      $('lang-it').classList.toggle('selected', this.i18n.lang === 'it');
    };
    $('lang-en').addEventListener('click', () => { this.audio.init(); this.i18n.setLanguage('en'); this.audio.click(); syncLang(); });
    $('lang-it').addEventListener('click', () => { this.audio.init(); this.i18n.setLanguage('it'); this.audio.click(); syncLang(); });
    syncLang();

    // sliders
    $('cam-dist').value = this.camCtl.distance;
    $('cam-height').value = this.camCtl.height;
    $('volume').value = this.save.get('volume', 0.8);
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

    // power-ups toggle
    const syncItems = () => {
      const on = this.save.get('itemsEnabled', true);
      $('items-on').classList.toggle('selected', on);
      $('items-off').classList.toggle('selected', !on);
    };
    $('items-on').addEventListener('click', () => { this.audio.init(); this.audio.click(); this.save.set('itemsEnabled', true); syncItems(); });
    $('items-off').addEventListener('click', () => { this.audio.init(); this.audio.click(); this.save.set('itemsEnabled', false); syncItems(); });
    syncItems();
  }

  openSettings() { this.hud.showScreen('screen-settings'); }

  startRace() {
    this.appState = 'race';
    this.hud.hideScreens();
    this.hud.showHUD(true);
    this.audio.resume();
    this.race.itemsEnabled = this.save.get('itemsEnabled', true) && !!this.race.items;
    this.race.restart();
    this.hud.setItem(null);
    for (const m of this.itemVisuals.boxMeshes) m.visible = this.race.itemsEnabled;
    this.camCtl.snapTo(this.playerKart.vehicle);
    this.accumulator = 0;
  }

  returnToMenu() {
    this.appState = 'menu';
    this.race.state = 'idle';
    this.race.paused = false;
    this.hud.showHUD(false);
    this.hud.setItem(null);
    this.hud.showScreen('screen-main');
    this.audio.stopEngine();
    this.items.reset();
    this.itemVisuals.update(0, this.time, this.items);
    for (const m of this.itemVisuals.boxMeshes) m.visible = false;
    const grid = this.track.startGrid();
    this.race.karts.forEach((k, i) => k.vehicle.place(grid[i]));
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
    if (type === 'kartHit' || type === 'obstacleHit') {
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

  // ------------------------------------------------------------- item events
  onItemEvent(type, payload) {
    const player = this.playerKart;
    if (type === 'itemGet') {
      this.burstAt(payload.pos ?? payload.kart?.vehicle?.pos, 0x2fd8c8, 8);
      if (payload.isPlayer) {
        this.hud.setItem(payload.itemId);
        this.hud.notify(this.i18n.t('race.gotItem', { item: this.i18n.t(ITEMS[payload.itemId].nameKey) }));
      }
    } else if (type === 'itemUse') {
      if (payload.kart?.isPlayer) this.hud.setItem(this.items.heldItem(player));
    } else if (type === 'itemHit') {
      this.burstAt(payload.pos, ITEMS[payload.itemId]?.color ?? 0xffffff, 16);
      this.camCtl.addTrauma(0.35);
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
      const vis = this.kartVisuals.get(v);

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
    } else {
      // pause toggle
      if (this.input.wasPressed('pause')) {
        if (this.race.state !== 'idle' && this.race.state !== 'results') {
          this.setPaused(!this.race.paused);
        }
      }
      if (this.race.state === 'results' && this.input.wasPressed('confirm')) {
        this.startRace();
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
