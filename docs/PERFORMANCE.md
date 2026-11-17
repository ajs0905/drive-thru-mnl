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

Download budgets, checked on every build (`npm run size`, `tools/bundleBudget.ts`), gzipped: main chunk 430 kB (three.js, React and the 3D libraries, the menus and the map building), Drive chunk 900 kB (about 836 kB of it is the Rapier physics engine; its compat build packs the WebAssembly into the JavaScript), CSS 9 kB, any other chunk 25 kB. Set a few percent over the sizes on 2026-11-17, so an accidental import shows up (the traffic sim slipping into the main chunk added 8 kB). The map data (806 kB gzipped) isn't a chunk; `data:check` keeps it to what the pipeline builds. A later step: Rapier's build that ships the engine as a separate `.wasm` file, about 220 kB smaller gzipped (its WebAssembly is 803 kB gzipped as base64 text, 586 kB as a binary file) and cached on its own.

## Measured

### 2026-11-14, before tiles (whole map at once)

Headless Chrome on a desktop CPU with a software renderer (no GPU), so frame rate here is meaningless; everything else is representative. Updated after the Better buildings and Lighting milestones (values before Better roads + sky in brackets). Draw calls and triangles are per tier and count every render pass in a frame (the overlay adds them up).

| What | Value | Notes |
| --- | --- | --- |
| JS bundle | 1.22 MB, **342 KB gzipped** (321) | Mostly three.js, React Three Fiber and drei (drei is only used for `MapControls`) |
| Drive chunk | 2.3 MB, **867 KB gzipped** | Downloaded only when driving starts: the Rapier physics engine (WebAssembly embedded as base64, which compresses poorly) plus the car code. The car model is 16 KB gzipped |
| Map data (`bgc.json`) | 3.13 MB, **751 KB gzipped** (657) | Whole map in one JSON file; junction polygons, gap patches, zebras and lane/sidewalk tags added about 80 KB, walls, trees and fixtures 15 KB more |
| City mesh build | **about 300 ms** (213), main thread | Freezes the page while it runs; sidewalks, junction polygons and roof prop placement (about 15 ms) are new work |
| Draw calls | **about 50 to 80** (8) | Layers split into 1.2 km grid cells so off-screen cells are skipped; the shadow pass adds a few on Medium and High while the camera moves. Trees and street fixtures added 10 to 17 (two instanced shapes per cell, plus their shadows); the tree models add 6 to 11 more on Medium and High (up to four models per cell). |
| Triangles drawn | Low **about 265k** at street level, **296k** in the overview; Medium and High **about 315k to 350k** | Everything stays on the GPU, but cells off screen are skipped. Trees are 35k on Low (919, 38 triangles each) and 63k on Medium and High (tree models, 68 on average), hidden past 1 to 3 km per tier; about 38k rooftop details (2,800 instances, hidden past a distance per tier); the filler city is 3,300 blocks on Low and 8,200 on Medium and High. Shadow re-renders only draw cells near the shadowed square |
| GPU buffers (estimated) | ~30 MB | 213k merged triangles x 3 vertices x 36 bytes (position, normal, color), plus 16 bytes per road and building vertex for markings and windows |
| JS heap after load | **about 51 MB used** | MapData objects + typed arrays |
| Pipeline | 2.5 s processing (0.67) | `npm run pipeline`, output byte-identical on re-run. Most of the increase is the 0.5 m paving raster around every junction (run twice); offline, so it doesn't affect players |

**Against the Low budget:** draw calls and memory are fine. Triangles (about 265k to 296k) are still over the 150k Low budget because 1.2 km cells are coarse, and the 300 ms build on the main thread would be several times longer on a phone. Both are what tiles, distance-based detail and a Web Worker build are for.

### Performance pass (after the first desktop measurement)

The development laptop measured **23 FPS on High** (46 draw calls, 452k triangles). The cost was mostly per pixel: the logarithmic depth buffer disabled early depth testing, the pixel ratio went up to 2, the 4096 shadow map was re-rendered every frame, and screen-space ambient occlusion ran on multisampled buffers. Changes: reversed depth buffer, lower pixel-ratio caps with automatic scaling from the frame rate, shadows re-rendered only when their area moves (plain PCF, 1024/2048 maps), no clouds on Low, ambient occlusion dropped and multisampling replaced by SMAA. On the software renderer used here (vertex-bound, so a weak stand-in for a GPU) at a fixed 480x300: Low 4 → 4 FPS, Medium 2 → 3, High 1.5 → 3. On the development laptop High went from 23 to 77-105 FPS; see below.

