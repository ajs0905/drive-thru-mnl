# Algorithms

The algorithms in Drive Thru MNL, where each one runs and what it's for. Numbers are from `npm run bench`, the tests and the pipeline's output; the README has the short version.

Related: [README](../README.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DATA.md](DATA.md) (each pipeline step), [all docs](README.md).

## Computational geometry and mesh generation

Mostly in the pipeline (`pipeline/`) and `src/geometry/`.

- **Equirectangular projection**, verified against Haversine distances: turns latitude and longitude into local meters around the district's origin.
- **Sutherland-Hodgman polygon clipping and earcut triangulation**: cut footprints to the map, cut building walls back off the roads, fill roofs, land use and road surfaces.
- **Extrusion**: buildings as low-poly prisms (hip roofs and podium towers where the outline allows), with windows and shopfronts drawn by shaders from per-vertex data instead of textures.
- **Polyline offsetting, mitred deck joints and convex-hull junction stitching**: road ribbons, flyover decks without cracks, one polygon per junction (1,384 of them).
- **Catmull-Rom splines**: round the flyovers' and ramps' curves.
- **Contour tracing, Ramer-Douglas-Peucker simplification and a breadth-first distance transform**: wall off empty lots at the back of the sidewalk.
- **Rotating calipers (minimum-area rectangles) and polygon scaling**: hip roofs on houses, towers stepped back from their podiums.
- **Separating Axis Theorem (SAT) overlap tests**: keep parked cars, roadblocks, street furniture and reset spots clear of obstacles.

## Spatial indexing and graphs

- **2D spatial hash grids**: fast "what's near this" lookups for every placement, footprint test, physics pool and culling pass.
- **Union-find and road graph walks**: merge the nearby junctions of divided roads, follow roads through junctions, group traffic lights per intersection.
- **Greedy graph coloring**: give overlapping roads at interchanges a draw order, so nothing flickers.
- **Constrained placement search**: pillars out of the lanes below, cars along the curbs, the nearest open road for a reset.
- **Directed road graph with Tarjan's strongly connected components**: 1,706 nodes and 3,062 directed edges, built in the browser in about 0.1 s, one-way streets respected; routes stay in the largest network you can drive both into and out of (2,763 of the edges).
- **Edge-based A\* with ALT landmark bounds**: routes for the cargo runs and the GPS line, U-turns penalized. On 1,000 random routes: 179 states expanded per route on average, against 612 for A\* with straight-line distances and 1,447 for Dijkstra, all three agreeing on every route (`npm run bench`).

## Traffic

All in `src/traffic/`, plain TypeScript with no rendering, so it runs the same in tests and the bench.

- **Intelligent Driver Model** car-following on the road graph, with lanes fitted into the room parked cars leave.
- **Junction reservations**: junctions clustered by union-find and reserved one movement at a time, so cars cross without passing through each other.
- **Signal compliance**: fixed-time two-phase traffic lights per junction cluster (a 46 s cycle); cars queue at red and clear on green.
- **Kinematic bicycle model** on the path: the front axle follows the lane, the rear axle trails it (a tractrix), and the front wheels turn into every sideways move.
- **Cubic Bézier curves** through every junction, paced by arc length.
- **Lane changes in the spirit of MOBIL**, driven as quintic S-curves with the signal on; exits picked on entering a roundabout.
- **Evasive steering**: your car projected to the moment it meets a traffic car decides which way that car dodges, checked for room and for anyone alongside or oncoming on that side.
- Cost: about 0.1 to 0.15 ms per step for 24 to 40 cars, with no footprints overlapping in five simulated minutes (`npm run bench`).

## Physics

`src/car/` (pure, testable) and `src/scene/` (bodies in the world).

- **Ray-cast vehicle** on Rapier at a fixed 60 Hz, with arcade assists designed from a measured limit of the tire model: slip-angle drift control, anti-spin, a hysteresis gearbox, spring body motion.
- **Static collision meshes from the map data**: about 99k triangles (64k walls, 35k drivable decks and posts), built from the same shapes the renderer draws.
- **Pooled bodies near the player**: parked cars within 70 m, at most 28 knockable props within 35 m, roadblock pieces within 45 m, at most 30 debris pieces.
- **Bumps as two-car collisions**: a traffic car hit by the player turns dynamic and gets the impulse at the contact point, so it's shoved and spun, then rejoins its lane once it settles.
- **Camera ray clipping** with a collider filter, so the chase camera stays out of walls but passes trees and decks.

## Rendering

`src/scene/`, React Three Fiber over three.js.

- **Merged meshes per 1.2 km grid cell** and **GPU instancing** for repeated props and cars.
- **Frustum and distance culling** for the instanced props, parked cars, traffic (full models near, box cars far, by tier) and signal lamps.
- **GLSL shader injection**: lane markings, zebras, windows, shopfronts and the cars' Fresnel reflections from per-vertex data, no textures.
- **Render on demand**, throttled shadows, adaptive resolution and reversed depth.
- **Per-frame sun shadows** for anything moving (the shadow map itself re-renders only every few frames).
- **LRU tile caching** for the minimap and the full map.
- **A small software rasterizer** (`tools/car-thumbs.ts`) that draws the CARS tab's pictures from the models, with the game's sky reflections.

## Map QA and determinism

- **Rasterization and flood fill**: find unpaved holes in the road network, then pave them with the same detector.
- **Deterministic map QA**: 33 geometry checks on the real output (buildings on roads or in each other, ramps and pillars in lanes, gaps between deck pieces, unpaved holes, misplaced signals, trees on roads and more), each count with a baseline in CI that can only go down (`npm run qa`).
- **Deterministic pipeline**: running it twice gives a byte-identical map file, and CI fails if the committed one differs.
- **Deterministic headless simulation**: golden replays of cargo runs driven by a pure-pursuit autopilot in the real physics, recorded as run-length encoded keys and played back in CI, where they must end within 5 cm (`npm run replay` records them).
- **Rule-based placement from road attributes**: stop signs before unsignalized junctions with a bigger road, one-way signs facing the cross traffic, speed limits from `maxspeed` tags, kept clear of driveways, crossings and other furniture.
