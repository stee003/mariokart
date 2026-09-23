// Increment 5 systems: AI difficulty tiers (decision quality only),
// progression, achievements, local leaderboards, online provider contract.
import { DIFFICULTY_TIERS, getDifficulty, effectiveParams } from '../src/aiDifficulty.js';
import {
  xpForLevel, levelFromXp, getProgress, xpForEvent, applyEvent,
  UNLOCKABLES, unlocksAtLevel, isUnlocked, XP,
} from '../src/progression.js';
import {
  recordStats, getStats, trackPlayed, ACHIEVEMENTS, checkAchievements, earnedAchievements,
} from '../src/achievements.js';
import { LocalLeaderboard } from '../src/leaderboard.js';
import {
  LocalProvider, HttpProvider, OnlineUnavailable, seasonId,
} from '../src/online.js';
import { CONFIG } from '../src/config.js';
import { TrackManager } from '../src/track.js';
import { VehicleController } from '../src/vehicle.js';
import { AIController } from '../src/ai.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

function memSave(initial = {}) {
  const data = { ...initial };
  return { get: (k, fb) => (k in data ? data[k] : fb), set: (k, v) => { data[k] = v; }, _data: data };
}

// ------------------------------------------------------------- difficulty
console.log('--- AI difficulty tiers ---');
check('6 tiers defined', DIFFICULTY_TIERS.length === 6);
const order = ['beginner', 'easy', 'normal', 'hard', 'expert', 'master'];
check('tier ids in order', order.every((t, i) => DIFFICULTY_TIERS[i].tier === t));
for (let i = 1; i < DIFFICULTY_TIERS.length; i++) {
  const a = DIFFICULTY_TIERS[i - 1], b = DIFFICULTY_TIERS[i];
  check(`quality rises ${a.tier}->${b.tier}`,
    b.mistakeMult < a.mistakeMult && b.lookaheadMult > a.lookaheadMult
    && b.itemSkill > a.itemSkill && b.driftMult >= a.driftMult);
}
check('normal is the identity tier', (() => {
  const n = getDifficulty('normal');
  return n.mistakeMult === 1 && n.lookaheadMult === 1 && n.cornerDecision === 1
    && n.itemSkill === 1 && n.startBoostMult === 1;
})());

const p = CONFIG.ai.personalities.balanced;
for (const tier of order) {
  const e = effectiveParams(p, tier);
  check(`${tier}: no speed cheats`,
    e.targetSpeed === p.targetSpeed && e.cornerSpeed <= p.cornerSpeed + 1e-9);
}
check('beginner brakes earlier than master',
  effectiveParams(p, 'beginner').cornerSpeed < effectiveParams(p, 'master').cornerSpeed);
check('unknown tier falls back to normal', getDifficulty('zzz').tier === 'normal');

// live controller integration
const track = new TrackManager();
const v = new VehicleController(track, false);
const ai = new AIController(v, track, 'balanced');
ai.setDifficulty('master');
check('controller applies master difficulty', ai.dp.mistakeRate < p.mistakeRate);
ai.setDifficulty('beginner');
check('controller applies beginner difficulty', ai.dp.mistakeRate > p.mistakeRate);

// ------------------------------------------------------------- progression
console.log('--- progression ---');
check('level curve strictly increasing', (() => {
  for (let l = 1; l < 30; l++) if (xpForLevel(l + 1) <= xpForLevel(l)) return false;
  return true;
})());
check('levelFromXp thresholds', levelFromXp(0) === 1 && levelFromXp(149) === 1 && levelFromXp(150) === 2);

const save = memSave();
check('fresh save level 1', getProgress(save).level === 1);
check('race xp scales with rivals beaten',
  xpForEvent({ kind: 'race', pos: 1, rivals: 3 }) > xpForEvent({ kind: 'race', pos: 4, rivals: 3 }));
check('trophy xp ordered',
  XP.trophy.platinum > XP.trophy.gold && XP.trophy.gold > XP.trophy.silver && XP.trophy.silver > XP.trophy.bronze);

const r1 = applyEvent(save, { kind: 'race', pos: 1, rivals: 3 });
check('xp persisted', r1.xp === r1.gained && getProgress(save).xp === r1.gained);

// force a level crossing
save.set('xp', xpForLevel(4) - 5);
const lvl2 = applyEvent(save, { kind: 'trophy', trophy: 'gold' });
check('level crossing detected', lvl2.levelBefore === 3 && lvl2.levelAfter >= 4,
  JSON.stringify([lvl2.levelBefore, lvl2.levelAfter]));

