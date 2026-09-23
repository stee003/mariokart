# Sunforge Racers — Development Report

Started as a vertical slice (one pilot, one kart, one track). It is now a
complete original arcade kart racer: **14 pilots, 8 chassis, 12 wheel sets,
33 cosmetic parts, 16 tracks, 6 Grand Prix cups, 22 original power-ups, 4
battle arenas with 5 battle modes, time trials with ghosts, achievements,
progression, a garage, a records browser, and an online stack (leaderboards,
ranked seasons, world ghosts, live lobby relay)** — EN/IT throughout, zero
copy-pasted content, zero paid unlocks.

The sections below keep the original vertical-slice report (the foundation that
is still the core of the game: vehicle physics, drift, camera, race logic and
AI are unchanged by design) and then document each expansion increment.

## What was implemented (vertical slice, preserved)

| Requirement | Status |
|---|---|
| 1 original character (Ember the Dustfox) + 1 original kart (Dune Blazer MK-1) | ✅ |
| 1 complete original track — **Sunforge Circuit** (desert canyon, bridge, tunnel, ramps, boost pads, moving obstacles, shortcut) | ✅ |
| 3 AI opponents with distinct personalities (Cinder/aggressive, Zephyr/balanced, Bastion/defensive) | ✅ |
| Third-person camera: smoothing, dynamic FOV, shake, collision avoidance, adjustable distance/height | ✅ |
| Acceleration / steering / braking / reverse / traction / friction | ✅ |
| Drifting with 3 charge levels, cancel-without-boost, drift hop | ✅ |
| Boost system (drift boosts, boost pads, trick boosts, rocket starts) | ✅ |
| Jumps, ramps, air steering, aerial trick → mini boost, landing FX | ✅ |
| Kart-vs-kart + moving-obstacle collisions with push, sparks, destabilization | ✅ |
| Ordered checkpoints, laps, finish line, anti-cheat (no skipping, no reverse-finish) | ✅ |
| Race positions, wrong-way detection | ✅ |
| Race countdown 3-2-1-GO with timed rocket start | ✅ |
| HUD (position / lap / timer / speed / drift-charge meter / notifications) | ✅ |
| Results screen (position, total time, best lap, celebration) + restart + main menu | ✅ |
| EN/IT localization, live switching, persisted | ✅ |
| Fully procedural original audio (engine, drift, boost, collisions, countdown, finish…) | ✅ |
| Off-track slowdown + robust auto-reset recovery | ✅ |

Verified by automated tests: 41 unit checks, a headless full-race simulation
(4 AI karts complete 3 laps, winner ≈ 62 s/lap — inside the 60–120 s target),
and a boot smoke test that drives every system through a full race to the
results screen.

## Project structure

```
index.html                  canvas + HUD + menu DOM (no hardcoded strings)
css/style.css               original UI styling
lib/three.module.js         vendored Three.js r160
src/
  config.js                 ALL tuning values (vehicle, drift, boost, AI, camera…)
  main.js                   game bootstrap, app state machine, fixed-step loop
  track.js                  TrackManager: spline, surface queries, ramps, pads,
                            moving obstacles, checkpoints, shortcut, racing line
  environment.js            canyon scenery, tunnel, bridge, banner, obstacles
  vehicle.js                VehicleController (arcade physics)
  drift.js                  DriftSystem (state machine + charge)
  boost.js                  BoostSystem (drift/pad/trick/start boosts)
  ai.js                     AIController (racing line, personalities)
  camera.js                 CameraController (chase, FOV, shake, occlusion)
  race.js                   RaceManager + checkpoint/lap/position logic
  hud.js                    HUDManager (DOM HUD, menus, results)
  i18n.js                   LocalizationManager (EN/IT dictionary)
  audio.js                  AudioManager (100% synthesized WebAudio)
  particles.js              pooled particle systems (dust + additive sparks)
  input.js                  keyboard input
  save.js                   persisted settings (language, camera, volume)
test/
  logic.test.mjs            unit tests
  race_sim.test.mjs         headless full-race AI simulation
  boot_smoke.mjs            full boot-to-results smoke test
```

No god-object: each system owns one responsibility and communicates through
small interfaces (input structs, FX events, surface queries).

## Controls

Drive: **WASD / arrows** · Drift: **Shift** · Trick (air): **Space** ·
Reset: **R** · Pause: **Esc** · Restart on results: **Enter**.
Hold accelerate during the final countdown window for a **rocket start**.

