// ============================================================================
// GrandPrixSession - cup state machine.
// Tracks race-by-race results, applies the original scoring curve, keeps a
// live standings table and awards the trophy at the end of the cup.
// Pure logic (no rendering, no audio) - fully unit-testable.
// ============================================================================

import {
  getCup, pointsForPosition, FASTEST_LAP_BONUS, LAP1_LEAD_BONUS, trophyForPoints,
} from './content/cups.js';

export class GrandPrixSession {
  constructor(cupId, playerNameKey = 'ai.you') {
    this.cup = getCup(cupId);
    this.playerNameKey = playerNameKey;
    this.raceIndex = 0;
    this.results = [];          // per race: [{nameKey, pos, fastestLap, ledLap1}]
    this.finished = false;
  }

  get trackId() { return this.cup.tracks[this.raceIndex]; }
  get laps() { return this.cup.laps ?? 3; }
  get isLastRace() { return this.raceIndex === this.cup.tracks.length - 1; }

  // rows: [{nameKey, pos, time, bestLap}] ordered by finish position (1..n)
  recordRace(rows) {
    if (this.finished) return null;
    const fastest = rows.reduce((a, b) => ((b.bestLap ?? Infinity) < (a.bestLap ?? Infinity) ? b : a));
    const raceResult = rows.map((r) => ({
      nameKey: r.nameKey,
      pos: r.pos,
      fastestLap: r === fastest,
      ledLap1: false,   // set via markLap1Leader before recordRace if known
      points: pointsForPosition(r.pos),
    }));
    const leader = this._lap1Leader;
    if (leader) {
      const row = raceResult.find((r) => r.nameKey === leader);
      if (row) { row.ledLap1 = true; row.points += LAP1_LEAD_BONUS; }
    }
    for (const r of raceResult) if (r.fastestLap) r.points += FASTEST_LAP_BONUS;
    this.results.push(raceResult);
    this._lap1Leader = null;

    if (this.isLastRace) {
      this.finished = true;
      return this.finalStandings();
    }
    this.raceIndex++;
    return null;
  }

  markLap1Leader(nameKey) { this._lap1Leader = nameKey; }

  standings() {
    const totals = new Map();
    for (const race of this.results) {
      for (const r of race) {
        totals.set(r.nameKey, (totals.get(r.nameKey) || 0) + r.points);
      }
    }
    return [...totals.entries()]
      .map(([nameKey, points]) => ({ nameKey, points }))
      .sort((a, b) => b.points - a.points);
  }

  finalStandings() {
    const table = this.standings();
    const player = table.find((r) => r.nameKey === this.playerNameKey);
    const playerPoints = player ? player.points : 0;
    return {
      cupId: this.cup.id,
      table,
      playerPoints,
      playerPos: table.findIndex((r) => r.nameKey === this.playerNameKey) + 1,
      trophy: trophyForPoints(playerPoints),
    };
  }
}
