# 0018. Close off most empty lots, open three zones, solid sidewalk furniture

**Status:** Accepted, 2026-11-15

## Context

BGC has a lot of empty land inside the drivable area: construction sites, vacant blocks, mapped grass, small gardens. In the game they were flat ground the car could cut straight across, so the streets didn't hold you: a block corner was a short cut, and the city read as roads painted on a field. Street racers set in real cities (Need for Speed: Most Wanted is the usual reference) keep the player on the streets with walls, fences and street furniture, and leave a few open spaces on purpose as places to play. Constraints:

- OSM's land use outlines often run to the middle of the street and under buildings, so walling them as mapped would put walls on roads.
- Footpaths and driveways run into the lots; a wall across them reads as a mistake.
- The phone budget: hundreds of new pieces can't each be a draw call or a physics body.
- No new data source: everything from the existing exports.

## Decision

- **Most empty lots get a wall at the back of the sidewalk** (`pipeline/lots.ts`): hoarding around construction sites, a plastered lot wall around vacant land, a hedge around small gardens. The wall line is traced from the lot's free land on a 1 m grid (roads plus their sidewalks plus 1 m, buildings and land outside the playable area taken out), so it never stands on a street, and the simplification tolerance (0.8 m) is less than the room kept. Where it would cross a footpath it's a row of bollards; where a driveway runs into the lot, a gate piece (map QA knows it's on purpose). Walls are barriers, so the renderer and the collisions needed no new path for them.
- **Three zones are opened on purpose** (most land closed, a few places left open): the Terra 28th park (lamps, benches, a pavilion, trees), the Simon Mann sports field, and the surface parking by Kalayaan Avenue (stalls from the mapped parking aisles, wheel stops, a booth, half full of cars). Track 30th and Burgos Circle stay open as they were.
- **Construction yards are filled** with containers, pipes, crates, dumpsters, work lights, mounds and a crane or two, so the walls hide something. None of it is solid: the car can't get in.
- **Sidewalk furniture is solid** (`pipeline/sidewalks.ts`): waiting sheds and planters on the avenues, bins and hydrants everywhere there's a sidewalk, a few kiosks by the parks. It narrows what reads as drivable to the street itself.
- **One model file and one instanced mesh per kind** (`public/models/props.glb`, `scene/Dressing.tsx`), refilled around the camera's focus: street clutter only nearby and not at all on Low; landmarks seen from farther.
- Utility poles and a hard boundary around BGC proper are left for later.

## Consequences

- 51 lots closed (31.8 ha, about 15.4 km of walls and hedges), 4.0 ha opened, 2,876 pieces of dressing. The map file grew by about 44 KB gzipped; the props model is 21 KB gzipped.
- Up to 10 more draw calls in the views measured on Medium (a first version with a mesh per kind per grid cell added 20 to 50), and 20k to 75k more triangles, mostly the walls and the containers. The collision meshes grew from about 87k to 113k triangles.
- One more map QA check (`dressing-in-the-way`: solid furniture in a road, on a path or in a building), at 0. Lot walls count in the existing `barrier-on-road` check, also at 0.
- Which lots open is a short list of OSM ids in `LOTS` (`pipeline/lots.ts`); a refreshed export with new ids needs it looked at again.
- Some walled lots are fields people do walk across in real life; the footpaths through them stay open to people (bollards), just not to cars.
- The walls follow the free land, not the property line, so a lot wall can step around a building or a driveway where a real one would run straight.
