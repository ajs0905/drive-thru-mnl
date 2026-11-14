# 0011: Lighting and post effects, switched by quality tier

**Status:** Accepted

**Context.** Even with windows and road markings the city looked flat: no shadows, no darkening where things meet, raw colors straight to the screen. Shadows and screen-space ambient occlusion are the biggest visual upgrades, but also the most expensive ones, and the game has to stay smooth on a low-mid phone (Realme 8).

**Decision.** Add the effects now, each tied to a quality tier from the start (`src/scene/quality.ts`), instead of waiting for the full tier system:

| | Low | Medium | High |
| --- | --- | --- | --- |
| ACES tone mapping, sky haze, wall contact darkening | on | on | on |
| Procedural clouds in the sky | off | on | on |
| Sun shadows around the camera's focus | off | 1024 map | 2048 map |
| Bloom, SMAA | off | off | on |
| Filler city past the map | 40% | full | full |
| Pixel ratio (adapts to the frame rate) | 0.6 to 1 | 0.75 to 1.25 | 1 to 1.5 |

- The cheap parts are on everywhere: tone mapping through the renderer, and wall darkening near the ground computed in the window shader (baked ambient occlusion, no extra pass).
- Shadows cover a square around the controls' target, sized by camera distance and moved in whole shadow-map texels, so they're sharp up close without a huge map. The scenery ring doesn't cast.
- Post effects use pmndrs `postprocessing` through `@react-three/postprocessing`, loaded with `React.lazy`, so Low and Medium never download that code (about 82 KB gzipped).
- The tier starts from a guess (coarse pointer = phone = Low; 4 GB or 4 cores = Medium; else High), can be changed in the HUD or with `?q=low|medium|high`, and is remembered. A tier change recreates the canvas, since shadows and buffers are set up at creation.

**Revised after the first measurements** (23 FPS on High on a desktop): most of the cost was per pixel, not triangles.
- The logarithmic depth buffer writes depth from the fragment shader, which turns off early depth testing: every hidden pixel behind a building still ran the window or road shader. Replaced by a reversed depth buffer (`EXT_clip_control`, same precision, early depth test kept), with log depth only as a fallback.
- Pixel ratio capped lower per tier and adjusted automatically from the frame rate (drei `PerformanceMonitor`).
- The shadow map is only re-rendered when the shadowed square moves or resizes (the city is static), with plain PCF filtering and smaller maps.
- Screen-space ambient occlusion (N8AO) was dropped: the most expensive pass, and it misread the reversed depth buffer. Multisampled buffers replaced by SMAA.

**Consequences.**
- Every device gets a better look for free; desktops get the full one.
- Medium and High re-draw the shadow casters (about 118k triangles) only on frames where the shadowed square moves; High adds the post passes.
- three.js applies fog after tone mapping, but post-effect tone mapping runs after fog. The sky blends into the haze after tone mapping to match, so the horizon has no seam on any tier; High's overall brightness differs slightly from Low/Medium.
- Automatic switching from measured frame times is still to come (tiles and tiers milestone).
