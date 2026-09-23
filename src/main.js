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
import { buildKart, updateKartVisual } from './kartMesh.js';
import { VehicleController } from './vehicle.js';
import { AIController } from './ai.js';
import { CameraController } from './camera.js';
import { RaceManager } from './race.js';
import { HUDManager } from './hud.js';
import { ParticlePool } from './particles.js';
import { DRIFT_COLORS } from './drift.js';

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

    // world --------------------------------------------------------------------
    this.track = new TrackManager();
    this.env = buildEnvironment(this.scene, this.track);
    this.camCtl = new CameraController(this.camera, this.track);
    this.camCtl.setColliders(this.env.colliders);
    this.camCtl.distance = this.save.get('cameraDistance', CONFIG.camera.distance);
    this.camCtl.height = this.save.get('cameraHeight', CONFIG.camera.height);

    this.dust = new ParticlePool(this.scene, CONFIG.particles.dustCount, false);
    this.sparks = new ParticlePool(this.scene, CONFIG.particles.sparkCount, true);

    this.hud = new HUDManager(this.i18n);

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
      onEvent: (type, payload) => this.onRaceEvent(type, payload),
    });
    for (const def of defs) {
      const vehicle = new VehicleController(this.track, def.ai === null);
      const vis = buildKart(def.color, def.accent, def.pilot);
      this.scene.add(vis.group);
      this.scene.add(vis.shadow);
      this.kartVisuals.set(vehicle, vis);
      const kart = {
        vehicle,
        ai: def.ai ? new AIController(vehicle, this.track, def.ai) : null,
        nameKey: def.nameKey,
        isPlayer: def.ai === null,
      };
      this.race.registerKart(kart);
    }
    this.playerKart = this.race.karts.find((k) => k.isPlayer);

    // place karts on the grid for the menu backdrop
    const grid = this.track.startGrid();
    this.race.karts.forEach((k, i) => k.vehicle.place(grid[i]));

    this.bindUI();
    window.addEventListener('resize', () => this.onResize());

    this.clock = new THREE.Clock();
    this.accumulator = 0;
    this.time = 0;
    this.renderer.setAnimationLoop(() => this.frame());
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
  }

  openSettings() { this.hud.showScreen('screen-settings'); }

  startRace() {
    this.appState = 'race';
    this.hud.hideScreens();
    this.hud.showHUD(true);
    this.audio.resume();
    this.race.restart();
    this.camCtl.snapTo(this.playerKart.vehicle);
    this.accumulator = 0;
  }

  returnToMenu() {
    this.appState = 'menu';
    this.race.state = 'idle';
    this.race.paused = false;
    this.hud.showHUD(false);
    this.hud.showScreen('screen-main');
    this.audio.stopEngine();
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
        }
        this.perFrameFX(rawDt);

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
