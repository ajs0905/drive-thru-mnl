# 0019. Knockable and breakaway street furniture, pooled near the player

**Status:** Accepted, 2026-11-15

## Context

The street furniture added with the walled-off lots and the lights (ADR 0018: 2,740 pieces plus 1,300 street and traffic lights) was solid like a concrete wall: hitting a bin or a lamp post at speed stopped the car dead. In an arcade street racer that reads as a bug. But turning every piece into a physics body would put thousands of bodies in Rapier across the 3 x 2.5 km map, and swapping models in and out per piece would cost draw calls.

## Decision

- **Two behaviors** (`PROP_PHYSICS` in `src/geometry/dressing.ts`): *knock* for planters, bins, hydrants, benches, park lamps, street lights and traffic lights (a dynamic box the size of the piece, or its pole, with a real-ish mass: a bin 15 kg, a planter 180, a street light 160); *break* for waiting sheds, kiosks and the parking yard's booth (fixed, so a slow bump stops the car, but hit at more than 8 m/s they come apart into 4 or 5 debris parts that fly on with the car). The pavilion stays in the static collision mesh; so does nothing else of the street furniture.
- **Rendered as before** (one instanced mesh per kind): a knocked piece is drawn at its body's pose, a broken one is left out and its debris is drawn by one instanced box mesh (`scene/Debris.tsx`, no shadows).
- **Physics only near the player**: the knockable pieces go through the parked cars' pool (`scene/parkedPool.ts`), within 35 m, capped at 28 bodies (moved ones first, then the nearest), asleep until hit, put to sleep after 3 s lying still, back on their spot once out of sight. Breakaway pieces have fixed bodies within 40 m; the car's footprint a few physics steps ahead is checked against them before each step, so the fixed body is gone before it can stop a fast car. At most 30 debris bodies (the oldest go first), asleep once still, removed after 12 s out of sight; a broken piece is whole again once the player is 70 m away and none of it is in view.

## Consequences

- Driving through street furniture no longer stops the car; the static collision meshes lost about 26k triangles (125k to 99k).
- At most 28 + 30 more bodies, nearly all asleep; most frames only a handful are awake. One more instanced mesh (debris) and one more draw call while any debris exists.
- The pool's off-screen reset means a knocked-over street light is back up the next time you pass, which is right for a driving game but not a simulation.
- Breakaway detection is geometric (footprints and speed), not from contact forces, so a car scraping a shed sideways at speed breaks it too.
- The pool and the breakaways are plain classes tested in the real physics engine (`scene/propPhysics.test.ts`).
