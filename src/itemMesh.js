// ============================================================================
// ItemVisuals - renders ItemSystem state: rotating pickup boxes and one mesh
// per active entity. Meshes are created/destroyed in sync with the simulation;
// the systems themselves stay render-agnostic and testable.
//
// Readability rules this file follows:
//   - every entity wears its catalog colour, so the owner's item is the colour
//     of the thing that just hit you;
//   - anything that damages on contact has a hard silhouette (spikes, brass,
//     crystal); anything that only slows or blinds is soft and translucent;
//   - anything with a delay telegraphs it on the ground (mortar ring, mine
//     arming pulse, bulwark rise) so a fair player can react;
//   - projectiles are asymmetric (nose + tail) so their heading is obvious.
// ============================================================================

import * as THREE from '../lib/three.module.js';

const UP = new THREE.Vector3(0, 1, 0);

function glowMat(color, opacity = 0.9) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
}
function solidMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? 0.4, metalness: opts.metalness ?? 0,
    flatShading: opts.flat !== false, transparent: !!opts.opacity,
    opacity: opts.opacity ?? 1, side: opts.side ?? THREE.FrontSide,
  });
}
// cheap "glass": faceted, half transparent, catches a little light
function glassMat(color) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.12, metalness: 0.1, flatShading: true,
    transparent: true, opacity: 0.72,
  });
}

function buildBoxMesh() {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 0),
    new THREE.MeshStandardMaterial({ color: 0x2fd8c8, roughness: 0.25, metalness: 0.4, transparent: true, opacity: 0.85, flatShading: true }));
  const inner = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), glowMat(0xbaffec, 0.95));
  g.add(outer, inner);
  return g;
}

// ---------------------------------------------------------------------------
// Projectiles: nose-forward, one distinct silhouette per item.
// ---------------------------------------------------------------------------
function buildLance(color) {
  const g = new THREE.Group();
  // shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, 2.2, 6), solidMat(0x3a2a1e, { roughness: 0.6 }));
  shaft.rotation.x = Math.PI / 2;
  // head: a hot point
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.9, 6), glowMat(color, 1));
  head.rotation.x = Math.PI / 2;
  head.position.z = 1.4;
  // flame trail
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.7, 7, 1, true), glowMat(color, 0.45));
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -1.3;
  g.add(shaft, head, tail);
  g.userData.tail = tail;
  return g;
}

function buildWasps(color, count) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const w = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.3, 3, 6), solidMat(0x2e2416, { roughness: 0.5 }));
    body.rotation.x = Math.PI / 2;
    const stinger = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 5), glowMat(color, 1));
    stinger.rotation.x = Math.PI / 2;
    stinger.position.z = 0.3;
    const wingA = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.16), glowMat(0xfff4c8, 0.55));
    wingA.rotation.x = -Math.PI / 2;
    wingA.position.set(0.18, 0.12, -0.04);
    const wingB = wingA.clone();
    wingB.position.x = -0.18;
    w.add(body, stinger, wingA, wingB);
    w.userData.wings = [wingA, wingB];
    w.position.set((i - (count - 1) / 2) * 0.42, (i % 2) * 0.18, -i * 0.3);
    g.add(w);
  }
  g.userData.wasps = true;
  return g;
}

function buildFang(color) {
  const g = new THREE.Group();
  const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), glassMat(color));
  shard.scale.set(0.7, 0.7, 2.1);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), glowMat(color, 0.9));
  core.scale.set(0.7, 0.7, 1.8);
  g.add(shard, core);
  g.userData.core = core;
  return g;
}

// ---------------------------------------------------------------------------
// Hazards: keyed on the effect record, not the catalog id, so a glass patch
// looks the same whoever left it.
// ---------------------------------------------------------------------------
function buildCrucible(color) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.42, 0.7, 8), solidMat(0x2a2018, { roughness: 0.55, metalness: 0.3 }));
  pot.position.y = 0.35;
  const slag = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.16, 8), glowMat(color, 1));
  slag.position.y = 0.68;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.07, 5, 20), glowMat(color, 0.55));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.12;
  g.add(pot, slag, ring);
  g.userData.ring = ring;
  g.userData.slag = slag;
  return g;
}

