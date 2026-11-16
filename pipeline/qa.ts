/**
 * Map QA: scans the processed map for known kinds of visual problems and prints
 * how many there are, with a camera link for the worst few of each kind.
 *
 *   npm run qa                                      report for public/data/bgc.json
 *   npm run qa -- other.json                        report for another map file
 *   npm run qa -- --json                            counts per kind, as JSON
 *   npm run qa -- --check data/qa-baseline.json     exit 1 if any count is above the baseline (CI)
 */
import { ARMS, DRESSING, drawnCorners, dressingCorners } from '../src/geometry/dressing';
import { fixturesInLanes } from './fixtureLanes';
import { readFileSync } from 'node:fs';
import { distanceToRing, distanceToSegment, pointInRing, ringBounds, vertexCentroid } from '../src/geometry/polygon';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import type { Building, Dressing, MapData, Point, Road } from '../src/map/types';
import { buildRoadGraph } from '../src/routing/graph';
import { headsAlongRoad, LIGHTS } from './lights';
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
  issues.push(...lightIssues(map, ground));
  issues.push(...graphIssues(map));
  return issues;
}

/**
 * 7. Street and traffic lights where they don't belong: a traffic light whose heads don't
 * face along a road beside it (or the road they look back at across a junction) or whose
 * mast arm doesn't reach over it (`signal-misaligned`), a traffic light on the near side,
 * standing before the junction or mid-block crossing it controls instead of past it
 * (`signal-near-side`),
 * two traffic lights on one corner (`signal-cluster`), a pole beside a zebra crossing's band
 * (`pole-by-crossing`), a pole or its arm reaching into a flyover deck or a raised
 * building above it (`pole-under-structure`), and solid furniture drawn into other solid
 * furniture, a pole through a shed's roof say (`dressing-overlap`).
 */
function lightIssues(map: MapData, ground: SegmentGrid<Road>): Issue[] {
  const issues: Issue[] = [];
  const pieces = (map.dressing ?? []).filter((d) => DRESSING[d.k].solid);
  const isPole = (d: Dressing) => d.k === 'streetlight' || d.k === 'signal' || d.k === 'signalpole';
  for (const d of pieces) {
    if (d.k !== 'signal' && d.k !== 'signalpole') continue;
    const facing = headsAlongRoad(d.p, d.rot, ground);
    if (facing < 0) {
      issues.push({ kind: 'signal-misaligned', at: d.p, detail: `${d.k} with no road beside it`, severity: 1 });
      continue;
    }
    if (facing < Math.cos((LIGHTS.facing * Math.PI) / 180)) {
      issues.push({ kind: 'signal-misaligned', at: d.p, detail: `${d.k} heads ${((Math.acos(Math.min(1, facing)) * 180) / Math.PI).toFixed(0)} degrees off the road`, severity: 1 - facing });
      continue;
    }
    const heads: Point = [-Math.sin(d.rot), Math.cos(d.rot)];
    // Far side: a junction (or a mid-block zebra crossing) to control in front of its heads. On the near side it has a
    // junction or crossing right behind it instead, the one its traffic is about to enter.
    const inFront = (c: Point) => (c[0] - d.p[0]) * heads[0] + (c[1] - d.p[1]) * heads[1] > 0;
    const controls = [
      ...map.junctions.filter((j) => !j.patch && j.z <= 1 && (pointInRing(d.p, j.ring) || distanceToRing(d.p, j.ring) < 30)).map((j) => vertexCentroid(j.ring)),
      ...map.crossings.filter((c) => c.z <= 1 && Math.hypot(c.c[0] - d.p[0], c.c[1] - d.p[1]) < 15).map((c) => c.c),
    ];
    if (controls.length && !controls.some(inFront)) {
      issues.push({ kind: 'signal-near-side', at: d.p, detail: `${d.k} before the junction or crossing it controls, not past it`, severity: 1 });
    }
    if (d.k === 'signal') {
      const reach = ARMS.signal - 0.45;
      const head: Point = [d.p[0] + Math.cos(d.rot) * reach, d.p[1] + Math.sin(d.rot) * reach];
      if (!ground.query(head, head, 15).some((e) => distanceToSegment(head, e.a, e.b) < e.item.w / 2)) issues.push({ kind: 'signal-misaligned', at: d.p, detail: 'mast arm not over the road', severity: 1 });
    }
  }
  const signals = pieces.filter((d) => d.k === 'signal' || d.k === 'signalpole');
  for (let i = 0; i < signals.length; i++)
    for (let j = i + 1; j < signals.length; j++)
      if (Math.hypot(signals[i].p[0] - signals[j].p[0], signals[i].p[1] - signals[j].p[1]) < 4) issues.push({ kind: 'signal-cluster', at: signals[i].p, detail: 'two traffic lights within 4 m', severity: 1 });
  for (const d of pieces) {
    if (!isPole(d)) continue;
    for (const c of map.crossings) {
      if (c.z > 1) continue;
      const [dx, dy] = [d.p[0] - c.c[0], d.p[1] - c.c[1]];
      const along = Math.abs(dx * c.dir[0] + dy * c.dir[1]);
      const across = Math.abs(-dx * c.dir[1] + dy * c.dir[0]);
      if (along < c.w / 2 + 0.5 && across < c.half + 3) {
        issues.push({ kind: 'pole-by-crossing', at: d.p, detail: `${d.k} ${along.toFixed(1)} m from a zebra's middle`, severity: 1 });
        break;
      }
    }
  }
  // Poles (or their arms) reaching into a flyover deck or a raised building above them.
  for (const d of pieces) {
    if (!isPole(d)) continue;
    const h = DRESSING[d.k].size[2];
    const arm = ARMS[d.k as keyof typeof ARMS] ?? 0;
    const pts: Point[] = [d.p, [d.p[0] + Math.cos(d.rot) * arm, d.p[1] + Math.sin(d.rot) * arm]];
    const deck = map.roads.some((r) => r.z && r.points.some((_, i) => i + 1 < r.points.length && Math.min(r.z![i], r.z![i + 1]) > 1.5 && Math.min(r.z![i], r.z![i + 1]) - 1.2 < h && pts.some((q) => distanceToSegment(q, r.points[i], r.points[i + 1]) < r.w / 2)));
    const above = !deck && map.buildings.some((b) => (b.minH ?? 0) > 2.5 && (b.minH ?? 0) < h && pts.some((q) => pointInRing(q, b.rings[0])));
    if (deck || above) issues.push({ kind: 'pole-under-structure', at: d.p, detail: `${d.k} into ${deck ? 'a flyover deck' : 'a raised building'}`, severity: 1 });
  }
  const grid = new SegmentGrid<{ d: Dressing; foot: Point[] }>(30);
  for (const d of pieces) {
    const foot = drawnCorners(d.k, d.p, d.rot);
    const b = ringBounds(foot);
    for (const e of grid.query([b.minX, b.minY], [b.maxX, b.maxY])) {
      if (overlapsConvex(foot, e.item.foot)) issues.push({ kind: 'dressing-overlap', at: d.p, detail: `${d.k} drawn into ${e.item.d.k}`, severity: 1 });
    }
    grid.insert([b.minX, b.minY], [b.maxX, b.maxY], { d, foot });
  }
  return issues;
}

