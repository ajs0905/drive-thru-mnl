/**
 * Cleans up raised walkways and roads after elevation:
 *
 *  1. Skywalks: BGC's malls are linked by elevated walkways that OSM maps straight
 *     through the buildings. The parts inside a building are dropped (we can't see
 *     inside, and drawn on the roof they look like rails on top of the mall).
 *  2. Leftover raised scraps shorter than 6 m with a loose end are dropped.
 *  3. Raised ends that hang in mid-air (no stairs mapped, or cut by the map edge)
 *     slope down to the ground, unless they end at a building wall, where a skywalk
 *     would actually connect.
 */
import { distanceToSegment, pointInRing, ringBounds } from '../src/geometry/polygon';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import type { Building, Point, Road } from '../src/map/types';

const RAISED = 1; // meters; below this a point counts as on the ground
const SCRAP = 6; // meters
export const END_RAMP = { drive: 60, walk: 20 } as const;
const WALL_TOUCH = 2.5; // meters from a wall counts as "ends at the building"

const keyOf = (p: Point) => `${p[0]},${p[1]}`;
const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const seglen = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export interface SettleStats {
  insideRemovedMeters: number;
  scrapsRemoved: number;
  endsLowered: number;
  endsAtBuildings: number;
}

export function settleRaised(input: Road[], buildings: Building[]): { roads: Road[]; stats: SettleStats } {
  const stats: SettleStats = { insideRemovedMeters: 0, scrapsRemoved: 0, endsLowered: 0, endsAtBuildings: 0 };

  // Solid buildings only: canopies and skybridges (raised bottoms) don't hide anything.
  const solid = buildings.filter((b) => (b.minH ?? 0) < 2.5);
  const boxes = new SegmentGrid<Building>(30);
  const walls = new SegmentGrid<Building>(25);
  for (const b of solid) {
    const bb = ringBounds(b.rings[0]);
    boxes.insert([bb.minX, bb.minY], [bb.maxX, bb.maxY], b);
    const r = b.rings[0];
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) walls.insert(r[j], r[i], b);
  }
  const buildingAt = (p: Point) => boxes.query(p, p).find((e) => pointInRing(p, e.item.rings[0]))?.item;
  const nearWall = (p: Point) => walls.query(p, p, WALL_TOUCH).some((e) => distanceToSegment(p, e.a, e.b) <= WALL_TOUCH);

  // --- 1. Cut the parts of raised ways that run inside buildings ----------------------
  let roads: Road[] = [];
  for (const r of input) {
    if (!r.z || !r.z.some((v) => v > RAISED)) {
      roads.push(r);
      continue;
    }
    const z = r.z;
    const keep = r.points.slice(0, -1).map((a, i) => {
      const b = r.points[i + 1];
      if (Math.min(z[i], z[i + 1]) <= RAISED) return true; // ramps on the ground stay
      const inside = buildingAt([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      if (!inside) return true;
      // A flyover over a low building (bad data) keeps its deck; walkways go either way.
      if (r.cls !== 'path' && inside.h < Math.min(z[i], z[i + 1]) - 1.5) return true;
      stats.insideRemovedMeters += seglen(a, b);
      return false;
    });
    let piece = 0;
    let pts: Point[] = [];
    let zs: number[] = [];
    const flush = () => {
      if (pts.length >= 2) {
        const all = keep.every(Boolean);
        roads.push({ ...r, id: all ? r.id : `${r.id}^${piece++}`, points: pts, z: zs });
      }
      pts = [];
      zs = [];
    };
    keep.forEach((k, i) => {
      if (!k) return flush();
      if (pts.length === 0) {
        pts.push(r.points[i]);
        zs.push(z[i]);
      }
      pts.push(r.points[i + 1]);
      zs.push(z[i + 1]);
    });
    flush();
  }

  // Shared-point counts, to find loose ends.
  const countUses = () => {
    const uses = new Map<string, number>();
    for (const r of roads) for (const p of r.points) uses.set(keyOf(p), (uses.get(keyOf(p)) ?? 0) + 1);
    return uses;
  };

  // --- 2. Drop raised scraps with a loose end -----------------------------------------
  for (let pass = 0; pass < 3; pass++) {
    const uses = countUses();
    const before = roads.length;
    roads = roads.filter((r) => {
      if (!r.z || !r.z.every((v) => v > RAISED)) return true;
      let len = 0;
      for (let i = 0; i < r.points.length - 1; i++) len += seglen(r.points[i], r.points[i + 1]);
      const loose = [r.points[0], r.points[r.points.length - 1]].some((p) => (uses.get(keyOf(p)) ?? 0) === 1);
      return !(len < SCRAP && loose);
    });
    stats.scrapsRemoved += before - roads.length;
    if (roads.length === before) break;
  }

  // --- 3. Bring mid-air ends down ------------------------------------------------------
  const uses = countUses();
  roads = roads.map((r) => {
    if (!r.z || !r.z.some((v) => v > RAISED)) return r;
    let points = r.points;
    let z = r.z;
    for (const end of [0, -1] as const) {
      const i = end === 0 ? 0 : points.length - 1;
      const p = points[i];
      if (z[i] <= 2 || (uses.get(keyOf(p)) ?? 0) !== 1) continue;
      if (nearWall(p)) {
        stats.endsAtBuildings++;
        continue;
      }
      const R = END_RAMP[r.cls === 'path' ? 'walk' : 'drive'];
      ({ points, z } = rampDownFromEnd(points, z, end === 0 ? 'start' : 'end', R));
      stats.endsLowered++;
    }
    return points === r.points ? r : { ...r, points, z };
  });

  return { roads, stats };
}

/**
 * Lowers a polyline to 0 at one end, rising back to its own height over R meters.
 * Inserts points at R/4..R so the slope is a curve.
 */
export function rampDownFromEnd(points: Point[], z: number[], from: 'start' | 'end', R: number): { points: Point[]; z: number[] } {
  const pts = from === 'start' ? points : [...points].reverse();
  const zs = from === 'start' ? z : [...z].reverse();
  const outP: Point[] = [pts[0]];
  const outZ: number[] = [0];
  const targets = [R / 4, R / 2, (3 * R) / 4, R];
  let d = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const len = seglen(a, b);
    for (const t of targets) {
      if (t <= d + 0.3 || t >= d + len - 0.3) continue;
      const f = (t - d) / len;
      outP.push([round2(a[0] + (b[0] - a[0]) * f), round2(a[1] + (b[1] - a[1]) * f)]);
      const h = zs[i] + (zs[i + 1] - zs[i]) * f;
      outZ.push(round2(h * smooth(t / R)));
    }
    d += len;
    outP.push(b);
    outZ.push(round2(zs[i + 1] * smooth(d / R)));
  }
  return from === 'start' ? { points: outP, z: outZ } : { points: outP.reverse(), z: outZ.reverse() };
}
