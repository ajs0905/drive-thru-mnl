# 0025. Light traffic: IDM on the road graph, junctions as reserved clusters

**Status:** Accepted, 2026-11-16

## Context

The game is called "No Traffic Edition?", but a city with no cars moving reads as empty, and Kamote Mode (next) needs cars on the road to weave through. The v1 plan asked for light traffic that keeps the name honest. It has to run on a low-mid range phone next to everything else, stay out of the parked cars' way, react to the player, and not need a lane-level map the data doesn't have.

## Decision

- **A pure, seeded simulation** (`src/traffic/sim.ts`) on the routing graph, stepped with the physics at 60 Hz. Cars exist only around the player: they appear 140 to 320 m away and go past 380 m. Low keeps 6, Medium 8, High 10.
- **Where they drive**: the avenues and wider streets (major roads, and minor ones at least 9 m wide), never a road with parked cars (there's no room to pass them; parking is only on minor streets), and only the largest strongly connected part of that subnetwork, so a car always has a way on. On BGC that's 400 road pieces.
- **Car-following by IDM** (`src/traffic/idm.ts`, Treiber's Intelligent Driver Model): each car brakes and accelerates for the nearest thing ahead in its lane: another car on its road or the next, any car in front of it in its lane's corridor (merges, roads drawn close together), a stop line, the player's car, or a car the player knocked loose. It slows for turns.
- **Junctions as reserved clusters**: nodes joined by roads with less than 15 m between their junction polygons are one junction (a divided avenue's crossing is two to four nodes). A car asks for the junction ahead, waits at a stop line before the junction polygon, and lets go once it's out of the polygon on the far side by its length plus 4 m. One movement holds a junction at a time; only cars following each other in the same lane, in and out on the same roads, share it. Requests are served in order. Because roads too short to wait on are inside a junction, no car waits inside one it blocks, and waits can't form a loop.
- **In the physics**: cars within 70 m of the player are kinematic bodies that follow the simulation, solid to the player. A crash with one touching the player knocks it out of the flow: the body turns dynamic, keeps its speed plus 40% of the player's velocity, and the physics moves it from then on.
- **Drawn** with the parked cars' six models and paints, one instanced mesh each plus blob shadows: at most 7 draw calls and about 16k triangles at 10 cars.

## What was tried first

Measured with a headless harness (a player driving across BGC, footprint overlaps counted twice a second; now in `npm run bench`):

- Junctions as single nodes, letting straight-on traffic from opposite sides share one: cars on BGC's merged, irregular junctions still crossed paths.
- Waiting with a timeout (go anyway after 12 s): the timeout let cars into occupied junctions, and two overlapping cars each braked for the other forever.
- A 3 m stop line: on 5th Avenue at 30th Street, carriageways mapped 16 m wide with 4 lanes sit 12 m apart, so cars waited inside the junction. The stop line now sits before the junction polygon (the road's trim).

## Consequences

- At the tier counts, over five minutes around a moving player: cars are moving 93 to 96% of the time, a step costs 8 to 14 µs, and car footprints overlap in 0 to 7 of 600 samples. The remaining overlaps are mostly opposite carriageways mapped wider than the gap between them.
- One movement at a time per junction caps throughput: at 16 cars or more the 5th Avenue crossing near the start backs up. That's acceptable for light traffic; heavier traffic would want signal phases on the 49 signalized intersections and lane-level junction paths.
- No buses, police cars or patrol liveries yet: those models come with the vehicle pack, as do the other cars.
- No lane changes (MOBIL would be the next step), no turn signals, no reaction to the player's horn. Traffic doesn't show on the minimap.
