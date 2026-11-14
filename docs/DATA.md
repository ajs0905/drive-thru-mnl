# Map data

Where the map comes from and what the pipeline does to it. For how this fits into the rest of the system, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Sources and licenses

| What | Where | License |
| --- | --- | --- |
| Roads, buildings, land use, water; walls, fences, trees, gates | [OpenStreetMap](https://www.openstreetmap.org), exported with [overpass-turbo](https://overpass-turbo.eu) | [ODbL](https://www.openstreetmap.org/copyright). Shown as "© OpenStreetMap contributors" in the game and README. |
| Playable area outline | Drawn by hand in [geojson.io](https://geojson.io) | Part of this repo |

ODbL lets us use and adapt the data, including in a public project, as long as it's attributed and the processed database is shared under the same license.

## Files

| File | What it is |
| --- | --- |
| [`data/bgc.overpassql`](../data/bgc.overpassql) | The Overpass query: roads, buildings, land use, parks and water in the box 14.5370, 121.0370 to 14.5650, 121.0640 |
| `data/raw/bgc.geojson` | The raw export (19 MB, about 25,900 features) |
| [`data/barriers.overpassql`](../data/barriers.overpassql) | Second query, same box: walls, fences, hedges, guard rails, gates, booms, bollards, trees, plus traffic lights and street lamps for later |
| `data/raw/bgc-barriers.geojson` | Its raw export (550 KB, 1,634 features). Optional: without it the map has no walls or trees. |
| [`data/playable-area.geojson`](../data/playable-area.geojson) | 15-point polygon around BGC, 3.51 km². Where the car can drive. |
| `public/data/bgc.json` | The processed map the game loads (3.1 MB, 751 KB gzipped). Generated: don't edit by hand. |
| `public/data/sample.json` | Tiny map built from the test fixture, used when `bgc.json` is missing |
| `data/qa-baseline.json` | Accepted map QA counts; CI fails if a count goes above it |

## Refreshing the data

Only needed for newer OpenStreetMap edits or a different area:

1. Open [overpass-turbo.eu](https://overpass-turbo.eu), paste the query from `data/bgc.overpassql`, click **Run**.
2. **Export > GeoJSON > download**, save it as `data/raw/bgc.geojson`.
3. Same for `data/barriers.overpassql`, saved as `data/raw/bgc-barriers.geojson`. If overpass-turbo says `duplicate_query`, wait a minute and run once, or pick another server under Settings.
4. `npm run pipeline` to rebuild `public/data/bgc.json`.
5. `npm run qa` to check for regressions. If counts went down, update `data/qa-baseline.json` (`npm run qa -- --json > data/qa-baseline.json`).

To change the drivable area, open `data/playable-area.geojson` at geojson.io, drag the points, save, and run the pipeline again.

## Pipeline steps

`npm run pipeline` runs these in order (see `pipeline/build.ts`). Each prints what it changed.

### 1. Extract (`pipeline/extract.ts`)

- Reads tags in both overpass-turbo formats and classifies each feature: building, road (major, minor, service, path), park, water, land use, or pedestrian plaza.
- Projects lat/long to local meters (see [Projection](#projection)), rounded to centimeters.
- Road widths from tags ([`roadWidth.ts`](../pipeline/roadWidth.ts)): `width`, else `lanes` x 3.2 m plus shoulders, else typical lanes for the road type (fewer if one-way). Driveways 3.5 m, alleys 3 m. BGC's avenues are mapped as two one-way carriageways, so each half is sized as half a road.
- Building heights (see [Building heights](#building-heights)).
- Reads `lanes`, `oneway` and `sidewalk` (`sidewalk:left/right/both`) for drivable roads, and flags `footway=crossing` / `cycleway=crossing` ways (turned into zebras in step 7).
- Drops clutter the renderer covers in other ways: 452 separately mapped sidewalks (the road's own sidewalk tag draws a sidewalk band instead; footbridges and stairs are kept) and 80 parking aisles.
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

- Every road is measured against nearby building walls (exact segment-to-segment distance through the spatial grid) and narrowed to fit, down to 2.8 m for streets and alleys, 2.5 m for service roads and 6 m for major roads. Walls the centerline crosses are ignored (roads going under buildings). 598 of 2,141 roads narrowed.
- Buildings whose center sits on a road surface are removed.

### 6. Close median slivers (`pipeline/medians.ts`)

- Divided roads are mapped as two one-way roads. Where their fitted widths leave a gap of under 1.2 m between them (parallel within 12 degrees, along at least 40% of the road), the ground or a sidewalk band shows through as a thin light line. Both carriageways are widened by the gap so they meet. Wider gaps are real medians and stay. 64 carriageways widened.

### 7. Junctions (`pipeline/junctions.ts`)

- OSM ways often run straight through an intersection, so drivable roads are first split at every node where three or more road segments meet (875 splits). Now every junction sits at road ends.
- At each node where road ends meet, the junction polygon comes from the road edges ([`src/geometry/junction.ts`](../src/geometry/junction.ts)): arms are sorted by angle, the left edge of each arm is intersected with the right edge of the next, and each road is cut back to where its edges meet its neighbours'. The space in the middle becomes one polygon; the cut-back distance per road end is stored as `trim`.
- Special cases: the outside of a bend gets a straight edge, a straight join where the width changes gets a short taper, sharp merges wrap around both arms, and two pieces of the same road continuing straight need no polygon (359).
- Curved roads: each arm's direction is first taken toward the point 1 m along the road, then re-aimed twice at the point where the road actually gets cut back, so the polygon follows the curve.
- Divided roads crossing: each carriageway crossing gets its own polygon, and the short pieces between them get cut away from both ends. Junctions joined by a piece with less than 3 m left are merged (union-find) into one convex polygon (Andrew's monotone chain hull), as long as it stays under 80 m across; the pieces inside aren't drawn. 144 merged polygons from 334 junctions.
- Result: 1,452 junction polygons. 18 knots too tangled for a clean polygon (it would cross itself) fall back to overlapping road ends.
- The renderer also paves each road's cut-back stretch as plain asphalt under the polygon, so a polygon that doesn't follow the road exactly never leaves a gap.
- Fills in `lanes` for every drivable road: the tag if it fits the (possibly narrowed) width, otherwise width / 3.3 m.

### 8. Crossings (`pipeline/crossings.ts`)

- Mapped crossing ways often run past the curb, bend around corners, or are drawn along the road instead of across it, so painting stripes along the way itself looks wrong.
- Instead, each crossing way is intersected with drivable road centerlines (spatial grid). Where it cuts across one at more than 35 degrees, a straight 3 m zebra goes across that road from edge to edge; a divided road gets one per carriageway. Crossings under a flyover don't paint the deck, and footbridges are skipped.
- OSM usually puts the crossing node right at the junction, so a zebra that would land inside a junction polygon is moved back along its road to just outside it (up to 12 m). A zebra overlapping one already placed (separating axis test) is dropped, as is one on a piece fully covered by a merged junction.
- The bars are drawn over the crossed road's own asphalt color, so lane lines don't show through.
- Result: 511 zebras from 405 crossing ways (122 moved out of junctions); 14 ways cross no road and 25 hits were too shallow (ways mapped along the road). The crossing ways themselves are dropped from the map.

### 9. Pave enclosed gaps (`pipeline/paving.ts`)

- Even with the steps above, mapping quirks leave small patches of ground fully surrounded by road: tiny triangles between junctions a few meters apart, slivers between roads that almost touch.
- Found by rasterizing exactly what the renderer paves (road ribbons with their cut-back ends, junction polygons, gap discs) on a 0.5 m grid around every junction, then flood-filling the unpaved cells from the grid's edge. Unpaved cells the fill can't reach are enclosed.
- Holes up to 10 m², and thin slivers (under 1.2 m thick on average), get patch polygons drawn just under the road surfaces. Long slivers are paved in 8 m chunks so each chunk's convex hull follows curves. A second pass catches crumbs at the patches' edges. Bigger enclosed areas are often real (parking loops, roundabout centers, slip-lane islands) and stay; map QA counts them.

### 10. Walls, trees and street fixtures (`pipeline/barriers.ts`)

From the second export. Kept as a separate step and file so refreshing it never changes the roads or buildings.

- **Walls, fences, hedges, guard rails** (`barrier=*` ways; closed ones like the Manila Golf Club wall come as polygons and are walked as outlines). Heights from `height` tags, else 2.4 m walls, 1.2 m retaining walls, 1.8 m fences, 1.3 m hedges, 0.8 m rails. Clipped like roads.
- Walls, fences and hedges are **cut open wherever they stand on a road or path** (sampled every 25 cm against the road surface plus 40 cm), so a mapped wall never blocks a street. Guard rails and jersey barriers line roads on purpose and stay whole. A gate in a wall with no road through it opens a 4 m gap.
- **Trees** from `natural=tree` nodes and `natural=tree_row` lines (one every 8 m). Palms from `leaf_cycle=palm` or the species (royal palms, coconuts and others); broadleaf for other tagged species; untagged ones are 25% palms, seeded per tree. Size from a `height` tag or seeded. Trees up to 2 m into a road are street trees mapped a little off and are moved to the curb; deeper ones, and trees in buildings, in water or on top of another tree, are dropped.
- **Fixtures**: gates and parking booms are turned across the road they sit on and sized to it; bollards and concrete blocks stay where mapped. Lowered-curb points are ignored; traffic lights and street lamps are kept in the raw export for the polish milestone.
- Result: 43 barrier pieces (5.9 km, 27 openings), 919 trees (254 palms; 190 moved to the curb), 158 gates, 72 booms, 54 bollards, 12 blocks.

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
| Buildings more than 1 m into a service road | 93 | 68 |
| Junction polygons reaching far past their roads | (new) | 0 |
| Zebras overlapping each other or inside a junction | 76 | 0 |
| Enclosed unpaved patches at junctions (holes, slivers) | 140 | 37 (real islands up to 60 m²) |
| Trees standing on a road | (new) 226 before moving and dropping | 0 |
| Trees inside a building | (new) | 0 |
| Walls, fences or hedges across a road or path | (new) | 0 |

Most remaining service-road cases are driveways that really go into a building (parking entrances, drop-offs). The rest are houses closer than 2.8 m to the street center, or roads mapped straight through a building.

## Data format

`public/data/bgc.json` is a `MapData` object (version 6), defined in [`src/map/types.ts`](../src/map/types.ts). Field-by-field summary and the coordinate convention: [ARCHITECTURE.md, Data contract](ARCHITECTURE.md#5-data-contract).

## Known data issues

- Underpasses are drawn at ground level.
- Thin strips of ground show where carriageways split apart.
- Zebras are always square to the road, even where the mapped crossing is diagonal.
- Lane counts are guesses where `lanes` isn't tagged (about half of the roads).
- Some houses still poke into alleys narrower than 2.8 m.
- Heights are estimates for about 97% of buildings.
