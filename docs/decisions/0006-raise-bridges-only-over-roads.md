# 0006: Raise a bridge only if it crosses a road

**Status:** Accepted

**Context.** OSM marks bridges (`bridge=yes`, `layer=1`) but not their height or where the slope starts. Small creek bridges in residential streets carry the same tags as flyovers; raising all of them puts 7 m humps in quiet streets. Footbridges were connected to sidewalks, so ramps lifted the sidewalks.

**Decision.** Group connected bridge pieces into chains (union-find on shared nodes). Raise a chain only if some piece crosses another road (spatial grid crossing test). Ramps use the approach road up to 90 m and stop at the first junction; if there's no room, the bridge slopes instead. For footbridges, only stairs can be a ramp. Details in `pipeline/elevation.ts`.

**Consequences.**
- 72 raised pieces (Kalayaan Overpass, Lawton Avenue viaduct, East Rembo C5 Overpass, Pamantasan Overpass, footbridges); 30 creek bridges correctly stay down.
- A bridge over something other than a road (a river with no road) stays at ground level. Acceptable for now.
- Underpasses are still drawn at ground level.
