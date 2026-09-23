// Increment 9 tests - online stack.
//
//   * OnlineStore rules (ranking math, sanitisation, persistence)
//   * the HTTP API end to end, through the real HttpProvider client
//   * the netplay relay with two real WebSocket clients (lobby -> race -> over)
//   * client interpolation + provider fallback when no server is reachable
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OnlineStore, sanitizeName, sanitizeTime, sanitizeGhost, matchDelta, winExpectation,
  seasonId, STARTING_POINTS,
} from '../src/net/store.js';
import { sanitizeState, sanitizeProfile, roomCode, RoomManager } from '../src/net/rooms.js';
import { HttpProvider, LocalProvider, OnlineService, OnlineUnavailable } from '../src/online.js';
import { LocalLeaderboard } from '../src/leaderboard.js';
import { NetSession, interpolate, INTERP_DELAY_MS } from '../src/netplay.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

// ============================================================ store (unit)
console.log('--- store rules ---');
check('names are sanitised',
  sanitizeName('  bad\u0000name \n ok ') === 'badname ok',
  JSON.stringify(sanitizeName('  bad\u0000name \n ok ')));
check('names cannot smuggle line breaks', !sanitizeName('two\nlines').includes('\n'));
check('empty names fall back', sanitizeName('   ') === 'Racer');
check('names are length capped', sanitizeName('x'.repeat(60)).length === 16);
check('times are validated', sanitizeTime(1234.5678) === 1234.568 && sanitizeTime(-5) === null && sanitizeTime('abc') === null);
check('ghosts are capped and coerced', (() => {
  const g = sanitizeGhost([[1, 2, 3, 4], ['5', '6', '7', '8'], 'junk', [1]]);
  return g.length === 2 && g[1][0] === 5;
})());
check('a one-frame ghost is rejected', sanitizeGhost([[1, 2]]) === null);
check('huge ghosts are truncated', sanitizeGhost(Array.from({ length: 9999 }, () => [1, 2, 3, 4])).length === 3600);

const store = new OnlineStore({ now: () => Date.UTC(2026, 0, 15, 12) });
check('season id is YYYY-MM', seasonId(new Date(Date.UTC(2026, 0, 15))) === '2026-01');

{
  const submit = (name, time) => store.submitScore('sunforge_circuit', { name, time, ghost: [[0, 0, 0, 0], [1, 1, 0, 0]] });
  check('first score is rank 1', submit('Ana', 60000).rank === 1);
  check('slower score ranks behind', submit('Bob', 65000).rank === 2);
  const fast = submit('Cy', 55000);
  check('faster score takes the top spot', fast.rank === 1);
  const rows = store.topScores('sunforge_circuit', 10);
  check('rows come back fastest-first', rows[0].name === 'Cy' && rows[1].name === 'Ana' && rows[2].name === 'Bob');
  check('ghost stored for the record holder', store.getGhost('sunforge_circuit', 1)?.name === 'Cy');
  check('ghost frames round-trip', store.getGhost('sunforge_circuit', 1)?.frames.length === 2);
  check('missing ghost returns null', store.getGhost('sunforge_circuit', 99) === null);
  check('unknown track has no ghost', store.getGhost('nowhere', 1) === null);
  check('bad time is rejected', (() => {
    try { store.submitScore('sunforge_circuit', { name: 'X', time: -1 }); return false; } catch { return true; }
  })());
  check('boards are capped at 25', (() => {
    for (let i = 0; i < 40; i++) submit(`P${i}`, 70000 + i * 10);
    return store.topScores('sunforge_circuit', 100).length === 25;
  })());
}

check('win expectation is symmetric around equal ratings', Math.abs(winExpectation(1000, 1000) - 0.5) < 1e-9);
check('beating a stronger opponent pays more', matchDelta(1000, 1300, true) > matchDelta(1000, 900, true));
check('an even match pays the full K-factor half', matchDelta(1000, 1000, true) === 16);
check('unknown opponent rating is treated as average, not zero', (() => {
  const s = new OnlineStore();
  return s.submitMatch('Fresh', { won: true }).delta === 16;
})());
check('losing to a weaker opponent costs more', matchDelta(1000, 800, false) < matchDelta(1000, 1300, false));
check('deltas never fall below the floor', Math.abs(matchDelta(2000, 100, false)) >= 5 && Math.abs(matchDelta(2000, 100, true)) >= 5);

