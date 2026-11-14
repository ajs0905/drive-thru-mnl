# 0010: Building windows in a shader, roof details as instances

**Status:** Accepted

**Context.** Buildings were flat colored prisms, which read as blocks rather than a city. They need windows and some rooftop clutter. Window textures would need per-wall UVs, several texture variants per building type, and mipmapping makes thin frames shimmer; modeling each window as geometry would multiply the triangle count by hundreds. Real OSM footprints rule out pre-made building models.

**Decision.** Same approach as the road markings ([ADR 0009](0009-road-markings-in-a-shader.md)). Each wall vertex carries meters along the wall, meters up, the wall's length and a packed style (kind, variant, number of floors). A patched Lambert material (`src/scene/buildingMaterial.ts`) draws the windows: an exact number of columns per wall so windows are never cut at corners, 3.2 m floors, a per-window tint from a hash, and a blend to the average facade color once windows get smaller than a few pixels. The style comes from the building type and height (`windowStyle` in `src/scene/cityGeometry.ts`): glass curtain walls, office grids, apartment rows, house windows, open parking decks, or none for warehouses and canopies.

Roof details (stair/elevator housings, AC units, water tanks) are placed in plain code (`src/geometry/roofProps.ts`, seeded by the building id, aligned with the longest wall, only where they fit) and drawn as two instanced meshes, with their hidden bottom faces removed.

**Consequences.**
- Every building gets windows at no texture cost and with no extra draw calls for the walls; the facades stay sharp up close and calm in the distance.
- Roof details add 2 draw calls and about 38k triangles (about 2,800 instances). Low-tier phones may hide them (see [PERFORMANCE.md](../PERFORMANCE.md)).
- Windows are a daytime look only; lit windows at night would be another mode for the day/night cycle later.
- Floor lines are uniform 3.2 m, so buildings with tall lobbies or podiums don't show them yet.