/**
 * 8. Drivable roads in a piece of the road network that doesn't join the rest (`road-island`):
 * a car there can't drive anywhere else and no route can reach it, usually a crossing the
 * map draws without a shared node. Pieces cut off by the playable edge are expected and
 * left out (any road ending within 40 m of it).
 */
function graphIssues(map: MapData): Issue[] {
  const g = buildRoadGraph(map);
  const parent = g.nodes.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const e of g.edges) parent[find(e.from)] = find(e.to);
  const size = new Map<number, number>();
  for (let i = 0; i < g.nodes.length; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
  let biggest = -1;
  for (const [root, n] of size) if (biggest < 0 || n > size.get(biggest)!) biggest = root;
  const ring = map.playable ?? [];
  const nearEdge = (p: Point) => ring.length >= 3 && distanceToRing(p, ring) < 40;
  const issues: Issue[] = [];
  const seen = new Set<number>();
  for (const e of g.edges) {
    if (seen.has(e.road) || find(e.from) === biggest) continue;
    seen.add(e.road);
    const r = map.roads[e.road];
    if (nearEdge(r.points[0]) || nearEdge(r.points[r.points.length - 1])) continue;
    issues.push({ kind: 'road-island', at: r.points[Math.floor(r.points.length / 2)], detail: `${r.id} (${r.highway}) joins no other road`, severity: e.length });
  }
  return issues;
}

/** Do two convex polygons overlap (separating axis test)? Touching doesn't count. */
function overlapsConvex(a: Point[], b: Point[]): boolean {
  for (const ring of [a, b])
    for (let i = 0; i < ring.length; i++) {
      const [p, q] = [ring[i], ring[(i + 1) % ring.length]];
      const n: Point = [q[1] - p[1], p[0] - q[0]];
      const span = (r: Point[]) => r.map((v) => v[0] * n[0] + v[1] * n[1]);
      const [sa, sb] = [span(a), span(b)];
      if (Math.max(...sa) <= Math.min(...sb) + 1e-6 || Math.max(...sb) <= Math.min(...sa) + 1e-6) return false;
    }
  return true;
}

/**
 * 6. Trees standing on a road or inside a building, walls, fences or hedges across a road or
 * path (guard rails and jersey barriers line roads on purpose, so they're left out), bollards
 * and blocks in the lanes of a road they don't close, and solid street furniture in a road,
 * on a path or in a building.
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
  // Bollards and concrete blocks in the lanes of a road they don't close (pipeline/fixtureLanes.ts).
  for (const { fixture, road } of fixturesInLanes(map.roads, map.fixtures ?? [])) issues.push({ kind: 'fixture-in-lanes', at: fixture.p, detail: `${fixture.kind} in the lanes of ${road.id}`, severity: 1 });
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