{
  const s = new OnlineStore({ now: () => Date.UTC(2026, 1, 3) });
  const first = s.submitMatch('Ana', { won: true, trackId: 'sunforge_circuit' });
  check('first match starts from the base rating', first.points === STARTING_POINTS + first.delta);
  check('a win records a win', first.wins === 1 && first.matches === 1);
  check('rank #1 after the only match', first.rank === 1);
  s.submitMatch('Bob', { won: false });
  s.submitMatch('Bob', { won: true, opponentPoints: 1400 });
  const ladder = s.ladder('2026-02', 10);
  check('ladder is ordered by points', ladder[0].points >= ladder[1].points && ladder.length === 2);
  check('ladder rows carry ranks', ladder[0].rank === 1 && ladder[1].rank === 2);
  const season2 = new OnlineStore({ now: () => Date.UTC(2026, 2, 3) });
  check('seasons are independent', season2.getRanked('Ana', '2026-03') === null);
  const revived = OnlineStore.fromJSON(JSON.parse(JSON.stringify(s.toJSON())), { now: () => Date.UTC(2026, 1, 4) });
  check('store survives a JSON round-trip', revived.getRanked('Ana', '2026-02')?.wins === 1
    && revived.topScores('sunforge_circuit', 5).length === 0);
}

check('unknown players are unranked', store.getRanked('Nobody') === null);
check('prune keeps only the newest seasons', (() => {
  const s = new OnlineStore();
  for (let m = 0; m < 18; m++) s.submitMatch(`P${m}`, { won: true, opponentPoints: 1000 });
  const before = s.stats().seasons.length > 0;
  s.prune({ seasons: 12 });
  return before && s.ranked.size <= 12;
})());

// ==================================================== rooms (unit, no socket)
console.log('--- room rules ---');
const rooms = new RoomManager({ now: () => 1000, codeGen: () => 'ABCD' });
check('room codes avoid look-alikes', /^[A-HJ-NP-Z2-9]{4}$/.test(roomCode(() => 0.42)));
{
  const fakeConn = { id: 'c1' };
  const joined = rooms.join(fakeConn, { create: true, profile: { name: 'Ana', characterId: 'nova' } });
  check('creating a room seats the host', !joined.error && joined.player.isHost && joined.room.code === 'ABCD');
  check('joining with a bad code fails', rooms.join({ id: 'c9' }, { room: 'ZZZZ' }).error === 'no-room');
  const second = rooms.join({ id: 'c2' }, { room: 'ABCD', profile: { name: 'Bob' } });
  check('a second player joins as a guest', !second.error && !second.player.isHost);
  check('guests cannot start the race', rooms.start({ id: 'c2' }).error === 'not-host');
  check('the host starts the race', !rooms.start(fakeConn, { trackId: 'neon_cascade' }).error);
  check('late joiners are refused', rooms.join({ id: 'c3' }, { room: 'ABCD' }).error === 'started');
  check('invalid state samples are dropped', rooms.state({ id: 'c1' }, { pos: [NaN, 1, 2] }).error === 'bad-state');
  const ok = rooms.state({ id: 'c2' }, { pos: [1, 2, 3], yaw: 0.5, speed: 20, lap: 1, progress: 42 });
  check('valid state samples are accepted', !ok.error && ok.state.lap === 1);
  rooms.finish({ id: 'c2' }, { time: 61234, position: 1 });
  rooms.finish(fakeConn, { time: 64500, position: 2 });
  check('finishers are ordered by time', rooms.standings(rooms.get('ABCD'))[0].name === 'Bob');
  check('race ends when everyone finished', rooms.shouldEnd(rooms.get('ABCD')));
  check('profiles are sanitised', (() => {
    const p = sanitizeProfile({ name: 'bad\nname', characterId: 'x'.repeat(80) });
    return p.name === 'badname' && p.characterId.length === 32;
  })());
  check('profile ids survive a null payload', sanitizeProfile(null).name === 'Racer');
}

// ============================================ server: HTTP + WebSocket end to end
console.log('--- live server ---');
const dataDir = await mkdtemp(path.join(tmpdir(), 'sunforge-online-'));
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });

function waitForUrl(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const m = log.match(/http:\/\/localhost:(\d+)/);
      if (m) return resolve(Number(m[1]));
      if (child.exitCode !== null) return reject(new Error(`server exited\n${log}`));
      if (Date.now() - started > timeoutMs) return reject(new Error(`server never printed a URL\n${log}`));
      setTimeout(tick, 50);
    };
    tick();
  });
}

