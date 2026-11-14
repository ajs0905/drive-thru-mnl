# 0009: Road markings drawn by a shader from per-vertex data

**Status:** Accepted

**Context.** Roads were flat gray ribbons. They need lane lines, center lines, edge lines, zebra crossings and curbs to read as streets. The usual ways are a road texture with UVs, or extra geometry (one thin quad per painted line). Textures stretch and blur on curves and junctions of any width, need several variants (2 lanes, 4 lanes, one-way...) and mipmapping makes thin lines shimmer. Extra geometry multiplies the triangle count and needs its own anti-flicker offsets. Both fight the "one merged mesh per layer" rule ([ADR 0003](0003-merged-meshes-per-layer.md)).

**Decision.** Each road vertex carries one extra vec4: distance along the road, offset across it, half the road width, and a packed style (mode, lanes, one-way, road class). A Lambert material patched with `onBeforeCompile` (`src/scene/roadMaterial.ts`) computes the markings per pixel from those numbers. Lines are antialiased with `fwidth` and fade out once they get thinner than a pixel; dashes blend to their average coverage in the distance. Junction polygons use the plain mode, zebra crossings (straight bands placed by `pipeline/crossings.ts`) paint white bars over the crossed road's asphalt color, sidewalks use a curb mode.

**Consequences.**
- Markings are sharp at any distance, follow curves exactly, and cost no extra draw calls, textures or triangles. The road layer grows by 16 bytes per vertex.
- Lane layouts come from data (`lanes`, `oneway`), so a 6-lane one-way avenue and a 2-lane street use the same code.
- All markings are procedural: no stop lines, arrows or text yet. Those can be added as more modes, or as a small decal layer later.
- The shader runs on every road pixel; on Low-tier phones it may need a simpler path (see [PERFORMANCE.md](../PERFORMANCE.md)).
- Zebras are opaque on purpose: an earlier version discarded the gaps, which let lane lines show through and would have turned off early depth testing on some mobile GPUs.
