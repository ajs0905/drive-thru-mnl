/**
 * Walls, fences, trees and street fixtures from the second export (data/barriers.overpassql).
 *
 *   extractExtras  GeoJSON -> barriers, trees and fixture points in map space
 *   placeExtras    fits them to the processed map: clips them to the playable area, cuts
 *                  barriers open where roads and paths pass through, drops trees standing
 *                  on roads, in buildings or in water, and turns gates and booms across
 *                  the road they sit on
 *
 * Kept as a separate export and step so the main map (and its QA baseline) doesn't change
 * when these are added or refreshed.
 */
import type { FeatureCollection } from 'geojson';
import { createProjection, type LatLon } from '../src/geo/projection';
import { clipPolylineToRect, distanceToSegment, pointInRing, ringBounds, type Rect } from '../src/geometry/polygon';
import { trimPolyline as slicePolyline } from '../src/geometry/road';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import { seeded } from '../src/map/hash';
import type { Barrier, BarrierKind, Fixture, FixtureKind, MapData, Point, Road, Tree, TreeShape } from '../src/map/types';
import { segmentNear, trimPolyline as runsNear, zoneOf } from './clip';
import { getId, getTags, linesOf, parseHeight, polygonsOf, projectPositions, str, type Tags } from './extract';

const BARRIER_KINDS: Record<string, BarrierKind> = {
  wall: 'wall', city_wall: 'wall', retaining_wall: 'wall',
  fence: 'fence', railing: 'fence',
  hedge: 'hedge',
  guard_rail: 'rail', jersey_barrier: 'rail',
};

/** Typical heights when the way has no `height` tag. */
export const BARRIER_HEIGHT: Record<BarrierKind, number> = { wall: 2.4, fence: 1.8, hedge: 1.3, rail: 0.8 };
const RETAINING_WALL_HEIGHT = 1.2;

const FIXTURE_KINDS: Record<string, FixtureKind> = {
  gate: 'gate', swing_gate: 'gate', sliding_gate: 'gate',
  lift_gate: 'boom',
  bollard: 'bollard',
  block: 'block', jersey_barrier: 'block', barricade: 'block',
};

const PALMS = /palm|roystonea|cocos|saribus|livistona|areca|veitchia|phoenix|dypsis|washingtonia|wodyetia/i;
/** Share of untagged trees drawn as palms (royal palms line many BGC avenues). */
export const PALM_SHARE = 0.25;
/** Spacing of trees along a mapped tree row. */
export const TREE_ROW_SPACING = 8;
/** Width of the opening cut into a wall at a gate that has no road mapped through it. */
export const WALL_GATE_WIDTH = 4;

