// ============================================================================
// Lightweight pooled particle systems built on THREE.Points.
// Two pools: dust (normal blending) and sparks/flames (additive).
// ============================================================================

import * as THREE from '../lib/three.module.js';

function makeSoftTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export class ParticlePool {
  constructor(scene, count, additive) {
    this.count = count;
    this.head = 0;
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.life = new Float32Array(count);       // remaining
    this.maxLife = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.gravity = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.growth = new Float32Array(count);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: makeSoftTexture() } },
      vertexShader: `
        attribute float size; varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (260.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vColor;
        void main() {
          vec4 tex = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, 1.0) * tex;
          if (gl_FragColor.a < 0.02) discard;
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    // park dead particles far away
    for (let i = 0; i < count; i++) this.positions[i * 3 + 1] = -9999;
  }

  spawn(pos, vel, { color = 0xffffff, size = 0.5, life = 0.6, gravity = 0, drag = 1.5, growth = 0 } = {}) {
    const i = this.head;
    this.head = (this.head + 1) % this.count;
    this.positions[i * 3] = pos.x;
    this.positions[i * 3 + 1] = pos.y;
    this.positions[i * 3 + 2] = pos.z;
    this.vel[i * 3] = vel.x; this.vel[i * 3 + 1] = vel.y; this.vel[i * 3 + 2] = vel.z;
    const c = new THREE.Color(color);
    this.colors[i * 3] = c.r; this.colors[i * 3 + 1] = c.g; this.colors[i * 3 + 2] = c.b;
    this.sizes[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.growth[i] = growth;
  }

  update(dt) {
    const p = this.positions, v = this.vel;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { p[i * 3 + 1] = -9999; this.sizes[i] = 0; continue; }
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      v[i * 3] *= damp; v[i * 3 + 2] *= damp;
      v[i * 3 + 1] = v[i * 3 + 1] * damp - this.gravity[i] * dt;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (this.growth[i] !== 0) this.sizes[i] = Math.max(0.01, this.sizes[i] + this.growth[i] * dt);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}
