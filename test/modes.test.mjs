// Increment 4 tests: music pattern generation, cup structure + scoring,
// Grand Prix session, ghost record/playback/serialization, time-trial
// records store.
import { buildTheme } from '../src/music.js';
import {
  CUPS, POSITION_POINTS, pointsForPosition, trophyForPoints, trophyAtLeast, getCup,
} from '../src/content/cups.js';
import { GrandPrixSession } from '../src/grandprix.js';
import { GhostRecorder, GhostPlayer, serializeGhost, deserializeGhost } from '../src/ghost.js';
import { TimeTrialSession, RecordsStore } from '../src/timetriial.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

console.log('--- Music themes ---');
{
  const t1 = buildTheme(11, 'desert');
  const t2 = buildTheme(11, 'desert');
  check('theme deterministic per seed', JSON.stringify(t1) === JSON.stringify(t2));
  check('theme has bass + lead patterns', t1.bass.length === 8 && t1.lead.length === 16);
  check('tempo in musical range', t1.tempo >= 100 && t1.tempo <= 160, `tempo=${t1.tempo}`);
  check('root frequency sane', t1.root >= 100 && t1.root <= 240, `root=${t1.root.toFixed(1)}`);
  const themes = new Set();
  for (const seed of [11, 23, 31, 41, 43, 53, 61, 71, 83, 97, 101, 103, 113, 127, 131, 137]) {
    themes.add(JSON.stringify(buildTheme(seed, 'desert')));
  }
  check('different seeds give different music', themes.size >= 12, `n=${themes.size}`);
  const city = buildTheme(41, 'city');
  const forest = buildTheme(31, 'forest');
  check('theme flavor differs by environment', city.mode !== forest.mode || city.drive !== forest.drive);
}

console.log('--- Cups & scoring ---');
{
  check('6 cups', CUPS.length === 6, `n=${CUPS.length}`);
  check('every cup has 4 races', CUPS.every((c) => c.tracks.length === 4));
  check('first 4 cups cover all 16 unique tracks once', (() => {
    const ids = CUPS.slice(0, 4).flatMap((c) => c.tracks);
    return ids.length === 16 && new Set(ids).size === 16;
  })());
  check('escalation cups add laps', CUPS[4].laps >= 4 && CUPS[5].laps >= 4);
  check('difficulty rises through the series', CUPS.every((c, i) => i === 0 || c.difficulty >= CUPS[i - 1].difficulty));
  check('points curve decreasing by position', POSITION_POINTS.every((p, i) =>
    i === 0 || p <= POSITION_POINTS[i - 1]));
  check('pointsForPosition(1) = 15', pointsForPosition(1) === 15);
  check('pointsForPosition clamps beyond table', pointsForPosition(99) >= 1);
  check('trophy thresholds ordered', trophyForPoints(72) === 'platinum' && trophyForPoints(50) === 'gold'
    && trophyForPoints(40) === 'silver' && trophyForPoints(25) === 'bronze' && trophyForPoints(10) === null);
  check('trophyAtLeast ordering', trophyAtLeast('gold', 'silver') && !trophyAtLeast('bronze', 'gold') && !trophyAtLeast(null, 'bronze'));
  check('first cup unlocked by default, last cup gated',
    CUPS[0].unlock.type === 'default' && CUPS[5].unlock.minTrophy === 'gold');
}

