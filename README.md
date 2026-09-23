# Sunforge Racers 🏜️

An **original** 3D arcade kart racer for the browser — zero copyrighted
assets, one vendored dependency (Three.js), no build step. Hand-rolled arcade
physics, a full race loop, and complete meta-game: garage cosmetics, cups and
trophies, time-trial ghosts, battle arenas, achievements and EN/IT
localization.

**16 tracks · 6 cups · 4 modes · 4 battle arenas · 14 pilots · 22 items ·
EN 🇬🇧 / IT 🇮🇹**

## Play

```bash
node server.mjs            # serves on http://localhost:8000
```

`npm start` runs a tiny zero-dependency Node static server (`server.mjs`), so
it works the same on Windows, macOS and Linux — no Python required.

Different port: `node server.mjs 8080` (cross-platform), or `PORT=8080
npm start` in bash / `set PORT=8080 && npm start` in Windows `cmd`.
(Any static server works too — just serve the folder and open `index.html`.)

No installation is required: the only dependency, Three.js, is vendored in
`lib/`.

## Game modes

- **Quick Race** — pick any track, tune rivals and difficulty (6 tiers:
  beginner → master).
- **Grand Prix** — 6 cups of 4 tracks, championship points and Platinum →
  Bronze trophies.
- **Time Trial** — chase your own best; best-lap ghosts save and replay.
- **Battle** — balloon battle in 4 dedicated arenas.

Race flow: countdown (rocket start!) → 3 laps → results → restart. Rescue
respawns, wrong-way warnings, checkpoints — all the expected racing rules.

## Controls

| Key | Action |
|---|---|
| W / ↑ | Accelerate (hold during the final countdown window for a rocket start) |
| S / ↓ | Brake / reverse |
| A D / ← → | Steer |
| Shift | Drift — hold while steering to charge L1→L3 boosts; brake taps cancel |
| Space | Aerial trick (land it for a mini boost) |
| E / F | Use item |
| R | Reset to track |
| Esc | Pause |
| Enter | Confirm / restart (on the results screen) |

**Gamepad** (Xbox/PS/Switch-Pro standard mapping): RT throttle · LT brake ·
left stick steer · X/LB drift · A trick/confirm · Y item · B reset · START
pause. Keyboard bindings are fully **remappable** in Settings → Controls and
persist across sessions.

## Accessibility

Settings → Accessibility: UI scale (80–130 %), reduced-effects mode
(scaled-down camera shake/FOV, thinner particles), colorblind-safe boost/flag
palettes, camera distance/height sliders, camera-shake scaling, key remapping
and full gamepad support. Subtitles are not applicable (the game has no
voice-over; all cues are visual + musical).

## What's inside

- 16 hand-laid tracks across twelve biomes (desert, forest, city, mountain,
  volcano, underwater, factory, islands, ruins, storm, crystal, space) —
  each with a signed shortcut, boost pads, ramps, item boxes, hazards and a
  themed music seed.
- 14 pilots (plus unlockables), customizable karts: paint, chassis, wheels,
  trail — stat-bearing parts you mix in the **garage**.
- 22 original items: position-weighted rolls, forward shells, homing eels,
  trap onions, rockets, apex bands and more.
- Progression: level unlocks, cup trophies, achievements (incl. hidden ones).
- AI rivals with distinct personalities (aggressive / balanced / defensive)
  racing the exact same physics as you — no rubber-banding, verified by
  automated sims.

## Tests

```bash
npm test                       # fast suite: logic, server, content, items, modes, systems, battle
npm run test:all               # everything: + arenas, tracks, env, race sim, boot smoke,
                               #   i18n coverage, save/input, UI nav, and the deterministic
                               #   180-scenario QA matrix (every track × AI difficulty)
node test/race_sim.test.mjs    # headless full race: 4 AI karts, 3 laps
node test/boot_smoke.mjs       # boots every system and drives to the results screen
```

The QA matrix is seeded, so CI results are reproducible rather than lucky.

## Documentation

- [DOCUMENTATION.md](DOCUMENTATION.md) — architecture, controls, game systems,
  vehicle physics, drift mechanics, item system, AI behavior, multiplayer,
  localization, save data, customization, progression, build/deployment,
  server setup, troubleshooting.
- [MULTIPLAYER.md](MULTIPLAYER.md) — authoritative online-service contract and
  production checklist (the game ships offline-first).
- [DEVELOPMENT_REPORT.md](DEVELOPMENT_REPORT.md) — incremental build history and
  test breakdown.

## License / assets

Code and course content are original work. Audio is synthesized at runtime
with WebAudio; all meshes are procedural. Three.js is MIT-licensed
(`lib/three.module.js`).