### Second performance pass

After the first pass the development laptop ran Low and Medium at the screen's 144 Hz limit but High at 70 to 85 FPS. Changes: no post-processing chain on High (hardware anti-aliasing instead, pixel ratio capped at 1.25), shadow re-renders throttled while the camera moves, layers split into grid cells for frustum culling, rooftop details hidden by distance, filler city in direction sectors, and frames drawn only when something changes (idle costs nothing). Two libraries removed. Software renderer at 480x300 (vertex-bound stand-in): Low 4 → 7 FPS, Medium 3 → 3, High 3 → 2 to 3. Draw calls 40 to 60 depending on the view; triangles drawn at street level about 230k on Low (was 285k always).

### Tree models

Built-in tree models replace the trunk-plus-crown trees on Medium and High ([ADR 0013](decisions/0013-tree-models-built-in-code.md)). Same headless setup, 1280x720, `?render=always`, main pass only (no shadow re-render in these frames); draw calls / triangles:

| View | Low (unchanged) | Medium before → after | High before → after |
| --- | --- | --- | --- |
| Park (`cam=-170,28,-30,-80,2,-90`) | 57 / 280k | 60 / 307k → 70 / 332k | 64 / 312k → 74 / 337k |
| Palm street (`cam=760,22,-880,840,2,-990`) | 32 / 130k | 32 / 149k → 38 / 165k | 32 / 149k → 38 / 165k |
| Overview (README hero) | 68 / 305k | 77 / 357k → 88 / 384k | 79 / 360k → 90 / 387k |

Whole map: 34.9k → 62.7k tree triangles, 14 → 26 instanced tree meshes. Medium was already over its 300k budget in the park and overview views (307k, 357k) and is now at 332k and 384k. Distance-based detail in the tiles milestone (billboards for far trees among it) is where that comes back.

### Drivable car (first step)

Parked cars (1,705 on the map): one GLB of six models, 91 KB gzipped, loaded after the city so it never holds it up. Up to 7 draw calls (one per model in view plus the far box cars). Triangles depend on how many are near: estimated from the real placements at 300 sampled spots, before culling cars outside the view (which roughly halves it), Low (35 m near, 170 m draw distance) about 20k at the median spot and 39k at the worst, Medium (70, 300) 38k and 68k, High (100, 450) 70k and 115k. Most of that is the 1,400 to 1,750 triangle models near the camera; the far box cars are 30 triangles each. In Drive mode at most the cars within 85 m are physics bodies, asleep until hit. The main bundle grew from 339 to 355 KB gzipped, mostly the glTF loader, which moved there from the Drive chunk (that one shrank from 872 to 852 KB).

The Sedan adds about 1,500 triangles and 12 draw calls (body, two lamp meshes, four wheels, the blob shadow, four lamp halos; halos facing away from the camera are skipped); it casts no shadow-map shadow. Body lean, the gearbox and the drift assist are a few arithmetic operations per frame or physics step.

Collisions (8b, 8c): two static triangle meshes (walls; decks, ramps, pillars and posts), about 82k triangles and 3.0 MB together, built when driving starts in about 50 to 75 ms (our code) plus 60 to 100 ms (Rapier's index), measured in Node on the development container. The flyover fixes added the posts under raised buildings and the outrigger pillars (about 6k triangles) and grew the map file by about 9 KB gzipped. Per step, Rapier only tests the car against the few triangles near it, plus one ray for the camera per frame. Physics is one rigid body and a ground collider, stepped at 60 Hz. While driving, rendering is continuous instead of on demand. Headless at 960x540 on Medium, a street-level drive drew 53 to 80 draw calls and 266k to 400k triangles depending on where the car points (the chase camera sees more of the city at once than the map's usual views). Frame rate there means nothing (software renderer); on real hardware it's still to be measured.

### Looks, map scale and the edge

