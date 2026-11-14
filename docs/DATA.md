# Map data

Where the map comes from and what the pipeline does to it. For how this fits into the rest of the system, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Sources and licenses

| What | Where | License |
| --- | --- | --- |
| Roads, buildings, land use, water | [OpenStreetMap](https://www.openstreetmap.org), exported with [overpass-turbo](https://overpass-turbo.eu) | [ODbL](https://www.openstreetmap.org/copyright). Shown as "© OpenStreetMap contributors" in the game and README. |
| Playable area outline | Drawn by hand in [geojson.io](https://geojson.io) | Part of this repo |

ODbL lets us use and adapt the data, including in a public project, as long as it's attributed and the processed database is shared under the same license.

## Files

| File | What it is |
| --- | --- |
| [`data/bgc.overpassql`](../data/bgc.overpassql) | The Overpass query: roads, buildings, land use, parks and water in the box 14.5370, 121.0370 to 14.5650, 121.0640 |
| `data/raw/bgc.geojson` | The raw export (19 MB, about 25,900 features) |
| [`data/playable-area.geojson`](../data/playable-area.geojson) | 15-point polygon around BGC, 3.51 km². Where the car can drive. |
| `public/data/bgc.json` | The processed map the game loads (2.6 MB, 657 KB gzipped). Generated: don't edit by hand. |
| `public/data/sample.json` | Tiny map built from the test fixture, used when `bgc.json` is missing |
| `data/qa-baseline.json` | Accepted map QA counts; CI fails if a count goes above it |

## Refreshing the data

Only needed for newer OpenStreetMap edits or a different area:

1. Open [overpass-turbo.eu](https://overpass-turbo.eu), paste the query from `data/bgc.overpassql`, click **Run**.
2. **Export > GeoJSON > download**, save it as `data/raw/bgc.geojson`.
3. `npm run pipeline` to rebuild `public/data/bgc.json`.
4. `npm run qa` to check for regressions. If counts went down, update `data/qa-baseline.json` (`npm run qa -- --json > data/qa-baseline.json`).

To change the drivable area, open `data/playable-area.geojson` at geojson.io, drag the points, save, and run the pipeline again.

## Pipeline steps

`npm run pipeline` runs these in order (see `pipeline/build.ts`). Each prints what it changed.

### 1. Extract (`pipeline/extract.ts`)

- Reads tags in both overpass-turbo formats and classifies each feature: building, road (major, minor, service, path), park, water, land use, or pedestrian plaza.
- Projects lat/long to local meters (see [Projection](#projection)), rounded to centimeters.
- Road widths from tags ([`roadWidth.ts`](../pipeline/roadWidth.ts)): `width`, else `lanes` x 3.2 m plus shoulders, else typical lanes for the road type (fewer if one-way). Driveways 3.5 m, alleys 3 m. BGC's avenues are mapped as two one-way carriageways, so each half is sized as half a road.
- Building heights (see [Building heights](#building-heights)).
- Drops what shouldn't be drawn outdoors: 29 indoor corridors and mall stairs, 5 underground walkways, 4 basement-level buildings. Canopies (`building=roof`: gas stations, covered walkways) float at 3.6 m as thin slabs.
- Cleans up duplicate points, repeated closing points and degenerate shapes. Everything skipped is counted with a reason.

### 2. Clip (`pipeline/clip.ts`)

Overpass returns every way and relation that touches the export box, so the raw export reaches about 11.6 x 7.7 km even though the box is 3 x 3 km.

- Inside the playable polygon: **playable**.
- Within 300 m outside it: **scenery** (drawn, not drivable).
- Farther out: dropped.
- Roads are kept per segment, because a long segment can cross the area with both ends outside it. Road ends and huge land-use areas are trimmed to the box around the area (Liang-Barsky for lines, Sutherland-Hodgman for polygons).

Result: 3.1 x 2.7 km, 6,359 playable buildings, 6,118 scenery, 8,403 dropped.

### 3. Elevation (`pipeline/elevation.ts`)

OSM marks bridges (`bridge=yes`, `viaduct`, `layer=1`) but not their height or where the slope starts.

1. Roads connect where they share a point (the same OSM node).
2. Connected bridge pieces form chains (union-find). A chain is raised only if some piece **crosses over another road** (spatial grid crossing test). Small bridges over creeks stay on the ground: 30 of them.
3. Decks sit at layer x 7 m (roads) or 6 m (footbridges).
4. The approach road becomes the ramp: it climbs over up to 90 m and stops at the first junction, so side streets don't get lifted. If a junction sits at the foot of the bridge, the bridge itself slopes down instead. Footbridges only come down by stairs or by sloping the bridge; a sidewalk never rises to meet one.
5. Ramps follow a smoothstep curve, with extra points inserted so the slope is a curve.

Result: 72 raised pieces (Kalayaan Overpass, Lawton Avenue viaduct, East Rembo C5 Overpass, Pamantasan Overpass, link ramps, footbridges), 37 ramps on approach roads, 21 on the bridge itself. Underpasses (`tunnel=yes`) are drawn at ground level for now.

### 4. Settle raised ways (`pipeline/settleRaised.ts`)

BGC's malls are linked by skywalks that OSM maps straight through the buildings.

- Parts of raised ways that run inside a building are cut (419 m of walkway).
- Leftover raised scraps under 6 m with a loose end are dropped.
- Ends left hanging in mid-air slope down to the ground, unless they stop at a building wall, where a skywalk really would connect (13 lowered, 22 left at walls).

### 5. Fit widths (`pipeline/fitWidths.ts`)

- Every road is measured against nearby building walls (exact segment-to-segment distance through the spatial grid) and narrowed to fit, down to 2.8 m for streets and alleys, 2.5 m for service roads and 6 m for major roads. Walls the centerline crosses are ignored (roads going under buildings). 603 of 2,211 roads narrowed.
- Buildings whose center sits on a road surface are removed.

## Projection

Equirectangular around a fixed origin (14.5509 N, 121.0503 E):

```
x = R · Δlon · cos(lat0)      (meters east)
y = R · Δlat                  (meters north)
```

Tests check it against great-circle (haversine) distance for 2,000 random point pairs across BGC: worst error under 0.05%, and under 1 m absolute. Why this projection: [ADR 0002](decisions/0002-local-projection-in-meters.md).

## Building heights

Only about 3% of buildings in the area have a `height` or `building:levels` tag, so most heights are estimated ([`pipeline/heights.ts`](../pipeline/heights.ts)):

1. `height` tag: used as is.
2. `building:levels` tag: levels x 3.2 m.
3. Building type with a typical size: houses 6 m, garages 3 m, churches 14 m, schools 13 m, and so on.
4. Otherwise footprint area: under 100 m² is 5 m, up to 1,500 m² (a typical BGC tower footprint) is 45 m, up to 4,000 m² is 80 m; bigger is treated as a mall or podium (30 m). Retail is capped at 30 m, apartments at 60 m.

Estimates get a fixed ±20% variation from a hash of the building id: rows of similar buildings don't look copy-pasted, and the same building gets the same height on every build. Why: [ADR 0005](decisions/0005-estimate-building-heights.md).

## Map QA

`npm run qa` scans the processed map for kinds of problems found while testing, prints a count per kind, and gives camera links (`?cam=...`) for the worst few. `npm run qa -- --check data/qa-baseline.json` fails if any count is above the baseline (used in CI).

| Problem | Before fixes | Now |
| --- | --- | --- |
| Walkways running inside or over a building | 9 | 0 |
| Raised ends hanging in mid-air | 10 | 0 |
| Raised scraps with a loose end | 2 | 0 |
| Buildings poking through a flyover deck | 0 | 0 |
| Buildings more than 1 m into a major road | 21 | 7 |
| Buildings more than 1 m into a street or alley | 207 | 80 |
| Buildings more than 1 m into a service road | 93 | 71 |

Most remaining service-road cases are driveways that really go into a building (parking entrances, drop-offs). The rest are houses closer than 2.8 m to the street center, or roads mapped straight through a building.

## Data format

`public/data/bgc.json` is a `MapData` object (version 3), defined in [`src/map/types.ts`](../src/map/types.ts). Field-by-field summary and the coordinate convention: [ARCHITECTURE.md, Data contract](ARCHITECTURE.md#5-data-contract).

## Known data issues

- Underpasses are drawn at ground level.
- Thin strips of ground show where carriageways split apart.
- Some houses still poke into alleys narrower than 2.8 m.
- Heights are estimates for about 97% of buildings.
