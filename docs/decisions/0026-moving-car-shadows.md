# 0026. Moving cars' shadows drawn every frame, not in the shadow map

**Status:** Accepted, 2026-11-16

## Context

The sun's shadow map (ADR 0011, `scene/Sun.tsx`) is only re-rendered when the square it covers moves, and at most every 2 frames (High) or 4 (Medium) while the camera keeps moving: the city doesn't move, and re-rendering it every frame costs a full extra pass. A car moving through that map leaves its shadow behind: at 15 m/s, four frames are a meter. The player's car never cast into it (it had only a dark patch underneath, so it read as floating), and the first traffic did, with shadows trailing and detaching from the cars. The map's fixed normal bias of 0.5 m also lifted small things up close off their own shadows.

## Decision

- **Moving cars (the player's and traffic) don't cast into the shadow map.** Each gets two soft patches on the ground, placed every frame: the dark contact patch under it, and its shadow from the sun (`src/car/sunShadow.ts`): its footprint swept away from the sun as far as 85% of a 1.25 m height throws it, approximated as a box in the car's frame (the center moves half the throw; the box grows by the throw along each axis). Shared with the city's sun direction, so it lines up with the buildings' shadows.
- **Parked cars, street furniture and the city keep the shadow map**, which they're still for.
- **The normal bias follows the shadow texel size** (`normalBiasFor`): a texel and a half, between 0.15 and 0.5 m. Driving on High that's 0.18 m instead of 0.5.

## Consequences

- No shadow lag or detaching at any speed, and the player's car sits on the road. Cheap: one more instanced draw for all traffic, one small mesh for the player, no extra shadow pass.
- The moving cars' shadows are soft boxes, not their exact shapes; at a car's size, from the chase camera, that reads as right. They don't fall onto other cars or up walls.
- On Low (no shadow map) the moving cars still get theirs; the city doesn't.
