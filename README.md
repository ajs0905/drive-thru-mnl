# Drive Thru MNL: No Traffic Edition?

[![CI](https://github.com/ajs0905/drive-thru-mnl/actions/workflows/ci.yml/badge.svg)](https://github.com/ajs0905/drive-thru-mnl/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Map data: ODbL](https://img.shields.io/badge/map%20data-ODbL-green.svg)](https://www.openstreetmap.org/copyright)

A data pipeline that turns raw OpenStreetMap data into a drivable 3D city in the browser, and a low-poly arcade driving game on top of it. The first city is **Bonifacio Global City (BGC), Taguig**, in Metro Manila.

![Overtaking traffic on University Parkway, BGC, in a city generated from OpenStreetMap data](docs/images/hero.jpg)

## Results

| | |
| --- | --- |
| **Input** | 25,930 OpenStreetMap features (a 19 MB GeoJSON export), plus 1,634 more for walls, trees and street fixtures |
| **Output** | 11,687 buildings, 3,536 roads, 1,384 junction polygons, 511 zebra crossings, 70 raised flyover and footbridge pieces on 279 pillars, 922 trees, 981 parked cars: one 723 KB (gzipped) file |
| **Missing data, filled by rules** | 97% of buildings have no height in OSM, bridges have no height or ramps, and street parking isn't mapped. All of it is worked out by the pipeline |
| **Pipeline** | 14 steps, a few seconds, deterministic: CI rebuilds the map and fails if the output differs by a byte |
| **Map QA** | 24 kinds of map problem scanned on every push, with counts that can only go down. Examples: 758 flickering road overlaps, 226 trees standing on roads and 55 pillars in the lanes below them, all now 0 |
| **Rendering** | The whole city in about 50 to 90 draw calls, built in the browser in about 300 to 400 ms; an idle view costs nothing |
| **Performance work** | High on the development laptop went from 23 FPS to the screen's 144 Hz limit after two measured passes |
| **Physics** | Collision meshes (82k triangles) built from the map data when you start driving, matching exactly what's drawn; the flyovers are drivable |
| **Tests** | 591 unit tests, including the car's handling run in the real physics engine and an autopilot that drives up a real flyover ramp |
| **Download** | 381 KB (gzipped) to see the city; the 859 KB physics chunk loads only when you start driving |

## How it works

- **Messy data, handled.** Only 3% of buildings have a height in OSM, so heights are estimated from type and footprint. Indoor walkways, basements and skywalks mapped through malls are cleaned up, buildings hidden inside other buildings (duplicates, old construction site outlines) are removed, and roads are narrowed to fit between the houses along them.
- **Flyovers worked out from tags.** OSM only says "bridge, layer 1". The pipeline decides which bridges are really raised (only those crossing a road), builds ramps on the approach roads that stop at junctions and never climb inside another road's lanes, rounds their curves with splines, and places pillars where they don't block a lane below (sliding along the deck, into an avenue's median, or onto an outrigger pier).
- **Clean intersections, painted roads.** Roads are split into a graph and every junction gets its own polygon, worked out from where the road edges meet; leftover gaps are found by rasterizing the road surface and paved. Lane lines, zebra crossings and curbs are drawn by a shader from per-vertex data: no textures, no extra draw calls.
- **Windows without textures.** Every building gets windows from its type and height (glass towers, offices, apartments, houses, parking decks), drawn by a shader; roofs get stair housings, AC units and water tanks.
- **Walls and trees that respect the streets.** Walls and fences from OSM are cut open wherever a road passes, street trees mapped into the road are moved to the curb, gates and parking booms turn to span their road. Trees are low-poly models built in code and drawn as GPU instances.
- **Parked cars placed by rule.** Only on streets wide enough to still drive past, clear of junctions, crossings, driveways and trees, in stretches with gaps. Two levels of detail plus distance and view culling; near the player they're physics bodies, and a car you knock out of place goes back to its spot once it's off screen.
- **Scales with the device.** Low, Medium and High tiers plus a resolution that adapts to the frame rate. Shadows, MSAA, tree models and the speed blur are switched by tier; the map and the handling never are.
- **No edge of the world.** Past the mapped area the city continues as filler blocks out to the haze, with the real skylines of Makati and Ortigas where they actually are. Where the drivable area ends, roads are closed off by roadblocks (concrete barriers, a "road under construction" sign, and barricades, drums and cones you can send flying) and a construction fence runs between them.

![The Lawton Avenue viaduct, raised by the pipeline from OSM bridge tags](docs/images/flyover.jpg)

![Junction polygons, lane markings, zebra crossings and sidewalks, all generated from OSM tags](docs/images/streets.jpg)

![Windows by building type, rooftop water tanks and street trees in a barangay of low houses, with the BGC towers behind](docs/images/buildings.jpg)

## The game

An open-world arcade driving game on BGC's real streets, for once without the traffic (hence the name). Free roam for now: drive around the city, drift the corners, take the flyovers, and send the roadblocks at the edge flying. Checkpoint races, ride-hailing and police chases are next. It runs in the browser on desktops and phones, nothing to install.

**Controls:** W A S D or the arrow keys to drive, Space for the handbrake, R to reset the car, M for the map, Esc to pause. On a phone, hold it sideways and use the buttons on screen.

## Roadmap

- [x] OSM data pipeline, projection and 2D map
- [x] 3D city: playable area, extruded buildings with estimated heights, road surfaces, land use
- [x] Flyovers and footbridges with ramps and pillars, road widths fitted to the street, map cleanup
- [x] Map QA, architecture docs, CI
- [x] Better roads: lane markings, clean intersections, zebra crossings, sidewalks and curbs; physically based sky with clouds
- [x] Better buildings: windows, roof details
- [x] Lighting and surroundings: shadows, tone mapping, Low / Medium / High switch with adaptive resolution; filler city, real skylines and hills past the map
- [x] Performance: reversed depth, grid-cell culling, render on demand
- [x] Walls, fences, trees, gates and parking booms from OSM; low-poly tree models built in code
- [x] Drivable car: Rapier physics with arcade handling, chase camera, brake lights
- [x] Solid buildings, walls, posts and the playable edge; drivable flyovers and ramps
- [x] Parked cars along the curbs, with physics near the player
- [x] A 1.2x map, shinier cars, speed blur, roadblocks and a construction fence at the edge of the drivable area
- [x] Menu, loading screens, HUD made of road signs, minimap and big map, pause menu
- [x] Touch controls for a phone held sideways, reset button
- [ ] Measured on a phone
- [ ] Street lights and traffic lights, roads you can't leave, fuller empty areas, better buildings, sounds
- [ ] Live on Vercel
- [ ] Game modes: sprint from A to B, ride-hailing, light traffic, a police chase
- [ ] Tile streaming and a bigger map

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
- Font: [Overpass](https://github.com/RedHatOfficial/Overpass) by The Overpass Project Authors (SIL Open Font License 1.1), bundled through [Fontsource](https://fontsource.org/fonts/overpass)
