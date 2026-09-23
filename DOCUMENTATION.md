# Sunforge Racers — Technical Documentation

Complete reference for the release build. For a quick overview see
[README.md](README.md); for the online-service contract see
[MULTIPLAYER.md](MULTIPLAYER.md); [DEVELOPMENT_REPORT.md](DEVELOPMENT_REPORT.md)
keeps the incremental build history.

---

## 1. Architecture

Zero-build ES modules (`type="module"`), one vendored dependency
(`lib/three.module.js`, Three.js r16x). The game boots from `index.html` →
`src/main.js`, which constructs every subsystem and owns the app state machine:

```
index.html ──▶ Game (src/main.js)
                 ├─ three renderer / scene / camera
                 ├─ CameraController        camera.js     chase + collision + FOV/shake scaling
                 ├─ TrackManager            track.js      spline → samples → surface queries
                 ├─ VehicleController ×N    vehicle.js    arcade kart physics (fixed step 1/60)
                 ├─ AIController (rivals)   ai.js         input generator, no speed cheats
                 ├─ RaceManager             race.js       laps, checkpoints, positions, results
                 ├─ ItemSystem              items.js      pickups, projectiles, hazards, states
                 ├─ GrandPrixManager        grandprix.js  cups, points, trophies
                 ├─ BattleManager           battle.js     arena balloons + score
                 ├─ TimeTrial               timetrial.js  records, ghosts (serializeGhost)
                 ├─ Hud                     hud.js        DOM HUD, screens, minimap
                 ├─ AudioManager/Music      audio.js      WebAudio synth SFX + music
                 ├─ InputManager            input.js      keyboard remap + gamepad
                 ├─ LocalizationManager     i18n.js       EN/IT dictionaries
                 ├─ SaveManager             save.js       localStorage, atomic writes
                 └─ ParticlePool            particles.js  fixed-size pools
```

Main loop (`src/main.js`): fixed-timestep physics at 60 Hz with an accumulator
(max 4 steps/frame, slow frames degrade gracefully), render at display rate.
Adaptive resolution lowers `renderer.setPixelRatio` when average frame time
exceeds the budget and restores it when headroom returns.

State machine: `menu` → mode select (`quick | grandprix | timetrial |
battle`) → `countdown` → `racing` → `results` (→ next cup race or menu).
`pause` overlays `racing`. A boot error handler (`?debug=1` enables the FPS
overlay and verbose logging) keeps releases quiet by default.

Module conventions:
- Content lives in `src/content/*` as pure data (`trackDefs.js`, `arenas.js`,
  `characters.js`, `cups.js`, `items.js`, `chassis.js`, `wheels.js`,
  `cosmetics.js`, `stats.js`, `strings.js`).
- Display names are **i18n keys** (`nameKey`, `descKey`, `flavorKey`,
  `teachKey`, `mechanicKey`, `noteKey`, `titleKey`…) resolved via
  `i18n.t(key)`; baked content objects (`buyLoadoutToBlueprint()` in
  `src/content/loadout.js`) replace them with raw `{ en, it }` tables for
  ghost/record round-trips.
- Geometry/track filtering shared by sim and tests lives in
  `TrackManager.create(def, filters)` — never subclass the manager.
- Merge helpers (stat merge, loadout merge) always return **fresh** objects;
  they never mutate the caller's state.

### src/ tree

| File | Responsibility |
|---|---|
| `config.js` | Every tunable: physics, drift, boost, items, AI, camera, recovery, UI |
| `main.js` | Game state machine, screen wiring, garage/settings UI, adaptive AA |
| `race.js` | Race rules: countdown, checkpoints, laps, positions, wrong way, results |
| `vehicle.js` | Kart physics step, vertical/road model, recovery reset, fx flags |
| `track.js` | Spline sampling, `_nearest` (deck lock + leg hysteresis), canonical surface/ramps/shortcut |
| `terrainMesh.js` | Visible ramp decks, shoulders and lips sampled from the canonical collision profile |
| `ai.js` + `aiDifficulty.js` | Racing-line pursuit, drift/item use, recovery, 6 tiers |
| `items.js`, `itemMesh.js` | 22 power-ups: rolls, projectiles, traps, shells/banas |
| `boost.js`, `drift.js` | Boost pipeline, drift charge states + palettes |
| `camera.js` | Chase cam, tractability shake (`shakeScale`), FOV (`fovScale`), colliders |
| `characterMesh.js`, `kartMesh.js` | Procedural kart/pilot meshes + loadout paints |
| `environment.js`, `environment2.js` | Per-theme procedural scenery + colliders |
| `particles.js` | Smoke, sparks, confetti (fixed pools, density scaled by `reducedFx`) |
| `audio.js`, `music.js` | WebAudio synthesized SFX/music (no external assets) |
| `i18n.js`, `content/strings.js` | EN/IT dictionaries with fallbacks + overflow QA |
| `save.js` | Atomic localStorage with self-heal on corruption |
| `ghost.js`, `timetrial.js` | Ghost capture at 30 Hz, records table, playback |
| `grandprix.js`, `battle.js` | Cup scoring/trophies; arena balloons/score/knockouts |
| `progression.js`, `achievements.js` | Unlocks (level/cup/achievement), achievement defs |
| `multiplayer.js`, `multiplayerClient.js`, `online.js`, `leaderboard.js` | Headless authoritative core + HTTP transport + records board |

