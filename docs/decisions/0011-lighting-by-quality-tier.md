# 0011: Lighting by quality tier, measured and trimmed for speed

**Status:** Accepted

**Context.** Even with windows and road markings the city looked flat: no shadows, no darkening where things meet, raw colors straight to the screen. Shadows and screen-space ambient occlusion are the biggest visual upgrades, but also the most expensive ones, and the game has to stay smooth on low-mid range phones.

**Decision.** Add the effects now, each tied to a quality tier from the start (`src/scene/quality.ts`), instead of waiting for the full tier system:

| | Low | Medium | High |
| --- | --- | --- | --- |
| ACES tone mapping, sky haze, wall contact darkening | on | on | on |
| Procedural clouds in the sky | off | on | on |
| Sun shadows around the camera's focus | off | 1024 map | 2048 map |
| Hardware anti-aliasing (MSAA) | off | on | on |
| Filler city past the map | 40% | full | full |
| Rooftop details shown within | 500 m | 900 m | 1,400 m |
| Pixel ratio (adapts to the frame rate) | 0.6 to 1 | 0.75 to 1.25 | 1 to 1.25 |

- The cheap parts are on everywhere: tone mapping through the renderer, and wall darkening near the ground computed in the window shader (baked ambient occlusion, no extra pass).
- Shadows cover a square around the controls' target, sized by camera distance and moved in whole shadow-map texels, so they're sharp up close without a huge map. The scenery ring doesn't cast.
- The tier starts from a guess (coarse pointer = phone = Low; 4 GB or 4 cores = Medium; else High), can be changed in the HUD or with `?q=low|medium|high`, and is remembered. A tier change recreates the canvas, since shadows and buffers are set up at creation.

**Revised after the first measurements** (23 FPS on High on the development laptop): most of the cost was per pixel, not triangles.
- The logarithmic depth buffer writes depth from the fragment shader, which turns off early depth testing: every hidden pixel behind a building still ran the window or road shader. Replaced by a reversed depth buffer (`EXT_clip_control`, same precision, early depth test kept), with log depth only as a fallback.
- Pixel ratio capped lower per tier and adjusted automatically from the frame rate (drei `PerformanceMonitor`).
- The shadow map is only re-rendered when the shadowed square moves or resizes (the city is static), with plain PCF filtering and smaller maps.
- Screen-space ambient occlusion (N8AO) was dropped: the most expensive pass, and it misread the reversed depth buffer. Multisampled buffers replaced by SMAA.

**Revised again** (High at 70 to 85 FPS while Medium and Low hit the screen's 144 Hz):
- The remaining post chain (bloom, tone mapping pass, SMAA at up to 1.5x resolution) was most of High's extra cost, and bloom barely shows in daylight. Dropped, with its two libraries; High uses hardware anti-aliasing like Medium and tops out at 1.25x. Bloom can come back with night lighting, where it matters.
- While the camera keeps moving, the shadow map re-renders at most every 2 (High) or 4 (Medium) frames; the light stays where its map was rendered in between, so shadows don't slide.
- Frames are drawn only when something changes. drei's `PerformanceMonitor` read idle gaps as slow frames, so adaptive resolution now uses a small monitor that only averages runs of consecutive frames.
- Layers are split into grid cells for culling ([ADR 0003](0003-merged-meshes-per-layer.md)), and rooftop details are hidden past a distance per tier.

**Consequences.**
- Every device gets a better look for free; desktops get the full one.
- Medium and High re-draw the shadow casters near the shadowed square only on frames where it moves (and at most every few frames while it does).
- The sky blends into the haze after tone mapping, like fog on three.js materials, so the horizon has no seam on any tier.
- Automatic switching from measured frame times is still to come (tiles and tiers milestone).