## How the vehicle physics work

Deliberately arcade, tuned for instant response:

1. Velocity is decomposed each fixed step (60 Hz) into **forward** and
   **lateral** components relative to the kart's heading.
2. Engine force pushes forward speed toward `maxSpeed * boostSpeedMult`
   with a soft cap; braking converts to reverse below ~0.5 m/s.
3. **Traction** is an exponential decay on lateral velocity
   (`traction ≈ 8/s` → snap-grippy). Drifting drops it to ~26 %, letting the
   kart slide while the yaw model rotates the heading into the slide.
4. Yaw rate = steer × `steerRate` × low-speed factor × high-speed damping
   (× drift modifiers). Steering flips naturally in reverse.
5. Ground following: the kart snaps to the track surface (centerline spline
   + ramp overlays). Terrain that falls away faster than the kart can follow
   launches it airborne using the remembered **climb rate** — that is how
   ramps throw the kart. Airborne: reduced gravity (floaty), air steering,
   optional 360° trick.
6. Boundaries: shoulders slow you; deep off-road triggers a timed respawn at
   the last track point, with a short blink-freeze. Nothing can get stuck.

All numbers live in `src/config.js` (`CONFIG.vehicle`).

## How drifting works

`DriftSystem` is a small state machine fed by the vehicle:

- **Start**: hold Shift + steer while grounded above `minSpeed` → the kart
  hops (vertical impulse) and the drift direction locks to the initial steer.
- **While drifting**: reduced steering authority + an extra yaw term
  (`driftStrength`) rotates the kart into the slide; low lateral grip keeps
  the slide alive. Charge accrues at `chargeRate`.
- **Levels**: 0.9 s → L1 (teal smoke), 1.9 s → L2 (amber), 3.2 s → L3
  (magenta). Tire smoke color, HUD meter and tick sounds reflect the level.
- **Release**: letting go fires the matching boost (duration/speed/accel
  scale per level). Pressing brake cancels the drift **without** boosting.
- Drift survives the start hop and short airtime; real jumps drop the charge.

## How the AI works

No cheats — AI karts run the identical `VehicleController`. Each
`AIController`:

- follows the precomputed **racing line**: per-sample curvature →
  `targetSpeed = √(cornerLatAccel / curvature)`, run through backward
  braking passes so corners are always reachable; a small preferred lateral
  offset hugs the inside of corners;
- steers toward a speed-scaled look-ahead point, throttles/brakes against
  the minimum target speed over its braking horizon;
- drifts into sharp corners (eagerness per personality) and spends the
  charge like a boost on exit;
- avoids karts ahead, and defensive drivers **cover** the line of karts
  behind; makes occasional human mistakes (throttle lifts, wobbles);
- performs aerial tricks, and self-recovers via the same reset system if it
  leaves the track or gets wedged.

Personalities differ only in skill/style parameters (corner speed targets,
aggression, blocking, mistake rate, boost usage), never in raw speed.

## How localization works

`src/i18n.js` holds a single `{key: {en, it}}` dictionary — **no UI string
exists outside it**. `LocalizationManager.t(key, vars)` interpolates
`{placeholders}`. The DOM uses `data-i18n` attributes; on language change the
HUD re-renders itself live. The choice persists via `SaveManager`
(localStorage, with in-memory fallback). Settings → Language offers
English / Italiano.

## Known limitations (current)

- Tracks are pure data on one spline pipeline; there is no track editor.
- AI drivers follow the racing line and never take shortcuts (by design).
- Keyboard only; there is no gamepad/touch layer or rebinding UI yet.
- Blob shadows instead of shadow mapping (chosen for a stable 60 FPS).
- Audio and pilot "voices" are synthesized by design (no recorded assets).
- Netplay is a client-authoritative relay: remote karts are interpolated
  ghosts, so races are not collision-arbitrated between machines and there is
  no rollback. See Increment 9 for the exact contract.
- The online server stores state in a single JSON file; a real deployment
  would swap `OnlineStore` for a database (the API stays identical).

## What should be implemented next

1. Server-side ghost validation (re-simulate a submitted ghost before it is
   allowed on the leaderboard) and a moderation/ban list for names.
2. Rollback or server-authoritative netcode for full contact racing; the
   relay payload (`state` samples) is already the right shape for it.
