/**
 * Zebra crossings. OSM crossing footways often run past the curb, bend around
 * corners, or are mapped along the road instead of across it, so painting stripes
 * along the whole way looks wrong. Instead, find where each crossing way cuts across
 * a drivable road's centerline and put one straight zebra there, across that road
 * from edge to edge. A zebra that would land inside a junction is moved back to just
 * outside it (where real ones are painted); one that would overlap another is dropped.
 * Crossing ways themselves are removed from the road list.
 */
import { lineIntersection } from '../src/geometry/junction';
import { pointInRing, ringBounds } from '../src/geometry/polygon';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import { convexOverlap, zebraCorners } from '../src/geometry/zebra';
import type { Crossing, Junction, Point, Road } from '../src/map/types';

const ZEBRA_WIDTH = 3; // meters along the road
const MIN_ANGLE_DEG = 35; // shallower than this, the "crossing" runs along the road, not across it
const CLEARANCE = 0.3; // meters between a zebra and the junction it's moved out of
const MAX_SHIFT = 12; // meters; a crossing mapped deeper into a junction than this is dropped
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CrossingStats {
  ways: number;
  placed: number;
  moved: number;
  waysWithoutRoad: number;
  skippedShallow: number;
  skippedRaised: number;
  droppedOverlap: number;
  droppedNoRoom: number;
}

interface Seg {
  road: Road;
  i: number;
}

/** Cumulative distance at each point. */
function cumulative(points: Point[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return cum;
}

/** Point and unit direction `d` meters along a polyline. */
function pointAlong(points: Point[], cum: number[], d: number): { p: Point; dir: Point } {
  let i = 1;
  while (i < points.length - 1 && cum[i] < d) i++;
  const [a, b] = [points[i - 1], points[i]];
  const seg = cum[i] - cum[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (d - cum[i - 1]) / seg));
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg] };
}

export function placeCrossings(input: Road[], junctions: Junction[] = []): { roads: Road[]; crossings: Crossing[]; stats: CrossingStats } {
  const ways = input.filter((r) => r.crossing);
  const roads = input.filter((r) => !r.crossing);
  const stats: CrossingStats = {
    ways: ways.length, placed: 0, moved: 0, waysWithoutRoad: 0, skippedShallow: 0, skippedRaised: 0, droppedOverlap: 0, droppedNoRoom: 0,
  };

  const grid = new SegmentGrid<Seg>(40);
  const cums = new Map<Road, number[]>();
  for (const road of roads) {
    if (road.cls === 'path') continue;
    cums.set(road, cumulative(road.points));
    for (let i = 0; i < road.points.length - 1; i++) grid.insert(road.points[i], road.points[i + 1], { road, i });
  }
  const junctionBoxes = junctions.map((j) => ({ ring: j.ring, b: ringBounds(j.ring) }));
  const inJunction = ([x, y]: Point) =>
    junctionBoxes.some(({ ring, b }) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && pointInRing([x, y], ring));

  const crossings: Crossing[] = [];
  const footprints: Point[][] = [];
  const placedAt = new Map<Road, number[]>(); // distances along each road with a zebra
  const minSin = Math.sin((MIN_ANGLE_DEG * Math.PI) / 180);
  for (const way of ways) {
    if (way.z?.some((v) => v > 0.5)) continue; // a footbridge, not a zebra
    let hits = 0;
    for (let k = 0; k < way.points.length - 1; k++) {
      const p = way.points[k];
      const q = way.points[k + 1];
      const e: Point = [q[0] - p[0], q[1] - p[1]];
      const eLen = Math.hypot(e[0], e[1]);
      if (eLen < 1e-6) continue;
      for (const { a, b, item } of grid.query(p, q)) {
        const d: Point = [b[0] - a[0], b[1] - a[1]];
        const dLen = Math.hypot(d[0], d[1]);
        if (dLen < 1e-6) continue;
        const hit = lineIntersection(a, d, p, e);
        if (!hit) continue;
        const [t, s] = hit;
        // Inclusive with a little slack: crossings usually share a node with the road.
        if (t < -1e-6 || t > 1 + 1e-6 || s < -1e-6 || s > 1 + 1e-6) continue;
        const sin = Math.abs(d[0] * e[1] - d[1] * e[0]) / (dLen * eLen);
        if (sin < minSin) {
          stats.skippedShallow++;
          continue;
        }
        const { road, i } = item;
        const z = road.z ? road.z[i] + (road.z[i + 1] - road.z[i]) * t : 0;
        if (z > 0.5) {
          stats.skippedRaised++; // a flyover passing over the crossing
          continue;
        }
        hits++;

        // Keep the band off the junction polygons at either end of this road piece.
        const cum = cums.get(road)!;
        const total = cum[cum.length - 1];
        let along = cum[i] + (cum[i + 1] - cum[i]) * t;
        const lo = road.trim && road.trim[0] >= 0 ? road.trim[0] + ZEBRA_WIDTH / 2 + CLEARANCE : 0;
        const hi = road.trim && road.trim[1] >= 0 ? total - road.trim[1] - ZEBRA_WIDTH / 2 - CLEARANCE : total;
        if (lo > hi) {
          stats.droppedNoRoom++;
          continue;
        }
        const target = Math.min(hi, Math.max(lo, along));
        if (Math.abs(target - along) > MAX_SHIFT) {
          stats.droppedNoRoom++;
          continue;
        }
        // The same crossing seen twice (it shares a node with the road, so it touches two segments).
        if (placedAt.get(road)?.some((d) => Math.abs(d - target) < 1)) continue;
        const moved = target !== along;
        along = target;

        const at = pointAlong(road.points, cum, along);
        const zebra: Crossing = {
          c: [round2(at.p[0]), round2(at.p[1])],
          dir: [Math.round(at.dir[0] * 1000) / 1000, Math.round(at.dir[1] * 1000) / 1000],
          half: round2(road.w / 2),
          w: ZEBRA_WIDTH,
          z: round2(z),
          cls: road.cls,
        };
        const footprint = zebraCorners(zebra);
        if (inJunction(zebra.c) || footprints.some((f) => convexOverlap(f, footprint))) {
          stats.droppedOverlap++;
          continue;
        }
        crossings.push(zebra);
        footprints.push(footprint);
        placedAt.set(road, [...(placedAt.get(road) ?? []), along]);
        if (moved) stats.moved++;
      }
    }
    if (hits === 0) stats.waysWithoutRoad++;
  }
  stats.placed = crossings.length;
  return { roads, crossings, stats };
}
