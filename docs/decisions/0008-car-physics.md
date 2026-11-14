# 0008: Car physics: Rapier vs custom 2.5D

**Status:** Proposed (decide at the drivable car milestone)

**Context.** The car needs to drive on roads with real heights (ramps, flyovers), hit buildings and walls, and run on low-mid range phones. Options:

1. **Rapier raycast vehicle** (WASM physics engine). Mature, full 3D. Needs colliders for thousands of buildings and road surfaces as triangle meshes; memory and setup cost grow with the map.
2. **Custom "2.5D" physics.** The car's height comes from the road surface under it (road `z` data), building walls and barriers are 2D collisions found through the existing spatial grid, and handling is a simple vehicle model. Slow Roads uses a similarly minimal approach (road collision as distance to the road center).

**Decision.** Not made yet. Prototype both against the same test route (ground roads, Kalayaan Overpass, tight alleys) and compare frame time and memory on desktop and a low-mid range phone.

**Consequences (expected).**
- Rapier: less custom code, true 3D (flips, jumps), more memory and CPU.
- Custom: cheaper and fully under our control, more code to write and test, no free 3D tumbling (needs a simple flip/respawn model).