- **Map scale 1.2x** ([ADR 0017](decisions/0017-map-scale.md)): the same buildings, roads and props over more ground, so draw calls and triangles barely change. Camera spots (`cam=...`) in the sections above were measured before it: multiply x and z by 1.2 to find the same place now.
- **Parked cars** went from 1,705 to 981 (about 30% of the curb slots, right curb only on one-way streets), so their triangles near the camera dropped by roughly 40%. Each drawn car also gets a blob shadow: one more instanced draw call, 40 triangles per car.
- **Car shine** (`scene/carShine.ts`): a few math operations per car pixel, no textures, no extra pass. The GLBs grew by the `shine` attribute: the Sedan 16.5 → 16.8 KB gzipped, the parked models 91 → 93 KB.
- **Speed blur** (Medium and High, Drive mode): free below about 95 km/h. The first version drew the whole frame into an off-screen buffer above 100 km/h (MSAA, half float, float depth) and ran two full-screen passes (an 8-sample blur, then tone mapping); on the development laptop the frame rate visibly dropped the moment it switched on. Now the scene is drawn to the screen as usual, the finished frame is copied into a texture, and the blur is drawn over the edges only (the sharp middle is skipped). In the headless software renderer at 960x540 on High, with the blur forced on: no blur 459 ms per frame, old blur 690 ms (+50%), new blur 513 ms (+12%). Software rendering makes per-pixel work look bigger than on a GPU, so read it as a ratio. The blur is compiled at the start of the drive, so the first fast stretch doesn't stutter. Low never runs it.
- **Minimap and big map**: they drew every road and building in view as shapes on each redraw (the minimap 20 times a second, the big map on every step of a pan or zoom). Now they paste cached tiles (`ui/mapTiles.ts`), and the minimap skips redraws while the car stands still. Main-thread time per redraw in headless Chrome: minimap 0.14 -> 0.05 ms, big map zoomed out 4.6 -> 0.7 ms, zoomed in 0.8 -> 0.3 ms (the pixel work happens on the GPU in both). While the big map is open the game is paused and draws no frames, so the `?debug` frame counter drops toward 0 and then says idle: that isn't slowness.
- **Playable edge**: keeping the hoarding and roadblocks clear of buildings adds about 60 ms to the city build and about 50 ms each to laying out the roadblocks (on load) and the collisions (when driving starts), measured in Node. The hoarding is a few hundred triangles in one mesh and one draw call (ripples and seams are in the shader), plus the old outline mesh for the map view. The roadblocks are 623 concrete barriers along the road crossings, plus 47 full roadblocks with a sign and 408 barricades, drums and cones (about 77k triangles over the whole edge), five instanced meshes drawn only within the parked-car draw distance (170 m on Low), so a view near the edge draws one to three roadblocks. In Drive mode the loose pieces within 45 m are physics bodies (asleep until hit); the concrete row adds to the walls collision mesh.
- Main bundle 368 KB gzipped (was 355): the edge fence, roadblocks (with the baked Kenney shapes) and car shine code; the nested-building check is pipeline only. Map data 2.98 MB, 723 KB gzipped (was 751): the stretched map dropped some scenery past the 300 m ring.

### Menus and HUD

- **Menu**: a 92 KB still image instead of the live city, so the menu shows before the 3D city is ready. The city still builds behind it, so pressing Play needs no second wait for the map.
- **HUD**: plain DOM over the canvas, updated outside React. The speed is written straight into its element every frame, the street name is looked up 4 times a second (a segment grid) and the minimap is a 2D canvas redrawn about 20 times a second, only the 100 m grid cells around the car. The big map pauses the game and draws only when moved or zoomed.
- **Font**: Overpass is bundled (no font service). Browsers fetch only the subset the text uses: the 39 KB Latin file.
- **Loading**: the map download reports real progress when the server sends its size uncompressed; with compression it shows the megabytes read instead.
- Main bundle 379 KB gzipped (was 368): the menu, loading screens, HUD, map drawing and touch controls. The Drive chunk is unchanged.

### Lots and street furniture

Closing off empty lots and the sidewalk furniture ([ADR 0018](decisions/0018-world-channelling.md)). Headless Chrome, software renderer, 1280x720, Medium, map view, the overlay's idle counts (draw calls / triangles), before and after:

| View (`?cam=`) | Before | After |
| --- | --- | --- |
| Over a construction site (`-190,60,190,-273,0,169`) | 46 / 161k | 56 / 216k |
| Overview (`-500,400,800,0,0,0`) | 100 / 386k | 105 / 460k |
| Street level on an avenue (`-560,12,-560,-544,1,-573`) | 69 / 305k | 79 / 351k |

