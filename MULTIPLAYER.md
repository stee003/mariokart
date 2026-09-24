# Multiplayer infrastructure

The offline game remains the default. `src/multiplayer.js` contains the authoritative, dependency-free race core for a real-time service; `src/onlineMultiplayer.js` implements the live WebSocket client; `src/netSnapshots.js` buffers and interpolates server snapshots; `src/remotePlayers.js` turns those snapshots into moving karts; `server.mjs` is the zero-dependency production-ready server that serves the static game and the multiplayer API.

## Server contract (implemented)

`server.mjs` serves:
- `GET /` + static assets (same as original static server)
- `GET /api/health` → `{ ok, lobbies, maxPlayers, tickRate }`
- `GET /api/tracks` → list of 16 circuits + 4 arenas
- `GET /api/lobbies` → public lobby list
- `POST /api/lobbies` → create lobby `{ name, trackId, maxPlayers, playerName, color }`
- `GET /api/lobbies/:id` → lobby details
- `POST /api/lobbies/:id/join` → join
- `WS /ws` → real-time transport (primary)

WebSocket messages (client → server):
- `createLobby { name, trackId, maxPlayers, playerName, color }`
- `joinLobby { lobbyId, playerName, color }`
- `listLobbies`
- `leaveLobby`
- `toggleReady { ready }`
- `updateTrack { trackId }`
- `startRace`
- `chat { message }`
- `input { input, x, y, z, yaw, speed, steer, throttle, brake, drift, driftLevel, boost, boostLevel, airborne, lap, checkpoint, progress, finished, seq }` – published at the server tick rate (50 ms, `ONLINE_CONFIG.pollInterval`), coalesced so the freshest sample always wins
- `raceReady`
- `finish`
- `returnToLobby`

Server → client:
- `connected { playerId }`
- `lobbyJoined { lobby, playerId }`
- `lobbyUpdate { lobby }`
- `lobbyList { lobbies }`
- `countdown { value }`
- `raceStart { lobby }`
- `raceReadyUpdate { playerId }`
- `snapshot { t, tick, state, countdown, raceTime, trackId, laps, hostId, players, standings }`
- `raceFinished { standings }`
- `chat { from, message, t }`
- `error { message }`

Snapshot cadence: **20 Hz while a lobby is counting down or racing, 5 Hz while it is idle** (`LOBBY_SNAPSHOT_EVERY`). Idle lobbies still publish, so members always see who is connected — and where they are — before a race starts. An extra snapshot is pushed immediately on join/leave.

Each `players[]` entry replicates the full peer state:

| field | meaning |
| --- | --- |
| `x, y, z, yaw` | position + heading (y included so peers follow elevation) |
| `speed` | signed forward speed (reverse is legal) |
| `steer, throttle, brake` | control state, drives wheel/pilot animation |
| `drift, driftLevel, boost, boostLevel, airborne` | movement state: drift smoke, flames, air tuck |
| `lap, checkpoint, progress, finished, finishTime` | race progress |
| `slot` | authoritative start-grid index (every client builds the same grid) |
| `connected, ready, isHost, raceReady, hasPose` | lobby/session state |
| `seq` | last input sequence the server applied |

`t` is the server wall clock of the snapshot; clients interpolate on that timeline.

The client sends its pose + inputs. The server owns snapshots, checkpoints, laps, finish order, and scoring. The local player runs full VehicleController physics; remote karts are kinematic followers driven from snapshots.

## Lobby state machine

- `lobby`: players join, host can change track, toggle ready.
- `countdown`: 3.5 s server countdown, `countdown` messages.
- `racing`: 20 Hz tick, server tracks raceTime, standings computed from lap/checkpoint/progress.
- `finished`: `raceFinished` broadcast, stays until host returns to lobby.

Host migration: if host disconnects, first remaining player becomes host.

## Anti-cheat

`src/multiplayer.js` AntiCheat validates:
- speed ≤ 42 m/s, acceleration ≤ 55 m/s², teleport ≤ 18 m per tick
- checkpoint ordering
- lap jump ≤ 1
- item ownership + cooldown
- finish requires checkpointCount > 0 and lap ≥ expected.

Server applies same checks in `applySnapshot`. Repeated violations increment strikes (future: kick after N). Client never trusts remote positions for collision.

## Matchmaking

`Matchmaker` groups by mode and region, extended with `matchWithSkill` that respects rating gap. `Rating` provides original rank names (Rookie Spark → Nova Vanguard) and Elo delta. `ReportStore` preserves match ID, player ID, timestamp, reason, telemetry.

