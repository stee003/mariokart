# Verdant Loop — the Lanternwood

An ID-scoped art and recovery pass. The original **spline, road widths, shortcut, ramps, obstacles, boxes, checkpoints, laps and music** are unchanged.

## World

- A moss / honeyglass / copper palette gives the road its own dusk-gold edge language. The start is framed by a carved welcome gate and a giant branching *heart tree* with lit growth rings and hanging lanterns.
- Forested ridgelines, layered mixed woodland, ferns, mushrooms, flowers and fieldstones replace a sparse scatter. The raised eastern road has timber fascia, buttresses and flush plank seams; the existing leaf-tunnel range has a living colonnade with warm sconces. A lily pond, reeds, cattails and a little outflow mark the low return straight.
- Broken canopy light shafts, floating fireflies and low verge lamps add depth without hiding the racing line. Repeated objects are instanced (about 4,200 instances in 263 mesh nodes, including the capped water FX pool). Scene-owned lighting hides older world lights during the visit and restores them on exit.
- Three idling deer and three herons are **ambient only**. Their complete rigs, including the antlers, are kept beyond the entire main-road and shortcut envelopes; none has a physics collider or roams across the course. Tunnel/gate/tree boxes are for the *camera* only.

## Water and recovery

- The visible return-straight puddle uses a gently irregular footprint and a subdivided surface fitted to `TrackManager.surface()`. Its wet road edge, fragmented silver-green shore, moving glints and pooled expanding wake rings are drawn on that same footprint.
- Grounded tires inside that footprint get smooth speed-dependent resistance and slightly reduced grip in the **fixed physics step**, not the render loop. Faster karts leave more rear-wheel spray and two wakes; airborne karts do not make contact. Ripples reuse a fixed set of 28 meshes rather than allocating every frame. This is a shallow-water arcade model, not a whole-world fluid solver. Other tracks' water handling is unchanged.
- Beyond the *visible* apron of the raised boardwalk, the projected road height is no longer treated as an invisible floor. The kart falls toward the visible forest floor, waits about 0.75 seconds, then calls the **same reset method as R** at the last grounded on-road progress (four metres back). Coming safely back onto the road before the timer expires cancels the rescue. On low ground, existing off-road recovery remains in effect.
- A reset clears motion, drift, boost, water contact and terrain pose. Karts are intangible for the entire recovery freeze, including its last frame; checkpoint progress is rebased rather than credited. Both the kart renderer and chase camera snap to the new pose instead of interpolating across the map. The manual R reset also produces its normal HUD/audio notification exactly once.

## Verification

`node test/verdant.test.mjs` checks unchanged track data, road and shortcut clearance, wildlife distance and animation, finite geometry, water-height/shoreline correspondence, bounded ripples, speed drag at 30/60/144 Hz, airborne exemption, actual driving off an elevated edge, fall timing, saved-position and R-key parity, cancellation after a save, checkpoint/collision immunity and camera/renderer pose rebasing. `npm run test:all` includes this test and the existing AI race/terrain/multiplayer suites.

Browser/WebGL smoke checks exercised menu → Verdant race → road-level views of the rise, tunnel and puddle without JavaScript or shader errors. Frame rates in software-rendered Chromium are **not** a device-performance estimate. All art is procedural; no runtime assets or dependencies were added.
