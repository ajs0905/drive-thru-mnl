# Performance

Budgets per quality tier, what's been measured, and how to measure on a real phone. Tiers are described in [ARCHITECTURE.md, Quality tiers](ARCHITECTURE.md#8-quality-tiers).

## Budgets

Targets the game should meet once tiles and tiers are in. "Phone" means a low-mid range Android phone, the reference device for the Low tier.

| | Low (low-mid phone) | Medium | High (desktop) |
| --- | --- | --- | --- |
| Frame rate | Steady 30 FPS | 45 to 60 FPS | 60 FPS |
| Draw calls | ≤ 60 | ≤ 120 | ≤ 250 |
| Triangles on screen | ≤ 150k | ≤ 300k | ≤ 800k |
| JS heap | ≤ 100 MB | ≤ 150 MB | ≤ 300 MB |
| GPU buffers | ≤ 40 MB | ≤ 80 MB | ≤ 200 MB |
| First view (4G, cold cache) | ≤ 3 s | ≤ 3 s | ≤ 2 s |
| Longest main-thread stall while driving | ≤ 50 ms | ≤ 50 ms | ≤ 33 ms |

## Measured

### 2026-11-14, before tiles (whole map at once)

Headless Chrome on a desktop CPU with a software renderer (no GPU), so frame rate here is meaningless; everything else is representative. Updated after the Better buildings and Lighting milestones (values before Better roads + sky in brackets). Draw calls and triangles are per tier and count every render pass in a frame (the overlay adds them up).

| What | Value | Notes |
| --- | --- | --- |
| JS bundle | 1.21 MB, **338 KB gzipped** (321) | Mostly three.js, React Three Fiber and drei (drei is only used for `MapControls`) |
| Map data (`bgc.json`) | 3.13 MB, **751 KB gzipped** (657) | Whole map in one JSON file; junction polygons, gap patches, zebras and lane/sidewalk tags added about 80 KB, walls, trees and fixtures 15 KB more |
| City mesh build | **about 300 ms** (213), main thread | Freezes the page while it runs; sidewalks, junction polygons and roof prop placement (about 15 ms) are new work |
| Draw calls | **about 50 to 80** (8) | Layers split into 1.2 km grid cells so off-screen cells are skipped; the shadow pass adds a few on Medium and High while the camera moves. Trees and street fixtures added 10 to 17 (two instanced shapes per cell, plus their shadows). |
| Triangles drawn | Low **about 265k** at street level, **296k** in the overview; Medium and High **about 315k to 350k** | Everything stays on the GPU, but cells off screen are skipped. About 35k are trees (919, 38 triangles each, hidden past 1 to 3 km per tier), about 38k rooftop details (2,800 instances, hidden past a distance per tier); the filler city is 3,300 blocks on Low and 8,200 on Medium and High. Shadow re-renders only draw cells near the shadowed square |
| GPU buffers (estimated) | ~30 MB | 213k merged triangles x 3 vertices x 36 bytes (position, normal, color), plus 16 bytes per road and building vertex for markings and windows |
| JS heap after load | **about 51 MB used** | MapData objects + typed arrays |
| Pipeline | 2.5 s processing (0.67) | `npm run pipeline`, output byte-identical on re-run. Most of the increase is the 0.5 m paving raster around every junction (run twice); offline, so it doesn't affect players |

**Against the Low budget:** draw calls and memory are fine. Triangles (about 265k to 296k) are still over the 150k Low budget because 1.2 km cells are coarse, and the 300 ms build on the main thread would be several times longer on a phone. Both are what tiles, distance-based detail and a Web Worker build are for.

### Performance pass (after the first desktop measurement)

The development laptop measured **23 FPS on High** (46 draw calls, 452k triangles). The cost was mostly per pixel: the logarithmic depth buffer disabled early depth testing, the pixel ratio went up to 2, the 4096 shadow map was re-rendered every frame, and screen-space ambient occlusion ran on multisampled buffers. Changes: reversed depth buffer, lower pixel-ratio caps with automatic scaling from the frame rate, shadows re-rendered only when their area moves (plain PCF, 1024/2048 maps), no clouds on Low, ambient occlusion dropped and multisampling replaced by SMAA. On the software renderer used here (vertex-bound, so a weak stand-in for a GPU) at a fixed 480x300: Low 4 → 4 FPS, Medium 2 → 3, High 1.5 → 3. On the development laptop High went from 23 to 77-105 FPS; see below.

### Second performance pass

After the first pass the development laptop ran Low and Medium at the screen's 144 Hz limit but High at 70 to 85 FPS. Changes: no post-processing chain on High (hardware anti-aliasing instead, pixel ratio capped at 1.25), shadow re-renders throttled while the camera moves, layers split into grid cells for frustum culling, rooftop details hidden by distance, filler city in direction sectors, and frames drawn only when something changes (idle costs nothing). Two libraries removed. Software renderer at 480x300 (vertex-bound stand-in): Low 4 → 7 FPS, Medium 3 → 3, High 3 → 2 to 3. Draw calls 40 to 60 depending on the view; triangles drawn at street level about 230k on Low (was 285k always).

