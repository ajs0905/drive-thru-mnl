# 0001: Process OSM data offline, ship static files

**Status:** Accepted

**Context.** The game needs roads, buildings and land use for a real area. Options: query OpenStreetMap (Overpass) live from the browser, use a vector tile service, or process an export ahead of time. Live queries are slow, rate-limited, and the raw data needs heavy cleanup (indoor walkways, bridges without heights, buildings without heights). Hosting is static (Vercel), so there's no server to do that work on demand.

**Decision.** Export once with overpass-turbo, process it with a Node pipeline (`npm run pipeline`), and ship the result as a static file the game downloads.

**Consequences.**
- The browser does almost no data work, and loads are predictable.
- Expensive, careful steps (clipping, elevation, width fitting) can take as long as they need, and are unit tested.
- Output is deterministic, so CI can check that committed data matches the code.
- Map updates need a manual re-export. Acceptable: the map doesn't need to be live.
- Bigger areas will need tiles (planned) instead of one file.