3. Gamepad + touch controls, input rebinding UI.
4. Real-time shadows / baked AO pass and post-FX (bloom for boost pads).
5. Split-screen for local multiplayer.
6. Deeper progression: daily challenges and cosmetic-only rewards.

---

# Full-game expansion (in progress)

The vertical slice above is the preserved foundation. Expansion is being added
incrementally around it, each increment tested before the next begins.

## Increment 1 — Content framework (commit a477ae8)

- `src/content/stats.js` — 6-stat model (acceleration, top speed, handling,
  weight, drift control, off-road), budget 34 per character, soft-cap balance.
- `src/content/characters.js` — 14 original characters, no Pareto-domination.
- `src/content/chassis.js` (8 chassis), `src/content/wheels.js` (12 wheel
  types), `src/content/cosmetics.js` (paints/decals/exhausts/effects) — all
  with meaningful, non-dominated trade-offs.
- `src/content/loadout.js` — loadout → physics params + visuals pipeline.
- Vehicle physics now consumes per-kart params and mods; procedural
  character/kart meshes. 35 balance/content tests.

## Increment 2 — Power-up system (commit c89f95a)

- `src/content/items.js` — 22 original power-ups (Flux Bolt, Gravity Anchor,
  Mirage Clone, Pulse Ring, Overdrive Core, Vortex Mine, Phase Shield, Time
  Ripple, Magnet Surge, Repair Drone, +12 more) with distinct mechanics,
  counters, weights, colors and icons. No Mario Kart copies.
- `src/items.js` — headless-safe runtime: boxes, held items, projectiles,
  zones, statuses, homing beacons; `src/itemMesh.js` — icons/meshes.
- Wired into race flow, AI decision-making, HUD slot, procedural audio,
  settings toggle. 38 item tests + full-race integration.

## Increment 3 — Track pipeline & themed worlds (commit e97ce57)

- `src/content/trackDefs.js` — SUNFORGE_DEF (bit-identical to the slice) +
  15 new tracks across 12 themes; each track teaches a different skill and
  has its own mechanic (wind lanes, low gravity, currents, pendulums,
  flame jets, moving gears/sliders, shortcuts, alt routes).
- `src/track.js` — def-driven TrackManager; zones surface as vehicle FX
  (wind, gravity, grip, push); legacy accessors preserved so the original
  environment renderer keeps working untouched.
- `src/environment2.js` — 12 themed environment kits (desert, forest,
  neon city, mountains, volcano, underwater, factory, floating isles,
  ruins, storm world, crystal caves, space station) with tunnels,
  bridges, canyons and environmental storytelling props.
- Tests: 48 track tests (incl. arc-length parity with the slice) + 56
  environment tests (colliders, kits, tunnels, obstacles).

## Increment 4 — Music, Grand Prix cups & time trials (this commit)

- `src/music.js` — MusicManager with a lookahead scheduler; `buildTheme(seed,
  theme)` deterministically generates scale/tempo/bass/lead/drive per track,
  so all 16 tracks get distinct original music. Dynamic states: menu,
  countdown, racing, final lap (tempo up), battle, victory/defeat stingers.
- `src/content/cups.js` — 6 cups (Ember, Gear, Neon, Storm, Crown, Sunforge
  Championship) covering all 16 tracks; original scoring: 15-11-8-6-5-4-3-2
  finish points +2 fastest lap, +1 lap-1 leader; trophies over 4 races
  (platinum/gold/silver/bronze); progressive unlock chain (gold-gated final).
- `src/grandprix.js` — pure-logic cup session state machine.
- `src/ghost.js` + `src/timetriial.js` — ghost recorder/player with
  interpolation, time-trial session, RecordsStore (best total, best lap,
  splits, ghost persisted per track).
- `src/main.js` — mode routing (Quick Race / Grand Prix / Time Trial),
  mode-select + track-select + cup-select screens, GP standings/trophy and
  TT record UIs, ghost playback visuals, music lifecycle, music volume
  setting. Time trials race solo with items off.
- Tests: 40 mode tests + boot smoke now simulates a full 4-race cup and a
  solo time trial with ghost capture/replay.

## Increment 5a — Systems (commit 4c7aaa1)

- `src/aiDifficulty.js` — six AI tiers (Beginner → Master) that scale
  *decision quality only*: mistake rate, braking lookahead, corner-entry
  judgement (can only ever brake earlier, never go faster), drift/boost
  skill, item-use skill, rocket starts. No tier touches top speed.