---

## 2. Controls

### Keyboard (default map — every action is remappable in Settings → Controls)

| Action | Default keys |
|---|---|
| Accelerate | `W` / `↑` |
| Brake / reverse | `S` / `↓` |
| Steer | `A` `D` / `←` `→` |
| Drift (hold) | `Shift` |
| Aerial trick | `Space` |
| Use item | `E` / `F` |
| Reset to track | `R` |
| Pause | `Esc` |
| Confirm | `Enter` |

Rocket start: hold accelerate as the countdown ends (the HUD arm ring shows
the window). Drift cancel: tap brake while drifting.

### Gamepad (W3C standard mapping — Xbox / PlayStation / Switch-Pro)

| Action | Pad |
|---|---|
| Throttle | RT (analog) |
| Brake / reverse | LT (analog) |
| Steer | Left stick / d-pad (18% dead zone) |
| Drift | X or LB (hold) |
| Trick / confirm | A |
| Use item | Y |
| Reset | B |
| Pause | START |

Keyboard and pad are merged every frame (`InputManager.poll()` + `snapshot()`);
analog values win over digital. Menus respond to stick/d-pad + confirm.
Remapping only rebinds keyboard codes; pad bindings are fixed by convention.
Rebind conflicts are resolved by stealing the key from the other action, and
`Esc` cancels a pending capture. Bindings persist in the save (`keys` map).

---

## 3. Game systems

### Modes
- **Quick Race** — any unlocked track, rival count and difficulty picked in the
  menu; 3 laps (configurable per track).
- **Grand Prix** — 6 cups × 4 tracks, points 10/8/6/5 across 4 karts (→ 40 max
  in a cup), trophy thresholds at 60/48/36/24 (Platinum→Bronze, see
  `content/cups.js` `TROPHY_TIERS`; per-cup variant at the same scale).
- **Time Trial** — solo, records per track/difficulty, best-lap ghost replay
  (`best.ghost` captured at 30 Hz, compressed via `serializeGhost()`), with
  per-lap splits and date stamps kept alongside the fastest total.
- **Battle** — 4 arenas (ember_forge, cryo_hall, neon_plaza, sky_atoll), balloon
  battle scoring, items-only combat, elimination + timer.

### Race flow
Countdown (3s, grid slots from `TrackManager.startGrid()`) → racing → results.
Checkpoints (ordered gates with width) guard lap validity and sparse route
locks rescue placement (`vehicle.doReset` drops the kart on the nearest
checkpoint with a short grace). Wrong-way is detected from travel direction vs
surface tangent; the HUD flags the player, AI self-rescues after 1.6 s.

### Items (22)
Box pickups roll a position-weighted item (leaders get defensive kit, trailers
get rockets/apex bands). Projectiles use the same surface queries as karts,
hazards stick to the road spline with on-half given team-marble priorities,
targeted items (ether eels, ogre onions) home on specific rivals. Full defs in
`src/content/items.js`, balance in `config.js → items`.

### Difficulty
Six tiers (`beginner → master` in `aiDifficulty.js`): mistake rate, lookahead,
corner-speed decision scale, recovery, boost usage. **No speed cheats:** AI
karts run identical physics and the same `maxSpeed`; QA sims assert observed
top speed < `CONFIG.vehicle.maxSpeed × 1.55` on all 16 tracks × tiers.

---

## 4. Vehicle physics (`src/vehicle.js`, tuned via `config.js → vehicle`)

- State: planar velocity + heading; yaw from steer × `steerRate` with speed
  factor (builds to `steerRefSpeed`, damps past it toward `maxSpeed`), drift
  steer multiplier, boost steer retention.
- Traction: longitudinal engine/brake forces with a grip ellipse; lateral
  friction bleeds sideways velocity (styled oversteer while drifting).