function buildCaltrop(color) {
  const g = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 6), solidMat(0x3a3a2c, { roughness: 0.6, metalness: 0.35 }));
  hub.position.y = 0.3;
  g.add(hub);
  // four spikes on tetrahedral axes
  const axes = [
    [0, 1, 0], [0.94, -0.33, 0], [-0.47, -0.33, 0.82], [-0.47, -0.33, -0.82],
  ];
  for (const a of axes) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.95, 5), solidMat(color, { roughness: 0.35, metalness: 0.2 }));
    spike.position.set(a[0] * 0.42, 0.3 + a[1] * 0.42, a[2] * 0.42);
    spike.quaternion.setFromUnitVectors(UP, new THREE.Vector3(a[0], a[1], a[2]).normalize());
    g.add(spike);
  }
  return g;
}

function buildGlassPatch(color, radius) {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(0.8, radius), 12),
    new THREE.MeshStandardMaterial({
      color, roughness: 0.08, metalness: 0.15, flatShading: true,
      transparent: true, opacity: 0.55,
    })
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = 0.06;
  g.add(plate);
  // a few jagged blades so it reads as broken glass, not a puddle
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const r = radius * (0.3 + (i % 3) * 0.2);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7 + (i % 3) * 0.25, 4), glassMat(color));
    blade.position.set(Math.cos(a) * r, 0.3, Math.sin(a) * r);
    blade.rotation.set(0.3 * Math.sin(a), a, 0.3 * Math.cos(a));
    g.add(blade);
  }
  return g;
}

// Mortar: a shell in the air plus the ring that telegraphs where it lands.
// Children are indexed so the animation can toggle flight vs impact state.
function buildMortar(color, radius) {
  const g = new THREE.Group();
  // ground telegraph (in flight)
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 28), glowMat(color, 0.75));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  ring.scale.setScalar(radius);
  // crater (after impact)
  const crater = new THREE.Mesh(new THREE.CircleGeometry(radius, 18), solidMat(0x20160f, { roughness: 0.8, flat: false }));
  crater.rotation.x = -Math.PI / 2;
  crater.position.y = 0.05;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.95, 0.16, 5, 22), glowMat(color, 0.8));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.14;
  // flames
  const flames = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.5, 5), glowMat(i % 2 ? 0xffd070 : color, 0.7));
    f.position.set(Math.cos(a) * radius * 0.5, 0.7, Math.sin(a) * radius * 0.5);
    flames.add(f);
  }
  // the shell itself
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.34, 9, 7), glowMat(color, 1));
  const shellTail = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.1, 6, 1, true), glowMat(0xffe0a0, 0.5));
  shellTail.rotation.x = Math.PI;
  shellTail.position.y = 0.7;
  const shellGroup = new THREE.Group();
  shellGroup.add(shell, shellTail);
  g.add(ring, crater, lip, flames, shellGroup);
  g.userData = { ring, crater, lip, flames, shellGroup, radius };
  return g;
}

// ---------------------------------------------------------------------------
// Walls: solid brass gate vs. soft dust curtain.
// ---------------------------------------------------------------------------
function buildBulwark(color, width) {
  const g = new THREE.Group();
  const h = 2.3;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(width, h, 0.35),
    solidMat(0x8a6a2e, { roughness: 0.35, metalness: 0.55, flat: false }));
  plate.position.y = h / 2;
  const hot = new THREE.Mesh(new THREE.BoxGeometry(width, 0.16, 0.42), glowMat(color, 1));
  hot.position.y = h + 0.08;
  g.add(plate, hot);
  // riveted studs: reads as a physical object, not a light field
  for (let i = 0; i < 5; i++) {
    const x = (i / 4 - 0.5) * (width - 1.2);
    for (const y of [0.7, 1.6]) {
      const stud = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), solidMat(0xf0d08a, { roughness: 0.3, metalness: 0.6 }));
      stud.position.set(x, y, 0.22);
      g.add(stud);
    }
  }
  // end posts
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, h + 0.7, 0.5), solidMat(0x5e4520, { roughness: 0.5, metalness: 0.4 }));
    post.position.set(s * width / 2, (h + 0.7) / 2, 0);
    g.add(post);
  }
  g.userData = { plate, hot, height: h };
  return g;
}