try {
  const port = await waitForUrl();
  const base = `http://127.0.0.1:${port}`;
  const api = `${base}/api`;
  const provider = new HttpProvider(api);

  const ping = await provider.ping();
  check('provider pings the server', ping.ok === true);
  check('ping reports latency', Number.isFinite(ping.latencyMs));

  const board = await provider.fetchLeaderboard('neon_cascade', 5);
  check('empty leaderboard is an array', Array.isArray(board) && board.length === 0);

  const submit = await provider.submitScore('neon_cascade', {
    name: 'Arena Test', time: 61321, ghost: [[0, 1, 0, 0], [1, 1, 0, 0], [2, 1, 0, 0]],
  });
  check('score submitted and ranked', submit.rank === 1);
  const board2 = await provider.fetchLeaderboard('neon_cascade', 5);
  check('score is on the board', board2.length === 1 && board2[0].name === 'Arena Test' && board2[0].time === 61321);

  const ghostRes = await fetch(`${api}/leaderboard/neon_cascade/ghost?rank=1`);
  const ghost = await ghostRes.json();
  check('ghost comes back over HTTP', ghostRes.status === 200 && ghost.frames.length === 3 && ghost.name === 'Arena Test');
  const missingGhost = await fetch(`${api}/leaderboard/unknown_track/ghost`);
  check('missing ghost -> 404', missingGhost.status === 404);

  const badSubmit = await fetch(`${api}/leaderboard/neon_cascade`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Cheat', time: -900 }),
  });
  check('invalid time -> 400', badSubmit.status === 400);
  const badJson = await fetch(`${api}/leaderboard/neon_cascade`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json',
  });
  check('malformed JSON -> 400', badJson.status === 400);

  const unranked = await provider.getRanked('Tester');
  check('unranked player has no points yet', unranked.points === null);
  const win = await provider.submitMatch('Tester', { won: true, trackId: 'neon_cascade' });
  check('ranked win adds points', win.points === STARTING_POINTS + win.delta && win.delta > 0);
  const loss = await provider.submitMatch('Tester', { won: false });
  check('ranked loss costs points', loss.delta < 0);
  const ranked = await provider.getRanked('Tester');
  check('standing is reported', ranked.points === loss.points && ranked.matches === 2 && ranked.wins === 1);
  check('rank is assigned', ranked.rank === 1);
  const ladderRes = await fetch(`${api}/ranked/ladder?limit=5`);
  const ladder = await ladderRes.json();
  check('ladder endpoint lists players', ladderRes.status === 200 && ladder.rows[0].name === 'Tester');

  const api404 = await fetch(`${api}/nope`);
  check('unknown API route -> 404 JSON', api404.status === 404 && (api404.headers.get('content-type') || '').includes('json'));
  const notAllowed = await fetch(`${api}/leaderboard/neon_cascade`, { method: 'DELETE' });
  check('wrong method -> 405', notAllowed.status === 405);
  const stillServed = await fetch(`${base}/`);
  check('static game still served alongside the API', stillServed.status === 200);

  // ---------------------------------------------------------- WebSocket relay
  console.log('--- netplay relay ---');
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const open = (url) => new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    sock.addEventListener('open', () => resolve(sock));
    sock.addEventListener('error', (e) => reject(new Error(`ws error: ${e.message || e.type}`)));
    setTimeout(() => reject(new Error('ws open timeout')), 4000);
  });
  const nextMessage = (sock, type) => new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg && msg.t === type) { sock.removeEventListener('message', onMsg); resolve(msg); }
    };
    sock.addEventListener('message', onMsg);
    setTimeout(() => { sock.removeEventListener('message', onMsg); reject(new Error(`no ${type} message`)); }, 4000);
  });

  const host = await open(wsUrl);
  const hostSays = (obj) => host.send(JSON.stringify(obj));
  hostSays({ t: 'join', create: true, profile: { name: 'Host', characterId: 'nova' }, trackId: 'sunforge_circuit', laps: 3 });
  const welcome = await nextMessage(host, 'welcome');
  check('host gets a welcome with a room code', !!welcome.room && welcome.host === true);
  check('welcome lists the host', welcome.players.length === 1 && welcome.players[0].name === 'Host');

  const guest = await open(wsUrl);
  const guestSays = (obj) => guest.send(JSON.stringify(obj));
  guestSays({ t: 'join', room: welcome.room, profile: { name: 'Guest', characterId: 'cinder' } });
  const guestWelcome = await nextMessage(guest, 'welcome');
  check('guest joins the same room', guestWelcome.room === welcome.room && guestWelcome.host === false);
  const playersMsg = await nextMessage(host, 'players');
  check('host is told about the new racer', playersMsg.players.length === 2);

  guestSays({ t: 'start' });
  const refused = await nextMessage(guest, 'error');
  check('only the host can start', refused.code === 'not-host');

  hostSays({ t: 'state', pos: [12.5, 1, -40], yaw: 1.2, speed: 22, lap: 1, progress: 140 });
  const stateMsg = await nextMessage(guest, 'state');
  check('state samples are relayed to peers', stateMsg.pos[0] === 12.5 && stateMsg.lap === 1);

  hostSays({ t: 'start', trackId: 'neon_cascade' });
  const started = await nextMessage(guest, 'started');
  check('start broadcast carries the track', started.trackId === 'neon_cascade' && started.laps === 3);

  guestSays({ t: 'finish', time: 60100, position: 1 });
  guestSays({ t: 'state', pos: [1, 0, 1], yaw: 0, speed: 0, lap: 3, progress: 900 });
  const finished = await nextMessage(host, 'finished');
  check('finish is broadcast with standings', finished.name === 'Guest' && finished.standings[0].name === 'Guest');
  hostSays({ t: 'finish', time: 61000, position: 2 });
  const over = await nextMessage(guest, 'over');
  check('race ends when everyone is in', Array.isArray(over.standings) && over.standings.length === 2);
  check('standings ordered by finishing time', over.standings[0].name === 'Guest' && over.standings[1].name === 'Host');

  const joinedLate = await open(wsUrl);
  joinedLate.send(JSON.stringify({ t: 'join', room: welcome.room, profile: { name: 'Late' } }));
  const lateErr = await nextMessage(joinedLate, 'error');
  check('a finished room refuses new racers', lateErr.code === 'started');
  host.close(); guest.close(); joinedLate.close();

  // the store persists on a short debounce, so give it a moment
  await new Promise((r) => setTimeout(r, 700));
  const saved = JSON.parse(await readFile(path.join(dataDir, 'online.json'), 'utf8'));
  check('scores are persisted to disk', saved.boards.some(([id]) => id === 'neon_cascade'));
  check('ranked ladder is persisted', saved.ranked.length > 0);
} catch (err) {
  failed++;
  console.log(`  FAIL live server test crashed: ${err.message}`);
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 200));
  await rm(dataDir, { recursive: true, force: true });
}

