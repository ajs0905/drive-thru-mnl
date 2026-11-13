# Drive Thru MNL: No Traffic Edition

A low-poly, browser-based driving game set in Metro Manila, built from real OpenStreetMap data.

**The idea:** a pipeline that turns real map data into a drivable 3D city that streams into the browser.

> Work in progress. The first playable area is **Bonifacio Global City (BGC), Taguig**. More of Metro Manila (EDSA, C-5, Makati, Ortigas) comes later.

## Roadmap

- [x] OSM data pipeline, projection and 2D map
- [x] 3D city: playable area, extruded buildings with estimated heights, road surfaces, land use
- [x] Flyovers and footbridges with ramps and pillars, road widths fitted to the street, map cleanup
- [ ] Drivable car with physics
- [ ] Tile streaming
- [ ] Minimap, landmarks, polish
- [ ] Live on Vercel

## Stack

- Three.js via React Three Fiber, TypeScript, Vite
- Rapier physics (planned, for the car)
- Node + TypeScript data pipeline (`pipeline/`)
- Vitest

## Getting started

```bash
npm install
npm run dev
```

The BGC map data is already in the repo, so that's all you need. Drag to pan, right-drag to rotate, scroll to zoom.

### Refreshing the map data (optional)

Only needed if you want newer OpenStreetMap edits or change the area:

