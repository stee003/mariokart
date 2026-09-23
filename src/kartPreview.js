// ============================================================================
// KartPreview - the rotating 3D model shown in the garage.
//
// A small, self-contained showroom: its own tiny WebGL scene (own canvas, own
// renderer) so the garage never touches the race renderer or its state. The
// kart is built with the exact same builder the race uses
// (buildKartFromLoadout) and animated with the exact same per-frame code
// (updateKartVisual / animateCharacter) driven by a synthetic idle vehicle -
// the preview therefore cannot drift away from what the player will drive.
//
// Controls: drag to spin, wheel to zoom, and an auto-turntable that resumes
// a few seconds after the last interaction.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { buildKartFromLoadout, updateKartVisual } from './kartMesh.js';
import { animateCharacter } from './characterMesh.js';

const AUTO_RESUME_DELAY = 3.5;

// Soft studio floor: dark disc with a bright rim ring, drawn once to a canvas.
function makeFloorTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 214, 160, 0.30)');
  grad.addColorStop(0.55, 'rgba(120, 70, 40, 0.18)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(255, 178, 96, 0.55)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.45, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

export class KartPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.ok = false;
    this.available = !!canvas;
    if (!canvas) return;

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas, antialias: true, alpha: true, powerPreference: 'low-power',
      });
    } catch (_e) {
      this.available = false;
      return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1.2, 0.1, 60);

    // lighting rig: warm key, cool rim, soft ambient
    this.scene.add(new THREE.HemisphereLight(0xffe6c0, 0x30202a, 1.05));
    const key = new THREE.DirectionalLight(0xfff2d8, 1.5);
    key.position.set(3.4, 6.0, 4.4);
    this.scene.add(key);
    this.rim = new THREE.DirectionalLight(0x8ad8ff, 0.9);
    this.rim.position.set(-4.0, 3.2, -5.0);
    this.scene.add(this.rim);

    // floor
    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.1, 40),
      new THREE.MeshBasicMaterial({
        map: makeFloorTexture(), transparent: true, depthWrite: false,
      }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = 0.01;
    this.scene.add(this.floor);

    // turntable holds the kart
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    // camera orbit state
    this.yaw = 0.55;
    this.pitch = 0.30;
    this.distance = 5.1;
    this.focus = 'kart';
    this.autoRotate = true;
    this.idleT = AUTO_RESUME_DELAY;
    this.dragging = false;
    this._lastX = 0;
    this._lastY = 0;
    this._sig = null;
    this._vis = null;
    this._disposables = [];

    // synthetic vehicle driving the shared animation code
    this.fake = {
      pos: new THREE.Vector3(0, 0, 0),
      y: 0, yaw: 0, fSpeed: 7, speedAbs: 7, latSpeed: 0, steer: 0,
      grounded: true, resetTimer: 0,
      surf: { y: 0 },
      drift: { drifting: false, level: 0, charge: 0 },
      boost: { boosting: false },
      trick: { active: false, t: 0 },
      fx: {},
    };

    this._bindInput();
    this.ok = true;
  }

  _bindInput() {
    const c = this.canvas;
    const down = (e) => {
      this.dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      c.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this.yaw -= dx * 0.011;
      this.pitch = Math.max(-0.15, Math.min(0.95, this.pitch + dy * 0.006));
      this.idleT = 0;
    };
    const up = (e) => {
      this.dragging = false;
      c.releasePointerCapture?.(e.pointerId);
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = Math.max(2.2, Math.min(9.5, this.distance + Math.sign(e.deltaY) * 0.45));
      this.idleT = 0;
    }, { passive: false });
    this._handlers = { down, move, up };
  }

  setFocus(focus) {
    this.focus = focus === 'pilot' ? 'pilot' : 'kart';
    this.idleT = 0;
  }

  // Rebuilds the model only when the loadout actually changed.
  setLoadout(loadout, signature = null) {
    if (!this.ok) return;
    const sig = signature || [
      loadout.spec.characterId, loadout.spec.chassisId, loadout.spec.wheelId,
      loadout.spec.paintId, loadout.spec.decalId, loadout.spec.exhaustId,
      loadout.spec.effectId,
    ].join('|');
    if (sig === this._sig) return;
    this._sig = sig;

    if (this._vis) {
      this.pivot.remove(this._vis.group);
      disposeTree(this._vis.group);
      if (this._vis.shadow) {
        this.pivot.remove(this._vis.shadow);
        this._vis.shadow.geometry.dispose();
        this._vis.shadow.material.dispose();
      }
    }
    const vis = buildKartFromLoadout(loadout);
    this.pivot.add(vis.group);
    this.pivot.add(vis.shadow);
    this._vis = vis;
    this._boostPulse = 0;
  }

  resize() {
    if (!this.ok) return;
    const w = this.canvas.clientWidth || 420;
    const h = this.canvas.clientHeight || 340;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Called every frame while the garage screen is open.
  update(dt, time) {
    if (!this.ok || !this._vis) return;
    this.resize();

    if (!this.dragging) {
      this.idleT += dt;
      if (this.idleT > AUTO_RESUME_DELAY) this.autoRotate = true;
      if (this.autoRotate) this.yaw += dt * 0.42;
    } else {
      this.autoRotate = false;
    }

    // idle life: slow breathing lean + head bob through the shared animator
    const fake = this.fake;
    fake.latSpeed = Math.sin(time * 0.9) * 1.2;
    fake.steer = Math.sin(time * 0.6) * 0.35;
    fake.speedAbs = 6 + Math.sin(time * 1.7) * 1.5;
    fake.fSpeed = fake.speedAbs;
    updateKartVisual(this._vis, fake, dt, time);
    if (this._vis.charVis) animateCharacter(this._vis.charVis, fake, dt, time);

    // periodic boost flame so the chosen effect colour is visible
    this._boostPulse = (this._boostPulse + dt) % 3.0;
    const pulse = this._boostPulse < 0.75;
    this._vis.flame.visible = pulse;
    if (pulse) this._vis.flame.scale.set(0.8, 0.9 + Math.sin(time * 30) * 0.25, 0.8);

    // camera orbit
    const target = this.focus === 'pilot'
      ? { x: 0, y: 1.28, z: -0.45, dist: Math.min(this.distance, 2.6) }
      : { x: 0, y: 0.9, z: -0.2, dist: this.distance };
    const cy = Math.cos(this.pitch), sy = Math.sin(this.pitch);
    this.camera.position.set(
      target.x + Math.sin(this.yaw) * target.dist * cy,
      target.y + 0.35 + sy * target.dist * 0.75,
      target.z + Math.cos(this.yaw) * target.dist * cy,
    );
    this.camera.lookAt(target.x, target.y, target.z);

    this.rim.color.setHex(0x8ad8ff);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (!this.ok) return;
    const c = this.canvas;
    const h = this._handlers;
    if (h) {
      c.removeEventListener('pointerdown', h.down);
      c.removeEventListener('pointermove', h.move);
      c.removeEventListener('pointerup', h.up);
      c.removeEventListener('pointercancel', h.up);
      c.removeEventListener('pointerleave', h.up);
    }
    if (this._vis) {
      disposeTree(this._vis.group);
      this._vis.shadow.geometry.dispose();
      this._vis.shadow.material.dispose();
      this._vis = null;
    }
    this.floor.geometry.dispose();
    this.floor.material.map?.dispose();
    this.floor.material.dispose();
    this.renderer.dispose();
    this.ok = false;
  }
}
