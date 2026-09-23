# Three-track refinement pass

Scope: **Granite Pass, Magma Coil, Abyss Dock**. The request mentioned five tracks but named three; only the three named tracks were changed.

## Driving and level design

- Added 2 world units to existing road-width control points (roughly 9–18%). These are physical widths, not merely wider road meshes.
- Granite: softened the summit transition, moved the second ramp onto the descent, added a recovery boost, and offset the quarry pendulum and geothermal vent to leave a bypass lane.
- Magma: rebuilt the inner turnaround and final return into separated, rounded bends. Added control points eliminate folded inside shoulders and the tight start-line reversal. Moved the rotating hazard away from the turnaround, offset alternating flame jets, reduced their active duty, and put the final boost on the recovery straight.
- Abyss: relaxed the S-bend, widened the shortcut and added its boost, separated the buoyancy exit from the moving hazard, softened the current, and spaced item rows away from ramps.
- Preserved each course's signature mechanics, lap count, checkpoint progression and difficulty tier. No vehicle-handling changes.

## Visual identity

`src/expeditionEnvironment.js` contains ID-scoped palettes and deterministic scenery builders.

- **Granite:** irregular snowy ridges, rocky foothills, fir forests, retaining walls and buttresses, a copper-roofed summit lookout, animated windsock, suspended quarry boulder, snow particles and turn guidance.
- **Magma:** basalt columns, an enclosing caldera ridge, lava basin and tributaries, glowing crater, animated plume and embers, heat-exchanger gantries and vent warning halos synchronized to the physical hazards.
- **Abyss:** raised dock foundations, seabed reef shelves, coral and kelp, dock cranes and research bathyspheres, an observatory, transparent ribbed pressure tunnel, buoyancy arches, current arrows, swimming fish and filtered light shafts.
- All three get granular road surfaces, properly double-sided shoulders/curbs, edge markings, reflectors, sector markers, readable approach-facing banners, and distinct lighting.
- Scatter placement rejects road and shortcut envelopes. Repeated objects use instancing. The environment builds contain 74 / 79 / 134 mesh nodes respectively, including approximately 1,657 / 1,084 / 1,274 instances; these are scene counts, not a device FPS guarantee.
- The new worlds own their lights. Pre-existing legacy lights are hidden while a refined track is active and restored on exit, avoiding palette contamination without changing the legacy renderers.

## Music

Original eight-bar arrangements in `src/content/expeditionMusic.js`:

| Track | Arrangement | Tempo | Character |
| --- | --- | --- | --- |
| Granite Pass | Above the Cloudline | 124 BPM | Dorian climbing melody, warm triangle instruments |
| Magma Coil | Heart of the Furnace | 138 BPM | Minor syncopated drive, filtered saw lead |
| Abyss Dock | Signals in the Blue | 116 BPM | Dorian extended chords, sine melody and echo |

Each has a distinct bass, drums, harmony, call/response phrase and turnaround, plus the existing countdown/final-lap/result state transitions. Extended sequencing, attack shaping, filtering and lead echoes are opt-in. Existing tracks retain their prior clock and sound generation.

## Verification

Run `npm run test:all` (also includes `test/expedition.test.mjs`).

- Full existing suite and new regressions passed.
- Four-kart headless races finish on all three tracks.
- Regression checks cover minimum widths, inner-shoulder curvature, nonadjacent road separation, ramp fit/grade, hazard offsets, finite animated geometry, instance budgets, landmarks, light restoration, complete music patterns, scheduler wrap and legacy transitions.
- `test/fixtures/untouched-track-hashes.json` fingerprints the other 13 definitions at the pre-pass revision. Deliberate future changes to those tracks will require an explicit fixture update.
- Chromium/WebGL checks exercised all three environments at road level and from above, and actual menu → race → pause → menu transitions, followed by a legacy-track load. No JavaScript or shader errors observed.
- Chromium OfflineAudioContext rendered each complete arrangement. Output was finite and non-clipping at the default music level (peak below 0.22).

Browser tooling and scratch screenshots were kept outside the repository. No external art/audio assets or new runtime dependencies are needed.
