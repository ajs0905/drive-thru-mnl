# 0020. Building forms: hip roofs, podium towers and shopfronts, from data already in the map

**Status:** Accepted, 2026-11-16

## Context

Every building was a prism with a flat roof: the barangays read as a field of grey boxes and the towers as tall boxes standing straight on the sidewalk, with the same windows down to the ground. OSM has no roof shapes, podiums or shop data for nearly all of them (3% even have a height). A full building generator (facade modules, setback rules from zoning, signage text) is a project of its own; the v1 plan asks for a lite version.

## Decision

Decide a form per building at build time, in `src/geometry/buildingForm.ts`, from its type, height and footprint, seeded by its id, with no change to the map data:

- **Hip roofs** on low houses (up to 9 m, plus 60% of low untyped buildings) whose footprint fills at least 90% of its minimum bounding rectangle (rotating calipers over the hull): a hip roof over that rectangle, rising a third of its short side (at most 2.4 m), in one of six roof colors. 6 triangles each.
- **Podium towers**: towers of 40 m and up, not homes, schools or warehouses, with a footprint of at least 900 m² that's at least 92% convex: a podium of 3 to 5 floors over the whole footprint and the tower stepped back 3 m all round above it (the footprint scaled about its center, which steps every side back at least that much on a convex shape).
- **Shopfronts**: 70% of commercial, mixed and untyped buildings at least 9 m tall, and every podium, get shop windows and a band of colored signs on the ground floor instead of the upper floors' windows. A flag in the window code the building shader already reads: no geometry at all.
- Roof props skip hip roofs and stand on a podium tower's own roof.

## Consequences

- No new draw calls; 4k to 27k more triangles in the measured views (mostly hip roofs), and about 40 to 90 ms more for the city build in the headless browser (forms are worked out once per building and cached).
- Roof colors and shopfronts are guesses: real roofs in the barangays are mostly corrugated sheets in all colors, and some shop floors are lobbies. A refreshed export with `roof:shape` or `shop=*` tags could replace the guesses where they exist.
- L-shaped and odd houses stay flat-roofed; a straight-skeleton roof would cover them but costs far more than this pass.
- Facade variety beyond windows (balconies, ledges, materials) and signage text are left for later.
