# Drive Thru MNL: No Traffic Edition

A low-poly, browser-based driving game set in Bonifacio Global City (BGC), Taguig, built from real OpenStreetMap data.

**The idea:** a pipeline that turns real map data into a drivable 3D city that streams into the browser.

> Work in progress. Day 1 of 6: data pipeline, projection and a 2D map.

## Stack

- Three.js via React Three Fiber, TypeScript, Vite
- Rapier physics (coming on Day 3)
- Node + TypeScript data pipeline (`pipeline/`)
- Vitest

## Getting started

```bash
npm install
npm run pipeline:sample   # builds the tiny test map so the app has something to show
npm run dev
```

### Using the real BGC map

1. Open [overpass-turbo.eu](https://overpass-turbo.eu), paste the query from [`data/bgc.overpassql`](data/bgc.overpassql) and click **Run**.
2. **Export > GeoJSON > download**, save it as `data/raw/bgc.geojson`.
3. `npm run pipeline` writes `public/data/bgc.json`. The app picks it up automatically.

## How the pipeline works (so far)

```
overpass-turbo export (GeoJSON, lat/long)
        │
        ▼
pipeline/extract.ts
  • read tags (handles both overpass-turbo formats)
  • classify: building / road (major, minor, service, path) / park / water / land use
  • project lat/long -> local meters around a BGC origin
  • clean up: drop duplicate points, closing points, degenerate shapes
  • count everything it skips, with a reason
        │
        ▼
public/data/bgc.json  ->  React Three Fiber top-down map
```

### Projection

Equirectangular around a fixed origin (14.5509 N, 121.0503 E):

```
x = R · Δlon · cos(lat0)      (meters east)
y = R · Δlat                  (meters north)
```

At city scale this is accurate to well under a meter. The tests check it against great-circle (haversine) distance for 2,000 random point pairs across BGC: worst error under 0.05%, and under 1 m absolute.

### Rendering

Each layer (major roads, minor roads, buildings, parks, ...) is packed into a single `LineSegments` geometry. That makes about 9 draw calls total, no matter how many roads BGC has.

## Tests

```bash
npm test
```

- Projection: origin, axis directions, known distances (0.01° lat ≈ 1111.95 m), round-trips both ways, accuracy vs haversine, rejects bad origins
- Extraction: road classes, both tag formats, multipolygons with holes, height/levels parsing, junk input skipped with reasons, bounds
- Segment packing: segment counts, ring closing, axis mapping

## Data and license

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License (ODbL).

Many BGC buildings have no `height` or `building:levels` tag. From Day 2, those heights are estimated from building type (documented here when implemented).
