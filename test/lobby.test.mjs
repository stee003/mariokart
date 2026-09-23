// ============================================================================
// Eight-player lobby suite.
//
// The grid used to be four hard-coded slots, the AI roster had exactly three
// entries, the player was pinned to grid[3] and the ordinal dictionary
// stopped at 4th. This suite pins the new capacity end to end: grid geometry,
// roster/personality coverage, localisation, results ranking and a real
// eight-kart race with items enabled.
// ============================================================================
import { TrackManager } from '../src/track.js';
import { TRACK_DEFS } from '../src/content/trackDefs.js';
import { ARENAS } from '../src/content/arenas.js';
import { VehicleController } from '../src/vehicle.js';
import { AIController } from '../src/ai.js';
import { RaceManager } from '../src/race.js';
import { ItemSystem } from '../src/items.js';
import { AI_ROSTER, rosterFor } from '../src/content/roster.js';
import { CONFIG } from '../src/config.js';
import { STRINGS } from '../src/i18n.js';
import { MAX_PLAYERS, MIN_PLAYERS, AuthoritativeRace, Matchmaker } from '../src/multiplayer.js';
import { POSITION_POINTS, pointsForPosition } from '../src/content/cups.js';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

const N = CONFIG.race.maxPlayers;
const dt = 1 / 60;

// -------------------------------------------------------------- capacity
console.log('--- Capacity constants ---');
check('lobby seats 8', N === 8, `maxPlayers=${N}`);
check('netcode cap matches the offline cap', MAX_PLAYERS === N, `${MAX_PLAYERS} vs ${N}`);
check('netcode still needs 2 to start', MIN_PLAYERS === 2);
check('scoring curve covers every finishing place', POSITION_POINTS.length >= N,
  `points=${POSITION_POINTS.length}`);
check('last place still scores', pointsForPosition(N) >= 1);

// ---------------------------------------------------------------- roster
console.log('--- AI roster ---');
check('roster can fill a full grid', rosterFor(N).length === N - 1, `have=${rosterFor(N).length}`);
check('roster names unique', new Set(AI_ROSTER.map(r => r.nameKey)).size === AI_ROSTER.length);
check('every roster personality is defined',
  AI_ROSTER.every(r => !!CONFIG.ai.personalities[r.ai]),
  AI_ROSTER.filter(r => !CONFIG.ai.personalities[r.ai]).map(r => r.ai).join(','));
check('every roster name is localised EN+IT',
  AI_ROSTER.every(r => STRINGS[r.nameKey]?.en && STRINGS[r.nameKey]?.it),
  AI_ROSTER.filter(r => !STRINGS[r.nameKey]).map(r => r.nameKey).join(','));
check('roster kart colours are distinct',
  new Set(AI_ROSTER.slice(0, N - 1).map(r => r.color)).size === N - 1);
check('smaller lobbies trim the roster', rosterFor(4).length === 3 && rosterFor(1).length === 0);
// the original three rivals must still lead the roster (small grids unchanged)
check('legacy rivals keep the front of the roster',
  AI_ROSTER[0].nameKey === 'ai.cinder' && AI_ROSTER[1].nameKey === 'ai.zephyr'
  && AI_ROSTER[2].nameKey === 'ai.bastion');

// --------------------------------------------------------------- ordinals
console.log('--- Ordinals ---');
for (let i = 1; i <= N; i++) {
  check(`ordinal.${i} exists in EN+IT`, !!STRINGS[`ordinal.${i}`]?.en && !!STRINGS[`ordinal.${i}`]?.it);
}

// ------------------------------------------------------------- start grid
console.log('--- Start grid geometry ---');
for (const def of [...TRACK_DEFS, ...ARENAS]) {
  const track = new TrackManager(def);
  let ok = true, why = '';
  for (let n = 1; n <= N && ok; n++) {
    const grid = track.startGrid(n);
    if (grid.length !== n) { ok = false; why = `asked ${n}, got ${grid.length}`; break; }
    for (const slot of grid) {
      if (![slot.pos.x, slot.pos.y, slot.pos.z].every(Number.isFinite)) { ok = false; why = 'NaN slot'; break; }
      const surf = track.surface(slot.pos.clone(), { main: -1, sc: -1 });
      if (!surf.onRoad) { ok = false; why = `slot off-road (lat ${surf.lateral.toFixed(1)})`; break; }
    }
    for (let i = 0; i < grid.length && ok; i++) {
      for (let j = i + 1; j < grid.length; j++) {
        if (grid[i].pos.distanceTo(grid[j].pos) < 2.0) { ok = false; why = `slots ${i}/${j} overlap`; break; }
      }
    }
  }
  check(`${def.id}: grids 1..${N} are valid, on-road and non-overlapping`, ok, why);
}
// the grid must remain a stable ordering (front to back)
{
  const track = new TrackManager(TRACK_DEFS[0]);
  const grid = track.startGrid(N);
  let descending = true;
  for (let i = 1; i < grid.length; i++) {
    const a = track.surface(grid[i - 1].pos.clone(), { main: -1, sc: -1 }).progress;
    const b = track.surface(grid[i].pos.clone(), { main: -1, sc: -1 }).progress;
    if (b > a + 0.5) descending = false;   // later slots must not be further ahead
  }
  check('grid slots run front-to-back', descending);
  check('first four slots match the original 4-kart layout',
    track.startGrid(4).every((s, i) => s.pos.distanceTo(grid[i].pos) < 1e-6));
}

