# 0004: Commit raw and processed map data to the repo

**Status:** Accepted

**Context.** Vercel builds from the repo, and anyone cloning it should be able to run the game. The raw export is 19 MB, the processed map 2.6 MB. Overpass is not reachable from every environment (including some CI and sandboxes).

**Decision.** Commit both `data/raw/bgc.geojson` and `public/data/bgc.json`.

**Consequences.**
- `npm install && npm run dev` works with no download, and deploys include the real map.
- CI can re-run the pipeline from the committed raw data and check the output is in sync.
- Each data refresh adds a few MB to git history. Acceptable at this size; if exports get much bigger (more areas), move raw data to Git LFS or a release asset.
