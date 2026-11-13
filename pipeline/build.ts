/**
 * CLI: npm run pipeline [-- <input.geojson> <output.json>]
 * Defaults: data/raw/bgc.geojson -> public/data/bgc.json
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { FeatureCollection } from 'geojson';
import { extractMap } from './extract';

const [input = 'data/raw/bgc.geojson', output = 'public/data/bgc.json'] = process.argv.slice(2);
const inPath = resolve(input);
const outPath = resolve(output);

let fc: FeatureCollection;
try {
  fc = JSON.parse(readFileSync(inPath, 'utf8'));
} catch (err) {
  console.error(`Could not read ${input}: ${(err as Error).message}`);
  console.error('Export BGC from overpass-turbo first (see README.md).');
  process.exit(1);
}

const t0 = performance.now();
const map = extractMap(fc);
const ms = performance.now() - t0;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(map));

const kb = (p: string) => (statSync(p).size / 1024).toFixed(0);
const { bounds: b, stats } = map;
console.log(`${input} (${kb(inPath)} KB) -> ${output} (${kb(outPath)} KB) in ${ms.toFixed(0)} ms`);
console.log(`  roads ${stats.roads}, buildings ${stats.buildings}, areas ${stats.areas} from ${stats.features} features`);
console.log(`  extent ${(b.maxX - b.minX).toFixed(0)} m x ${(b.maxY - b.minY).toFixed(0)} m`);
const skipped = Object.entries(stats.skipped).sort((a, b) => b[1] - a[1]);
if (skipped.length) console.log(`  skipped: ${skipped.map(([k, v]) => `${k} ${v}`).join(', ')}`);