export interface RawExtras {
  barriers: Barrier[];
  trees: Tree[];
  fixtures: { kind: FixtureKind; p: Point }[];
  skipped: Record<string, number>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const roundPoint = ([x, y]: Point): Point => [round2(x), round2(y)];

/** Palm or broadleaf, from tags; untagged trees get a seeded pick. */
export function treeShape(t: Tags, unit: number): TreeShape {
  const species = [t.species, t['species:en'], t['species:wikipedia'], t.genus, t.taxon].map(str).filter(Boolean).join(' ');
  if (t.leaf_cycle === 'palm' || PALMS.test(species)) return 'palm';
  if (species || t.leaf_type === 'broadleaved' || t.leaf_type === 'needleleaved') return 'broad';
  return unit < PALM_SHARE ? 'palm' : 'broad';
}

/** Size factor: from a height tag (8 m broadleaf, 9 m palm = 1), else seeded between 0.8 and 1.25. */
export function treeSize(t: Tags, shape: TreeShape, unit: number): number {
  const h = parseHeight(t.height);
  if (h) return round2(Math.min(1.6, Math.max(0.6, h / (shape === 'palm' ? 9 : 8))));
  return round2(0.8 + unit * 0.45);
}

/** Points every `spacing` meters along a polyline, starting half a step in. */
export function pointsAlong(points: Point[], spacing: number): Point[] {
  const out: Point[] = [];
  let next = spacing / 2;
  let walked = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (next < walked + len) {
      const t = (next - walked) / (len || 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      next += spacing;
    }
    walked += len;
  }
  return out;
}

export function extractExtras(fc: FeatureCollection, origin: LatLon): RawExtras {
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new TypeError('Expected a GeoJSON FeatureCollection');
  }
  const proj = createProjection(origin);
  const barriers: Barrier[] = [];
  const trees: Tree[] = [];
  const rowTrees: Tree[] = [];
  const fixtures: RawExtras['fixtures'] = [];
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  fc.features.forEach((f, i) => {
    if (!f?.geometry) return skip('no-geometry');
    const g = f.geometry;
    const t = getTags(f);
    const id = getId(f, i);

    if (t.natural === 'tree' && g.type === 'Point') {
      const p = projectPositions([g.coordinates], proj)?.[0];
      if (!p) return skip('degenerate-point');
      const rand = seeded(id);
      const shape = treeShape(t, rand());
      trees.push({ p, shape, s: treeSize(t, shape, rand()) });
      return;
    }
    if (t.natural === 'tree_row') {
      for (const line of linesOf(g) ?? []) {
        const pts = projectPositions(line, proj);
        if (!pts || pts.length < 2) continue;
        pointsAlong(pts, TREE_ROW_SPACING).forEach((p, k) => {
          const rand = seeded(`${id}#${k}`);
          const shape = treeShape(t, rand());
          rowTrees.push({ p: roundPoint(p), shape, s: treeSize(t, shape, rand()) });
        });
      }
      return;
    }

    const barrier = str(t.barrier);
    if (!barrier) return skip(g.type === 'Point' ? 'point' : 'untagged');

    if (g.type === 'Point') {
      const kind = FIXTURE_KINDS[barrier];
      if (!kind) return skip(`barrier:${barrier}`);
      const p = projectPositions([g.coordinates], proj)?.[0];
      if (!p) return skip('degenerate-point');
      fixtures.push({ kind, p });
      return;
    }

    const kind = BARRIER_KINDS[barrier];
    if (!kind) return skip(`barrier:${barrier}`);
    // Closed walls (around a compound or golf course) come as polygons: walk the outline.
    const lines = linesOf(g) ?? polygonsOf(g)?.map((poly) => poly[0]) ?? [];
    const tagged = parseHeight(t.height);
    const h = tagged ? Math.min(6, Math.max(0.5, tagged)) : barrier === 'retaining_wall' ? RETAINING_WALL_HEIGHT : BARRIER_HEIGHT[kind];
    lines.forEach((line, j) => {
      const points = projectPositions(line, proj);
      if (!points || points.length < 2) return skip('degenerate-line');
      barriers.push({ id: lines.length > 1 ? `${id}#${j}` : id, kind, h, points });
    });
  });

  // Single trees first, so a row sample right next to a mapped tree is the one dropped.
  return { barriers, trees: [...trees, ...rowTrees], fixtures, skipped };
}

export interface ExtrasStats {
  barriers: number;
  barrierMeters: number;
  gapsCut: number;
  trees: number;
  /** Street trees mapped slightly into a road, moved to its edge. */
  treesMoved: number;
  fixtures: number;
  dropped: Record<string, number>;
}

/** Road surface clearance kept free of walls, fences and hedges. */
const BARRIER_CLEARANCE = 0.4;
const SAMPLE_STEP = 0.25;
/** Shorter barrier pieces left over after cutting are dropped. */
const MIN_PIECE = 0.6;
const TREE_SPACING = 2;
/** Trees up to this far into a road surface are street trees mapped a bit off: moved to the curb. */
export const TREE_NUDGE = 2;
const treeClearance = (r: Road) => (r.cls === 'path' ? 0.2 : 0.6);

const pathLength = (pts: Point[]) => pts.slice(1).reduce((d, p, i) => d + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
const angleOf = (a: Point, b: Point) => Math.atan2(b[1] - a[1], b[0] - a[0]);

/** Point at arc length `s` along a polyline, with the direction of the segment it falls on. */
function pointAt(points: Point[], s: number): { p: Point; dir: number } {
  let walked = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (walked + len >= s || i === points.length - 2) {
      const t = len ? Math.max(0, Math.min(1, (s - walked) / len)) : 0;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: angleOf(a, b) };
    }
    walked += len;
  }
  return { p: points[0], dir: 0 };
}

/** Arc length along a polyline of the point closest to `q`, and how far away it is. */
function project(points: Point[], q: Point): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  let walked = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2)) : 0;
    const d = Math.hypot(a[0] + dx * t - q[0], a[1] + dy * t - q[1]);
    if (d < best.d) best = { s: walked + t * Math.sqrt(len2), d };
    walked += Math.sqrt(len2);
  }
  return best;
}

