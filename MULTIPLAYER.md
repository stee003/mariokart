# Multiplayer infrastructure

The offline game remains the default. `src/multiplayer.js` contains the authoritative, dependency-free race core for a real-time service; `src/onlineMultiplayer.js` implements the live WebSocket client; `server.mjs` is the zero-dependency production-ready server that serves the static game and the multiplayer API.

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
- `input { throttle, steer, brake, drift, item, x, z, yaw, speed, lap, checkpoint, progress, finished }` – throttled 100 ms client-side
- `finish`
- `returnToLobby`

Server → client:
- `connected { playerId }`
- `lobbyJoined { lobby, playerId }`
- `lobbyUpdate { lobby }`
- `lobbyList { lobbies }`
- `countdown { value }`
- `raceStart { trackId, standings }`
- `snapshot { state, countdown, raceTime, players, standings, t }` at 20 Hz
- `raceFinished { standings }`
- `chat { from, message, t }`
- `error { message }`

The client sends inputs only. The server owns snapshots, checkpoints, laps, finish order, and scoring. Renderers interpolate snapshots and predict only local movement. The local player runs full VehicleController physics; remote karts are kinematic followers updated from snapshots.

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

Offline remains default: main menu → Grand Prix / Quick Race etc. works without server.
