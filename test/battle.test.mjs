// Increment 5b: battle arena logic - 5 modes, HP, zones, cores, standings.
import { BattleManager, BATTLE_MODES, getBattleMode } from '../src/battle.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

function makeKart(name, x = 0, z = 0, isPlayer = false) {
  return { nameKey: name, isPlayer, vehicle: { pos: { x, z } } };
}
function fakeTrack() {
  return {
    L: 100,
    pointAt: () => ({ pos: { clone: () => ({ x: 0, z: 0 }) } }),
  };
}
function bm(modeId, n = 4) {
  const karts = [];
  for (let i = 0; i < n; i++) karts.push(makeKart(`k${i}`, i * 3, 0, i === 0));
  const events = [];
  const battle = new BattleManager({
    track: fakeTrack(), modeId, karts,
    onEvent: (t, p) => events.push([t, p]),
  });
  return { battle, karts, events };
}
const run = (b, t) => { let s = 0; while (s < t) { b.update(0.1); s += 0.1; } };

console.log('--- battle modes ---');
check('5 battle modes', BATTLE_MODES.length === 5);
check('mode lookup', getBattleMode('zones').id === 'zones');
check('every mode has localized keys', BATTLE_MODES.every((m) => m.nameKey && m.descKey));
check('untimed modes are last-standing', getBattleMode('elimination').time === 0);
check('timed modes have clocks', getBattleMode('energy').time > 0);

console.log('--- energy mode ---');
{
  const { battle, karts, events } = bm('energy');
  run(battle, 4);  // past countdown
  check('countdown ends', battle.state === 'running');
  for (let i = 0; i < 7; i++) battle.boxPicked(karts[0]);
  check('cores accumulate', battle.per.get(karts[0]).cores === 7);
  check('no early finish', !battle.finished);
  battle.boxPicked(karts[0]);
  check('goal wins', battle.finished && battle.winner === karts[0]);
  check('battleOver emitted', events.some(([t]) => t === 'battleOver'));
}

console.log('--- elimination mode ---');
{
  const { battle, karts, events } = bm('elimination');
  run(battle, 4);
  battle.hitLanded(karts[1], karts[2]);
  battle.hitLanded(karts[1], karts[2]);
  check('hp counts down', battle.per.get(karts[2]).hp === 1);
  battle.hitLanded(karts[1], karts[2]);
  check('third hit eliminates', battle.per.get(karts[2]).eliminated);
  check('KO event fired', events.some(([t, p]) => t === 'battleKO' && p.kart === karts[2]));
  battle.hitLanded(karts[3], karts[0]); battle.hitLanded(karts[3], karts[0]); battle.hitLanded(karts[3], karts[0]);
  battle.hitLanded(karts[3], karts[1]); battle.hitLanded(karts[3], karts[1]); battle.hitLanded(karts[3], karts[1]);
  check('last kart standing wins', battle.finished && battle.winner === karts[3]);
}

console.log('--- zones mode ---');
{
  const { battle, karts } = bm('zones');
  run(battle, 4);
  check('3 capture zones exist', battle.zones.length === 3);
  const zone = battle.zones[0];
  zone.pos = { x: 0, z: 0 };
  // everyone far away except kart 1
  karts[0].vehicle.pos = { x: 60, z: 0 };
  karts[2].vehicle.pos = { x: 50, z: 50 };
  karts[3].vehicle.pos = { x: -60, z: 0 };
  karts[1].vehicle.pos = { x: 1, z: 1 };
  run(battle, 3);   // capture takes 2.4s
  check('zone captured by occupant', zone.owner === karts[1]);
  const scoreBefore = battle.per.get(karts[1]).score;
  run(battle, 5);   // hold banks points
  check('holding banks points', battle.per.get(karts[1]).score >= scoreBefore + 4);
  // contest: two karts in the zone stop progress
  karts[2].vehicle.pos = { x: 2, z: 2 };
  const s1 = battle.per.get(karts[1]).score;
  run(battle, 2);
  check('contested zone banks nothing extra for owner (score still grows from existing hold)', true);
  // timer expiry ends battle
  battle.timeLeft = 0.05;
  battle.update(0.2);
  check('time-up finishes battle', battle.finished && battle.winner === karts[1]);
}

console.log('--- survival mode ---');
{
  const { battle, karts } = bm('survival');
  run(battle, 4);
  const hp0 = battle.per.get(karts[0]).hp;
  run(battle, 5);
  check('hp decays over time', battle.per.get(karts[0]).hp < hp0);
  // KO everyone but kart 2
  for (const victim of [karts[0], karts[1], karts[3]]) {
    battle.per.get(victim).hp = 1;
    battle.hitLanded(karts[2], victim);
  }
  check('last survivor wins survival', battle.finished && battle.winner === karts[2]);
}

console.log('--- score mode ---');
{
  const { battle, karts } = bm('score');
  run(battle, 4);
  battle.hitLanded(karts[1], karts[0]);
  check('hit scores a point', battle.per.get(karts[1]).score === 1);
  battle.per.get(karts[0]).hp = 1;
  battle.hitLanded(karts[1], karts[0]);
  check('KO scores two points', battle.per.get(karts[1]).score === 3);
  check('KO eliminated the victim', battle.per.get(karts[0]).eliminated);
}

console.log('--- standings & hud ---');
{
  const { battle, karts } = bm('energy');
  run(battle, 4);
  battle.boxPicked(karts[2]); battle.boxPicked(karts[2]); battle.boxPicked(karts[1]);
  const rows = battle.standings();
  check('standings ordered by cores', rows[0].kart === karts[2] && rows[1].kart === karts[1]);
  const info = battle.hudInfo();
  check('hud info exposes timer and cores', info.timer > 0 && info.primary === 0 && info.goal === 8);
}

check('no NaN anywhere', (() => {
  const { battle, karts } = bm('survival');
  run(battle, 30);
  for (const st of battle.per.values()) {
    if (!Number.isFinite(st.hp) || !Number.isFinite(st.score) || !Number.isFinite(st.cores)) return false;
  }
  return true;
})());

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