`leaderboardRows` handles global/regional/friends/weekly/seasonal views when service supplies scope.

## Peer synchronization (how other players move)

Three pieces cooperate; each fixes a failure mode that made peers look frozen.

1. **`SnapshotInterpolator` (`src/netSnapshots.js`)** – keeps ~2 s of snapshots on the *server* timeline, estimates the clock offset from the least-delayed packet, and samples `serverNow - 110 ms`. Every render frame therefore has two snapshots to blend, so 20 Hz data becomes continuous motion. Out-of-order/duplicate frames are dropped; if the next snapshot is late, peers coast on their measured velocity for at most 160 ms instead of freezing.
2. **`RemotePlayerSync` (`src/remotePlayers.js`)** – owns the peer karts. It builds a kart when a player appears in the roster and disposes it when they leave, then, **once per fixed physics step**, moves each peer:
   - follows the authoritative delta one-to-one (an ease-only follower lags by `speed / rate`, ≈0.5 m at racing speed), clamped to what the replicated speed can plausibly cover;
   - decays the leftover error (collisions, packet loss, clamped corrections) exponentially;
   - snaps on the first pose or a respawn-sized (>9 m) correction;
   - resolves ground height from the track surface and replicates drift/boost/airborne/steer;
   - **advances `vehicle.stepId`** — renderers latch a new pose only when that counter changes, so a peer that is never stepped is never drawn moving. This was the core reason remote players appeared frozen while local movement worked.
3. **`Game` (`src/main.js`)** – calls `_onlineStepRemotes(FIXED_DT)` inside the same fixed-timestep loop as the local physics (so `updateKartVisual` interpolates peers exactly like the local kart), publishes the local pose + movement state through `_onlineSendLocalState()`, and reconciles the roster from every snapshot. A local pause no longer pauses the online world: peers keep moving and the local pose keeps being published.

Start grid: the server assigns `slot` per player, so all clients place the same kart in the same box. Previously each client placed *itself* last and shuffled everyone else, so the first snapshot yanked the whole field across the line.

## Client integration (`src/main.js`)

- Mode `online` added to `appState` / `mode`
- `OnlineClient` (from `onlineMultiplayer.js`) manages WS, reconnection, message queue, 20-snapshot buffer, interpolation
- `RemoteKart` wraps VehicleController (isPlayer=false) + buildKart visuals
- UI: `screen-online` (browser: name, create, join by ID, lobby list with track/players/state) and `screen-onlinelobby` (player list with ready/host, track select, chat)
- Race flow: `_setupOnlineRaceKarts` disposes old visuals, creates local + remote karts, `startOnlineRace` sets `appState race`, HUD, camera snap, music countdown; `frame()` online branch sends input via `sendInput`, updates remote vehicles from snapshot, drives HUD from server standings, disables pause.
- Results: server standings shown, buttons override to `returnToLobby` (back to lobby) / `leaveLobby` (menu).

## Production transport checklist

- Authoritative simulation tick 20 Hz server, client physics 60 Hz fixed timestep, snapshots delta-compressed (full for now, future: delta).
- Input sequence + ack, interpolation of remote karts (yaw wrap).
- 30-second reconnect reservation (player slot kept, token in `reconnectToken`).
- Cosmetics kept out of vehicle parameters and ranked scoring (only bodyColor used for identification).
- HUD shows ping via `/api/health` latency, quality state.
- Exercise 20/50/100/150/200 ms latency and packet loss in staging; server throttles input to 100 ms, buffers 20 snapshots.

## Running locally

```
node server.mjs          # serves game on http://localhost:8000 + WS /ws
npm run dev              # same (alias)
```

Open two browsers to `http://localhost:8000`, go to Online → create lobby in one, join from the other. Chat, ready, start. No extra dependencies.

## Tests

```
npm run test:multiplayer   # protocol + synchronization suites
```

- `test/multiplayer_integration.test.mjs` – 8-player readiness barrier and race start.
- `test/multiplayer_sync.test.mjs` – snapshot interpolation (blending, yaw wrap, reordering, starvation), peer kart replication (motion, movement state, snap vs. ease, teardown), and a live server driving four real `OnlineClient`s: lobby visibility, ~20 Hz snapshot flow, continuous peer motion, plus three karts running real physics whose peers must follow the exact driven path (<1 m off-path, <300 ms behind).

Offline remains default: main menu → Grand Prix / Quick Race etc. works without server.
