# Drive Thru MNL: No Traffic Edition?

[![CI](https://github.com/ajs0905/drive-thru-mnl/actions/workflows/ci.yml/badge.svg)](https://github.com/ajs0905/drive-thru-mnl/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Map data: ODbL](https://img.shields.io/badge/map%20data-ODbL-green.svg)](https://www.openstreetmap.org/copyright)

Real Metro Manila map data, streamed into the browser as a drivable 3D city. A Node pipeline turns raw OpenStreetMap exports into one compact map file; the browser builds the geometry, collision meshes and physics from it at load time. **Bonifacio Global City (BGC), Taguig** is the first district. The plan is to connect the districts around it and the highways between them, which is where browser geometry, streaming and physics budgets really get tested.

![Overtaking traffic on University Parkway, BGC, in a city generated from OpenStreetMap data](docs/images/hero.jpg)

## Core Algorithms

**Computational geometry and mesh generation**
- Equirectangular projection, verified against Haversine distances: turns lat/long into local meters
- Sutherland-Hodgman polygon clipping and earcut triangulation: cuts footprints to the map, cuts building walls back off the roads, fills roofs, land use and road surfaces
- Polyline offsetting, mitred deck joints and convex-hull junction stitching: road ribbons, flyover decks without cracks, one polygon per junction
- Catmull-Rom splines: round the flyovers' and ramps' curves
- Contour tracing, Ramer-Douglas-Peucker simplification and a breadth-first distance transform: wall off empty lots at the back of the sidewalk
- Separating Axis Theorem (SAT) overlap tests: keep parked cars, roadblocks, street furniture and reset spots clear of obstacles

**Spatial indexing and graph algorithms**
- 2D spatial hash grids: fast "what's near this" lookups for every placement, footprint test and culling pass
- Union-find and road graph walks: merge nearby junctions of divided roads, follow roads through junctions
- Greedy graph coloring: give overlapping roads at interchanges a draw order, so nothing flickers
- Constrained placement search: pillars out of the lanes below, cars along the curbs, the nearest open road for a reset

**Rendering, physics and automated QA**
- Rasterization and flood fill: find unpaved holes in the road network, then pave them with the same detector
- GLSL shader injection: lane markings, zebras, windows and the car's Fresnel reflections from per-vertex data, no textures
- Ray-cast vehicle physics with slip-angle drift assists, and a collider-filtered ray that keeps the camera out of walls
- LRU tile caching for the minimap and big map, and view frustum and distance culling for the instanced props and cars

## Results & Benchmarks

| Metric | Value | Notes |
| :--- | :--- | :--- |
| **Build & Bundle** | | |
| Main / Drive bundle | 384 KB / 860 KB gzipped | The physics chunk (Rapier) loads only when you start driving; the font is bundled |
| Map file (`bgc.json`) | 3.31 MB (779 KB gzipped) | Deterministic: CI rebuilds it from the raw data and fails if a byte differs |
| Pipeline | 17 steps, a few seconds | Node + TypeScript, offline |
| **World Data** | | |
| Input | 25,930 OpenStreetMap features | A 19 MB GeoJSON export, plus 1,634 more for walls, trees and street fixtures |
| Output | 11,685 buildings, 3,536 roads, 1,384 junctions | Plus 511 zebras, 70 raised flyover and footbridge pieces on 279 pillars, 194 traffic lights at 56 junctions, 1,106 street lights, 938 trees, 51 walled-off lots, 2,740 pieces of street and lot furniture, 1,106 parked cars |
| Filled in by rules | 97% of building heights | OSM also has no bridge heights or ramps, no street parking and only outlines for empty lots |
| **Physics & Collision** | | |
| Collision meshes | 125k triangles, about 0.2 s to build | Walls and drivable decks built from the same data the renderer draws |
| Fixed-step physics | 60 Hz | The same step function runs in the game and in headless tests |
| **Performance & Quality** | | |
| Frame rate (High) | 23 FPS to the 144 Hz screen limit | On the development laptop, after two measured passes ([PERFORMANCE.md](docs/PERFORMANCE.md)) |
| Draw calls | About 55 to 105 per view | The whole city, built in the browser in about 300 to 400 ms; an idle view costs nothing |
| Automated tests | 642 unit and physics tests | Including an autopilot that drives up a real flyover ramp in Rapier |
| Map QA | 25 automated checks | A CI gate: counts can only go down |

## How It Works

1. **Offline map pipeline** (`pipeline/`): turns raw OpenStreetMap GeoJSON into one deterministic, versioned map file. It works out building heights, flyover heights and ramps, junction polygons, zebras, walls, lots, traffic lights, street lights, parked cars and street furniture, then runs 25 map QA checks before the file ships.
2. **Procedural 3D city** (`src/geometry/`, `src/scene/`): the browser builds road ribbons, flyover decks, extruded buildings, trees and barriers from the map file, merged into 1.2 km grid cells, with GPU instancing for repeated props and GLSL shaders for markings, windows and car paint.
3. **Physics and vehicle** (`src/car/`): Rapier at a fixed 60 Hz, with arcade assists (slip-angle drift control, anti-spin, a hysteresis gearbox) and camera ray clipping. The car code doesn't touch React or three.js, so the same step function runs in headless Vitest suites.
4. **Render on demand, adaptive quality**: frames are drawn only when something changes, shadows re-render on a throttle, the pixel ratio follows the frame rate, and the 2D maps paste cached tiles. Low, Medium and High tiers aim at desktops and low-mid range Android phones (phone numbers still to be measured).

![The Lawton Avenue viaduct, raised by the pipeline from OSM bridge tags](docs/images/flyover.jpg)

![Junction polygons, lane markings, zebra crossings and sidewalks, all generated from OSM tags](docs/images/streets.jpg)

![Windows by building type, rooftop water tanks and street trees in a barangay of low houses, with the BGC towers behind](docs/images/buildings.jpg)

## The game

Free-roam arcade driving on BGC's real streets, for once without the traffic (hence the name). Drift the corners, take the flyovers, send the roadblocks at the edge flying. Checkpoint races, ride-hailing and police chases are next. Runs in the browser on desktops and phones, nothing to install.

**Controls:** W A S D or the arrow keys to drive, Space for the handbrake, R to reset the car, M for the map, Esc to pause. On a phone, hold it sideways and use the buttons on screen.

## What's built

- Map pipeline: OSM export to one compact, deterministic map file, with heights, flyovers, junctions, crossings, trees, walls, walled-off lots, traffic lights, street lights, street furniture and parked cars worked out by rule
- Map QA: 25 checks run in CI, each with a baseline that can only go down
- 3D city: buildings with windows and roof details, painted roads with clean intersections, a physically based sky, shadows, and filler city and real skylines past the edge
- Performance: three quality tiers, adaptive resolution, grid culling, render on demand, reversed depth
- Driving: Rapier physics with arcade handling (drift assist, speed-sensitive steering), a chase camera, solid buildings, drivable flyovers, walled-off lots and solid street furniture, parked cars and roadblocks you can push around
- UI: a road sign menu, loading screens, a road sign HUD with a heading-up minimap and a full map, a pause menu, touch controls for phones

## Planned

- Measure it on a phone, then better buildings and utility poles
- Later: engine, tire and crash sounds, ambience and music
- First deploy on Vercel
- Game modes: sprint from A to B, ride-hailing, light traffic, a police chase
- Tile streaming, then more of Metro Manila: the districts around BGC and the highways between them

## Known issues and fixes

- 3 ramps still overlap a road running alongside them (map QA `ramp-in-lanes`); needs per-ramp width fitting
- Underpasses are drawn at ground level
- Zebras are always square to the road, and there are no stop lines or lane arrows yet
- About 40 driveways and access roads still run into malls, towers and car parks as mapped (map QA counts)
- 27 small unpaved gaps between roads are left as islands (map QA `paving-hole`)
- Windows assume 3.2 m floors on every building, and it's always daytime
- The whole city sits on the GPU at once; tile streaming (planned) is what lets the map grow

## Getting started

Requires Node 22 or newer.

```bash
npm install
npm run dev
```

The BGC map data is already in the repo, so that's all you need.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the game locally (add `?q=low`, `?q=medium` or `?q=high` to the URL to force a quality tier, `?debug` for the frame rate, `?view=map` for the free camera map view that map QA's links open) |
| `npm test` | Unit tests |
| `npm run pipeline` | Rebuild `public/data/bgc.json` from the raw export |
| `npm run qa` | Scan the map for known problems, with camera links |
| `npm run check` | Everything CI runs: typecheck, lint, tests, data in sync, QA gate |

## Docs

- [Architecture](docs/ARCHITECTURE.md): how it's built, module boundaries, data contract, rendering, quality tiers, testing, roadmap
- [Map data](docs/DATA.md): sources, refreshing the data, each pipeline step with its numbers, building heights, map QA
- [Performance](docs/PERFORMANCE.md): budgets per quality tier, measured numbers, how to profile on a phone
- [Decisions](docs/decisions/): one page per big decision and its trade-offs

## Stack

- Three.js via React Three Fiber, TypeScript, Vite
- Rapier physics via `@react-three/rapier`, loaded on demand
- Node + TypeScript data pipeline (`pipeline/`)
- Vitest, oxlint, GitHub Actions

## Credits and license

- Code: [MIT](LICENSE), Adrian Joseph B. Salva
- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License (ODbL)
- Polygon triangulation: [earcut](https://github.com/mapbox/earcut)
- Cars: the Sedan you drive and six parked models from the [Free Low Poly Vehicles Pack](https://rgsdev.itch.io/free-low-poly-vehicles-pack) by Rgsdev (CC0), converted with `tools/car-to-glb.ts` and `tools/parked-cars-to-glb.ts`
- Traffic cone and concrete barrier: [City Kit Roads](https://kenney.nl/assets/city-kit-roads) by Kenney (CC0), baked with `tools/kenney-to-ts.ts`
- Dumpster, work light, traffic light heads, planter and kiosk awning: [City Kit Roads](https://kenney.nl/assets/city-kit-roads), [City Kit Suburban](https://kenney.nl/assets/city-kit-suburban) and [City Kit Commercial](https://kenney.nl/assets/city-kit-commercial) by Kenney (CC0), merged with the props built in code into `public/models/props.glb` by `tools/props-to-glb.ts`
- Font: [Overpass](https://github.com/RedHatOfficial/Overpass) by The Overpass Project Authors (SIL Open Font License 1.1), bundled through [Fontsource](https://fontsource.org/fonts/overpass)
