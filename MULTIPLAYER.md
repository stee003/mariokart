# Multiplayer infrastructure

The offline game remains the default. `src/multiplayer.js` contains the authoritative, dependency-free race core for a real-time service; `src/multiplayerClient.js` is an HTTP/polling transport that can be swapped for WebSocket/WebTransport without changing driving code.

## Server contract

A service should expose `POST /api/multiplayer/races`, `POST /api/multiplayer/races/:id/input`, `GET /api/multiplayer/races/:id/snapshot`, and `POST /api/multiplayer/races/:id/reconnect`. The client sends inputs only. The server owns snapshots, checkpoints, laps, items, finish order, and scoring. Renderers interpolate snapshots and predict only local movement.

`AuthoritativeRace` supports casual, Grand Prix, private, ranked, and battle mode identifiers, 2–12 player rooms, reconnect slots, ordered checkpoints, lap validation, finish validation, and sanitized inputs. `AntiCheat` validates speed, acceleration, teleport distance, checkpoints, items, and completion. Repeated violations should be logged and acted on by the service rather than banning immediately.

`Matchmaker` groups by mode and region and is intended to be extended with ping, skill, party size, and connection quality scores. `Rating` provides original rank names and a server-side result delta. `ReportStore` preserves match ID, player ID, timestamp, reason, and telemetry. `leaderboardRows` handles global, regional, friends, weekly, and seasonal result views when the service supplies the relevant scope.

## Production transport checklist

- Run the authoritative simulation at 30 Hz and send delta-compressed snapshots.
- Sequence inputs, acknowledge the latest sequence, and interpolate remote karts.
- Use a 30-second reconnect reservation and restore the last acknowledged snapshot.
- Keep cosmetics out of vehicle parameters and ranked scoring.
- Record server region, RTT, packet loss, and quality state in the HUD.
- Exercise 20/50/100/150/200 ms latency and packet loss in staging.