/** Moves q straight away from segment ab by `depth` (+ 1 cm), out of the road surface it is in. */
export function pushOff(q: Point, a: Point, b: Point, depth: number): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2)) : 0;
  const c: Point = [a[0] + dx * t, a[1] + dy * t];
  let ox = q[0] - c[0];
  let oy = q[1] - c[1];
  let d = Math.hypot(ox, oy);
  if (d < 1e-6) {
    // Exactly on the centerline: go left of the road.
    const len = Math.sqrt(len2) || 1;
    [ox, oy, d] = [-dy / len, dx / len, 1];
    return [q[0] + ox * (depth + 0.01), q[1] + oy * (depth + 0.01)];
  }
  const k = (d + depth + 0.01) / d;
  return [c[0] + ox * k, c[1] + oy * k];
}

/** Merges overlapping [start, end] intervals. */
export function mergeIntervals(list: [number, number][]): [number, number][] {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The parts of a polyline outside the given (merged) intervals, each at least MIN_PIECE long. */
export function cutPolyline(points: Point[], gaps: [number, number][]): Point[][] {
  const total = pathLength(points);
  const zeros = points.map(() => 0);
  const pieces: Point[][] = [];
  let from = 0;
  for (const [a, b] of [...mergeIntervals(gaps), [total, total] as [number, number]]) {
    if (a - from >= MIN_PIECE) {
      const piece = slicePolyline(points, zeros, from, total - Math.min(a, total));
      if (piece) pieces.push(piece.pts.map(roundPoint));
    }
    from = Math.max(from, b);
  }
  return pieces;
}

export function placeExtras(raw: RawExtras, map: MapData, margin = 300): { barriers: Barrier[]; trees: Tree[]; fixtures: Fixture[]; stats: ExtrasStats } {
  const dropped: Record<string, number> = {};
  const drop = (reason: string) => {
    dropped[reason] = (dropped[reason] ?? 0) + 1;
  };
  const playable = map.playable;
  const inArea = (p: Point) => !playable || zoneOf(p, playable, margin) !== 'out';
  const box: Rect | undefined = playable
    ? (({ minX, minY, maxX, maxY }) => ({ minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin }))(ringBounds(playable))
    : undefined;

  // Ground-level road and path segments (flyover decks pass over walls and trees).
  const roads = new SegmentGrid<Road>(30);
  let widest = 0;
  for (const r of map.roads) {
    for (let i = 0; i < r.points.length - 1; i++) {
      if (Math.max(r.z?.[i] ?? 0, r.z?.[i + 1] ?? 0) > 1.5) continue;
      roads.insert(r.points[i], r.points[i + 1], r);
    }
    widest = Math.max(widest, r.w);
  }
  /** How far inside a road surface a point is (> 0 means on the road), and the deepest road. */
  const onRoad = (q: Point, extra: (r: Road) => number) => {
    let best: { depth: number; road?: Road; dir: number; a?: Point; b?: Point } = { depth: -Infinity, dir: 0 };
    for (const e of roads.query(q, q, widest / 2 + 1)) {
      const depth = e.item.w / 2 + extra(e.item) - distanceToSegment(q, e.a, e.b);
      if (depth > best.depth) best = { depth, road: e.item, dir: angleOf(e.a, e.b), a: e.a, b: e.b };
    }
    return best;
  };

  const buildings = new SegmentGrid<number>(30);
  map.buildings.forEach((b, i) => {
    if ((b.minH ?? 0) >= 2.5) return; // canopies and skybridges: things stand under them
    const bb = ringBounds(b.rings[0]);
    buildings.insert([bb.minX, bb.minY], [bb.maxX, bb.maxY], i);
  });
  const inBuilding = (q: Point) =>
    buildings.query(q, q).some(({ item }) => {
      const [outer, ...holes] = map.buildings[item].rings;
      return pointInRing(q, outer) && !holes.some((h) => pointInRing(q, h));
    });
  const water = (map.areas ?? []).filter((a) => a.kind === 'water');
  const inWater = (q: Point) => water.some((a) => pointInRing(q, a.rings[0]) && !a.rings.slice(1).some((h) => pointInRing(q, h)));

  // 1. Barriers: keep what's in the area, clipped like roads.
  type Piece = Barrier & { gaps: [number, number][] };
  const pieces: Piece[] = [];
  for (const b of raw.barriers) {
    const runs = (playable ? runsNear(b.points, (p, q) => segmentNear(p, q, playable, margin)) : [b.points]).flatMap((run) =>
      box ? clipPolylineToRect(run, box) : [run],
    );
    if (runs.length === 0) {
      drop('barrier-outside');
      continue;
    }
    runs.forEach((points, k) => {
      const { scenery: _drop, ...rest } = b;
      const inside = !playable || points.some((p, j) => j > 0 && segmentNear(points[j - 1], p, playable, 0));
      pieces.push({ ...rest, id: runs.length > 1 ? `${b.id}~${k}` : b.id, ...(!inside && { scenery: true as const }), points, gaps: [] });
    });
  }

  // 2. Fixtures. Gates in a wall with no road through them open a gap in the wall.
  const fixtures: Fixture[] = [];
  for (const f of raw.fixtures) {
    if (!inArea(f.p)) {
      drop('fixture-outside');
      continue;
    }
    if (inBuilding(f.p)) {
      drop('fixture-in-building');
      continue;
    }
    const road = onRoad(f.p, () => 0);
    const onIt = road.road && road.depth > road.road.w / 2 - 1 ? road : undefined; // within 1 m of the centerline
    const p = roundPoint(f.p);
    const across = (dir: number) => round2(dir + Math.PI / 2);
    if (f.kind === 'gate') {
      if (onIt?.road) {
        fixtures.push({ kind: 'gate', p, rot: across(onIt.dir), span: round2(onIt.road.w + 0.6) });
        continue;
      }
      const wall = pieces
        .filter((b) => b.kind !== 'rail')
        .map((b) => ({ b, ...project(b.points, f.p) }))
        .sort((x, y) => x.d - y.d)[0];
      if (!wall || wall.d > 1.5) {
        drop('gate-alone');
        continue;
      }
      wall.b.gaps.push([wall.s - WALL_GATE_WIDTH / 2, wall.s + WALL_GATE_WIDTH / 2]);
      fixtures.push({ kind: 'gate', p, rot: round2(pointAt(wall.b.points, wall.s).dir), span: WALL_GATE_WIDTH });
    } else if (f.kind === 'boom') {
      if (!onIt?.road || onIt.road.cls === 'path') {
        drop('boom-off-road');
        continue;
      }
      fixtures.push({ kind: 'boom', p, rot: across(onIt.dir), span: round2(onIt.road.w) });
    } else {
      fixtures.push({ kind: f.kind, p, rot: round2(onIt ? onIt.dir : 0) });
    }
  }

  // 3. Cut walls, fences and hedges open wherever they stand on a road or path surface.
  // Guard rails and jersey barriers line roads on purpose, so they stay whole.
  let gapsCut = 0;
  const barriers: Barrier[] = [];
  for (const b of pieces) {
    const { gaps, ...barrier } = b;
    if (b.kind !== 'rail') {
      const total = pathLength(b.points);
      for (let s = 0; s <= total; s += SAMPLE_STEP) {
        if (onRoad(pointAt(b.points, s).p, () => BARRIER_CLEARANCE).depth > 0) gaps.push([s - SAMPLE_STEP, s + SAMPLE_STEP]);
      }
    }
    const merged = mergeIntervals(gaps);
    gapsCut += merged.length;
    const parts = merged.length ? cutPolyline(b.points, merged) : [b.points.map(roundPoint)];
    if (parts.length === 0) drop('barrier-all-on-road');
    parts.forEach((points, k) => barriers.push({ ...barrier, id: parts.length > 1 ? `${b.id}/${k}` : b.id, points }));
  }

  // 4. Trees: off roads, out of buildings and water, and not on top of each other.
  const kept = new SegmentGrid<Point>(TREE_SPACING * 2);
  const trees: Tree[] = [];
  let nudged = 0;
  for (const raw0 of raw.trees) {
    let t = raw0;
    if (!inArea(t.p)) {
      drop('tree-outside');
      continue;
    }
    const hit = onRoad(t.p, treeClearance);
    if (hit.depth > 0) {
      const moved = hit.depth <= TREE_NUDGE && hit.a && hit.b ? pushOff(t.p, hit.a, hit.b, hit.depth) : undefined;
      if (!moved || onRoad(moved, treeClearance).depth > 0) {
        drop('tree-on-road');
        continue;
      }
      t = { ...t, p: moved };
      nudged++;
    }
    if (inBuilding(t.p)) {
      drop('tree-in-building');
      continue;
    }
    if (inWater(t.p)) {
      drop('tree-in-water');
      continue;
    }
    if (kept.query(t.p, t.p, TREE_SPACING).some((e) => Math.hypot(e.item[0] - t.p[0], e.item[1] - t.p[1]) < TREE_SPACING)) {
      drop('tree-duplicate');
      continue;
    }
    kept.insert(t.p, t.p, t.p);
    trees.push({ ...t, p: roundPoint(t.p) });
  }

  const barrierMeters = Math.round(barriers.reduce((d, b) => d + pathLength(b.points), 0));
  return {
    barriers,
    trees,
    fixtures,
    stats: { barriers: barriers.length, barrierMeters, gapsCut, trees: trees.length, treesMoved: nudged, fixtures: fixtures.length, dropped },
  };
}