- `src/progression.js` — XP curve, levels, level-based unlocks derived from
  content declarations (no pay-to-win). `src/achievements.js` — 16
  achievements over persistent stat counters.
- `src/leaderboard.js` — per-track local top-10. `src/online.js` — provider
  contract with LocalProvider (offline default) and HttpProvider (REST
  contract + ranked seasons), ready for a backend.
- Custom quick races (laps / rivals / difficulty in Settings), XP/level/
  unlock/achievement toasts, leaderboard submissions, stat tracking.

## Increment 5b — Battle arenas (this commit)

- `src/content/arenas.js` — 4 arenas (Ember Forge, Cryo Hall, Neon Plaza,
  Sky Atoll) built as wide disc-shaped loops through the untouched track
  pipeline and themed renderer, with arena walls, obstacles, item boxes and
  a low-gravity arena.
- `src/battle.js` — BattleManager with five original modes: Energy Rush
  (collect cores), Elimination (HP, last standing), Zone Control (capture
  rings), Survival (HP decays), Score Battle (hit/KO points).
- `src/main.js` — battle mode select (mode + arena), fixed-step battle
  loop (vehicles, AI, items, obstacle damage), battle HUD chip, KO/capture
  notifications, battle results with progression awards.
- Tests: 27 battle-logic checks + 29 arena checks (build, drivability,
  containment, real-geometry zones).

## Increment 6 — Garage, pilot select and live loadouts

- `src/garage.js` — the customization model: seven pages (pilot, chassis,
  wheels, paint, decal, exhaust, effect), unlock gating for default/level/cup/
  achievement unlocks, attribute deltas against what is currently equipped,
  a derived **performance preview** (km/h top speed, 0-100 s, cornering, grip,
  off-road speed, drift charge time, mass), randomize/reset, and persistence
  under the save key `loadout`.
- `src/kartPreview.js` — a rotating showroom: its own WebGL canvas, the same
  `buildKartFromLoadout` mesh and the same `updateKartVisual` /
  `animateCharacter` code the race uses, drag-to-rotate, wheel zoom, and a
  pilot close-up focus mode.
- `src/ui/garageUI.js` — the DOM layer. Every string comes from the
  localization dictionary (the purity test walks the rendered tree).
- `src/roster.js` + `src/content/rivals.js` — the grid is now built from real
  pilots: the player drives their garage build, each rival drives that
  character's signature loadout with its own physics params, personality and
  silhouette. The player entry keeps the `ai.you` name key so Grand Prix
  scoring, records and results are unchanged.
- `src/config.js` — three more AI personalities (speedster, technical,
  wildcard) alongside the original three, all bound by the same rule:
  `targetSpeed <= 1.0`, no difficulty or personality ever grants speed.
- Tests: 71 garage checks, including a measured proof that a top-speed build
  really is faster (full-throttle run down the racing line) while the heavier
  build still covers comparable ground, plus dynamic unlock resolution checks
  against the live content tables.

## Increment 7 — Records, achievements and leaderboard browser

- `src/ui/recordsUI.js` + a records screen: per-track records with medals,
  ghost availability, the local top-10 board, all achievements with progress,
  lifetime statistics and progression (level, XP to next).
- The board is served through the same provider contract the online features
  use, so it shows remote results when a server is attached and falls back to
  local records with an honest "source: local" note when it is not.
- 35 new localized strings; the localization purity walker covers the screen.

## Increment 8 — Battle polish: arena AI, capture-zone visuals, live scoreboard

- `src/itemAI.js` — the item-usage heuristic extracted from the racing AI so
  racing and battle drivers make item decisions through one code path.
  Skill scales *when* an item is used, never what the roulette grants.
- `src/battleAI.js` — arena drivers with tactical objectives instead of a
  racing line: `chooseObjective()` is a pure function (energy cores, hunting
  the weakest kart, fleeing in survival, capturing/defending/holding zones,
  crate economics). Pure tactics means the whole layer is unit-testable and
  deterministic under a seeded RNG.
- Objective-aware driving: an arrival curve so a driver parks on a capture ring
  instead of orbiting out of range, wall-avoidance blending near the arena
  edge, obstacle dodging and the same stuck-recovery the racing AI uses.
