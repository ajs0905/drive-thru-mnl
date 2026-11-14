# Performance

Budgets per quality tier, what's been measured, and how to measure on a real phone. Tiers are described in [ARCHITECTURE.md, Quality tiers](ARCHITECTURE.md#8-quality-tiers).

## Budgets

Targets the game should meet once tiles and tiers are in. "Phone" means the reference low-mid device, a **Realme 8**.

| | Low (Realme 8) | Medium | High (desktop) |
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
| Post effects chunk | 182 KB, **82 KB gzipped** | `postprocessing` (bloom, tone mapping, SMAA); only downloaded on High |
| Map data (`bgc.json`) | 3.06 MB, **736 KB gzipped** (657) | Whole map in one JSON file; junction polygons, gap patches, zebras and lane/sidewalk tags added about 80 KB |
| City mesh build | **about 300 ms** (213), main thread | Freezes the page while it runs; sidewalks, junction polygons and roof prop placement (about 15 ms) are new work |
| Draw calls | Low **13** (8), Medium **13 to 17**, High **about 30 to 35** | One merged mesh per layer, plus the sky (clouds are part of the sky shader), two instanced meshes for rooftop details, one for the filler city and one for the hills. Medium and High add the shadow pass only on frames where the shadowed area moves; High adds the bloom, tone mapping and SMAA passes |
| Triangles | Low **284,902** (230,112), Medium and High **about 452k** | The whole city is always on the GPU; about 38k are rooftop details (2,800 instances, bottoms removed); the filler city past the map is 3,300 blocks (33k) on Low and 8,200 (82k) on Medium and High. Medium and High also re-draw the shadow casters (playable buildings, flyover structures, roof details) into the shadow map, about 118k more |
| GPU buffers (estimated) | ~30 MB | 213k merged triangles x 3 vertices x 36 bytes (position, normal, color), plus 16 bytes per road and building vertex for markings and windows |
| JS heap after load | **about 51 MB used** | MapData objects + typed arrays |
| Pipeline | 2.5 s processing (0.67) | `npm run pipeline`, output byte-identical on re-run. Most of the increase is the 0.5 m paving raster around every junction (run twice); offline, so it doesn't affect players |

**Against the Low budget:** draw calls and memory are fine. Triangles (285k) are over the 150k Low budget because the whole city is always drawn, and the 300 ms build on the main thread would be several times longer on a phone. Both are what tiles, distance-based detail and a Web Worker build are for.

### Performance pass (after the first desktop measurement)

Adrian's desktop measured **23 FPS on High** (46 draw calls, 452k triangles). The cost was mostly per pixel: the logarithmic depth buffer disabled early depth testing, the pixel ratio went up to 2, the 4096 shadow map was re-rendered every frame, and screen-space ambient occlusion ran on multisampled buffers. Changes: reversed depth buffer, lower pixel-ratio caps with automatic scaling from the frame rate, shadows re-rendered only when their area moves (plain PCF, 1024/2048 maps), no clouds on Low, ambient occlusion dropped and multisampling replaced by SMAA. On the software renderer used here (vertex-bound, so a weak stand-in for a GPU) at a fixed 480x300: Low 4 → 4 FPS, Medium 2 → 3, High 1.5 → 3. Real-GPU numbers to be filled in below.

### Desktop with a GPU

To fill in: run `npm run dev`, open the page, read the overlay at the bottom left (FPS, draw calls, triangles, build time).

| Date | Machine / browser | FPS (overview) | FPS (street level) | Build time |
| --- | --- | --- | --- | --- |
| | | | | |

### Realme 8

To fill in (see below for how).

| Date | Browser | FPS (overview) | FPS (street level) | Build time | JS heap |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## How to measure on the Realme 8

1. On the phone, enable Developer options: on realme UI it's **Settings > About phone > Version**, tap **Build number** seven times. Then turn on **USB debugging** (on realme UI under **Settings > Additional settings > Developer options**).
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
| 285k triangles always drawn (Low) | Distance-based detail: far scenery as boxes or hidden, simplified outlines (Ramer-Douglas-Peucker) | Tiles, streaming, tiers |
| Logarithmic depth buffer (costly on mobile GPUs) | Off on Low/Medium, tighter near/far planes instead | Tiles, streaming, tiers |
| drei pulled in for one component | Import `MapControls` directly from three.js examples | Any time |
| Garbage collection pauses while driving | Pre-allocate and reuse per-frame objects | Drivable car |
| Shadow pass re-draws all playable buildings (one merged mesh, no culling) | Per-tile meshes so only tiles near the shadowed square cast | Tiles, streaming, tiers |
| Road shader cost on phones (`fwidth`, a few branches per road pixel) | Simpler marking path on Low (no antialiasing, no dashes in the distance) | Tiles, streaming, tiers |
| Sky shader with procedural clouds runs on every sky pixel (fbm noise) | Lower cloud detail or a static sky on Low | Tiles, streaming, tiers |
| Rooftop details (38k triangles) | Hide on Low, or only near the camera | Tiles, streaming, tiers |
| Filler city past the map (33k to 82k triangles) | Merge far blocks into a few big ones, or a skyline card per direction | Tiles, streaming, tiers |
| Window shader on every wall pixel | Plain walls or the average color on Low | Tiles, streaming, tiers |

## Lessons from Slow Roads

[Slow Roads](https://slowroads.io) is a three.js driving game that runs on the Realme 8. Its developer's [case study on web.dev](https://web.dev/case-studies/slow-roads) lists techniques worth copying: full detail only near the road, lower detail far away; heavy work spread across frames; geometry recycled instead of reallocated; per-frame memory pre-allocated to avoid garbage collection pauses; simple custom physics; adjustable view distance; FPS telemetry to suggest settings.
