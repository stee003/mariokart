// ============================================================================
// Ghost system - records the player kart at the fixed simulation rate and
// plays it back as a translucent rival. Frames are {x, y, z, yaw} sampled
// once per physics step; playback interpolates between frames so the ghost
// stays smooth even if render rate differs from sim rate.
// ============================================================================

export class GhostRecorder {
  constructor() {
    this.frames = [];
    this.recording = false;
  }

  start() {
    this.frames = [];
    this.recording = true;
  }

  capture(vehicle) {
    if (!this.recording) return;
    this.frames.push({
      x: Math.round(vehicle.pos.x * 100) / 100,
      y: Math.round(vehicle.y * 100) / 100,
      z: Math.round(vehicle.pos.z * 100) / 100,
      yaw: Math.round(vehicle.yaw * 1000) / 1000,
    });
  }

  stop() {
    this.recording = false;
    return this.frames;
  }
}

export class GhostPlayer {
  constructor(frames, stepDt) {
    this.frames = frames || [];
    this.stepDt = stepDt;      // sim seconds per frame (1/60)
    this.t = 0;
    this.done = false;
  }

  get length() { return this.frames.length; }

  reset() { this.t = 0; this.done = false; }

  // Advance by dt seconds; returns the interpolated pose (or the last one).
  update(dt) {
    if (this.frames.length === 0) return null;
    this.t += dt;
    const f = this.t / this.stepDt;
    const i = Math.floor(f);
    if (i >= this.frames.length - 1) {
      this.done = true;
      return this.frames[this.frames.length - 1];
    }
    const a = this.frames[i], b = this.frames[i + 1];
    const t = f - i;
    let dyaw = b.yaw - a.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      yaw: a.yaw + dyaw * t,
    };
  }
}

// Compact serialization for saving (arrays instead of objects).
export function serializeGhost(frames) {
  const data = new Array(frames.length * 4);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    data[i * 4] = f.x; data[i * 4 + 1] = f.y; data[i * 4 + 2] = f.z; data[i * 4 + 3] = f.yaw;
  }
  return data;
}

export function deserializeGhost(data) {
  const frames = [];
  for (let i = 0; i + 3 < data.length; i += 4) {
    frames.push({ x: data[i], y: data[i + 1], z: data[i + 2], yaw: data[i + 3] });
  }
  return frames;
}
