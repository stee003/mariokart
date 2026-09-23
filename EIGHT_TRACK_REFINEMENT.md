# Eight-track refinement

Scope confirmed: **Forge Line, Skyreach, Ruins of Vael, Sandstone Crown, Tempest Ridge, Glimmer Deep, Orbital Ring, Void Terminal**. The other eight tracks are unchanged.

## Driving and level design

Every road-width control point on these eight tracks is **2 world units wider** (approximately 8–18%). This changes the physical driving surface, racing line, grid, checkpoints and rendered road together, not just the appearance. Existing shortcuts gain 0.6 units of half-width and a midpoint reward pad. Vehicle handling, lap counts, difficulty tiers and checkpoint order are unchanged.

| Course | Layout refinements |
| --- | --- |
| Forge Line | Rounded the press-alley reversal to prevent folded inside shoulders; moved the ramp to the exit; offset and slowed alternating presses; separated the slider from the conveyor; added an exit boost. |
| Skyreach | Relaxed the middle transition and summit height; longer, wider, gentler island-hop ramps; recovery boost after the final hop; visible updraft entry/exit. |
| Ruins of Vael | Rounded the colonnade return and temple chicane; wider shortcut with reward; offset the rotating hazard and moved the last item row clear of it. |
| Sandstone Crown | Opened the bowl exit and infield thread without removing the technical section; gentler ramp; offset pendulum, slower slider and better-spaced item rows. |
| Tempest Ridge | Broadened the exposed ridge; moved the jump out of the crosswind; moderated both signed wind forces; moved item rows outside the wind sectors and added an exit boost. |
| Glimmer Deep | Softened the crystal chicane; longer spring ramps with more landing space; wider shortcut with reward; offset rotating hazard and added a post-gallery boost. |
| Orbital Ring | Expanded the outer sweep; aligned a wider, gentler ramp with low gravity; moved items away from the launch; added a post-low-gravity boost. |
| Void Terminal | Relaxed the docking chicane; wider rewarded shortcut; moved rotating machinery out of the low-gravity zone; offset and reduced the exhaust vent duty cycle; moved item rows away from hazards. |

## Art direction

`src/refinedEnvironment.js` opts in **by track ID**, not theme. Scenery is deterministic. Repeated objects use instancing, and scattered scenery rejects both main-road and shortcut envelopes.

- **Forge Line:** steel/copper works district, blast furnace and steam plume, clerestory-lit sheds, exhaust stacks, heat-exchanger tanks, service plinths, pipe bridges, press suspension cables and animated conveyor guides.
- **Skyreach:** road-bearing floating islands, moss-capped satellite isles, cloud sea, beacon island and lighthouse, ivory aqueduct portals, animated pennants and updraft halos.
- **Ruins of Vael:** green weathered sanctuary, celestial sundial, processional colonnade, broken capitals and foundations, laurel growth, temple vines and enclosed gallery.
- **Sandstone Crown:** warm stratified mesas, terraced amphitheatre seating, processional columns, stepped royal dais, crown monument, burgundy standards and drifting dust.
- **Tempest Ridge:** irregular escarpments and grounded bedrock, weather station and radar, animated wind turbines, directional windsocks and slanted rain. No full-screen lightning flashes in this new version.
- **Glimmer Deep:** enclosed cavern backdrop, irregular roof shelves and stalactites, turquoise/amethyst gardens, mineral pools, high geode gallery, slowly rotating heart crystal and resonance halo.
- **Orbital Ring:** suspended deck hull, transverse ribs and service pods, central habitat ring and radial trusses, solar arrays, communications dishes, navigation gates, a procedurally shaded planet and service shuttle.
- **Void Terminal:** violet-lit docking infrastructure, freight platforms and reinforced containers, stepped terminal core, transit aperture, asteroid belt, eclipsed moon and service shuttle.

All eight receive textured road surfaces, contrasting shoulders/curbs, running lights, delineators, approach-facing sector/turn signs, hazard warnings, shortcut studs and matching menu-preview palettes. Tunnels include camera colliders. Suspended tracks have shallow deck hulls rather than a ground plane. Track-owned lights isolate these palettes from legacy-world lights and restore the previous state on exit.

The environments contain **72–152 mesh nodes**, plus batched instances (approximately **829–1,423** per world). These are scene-complexity checks, not a hardware FPS guarantee. No new runtime dependencies or downloaded art/audio assets are required.

## Original music

`src/content/refinementMusic.js` supplies complete eight-bar arrangements on the existing opt-in extended sequencer. Each has its own melody, answering phrase, harmony, bass movement, tempo, instrument/filter profile and echo. Countdown, racing, final-lap acceleration and result transitions remain supported. Unrequested tracks retain their existing music and scheduling.

| Track | Score | BPM |
| --- | --- | --- |
| Forge Line | Copper and Clockwork | 136 |
| Skyreach | Sails Above the Sun | 128 |
| Ruins of Vael | Memory of the Sundial | 122 |
| Sandstone Crown | Procession of Gold | 132 |
| Tempest Ridge | Riders of the Front | 140 |
| Glimmer Deep | Prismatic Echoes | 118 |
| Orbital Ring | Blue Planet Velocity | 130 |
| Void Terminal | Last Departure | 134 |

## Verification

Run **`npm run test:all`**. The focused suite is also included in **`npm test`**, or run **`node test/refinement.test.mjs`** directly.

- All existing suites and new regressions pass.
- Four-kart, three-lap headless races finish on all eight courses.
- Exact +2 width checks, sampled minimum width, inside-shoulder curvature, nonadjacent road separation, ramp grade/fit, wind/jump separation and shortcut rewards.
- Finite animated geometry at multiple times, landmark presence, instance/mesh budgets, tunnel camera colliders, and lighting restoration.
- Raycasts through the driving corridor on main roads and shortcuts reject decorative scenery intrusions.
- Full score lengths, distinct answer phrases, finite frequencies in every dynamic state, scheduler wrap and safe transition back to legacy music.
- `test/fixtures/refinement-untouched-hashes.json` protects all eight unrequested definitions, including the earlier expedition tracks. The original expedition fixture is retained as history; its eight now-requested entries are superseded by this suite.
- Chromium/WebGL checks rendered all eight environments from above and at road level. The real menu → track selection → race → pause → menu lifecycle was exercised for all eight, followed by Verdant Loop. No JavaScript or shader errors were observed. The integration check used controlled frames, not a hardware performance benchmark.
- Chromium OfflineAudioContext rendered complete racing and final-lap arrangements for every track. Output was finite and non-clipping at the default music setting (observed peak below 0.09).

Browser tooling, rendered audio checks and scratch screenshots were kept outside the repository. The prior three-track pass remains documented in `TRACK_REFINEMENT.md`.
