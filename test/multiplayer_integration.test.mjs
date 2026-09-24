// End-to-end multiplayer start/synchronization regression at full capacity.
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const child = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', d => { logs += d; });
child.stderr.on('data', d => { logs += d; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const deadline = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = fn(); if (value) return value; await sleep(10); }
  throw new Error(`timeout\n${logs}`);
};
const inboxes = [];
const waitMessage = (index, predicate, ms = 10000) => deadline(() => {
  const at = inboxes[index].findIndex(predicate);
  return at < 0 ? null : inboxes[index].splice(at, 1)[0];
}, ms);

try {
  const port = await deadline(() => Number(logs.match(/localhost:(\d+)/)?.[1]) || 0);
  const clients = [];
  for (let i = 0; i < 8; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    inboxes[i] = [];
    ws.addEventListener('message', e => inboxes[i].push(JSON.parse(e.data)));
    await once(ws, 'open');
    clients.push(ws);
  }
  clients[0].send(JSON.stringify({ type: 'createLobby', name: 'capacity', maxPlayers: 8, playerName: 'P0' }));
  const created = await waitMessage(0, m => m.type === 'lobbyJoined');
  const lobbyId = created.lobby.id;
  for (let i = 1; i < 8; i++) {
    clients[i].send(JSON.stringify({ type: 'joinLobby', lobbyId, playerName: `P${i}` }));
    await waitMessage(i, m => m.type === 'lobbyJoined');
  }
  clients[0].send(JSON.stringify({ type: 'startRace' }));
  await Promise.all(clients.map((_, i) => waitMessage(i, m => m.type === 'countdown')));

  // Seven acknowledgements must not let a fast machine start without the last.
  for (let i = 0; i < 7; i++) clients[i].send(JSON.stringify({ type: 'raceReady' }));
  await sleep(250);
  const held = await waitMessage(0, m => m.type === 'snapshot' && m.state === 'countdown');
  if (held.countdown !== 3.5) throw new Error(`readiness barrier advanced early: ${held.countdown}`);

  clients[7].send(JSON.stringify({ type: 'raceReady' }));
  const starts = await Promise.all(clients.map((_, i) => waitMessage(i, m => m.type === 'raceStart', 7000)));
  if (starts.some(m => m.lobby.state !== 'racing')) throw new Error('inconsistent race-start state');

  // Every racer can publish a distinct pose and all peers receive one coherent snapshot.
  for (let i = 0; i < 8; i++) clients[i].send(JSON.stringify({
    type: 'input', x: i * 2, z: 10 + i, yaw: i / 10, speed: 5, lap: 0, checkpoint: -1, progress: i,
  }));
  const snap = await waitMessage(0, m => m.type === 'snapshot' && m.state === 'racing' && m.players.every(p => p.hasPose));
  if (snap.players.length !== 8 || new Set(snap.players.map(p => `${p.x},${p.z}`)).size !== 8) {
    throw new Error('full-capacity player state was not synchronized');
  }
  console.log('PASS full 8-player readiness barrier, race start, and pose synchronization');
  for (const ws of clients) ws.close();
} finally {
  child.kill('SIGTERM');
  if (child.exitCode === null) await once(child, 'exit');
}
