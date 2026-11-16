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
| [`data/barriers.overpassql`](../data/barriers.overpassql) | Second query, same box: walls, fences, hedges, guard rails, gates, booms, bollards, trees, and traffic signals |
| `data/raw/bgc-barriers.geojson` | Its raw export (550 KB, 1,634 features). Optional: without it the map has no walls or trees. |
| [`data/playable-area.geojson`](../data/playable-area.geojson) | 15-point polygon around BGC, 3.51 km². Where the car can drive. |
| `public/data/bgc.json` | The processed map the game loads (3.3 MB, 779 KB gzipped). Generated: don't edit by hand. |
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
- Projects lat/long to local meters (see [Projection](#projection)), stretched 1.2x across the ground (`MAP_SCALE`, see below), rounded to centimeters.
- Road widths from tags ([`roadWidth.ts`](../pipeline/roadWidth.ts)): `width`, else `lanes` x 3.2 m plus shoulders, else typical lanes for the road type (fewer if one-way). Driveways 3.5 m, alleys 3 m. BGC's avenues are mapped as two one-way carriageways, so each half is sized as half a road. Widths are stretched by the map scale too, so lanes keep their share of the street.
- Building heights (see [Building heights](#building-heights)).
- Reads `lanes`, `oneway` and `sidewalk` (`sidewalk:left/right/both`) for drivable roads, and flags `footway=crossing` / `cycleway=crossing` ways (turned into zebras in step 7).
- Keeps the street parking tags that rule parking out (`parking:<side>=no` and the older `parking:lane:<side>=no_parking` forms) as `noParking`.
- Drops clutter the renderer covers in other ways: 452 separately mapped sidewalks (the road's own sidewalk tag draws a sidewalk band instead; footbridges and stairs are kept) and 80 parking aisles.
- Drops what shouldn't be drawn outdoors: 29 indoor corridors and mall stairs, 5 underground walkways, 4 basement-level buildings. Canopies (`building=roof`: gas stations, covered walkways) float at 3.6 m as thin slabs.
- Cleans up duplicate points, repeated closing points and degenerate shapes. Everything skipped is counted with a reason.

### 2. Clip (`pipeline/clip.ts`)

Overpass returns every way and relation that touches the export box, so the raw export reaches about 11.6 x 7.7 km even though the box is 3 x 3 km.

- Inside the playable polygon: **playable**.
- Within 300 m outside it: **scenery** (drawn, not drivable).
- Farther out: dropped.
- Roads are kept per segment, because a long segment can cross the area with both ends outside it. Road ends and huge land-use areas are trimmed to the box around the area (Liang-Barsky for lines, Sutherland-Hodgman for polygons).

Result: 3.6 x 3.1 km, 6,355 playable buildings, 5,332 scenery, 9,187 dropped (after the later steps remove a few).

### 3. Elevation (`pipeline/elevation.ts`)

OSM marks bridges (`bridge=yes`, `viaduct`, `layer=1`) but not their height or where the slope starts.

1. Roads connect where they share a point (the same OSM node), within their own network. A footbridge node that sits on a road (a common OSM shortcut) doesn't lift the road, and a path that touches a flyover isn't lifted either.
2. Connected bridge pieces form chains (union-find). A chain is raised only if some piece **crosses over another road** (spatial grid crossing test). Small bridges over creeks stay on the ground: 30 of them.
3. Decks sit at layer x 7 m (roads) or 6 m (footbridges).
4. The approach road becomes the ramp: it climbs over up to 90 m and stops at the first junction, so side streets don't get lifted. Footbridges only come down by stairs or by sloping the bridge; a sidewalk never rises to meet one.
5. **A ramp never rises inside another road's lanes.** Wherever its surface overlaps a ground road (a gore where it splits from a frontage road, a main road running close alongside, a street passing under), it's either still at ground level or already 4 m up, high enough to pass over. The climb is shortened until that holds. Found by driving: a ramp splitting from a frontage road at a shallow angle used to climb, barrier and all, inside the frontage road's lanes for up to 25 m.
6. If the ground side has no room (a junction at the foot of the bridge, or a long overlap), the bridge itself slopes down instead, staying at ground level as long as it overlaps a road alongside, and always clearing roads it crosses. Plans are tried in order: a ramp of at least 45 m on the ground (steepest point about 23%), the bridge slope, a ramp of at least 25 m, and only if none fits, the full ramp even if it overlaps (some overlap beats a deck at car height across a road).
7. Ramps follow a smoothstep curve, with extra points inserted so the slope is a curve.

Result: 70 raised pieces (Kalayaan Overpass, Lawton Avenue viaduct, East Rembo C5 Overpass, Pamantasan Overpass, link ramps, footbridges), 35 ramps on approach roads, 21 on the bridge itself; 8 climbs moved to stay out of other lanes. 5 still overlap a road running right alongside (their mapped widths overlap at any height); in 3 of them a side wall stands in the other road's lanes, which map QA counts. Underpasses (`tunnel=yes`) are drawn at ground level for now.

### 4. Settle raised ways (`pipeline/settleRaised.ts`)

BGC's malls are linked by skywalks that OSM maps straight through the buildings.

- Parts of raised ways that run inside a building are cut (471 m of walkway).
- Leftover raised scraps under 6 m with a loose end are dropped.
- Ends left hanging in mid-air slope down to the ground, unless they stop at a building wall, where a skywalk really would connect (12 lowered, 22 left at walls).

### 5. Round raised curves (`pipeline/smoothRaised.ts`)

- OSM draws curves as a few straight pieces. On a 7 m deck with concrete edges, corners of 25 to 40 degrees read as a cut, faceted shape (a U-turn loop looked like an octagon).
- Points are added along a Catmull-Rom spline (centripetal) through the existing ones until no corner on a drivable flyover or ramp turns more than 6 degrees. Existing points stay put, so joints with other roads don't move; heights are interpolated. Footbridges keep their square corners.
- Result: 22 flyovers and ramps rounded, 316 points added.

### 6. Fit widths (`pipeline/fitWidths.ts`)

- Every road is measured against nearby building walls (exact segment-to-segment distance through the spatial grid) and narrowed to fit, down to 2.8 m for streets and alleys, 2.5 m for service roads and 6 m for major roads. Walls the centerline crosses are ignored (roads going under buildings). 565 of 2,057 roads narrowed.
- Buildings whose center sits on a road surface are removed.
- **Walls cut back off the road.** Where a building still reaches more than 0.3 m into a road's surface after the narrowing (houses mapped onto the street, mostly along the alleys of the barangays), its footprint is clipped along the road's edge plus 0.2 m (a half-plane clip). Roads whose centerline runs through the building (passages, driveways into car parks) are left alone, as are raised buildings, courtyard buildings and, by service roads, buildings of 2,000 m² and up (malls and towers whose access roads hug them). A building that would lose more than half its footprint is dropped. 325 cut back, 2 dropped.
- **Buildings inside other buildings** ([`overlaps.ts`](../pipeline/overlaps.ts)). OSM sometimes has the same building twice, a construction site outline still drawn around the finished tower, or a building mapped inside a bigger one. Where at least 90% of one footprint lies inside another (sampled on a grid, courtyards excluded), the inner one goes if it's hidden (it starts no lower and ends no higher), and a construction outline goes if the building inside it is taller. Towers rising from a podium, spires and shops under a raised building stay. Found from a screenshot: an office tower poking out of the box of its old construction site. 5 hidden buildings and 1 construction outline removed.

### 7. Close median slivers (`pipeline/medians.ts`)

- Divided roads are mapped as two one-way roads. Where their fitted widths leave a gap of under 1.2 m between them (parallel within 12 degrees, along at least 40% of the road), the ground or a sidewalk band shows through as a thin light line. Both carriageways are widened by the gap so they meet. Wider gaps are real medians and stay. 30 carriageways widened.

### 8. Junctions (`pipeline/junctions.ts`)

- OSM ways often run straight through an intersection, so drivable roads are first split at every node where three or more road segments meet (802 splits). Now every junction sits at road ends.
- At each node where road ends meet, the junction polygon comes from the road edges ([`src/geometry/junction.ts`](../src/geometry/junction.ts)): arms are sorted by angle, the left edge of each arm is intersected with the right edge of the next, and each road is cut back to where its edges meet its neighbours'. The space in the middle becomes one polygon; the cut-back distance per road end is stored as `trim`.
- Special cases: the outside of a bend gets a straight edge, a straight join where the width changes gets a short taper, sharp merges wrap around both arms, and two pieces of the same road continuing straight need no polygon (360).
- Curved roads: each arm's direction is first taken toward the point 1 m along the road, then re-aimed twice at the point where the road actually gets cut back, so the polygon follows the curve.
- Divided roads crossing: each carriageway crossing gets its own polygon, and the short pieces between them get cut away from both ends. Junctions joined by a piece with less than 3 m left are merged (union-find) into one convex polygon (Andrew's monotone chain hull), as long as it stays under 80 m across; the pieces inside aren't drawn. 119 merged polygons from 268 junctions.
- Result: 1,384 junction polygons. 19 knots too tangled for a clean polygon (it would cross itself) fall back to overlapping road ends.
- The renderer also paves each road's cut-back stretch as plain asphalt under the polygon, so a polygon that doesn't follow the road exactly never leaves a gap.
- Fills in `lanes` for every drivable road: the tag if it fits the (possibly narrowed) width, otherwise width / 3.3 m.

### 9. Crossings (`pipeline/crossings.ts`)

- Mapped crossing ways often run past the curb, bend around corners, or are drawn along the road instead of across it, so painting stripes along the way itself looks wrong.
- Instead, each crossing way is intersected with drivable road centerlines (spatial grid). Where it cuts across one at more than 35 degrees, a straight 3 m zebra goes across that road from edge to edge; a divided road gets one per carriageway. Crossings under a flyover don't paint the deck, and footbridges are skipped.
- OSM usually puts the crossing node right at the junction, so a zebra that would land inside a junction polygon is moved back along its road to just outside it (up to 12 m). A zebra overlapping one already placed (separating axis test) is dropped, as is one on a piece fully covered by a merged junction.
- The bars are drawn over the crossed road's own asphalt color, so lane lines don't show through.
- Result: 511 zebras from 403 crossing ways (104 moved out of junctions); 14 ways cross no road and 26 hits were too shallow (ways mapped along the road). The crossing ways themselves are dropped from the map.

### 10. Road layers (`pipeline/roadLayers.ts`)

- Roads of different classes are drawn at slightly different heights already, but two of the same class that overlap (parallel carriageways meeting at a median, a ramp and the road it splits from) were drawn in exactly the same plane. The GPU can't tell which is in front, so their lane lines flickered as the camera moved (z-fighting).
- Every pair of same-class roads whose surfaces overlap at the same height, away from where they simply meet, is found (sampled every 2 m through the spatial grid). Each road then gets a drawing layer so no two overlapping roads share one (greedy graph coloring, most-connected first), stored as `lift`. The renderer draws each layer 4 mm higher: invisible, but it decides which is on top.
- Result: 819 roads overlap another of their class; 480 are lifted, in 4 layers.

### 11. Pave enclosed gaps (`pipeline/paving.ts`)

- Even with the steps above, mapping quirks leave small patches of ground fully surrounded by road: tiny triangles between junctions a few meters apart, slivers between roads that almost touch.
- Found by rasterizing exactly what the renderer paves (road ribbons with their cut-back ends, junction polygons, gap discs) on a 0.5 m grid around every junction, then flood-filling the unpaved cells from the grid's edge. Unpaved cells the fill can't reach are enclosed.
- Holes up to 10 m², and thin slivers (under 1.2 m thick on average), get patch polygons drawn just under the road surfaces. Long slivers are paved in 8 m chunks so each chunk's convex hull follows curves. A second pass catches crumbs at the patches' edges. Bigger enclosed areas are often real (parking loops, roundabout centers, slip-lane islands) and stay; map QA counts them.

### 12. Walls, trees and street fixtures (`pipeline/barriers.ts`)

From the second export. Kept as a separate step and file so refreshing it never changes the roads or buildings.

- **Walls, fences, hedges, guard rails** (`barrier=*` ways; closed ones like the Manila Golf Club wall come as polygons and are walked as outlines). Heights from `height` tags, else 2.4 m walls, 1.2 m retaining walls, 1.8 m fences, 1.3 m hedges, 0.8 m rails. Clipped like roads.
- Walls, fences and hedges are **cut open wherever they stand on a road or path** (sampled every 25 cm against the road surface plus 40 cm), so a mapped wall never blocks a street. Guard rails and jersey barriers line roads on purpose and stay whole. A gate in a wall with no road through it opens a 4 m gap.
- **Trees** from `natural=tree` nodes and `natural=tree_row` lines (one every 8 m). Palms from `leaf_cycle=palm` or the species (royal palms, coconuts and others); broadleaf for other tagged species; untagged ones are 25% palms, seeded per tree. Size from a `height` tag or seeded. Trees up to 2 m into a road are street trees mapped a little off and are moved to the curb; deeper ones, and trees in buildings, in water or on top of another tree, are dropped. A tree whose crown would reach into a flyover or footbridge (or its barrier) is moved away by up to 4 m, or dropped; small trees that fit under a high deck stay.
- **Fixtures**: gates and parking booms are turned across the road they sit on and sized to it; bollards and concrete blocks stay where mapped. Lowered-curb points are ignored. Traffic signal nodes are passed on to step 16; the 6 mapped street lamps are ignored (step 16 places them by rule).
- Result: 44 barrier pieces (6.5 km, 25 openings), 922 trees (241 palms; 185 moved to the curb, 8 moved away from a flyover, 9 dropped beside one), 137 gates, 70 booms, 52 bollards, 12 blocks.

### 13. Pillars and posts (`pipeline/structures.ts`)

Placed once here, so the renderer and the car's collisions use the same ones (`pillars` in the data).

- **Deck pillars** go along each flyover and footbridge every 30 m (14 m for footbridges), wherever the deck's underside is more than 2 m up, but never in a lane below. A pillar that would land in one slides along the deck (up to half a spacing either way) to the nearest clear spot. A two-way avenue at least 10 m wide running along the deck may have it on its centerline, where its median is (viaducts built over an avenue stand in its median), so the pillar may also shift sideways under the deck to line up with one. If nothing under the deck is clear (a viaduct mapped right over a road), it stands up to 2.5 m beside the deck with a cap beam reaching under it, like a real outrigger pier.
- **Posts under raised buildings.** Buildings that start above the ground (canopies over driveways, a building over a passage) used to float. They get slim posts (0.35 m for canopies, 0.8 m for whole buildings) along their outline every 10 m at most, except along walls that lean on another building (skybridges, wings) and except on roads.
- **Curbs.** A road deck's pillar gets a low concrete curb around its base (0.3 m high, 0.45 m past its sides, corners cut), where the curb stays as far out of the lanes below as the pillar itself must. It's drawn and solid, so the pillars look planted and the car glances off the cut corners instead of catching a square one.
- Result: 279 deck pillars (99 moved off a road below, 29 on outrigger piers, 12 spots spanned instead, mostly footbridges over wide roads; 137 with a curb) and 265 posts under 22 raised buildings and canopies.

### 14. Empty lots, walls and open zones (`pipeline/lots.ts`)

BGC has a lot of empty land: construction sites, vacant blocks, mapped grass. Driving into one used to be a short cut across open dirt that broke the streets up. Now most of it is closed off at the back of the sidewalk, the way a street racer channels the player down its roads, and three places are left open on purpose.

- **Which land.** Construction land use gets ribbed metal **hoarding** (2.4 m, posts every 2.4 m); greenfield, brownfield, vacant land and mapped grass a plastered **lot wall** (2.2 m, pillars every 4 m); other parks a 1.1 m **hedge**. Two big parks stay as they are (Track 30th and Burgos Circle), and three zones are opened up: **Terra 28th** (lamps along its edge, benches by its paths, a pavilion and tree clusters), the **Simon Mann sports field**, and the **surface parking by Kalayaan Avenue** (paved, 232 stalls from the mapped parking aisles, wheel stops, a booth by the entrance and 125 parked cars, half full).
- **Where the wall goes.** Each lot is drawn on a 1 m grid: cells inside its outline, minus anything within a road's half width plus its sidewalk plus 1 m (OSM's land use often runs to the middle of the street), minus buildings and land outside the playable area. Lots under 1,200 m² or narrower than 12 m are skipped. The free cells are traced into outlines (through the middles of the cell sides, so a diagonal edge comes out straight rather than as a staircase) and simplified by 0.8 m, less than the 1 m kept from the sidewalk, so a wall never reaches a street. Edges backing onto a building or the playable edge get no wall.
- **Ways in.** Every wall piece is sampled every 25 cm: where it would cross a footpath it becomes a row of bollards (open to people, closed to cars), and where it crosses a driveway that runs into the lot it becomes a gate piece of its own (`lot/<id>/<n>/gate`), so map QA knows it closes the road on purpose.
- **Inside.** Construction yards get stacked shipping containers, pipe stacks, crates, dumpsters, work lights and dirt mounds, and the biggest (12,000 m² and up) a tower crane, at most 3. Vacant lots get a few mounds. None of it is solid: the car can't get in.
- Result: 51 lots closed (16 construction, 14 vacant, 21 gardens): 6.4 km of hoarding, 4.6 km of lot wall, 4.5 km of hedge, 31.8 ha closed off, with 97 footpath openings and 11 gates; 4.0 ha opened up. Why and what it costs: [ADR 0018](decisions/0018-world-channelling.md).

### 15. Parked cars (`pipeline/parking.ts`)

OSM barely maps street parking in BGC: 25 ways carry parking tags, all "no parking" or "no stopping" (kept by extract as `noParking` and respected here). So the cars are placed by rule.

- Only minor streets, and only where a car can still get past: at least 3.2 m of road left beside the parked cars on a one-way street, 5.6 m on a two-way one. Most village streets are too narrow and stay empty (a parked car would block them). One-way streets park on the right curb only (traffic keeps right, and the left of a one-way street is often the median of a divided one: cars there looked parked in the inner lane); two-way streets on both sides, or one if there's only room for one, each side facing its own traffic.
- Along each side, slots are 6.2 m apart, grouped into stretches of 3 to 8 slots. 40% of stretches stay empty and the rest are half filled by a seeded coin: about 30% of slots overall, with long empty runs as well as gaps (the first version filled 60% evenly, which looked crowded). A slot is skipped near a junction (4 m past the junction polygon), on a sharp bend, near a crossing, a gate, boom or bollard (likely a driveway), a tree trunk or a pillar, and anywhere the car would stand in a junction, another road's lanes, a building, across a wall or the playable edge.
- Model (sedan, hatchback, SUV, pickup, van, taxi) and paint (mostly white, silver, grey and black, some reds and blues) are picked by weight from the same seed, so the same map always gets the same cars.
- Result: 981 cars on 448 streets out of 4,341 curb slots (skipped: crossing 119, another road joining 60, outside the playable area 50, bend 12, fixture 10, wall 3).

### 16. Street and traffic lights (`pipeline/lights.ts`)

Poles with an arm reaching out over the road, as dressing (so they're drawn, solid and checked like the rest of the street furniture). Real sizes next to the 1.71 m sedan: street lights 8 m with a 2.6 m arm, traffic lights on a 6.2 m mast with a 4.5 m arm, a 3.6 m pole on narrow streets, signal heads 1 m tall, park lamps 4.5 m.

- **Traffic lights** from the 132 mapped signal nodes, on the far side of the junction, the way they stand on Metro Manila's avenues. A node at or within 15 m of a junction signalizes the junction. Junctions joined by a road with less than 25 m between them (the links across a divided avenue's median) count as one intersection. Every road arriving at the intersection from outside it (one-way roads only where they flow in) gets one light: follow the approach straight through the intersection (at each junction, the road leaving within 35 degrees of the way the traffic goes, across the median links), and put the light on the right-hand curb of the road it leaves on, 1.2 m past the junction polygon or 1 m past a zebra crossing there, its arm over the lanes the traffic is heading into and its heads facing back at it. A short piece of road past the junction (split for a crossing, say) is carried on into the road after it. Nothing stands at the stop line, so a driver stopped there looks across the junction at the light, and each corner gets one pole. Roads 9 m and wider get a mast arm, narrower ones a light on a short pole. With no road straight ahead (the stem of a T) or no room on it, the light goes on a short pole on the far curb across the junction, in line with the approach's right-hand curb (no lanes there for an arm to hang over). Widest roads first, and at most one light within 9 m. A pole that would stand in another road or a junction's paving, on a footpath, beside a crossing's band, in a building, against a wall, under a flyover deck, or with its heads not facing along a road slides on along the curb up to 6 m. A node away from any junction (and more than 30 m from a signalized one) is a mid-block crossing: one light per direction, just past the crossing.
- **Room around poles.** Every pole keeps 0.5 m from what's drawn of the furniture already there (a shed's roof and a kiosk's awning reach past their footprints: `DRAWN` in `src/geometry/dressing.ts`) and from parked cars, 1 m along the road from a zebra crossing's band, and stays out from under flyover decks and raised buildings its pole or arm would reach into.
- **Street lights** by rule, every 32 m on avenues (both curbs, staggered; one-way carriageways only their outer, right-hand curb) and every 40 m on one side of minor streets at least 7 m wide, arm over the road. A light that can't stand at its spot tries up to 3 m either way along the curb, then is skipped: near junctions, crossings, driveways, trees and pillars, on bends and footpaths, in other roads and buildings, against walls, under decks and outside the playable area.
- Placed before the sidewalk furniture, which then keeps clear of the poles.
- Result: 130 traffic lights on mast arms and 32 on poles (18 of them on the far curb across a junction) at 56 junctions in 49 intersections, 1,195 street lights (94 of them nudged along the curb; skipped: outside the playable area 115 plus 2 traffic lights, another road 73 plus 6, crossing 40, building 30, junction 18, a second light on a corner 1, and a few for pillars, footpaths, flyover decks, driveways, walls and bends). The first version put each light at its approach's stop line; the map QA check for that now finds 0 (it finds 104 in the old placement).

### 17. Sidewalk furniture (`pipeline/sidewalks.ts`)

Solid street furniture, so the sidewalks read as the edge of the street rather than an extra lane.

- Waiting sheds along the avenues (about every 260 m, against the back of the sidewalk, facing the road), planters along the avenues' curbs (every 34 m), bins (90 m) and fire hydrants (160 m) on every street with a sidewalk, and a few snack kiosks by the open parks. Each spacing is varied by a seeded amount per street side, so the streets don't line up.
- A piece is skipped near a junction, a crossing, a driveway (gate, boom or bollard), a tree trunk or a pillar, on a sharp bend, on a footpath, in another road or a building, across a wall, outside the playable area, and where it would crowd another piece (1 m kept between them).
- Result: 842 bins, 578 planters, 481 hydrants, 68 waiting sheds and 4 kiosks (skipped: another road 347, outside the playable area 343, crowded 254 (mostly by the street lights; pieces keep their room from what's drawn, roofs and awnings included), building 119, crossing 88, junction 41, bend 17, pillar 14, footpath 14, wall 8, tree 3, fixture 3).
## Projection

Equirectangular around a fixed origin (14.5509 N, 121.0503 E):

```
x = R · Δlon · cos(lat0)      (meters east)
y = R · Δlat                  (meters north)
```

Tests check it against great-circle (haversine) distance for 2,000 random point pairs across BGC: worst error under 0.05%, and under 1 m absolute. Why this projection: [ADR 0002](decisions/0002-local-projection-in-meters.md).

The game world is then **1.2x bigger than the real one across the ground** (`MAP_SCALE` in [`src/geo/projection.ts`](../src/geo/projection.ts), stored as `scale` in the map data): distances, footprints and road widths are stretched, while heights, the car, trees and props stay real size. At driving speed the real BGC felt small. Why and what it costs: [ADR 0017](decisions/0017-map-scale.md).

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
| Buildings more than 1 m into a major road | 21 | 0 |
| Buildings more than 1 m into a street or alley | 207 | 1 |
| Buildings more than 1 m into a service road | 93 | 42 |
| Junction polygons reaching far past their roads | (new) | 0 |
| Zebras overlapping each other or inside a junction | 76 | 0 |
| Enclosed unpaved patches at junctions (holes, slivers) | 140 | 27 (real islands up to 60 m²) |
| Trees standing on a road | (new) 226 before moving and dropping | 0 |
| Trees inside a building | (new) | 0 |
| Walls, fences or hedges across a road or path | (new) | 0 |
| Pillars or posts standing in a lane below | (new) 55 | 0 |
| Ramps rising inside another road's lanes | (new) 9 | 3 (mapped widths overlap a road alongside) |
| Trees with their crown in a flyover | (new) 20 | 0 |
| Raised buildings with nothing holding them up | (new) 13 | 0 |
| Gaps where two deck pieces meet | (new) | 0 |
| Overlapping same-class roads drawn in one plane (flicker) | (new) 758 pairs | 0 |
| Parked cars in the way (junction, another road, crossing, building, wall, edge) | (new) 2 | 0 |
| Buildings hidden inside another, or a construction outline around a finished one | (new) 6 | 0 |
| Lot walls across a road or path (beyond their gates) | (new) 30 | 0 |
| Solid street furniture in a road, on a path or in a building | (new) | 0 |
| Traffic lights not facing along a road beside them (or the road they look back at across a junction), or with the mast arm not over it | (new) | 0 |
| Traffic lights on the near side: a junction or crossing right behind them and nothing to control in front of their heads | 104 (stop-line placement) | 0 |
| Two traffic lights within 4 m | 3 | 0 |
| Poles beside a zebra crossing's band | 85 | 0 |
| Poles or their arms reaching into a flyover deck or a raised building | 4 | 0 |
| Solid furniture drawn into other solid furniture (a pole through a roof or awning) | (new) | 0 |
| Drivable roads in a piece of the road network that joins no other road (away from the playable edge) | (new) 24 | 24 (about 1 km: crossings drawn without a shared node) |

The remaining service-road cases are driveways that really go into a building (parking entrances, drop-offs) and access roads hugging a mall or tower, which are left as mapped. The one street case is a road mapped straight through a building.

## Data format

`public/data/bgc.json` is a `MapData` object (version 7), defined in [`src/map/types.ts`](../src/map/types.ts). Field-by-field summary and the coordinate convention: [ARCHITECTURE.md, Data contract](ARCHITECTURE.md#5-data-contract).

## Known data issues

- Underpasses are drawn at ground level.
- Three ramps run so close alongside a main road that their mapped widths overlap it, so their side walls stand a little inside its outer lane: way/25887527, way/139045456, way/671963979 (map QA `ramp-in-lanes`).
- Thin strips of ground show where carriageways split apart.
- Zebras are always square to the road, even where the mapped crossing is diagonal.
- Lane counts are guesses where `lanes` isn't tagged (about half of the roads).
- Heights are estimates for about 97% of buildings.