1. Open [overpass-turbo.eu](https://overpass-turbo.eu), paste the query from [`data/bgc.overpassql`](data/bgc.overpassql) and click **Run**.
2. **Export > GeoJSON > download**, save it as `data/raw/bgc.geojson`.
3. `npm run pipeline` rebuilds `public/data/bgc.json`.

The drivable area is the polygon in [`data/playable-area.geojson`](data/playable-area.geojson). To change it, open the file at [geojson.io](https://geojson.io), drag the points, save, and run `npm run pipeline` again.

## How the pipeline works

```
overpass-turbo export (GeoJSON, lat/long, 19 MB)
        │
        ▼
pipeline/extract.ts
  • read tags, classify: building / road (major, minor, service, path) / park / water / land use / plaza
  • project lat/long -> local meters around a BGC origin
  • road widths from width / lanes / one-way tags
  • drop indoor corridors, underground walkways and basements; float canopies
  • clean up duplicate points, closing points, degenerate shapes (counted, with reasons)
  • estimate building heights (see below)
        │
        ▼
pipeline/clip.ts  (+ data/playable-area.geojson)
  • inside the playable polygon        -> playable
  • within 300 m outside it            -> scenery (drawn, not drivable)
  • farther out                        -> dropped
  • roads kept per segment (a long segment can cross the area with both ends outside it)
  • road ends and huge land-use areas trimmed to the box
        │
        ▼
pipeline/elevation.ts      raise flyovers and footbridges, turn approach roads into ramps
pipeline/fitWidths.ts      narrow minor streets to fit between the houses along them
        │
        ▼
public/data/bgc.json (2.6 MB)  ->  merged 3D meshes in the browser
```

Overpass returns every way and relation that touches the export box, so the raw BGC export reaches about 11.6 x 7.7 km even though the box is 3 x 3 km. Clipping brings it down to 3.1 x 2.7 km: 6,360 playable buildings, 6,118 scenery buildings, 8,403 dropped.

### Projection

Equirectangular around a fixed origin (14.5509 N, 121.0503 E):

```
x = R · Δlon · cos(lat0)      (meters east)
y = R · Δlat                  (meters north)
```

At city scale this is accurate to well under a meter. The tests check it against great-circle (haversine) distance for 2,000 random point pairs across BGC: worst error under 0.05%, and under 1 m absolute.

### Building heights

Only about 3% of the buildings in the area have a `height` or `building:levels` tag in OpenStreetMap, so most heights are estimated ([`pipeline/heights.ts`](pipeline/heights.ts)):

1. `height` tag: used as is
2. `building:levels` tag: levels x 3.2 m
3. Building type with a typical size: houses 6 m, garages 3 m, churches 14 m, schools 13 m, and so on
4. Otherwise, footprint area: under 100 m² is 5 m, up to 1,500 m² (a typical BGC tower footprint) is 45 m, up to 4,000 m² is 80 m. Bigger than that is treated as a mall or podium (30 m). Retail is capped at 30 m and apartments at 60 m.

Estimates get a fixed +/-20% variation from a hash of the building id, so rows of similar buildings don't look copy-pasted, and the same building gets the same height on every build. These are rough. Real heights are always used when OSM has them.

### Flyovers and footbridges

OSM marks bridges (`bridge=yes`, `viaduct`, `layer=1`) but not how high they are or where the slope starts. [`pipeline/elevation.ts`](pipeline/elevation.ts):

1. Roads are connected where they share a point (the same OSM node).
2. A chain of connected bridge pieces is raised only if some part of it **crosses over another road** (found with a uniform grid / spatial hash of road segments). Small bridges over creeks stay on the ground: 30 of them in BGC.
3. Decks sit at layer x 7 m (roads) or 6 m (footbridges).
4. The approach road becomes the ramp: it climbs over up to 90 m (20 m for stairs), and stops at the first junction so side streets don't get lifted. If a junction sits right at the foot of the bridge, the bridge itself slopes down instead.
5. Ramps follow a smoothstep curve, with extra points inserted so the slope isn't one straight line.

Result: 72 raised pieces (Kalayaan Overpass, the Lawton Avenue viaduct, East Rembo C5 Overpass, Pamantasan Overpass, link ramps, footbridges), 47 ramps on approach roads and 11 on the bridge itself. Raised roads get deck edges, side barriers and pillars every 30 m (14 m for footbridges).

Underpasses (`tunnel=yes`) are drawn at ground level for now.

### Road widths

Fixed widths per road type made roads cut into buildings: BGC's avenues are mapped as two one-way carriageways, and each half got the full width. Now:

- **Tags first** ([`pipeline/roadWidth.ts`](pipeline/roadWidth.ts)): `width`, else `lanes` x 3.2 m, else typical lanes for the road type, fewer if one-way. Driveways and alleys are 3 to 3.5 m.
- **Fitted to the street** ([`pipeline/fitWidths.ts`](pipeline/fitWidths.ts)): minor and service roads are measured against nearby building walls (exact segment-to-segment distance) and narrowed to fit, down to 3.5 m. Walls the centerline actually crosses are ignored (roads going under buildings).

Playable buildings with a corner inside a non-service road went from 1,688 to 264 (median overlap 0.9 m). The rest are houses closer than 3.5 m to the street center, or roads mapped straight through a building.

### Map cleanup

- 29 indoor corridors and mall stairs removed (they showed up as random outdoor paths)
- 5 underground walkways and 4 basement-level buildings removed
- 28 canopies (`building=roof`: gas stations, covered walkways) float at 3.6 m as thin slabs instead of solid blocks
- 7 pedestrian plazas drawn as paving
- Where road pieces meet at an angle, a disc fills the wedge-shaped gap between their flat ends
- Overlapping land-use areas stack by size (a cemetery inside a big zone stays on top)

### 3D geometry

All in [`src/geometry/`](src/geometry), with tests:

- **Winding** (shoelace formula): OSM outlines come in both directions. Outer rings are forced counter-clockwise and holes clockwise, so every wall faces out, including courtyard walls.
- **Extrusion**: each footprint becomes walls (2 triangles per edge) plus a flat roof triangulated with [earcut](https://github.com/mapbox/earcut).
- **Road surfaces**: each centerline is offset left and right by half the road width, with miter joins clamped at 2x the half width so sharp turns don't spike. Heights per point for ramps and decks.
- **Clipping**: point-in-polygon, segment-to-polygon distance, Sutherland-Hodgman for land-use areas, Liang-Barsky for road ends.
- **Spatial grid**: uniform grid of segments for "what's near this?" queries (bridge crossings, building walls near streets).

### Rendering

Every layer (playable buildings, scenery buildings, roads, ground, bridge structures, playable edge) is merged into one mesh with per-vertex colors. The whole city is **8 draw calls and about 231k triangles**, built in the browser in about 200 ms. The overlay at the bottom left shows live FPS, draw calls and triangles.

## Tests

```bash
npm test
```

196 tests:

- Projection: origin, axis directions, known distances (0.01° lat ≈ 1111.95 m), round-trips both ways, accuracy vs haversine, rejects bad origins
- Extraction: road classes, both tag formats, multipolygons with holes, height/levels parsing, junk input skipped with reasons, bounds
- Heights: tag and levels priority, type and footprint rules, retail cap, deterministic variation within +/-20%
- Clipping: inside / scenery / dropped zones, road trimming and splitting, land-use clipping, input not mutated
- Polygons: shoelace area and winding, concave shapes, holes, point-in-polygon, distances, Sutherland-Hodgman
- Extrusion: triangle counts, clockwise and counter-clockwise input, outward wall normals, courtyards, concave footprints, degenerate input
- Roads: straight offsets, right-angle miters, clamped sharp turns, U-turns, duplicate points
- City meshes: layer triangle counts, scenery kept separate, no NaN, playable fence, land use stacked by size
- Elevation: decks raised only over roads, creek bridges stay down, ramps on approach roads, ramps stop at junctions, bridge-side ramps, chains, layers, footbridge stairs, tunnels
- Road widths: tag priority, one-way vs two-way, roundabouts, driveways, fitting between houses, minimum width, passages under buildings
- Spatial grid: matches brute force on random segments
- Extraction cleanup: indoor and underground ways, canopies, basements, plazas, layers

## Data and license

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License (ODbL).
