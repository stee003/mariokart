// ============================================================================
// ItemVisuals - renders ItemSystem state: rotating pickup boxes and one
// mesh per active entity. Meshes are created/destroyed in sync with the
// simulation; the systems themselves stay render-agnostic and testable.
// ============================================================================

import * as THREE from '../lib/three.module.js';
import { ITEMS } from './content/items.js';

const UP = new THREE.Vector3(0, 1, 0);

function glowMat(color, opacity = 0.9) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
}
function solidMat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.4, flatShading: true });
}

function buildBoxMesh() {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 0),
    new THREE.MeshStandardMaterial({ color: 0x2fd8c8, roughness: 0.25, metalness: 0.4, transparent: true, opacity: 0.85, flatShading: true }));
  const inner = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), glowMat(0xbaffec, 0.95));
  g.add(outer, inner);
  return g;
}

function buildEntityMesh(entity) {
  const def = entity.def;
  const color = def?.color ?? 0xffffff;
  const g = new THREE.Group();

  switch (entity.kind) {
    case 'projectile': {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), glowMat(color, 1));
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.3, 6), glowMat(color, 0.6));
      tail.rotation.x = -Math.PI / 2;
      tail.position.z = -0.7;
      g.add(core, tail);
      break;
    }
    case 'hazard': {
      if (def.id === 'vortex_mine') {
        const disc = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.22, 6, 12), solidMat(color));
        disc.rotation.x = Math.PI / 2;
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), glowMat(color, 1));
        g.add(disc, eye);
      } else if (def.id === 'static_bloom') {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const petal = new THREE.Mesh(new THREE.SphereGeometry(0.42, 7, 5), solidMat(color));
          petal.position.set(Math.cos(a) * 0.55, 0.2, Math.sin(a) * 0.55);
          g.add(petal);
        }
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), glowMat(0xfff6d0, 1));
        core.position.y = 0.35;
        g.add(core);
      } else { // graviton_well
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0x14101e, roughness: 0.2 }));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.08, 5, 16), glowMat(0x9a8aff, 0.9));
        ring.rotation.x = Math.PI / 2;
        g.add(core, ring);
      }
      break;
    }
    case 'wall': {
      const w = def.params.width;
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.45,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.4), mat);
      plane.position.y = 1.2;
      g.add(plane);
      break;
    }
    case 'zone': {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.0, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.3;
      g.add(ring);
      g.userData.isRing = true;
      g.userData.maxR = def.params.radius;
      break;
    }
    case 'swarm': {
      for (let i = 0; i < 8; i++) {
        const bit = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), solidMat(color));
        bit.position.set((i % 4) * 0.5 - 0.75, 0.5 + (i % 3) * 0.3, -1 - i * 0.6);
        g.add(bit);
      }
      break;
    }
    case 'decoy': {
      const holo = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 2.4), glowMat(color, 0.4));
      holo.position.y = 0.5;
      g.add(holo);
      break;
    }
    case 'beacon': {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.4, 6), glowMat(color, 0.9));
      cone.position.y = 0.9;
      g.add(cone);
      break;
    }
    case 'drone': {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), solidMat(color));
      const armA = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.16), solidMat(0x3a4a3a));
      const armB = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.9), solidMat(0x3a4a3a));
      g.add(body, armA, armB);
      break;
    }
    case 'pulse': {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.0, 28),
        glowMat(color, 0.8)
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.4;
      g.add(ring);
      g.userData.isRing = true;
      g.userData.maxR = def.params.radius;
      break;
    }
    default: break;
  }
  return g;
}

export class ItemVisuals {
  constructor(scene) {
    this.scene = scene;
    this.boxMeshes = [];
    this.entityMeshes = new Map();   // entity -> mesh
    this.time = 0;
  }

  setBoxes(boxes) {
    for (const m of this.boxMeshes) this.scene.remove(m);
    this.boxMeshes = boxes.map((box) => {
      const m = buildBoxMesh();
      m.position.copy(box.pos);
      this.scene.add(m);
      return m;
    });
  }

  update(dt, time, items) {
    this.time = time;
    // boxes: bob + spin, hide on cooldown
    for (let i = 0; i < this.boxMeshes.length; i++) {
      const mesh = this.boxMeshes[i];
      const box = items.boxes[i];
      if (!box) continue;
      mesh.visible = box.respawnT <= 0;
      mesh.position.copy(box.pos);
      mesh.position.y = box.pos.y + Math.sin(time * 2.4 + i) * 0.15;
      mesh.rotation.y = time * 1.6 + i;
      mesh.children[1].rotation.y = -time * 3;
    }

    // entities: create/remove meshes in sync
    const live = new Set(items.entities);
    for (const [entity, mesh] of this.entityMeshes) {
      if (!live.has(entity)) {
        this.scene.remove(mesh);
        this.entityMeshes.delete(entity);
      }
    }
    for (const entity of items.entities) {
      let mesh = this.entityMeshes.get(entity);
      if (!mesh) {
        mesh = buildEntityMesh(entity);
        this.entityMeshes.set(entity, mesh);
        this.scene.add(mesh);
      }
      mesh.position.copy(entity.pos);
      switch (entity.kind) {
        case 'projectile': {
          const dir = entity.vel;
          mesh.rotation.y = Math.atan2(dir.x, dir.z);
          mesh.position.y = entity.pos.y;
          break;
        }
        case 'hazard': {
          if (entity.def.id === 'vortex_mine') mesh.rotation.y = time * 4;
          else mesh.rotation.y = time * 1.2;
          const armed = (entity.armT ?? 0) <= 0;
          mesh.scale.setScalar(armed ? 1 : 0.5 + Math.sin(time * 12) * 0.1);
          break;
        }
        case 'wall': {
          mesh.rotation.y = Math.atan2(entity.right.x, entity.right.z);
          mesh.children[0].material.opacity = 0.35 + Math.sin(time * 5) * 0.12;
          break;
        }
        case 'zone': {
          const r = entity.radius || entity.def.params.radius;
          mesh.scale.setScalar(Math.max(0.1, r));
          mesh.children[0].material.opacity = 0.3 + Math.sin(time * 6) * 0.15;
          break;
        }
        case 'pulse': {
          const r = Math.max(0.1, entity.radius);
          mesh.scale.setScalar(r);
          break;
        }
        case 'swarm': {
          mesh.rotation.y = (entity.owner?.yaw ?? 0) + Math.PI;
          for (let i = 1; i < mesh.children.length; i++) {
            mesh.children[i].position.y = 0.5 + Math.sin(time * 9 + i * 1.7) * 0.25;
          }
          break;
        }
        case 'decoy': {
          mesh.children[0].material.opacity = 0.25 + Math.sin(time * 7) * 0.12;
          break;
        }
        case 'beacon': {
          const s = 1 + Math.sin(time * 8) * 0.2;
          mesh.scale.setScalar(s);
          break;
        }
        case 'drone': {
          if (entity.owner) {
            mesh.position.set(entity.owner.pos.x, entity.owner.y + 2.2 + Math.sin(time * 5) * 0.2, entity.owner.pos.z);
          }
          mesh.rotation.y = time * 6;
          break;
        }
        default: break;
      }
    }
  }

  dispose() {
    for (const m of this.boxMeshes) this.scene.remove(m);
    for (const [, m] of this.entityMeshes) this.scene.remove(m);
    this.boxMeshes = [];
    this.entityMeshes.clear();
  }
}