- Vertical: `surface()` returns ground height and its longitudinal/lateral
  gradient at the kart. Grounded karts follow it with distance/rate-bounded
  lift and drop budgets, so seams never catapult the kart; falling ⇢ airborne
  with slightly floaty gravity (`air.gravity 16.5`). Air-steer authority scales
  down with speed loss; tricks need ≥ 0.12 s air.
- `TrackManager.rampSurfaceAt()` is the single ramp profile for contact height,
  collision gradient, rendered deck/shoulders/lip and shadow placement. Ramp
  launch speed projects that gradient onto the kart's actual velocity, so a
  diagonal shoulder crossing cannot receive a full centre-deck jump.
- Ramp launches reuse the smoothed `climbRate` history (≤ 14 m/s); non-ramp
  lip pops are capped so crests stay playful instead of orbital. In flight the
  visual pitch follows the integrated vertical velocity; position, attitude,
  pilot reaction and suspension are fixed-step interpolated together.
- Recovery: off-track beyond shoulders for `recovery.offTrackLimit`, outside
  `hardLimitLateral`, fallen below surface, or stuck (`stuckTime` at low speed
  with throttle) → rescue reset to last checkpoint with i-frames.

`TrackManager._nearest` matches kart → spline sample with a ±12-sample hint
window, a continuous saturating altitude cost (multi-level tracks prefer the
deck nearest the kart's altitude without a hard-band flip), and leg-cross
hysteresis: it falls back to a full scan only when the kart is provably off
the local road, and only adopts a different arc when it is inside another
segment's road **and** aligned with the kart's velocity (prevents
chicane/hairpin leg theft).

---

## 5. Drift mechanics (`src/drift.js`)

Hold **drift** while steering past `drift.minSpeed`:

1. Kart enters drift, steering widens (`drift.steerMult`),
   smoke/FX from the rear wheels (palette = `driftColors(colorblind)`).
2. Charge builds while drifting: **L1 blue → L2 amber → L3 violet** sparks;
   time per level in `config.drift.charge*`.
3. Release: boost fires, length & strength per level
   (`boost.trigger(level - 1)`), brief grip restore.

Tricks (Space in the air ≥ 0.12 s) complete a flip; landing cashes a mini
boost. Boost pads on track call `boost.pad()`; item rockets call
`boost.trigger`. All boosts share one pipeline so stacking is controlled.
Drift-cancel with brake; drift drops below `minSpeed` end the charge.

---

## 6. AI behavior (`src/ai.js`)

- **Pursuit:** lookahead `8 + speed·0.36` (personality-scaled), capped by
  curvature so pursuit targets stay on the near arc through hairpins.
- **Speed plan:** horizon scan of `lineAt(s+d).targetSpeed`, personality
  `cornerSpeed × targetSpeed` scale, rolling-speed floor on gentle sections,
  full-throttle recovery when off course.
- **Traffic:** side-by-side avoidance offset, mild blocking by defensive
  personalities, aggression-weighted passing.
- **Combat:** position-aware item use (rockets when behind, traps when ahead),
  drift eagerness per personality; difficulty scales mistakes/lookahead only.
- **Recovery:** off-road timer, stuck timer, wrong-way detector →
  `doReset('ai-recover')`; airborne steering is damped so long drops can't
  spin the kart. Personalities: `aggressive | balanced | defensive`
  (`config.js → ai.personalities`).

---

## 7. Localization (`src/i18n.js` + `src/content/strings.js`)

- Dictionaries `{ en, it }`; `i18n.t(key, params)` interpolates `{name}`-style
  placeholders; missing keys fall back to EN, then to the raw key.
- All UI strings are dictionaries (60 `data-i18n` hooks in `index.html` plus
  programmatic `t()`); language switch is live (no reload) and re-renders
  dynamic lists.
- QA: `test/i18n.test.mjs` — key coverage vs dictionary, EN/IT parity,
  placeholder arity, missing/extra keys, and Italian length-overflow
  heuristics against the CSS box budget.

---

## 8. Save data (`src/save.js`)

One localStorage blob (`sunforge.save.v1`), atomic write (temp key + swap),
JSON validation at load with per-field defaults: **corrupt data self-heals**
instead of wiping (`[save]` console warnings only).

| Key | Shape | Notes |
|---|---|---|
| `version` | number | schema version for future migrations |
| `lang` | `'en' \| 'it'` | |
| `sfxVolume`, `musicVolume` | 0–100 | |
| `camDist`, `camHeight` | numbers | camera offsets |
| `uiScale` | 80–130 | CSS `body[data-uiscale]` scaling |
| `reducedFx`, `colorblind` | bools | a11y: shake/FOV scale-down, particle density; palettes |
| `keys` | `{action: code}` | custom keyboard remaps |
| `records` | nested best times per track/tier | records sit in the nested tiebucket: `records.<track>.<difficulty>.best = { total, lap, lapSplits, items, date, ghost }` |
| `ghosts` | per-record compressed ghost packs | `serializeGhost()` float-array `@ 30 Hz` |
| `unlocks` / `level` / `achievements` | progression | see `progression.js` |
| `loadout` | `{ pilot, paint, chassis, wheels, trail }` | garage selection, stock-parity defaults |

---

## 9. Customization & progression (garage)

Garage (`btn-garage` on the main menu) edits the loadout: **pilot** (14
characters incl. unlockables), **paint** (incl. finish variants),
**chassis/body**, **wheels**, **trail** — each entry carries stat deltas from
`content/stats.js`; the summary bar shows the effective kart stats. The player
kart races exactly this loadout (`main.js` "The player drives the loadout
configured in the garage").

Unlock sources: level thresholds (`unlock.level`), cup trophies
(`unlock.cupId`), achievements (`unlock.achievementId`,
`achievements.js` — e.g. `night_shift`, `collector`). Locked rows show the
requirement (`garage.lockedLevel` / cup / generic). Grand Prix cups feed
trophies; achievements check after every race; unknown/corrupt loadout ids
fall back to stock (and are covered by self-heal tests).

---

## 10. Multiplayer notes

Ships **offline-first**; `src/multiplayer.js` exposes the authoritative
race core (checkpoints, laps, items, scoring, anti-cheat envelopes,
matchmaker, rating, reports) and `multiplayerClient.js` a polling HTTP
transport, so a backend can be attached without touching driving code.
The service contract, latency targets (30 Hz sim, delta snapshots, 30 s
reconnect) and production checklist are documented in
[MULTIPLAYER.md](MULTIPLAYER.md).

---

## 11. Build, deployment & server setup

No build step. Requirements: Node ≥ 18 (any static server works too).

```bash
node server.mjs          # http://localhost:8000 (default)
node server.mjs 8080     # explicit port (cross-platform)
PORT=8080 npm start      # env override (bash / cmd)
```

`server.mjs` is a dependency-free static file server (2 kLOC-high URI guard,
MIME map, method check); it serves `index.html`, `src/`, `css/`, `lib/`.
Deployment: copy the folder behind any static host (nginx, S3+CDN, GitHub
Pages). Audio starts on first user gesture (browser autoplay policy); WebGL2
is required (fallback message otherwise).

CI / release gate:

```bash
npm test          # fast: logic + server + content + items + modes + systems + battle
npm run test:all  # full: + arenas, tracks, env, race_sim, boot smoke, i18n,
                  #       save/input, ui_nav, and the 180-scenario QA matrix
```

The QA matrix (`test/qa_matrix.test.mjs`) is seeded (deterministic LCG per
track×tier) and simulates every track with a full 4-kart AI field at
beginner + master (plus the flagship at easy/normal/hard/expert), asserting:
all karts finish, bounded rescues, no stuck states, no NaN, and no
above-envelope speeds (anti-rubber-banding proof).

---

## 12. Troubleshooting

| Symptom | Check |
|---|---|
| Black screen / no 3D | WebGL2 support (`about:support` / `chrome://gpu`); the boot error banner shows the failing module |
| No audio | Autoplay policy — click/tap once; check Settings → volume sliders; `sfxVolume/musicVolume` persist |
| Gamepad ignored | Press a button so the browser pairs it (`gamepadconnected`); only standard-mapping pads are matched; remap affects keyboard only |
| Keys not responding mid-race | Another app may hold focus; `blur` clears stuck keys. Re-sync via Settings → Controls → reset |
| Low FPS | Automatic: adaptive resolution steps pixel ratio down/up with frame-time history. Manual: reduce window size; `?debug=1` shows the FPS overlay |
| Save seems reset | Values are self-healing; a corrupted field is dropped (see `[save]` warnings), never the whole blob. localStorage blocked (private mode) → save disabled silently |
| Ghosts missing | Ghosts persist with the record; make sure Time Trial actually finished (records are written on finish) |
| `npm test` fails on a fresh clone | Node ≥ 18; tests are plain Node scripts (`node test/*.test.mjs`), no install needed |

For anything AI/physics oddity, run the deterministic repro:
`node test/qa_matrix.test.mjs` — it pins the exact scenario seeds.