// ------------------------------------------------------------- netcode room
console.log('--- Authoritative room ---');
{
  const room = new AuthoritativeRace({});
  check('default room seats the full lobby', room.maxPlayers === N, `max=${room.maxPlayers}`);
  const big = new AuthoritativeRace({ maxPlayers: 99 });
  check('oversized rooms clamp to the cap', big.maxPlayers === N);
  const tiny = new AuthoritativeRace({ maxPlayers: 1 });
  check('undersized rooms clamp up to the minimum', tiny.maxPlayers === MIN_PLAYERS);
  const mm = new Matchmaker();
  for (let i = 0; i < 20; i++) mm.enqueue({ id: `p${i}`, mode: 'casual', region: 'eu' });
  const group = mm.match({ mode: 'casual', region: 'eu' });
  check('matchmaker forms a full lobby, not more', group.length === N, `group=${group.length}`);
}

// --------------------------------------------------------- full 8-kart race
console.log('--- Full eight-kart races (items enabled) ---');
const stubHud = { onRaceStart(){}, countdown(){}, notify(){}, updateRace(){}, setWrongWay(){}, showResults(){} };
const stubAudio = new Proxy({}, { get: () => () => {} });
const stubI18n = { t: (k) => k };

for (const id of ['sunforge_circuit', 'skyline_helix', 'orbital_ring']) {
  const def = TRACK_DEFS.find(d => d.id === id);
  const track = new TrackManager(def);
  const events = [];
  const items = new ItemSystem({ track, audio: stubAudio, onEvent: (t) => events.push(t) });
  items.setBoxes(track.itemBoxes);
  const race = new RaceManager({ track, hud: stubHud, audio: stubAudio, i18n: stubI18n, items, onEvent: () => {} });

  const roster = rosterFor(N);
  for (let i = 0; i < N; i++) {
    const isPlayer = i === N - 1;
    const v = new VehicleController(track, isPlayer);
    const kart = {
      vehicle: v,
      ai: new AIController(v, track, isPlayer ? 'balanced' : roster[i].ai),
      nameKey: isPlayer ? 'ai.you' : roster[i].nameKey,
      isPlayer,
    };
    race.registerKart(kart);
  }
  const player = race.karts.find(k => k.isPlayer);
  check(`${id}: ${N} karts registered`, race.karts.length === N);

  race.start(track.startGrid(N));
  // every kart must start on its own slot
  let overlapped = false;
  for (let i = 0; i < race.karts.length; i++) {
    for (let j = i + 1; j < race.karts.length; j++) {
      if (race.karts[i].vehicle.pos.distanceTo(race.karts[j].vehicle.pos) < 1.5) overlapped = true;
    }
  }
  check(`${id}: no two karts share a grid slot`, !overlapped);

  let t = 0, nan = false;
  while (t < 500 && race.state !== 'results') {
    race.playerInput = race.state === 'racing'
      ? player.ai.update(dt, race.karts, true, items)
      : { throttle: 0, brake: 0, steer: 0, drift: false, trick: false };
    race.update(dt);
    track.update(dt, t);
    t += dt;
    for (const k of race.karts) {
      const v = k.vehicle;
      if (![v.pos.x, v.pos.z, v.y, v.yaw, v.fSpeed].every(Number.isFinite)) { nan = true; break; }
    }
    if (nan) break;
  }
  check(`${id}: no NaN across the full field`, !nan);
  check(`${id}: player finished and results shown (${t.toFixed(0)}s)`,
    race.state === 'results' && race.kartState.get(player.vehicle).finished, `state=${race.state}`);

  const order = race.positions();
  check(`${id}: standings rank all ${N} karts exactly once`,
    order.length === N && new Set(order).size === N);
  check(`${id}: player standing is inside the field`,
    race.playerStanding() >= 1 && race.playerStanding() <= N);
  check(`${id}: items were collected and fired`,
    events.includes('itemGet') && events.includes('itemUse'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