- The walls are barriers in the existing structure cells (no new draw calls); hoarding posts and lot wall pillars are a few boxes each. Most of the extra triangles are the walls and the containers (288 triangles each, all 64 drawn within the landmark distance).
- The dressing is one instanced mesh per kind for the whole map (18 at most), each holding only the pieces within reach of the focus, refilled when it moves 20 m (a loop over 2,876 pieces). The first version used a mesh per kind per 160 m cell and added 20 to 50 draw calls in the same views. On Low only the four landmark kinds are drawn.
- Collisions: about 87k to 113k triangles (the furniture is 8 triangles a box, the new bollards hexagonal prisms), 3.2 to 4.1 MB.
- Map data 3.25 MB, 766 KB gzipped (was 3.05 MB, 723 KB); `props.glb` 21 KB gzipped, loaded after the city like the parked cars. Main bundle 383 KB gzipped (was 382).

### Light traffic

24, 32 or 40 cars by tier (ADR 0027; it was 10, 14 or 18, which cost no frames on either phone). The simulation costs about 60 µs per 60 Hz step at 24 cars, 95 at 32 and 120 at 40 (headless, `npm run bench`; the in-front check looks at every car, so it grows faster than the count), with no garbage made per step (lane lists, obstacles and poses reuse their objects). Drawn with the parked cars' models: one instanced mesh per model, one for all the wheels, one for the lamp halos and turn signals, two for the contact and sun shadows, and one for box cars, so up to 11 more draw calls. Past 60, 90 or 120 m from the camera by tier a car is the parked cars' 32-triangle box car with no wheels, halos or sun shadow (bodies are 1,000 to 1,400 triangles, wheels 92 each), so most of the extra cars cost little: in a headless browser on Low at the start spot, 67 to 73 draw calls and 246k to 251k triangles with 24 cars, against 74 to 75 and 261k to 262k with the old 10. Traffic doesn't cast into the shadow map (ADR 0026), so it adds nothing to the shadow pass. Cars within 70 m of the player are kinematic physics bodies (a box each); a knocked car is a dynamic one until it rejoins. Not yet measured on a phone at the new counts.

### Pausing, the full map and the menus

The physics and the canvas stop while any of them is open (drawing on demand). Three costs on the way back were fixed: the first frame after a pause stepped the physics through the whole pause (clamped to half a second: 30 steps of physics and traffic in one frame, and a visible jump), now skipped (`ResumeClock`); the resolution's frame-rate count could drop the resolution from the odd frame drawn while paused, and now ignores those and the first frames after resuming (45 now); and the MODES / CARS menu's map preview built its tiles again every time it opened, now kept like the full map's. Opening or closing one costs one React render of about 3 to 6 ms (the menu about 20 ms the first time), measured in a headless browser on the development container. The full map was the one still costing a stutter on a phone when opened or closed while moving. It now stays mounted while driving: hidden, it draws nothing and keeps its canvas and tiles, so opening it doesn't build anything; the minimap's loop rests while the physics is held; the clock reset runs before the first frame back (a layout effect, so no frame steps the pause); the resolution's count skips the first 45 frames back; and the city, the props and the physics world sit in a memoized subtree, so toggling the map or the pause menu re-renders only the HUD. The headless browser can't show the difference (its frames take 150 to 200 ms either way); still to be checked on the phones.

### Street and traffic lights

1,106 street lights and 194 traffic lights as dressing (a fourth reach tier, `dressingMid`: 220 m on Low, 320 on Medium, 450 on High, so the tall poles don't pop in at the street clutter's 90 to 120 m and are drawn on Low too). Three more instanced meshes: at most 3 more draw calls (measured +2 in the same three Medium views as above: 58 / 232k, 107 / 472k, 80 / 366k). The poles are 100 triangles (street light), 320 (mast arm with two heads) and 164 (short pole). Collisions grew by about 9k triangles (8 per pole box). Map data 3.31 MB, 779 KB gzipped; `props.glb` 24 KB gzipped.

### Cycling lights and road signs