console.log('--- Grand Prix session ---');
{
  const gp = new GrandPrixSession('ember', 'ai.you');
  check('starts on first track', gp.trackId === getCup('ember').tracks[0]);
  const mkRows = (names, times) => names.map((n, i) => ({
    nameKey: n, pos: i + 1, time: times[i], bestLap: times[i] / 3,
  }));
  // race 1: player wins + fastest lap + lap-1 lead
  gp.markLap1Leader('ai.you');
  let fin = gp.recordRace(mkRows(['ai.you', 'ai.cinder', 'ai.zephyr', 'ai.bastion'], [180, 182, 185, 190]));
  check('race 1 not final yet', fin === null && gp.raceIndex === 1);
  // race 2: player 3rd
  fin = gp.recordRace(mkRows(['ai.cinder', 'ai.zephyr', 'ai.you', 'ai.bastion'], [179, 181, 183, 188]));
  check('race 2 advances', gp.raceIndex === 2);
  // race 3: player 2nd
  gp.recordRace(mkRows(['ai.zephyr', 'ai.you', 'ai.cinder', 'ai.bastion'], [178, 180, 184, 189]));
  // race 4 (final): player wins
  fin = gp.recordRace(mkRows(['ai.you', 'ai.zephyr', 'ai.cinder', 'ai.bastion'], [176, 179, 182, 190]));
  check('cup completes after 4 races', fin !== null && gp.finished);
  // expected: 15+2(fastlap)+1(lap1) + 8 + 11 + 15+2(fastlap) = 54 -> gold
  check('player points computed with bonuses', fin.playerPoints === 54, `pts=${fin.playerPoints}`);
  check('player wins the cup', fin.playerPos === 1);
  check('trophy awarded', fin.trophy === 'gold', `trophy=${fin.trophy}`);
  check('standings include all racers', fin.table.length === 4);
}

console.log('--- Ghost record / playback ---');
{
  const rec = new GhostRecorder();
  rec.start();
  const N = 120;
  for (let i = 0; i < N; i++) {
    rec.capture({ pos: { x: i * 0.5, z: Math.sin(i * 0.1) * 3 }, y: 0.2, yaw: i * 0.02 });
  }
  const frames = rec.stop();
  check('frames captured', frames.length === N);

  const player = new GhostPlayer(frames, 1 / 60);
  const pose0 = player.update(0.001);
  check('playback starts near frame 0', Math.abs(pose0.x - frames[0].x) < 0.6);
  player.update(1.0);   // ~60 frames ahead
  const pose1 = player.update(0.016);
  check('playback advances smoothly', pose1.x > pose0.x && Math.abs(pose1.x - 30) < 1.2, `x=${pose1.x}`);
  for (let t = 0; t < 6; t++) player.update(0.5);
  check('playback clamps at end', player.done);

  const data = serializeGhost(frames);
  check('serialization compact', data.length === N * 4);
  const back = deserializeGhost(data);
  check('roundtrip equal', back.length === N && back[10].x === frames[10].x && back[10].yaw === frames[10].yaw);
}

console.log('--- Time trial + records ---');
{
  const tt = new TimeTrialSession('sunforge_circuit');
  tt.start(0);
  tt.onLap(62.5, 62.5);
  tt.onLap(124.0, 61.5);
  tt.onLap(187.2, 63.2);
  check('3 laps finishes session', tt.finished);
  const result = tt.finish();
  check('total + best lap recorded', Math.abs(result.totalTime - 187.2) < 0.01 && result.bestLap === 61.5);
  check('splits preserved', result.lapTimes.length === 3);

  const memStore = (() => {
    const data = {};
    return { get: (k, fb) => (k in data ? data[k] : fb), set: (k, v) => { data[k] = v; } };
  })();
  const store = new RecordsStore(memStore);
  let upd = store.submit({ ...result, ghostFrames: [{ x: 0, y: 0, z: 0, yaw: 0 }] });
  check('first submission sets both records', upd.includes('total') && upd.includes('lap'));
  upd = store.submit({ trackId: 'sunforge_circuit', totalTime: 190, bestLap: 63, lapTimes: [], ghostFrames: [] });
  check('slower run updates no records', upd.length === 0);
  upd = store.submit({ trackId: 'sunforge_circuit', totalTime: 180, bestLap: 60.2, lapTimes: [], ghostFrames: [{ x: 1, y: 0, z: 0, yaw: 0 }] });
  check('faster run beats records', upd.includes('total') && upd.includes('lap'));
  const rec = store.get('sunforge_circuit');
  check('best total persisted', Math.abs(rec.bestTotal - 180) < 0.001);
  check('ghost belongs to best run', rec.ghost[0].x === 1);
  const store2 = new RecordsStore(memStore);
  check('records persist across store instances', store2.get('sunforge_circuit').bestTotal === 180);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
