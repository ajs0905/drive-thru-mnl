# 0012. Walls and trees from a second export, fitted to the roads

**Status:** Accepted, 2026-11-14

## Context

The car will need things to bump into besides buildings, and the streets looked bare. OpenStreetMap has walls, fences, hedges, guard rails, gates, parking booms, bollards and trees for BGC, but:

- They weren't in the main export (`data/bgc.overpassql`), which feeds every other pipeline step and the QA baseline.
- Coverage is thin and uneven: about 6 km of walls, fences and hedges in the playable area, 60 m of guard rail, but over 350 single trees and 90 gates.
- Mapping doesn't line up with our road surfaces: walls are drawn across driveways, and about 230 street trees sit up to 2 m inside the road as we draw it (our widths are estimates).

## Decision

- **A second Overpass query and raw file** (`data/barriers.overpassql`, `data/raw/bgc-barriers.geojson`), processed by its own step (`pipeline/barriers.ts`) at the end of the pipeline. Refreshing it can't change roads, buildings or the existing QA counts, and the pipeline still runs without it.
- **The roads win.** Walls, fences and hedges are cut open wherever they stand on a road or path surface (plus 40 cm). A gate in a wall with no road through it opens a 4 m gap. Guard rails and jersey barriers stay whole because they line roads on purpose.
- **Move before dropping.** Trees up to 2 m into a road are moved straight out to the curb; deeper ones, and trees in buildings or water, are dropped.
- **Seeded variety where tags are missing.** Palm or broadleaf from species tags; untagged trees are 25% palms, seeded per tree, so every build is identical.
- **Rendering stays cheap:** walls go into the existing structures layer (no new draw calls); trees and fixtures reuse the rooftop prop instancing, generalized to boxes, cylinders and blobs, with their own distance limit per tier.
- **Three new QA checks** (trees on roads, trees in buildings, walls across roads), all at 0 in the baseline.

## Consequences

- About 40k more triangles and 10 to 17 more draw calls depending on the view; fine on desktop, and on the list for the tiles milestone on phones.
- Gate posts and booms are approximate (pillars at the road edges, booms lowered across the lane). Booms will need to open or block once the car arrives.
- Most of the playable area still has no mapped walls; the car's limits will come mainly from buildings, medians and the playable edge.
- Traffic lights and street lamps are already in the raw export, ready for the polish milestone.