### Desktop with a GPU

Run `npm run dev`, open the page, read the overlay at the bottom left (FPS, draw calls, triangles, build time). On laptops with two GPUs, check that the browser runs on the dedicated one (`chrome://gpu`, or Windows Settings > Display > Graphics > browser > High performance).

| Date | Machine | Tier | FPS | Notes |
| --- | --- | --- | --- | --- |
| 2026-11-14 | Development laptop (dedicated mid-range GPU) | High | 23 | Before the performance pass (log depth, pixel ratio up to 2, 4096 shadows every frame, N8AO + 4x MSAA) |
| 2026-11-14 | same | High | 77 to 105 | After the performance pass |
| 2026-11-14 | same | Medium | 101 to 144 | After the first pass (144 Hz screen cap) |
| 2026-11-14 | same | Low | 139 to 144 | After the first pass (144 Hz screen cap) |
| 2026-11-14 | same | High | 144 while moving, idle when still | After the second pass (capped by the 144 Hz screen) |

### Low-mid range phone

To fill in (see below for how).

| Date | Browser | FPS (overview) | FPS (street level) | Build time | JS heap |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## How to measure on an Android phone

1. On the phone, enable Developer options: tap **Build number** seven times (under **Settings > About phone**, the exact path depends on the phone). Then turn on **USB debugging** in **Developer options**.
2. Connect the phone to the PC by USB and allow debugging when the phone asks.
3. On the PC, run `npm run dev` (or `npm run build` then `npm run preview` to measure the production build, which is what players get).
4. On the PC, open `chrome://inspect` in Chrome, click **Port forwarding**, and forward the dev server port (for example `5173` to `localhost:5173`). Then open `localhost:5173` in Chrome on the phone.
   - Alternative without USB forwarding: `npm run dev -- --host`, then open the `Network:` address it prints on the phone (same Wi-Fi).
5. Back in `chrome://inspect`, the phone's tab appears; click **inspect**.
6. In the DevTools window:
   - **Performance** tab: record 10 s of moving the camera. Look at FPS, long tasks (red corners) and the main-thread flame chart.
   - **Memory** tab: take a heap snapshot after load for JS heap size.
   - The game's own overlay shows FPS, draw calls, triangles and build time.

## Known costs and planned fixes

| Cost | Fix | Milestone |
| --- | --- | --- |
| Whole map in memory and on the GPU | Tile streaming, dispose far tiles | Tiles, streaming, tiers |
| 300 ms main-thread build | Build tiles in a Web Worker, spread work across frames | Tiles, streaming, tiers |
| 736 KB JSON parsed at once | Binary tiles (typed arrays, quantized), loaded on demand | Tiles, streaming, tiers |
| About 265k to 296k triangles drawn on Low | Distance-based detail: far scenery as boxes or hidden, simplified outlines (Ramer-Douglas-Peucker) | Tiles, streaming, tiers |
| Logarithmic depth buffer (costly on mobile GPUs) | Off on Low/Medium, tighter near/far planes instead | Tiles, streaming, tiers |
| drei pulled in for one component | Import `MapControls` directly from three.js examples | Any time |
| Garbage collection pauses while driving | Pre-allocate and reuse per-frame objects | Drivable car |
| Shadow pass re-draws all playable buildings (one merged mesh, no culling) | Per-tile meshes so only tiles near the shadowed square cast | Tiles, streaming, tiers |
| Road shader cost on phones (`fwidth`, a few branches per road pixel) | Simpler marking path on Low (no antialiasing, no dashes in the distance) | Tiles, streaming, tiers |
| Sky shader with procedural clouds runs on every sky pixel (fbm noise) | Lower cloud detail or a static sky on Low | Tiles, streaming, tiers |
| Rooftop details (38k triangles) | Hide on Low, or only near the camera | Tiles, streaming, tiers |
| Trees (35k triangles, 10+ draw calls) | One mesh per tree type with trunk and crown together, fewer and bigger cells | Tiles, streaming, tiers |
| Filler city past the map (33k to 82k triangles) | Merge far blocks into a few big ones, or a skyline card per direction | Tiles, streaming, tiers |
| Window shader on every wall pixel | Plain walls or the average color on Low | Tiles, streaming, tiers |

## Lessons from Slow Roads

[Slow Roads](https://slowroads.io) is a three.js driving game that runs smoothly on low-mid range phones. Its developer's [case study on web.dev](https://web.dev/case-studies/slow-roads) lists techniques worth copying: full detail only near the road, lower detail far away; heavy work spread across frames; geometry recycled instead of reallocated; per-frame memory pre-allocated to avoid garbage collection pauses; simple custom physics; adjustable view distance; FPS telemetry to suggest settings.
