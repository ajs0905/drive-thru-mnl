# 0011: Lighting and post effects, switched by quality tier

**Status:** Accepted

**Context.** Even with windows and road markings the city looked flat: no shadows, no darkening where things meet, raw colors straight to the screen. Shadows and screen-space ambient occlusion are the biggest visual upgrades, but also the most expensive ones, and the game has to stay smooth on a low-mid phone (Realme 8).

**Decision.** Add the effects now, each tied to a quality tier from the start (`src/scene/quality.ts`), instead of waiting for the full tier system:

| | Low | Medium | High |
| --- | --- | --- | --- |
| ACES tone mapping, sky haze, wall contact darkening | on | on | on |
| Sun shadows around the camera's focus | off | 2048 map | 4096 map |
| Ambient occlusion (N8AO), bloom, multisampled buffers | off | off | on |
| Filler city past the map | 40% | full | full |
| Pixel ratio | 0.75 to 1 | 1 to 1.5 | 1 to 2 |

- The cheap parts are on everywhere: tone mapping through the renderer, and wall darkening near the ground computed in the window shader (baked ambient occlusion, no extra pass).
- Shadows cover a square around the controls' target, sized by camera distance and moved in whole shadow-map texels, so they're sharp up close without a huge map. The scenery ring doesn't cast.
- Post effects use pmndrs `postprocessing` through `@react-three/postprocessing`, loaded with `React.lazy`, so Low and Medium never download that code (about 104 KB gzipped).
- The tier starts from a guess (coarse pointer = phone = Low; 4 GB or 4 cores = Medium; else High), can be changed in the HUD or with `?q=low|medium|high`, and is remembered. A tier change recreates the canvas, since shadows and buffers are set up at creation.

**Consequences.**
- Every device gets a better look for free; desktops get the full one.
- Medium's shadow pass re-draws the shadow casters (about 118k extra triangles); High adds the post passes (44 draw calls in total).
- three.js applies fog after tone mapping, but post-effect tone mapping runs after fog. The sky blends into the haze after tone mapping to match, so the horizon has no seam on any tier; High's overall brightness differs slightly from Low/Medium.
- Automatic switching from measured frame times is still to come (tiles and tiers milestone).
