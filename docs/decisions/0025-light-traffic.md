# 0025. Light traffic: IDM on the road graph, junctions as reserved clusters

**Status:** Accepted, 2026-11-16 (revised the same day: streets with parking, curves through junctions, wheels and lights, more cars). Poses, lane changes, roundabouts, bumps and the counts were changed by [ADR 0027](0027-traffic-that-drives-like-cars.md).

## Context

The game is called "No Traffic Edition?", but a city with no cars moving reads as empty, and Kamote Mode (next) needs cars on the road to weave through. The v1 plan asked for light traffic that keeps the name honest. It has to run on a low-mid range phone next to everything else, stay out of the parked cars' way, react to the player, and not need a lane-level map the data doesn't have.

## Decision

- **A pure, seeded simulation** (`src/traffic/sim.ts`) on the routing graph, stepped with the physics at 60 Hz. Cars exist only around the player: they appear 140 to 320 m away and go past 380 m. Low keeps 10, Medium 14, High 18.
- **Where they drive**: avenues and streets (major and minor roads; service roads are driveways and parking aisles), inside the room the parked cars leave. The pipeline already keeps a clear corridor beside parked cars (3.2 m on one-way streets, 5.6 m on two-way ones); `parkingRoom` measures, per street, how far it's clear either side of the center line, and lanes are fitted into that. A street whose parked cars leave less than a 2.4 m lane isn't used. Then only the largest strongly connected part of that network, so a car always has a way on: 68 km of lanes both ways on BGC, 25 km of them on streets with parking (it was 21 km of avenues and wide streets in the first version, with every street with parking left out).
- **Car-following by IDM** (`src/traffic/idm.ts`, Treiber's Intelligent Driver Model): each car brakes and accelerates for the nearest thing ahead in its lane: another car on its road or the next, any car in front of it in its lane's corridor (merges, roads drawn close together), a stop line, the player's car, or a car the player knocked loose. It slows for turns. Acceleration eases toward what the model wants at 6 m/s³, except a hard stop, which comes at once.
- **Smooth paths**: the heading follows the lane over 3 m either way, so a bend in a road's polyline isn't a snap; from where one road's junction polygon starts to where the next one's ends (at least 5 m each side), a car follows a cubic Bézier from lane to lane, paced evenly along its length. Turns are arcs, U-turns swing round, and a change of lane through a junction happens along the curve. The next lane is picked where the curve starts, so two cars don't curve into one lane together.
- **Going round**: something stopped in the lane (the player's car at the curb, a knocked car) is passed on the left where the road has room, easing over at 1.1 m/s and back; where it hasn't, the car waits behind it.
- **Junctions as reserved clusters**: nodes joined by roads with less than 15 m between their junction polygons are one junction (a divided avenue's crossing is two to four nodes). A car asks for the junction ahead, waits at a stop line before the junction polygon, and lets go once it's out of the polygon on the far side by its length plus 4 m. One movement holds a junction at a time; only cars following each other in the same lane, in and out on the same roads, share it. Requests are served in order. Because roads too short to wait on are inside a junction, no car waits inside one it blocks, and waits can't form a loop.
- **In the physics**: cars within 70 m of the player are kinematic bodies that follow the simulation, solid to the player. A crash with one touching the player knocks it out of the flow: the body turns dynamic, keeps its speed plus 40% of the player's velocity, and the physics moves it from then on.
- **Drawn** with the parked cars' six models and paints as instances. The wheels are split off the merged models (`src/car/carParts.ts` finds them by their shine tag and the lamp lenses by their colors) and drawn as one instanced wheel: spinning with the distance driven, the front ones steered by the bicycle model from how fast the path turns. Headlights glow, tail lights glow dim and brighten when braking or stopped, with soft halos seen from their side only. Shadows are drawn every frame from the sun's direction (ADR 0026). Up to 10 draw calls and about 34k triangles at 18 cars.

## What was tried first

Measured with a headless harness (a player driving across BGC, footprint overlaps counted twice a second; now in `npm run bench`):

- Junctions as single nodes, letting straight-on traffic from opposite sides share one: cars on BGC's merged, irregular junctions still crossed paths.
- Waiting with a timeout (go anyway after 12 s): the timeout let cars into occupied junctions, and two overlapping cars each braked for the other forever.
- A 3 m stop line: on 5th Avenue at 30th Street, carriageways mapped 16 m wide with 4 lanes sit 12 m apart, so cars waited inside the junction. The stop line now sits before the junction polygon (the road's trim).
- Poses straight off the polyline: headings snapped at every bend and node, and the lane offset jumped sideways at every turn (the offset turned with the heading all at once). Replaced by the smoothed lane and the curves above.

## Consequences

- At 6 to 18 cars, over five minutes around a moving player: cars are moving 94 to 100% of the time, a step costs about 25 to 50 µs, car footprints overlap in at most 1 of 600 samples, and no car touches a parked one. Tests also check that no heading turns more than 0.1 rad in a step and no car moves more than 5 cm past where its speed takes it.
- One movement at a time per junction caps throughput; at these counts, spread over the whole street network, it holds. Heavier traffic would want signal phases on the 49 signalized intersections and lane-level junction paths.
- No buses, police cars or patrol liveries yet: those models come with the vehicle pack, as do the other cars.
- No lane changes between junctions (MOBIL would be the next step), no turn signals, no reaction to the player's horn. Traffic doesn't show on the minimap.
