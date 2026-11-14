# 0003: One merged mesh per layer

**Status:** Accepted

**Context.** The clipped map has about 12,500 buildings and 3,800 roads. One mesh each would mean tens of thousands of draw calls; phones handle a few hundred at most.

**Decision.** Build each layer (playable buildings, scenery buildings, roads, ground, bridge structures, playable edge) into one geometry with per-vertex colors and one material. The mesh builder outputs plain typed arrays; only the scene code turns them into three.js objects.

**Consequences.**
- The whole city renders in about 8 draw calls (230k triangles).
- Mesh building is pure and renderer-agnostic, so it can move to a Web Worker.
- Frustum culling and unloading are all-or-nothing per layer. Accepted for BGC; tile streaming splits layers per tile, which restores culling and unloading.
- Per-object effects (highlighting one building) need vertex attributes or a separate mesh.
