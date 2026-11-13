/**
 * Map QA: scans the processed map for known kinds of visual problems and prints
 * how many there are, with a camera link for the worst few of each kind.
 *
 *   npm run qa            (reads public/data/bgc.json)
 *   npm run qa -- --json  (machine-readable, used to compare before/after)
 */
import { readFileSync } from 'node:fs';
import { distanceToSegment, pointInRing, ringBounds, vertexCentroid } from '../src/geometry/polygon';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import type { Building, MapData, Point, Road } from '../src/map/types';

export interface Issue {
  kind: string;
  at: Point;
  detail: string;
  severity: number;
}

const zAt = (r: Road, i: number) => r.z?.[i] ?? 0;
const isRaised = (r: Road) => !!r.z && r.z.some((v) => v > 1);
const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const solid = (b: Building) => (b.minH ?? 0) < 2.5; // canopies and skybridges don't count

function buildingIndex(buildings: Building[]) {
  const grid = new SegmentGrid<number>(30);
  buildings.forEach((b, i) => {
    const bb = ringBounds(b.rings[0]);
    grid.insert([bb.minX, bb.minY], [bb.maxX, bb.maxY], i);
  });
  return (p: Point, pad = 0) =>
    grid
      .query(p, p, pad)
      .map((e) => e.item)
      .filter((i, k, arr) => arr.indexOf(i) === k);
}

export function runQa(map: MapData): Issue[] {
  const issues: Issue[] = [];
  const near = buildingIndex(map.buildings);
  const inside = (p: Point) =>
    near(p).find((i) => solid(map.buildings[i]) && pointInRing(p, map.buildings[i].rings[0]));

  // Node use counts, to find dead ends.
  const uses = new Map<string, number>();
  for (const r of map.roads) for (const p of r.points) uses.set(`${p[0]},${p[1]}`, (uses.get(`${p[0]},${p[1]}`) ?? 0) + 1);

  for (const r of map.roads) {
    // 1. Raised walkways/roads running inside or over a building (skywalks on mall roofs).
    if (isRaised(r)) {
      let len = 0;
      for (let i = 0; i < r.points.length - 1; i++) {
        if (Math.min(zAt(r, i), zAt(r, i + 1)) < 1) continue;
        const m = mid(r.points[i], r.points[i + 1]);
        if (inside(m) !== undefined) len += Math.hypot(r.points[i + 1][0] - r.points[i][0], r.points[i + 1][1] - r.points[i][1]);
      }
      if (len > 2) issues.push({ kind: 'raised-inside-building', at: r.points[0], detail: `${r.id} ${r.highway} ${len.toFixed(0)} m`, severity: len });
    }

    // 2. Raised ends hanging in the air (no stairs or ramp mapped, or cut off).
    if (isRaised(r)) {
      for (const i of [0, r.points.length - 1]) {
        const p = r.points[i];
        const atWall = near(p, 3).some((bi) => {
          const ring = map.buildings[bi].rings[0];
          return ring.some((q, k) => distanceToSegment(p, ring[(k + ring.length - 1) % ring.length], q) <= 2.5);
        });
        if (zAt(r, i) > 2 && (uses.get(`${p[0]},${p[1]}`) ?? 0) === 1 && !atWall) {
          issues.push({ kind: 'floating-end', at: p, detail: `${r.id} ${r.highway} z=${zAt(r, i)}`, severity: zAt(r, i) });
        }
      }
    }

    // 3. Very short raised fragments with a loose end (look like floating blocks).
    if (isRaised(r) && r.points.length >= 2) {
      let len = 0;
      for (let i = 0; i < r.points.length - 1; i++) len += Math.hypot(r.points[i + 1][0] - r.points[i][0], r.points[i + 1][1] - r.points[i][1]);
      const loose = [r.points[0], r.points[r.points.length - 1]].some((p) => (uses.get(`${p[0]},${p[1]}`) ?? 0) === 1);
      if (len < 6 && loose) issues.push({ kind: 'raised-fragment', at: r.points[0], detail: `${r.id} ${r.highway} ${len.toFixed(1)} m`, severity: 6 - len });
    }
  }

  // 4. Buildings poking up through a flyover deck.
  const decks = new SegmentGrid<{ r: Road; i: number }>(30);
  for (const r of map.roads) {
    if (!isRaised(r) || r.cls === 'path') continue;
    for (let i = 0; i < r.points.length - 1; i++) decks.insert(r.points[i], r.points[i + 1], { r, i });
  }
  // 5. Buildings standing on road surfaces.
  const ground = new SegmentGrid<Road>(30);
  for (const r of map.roads) {
    if (r.cls === 'path') continue;
    for (let i = 0; i < r.points.length - 1; i++) {
      if (Math.max(zAt(r, i), zAt(r, i + 1)) > 1) continue;
      ground.insert(r.points[i], r.points[i + 1], r);
    }
  }

  for (const b of map.buildings) {
    if (!solid(b)) continue;
    let deckHit = 0;
    let roadHit = 0;
    let roadCls = '';
    for (const p of b.rings[0]) {
      for (const e of decks.query(p, p, 20)) {
        const { r, i } = e.item;
        const d = distanceToSegment(p, e.a, e.b);
        const deckBottom = Math.min(zAt(r, i), zAt(r, i + 1)) - 1.2;
        if (d < r.w / 2 && b.h > deckBottom) deckHit = Math.max(deckHit, r.w / 2 - d);
      }
      for (const e of ground.query(p, p, 20)) {
        const pen = e.item.w / 2 - distanceToSegment(p, e.a, e.b);
        if (pen > roadHit) {
          roadHit = pen;
          roadCls = e.item.cls;
        }
      }
    }
    const c = vertexCentroid(b.rings[0]);
    if (deckHit > 0.5) issues.push({ kind: 'building-through-deck', at: c, detail: `${b.id} h=${b.h}`, severity: deckHit });
    if (roadHit > 1) {
      const where = b.scenery ? 'scenery' : 'playable';
      issues.push({ kind: `building-on-${roadCls}-road (${where})`, at: c, detail: `${b.id} ${roadHit.toFixed(1)} m in`, severity: roadHit });
    }
  }

  return issues;
}

/** three.js camera link looking at a map point from the south-east. */
export const camLink = ([x, y]: Point, dist = 120) =>
  `?cam=${(x + dist * 0.6).toFixed(0)},${(dist * 0.5).toFixed(0)},${(-y + dist * 0.8).toFixed(0)},${x.toFixed(0)},0,${(-y).toFixed(0)}`;

if (process.argv[1]?.endsWith('qa.ts')) {
  const file = process.argv.find((a) => a.endsWith('.json')) ?? 'public/data/bgc.json';
  const map = JSON.parse(readFileSync(file, 'utf8')) as MapData;
  const issues = runQa(map);
  const byKind = new Map<string, Issue[]>();
  for (const i of issues) byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i]);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(Object.fromEntries([...byKind].map(([k, v]) => [k, v.length]))));
  } else {
    console.log(`Map QA for ${file}`);
    for (const [kind, list] of [...byKind].sort()) {
      console.log(`\n${kind}: ${list.length}`);
      for (const i of list.sort((a, b) => b.severity - a.severity).slice(0, 4)) {
        console.log(`  ${i.detail.padEnd(40)} ${camLink(i.at)}`);
      }
    }
    if (issues.length === 0) console.log('No issues found.');
  }
}
