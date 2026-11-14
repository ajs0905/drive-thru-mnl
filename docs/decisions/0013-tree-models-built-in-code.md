# 0013. Tree models built in code

**Status:** Accepted, 2026-11-14

## Context

The 919 trees from [ADR 0012](0012-barriers-and-trees-from-a-second-export.md) were a 6-sided trunk plus one 20-face icosahedron per tree (38 triangles). Broadleaf crowns looked like gems on sticks and palms like flat discs, which matters more once the camera drops to street level for driving.

Options looked at:

- **Free low-poly model packs.** Two candidates were checked: Quaternius' Ultimate Nature Pack (CC0, palms and broadleaf, 1,050 to 2,950 triangles each, flat colors over 2 to 4 materials) and a small Low Poly Trees pack on itch.io (CC BY 4.0, broadleaf only, 790 to 900 triangles, one texture). Simplified with meshoptimizer they still looked right at about 250 triangles, but that is **about 230k triangles for the map instead of 35k**, plus loading a GLB, an attribution line for one pack, and a style that doesn't quite match the city's.
- **Billboards / impostors** (a picture of a tree on a camera-facing quad). About 2 triangles per tree, but they look like cards from the overview camera, need alpha cutouts (no early depth test, overdraw on phones), and their shadows turn with the camera. Good for far trees, not as the only trees.
- **Better trees built in code**, at a similar budget to the old ones.

## Decision

- **Procedural tree models** (`src/geometry/treeShapes.ts`): three broadleaf variants and a palm, each one small mesh with trunk, branches and leaves together.
  - Round (70 triangles): a trunk and three jittered icosahedron clusters.
  - Wide umbrella (82): a trunk splitting into two branches under three flattened clusters, the rain tree look of many BGC streets.
  - Tall (50): two stacked clusters.
  - Palm (68): a gently curved trunk, a heart where the fronds meet, seven drooping fronds (four triangles each, folded like a V) and three young upright ones.
- **Instanced like every other prop:** one instanced mesh per model per grid cell, scaled by the tree's size factor, turned by its position hash, with the same per-tier distance limits. Palms lean up to 7 degrees, and every tree's width varies by up to 10%.
- **Colors:** vertex colors hold the bark and a reference leaf green, shaded darker underneath (baked ambient occlusion). The instance color is the ratio of the tree's palette green to that reference, so leaves come out exactly in the palette color and trunks only shift slightly in brightness. No custom shader. Palms use a two-sided material so fronds are visible from below.
- **Same tree in every tier:** the variant comes from the existing position hash (scrambled so variant and leaf color don't go together), and color and turn match the simple trees, so switching tiers keeps each tree in place.
- **Low keeps the simple trees** (38 triangles, 2 instanced meshes per cell). Medium and High get the models; shadows stay Medium and High only, as before.

## Consequences

- Whole map: **62.7k triangles instead of 34.9k** (average 68 per tree) and **26 instanced meshes instead of 14** (up to 4 per cell instead of 2). Measured per view on Medium and High: **+16k to +27k triangles and +6 to +11 draw calls**, plus the same again in shadow re-renders. Low is unchanged.
- No assets, downloads or licenses; the models are about 200 lines of TypeScript and are unit tested (triangle counts, sizes, outward faces, shading).
- Billboards for far trees are still a good next step, rendered from these same models, in the tiles milestone's level-of-detail work.
