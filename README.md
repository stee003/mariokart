# Sunforge Racers 🏜️

An **original** arcade kart racer — 3D, browser-based, zero copyrighted
assets, zero npm dependencies. Built with Three.js and hand-rolled arcade
physics.

**14 pilots · 8 chassis · 12 wheel sets · 33 cosmetic parts · 16 tracks ·
6 Grand Prix cups · 22 original power-ups · 4 battle arenas / 5 battle modes ·
time trials with ghosts · achievements & progression · garage · records ·
online leaderboards, ranked seasons and a live netplay relay** — EN/IT, no
pay-to-win, nothing copied.

Race loop: countdown → 3 laps → results → rewards. Everything the game shows
runs on the same vehicle physics, drift system, camera and AI the vertical
slice shipped with.

## Play

```bash
node server.mjs            # serves on http://localhost:8000
```

`npm start` runs a tiny zero-dependency Node server (`server.mjs`) that serves
the game *and* the online stack: the JSON API at `/api/*` (leaderboards,
ranked seasons, world ghosts) and the WebSocket netplay relay at `/ws`. It
works the same on Windows, macOS and Linux — no Python, no packages.

Online state lives in `data/online.json` (git-ignored); delete it to reset the
ladder. Open the game in two windows to try a live lobby.

Different port: `node server.mjs 8080` (cross-platform), or `PORT=8080 npm start`
in bash / `set PORT=8080 && npm start` in Windows `cmd`.

(or serve the folder with any static file server and open `index.html`)

## Controls

| Key | Action |
|---|---|
| W / ↑ | Accelerate (hold during the final countdown window for a rocket start) |
| S / ↓ | Brake / Reverse |
| A D / ← → | Steer |
| Shift | Drift (hold while steering; release to fire the charged boost; tap brake to cancel) |
| Space | Aerial trick while airborne (land it for a mini boost) |
| R | Reset to track |
| Esc | Pause |
| Enter | Restart (on the results screen) |

## Tests

```bash
npm test                       # 12 suites: logic, syntax, server, content, items,
                               # modes, systems, battle, arena AI, garage, online, UI
npm run test:all               # every suite + arenas, tracks, environments,
                               # race simulation and the boot smoke test
node test/entry.test.mjs       # boots the real entry point against a fake WebGL
node test/boot_smoke.test.mjs  # drives every system to the results screen
```

See [DEVELOPMENT_REPORT.md](DEVELOPMENT_REPORT.md) for the full technical
breakdown.
