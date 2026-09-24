// ============================================================================
// Multiplayer player-synchronization suite.
//
// Regression target: local movement worked, but every OTHER player stayed
// frozen. Three separate defects caused it and each one is pinned here.
//
//   A. Snapshot timeline   - peers were teleported onto the newest snapshot
//                            (20 Hz steps) with no interpolation at all.
//   B. Kinematic peers     - remote karts are never stepped by the local
//                            physics, so their render pose was latched once
//                            and never refreshed: they never visibly moved.
//   C. Lobby silence       - the server only published snapshots while a race
//                            was running, so nobody could see anyone else
//                            before the start.
//
// Part A/B are pure unit tests, Part C/D boot the real server and drive real
// OnlineClients over WebSockets with several players at once.
// ============================================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapshotInterpolator, lerpAngle, shortestAngleDelta } from '../src/netSnapshots.js';
import { RemotePlayerSync } from '../src/remotePlayers.js';
import { OnlineClient } from '../src/onlineMultiplayer.js';
import { TrackManager } from '../src/track.js';
import { TRACK_DEFS } from '../src/content/trackDefs.js';
import { VehicleController } from '../src/vehicle.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
};

// ---------------------------------------------------------------------------
// Part A - snapshot timeline
// ---------------------------------------------------------------------------
console.log('--- Snapshot interpolation ---');
{
  const mkSnap = (t, players) => ({ type: 'snapshot', t, state: 'racing', players });
  const player = (id, x, z, yaw = 0, extra = {}) => ({ id, x, z, yaw, y: 0, speed: 10, hasPose: true, ...extra });

  let clock = 1000;
  const interp = new SnapshotInterpolator({ interpDelayMs: 100, now: () => clock });

  check('no snapshots yet -> no view', interp.sample() === null);

  // Server timeline: 50 ms apart, arriving instantly.
  interp.push(mkSnap(1000, [player('a', 0, 0)]), 1000);
  interp.push(mkSnap(1050, [player('a', 10, 0)]), 1050);
  interp.push(mkSnap(1100, [player('a', 20, 0)]), 1100);

  check('out-of-order frames are dropped', interp.push(mkSnap(1050, [player('a', 999, 999)]), 1101) === false);
  check('duplicate frames are dropped', interp.push(mkSnap(1100, [player('a', 999, 999)]), 1101) === false);

  // Render clock sits 100 ms behind the newest server time -> t = 1000.
  clock = 1100;
  let view = interp.sample();
  check('render clock trails the server by the interpolation delay',
    Math.abs(view.players[0].x - 0) < 1e-6, `x=${view.players[0].x}`);

  // Half a snapshot later the peer must be HALF way between the two states,
  // not sitting on either of them.
  clock = 1125;
  view = interp.sample();
  check('peers are interpolated between snapshots', Math.abs(view.players[0].x - 5) < 1e-6,
    `x=${view.players[0].x}`);
  check('interpolated flag is reported', view.interpolated === true);

  clock = 1150;
  view = interp.sample();
  check('interpolation reaches the next snapshot exactly',
    Math.abs(view.players[0].x - 10) < 1e-6, `x=${view.players[0].x}`);

  // Smoothness: sampling at 60 Hz over a 20 Hz feed must never jump.
  const smooth = new SnapshotInterpolator({ interpDelayMs: 100, now: () => clock });
  let serverT = 0;
  let sx = 0;
  clock = 0;
  for (let i = 0; i < 6; i++) { smooth.push(mkSnap(serverT, [player('a', sx, 0)]), clock); serverT += 50; sx += 10; clock += 50; }
  let prevX = null;
  let maxJump = 0;
  let minJump = Infinity;
  for (let f = 0; f < 60; f++) {
    clock += 1000 / 60;
    if (clock >= serverT) { smooth.push(mkSnap(serverT, [player('a', sx, 0)]), clock); serverT += 50; sx += 10; }
    const p = smooth.sample().players[0];
    if (prevX !== null) {
      const jump = p.x - prevX;
      maxJump = Math.max(maxJump, jump);
      minJump = Math.min(minJump, jump);
    }
    prevX = p.x;
  }
  // 10 m per 50 ms = 200 m/s -> 3.33 m per 60 Hz frame. A teleporting renderer
  // shows 0 for two frames and 10 on the third.
  check('60 Hz sampling of a 20 Hz feed never teleports', maxJump < 5, `maxJump=${maxJump.toFixed(2)}`);
  check('60 Hz sampling never stalls', minJump > 0.5, `minJump=${minJump.toFixed(2)}`);

  // Yaw takes the short way round the wrap point.
  check('yaw interpolation wraps the short way',
    Math.abs(shortestAngleDelta(3.0, -3.0) - 0.28318) < 1e-3, String(shortestAngleDelta(3.0, -3.0)));
  const wrapped = lerpAngle(3.0, -3.0, 0.5);
  check('yaw midpoint crosses PI instead of 0', Math.abs(Math.abs(wrapped) - 3.14159) < 1e-3, String(wrapped));

  const yawInterp = new SnapshotInterpolator({ interpDelayMs: 0, now: () => clock });
  clock = 0;
  yawInterp.push(mkSnap(0, [player('a', 0, 0, 3.0)]), 0);
  yawInterp.push(mkSnap(100, [player('a', 0, 0, -3.0)]), 100);
  clock = 50;
  const yawView = yawInterp.sample();
  check('snapshot yaw blending wraps correctly',
    Math.abs(Math.abs(yawView.players[0].yaw) - 3.14159) < 1e-2, String(yawView.players[0].yaw));

  // Starved buffer: peers coast forward instead of freezing, but only briefly.
  // 1 m per 50 ms tick == 20 m/s, a realistic kart speed.
  const starve = new SnapshotInterpolator({ interpDelayMs: 100, maxExtrapolationMs: 160, now: () => clock });
  clock = 0;
  starve.push(mkSnap(0, [player('a', 0, 0, 0, { speed: 20 })]), 0);
  starve.push(mkSnap(50, [player('a', 0, 1, 0, { speed: 20 })]), 50);
  clock = 400; // 250 ms of silence
  const coasted = starve.sample();
  check('a late snapshot makes peers coast, not freeze', coasted.players[0].z > 1,
    `z=${coasted.players[0].z}`);
  check('coasting is capped', coasted.extrapolatedMs <= 160 && coasted.players[0].z <= 1 + 20 * 0.161,
    `z=${coasted.players[0].z} ahead=${coasted.extrapolatedMs}`);

  // Roster changes propagate through the interpolated view.
  const roster = new SnapshotInterpolator({ interpDelayMs: 50, now: () => clock });
  clock = 0;
  roster.push(mkSnap(0, [player('a', 0, 0), player('b', 5, 5)]), 0);
  roster.push(mkSnap(50, [player('a', 1, 0), player('b', 6, 5), player('c', 9, 9)]), 50);
  roster.push(mkSnap(100, [player('a', 2, 0), player('c', 9, 9)]), 100);
  clock = 100;
  const rosterView = roster.sample();
  const ids = rosterView.players.map(p => p.id).sort().join(',');
  check('joiners appear in the interpolated view', ids.includes('c'), ids);
  check('leavers disappear from the interpolated view', !ids.includes('b'), ids);
}