check('unlockables derived from content', UNLOCKABLES.length >= 20, `n=${UNLOCKABLES.length}`);
check('unlockables sorted by level', UNLOCKABLES.every((u, i, a) => i === 0 || a[i - 1].level <= u.level));
check('every unlockable has a nameKey', UNLOCKABLES.every((u) => !!u.nameKey));
check('unlock level 2 yields entries', unlocksAtLevel(2).length > 0);
check('isUnlocked honors levels', (() => {
  const entry = { unlock: { type: 'level', level: 5 } };
  return !isUnlocked(entry, 4) && isUnlocked(entry, 5) && isUnlocked({ unlock: { type: 'default' } }, 1);
})());

// ------------------------------------------------------------- achievements
console.log('--- achievements ---');
check('16 achievements defined', ACHIEVEMENTS.length === 16);
const asave = memSave();
check('nothing earned at start', checkAchievements(asave).length === 0);
recordStats(asave, { races: 1 });
let earned = checkAchievements(asave);
check('first race earns first_race', earned.length === 1 && earned[0].id === 'first_race');
check('no double earning', checkAchievements(asave).length === 0);
recordStats(asave, { wins: 1, podiums: 9, laps: 50, records: 1 });
asave.set('xp', xpForLevel(10));
earned = checkAchievements(asave);
check('batch earning works', earned.length >= 4, `got ${earned.length}`);
check('earned persisted', earnedAchievements(asave).includes('first_win'));

const tsave = memSave();
check('trackPlayed first visit true', trackPlayed(tsave, 'sunforge_circuit'));
check('trackPlayed repeat false', !trackPlayed(tsave, 'sunforge_circuit'));
check('tracksPlayed counted', getStats(tsave).tracksPlayed === 1);
check('explorer needs 16 tracks', !ACHIEVEMENTS.find((a) => a.id === 'explorer').cond(getStats(tsave), { level: 1 }));

// ------------------------------------------------------------- leaderboard
console.log('--- leaderboard ---');
const lsave = memSave();
const lb = new LocalLeaderboard(lsave);
check('empty board', lb.top('t1').length === 0 && lb.best('t1') === null);
check('first submit ranks 1', lb.submit('t1', { name: 'You', time: 95.5 }) === 1);
lb.submit('t1', { name: 'Rival', time: 90.1 });
check('faster time takes rank 1', lb.best('t1').name === 'Rival');
check('board sorted', lb.top('t1')[0].time <= lb.top('t1')[1].time);
for (let i = 0; i < 20; i++) lb.submit('t1', { name: `b${i}`, time: 80 + i });
check('board trims to 10', lb.top('t1').length === 10);
check('slow time does not chart', lb.submit('t1', { name: 'Slow', time: 500 }) === null);
check('qualifies check', !lb.qualifies('t1', 999) && lb.qualifies('t1', 1));
const lb2 = new LocalLeaderboard(lsave);
check('board persists across instances', lb2.best('t1').time === lb.best('t1').time);

// ------------------------------------------------------------- online
console.log('--- online providers ---');
check('season id format', /^\d{4}-\d{2}$/.test(seasonId(new Date(Date.UTC(2026, 8, 23)))));
const lp = new LocalProvider(new LocalLeaderboard(memSave()));
check('local provider name', lp.name === 'local');
const ping = await lp.ping();
check('local ping ok', ping.ok);
await lp.submitScore('t1', { name: 'You', time: 77 });
check('local submit/fetch roundtrip', (await lp.fetchLeaderboard('t1')).length === 1);
const win = await lp.submitMatch('You', { won: true });
const lose = await lp.submitMatch('You', { won: false });
check('ranked delta win > loss', win.delta > 0 && lose.delta < 0 && lose.points === win.points + lose.delta);

// HTTP provider with a fake fetch
const calls = [];
const fakeFetch = async (url, opts = {}) => {
  calls.push({ url, opts });
  if (url.includes('/bad')) return { ok: false, status: 503, json: async () => ({}) };
  return { ok: true, json: async () => ({ echoed: url }) };
};
const hp = new HttpProvider('https://api.example.com/', fakeFetch);
await hp.fetchLeaderboard('sunforge_circuit', 5);
check('http leaderboard url', calls[0].url === 'https://api.example.com/leaderboard/sunforge_circuit?limit=5');
await hp.submitScore('sunforge_circuit', { name: 'You', time: 99 });
check('http submit is POST', calls[1].opts.method === 'POST');
let threw = false;
try { await hp.ping(); } catch (e) { threw = e instanceof OnlineUnavailable; }
// ping hits /ping which is fine; force failure path via bad url
try { await hp._req('/bad'); } catch (e) { threw = e instanceof OnlineUnavailable; }
check('http errors raise OnlineUnavailable', threw);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
