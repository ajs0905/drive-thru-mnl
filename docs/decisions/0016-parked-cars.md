# 0016. Parked cars: placed by rule, physics only near the player, reset off screen

**Status:** Accepted, 2026-11-15

## Context

The streets looked empty. Moving traffic needs a road graph and driving AI (a later milestone), but parked cars give most of the "lived-in" look at a fraction of the cost, and give the player something to bump into. Constraints:

- OSM has almost no street parking data for BGC (25 tagged ways, all "no parking").
- Most village streets are about 3.6 m wide: a parked car there blocks the road.
- The car models are 1,400 to 1,750 triangles each; hundreds of them would blow the phone budget.
- Hits should move them (not statues), but hundreds of awake physics bodies, and cars left scattered around the map, aren't wanted.

## Decision

- **Placed by rule in the pipeline** (`pipeline/parking.ts`, `parked` in the data): minor streets only, and only where enough road is left to drive past (3.2 m on a one-way, 5.6 m on a two-way); seeded slots along the curb with gaps; skipped near junctions, crossings, driveways (gates, booms, bollards), trees, pillars, walls, buildings and the playable edge. Respects the "no parking" tags. A QA check runs the same obstacle test on the output.
- **Six models from the CC0 car pack** in one GLB, each merged into one mesh with a paint mask, repainted per car from a weighted palette of real-world car colors.
- **Two levels of detail and distance culling:** real models near the camera, a 30-triangle box car farther out, nothing past the draw distance or outside the view; distances per quality tier.
- **A physics pool:** only cars within 70 m of the player are Rapier bodies, asleep until hit, lighter than the player's car. A moved car returns to its spot once neither it nor the spot has been on screen for a second and it's still (off-screen reset), so streets fill back up without anything visibly teleporting.

## Consequences

- 1,705 cars, about 20k to 40k extra triangles on Low depending on the spot (more on higher tiers), up to 7 draw calls, 91 KB of models.
- Narrow village streets stay empty; a later pass could park cars half on the curb there, or in driveways and lots.
- The pool and reset logic is a plain class (`scene/parkedPool.ts`) tested in the real physics engine; the car-side rules (`car/parked.ts`) are pure and unit tested.
- Parked cars can be shoved but don't get damaged, and they slide rather than roll (a box collider with friction, like a parked car with its handbrake on).
