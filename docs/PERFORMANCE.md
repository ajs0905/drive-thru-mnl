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

Headless Chrome on a desktop CPU with a software renderer (no GPU), so frame rate here is meaningless; everything else is representative.

| What | Value | Notes |
| --- | --- | --- |
| JS bundle | 1.18 MB, **321 KB gzipped** | Mostly three.js, React Three Fiber and drei (drei is only used for `MapControls`) |
| Map data (`bgc.json`) | 2.70 MB, **657 KB gzipped** | Whole map in one JSON file |
| City mesh build | **213 ms**, main thread | Freezes the page while it runs |
| Draw calls | **8** | One merged mesh per layer |
| Triangles | **230,112** | Whole city, always on the GPU |
| GPU buffers (estimated) | ~25 MB | 230k triangles x 3 vertices x 36 bytes (position, normal, color) |
| JS heap after load | **44 MB used**, 56 MB total | MapData objects + typed arrays |
| Pipeline | 0.67 s processing, 1.4 s total | `npm run pipeline`, output byte-identical on re-run |

**Against the Low budget:** draw calls and memory are fine. Triangles (230k) are over the 150k Low budget because the whole city is always drawn, and the 213 ms build on the main thread would be several times longer on a phone. Both are what tiles, distance-based detail and a Web Worker build are for.

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
| 213 ms main-thread build | Build tiles in a Web Worker, spread work across frames | Tiles, streaming, tiers |
| 657 KB JSON parsed at once | Binary tiles (typed arrays, quantized), loaded on demand | Tiles, streaming, tiers |
| 230k triangles always drawn | Distance-based detail: far scenery as boxes or hidden, simplified outlines (Ramer-Douglas-Peucker) | Tiles, streaming, tiers |
| Logarithmic depth buffer (costly on mobile GPUs) | Off on Low/Medium, tighter near/far planes instead | Tiles, streaming, tiers |
| drei pulled in for one component | Import `MapControls` directly from three.js examples | Any time |
| Garbage collection pauses while driving | Pre-allocate and reuse per-frame objects | Drivable car |

## Lessons from Slow Roads

[Slow Roads](https://slowroads.io) is a three.js driving game that runs on the Realme 8. Its developer's [case study on web.dev](https://web.dev/case-studies/slow-roads) lists techniques worth copying: full detail only near the road, lower detail far away; heavy work spread across frames; geometry recycled instead of reallocated; per-frame memory pre-allocated to avoid garbage collection pauses; simple custom physics; adjustable view distance; FPS telemetry to suggest settings.
