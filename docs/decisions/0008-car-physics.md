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
- **Fixed 60 Hz physics step** with interpolated rendering (`@react-three/rapier`), so handling doesn't depend on frame rate.
- **Loaded on demand:** the physics engine (about 870 KB gzipped, WebAssembly embedded) is in its own chunk that downloads only when the player starts driving; the map shows as fast as before.
- **Colliders from our data**, added in steps: flat ground first; then buildings as static colliders near the car (by grid cell), the playable edge, walls and fences; then flyover decks and ramps from road heights.
- **Tests run the real engine:** `src/car/vehicle.test.ts` drives the car in Rapier in Node with the game's setup code and checks acceleration, top speed, braking distance, cornering grip, the handbrake and that it doesn't roll over in hard corners.

## The full car, planned now so every feature has a place

| Group | Features | When |
| --- | --- | --- |
| Driving | Throttle, brake, reverse, handbrake drift, speed-sensitive steering, grip and understeer, wheels that spin and steer, suspension travel | Done in 8a |
| Driving | Automatic gears (for engine sound), body roll and pitch, curb bumps, surface grip (road, grass, sidewalk) | 8d |
| World | Collisions with buildings, walls, fences and the playable edge; booms that block; flyovers and ramps | 8b, 8c |
| Recovery | Reset (R), automatic reset when upside down or fallen through the world | Done in 8a |
| Recovery | Respawn on the nearest road with a fade | 8d |
| Camera | Chase camera that trails the car's direction and pulls back with speed | Done in 8a |
| Camera | Hood camera, look back | 8d |
| Input | Keyboard | Done in 8a |
| Input | Touch controls, gamepad | 8d |
| Lights | Headlights glowing, tail lights that brighten while braking | Done in 8a |
| Lights | Reverse lights, turn signals, headlight beams at night | Polish (night mode) |
| Feel | Engine sound by RPM, tire screech, crash sounds, horn, skid marks, sparks, tire smoke, camera shake, speed-based field of view | Right after the car milestone |
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
