/**
 * CLI: npm run pipeline [-- <input.geojson> <output.json>] [--playable <file> | --no-playable] [--margin <m>]
 * Defaults: data/raw/bgc.geojson -> public/data/bgc.json, playable area from data/playable-area.geojson
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { FeatureCollection, Polygon } from 'geojson';
import { createProjection } from '../src/geo/projection';
import type { MapData, Point, Ring } from '../src/map/types';
import { clipToPlayable } from './clip';
import { elevateRoads } from './elevation';
import { fitRoadWidths } from './fitWidths';
import { extractMap } from './extract';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const noPlayable = args.includes('--no-playable');
if (noPlayable) args.splice(args.indexOf('--no-playable'), 1);
const playableArg = flag('--playable');
const margin = Number(flag('--margin') ?? 300);
const [input = 'data/raw/bgc.geojson', output = 'public/data/bgc.json'] = args;

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const readJson = <T>(path: string): T => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (err) {
    return fail(`Could not read ${path}: ${(err as Error).message}`);
  }
};

/** Finds the playable polygon: explicit flag, then data/, then data/raw/ (older location). */
function findPlayable(): string | undefined {
  if (noPlayable) return undefined;
  if (playableArg) return playableArg;
  return ['data/playable-area.geojson', 'data/raw/playable-area.geojson'].find((p) => existsSync(p));
}

/** First Polygon in a geojson.io export, as a lat/lon ring. */
function playableRing(path: string): [number, number][] {
  const fc = readJson<FeatureCollection>(path);
  const poly = fc.features?.find((f) => f.geometry?.type === 'Polygon')?.geometry as Polygon | undefined;
  if (!poly) return fail(`${path} has no Polygon. Draw one at geojson.io and export it as GeoJSON.`);
  return poly.coordinates[0] as [number, number][];
}

if (!Number.isFinite(margin) || margin < 0) fail('--margin must be a number of meters >= 0');

const inPath = resolve(input);
const outPath = resolve(output);
const fc = readJson<FeatureCollection>(inPath);

const t0 = performance.now();
let map: MapData = extractMap(fc);

const playablePath = findPlayable();
if (playablePath) {
  const proj = createProjection(map.origin);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const ring: Ring = playableRing(playablePath).map(([lon, lat]): Point => {
    const { x, y } = proj.toLocal({ lat, lon });
    return [round2(x), round2(y)];
  });
  // geojson.io repeats the first point at the end; our rings don't.
  const [first, last] = [ring[0], ring[ring.length - 1]];
  if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring.pop();
  map = clipToPlayable(map, ring, margin);
}
const elevation = elevateRoads(map.roads);
const fitted = fitRoadWidths(elevation.roads, map.buildings);
map = { ...map, roads: fitted.roads };
const ms = performance.now() - t0;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(map));

const kb = (p: string) => (statSync(p).size / 1024).toFixed(0);
const { bounds: b, stats } = map;
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) : '0');
const hTagged = map.buildings.filter((x) => x.hSrc !== 'estimate').length;

console.log(`${input} (${kb(inPath)} KB) -> ${output} (${kb(outPath)} KB) in ${ms.toFixed(0)} ms`);
console.log(`  roads ${stats.roads}, buildings ${stats.buildings}, areas ${stats.areas} from ${stats.features} features`);
console.log(`  extent ${(b.maxX - b.minX).toFixed(0)} m x ${(b.maxY - b.minY).toFixed(0)} m`);
console.log(`  heights: ${hTagged} from tags (${pct(hTagged, map.buildings.length)}%), the rest estimated`);
if (stats.clip) {
  const c = stats.clip;
  console.log(`  playable area: ${playablePath}, scenery ring ${c.marginMeters} m`);
  console.log(`    buildings: ${c.playableBuildings} playable, ${c.sceneryBuildings} scenery, ${c.droppedBuildings} dropped`);
  console.log(`    dropped: ${c.droppedRoads} roads, ${c.droppedAreas} areas`);
} else {
  console.log('  no playable area (using everything)');
}
const e = elevation.stats;
console.log(
  `  elevation: ${e.raisedRoads} raised road pieces, ${e.rampsOnGround} ramps on approach roads, ` +
    `${e.rampsOnBridge} on the bridge itself, ${e.bridgesLeftAtGround} small bridges left at ground`,
);
console.log(`  road widths: ${fitted.stats.narrowed} of ${fitted.stats.checked} minor/service roads narrowed to fit between buildings`);
const skipped = Object.entries(stats.skipped).sort((a, b) => b[1] - a[1]);
if (skipped.length) console.log(`  skipped: ${skipped.map(([k, v]) => `${k} ${v}`).join(', ')}`);
