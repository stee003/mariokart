// ============================================================================
// TimeTrialSession - solo practice mode state.
// Tracks lap splits, best lap, best total and integrates with the ghost
// recorder. Persistence (personal records + ghost data) is delegated to a
// records store (SaveManager-backed) so it can later sync with the online
// leaderboard service.
// ============================================================================

import { GhostRecorder, serializeGhost, deserializeGhost } from './ghost.js';

export class TimeTrialSession {
  constructor(trackId) {
    this.trackId = trackId;
    this.lapTimes = [];
    this.totalStart = 0;
    this.bestLap = null;
    this.recorder = new GhostRecorder();
    this.finished = false;
    this.totalLaps = 3;
  }

  start(raceTime) {
    this.lapTimes = [];
    this.totalStart = raceTime;
    this.bestLap = null;
    this.finished = false;
    this.recorder.start();
  }

  // Called by the race flow on every player lap completion.
  onLap(raceTime, lapTime) {
    this.lapTimes.push(lapTime);
    if (this.bestLap === null || lapTime < this.bestLap) this.bestLap = lapTime;
    if (this.lapTimes.length >= this.totalLaps) {
      this.finished = true;
      this.totalTime = raceTime - this.totalStart;
    }
  }

  captureGhost(vehicle) { this.recorder.capture(vehicle); }

  finish() {
    return {
      trackId: this.trackId,
      totalTime: this.totalTime ?? null,
      bestLap: this.bestLap,
      lapTimes: this.lapTimes.slice(),
      ghostFrames: this.recorder.stop(),
    };
  }
}

// Personal-records store backed by SaveManager.
// Shape: records[trackId] = { bestTotal, bestLap, lapTimes, ghost, ghostStep, date }
//   ghost      - flat serialized array (x,y,z,yaw quads), ready for
//                deserializeGhost; stored at 30 Hz to keep quota usage small.
//   ghostStep  - sim frames between stored samples (2 = 30 Hz, 3 = 20 Hz).
export class RecordsStore {
  constructor(save) {
    this.save = save;
    this.records = save.get('records', {});
    if (this.records === null || typeof this.records !== 'object' || Array.isArray(this.records)) {
      this.records = {};      // corrupt save entry: start clean, never crash
    }
  }

  get(trackId) { return this.records[trackId] || null; }

  // Ghost frames ready for GhostPlayer (frames + sim-step spacing).
  ghostFor(trackId) {
    const rec = this.get(trackId);
    if (!rec?.ghost?.length) return null;
    return { frames: deserializeGhost(rec.ghost), step: rec.ghostStep || 1 };
  }

  // Compactly encode recorded frames for storage: keep every `step`-th frame
  // (and always the last one) serialized to a flat numeric array.
  static encodeGhost(frames) {
    if (!frames?.length) return { ghost: null, ghostStep: 1 };
    const step = frames.length > 24000 ? 3 : 2;   // 30 Hz; 20 Hz for epic runs
    const kept = [];
    for (let i = 0; i < frames.length; i += step) kept.push(frames[i]);
    if (kept[kept.length - 1] !== frames[frames.length - 1]) {
      kept.push(frames[frames.length - 1]);
    }
    return { ghost: serializeGhost(kept), ghostStep: step };
  }

  // Returns the list of updated record kinds ('total' | 'lap') - the caller
  // shows the "NEW RECORD" celebration.
  submit(result) {
    const prev = this.records[result.trackId];
    const updated = [];
    const next = {
      bestTotal: prev?.bestTotal ?? null,
      bestLap: prev?.bestLap ?? null,
      lapTimes: result.lapTimes || [],
      ghost: prev?.ghost ?? null,
      ghostStep: prev?.ghostStep ?? 1,
      date: Date.now(),
    };
    if (result.totalTime !== null && (next.bestTotal === null || result.totalTime < next.bestTotal)) {
      next.bestTotal = result.totalTime;
      const enc = RecordsStore.encodeGhost(result.ghostFrames);
      next.ghost = enc.ghost;                // ghost belongs to the best total run
      next.ghostStep = enc.ghostStep;
      updated.push('total');
    }
    if (result.bestLap !== null && (next.bestLap === null || result.bestLap < next.bestLap)) {
      next.bestLap = result.bestLap;
      updated.push('lap');
    }
    this.records[result.trackId] = next;
    this.save.set('records', this.records);
    return updated;
  }
}
