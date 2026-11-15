/**
 * Map QA: scans the processed map for known kinds of visual problems and prints
 * how many there are, with a camera link for the worst few of each kind.
 *
 *   npm run qa                                      report for public/data/bgc.json
 *   npm run qa -- other.json                        report for another map file
 *   npm run qa -- --json                            counts per kind, as JSON
 *   npm run qa -- --check data/qa-baseline.json     exit 1 if any count is above the baseline (CI)
 */
import { DRESSING, dressingCorners } from '../src/geometry/dressing';
import { readFileSync } from 'node:fs';
import { distanceToSegment, pointInRing, ringBounds, vertexCentroid } from '../src/geometry/polygon';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import type { Building, MapData, Point, Road } from '../src/map/types';
import { roadIssues } from './qaRoads';
import { nestedBuildings } from './overlaps';
import { structureIssues } from './qaStructures';

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

  // 5b. Buildings inside other buildings that should have gone (hidden, or a construction outline around a finished one).
  for (const n of nestedBuildings(map.buildings)) {
    if (!n.drop) continue;
    const [a, b] = [map.buildings[n.inner], map.buildings[n.outer]];
    issues.push({ kind: 'building-in-building', at: vertexCentroid(a.rings[0]), detail: `${a.id} in ${b.id} (${n.drop.reason})`, severity: a.h });
  }

  issues.push(...roadIssues(map));
  issues.push(...extrasIssues(map, ground, inside));
  issues.push(...structureIssues(map));
  return issues;
}

/**
 * 6. Trees standing on a road or inside a building, walls, fences or hedges across a road or
 * path (guard rails and jersey barriers line roads on purpose, so they're left out), and
 * solid street furniture in a road, on a path or in a building.
 */
function extrasIssues(map: MapData, ground: SegmentGrid<Road>, inside: (p: Point) => number | undefined): Issue[] {
  const issues: Issue[] = [];
  const paths = new SegmentGrid<Road>(30);
  for (const r of map.roads) {
    if (r.cls !== 'path') continue;
    for (let i = 0; i < r.points.length - 1; i++) if (Math.max(zAt(r, i), zAt(r, i + 1)) <= 1) paths.insert(r.points[i], r.points[i + 1], r);
  }
  const depth = (p: Point, grid: SegmentGrid<Road>) =>
    Math.max(0, ...grid.query(p, p, 20).map((e) => e.item.w / 2 - distanceToSegment(p, e.a, e.b)));
  for (const t of map.trees ?? []) {
    const d = depth(t.p, ground);
    if (d > 0) issues.push({ kind: 'tree-on-road', at: t.p, detail: `${d.toFixed(1)} m in`, severity: d });
    else if (inside(t.p) !== undefined) issues.push({ kind: 'tree-in-building', at: t.p, detail: `tree at ${t.p.join(', ')}`, severity: 1 });
  }
  for (const b of map.barriers ?? []) {
    // Rails run along roads, and a lot's gate (pipeline/lots.ts) closes one on purpose.
    if (b.kind === 'rail' || b.id.endsWith('/gate')) continue;
    let worst = 0;
    let at: Point = b.points[0];
    for (let i = 0; i < b.points.length - 1; i++) {
      const [a, c] = [b.points[i], b.points[i + 1]];
      const steps = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1])));
      for (let k = 0; k <= steps; k++) {
        const p: Point = [a[0] + ((c[0] - a[0]) * k) / steps, a[1] + ((c[1] - a[1]) * k) / steps];
        const d = Math.max(depth(p, ground), depth(p, paths));
        if (d > worst) [worst, at] = [d, p];
      }
    }
    if (worst > 0) issues.push({ kind: 'barrier-on-road', at, detail: `${b.id} ${b.kind} ${worst.toFixed(1)} m in`, severity: worst });
  }
  // Solid street and park furniture (pipeline/lots.ts, pipeline/sidewalks.ts) in a road, on a footpath or in a building.
  for (const d of map.dressing ?? []) {
    if (!DRESSING[d.k].solid) continue;
    const foot = dressingCorners(d.k, d.p, d.rot);
    const worst = Math.max(...[...foot, d.p].map((p) => Math.max(depth(p, ground), depth(p, paths))));
    if (worst > 0.05) issues.push({ kind: 'dressing-in-the-way', at: d.p, detail: `${d.k} ${worst.toFixed(1)} m into a road or path`, severity: worst });
    else if (inside(d.p) !== undefined) issues.push({ kind: 'dressing-in-the-way', at: d.p, detail: `${d.k} in a building`, severity: 1 });
  }
  return issues;
}

/** three.js camera link looking at a map point from the south-east. */
export const camLink = ([x, y]: Point, dist = 120) =>
  `?cam=${(x + dist * 0.6).toFixed(0)},${(dist * 0.5).toFixed(0)},${(-y + dist * 0.8).toFixed(0)},${x.toFixed(0)},0,${(-y).toFixed(0)}`;

export type Counts = Record<string, number>;

export function countByKind(issues: Issue[]): Counts {
  const counts: Counts = {};
  for (const i of issues) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

/** Kinds whose count went above the baseline. A kind missing from the baseline counts as 0 allowed. */
export function regressions(counts: Counts, baseline: Counts): { kind: string; count: number; allowed: number }[] {
  return Object.entries(counts)
    .filter(([kind, count]) => count > (baseline[kind] ?? 0))
    .map(([kind, count]) => ({ kind, count, allowed: baseline[kind] ?? 0 }));
}

if (process.argv[1]?.endsWith('qa.ts')) {
  const args = process.argv.slice(2);
  const checkAt = args.indexOf('--check');
  const baselinePath = checkAt >= 0 ? args[checkAt + 1] : undefined;
  const file = args.find((a, i) => a.endsWith('.json') && (checkAt < 0 || i !== checkAt + 1) && !a.startsWith('--')) ?? 'public/data/bgc.json';
  const map = JSON.parse(readFileSync(file, 'utf8')) as MapData;
  const issues = runQa(map);
  const counts = countByKind(issues);

  if (baselinePath) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Counts;
    const bad = regressions(counts, baseline);
    for (const [kind, count] of Object.entries(counts)) {
      const allowed = baseline[kind] ?? 0;
      const mark = count > allowed ? 'FAIL' : count < allowed ? 'better' : 'ok';
      console.log(`${mark.padEnd(6)} ${kind.padEnd(42)} ${String(count).padStart(4)} (baseline ${allowed})`);
    }
    if (bad.length) {
      console.error(`\nMap QA got worse in ${bad.length} check(s). Run \`npm run qa\` to see where.`);
      process.exit(1);
    }
    console.log('\nMap QA: no regressions.');
  } else if (args.includes('--json')) {
    console.log(JSON.stringify(counts, null, 2));
  } else {
    const byKind = new Map<string, Issue[]>();
    for (const i of issues) byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i]);
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