// ---------------------------------------------------------------------------
// Part B - peers are real karts that actually move
// ---------------------------------------------------------------------------
console.log('--- Remote kart replication ---');
{
  const track = new TrackManager(TRACK_DEFS[0]);
  const disposed = [];
  const sync = new RemotePlayerSync({
    track,
    localId: 'me',
    createEntry: (p) => ({ vehicle: new VehicleController(track, false), info: p }),
    disposeEntry: (entry) => disposed.push(entry.id),
  });

  const grid = track.startGrid(4);
  const roster = [
    { id: 'me', name: 'Me', slot: 0 },
    { id: 'p1', name: 'Rival', slot: 1 },
    { id: 'p2', name: 'Other', slot: 2 },
  ];
  const { added } = sync.syncRoster(roster);
  check('a kart is built for every peer', sync.size === 2, `size=${sync.size}`);
  check('the local player is never replicated', !sync.has('me'));
  check('roster sync reports the new peers', added.length === 2);

  const peer = sync.get('p1');
  peer.vehicle.place(grid[1]);
  const start = { x: peer.vehicle.pos.x, z: peer.vehicle.pos.z };

  // No pose published yet -> the peer holds its grid slot.
  sync.step(1 / 60, [{ id: 'p1', hasPose: false, x: 0, z: 0, yaw: 0 }]);
  check('peers without a pose keep their grid slot',
    Math.hypot(peer.vehicle.pos.x - start.x, peer.vehicle.pos.z - start.z) < 1e-6);

  // THE regression: renderers latch a pose only when stepId advances.
  const beforeStep = peer.vehicle.stepId;
  sync.step(1 / 60, [{ id: 'p1', hasPose: true, x: start.x + 1, z: start.z + 1, yaw: 0.2, speed: 12 }]);
  check('stepping a peer advances its render step id', peer.vehicle.stepId > beforeStep,
    `${beforeStep} -> ${peer.vehicle.stepId}`);

  // A peer driving a straight line: follow it for a second and make sure the
  // kart tracks the authoritative pose closely and never jumps.
  let tx = start.x;
  let tz = start.z;
  let maxFrameJump = 0;
  let moved = 0;
  let prev = { x: peer.vehicle.pos.x, z: peer.vehicle.pos.z };
  for (let f = 0; f < 120; f++) {
    tx += 0.12; tz += 0.2;
    sync.step(1 / 60, [{
      id: 'p1', hasPose: true, x: tx, z: tz, yaw: 0.5, speed: 14,
      drift: true, driftLevel: 2, boost: true, airborne: false, steer: 0.4,
    }]);
    const jump = Math.hypot(peer.vehicle.pos.x - prev.x, peer.vehicle.pos.z - prev.z);
    maxFrameJump = Math.max(maxFrameJump, jump);
    moved += jump;
    prev = { x: peer.vehicle.pos.x, z: peer.vehicle.pos.z };
  }
  const err = Math.hypot(peer.vehicle.pos.x - tx, peer.vehicle.pos.z - tz);
  check('a moving peer is actually moved locally', moved > 20, `moved=${moved.toFixed(2)}`);
  // A follower that merely eases towards the target lags by speed/rate (half a
  // metre at racing speed); following the authoritative delta removes that.
  check('a moving peer tracks its authoritative pose without lag', err < 0.05, `err=${err.toFixed(4)}`);
  check('peer motion is smooth (no teleporting)', maxFrameJump < 1, `maxJump=${maxFrameJump.toFixed(3)}`);
  check('peer yaw is replicated', Math.abs(peer.vehicle.yaw - 0.5) < 1e-2, String(peer.vehicle.yaw));
  check('peer speed is replicated', Math.abs(peer.vehicle.fSpeed - 14) < 1e-6, String(peer.vehicle.fSpeed));
  check('peer drift state is replicated', peer.vehicle.drift.drifting && peer.vehicle.drift.level === 2);
  check('peer boost state is replicated', peer.vehicle.boost.boosting === true);
  check('peer steering is replicated', Math.abs(peer.vehicle.steer - 0.4) < 1e-6);
  check('peer rides the track surface', Math.abs(peer.vehicle.pos.y - (peer.vehicle.surf?.y ?? 0)) < 0.6,
    `y=${peer.vehicle.pos.y} surf=${peer.vehicle.surf?.y}`);

  // Boost/drift release must clear again.
  sync.step(1 / 60, [{ id: 'p1', hasPose: true, x: tx, z: tz, yaw: 0.5, speed: 14, drift: false, boost: false, airborne: true }]);
  check('drift/boost clear when the peer stops', !peer.vehicle.drift.drifting && !peer.vehicle.boost.boosting);
  check('airborne state is replicated', peer.vehicle.grounded === false);

  // A respawn (huge correction) snaps instead of sliding across the map.
  sync.step(1 / 60, [{ id: 'p1', hasPose: true, x: tx + 80, z: tz - 60, yaw: 1.2, speed: 0 }]);
  check('a respawn-sized correction snaps',
    Math.hypot(peer.vehicle.pos.x - (tx + 80), peer.vehicle.pos.z - (tz - 60)) < 1e-6);

  // Leavers are torn down.
  sync.syncRoster([{ id: 'me' }, { id: 'p1' }]);
  check('a peer that left loses its kart', sync.size === 1 && !sync.has('p2'));
  check('teardown hook runs for the leaver', disposed.includes('p2'), disposed.join(','));
}

