# 0017. The map is 1.2x bigger than the real BGC across the ground

**Status:** Accepted, 2026-11-15

## Context

Driving the real-size BGC felt small. The playable area is about 2.5 by 2.1 km, and at the car's old top speed (50 m/s, 180 km/h) the whole map took about 50 seconds to cross. A bigger playable area means a new export and, for phones, tile streaming first. A cheaper option is to make the same city bigger.

Ways to make it bigger:

- **Scale everything** (positions, widths and heights): the same as shrinking the car. At 1.5x a 3.2 m lane is 4.8 m and the car looks like a toy; at 1.2x it's 3.8 m, which still reads as a generous city lane.
- **Stretch only distances**, keeping road widths real: blocks get longer but roads look thin between them, and the empty space between things grows, which was already a complaint.
- **Stretch the ground plan, keep heights real**: distances, footprints and road widths 1.2x; heights, the car, trees, props and parked cars real size.

## Decision

- **1.2x across the ground, heights real.** `MAP_SCALE` in `src/geo/projection.ts`; the pipeline projects with it (`createProjection(origin, scale)`) and stretches road widths by it, and the map data records it as `scale`. Heights stay real so floors, deck clearances and the car match: a building is 20% wider and deeper but has the same number of floors.
- Everything placed by rule (ramps, pillars, parked cars, trees along rows, crossings) is placed after the stretch, in game meters, so their spacing stays real.
- The skyline clusters past the map are stretched too, so they stay where the real districts are relative to BGC.
- **Top speed down to 38 m/s (about 137 km/h)** with the gear change speeds and the chase camera's speed range scaled to match. With the bigger map, crossing it at top speed takes about 80 seconds instead of 50.

## Consequences

- The playable area is about 3.0 by 2.5 km. Map QA improved a little on its own (fewer buildings poking into streets, since streets widen with the scale and are then fitted between the buildings again).
- Distances in the game no longer match the real ones. Fine for a game; the projection itself is still tested against true distances at scale 1.
- Camera spots (`?cam=`) and positions written down before this change point 1.2x closer to the origin.
- Bigger than 1.2x would need wider-than-real lanes or thin-looking roads; a real bigger area (new export plus tiles) is still the long-term answer.