function buildDustVeil(color, width) {
  const g = new THREE.Group();
  const h = 3.0;
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(width, h),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
  curtain.position.y = h / 2;
  g.add(curtain);
  // drifting puffs so it has volume rather than reading as a flat decal
  const puffs = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.8 + (i % 3) * 0.35, 7, 5),
      glowMat(color, 0.16));
    puff.position.set((i / 8 - 0.5) * width * 0.9, 0.7 + (i % 4) * 0.55, (i % 2 ? 0.5 : -0.5));
    puffs.add(puff);
  }
  g.add(puffs);
  g.userData = { curtain, puffs, height: h };
  return g;
}

// ---------------------------------------------------------------------------
// Zone / swarm / pulse / decoy
// ---------------------------------------------------------------------------
function buildHexBubble(color, radius) {
  const g = new THREE.Group();
  const bubble = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false }));
  bubble.position.y = 0.9;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 26), glowMat(color, 0.45));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.1;
  // the hourglass at the centre: the "time is running out" read
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.7, 4), glowMat(0xeaf6ff, 0.9));
  top.position.y = 2.5;
  const bottom = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.7, 4), glowMat(0xeaf6ff, 0.9));
  bottom.rotation.x = Math.PI;
  bottom.position.y = 1.8;
  g.add(bubble, ring, top, bottom);
  g.userData = { bubble, ring, glass: [top, bottom], maxR: radius };
  return g;
}

function buildFireTrail(color) {
  const g = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.3 + t * 0.5, 1.1 + t * 1.4, 6),
      glowMat(i % 3 === 0 ? 0xfff0b0 : color, 0.75 - t * 0.35)
    );
    flame.position.set((Math.sin(i * 2.3) * 0.7) * t, 0.5 + t * 0.3, -1.0 - i * 0.95);
    flame.rotation.x = Math.PI;         // point the flame backwards/up
    g.add(flame);
  }
  // embers
  for (let i = 0; i < 8; i++) {
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.1, 5, 4), glowMat(0xffcf70, 0.9));
    ember.position.set((Math.sin(i * 1.7) * 1.4), 0.6 + (i % 4) * 0.4, -2 - i * 1.1);
    g.add(ember);
  }
  g.userData.flames = true;
  return g;
}

function buildDecoy(color) {
  const g = new THREE.Group();
  const mat = glowMat(color, 0.4);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.5, 2.3), mat);
  body.position.y = 0.55;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.7), mat);
  nose.position.set(0, 0.5, 1.4);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6), glowMat(0xffffff, 0.35));
  canopy.position.set(0, 0.95, -0.1);
  canopy.scale.set(1, 0.7, 1.4);
  g.add(body, nose, canopy);
  for (const [x, z] of [[-0.68, 0.85], [0.68, 0.85], [-0.68, -0.85], [0.68, -0.85]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 8), glowMat(color, 0.3));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.3, z);
    g.add(wheel);
  }
  g.userData.holo = true;
  return g;
}

function buildPulseRing(color, radius) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 30), glowMat(color, 0.85));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.4;
  const inner = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.8, 30), glowMat(0xffffff, 0.45));
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.5;
  g.add(ring, inner);
  g.userData = { isRing: true, maxR: radius };
  return g;
}

