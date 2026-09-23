// ============================================================================
// battleFX - arena capture-zone visuals.
//
// The battle modes are pure logic (src/battle.js); this module is the only
// place that turns that state into geometry: one energy ring per zone with
//   * an inner disc that fills as the zone is captured
//   * a ring that takes the owner's colour once held
//   * a slow pulse so a contested zone reads at a glance
//
// zoneVisualState() is pure (numbers in / numbers out) so the mapping from
// battle state to colour + fill can be unit-tested without WebGL.
// ============================================================================

import * as THREE from '../lib/three.module.js';

export const ZONE_NEUTRAL = 0x8aa0b8;
export const ZONE_PLAYER = 0x2fd8c8;
export const ZONE_RIVAL = 0xff6a8a;

// enemy owners cycle through these so each rival's zone is identifiable
const RIVAL_COLORS = [0xff6a8a, 0xffb830, 0xb78aff, 0xff8a4a];

// Pure: battle state -> { color, fill, alpha, pulse }
export function zoneVisualState(zone, karts, time = 0) {
  let color = ZONE_NEUTRAL;
  if (zone.owner) {
    if (zone.owner.isPlayer) color = ZONE_PLAYER;
    else {
      const idx = Math.max(0, karts.filter((k) => !k.isPlayer).indexOf(zone.owner));
      color = RIVAL_COLORS[idx % RIVAL_COLORS.length];
    }
  }
  const capturing = !zone.owner && zone.contestedBy;
  const fill = zone.owner ? 1 : Math.max(0, Math.min(1, zone.progress || 0));
  const pulse = 0.5 + 0.5 * Math.sin(time * (capturing ? 7 : 2.2));
  return {
    color,
    fill,
    alpha: 0.35 + (zone.owner ? 0.35 : 0) + pulse * 0.15,
    pulse,
    capturing: !!capturing,
  };
}

export class BattleZoneFX {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.rings = [];
    this._discGeo = new THREE.CircleGeometry(1, 36);
  }

  // zones: array of { pos, owner, progress, contestedBy } (battle.js)
  build(zones, radius = 7) {
    this.clear();
    for (const zone of zones) {
      const node = new THREE.Group();
      node.position.set(zone.pos.x, (zone.pos.y || 0) + 0.08, zone.pos.z);

      const disc = new THREE.Mesh(this._discGeo, new THREE.MeshBasicMaterial({
        color: ZONE_NEUTRAL, transparent: true, opacity: 0.25,
        depthWrite: false, side: THREE.DoubleSide,
      }));
      disc.rotation.x = -Math.PI / 2;
      disc.scale.setScalar(radius * 0.92);
      node.add(disc);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.28, 6, 40), new THREE.MeshBasicMaterial({
        color: ZONE_NEUTRAL, transparent: true, opacity: 0.75, depthWrite: false,
      }));
      ring.rotation.x = -Math.PI / 2;
      node.add(ring);

      // a second, taller ring gives the zone volume so it reads from far away
      const halo = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.86, 0.16, 6, 32), new THREE.MeshBasicMaterial({
        color: ZONE_NEUTRAL, transparent: true, opacity: 0.45, depthWrite: false,
      }));
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 1.1;
      node.add(halo);

      this.group.add(node);
      this.rings.push({ node, disc, ring, halo, radius, zone });
    }
    this.group.visible = this.rings.length > 0;
  }

  update(karts, time) {
    if (!this.group.visible) return;
    for (const r of this.rings) {
      const st = zoneVisualState(r.zone, karts, time);
      r.disc.material.color.setHex(st.color);
      r.disc.material.opacity = st.alpha * 0.55;
      r.disc.scale.setScalar(r.radius * (0.35 + st.fill * 0.57));
      r.ring.material.color.setHex(st.color);
      r.ring.material.opacity = st.alpha;
      r.halo.material.color.setHex(st.color);
      r.halo.material.opacity = st.alpha * 0.6;
      r.halo.position.y = 1.1 + Math.sin(time * 2 + r.radius) * 0.12 + st.pulse * 0.2;
      r.node.rotation.y += 0.004 + st.pulse * 0.006;
      const scale = 1 + st.pulse * 0.02;
      r.ring.scale.setScalar(scale);
    }
  }

  clear() {
    for (const r of this.rings) {
      for (const mesh of [r.disc, r.ring, r.halo]) {
        if (mesh.geometry !== this._discGeo) mesh.geometry.dispose();
        mesh.material.dispose();
      }
      this.group.remove(r.node);
    }
    this.rings = [];
    this.group.visible = false;
  }

  dispose() {
    this.clear();
    this._discGeo.dispose();
    this.scene.remove(this.group);
  }
}
