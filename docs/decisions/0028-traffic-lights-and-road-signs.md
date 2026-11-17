# 0028. Traffic lights that cycle, road signs by rule

**Status:** Accepted, 2026-11-17. Builds on ADR 0021 (far-side traffic lights), ADR 0025 (light traffic) and ADR 0027 (traffic that drives like cars).

## Context

The traffic lights were props: 162 poles at 49 intersections, never lit, and the traffic took turns at junctions by reservation alone, so at a signalized avenue crossing cars from all four ways trickled through together. The streets had no signs at all: OSM maps no stop or give-way points in the area, and only some roads carry a speed limit tag. Traffic also took a bump too hard (spinning on a sideswipe), its wheels froze once knocked loose, and it did nothing when the player came at it head-on. The next mode (Kamote Mode) needs lights and signs to break.

## Decision

- **A signal clock per intersection** (`traffic/signals.ts`, pure): the traffic's junction clusters are the intersections. Each pole belongs to the cluster with a node nearest it within 40 m, and its phase is the way its heads face: along the cluster's busiest approach (a major road first, then the most lane meters), or across it. Two phases, 18 s green, 3 s amber and 2 s all red each (a 46 s cycle), offset per intersection by a seed so the avenues don't all change at once. Never green both ways (a test checks every moment of the cycle).
- **The traffic keeps to it.** An approach edge's lamp is its phase at its cluster. A car not yet holding the junction treats red as a stopped car at its stop line, and amber the same when it can stop at its comfortable braking (3 m/s²) before the line; otherwise it goes. A car already in or holding the junction carries on, so nobody stops inside it. The reservations still sort out turns within a green. The player can run any light.
- **Lit lenses** (`scene/SignalLights.tsx`): one instanced disc mesh over every lens (the lit one in an unlit color over 1, no tone mapping, the others dark) and one instanced halo mesh for the lit ones, brighter the more the head faces the camera, drawn out as far as the poles are. Lens positions come from how `tools/props-to-glb.ts` builds the heads. A knocked pole goes dark.
- **Road signs by rule** (`pipeline/signs.ts`): stop signs before unsignalized junctions with a bigger road, one-way signs where a one-way street leaves a junction (one per side the cross traffic comes from, the arrow pointing the way the driver sees the street go), speed limits on the avenues just past a junction (the tag, else 60 or 40 km/h by road kind; at most one per direction within 260 m). They keep clear of roads, driveways, footpaths, buildings, walls, junction paving, crossings and other furniture, and slide along the curb for room. 271 stop, 221 one-way and 60 speed limit signs.
- **Signs drawn from code.** `props.glb` can't be rebuilt without the original kits, so the signs are built in `scene/signModels.ts`: a post, a plate and two brackets per face, the faces painted on one 512 px canvas and cut to their shapes (octagon, disc) by its alpha. `scene/Dressing.tsx` takes models from either source; one instanced mesh per face, 9 more possible draw calls, each only where that face is in reach. Knockable like the street lights (25 kg).
- **Bumps, softer.** The impulse is applied at a point 65% of the way from the car's middle to the contact (a hit is spread over the panel, not a point on the corner), the yaw it starts is capped at 1.2 rad/s, and a knocked car's spin dies faster (angular damping 1.3). A rear-quarter tap still turns the car (about 9 degrees), no longer spins it.
- **Wheels roll with the body.** A knocked car's wheels turn with its body's speed along its length, not the simulation's.
- **Dodging.** A car that sees the player's car head-on in its lane closing within 3 s, or coming from behind within 28 m more than 6 m/s faster, brakes (to 70% of its speed, at least 3 m/s), shows its brake lights, and moves up to 1.2 m toward the curb over a short S-curve if nobody is alongside on that side, then eases back after 1.6 s.

## Measured

`npm run bench` (traffic, five minutes around a player crossing the area at 12 m/s, the lights cycling):

| Cars | µs per step | Moving | Overlapping footprints |
| --- | --- | --- | --- |
| 24 (Low) | 84 | 84% (91% without lights) | 0 of 600 |
| 32 (Medium) | 86 | 78% | 0 of 600 |
| 40 (High) | 110 | 78% | 0 of 600 |

With the player parked and 40 cars for 4 minutes (`signals.test.ts`), the share of cars moving drops from 78% to 42% (queues at red), and under 10% of junction entries happen on red (cars that were past the point of stopping when amber came).

The first try at dodging let a car in the left lane swerve right into a car beside it: the bench found 6 overlapping footprints at 24 cars. The check for room on the right fixed it, and a test with the lights cycling holds it.

On the map: 69 signalized clusters, 44 with poles for both phases (the rest have lights for one axis only; the other axis is still held at red).

## Consequences

- Avenues now queue and release in platoons, which reads much more like Metro Manila, at about the same cost per step (within the bench's run-to-run spread).
- The phases are fixed time. No sensors, no turn arrows, no pedestrian phases. Intersections where the mapped lights only face one axis still stop the other axis at red, which is right for the traffic, though no lamp shows it.
- Signs are placed by rule, not from the map; where OSM later maps stop or give-way points, those should take over.
- Red-light running by the player is free for now; Kamote Mode can read `Signals.edgeLamp` to call it.