The lit lenses are two instanced meshes ([ADR 0028](decisions/0028-traffic-lights-and-road-signs.md)): a 10-triangle disc over each of a head's three lenses and a halo quad over the lit one, for the heads within the poles' reach, so 2 more draw calls. The list of heads in reach is refilled when the camera moves 15 m; each frame only sets their colors and matrices (a few hundred at most). The signal clock is a few multiplications per intersection; the traffic asks it for a lamp only as a car nears a stop line, and the bench measures the same cost per step as before within its spread. The 552 road signs are 18 triangles each, one instanced mesh per face in reach (at most 9 more draw calls; stop and one-way signs are most of them, so usually 3 or 4), with a 512 px canvas texture shared by all. They are knockable like the street lights, in the same pool. Map data 3.35 MB, 806 KB gzipped (was 3.31 MB, 775 KB). Not yet measured on a phone.

### Desktop frame drops while driving (profiled)

Reported as frame drops on desktop during play. Profiled with Chrome's CPU profiler while driving on High for 25 s, with WebGL's draw calls stubbed out so the headless software renderer doesn't drown the JavaScript ([ADR 0029](decisions/0029-phone-layouts-steered-dodges-pose-churn.md)):

- The JavaScript per frame was the same before and after the traffic lights and signs (main thread busy 224 vs 229 ms per second), with no new garbage collection. The lamps and signs add 6 draw calls (81 to 87 at the start spot).
- The real cost: a parked car, sign or other prop that had been bumped kept rewriting its pose every frame even once at rest, bumping the poses' version, so the parked cars (every car within 450 m on High) and all 4,640 pieces of street furniture were re-laid into their instanced meshes every frame for as long as it stayed in the physics pool. In the profile the parked cars' refill went from 232 ms to 27 ms over the 25 s once a pose that hasn't moved (1 mm, 1e-4 in the quaternion) stopped counting as a change; the main thread from 241 to 211 ms per second. This grew with the signs: more things to knock over.
- The traffic sim had slipped into the main bundle (the signals imported two helpers from it); they now have their own module, and a test keeps the sim out (main bundle 418 KB back to 410 KB gzipped).
- The lamps are only drawn for signal heads in view and within 260 m, and the furniture refill check no longer builds a string every frame.
- `npm run dev` runs React's development checks and unminified code (here about 5% more main-thread time than the build): judge frame rate with `npm run build` and `npm run preview`.

### Knockable and breakaway props

The street furniture left the static collision meshes (125k to 99k triangles) for pooled bodies near the player ([ADR 0019](decisions/0019-knockable-and-breakaway-props.md)): at most 28 knockable bodies within 35 m (asleep until hit, put to sleep after 3 s lying still), fixed bodies for the sheds, kiosks and booth within 40 m, and at most 30 debris bodies (no shadows, removed after 12 s out of sight). The renderer redraws the dressing's instance lists only when a piece moves or the focus moves 20 m (a loop over the 4,040 pieces, a fraction of a millisecond). Main bundle 387 KB gzipped (was 384), Drive chunk 861 KB.

### Building forms

