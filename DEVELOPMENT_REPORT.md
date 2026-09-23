# Sunforge Racers — Development Report (Vertical Slice)

## What was implemented

Everything from the vertical-slice spec, in a genuinely playable form:

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

## Known limitations

- Track is a single loop defined by one spline + data; no track editor.
- No items/power-ups (intentionally out of scope for the slice).
- AI never takes the shortcut (by design it follows the main racing line).
- No gamepad/touch input yet; keyboard only.
- Blob shadows instead of real shadow mapping (chosen for a stable 60 FPS).
- Audio is synthesized placeholder-quality by design.
- One camera collision approximation (box colliders), which covers the
  tunnel/arches/monuments but not every decorative rock.

## What should be implemented next

1. **Items & combat layer** (item boxes, projectiles, hit states) — the FX,
   event and HUD hooks are already in place.
2. **Track 2 + theming pipeline** — extract track definition into pure data
   (control points, features, themes) to prove content scalability.
3. Gamepad + touch controls, input rebinding UI.
4. Real-time shadows / baked AO pass and post-FX (bloom for boost pads).
5. Music tracks per theme + positional audio for nearby AI karts.
6. Best-lap ghost recording/playback.
7. Split-screen or simple online time-trial leaderboards.
8. Truck/physics variants (handling/acceleration/top-speed kart classes).