function buildEntityMesh(entity) {
  const def = entity.def;
  const color = def?.color ?? 0xffffff;
  const fx = entity.fx || {};
  const p = def?.params || {};

  switch (entity.kind) {
    case 'projectile':
      if (def?.id === 'cinder_lance') return buildLance(color);
      if (def?.id === 'hornet_pod') return buildWasps(color, p.count || 3);
      if (def?.id === 'glass_fang') return buildFang(color);
      {
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), glowMat(color, 1));
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.3, 6), glowMat(color, 0.6));
        tail.rotation.x = -Math.PI / 2;
        tail.position.z = -0.7;
        const g = new THREE.Group();
        g.add(core, tail);
        return g;
      }

    case 'hazard':
      if (fx.kind === 'crater') return buildMortar(color, fx.radius || 5);
      if (fx.kind === 'erupt') return buildCrucible(color);
      if (fx.kind === 'thorns') return buildCaltrop(color);
      return buildGlassPatch(color, fx.radius || 3);

    case 'wall':
      return fx.solid ? buildBulwark(color, entity.width) : buildDustVeil(color, entity.width);

    case 'zone':
      return buildHexBubble(color, entity.radius || 11);

    case 'swarm':
      return buildFireTrail(color);

    case 'pulse':
      return buildPulseRing(color, p.radius || 14);

    case 'decoy':
      return buildDecoy(color);

    default: {
      const g = new THREE.Group();
      return g;
    }
  }
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
      if (mesh.children[1]) mesh.children[1].rotation.y = -time * 3;
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
      this._animate(entity, mesh, dt, time);
    }
  }

  _animate(entity, mesh, dt, time) {
    const ud = mesh.userData || {};
    const fx = entity.fx || {};
    switch (entity.kind) {
      case 'projectile': {
        const dir = entity.vel;
        mesh.rotation.y = Math.atan2(dir.x, dir.z);
        mesh.position.y = entity.pos.y;
        if (ud.tail) {
          // flame stretch with a flicker
          const s = 1 + Math.sin(time * 26) * 0.14;
          ud.tail.scale.set(1, s, 1);
        } else if (ud.wasps) {
          for (let i = 1; i < mesh.children.length; i++) {
            const wings = mesh.children[i].userData?.wings;
            if (!wings) continue;
            const flap = Math.sin(time * 46 + i * 2) * 0.9;
            wings[0].rotation.z = flap;
            wings[1].rotation.z = -flap;
            mesh.children[i].position.y = Math.sin(time * 9 + i) * 0.14;
          }
        } else if (ud.core) {
          mesh.rotation.z = time * 7;               // crystal tumble
          ud.core.material.opacity = 0.6 + Math.sin(time * 12) * 0.3;
        }
        break;
      }

      case 'hazard': {
        if (fx.kind === 'crater') {
          const flight = entity.flight || 0;
          const inFlight = (entity.armT ?? 0) > 0 && flight > 0;
          const t = inFlight ? 1 - entity.armT / flight : 1;
          ud.ring.visible = inFlight;
          ud.shellGroup.visible = inFlight;
          ud.crater.visible = !inFlight;
          ud.lip.visible = !inFlight;
          ud.flames.visible = !inFlight;
          if (inFlight) {
            // arc: the shell rises and falls onto the shrinking telegraph
            ud.shellGroup.position.y = Math.sin(Math.PI * t) * 15 + 0.4;
            ud.shellGroup.rotation.y = time * 6;
            const k = Math.max(0.15, 1 - t * 0.85);
            ud.ring.scale.setScalar((fx.radius || 5) * k);
            ud.ring.material.opacity = 0.5 + Math.sin(time * 14) * 0.25;
          } else {
            // landed: flames lick and settle
            for (let i = 0; i < ud.flames.children.length; i++) {
              const f = ud.flames.children[i];
              f.scale.y = 0.85 + Math.sin(time * 11 + i * 1.3) * 0.3;
            }
            ud.lip.material.opacity = 0.55 + Math.sin(time * 5) * 0.2;
            if (entity.life < 1.2) mesh.scale.setScalar(Math.max(0.05, entity.life / 1.2));
          }
          break;
        }
        if (fx.kind === 'erupt') {
          const armed = (entity.armT ?? 0) <= 0;
          mesh.rotation.y = time * (armed ? 4 : 1.5);
          if (ud.ring) {
            const k = armed ? 1 : 0.5 + Math.sin(time * 12) * 0.12;
            ud.ring.scale.setScalar(k);
            ud.ring.material.opacity = armed ? 0.35 + Math.sin(time * 6) * 0.2 : 0.6;
          }
          if (ud.slag) ud.slag.material.opacity = 0.7 + Math.sin(time * (armed ? 9 : 3)) * 0.3;
          break;
        }
        if (fx.kind === 'thorns') {
          const armed = (entity.armT ?? 0) <= 0;
          mesh.rotation.y = time * 0.8;
          mesh.scale.setScalar(armed ? 1 : 0.4 + Math.sin(time * 14) * 0.1);
          break;
        }
        // glass patch: shimmer, no spin (it is debris on the road)
        mesh.scale.setScalar(1);
        for (let i = 1; i < mesh.children.length; i++) {
          const b = mesh.children[i];
          b.material.opacity = 0.55 + Math.sin(time * 6 + i * 1.6) * 0.22;
        }
        break;
      }

      case 'wall': {
        mesh.rotation.y = Math.atan2(entity.right.x, entity.right.z);
        const armed = (entity.armT ?? 0) <= 0;
        if (fx.solid) {
          // the gate rises out of the road, then holds
          const k = armed ? 1 : Math.max(0.06, 1 - entity.armT / (entity.riseT || 0.5));
          if (ud.plate) {
            ud.plate.scale.y = k;
            ud.plate.position.y = (ud.height / 2) * k;
          }
          if (ud.hot) {
            ud.hot.position.y = ud.height * k + 0.08;
            ud.hot.material.opacity = 0.7 + Math.sin(time * 7) * 0.3;
          }
        } else {
          // dust: shimmer the curtain and drift the puffs sideways
          const k = armed ? 1 : Math.max(0.1, 1 - entity.armT / (entity.riseT || 0.6));
          mesh.scale.y = k;
          if (ud.curtain) ud.curtain.material.opacity = (armed ? 0.4 : 0.18) + Math.sin(time * 3.4) * 0.1;
          if (ud.puffs) {
            for (let i = 0; i < ud.puffs.children.length; i++) {
              const puff = ud.puffs.children[i];
              puff.position.x += Math.sin(time * 0.9 + i) * dt * 0.9;
              puff.position.y = 0.7 + (i % 4) * 0.55 + Math.sin(time * 1.6 + i * 0.8) * 0.25;
              puff.material.opacity = 0.1 + Math.sin(time * 2.2 + i * 1.1) * 0.06;
            }
          }
        }
        break;
      }

      case 'zone': {
        const r = entity.radius || ud.maxR || 11;
        // wind up small, then hold at full size; shrink out at the end
        const winding = entity.life > entity.duration;
        const k = winding ? Math.max(0.08, (1 - entity.life / (entity.duration + entity.windup)) * 0.6)
          : Math.min(1, entity.life / 0.6);
        mesh.scale.setScalar(r * k);
        if (ud.bubble) {
          ud.bubble.rotation.y = time * 1.1;
          ud.bubble.rotation.x = Math.sin(time * 0.7) * 0.12;
          ud.bubble.material.opacity = winding ? 0.25 : 0.4 + Math.sin(time * 6) * 0.15;
        }
        if (ud.ring) ud.ring.material.opacity = winding ? 0.2 : 0.35 + Math.sin(time * 5) * 0.15;
        if (ud.glass) for (const c of ud.glass) c.rotation.y = time * 2;
        break;
      }

      case 'pulse': {
        const r = Math.max(0.1, entity.radius);
        mesh.scale.setScalar(r);
        const fade = Math.max(0, entity.life / 0.6);
        for (const c of mesh.children) c.material.opacity = 0.85 * fade;
        break;
      }

      case 'swarm': {
        mesh.rotation.y = (entity.owner?.yaw ?? 0) + Math.PI;
        const flicker = 1 + Math.sin(time * 17) * 0.12;
        for (let i = 1; i < mesh.children.length; i++) {
          const c = mesh.children[i];
          if (ud.flames) {
            c.scale.set(flicker, 0.9 + Math.sin(time * 13 + i * 1.9) * 0.25, flicker);
            c.material.opacity = (0.75 - (i / mesh.children.length) * 0.35) * (0.8 + Math.sin(time * 21 + i) * 0.2);
          } else {
            c.position.y = 0.6 + Math.sin(time * 9 + i * 1.7) * 0.3;
          }
        }
        break;
      }

      case 'decoy': {
        // heat-haze double: flicker + slow bob, never quite solid
        const flick = 0.24 + Math.sin(time * 7.5) * 0.1 + Math.sin(time * 23) * 0.05;
        for (const c of mesh.children) c.material.opacity = Math.max(0.08, flick);
        mesh.position.y = entity.pos.y + Math.sin(time * 3.1) * 0.08;
        break;
      }

      default: break;
    }
  }

  dispose() {
    for (const m of this.boxMeshes) this.scene.remove(m);
    for (const [, m] of this.entityMeshes) this.scene.remove(m);
    this.boxMeshes = [];
    this.entityMeshes.clear();
  }
}