// ---------------------------------------------------------------------------
// Part C + D - live server, several real clients
// ---------------------------------------------------------------------------
console.log('--- Live multi-client synchronization ---');

const child = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', d => { logs += d; });
child.stderr.on('data', d => { logs += d; });

const until = async (fn, ms = 8000, label = 'condition') => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(10);
  }
  throw new Error(`timeout waiting for ${label}\n${logs}`);
};

try {
  const port = await until(() => Number(logs.match(/localhost:(\d+)/)?.[1]) || 0, 8000, 'server port');
  const url = `ws://127.0.0.1:${port}/ws`;

  const NAMES = ['Ada', 'Grace', 'Linus', 'Hedy'];
  const clients = NAMES.map((name, i) => {
    const c = new OnlineClient({ onEvent: () => {}, onError: () => {} });
    c.serverUrl = url;
    c.playerName = name;
    c.color = 0x1000 * (i + 1);
    return c;
  });
  for (const c of clients) await c.connect();

  const lobby = await clients[0].createLobby({ name: 'sync', trackId: 'sunforge_circuit', maxPlayers: 8, playerName: NAMES[0] });
  for (let i = 1; i < clients.length; i++) await clients[i].joinLobby(lobby.id, NAMES[i]);

  // ---- requirement 1: everybody sees everybody in the lobby -----------------
  await until(() => clients.every(c => (c.lastSnapshot?.players?.length || 0) === clients.length),
    6000, 'lobby snapshots listing all players');
  check('every client receives lobby snapshots with all connected players',
    clients.every(c => c.lastSnapshot.players.length === 4
      && NAMES.every(n => c.lastSnapshot.players.some(p => p.name === n))));
  check('lobby snapshots carry each player start slot',
    clients[0].lastSnapshot.players.every(p => Number.isInteger(p.slot))
    && new Set(clients[0].lastSnapshot.players.map(p => p.slot)).size === 4);

  // Poses published while still in the lobby are replicated to the others.
  clients[1].sendInput({ pos: { x: 12, y: 1, z: -7, yaw: 0.9, speed: 3 }, motion: { drift: true, driftLevel: 1 }, force: true });
  const peerView = await until(() => {
    const p = clients[2].lastSnapshot?.players?.find(pl => pl.id === clients[1].playerId);
    return p && p.hasPose && Math.abs(p.x - 12) < 1e-6 ? p : null;
  }, 6000, 'lobby pose replication');
  check('lobby poses replicate to other clients',
    Math.abs(peerView.z + 7) < 1e-6 && Math.abs(peerView.yaw - 0.9) < 1e-6, JSON.stringify(peerView));
  check('lobby movement state replicates', peerView.drift === true && peerView.driftLevel === 1);

  // ---- start the race ------------------------------------------------------
  clients[0].startRace();
  await until(() => clients.every(c => c.status === 'countdown' || c.status === 'racing'), 6000, 'countdown');
  for (const c of clients) c.raceReady();
  await until(() => clients.every(c => c.lastSnapshot?.state === 'racing'), 8000, 'race start');
  check('all four clients reach the racing phase', clients.every(c => c.lastSnapshot.state === 'racing'));

  // ---- requirement 2/3/4: real-time movement replication -------------------
  // Each client "drives" for a second, publishing 20 Hz pose updates. Every
  // other client must see that motion arriving continuously.
  const t0 = Date.now();
  const drive = (elapsed) => clients.forEach((c, i) => {
    c.sendInput({
      pos: { x: 10 * i + elapsed * 6, y: 0.5, z: 4 * i - elapsed * 9, yaw: 0.2 * i + elapsed, speed: 11 + i },
      motion: { steer: 0.25, drift: i === 1, driftLevel: i === 1 ? 3 : 0, boost: i === 2, airborne: i === 3 },
      lap: 0, checkpoint: -1, progress: elapsed * 6, finished: false,
      force: true,
    });
  });

  // Warm-up: the jump from "parked on the grid" to the first published racing
  // pose is legitimate, so let the feed settle before judging continuity.
  while (Date.now() - t0 < 400) { drive((Date.now() - t0) / 1000); await sleep(50); }

  const before = clients.map(c => c.snapshotsReceived);
  const samples = clients.map(() => new Map()); // viewer -> peerId -> poses
  const tMeasure = Date.now();
  while (Date.now() - tMeasure < 1200) {
    drive((Date.now() - t0) / 1000);
    await sleep(50);
    // sample what each client currently renders for its peers
    clients.forEach((c, vi) => {
      const view = c.sampleRemoteStates();
      if (!view) return;
      for (const p of view.players) {
        if (p.id === c.playerId) continue;
        if (!samples[vi].has(p.id)) samples[vi].set(p.id, []);
        samples[vi].get(p.id).push({ x: p.x, z: p.z, yaw: p.yaw, speed: p.speed, drift: p.drift, boost: p.boost, airborne: p.airborne });
      }
    });
  }

  const rates = clients.map((c, i) => (c.snapshotsReceived - before[i]) / ((Date.now() - tMeasure) / 1000));
  check('snapshots keep flowing at ~20 Hz to every client', rates.every(r => r > 12),
    rates.map(r => r.toFixed(1)).join(','));

  let everyoneMoves = true;
  let smooth = true;
  let peersSeen = Infinity;
  let worstJump = 0;
  clients.forEach((c, vi) => {
    peersSeen = Math.min(peersSeen, samples[vi].size);
    for (const [, trace] of samples[vi]) {
      const dx = trace[trace.length - 1].x - trace[0].x;
      const dz = trace[trace.length - 1].z - trace[0].z;
      if (Math.hypot(dx, dz) < 3) everyoneMoves = false;
      for (let i = 1; i < trace.length; i++) {
        const jump = Math.hypot(trace[i].x - trace[i - 1].x, trace[i].z - trace[i - 1].z);
        worstJump = Math.max(worstJump, jump);
        // 50 ms of travel at ~11 m/s is ~0.55 m; a stale/teleporting feed
        // alternates between 0 and several metres.
        if (jump > 2) smooth = false;
      }
    }
  });
  console.log(`  ..... measured: ${rates.map(r => r.toFixed(1)).join('/')} snapshots per second, worst render step ${worstJump.toFixed(2)} m`);
  check('every client sees all three peers', peersSeen === 3, `min peers=${peersSeen}`);
  check('every peer is observed moving in real time', everyoneMoves);
  check('observed peer motion is continuous, never teleporting', smooth, `worst=${worstJump.toFixed(2)}m`);

  const observer = clients[0];
  const finalView = observer.sampleRemoteStates();
  const drifter = finalView.players.find(p => p.id === clients[1].playerId);
  const booster = finalView.players.find(p => p.id === clients[2].playerId);
  const flyer = finalView.players.find(p => p.id === clients[3].playerId);
  check('drift state survives the round trip', drifter.drift === true && drifter.driftLevel === 3);
  check('boost state survives the round trip', booster.boost === true);
  check('airborne state survives the round trip', flyer.airborne === true);
  check('rotation survives the round trip', Math.abs(drifter.yaw) > 0.2, String(drifter.yaw));
  check('speed survives the round trip', booster.speed > 10, String(booster.speed));

  // ---- requirement 5/6: the local kart never replicates onto itself --------
  check('a client never receives itself as a remote peer',
    clients.every(c => !c.sampleRemoteStates().players.filter(p => p.id === c.playerId).some(p => p.id === undefined)));

  // ---- Part D: drive real karts from the real feed -------------------------
  const track = new TrackManager(TRACK_DEFS[0]);
  const viewer = clients[0];
  const sync = new RemotePlayerSync({
    track,
    localId: viewer.playerId,
    createEntry: () => ({ vehicle: new VehicleController(track, false) }),
  });
  sync.syncRoster(viewer.lastSnapshot.players);
  check('the viewer builds a kart for each of its three peers', sync.size === 3, `size=${sync.size}`);

  // Warm-up frames: the very first authoritative pose legitimately snaps a
  // freshly built kart onto the track.
  const warm = Date.now();
  while (Date.now() - warm < 200) {
    drive((Date.now() - t0) / 1000);
    const view = viewer.sampleRemoteStates();
    if (view) sync.step(1 / 60, view.players);
    await sleep(16);
  }

  const travelled = new Map();
  const stepIds = new Map();
  for (const [id, entry] of sync.entries) {
    travelled.set(id, 0);
    stepIds.set(id, entry.vehicle.stepId);
    entry._last = { x: entry.vehicle.pos.x, z: entry.vehicle.pos.z };
  }
  let renderJump = 0;
  const t1 = Date.now();
  while (Date.now() - t1 < 800) {
    drive((Date.now() - t0) / 1000);
    // one render frame worth of fixed steps
    for (let k = 0; k < 3; k++) {
      const view = viewer.sampleRemoteStates();
      if (view) sync.step(1 / 60, view.players);
    }
    for (const [id, entry] of sync.entries) {
      const d = Math.hypot(entry.vehicle.pos.x - entry._last.x, entry.vehicle.pos.z - entry._last.z);
      renderJump = Math.max(renderJump, d);
      travelled.set(id, travelled.get(id) + d);
      entry._last = { x: entry.vehicle.pos.x, z: entry.vehicle.pos.z };
    }
    await sleep(16);
  }
  check('every peer kart advanced its render step id',
    [...sync.entries].every(([id, e]) => e.vehicle.stepId > stepIds.get(id)));
  check('every peer kart physically moved on the viewer',
    [...travelled.values()].every(d => d > 2), [...travelled.values()].map(d => d.toFixed(2)).join(','));
  // 16 ms of render time at ~12 m/s is ~0.2 m; three fixed steps per loop
  // gives some slack, but nothing close to a teleport.
  check('peer karts moved without teleporting', renderJump < 1.5, `worst=${renderJump.toFixed(2)}m`);

  // ---- Part E: three real karts, real physics, real replication -----------
  // The closest thing to two browsers side by side: every client runs its own
  // VehicleController at 60 Hz, publishes at the normal (throttled) rate, and
  // replicates its peers through RemotePlayerSync. Each peer kart must follow
  // the path its owner actually drove, only slightly behind.
  console.log('--- Peer fidelity with real physics ---');
  {
    const NAMES2 = ['Ada2', 'Grace2', 'Linus2'];
    const peers = [];
    for (let i = 0; i < NAMES2.length; i++) {
      const client = new OnlineClient({ onEvent: () => {}, onError: () => {} });
      client.serverUrl = url;
      client.playerName = NAMES2[i];
      await client.connect();
      peers.push({ client, name: NAMES2[i], history: [] });
    }
    const lobby2 = await peers[0].client.createLobby({ name: 'fidelity', trackId: 'sunforge_circuit', maxPlayers: 8, playerName: NAMES2[0] });
    for (let i = 1; i < peers.length; i++) await peers[i].client.joinLobby(lobby2.id, NAMES2[i]);
    await until(() => peers.every(p => (p.client.lastSnapshot?.players?.length || 0) === peers.length), 6000, 'second lobby');

    const worldTrack = new TrackManager(TRACK_DEFS[0]);
    const grid = worldTrack.startGrid(peers.length);
    peers.forEach((p, i) => {
      p.vehicle = new VehicleController(worldTrack, true);
      p.vehicle.place(grid[i]);
      p.sync = new RemotePlayerSync({
        track: worldTrack,
        localId: p.client.playerId,
        createEntry: () => ({ vehicle: new VehicleController(worldTrack, false) }),
      });
    });

    peers[0].client.startRace();
    await until(() => peers.every(p => p.client.status === 'countdown' || p.client.status === 'racing'), 6000, 'second countdown');
    for (const p of peers) p.client.raceReady();
    await until(() => peers.every(p => p.client.lastSnapshot?.state === 'racing'), 8000, 'second race start');
    for (const p of peers) p.sync.syncRoster(p.client.lastSnapshot.players);

    const t2 = Date.now();
    while (Date.now() - t2 < 2000) {
      const elapsed = (Date.now() - t2) / 1000;
      for (let i = 0; i < peers.length; i++) {
        const p = peers[i];
        // each kart drives a slightly different line
        const input = { throttle: 1, brake: 0, steer: Math.sin(elapsed * 1.5 + i) * 0.6, drift: false, trick: false };
        p.vehicle.step(1 / 60, input, false);
        p.history.push({ t: Date.now(), x: p.vehicle.pos.x, z: p.vehicle.pos.z });
        p.client.sendInput({
          input,
          pos: { x: p.vehicle.pos.x, y: p.vehicle.y, z: p.vehicle.pos.z, yaw: p.vehicle.yaw, speed: p.vehicle.fSpeed },
          motion: { steer: p.vehicle.steer, drift: p.vehicle.drift.drifting, driftLevel: p.vehicle.drift.level, boost: p.vehicle.boost.boosting, airborne: !p.vehicle.grounded },
          lap: 0, checkpoint: -1, progress: p.vehicle.surf?.progress || 0, finished: false,
        });
        const view = p.client.sampleRemoteStates();
        if (view) p.sync.step(1 / 60, view.players);
      }
      await sleep(16);
    }

    const ownDistance = peers.map(p => Math.hypot(
      p.history[p.history.length - 1].x - p.history[0].x,
      p.history[p.history.length - 1].z - p.history[0].z));
    check('every kart actually drove somewhere', ownDistance.every(d => d > 10),
      ownDistance.map(d => d.toFixed(1)).join(','));

    let worstOffPath = 0;
    let worstLagMs = 0;
    let allFollow = true;
    for (const viewer of peers) {
      for (const target of peers) {
        if (target === viewer) continue;
        const entry = viewer.sync.get(target.client.playerId);
        if (!entry) { allFollow = false; continue; }
        // Closest point of the owner's real trajectory to where the viewer
        // renders it: small distance == the peer follows the true path.
        let best = Infinity;
        let bestT = 0;
        for (const h of target.history) {
          const d = Math.hypot(entry.vehicle.pos.x - h.x, entry.vehicle.pos.z - h.z);
          if (d < best) { best = d; bestT = h.t; }
        }
        worstOffPath = Math.max(worstOffPath, best);
        worstLagMs = Math.max(worstLagMs, Date.now() - bestT);
      }
    }
    check('each client built a kart for both peers', allFollow && peers.every(p => p.sync.size === 2));
    check('peer karts follow the exact path their owner drove', worstOffPath < 1.0,
      `worst off-path=${worstOffPath.toFixed(2)}m`);
    check('replication lag stays well under a quarter second', worstLagMs < 300,
      `worst lag=${worstLagMs}ms`);
    console.log(`  ..... measured: worst off-path ${worstOffPath.toFixed(2)} m, worst lag ${worstLagMs} ms`);

    for (const p of peers) p.client.disconnect();
  }

  // ---- leaving removes the player everywhere -------------------------------
  const leaverId = clients[3].playerId;
  clients[3].leaveLobby();
  await until(() => !clients[0].lastSnapshot.players.some(p => p.id === leaverId), 6000, 'leaver removal');
  check('a player who leaves disappears from peer snapshots',
    !clients[0].lastSnapshot.players.some(p => p.id === leaverId));
  sync.syncRoster(clients[0].lastSnapshot.players);
  check('the leaver kart is torn down locally', !sync.has(leaverId) && sync.size === 2, `size=${sync.size}`);

  for (const c of clients) c.disconnect();
} catch (err) {
  failed++;
  console.log(`  FAIL live synchronization threw: ${err.message}`);
} finally {
  child.kill('SIGTERM');
  if (child.exitCode === null) await new Promise(r => child.once('exit', r));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