// ============================================================ client behaviour
console.log('--- client side ---');
{
  const snaps = [
    { t: 0, pos: [0, 0, 0], yaw: 0 },
    { t: 100, pos: [10, 0, 0], yaw: Math.PI / 2 },
  ];
  const mid = interpolate(snaps, 50);
  check('interpolation halves the position', Math.abs(mid.pos[0] - 5) < 1e-6);
  check('interpolation blends yaw', Math.abs(mid.yaw - Math.PI / 4) < 1e-6);
  check('before the buffer clamps to the oldest sample', interpolate(snaps, -50).pos[0] === 0);
  check('after the buffer clamps to the newest sample', interpolate(snaps, 500).pos[0] === 10);
  check('a single sample passes through', interpolate([snaps[0]], 999).pos[0] === 0);
  check('an empty buffer returns null', interpolate([], 0) === null);
  check('yaw takes the short way round', (() => {
    const y = interpolate([{ t: 0, pos: [0, 0, 0], yaw: 3.0 }, { t: 100, pos: [0, 0, 0], yaw: -3.0 }], 50).yaw;
    return Math.abs(Math.abs(y) - Math.PI) < 0.2;   // wraps through PI, not through 0
  })());
  check('interpolation delay is sensible', INTERP_DELAY_MS > 0 && INTERP_DELAY_MS < 300);
}

{
  const save = {
    data: {},
    get(k, d) { return this.data[k] ?? d; },
    set(k, v) { this.data[k] = v; },
  };
  const lb = new LocalLeaderboard(save);
  const service = new OnlineService({ leaderboard: lb, baseUrl: `http://127.0.0.1:1/api` });
  check('service starts on the local provider', service.provider instanceof LocalProvider && service.name === 'local');
  const probed = await service.probe();
  check('probe fails soft when no server is there', probed === false && service.online === false);
  check('offline submits still work locally', (await service.submitScore('t', { name: 'Solo', time: 70000 })).rank === 1);
  check('offline world ghost is null', (await service.fetchWorldGhost('t')) === null);
  check('offline ladder is empty', (await service.fetchLadder()).length === 0);
  check('service still reports a negative ping when offline', (await service.ping()).ok === false);
  const ranked = await service.submitMatch('Solo', { won: true });
  check('offline ranked still moves locally', ranked.points === 1025 && ranked.delta === 25);
  check('OnlineUnavailable is an Error subclass', new OnlineUnavailable('x') instanceof Error);
}

{
  const bad = new HttpProvider('http://127.0.0.1:1/api');
  let threw = false;
  try { await bad.fetchLeaderboard('x'); } catch (e) { threw = e instanceof OnlineUnavailable; }
  check('HttpProvider throws OnlineUnavailable on refused connections', threw);
  let statusThrew = false;
  try { await bad._req('/nope'); } catch (e) { statusThrew = e instanceof OnlineUnavailable; }
  check('HttpProvider throws on non-2xx too', statusThrew);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
