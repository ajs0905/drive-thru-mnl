# 0008: Car physics: Rapier

**Status:** Accepted, 2026-11-14 (proposed earlier as "Rapier vs custom 2.5D")

## Context

The car needs to drive on roads with real heights (ramps, flyovers), hit buildings and walls, and run on low-mid range phones. The game is an open-world arcade driving game ([ADR 0014](0014-open-world-arcade-driving-game.md)): free roam plus races and time trials, with chases planned. Crashes should feel like other arcade racers: scrapes and bounces, spin-outs, and eventually rollovers, knocked-over props and car-vs-car contact.

Options looked at:

1. **Custom "2.5D" physics.** Height from the road surface under the car, building walls as 2D collisions through the existing spatial grid, a simple handling model. Cheapest, fully under our control, and fine for scrapes and spin-outs, but rollovers, knocked-over props and car-vs-car contact would have to be faked one by one (a homemade physics engine).
2. **Rapier** (Rust compiled to WebAssembly, `@react-three/rapier`). Real rigid bodies and a ray-cast vehicle (a port of Bullet's). Actively maintained, the usual choice with React Three Fiber.
3. **Jolt** (C++ compiled to WebAssembly). Comparable engine, fewer car examples for this stack.
4. **cannon-es, ammo.js.** No longer actively maintained.

A side-by-side prototype of 1 and 2 was offered and skipped in favor of deciding now.

## Decision

**Rapier, with arcade handling on top.**

- **Car:** Rapier's `DynamicRayCastVehicleController` on one chassis body (`src/car/vehicle.ts`). Each wheel is a ray cast with a spring, tire grip, engine force and brake. Rear-wheel drive, front-wheel steering.
- **Arcade assists** (`src/car/controls.ts`, pure and unit tested): one key for brake and reverse, steering lock that shrinks with speed and turns at a limited rate, engine force fading toward top speed, a handbrake that locks the rear wheels and loosens their grip (drifts), downforce growing with speed, a low center of mass and some angular damping so crashes stay readable.
- **Drift assist** (`src/car/drift.ts`): tire grip alone can't drift in Rapier's ray-cast vehicle (its tires cancel sideways motion almost completely every step; even with almost no rear grip the car slid about 10 degrees). So a drift is started on purpose (handbrake while steering, above 8 m/s): the rear tires go loose, steering turns the car directly while drifting, throttle keeps the rear loose and pushes the car along its slide so it keeps its speed, grip comes back over about half a second when the player lets go, the front wheels countersteer a little on their own, and past about 35 degrees the rotation is damped so the car holds its angle instead of spinning out. Normal driving never drifts.
- **One step function** (`stepVehicle` in `src/car/vehicle.ts`) runs the controls, drift assist and gearbox for both the game and the physics tests, so the tests drive exactly what the player drives.
- **Fixed 60 Hz physics step** with interpolated rendering (`@react-three/rapier`), so handling doesn't depend on frame rate.
- **Loaded on demand:** the physics engine (about 870 KB gzipped, WebAssembly embedded) is in its own chunk that downloads only when the player starts driving; the map shows as fast as before.
- **Colliders from our data**, added in steps: flat ground first; then one static triangle mesh for everything solid on the map (`src/geometry/collision.ts`: building walls, walls and fences, the playable edge, posts); then flyover decks and ramps from road heights. For BGC the whole mesh is about 73k triangles and takes about 110 ms to build when driving starts, so splitting it into cells near the car isn't needed yet; that comes with tile streaming. Rapier's triangle meshes collide from both sides, and with continuous collision detection on the car, thin walls hold even at 180 km/h (tested).
- **Tests run the real engine:** `src/car/vehicle.test.ts` drives the car in Rapier in Node with the game's setup code and checks acceleration, top speed, braking distance, cornering grip, the handbrake and that it doesn't roll over in hard corners.

## The full car, planned now so every feature has a place

| Group | Features | When |
| --- | --- | --- |
| Driving | Throttle, brake, reverse, handbrake, speed-sensitive steering, grip and understeer, wheels that spin and steer, suspension travel | Done in 8a |
| Driving | Drift assist; automatic gears (not shown on screen) with a short drive drop on upshifts; body pitch and roll on a spring, with a kick at each upshift | Done (feel step) |
| Driving | Curb bumps, surface grip (road, grass, sidewalk) | 8d |
| World | Collisions with buildings, walls, fences, the playable edge, pillars, trunks, bollards, blocks and gate pillars; camera kept out of walls | Done in 8b |
| World | Flyovers and ramps; booms that open as the car comes | 8c, 8d |
| Recovery | Reset (R), automatic reset when upside down or fallen through the world | Done in 8a |
| Recovery | Respawn on the nearest road with a fade | 8d |
| Camera | Chase camera that trails the car's direction and pulls back with speed | Done in 8a |
| Camera | Subtle reaction to acceleration (hangs back about a meter on throttle, eases in under braking), view widening with speed | Done (feel step) |
| Camera | Hood camera, look back | 8d |
| Input | Keyboard | Done in 8a |
| Input | Touch controls, gamepad | 8d |
| Lights | Headlights glowing, tail lights that brighten while braking | Done in 8a |
| Lights | Glow halos on every lamp, bigger and brighter while braking | Done (feel step) |
| Lights | Reverse lights, turn signals, headlight beams at night | Polish (night mode) |
| Feel | Engine sound following the gears, tire screech, crash sounds, horn, skid marks, sparks, tire smoke | Right after the car milestone |
| Crashes | Scrapes, bounces and spin-outs (from the physics) | With collisions (8b) |
| Crashes | Visual damage (dents), rollovers tuned to be possible but rare | Later |
| Cars | Car select with per-car tuning (the pack's Hatchback, Taxi, SUV and Pickup share the Sedan's wheel layout) | Later |
| Events | Checkpoint time trials and races | Right after the car milestone |
| Events | Traffic, police chases | Later |

## Consequences

- About 870 KB more to download when driving starts (the main bundle stays about 340 KB gzipped). Lazy loading keeps the first view fast; the separate-WASM build of Rapier is an option if the size matters.
- Real collisions and contacts come with the engine, so crashes, props and car-vs-car contact don't need custom code.
- Arcade feel needs tuning on top of a realistic model; the tuning lives in one place (`src/car/spec.ts`) and the physics tests pin it down.
- The city has to be turned into colliders. Only cells near the car get them, so memory stays bounded as the map grows.