Hip roofs, podium towers and shopfronts ([ADR 0020](decisions/0020-building-forms.md)) are built into the same merged building cells: no new draw calls. Same Medium views as above: 58 / 236k, 107 / 499k, 80 / 385k (4k to 27k more triangles, mostly the hip roofs at 6 each). The shopfronts are a branch in the building shader for the ground floor only. The city build took about 40 to 90 ms longer in the headless browser (each building's form is worked out once and cached; the roof props reuse it). Main bundle 389 KB gzipped (was 387).

### Desktop with a GPU

Run `npm run dev`, open the page with `?debug` at the end of the address, and read the overlay (FPS, draw calls, triangles, build time): top middle on the menu and while driving, bottom left in the map view (`?view=map`). On laptops with two GPUs, check that the browser runs on the dedicated one (`chrome://gpu`, or Windows Settings > Display > Graphics > browser > High performance).

| Date | Machine | Tier | FPS | Notes |
| --- | --- | --- | --- | --- |
| 2026-11-14 | Development laptop (dedicated mid-range GPU) | High | 23 | Before the performance pass (log depth, pixel ratio up to 2, 4096 shadows every frame, N8AO + 4x MSAA) |
| 2026-11-14 | same | High | 77 to 105 | After the performance pass |
| 2026-11-14 | same | Medium | 101 to 144 | After the first pass (144 Hz screen cap) |
| 2026-11-14 | same | Low | 139 to 144 | After the first pass (144 Hz screen cap) |
| 2026-11-14 | same | High | 144 while moving, idle when still | After the second pass (capped by the 144 Hz screen) |

### Phones

Measured on two Android phones while driving, with the `?debug` overlay (before light traffic was added). Draw calls, triangles and build time are from the High screenshots.

| Date | Phone | Low | Medium | High | Draw calls / triangles (High) | City build (High) |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-16 | A low-mid range Android phone | 60+ FPS | 60+ FPS, dips to the low 50s | 30 to 50 FPS | 126 / 533k | 695 ms |
| 2026-11-16 | A newer mid-range Android phone | Smooth | Smooth | 62 FPS | 91 / 370k | 428 ms |

**Against the budgets:** the low-mid range phone holds Low and Medium well above the 30 FPS Low target. High is a desktop tier and drops to 30 to 50 there; touch screens start on Low. Slower phones than these would likely land under 60 on Medium, which is what Low is for.

## How to measure on an Android phone

1. On the phone, enable Developer options: tap **Build number** seven times (under **Settings > About phone**, the exact path depends on the phone). Then turn on **USB debugging** in **Developer options**.
2. Connect the phone to the PC by USB and allow debugging when the phone asks.
3. On the PC, run `npm run dev` (or `npm run build` then `npm run preview` to measure the production build, which is what players get).
4. On the PC, open `chrome://inspect` in Chrome, click **Port forwarding**, and forward the dev server port (for example `5173` to `localhost:5173`). Then open `localhost:5173/?debug` in Chrome on the phone.
   - Alternative without USB forwarding: `npm run dev -- --host`, then open the `Network:` address it prints on the phone (same Wi-Fi).
5. Back in `chrome://inspect`, the phone's tab appears; click **inspect**.
6. In the DevTools window:
   - **Performance** tab: record 10 s of driving. Look at FPS, long tasks (red corners) and the main-thread flame chart.
   - **Memory** tab: take a heap snapshot after load for JS heap size.
   - The game's own overlay (`?debug`) shows FPS, draw calls, triangles and build time.

## Known costs and planned fixes

| Cost | Fix | Milestone |
| --- | --- | --- |
| Whole map in memory and on the GPU | Tile streaming, dispose far tiles | Tiles, streaming, tiers |
| 300 ms main-thread build | Build tiles in a Web Worker, spread work across frames | Tiles, streaming, tiers |
| 723 KB (gzipped) JSON parsed at once | Binary tiles (typed arrays, quantized), loaded on demand | Tiles, streaming, tiers |
| About 265k to 296k triangles drawn on Low | Distance-based detail: far scenery as boxes or hidden, simplified outlines (Ramer-Douglas-Peucker) | Tiles, streaming, tiers |
| Logarithmic depth buffer (costly on mobile GPUs) | Off on Low/Medium, tighter near/far planes instead | Tiles, streaming, tiers |
| drei pulled in for one component | Import `MapControls` directly from three.js examples | Any time |
| Garbage collection pauses while driving | Pre-allocate and reuse per-frame objects | Drivable car |
| Shadow pass re-draws all playable buildings (one merged mesh, no culling) | Per-tile meshes so only tiles near the shadowed square cast | Tiles, streaming, tiers |
| Road shader cost on phones (`fwidth`, a few branches per road pixel) | Simpler marking path on Low (no antialiasing, no dashes in the distance) | Tiles, streaming, tiers |
| Sky shader with procedural clouds runs on every sky pixel (fbm noise) | Lower cloud detail or a static sky on Low | Tiles, streaming, tiers |
| Rooftop details (38k triangles) | Hide on Low, or only near the camera | Tiles, streaming, tiers |
| Trees (35k triangles on Low, 63k and up to 4 instanced meshes per cell on Medium and High) | Billboards for far trees rendered from the tree models, smaller cells | Tiles, streaming, tiers |
| Filler city past the map (33k to 82k triangles) | Merge far blocks into a few big ones, or a skyline card per direction | Tiles, streaming, tiers |
| Window shader on every wall pixel | Plain walls or the average color on Low | Tiles, streaming, tiers |

## Techniques still to use

What keeps a three.js driving scene smooth on low-mid range phones, beyond what's done above: full detail only near the road, lower detail far away; heavy work spread across frames; geometry recycled instead of reallocated; per-frame memory pre-allocated to avoid garbage collection pauses; simple custom physics; adjustable view distance; FPS telemetry to suggest settings.
