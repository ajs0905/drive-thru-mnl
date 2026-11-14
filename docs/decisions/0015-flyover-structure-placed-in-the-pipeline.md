# 0015. Flyover structure placed in the pipeline, checked against the roads below

**Status:** Accepted, 2026-11-14

## Context

Once the flyovers became drivable (8c), problems that had only looked odd started to matter, and a few new ones showed up while driving:

- Ramps climbed inside other roads' lanes. Where a ramp and a frontage road split from one node at a shallow angle, their surfaces overlap for up to 25 m, and the ramp (with its barrier) rose inside the frontage road. 9 ramps did this.
- Pillars landed in lanes below: the renderer put one every 30 m along each deck's centerline, wherever that fell. 55 of them stood in a lane, including one in the middle of a road under a U-turn loop.
- 26 buildings start above the ground (canopies over driveways, one building over a passage) and floated with nothing under them.
- Trees stood with their crowns through deck barriers, and barriers had gaps where OSM splits a flyover into several ways.
- Same-class roads that overlap (carriageways meeting at a median) were drawn in one plane, so their lane lines flickered (758 overlapping pairs).

Pillars were placed at run time by both the renderer and the collision builder from the same function, so they always matched, but placing them well needs the whole road network, which neither has at hand cheaply.

## Decision

- **Ramps stay out of other lanes** (`elevation.ts`, rule 5): wherever a ramp's surface overlaps a ground road, it's at ground level or at least 4 m up. The climb is shortened until that holds, and if no ground ramp fits, the bridge slopes instead; plans are tried in a fixed order, never leaving a deck low over a road it crosses.
- **Pillars and posts become map data** (`structures.ts`, `pillars` in the data, version 7). The pipeline places them once, clear of the lanes below: sliding along the deck, onto an avenue's median, or beside the deck on an outrigger pier with a cap beam. Raised buildings get posts. The renderer and the collisions both use the list as given.
- **Curves of raised roads are rounded** in the pipeline (`smoothRaised.ts`), and **overlapping roads get a drawing layer** (`roadLayers.ts`, `lift`): a few millimeters per layer, by graph coloring.
- **Deck edges are mitred across joints and barriers start soft** (`deckJoins`, `deckEdges`, `railHeight` in `geometry/road.ts`), shared by drawing and collision.
- Each problem got a map QA check, so CI catches it coming back.

## Consequences

- Drawing and collision still can't disagree: both read the same pillars and call the same edge and barrier functions.
- The map format changed (version 7); old map files are refused with the usual message. The file grows by about 9 KB gzipped.
- The pipeline is a few hundred milliseconds slower; the browser does less.
- Some ramps changed shape: 8 climbs moved, and 4 bridges now slope down themselves where their ramps used to. 3 ramps still overlap a main road running right alongside them; their mapped widths overlap at any height, so that needs a width fix, not a height fix. QA counts them.
- The map at ramp splits now has two road surfaces at ground level overlapping, which is fine visually thanks to the drawing layers.
