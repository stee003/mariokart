# Sunforge Racers 🏜️

An **original** arcade kart racing vertical slice — 3D, browser-based, zero
copyrighted assets. Built with Three.js and hand-rolled arcade physics.

One pilot (*Ember the Dustfox*), one kart (*Dune Blazer MK-1*), one track
(*Sunforge Circuit*), three AI rivals, and a full race loop: countdown →
3 laps → results → restart.

## Play

```bash
npm start            # serves on http://localhost:8000
```

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
npm test                       # track/physics/drift/boost/checkpoint/localization tests
node test/race_sim.test.mjs    # headless full race: 4 AI karts, 3 laps
node test/boot_smoke.mjs       # boots every system and runs to the results screen
```

See [DEVELOPMENT_REPORT.md](DEVELOPMENT_REPORT.md) for the full technical
breakdown.
