# 0005: Rule-based building height estimates

**Status:** Accepted

**Context.** Only about 3% of buildings in the area have a `height` or `building:levels` tag. Without heights the city is flat; with one default height it looks like a grid of identical boxes.

**Decision.** Use real tags when present, otherwise estimate from building type (houses 6 m, garages 3 m, churches 14 m, ...) and footprint area (small footprints low, tower-sized footprints tall, very large footprints treated as malls/podiums). Add a fixed ±20% variation from a hash of the OSM id. Rules live in `pipeline/heights.ts`.

**Consequences.**
- BGC reads as BGC: a tall core, low neighborhoods, wide malls.
- Same building, same height on every build (deterministic).
- Individual towers can be noticeably wrong. Landmarks can get manual overrides later; better OSM tagging improves results automatically.