- `src/battleFX.js` — capture-zone geometry (fill disc, owner-coloured ring,
  pulsing halo). `zoneVisualState()` maps battle state to colour/fill/pulse as
  a pure function.
- Live arena scoreboard in the HUD (HP bars / cores / points per kart) and a
  zone counter for Zone Control.
- Mode balance fixes found by headless simulation: Energy Rush's goal now
  scales to a ~60 s round with six karts (was over in ~30 s), and Survival's
  decay drains to the last HP point instead of eliminating everyone on a
  timer, so the mode is decided by hits as designed.
- Character vocalizations: every pilot's voice profile is finally used -
  wordless synthesized reactions (start, boost, hit, hype, win, lose) with
  distance falloff, so a crowded grid does not turn into noise.
- Tests: 25 arena-AI checks (objective choice per mode, deterministic headless
  arenas that actually bank cores / capture rings / land hits, no illegal
  input, no speed cheats, containment) + the existing 27 battle-logic checks.

## Increment 9 — Online stack: API, ranked seasons, world ghosts, netplay relay

The client contract that existed since Increment 5 (`src/online.js`) now has a
real backend, all of it zero-dependency and inside `server.mjs`:

- `src/net/store.js` — the data + rules layer: time-trial boards (top 25 with
  optional ghosts), monthly ranked seasons with Elo-style deltas
  (`K=32`, floor 5, unknown opponents treated as ladder average), ladder
  pruning, JSON persistence with atomic writes, and sanitisation of every
  client-supplied field (names, times, ghost frames).
- `src/net/api.js` — the HTTP API behind `/api/*`:
  `GET /ping`, `GET|POST /leaderboard/:trackId`, `GET /leaderboard/:trackId/ghost?rank=N`,
  `GET /ranked/season?player=`, `GET /ranked/ladder`, `POST /ranked/match`,
  `GET /rooms`, `GET /stats`. Small bodies, per-IP write budget, no CORS
  wildcard, no stack traces to clients.
- `src/net/ws.js` — a minimal RFC 6455 WebSocket server (handshake, masked
  frames, ping/pong, close, 64 KB payload cap) so the game needs no npm
  packages.
- `src/net/rooms.js` + `src/net/relay.js` — lobbies (8 racers, host-started,
  look-alike-free room codes) and the message protocol: join, state samples at
  ~20 Hz with a flood guard, start, finish, and server-decided standings.
- `src/netplay.js` — the browser side: `NetSession` (connect/join/send/
  receive) and `interpolate()`, which renders remote karts ~120 ms in the past
  from snapshots. Remote karts are visual-only, so packet loss degrades into a
  laggy ghost instead of a desync.
- `src/ui/onlineUI.js` + online screen — server status and latency, ranked
  standing (season, rank, points, W/L), ladder, world-ghost download (which
  feeds the existing `GhostPlayer` in time trial), racer tag, and the lobby
  (create/join, roster, host start). Offline, the screen says so and the game
  keeps using local records: `OnlineService` probes `/api/ping` and switches
  providers at runtime.
- Tests: 96 online checks - store rules, Elo maths, the API over real HTTP
  through `HttpProvider`, the relay with two real WebSocket clients
  (lobby -> start -> finish -> standings), persistence to disk, and the
  offline fallback paths.

## Fixed along the way (regression guards)

Building Increment 9 exposed that the game entry point had been broken since
the previous commit and no test noticed, because every suite imported *modules*
and none imported the game:

- `src/main.js` had a duplicated tail fragment - a syntax error that stopped
  the game booting in any browser.
- `src/main.js` also used `Garage`, `GarageUI`, `RecordsUI`, `KartPreview`,
  `buildRaceRoster`, `buildLoadout`, `buildKartFromLoadout` and `getCharacter`
  without importing them, so the garage/records increment could never run.
- The main-menu buttons for Garage and Records were never bound to their
  screens.

Three new guards make that class of failure impossible to ship again:
`test/syntax.test.mjs` (parses every shipped file, checks that every button in
index.html is wired, that every `data-i18n` key resolves, and that every key
referenced in code exists), `test/entry.test.mjs` (boots the real entry point
against a fake WebGL context and a stub DOM, then verifies the DOM contract and
the menu wiring), and the `test/garage.test.mjs` physics measurement fix (the
"faster build" check now measures a full-throttle run instead of an AI lap,
which was line-limited and could not tell builds apart).
