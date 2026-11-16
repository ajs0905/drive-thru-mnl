# 0024. Deterministic headless drives and golden replays

**Status:** Accepted, 2026-11-16

## Context

The car's feel, the collision meshes built from the map and the map itself all change often. Unit tests pin pieces down (a full stop's deceleration, the drift angle, a ramp climb), but nothing checked that a whole drive through the real city still goes the same way. Traffic and police AI, next, need a way to run many drives fast without a screen. And the cargo runs needed proof that their routes can actually be driven.

## Decision

- **The drive runs headless** (`src/sim/headless.ts`): the same world Drive.tsx builds (ground, the map's walls and structures as static meshes, the Sedan on Rapier's ray-cast vehicle) stepped at 60 Hz by the same `stepVehicle` the game calls. Rapier is passed in, so it runs in Node. It leaves out the pooled bodies near the player (parked cars, roadblock pieces, street furniture).
- **Replays are keys per step** (`src/sim/replay.ts`): a 5-bit mask per 60 Hz step, run-length encoded, plus the start pose, a map id and where the car ended. About 4 KB for a minute of driving.
- **An autopilot drives the routes** (`src/sim/autopilot.ts`): pure pursuit on the route polyline with the player's on/off keys, slowing before bends and braking to a stop. It doesn't steer around things.
- **Golden replays** (`tests/replays/`, recorded by `npm run replay`): two cargo runs driven by the autopilot from the pickup's curb spot to the drop-off. The tests play each twice (the results must be identical to the bit) and check it ends within 5 cm of where it was recorded; one is also scored by the cargo run's state machine and must deliver on time with the cargo above 90%.
- **Benchmarked** (`npm run bench`): headless physics with the map's collision ran at about 20,000 to 50,000 steps per second where it was measured (Node on one CPU core of a cloud development container), a few hundred times real time.

## Consequences

- A change to the tuning, the physics setup, the collision or the map makes a golden replay end elsewhere. When the change is meant, the replays are recorded again in the same commit, and the diff says the drive changed.
- Driving every cargo run headless found real problems before a player could: a route up a ramp the playable edge cuts across, a loading bay beside a ramp's side wall, and roads closed by bollard rows. All three are fixed in the routing and the curb search.
- Determinism holds for the same build on the same engine: Rapier compiled to WebAssembly and V8's math. Recording in the browser and playing back in Node isn't guaranteed bit-exact, and isn't attempted yet.
- Fresh Produce wasn't a golden replay at first: a concrete block mapped in the middle of a one-way street stopped the autopilot. Blocks and bollards left in open lanes are now moved to the curb by the pipeline (map QA `fixture-in-lanes`), and the run is one of three golden replays (Morning Parcels, Fresh Produce, Gallery Pieces). All seven runs finish inside their bay with no crash.
- Since runs end in a curbside bay, the autopilot swaps the route's last 14 m for a pull-in to the bay, lined up along the curb 4 m before it.
