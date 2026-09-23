// ============================================================================
// TimeTrialSession - solo practice mode state.
// Tracks lap splits, best lap, best total and integrates with the ghost
// recorder. Persistence (personal records + ghost data) is delegated to a
// records store (SaveManager-backed) so it can later sync with the online
// leaderboard service.
// ============================================================================

import { GhostRecorder } from './ghost.js';

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
// Shape: records[trackId] = { bestTotal, bestLap, lapTimes, ghost, date }
export class RecordsStore {
  constructor(save) {
    this.save = save;
    this.records = save.get('records', {});
  }

  get(trackId) { return this.records[trackId] || null; }

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
      date: Date.now(),
    };
    if (result.totalTime !== null && (next.bestTotal === null || result.totalTime < next.bestTotal)) {
      next.bestTotal = result.totalTime;
      next.ghost = result.ghostFrames;   // ghost belongs to the best total run
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
