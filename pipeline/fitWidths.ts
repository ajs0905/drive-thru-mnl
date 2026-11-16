/**
 * Narrows minor roads to fit between the buildings around them.
 *
 * In the dense neighborhoods inside the playable area, houses are built right up to
 * narrow streets. A "2 lanes = 7.4 m" street then cuts through the front of every
 * house. Here each minor or service road is measured against nearby building walls
 * (exact segment-to-segment distance) and narrowed so it fits, never below a minimum
 * width and never wider than it already was. Walls the centerline actually crosses
 * are ignored: that's a road going under or into a building, not a tight street.
 *
 * Major roads get the same treatment but never go below 6 m (one lane each way).
 */
import { clipRingToHalfPlane, distanceToSegment, ringArea, ringBounds, segmentDistance, vertexCentroid } from '../src/geometry/polygon';
import { SegmentGrid, segmentsCross } from '../src/geometry/spatialGrid';
import type { Building, Road } from '../src/map/types';

export const MIN_WIDTH = { major: 6, minor: 2.8, service: 2.5 } as const;
const SEARCH = 12; // meters; walls farther than this don't matter
const GAP = 0.3; // keep a little space between road edge and wall

export interface FitStats {
  narrowed: number;
  checked: number;
}

export function fitRoadWidths(roads: Road[], buildings: Building[]): { roads: Road[]; stats: FitStats } {
  const walls = new SegmentGrid<number>(25);
  buildings.forEach((b, bi) => {
    if ((b.minH ?? 0) > 2.5) return; // raised canopies don't block the road
    for (const ring of b.rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) walls.insert(ring[j], ring[i], bi);
    }
  });

  const stats: FitStats = { narrowed: 0, checked: 0 };
  const out = roads.map((r) => {
    if (r.cls === 'path') return r;
    if (r.z && r.z.some((v) => v > 2)) return r; // raised roads clear the houses
    stats.checked++;

    let tightest = SEARCH;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [a, b] = [r.points[i], r.points[i + 1]];
      for (const e of walls.query(a, b, SEARCH)) {
        const d = segmentDistance(a, b, e.a, e.b);
        if (d > 0) tightest = Math.min(tightest, d);
      }
    }

    const fit = Math.max(Math.min(MIN_WIDTH[r.cls], r.w), 2 * (tightest - GAP));
    if (fit >= r.w) return r;
    stats.narrowed++;
    return { ...r, w: Math.round(fit * 10) / 10 };
  });

  return { roads: out, stats };
}

/**
 * Removes buildings whose center sits on a road surface. Those are mapping errors or
 * structures that have since been cleared, and later they would block the car.
 * Raised decks, tunnels and building passages don't count.
 */
export function dropBuildingsOnRoads(buildings: Building[], roads: Road[]): { buildings: Building[]; dropped: number } {
  const grid = new SegmentGrid<Road>(25);
  for (const r of roads) {
    if (r.cls === 'path' || r.tunnel) continue;
    for (let i = 0; i < r.points.length - 1; i++) {
      if (Math.max(r.z?.[i] ?? 0, r.z?.[i + 1] ?? 0) > 1) continue;
      grid.insert(r.points[i], r.points[i + 1], r);
    }
  }
  const kept = buildings.filter((b) => {
    if ((b.minH ?? 0) > 2.5) return true;
    const c = vertexCentroid(b.rings[0]);
    return !grid.query(c, c, 10).some((e) => distanceToSegment(c, e.a, e.b) < e.item.w / 2 - 0.5);
  });
  return { buildings: kept, dropped: buildings.length - kept.length };
}

export const TRIM = {
  /** Walls reaching more than this (m) into a road's surface (plus `gap`) get cut back. */
  min: 0.3,
  gap: 0.2,
  /** A building that would lose more than this share of its footprint is dropped instead. */
  keep: 0.5,
  /** Service roads trim only buildings smaller than this (m2): bigger ones are malls and towers whose access roads hug them. */
  serviceUpTo: 2000,
  /** Cuts per building at most. */
  passes: 4,
};

export interface TrimStats {
  trimmed: number;
  dropped: number;
}

/**
 * Cuts building walls back off the road surfaces they reach into (the last 1 to 3 m of a
 * house that OSM maps onto a street, after the street was narrowed as far as it goes):
 * the footprint is clipped along the road's edge plus a small gap. Roads whose centerline
 * runs through the building (a passage, a driveway into a car park) are left alone, and so
 * are raised buildings, courtyard buildings and decks. A building that would lose more
 * than half its footprint goes.
 */
export function trimBuildingsOffRoads(buildings: Building[], roads: Road[]): { buildings: Building[]; stats: TrimStats } {
  const grid = new SegmentGrid<Road>(25);
  for (const r of roads) {
    if (r.cls === 'path' || r.tunnel) continue;
    for (let i = 0; i < r.points.length - 1; i++) {
      if (Math.max(r.z?.[i] ?? 0, r.z?.[i + 1] ?? 0) > 1) continue;
      grid.insert(r.points[i], r.points[i + 1], r);
    }
  }
  const stats: TrimStats = { trimmed: 0, dropped: 0 };
  const out: Building[] = [];
  for (const b of buildings) {
    if ((b.minH ?? 0) > 2.5 || b.rings.length !== 1) {
      out.push(b);
      continue;
    }
    const area0 = ringArea(b.rings[0]);
    let ring = b.rings[0];
    let cut = false;
    for (let pass = 0; pass < TRIM.passes; pass++) {
      let worst: { pen: number; a: [number, number]; b: [number, number]; w: number } | null = null;
      const bb0 = ringBounds(ring);
      const near = grid.query([bb0.minX, bb0.minY], [bb0.maxX, bb0.maxY], 20);
      const through = new Set<Road>();
      for (const e of near) for (let i = 0; i < ring.length; i++) if (segmentsCross(e.a, e.b, ring[i], ring[(i + 1) % ring.length])) through.add(e.item);
      for (const e of near) {
        const r = e.item;
        if (through.has(r) || (r.cls === 'service' && area0 >= TRIM.serviceUpTo)) continue;
        for (const p of ring) {
          const pen = r.w / 2 + TRIM.gap - distanceToSegment(p, e.a, e.b);
          if (pen > TRIM.min + TRIM.gap && (!worst || pen > worst.pen)) worst = { pen, a: e.a, b: e.b, w: r.w };
        }
      }
      if (!worst) break;
      const [a, bb] = [worst.a, worst.b];
      const len = Math.hypot(bb[0] - a[0], bb[1] - a[1]) || 1;
      let n: [number, number] = [-(bb[1] - a[1]) / len, (bb[0] - a[0]) / len];
      const c = vertexCentroid(ring);
      if ((c[0] - a[0]) * n[0] + (c[1] - a[1]) * n[1] < 0) n = [-n[0], -n[1]];
      const next = clipRingToHalfPlane(ring, a, n, worst.w / 2 + TRIM.gap);
      if (next.length < 3) {
        ring = [];
        break;
      }
      ring = next.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
      cut = true;
    }
    if (!cut) {
      out.push(b);
      continue;
    }
    if (ring.length < 3 || ringArea(ring) < area0 * TRIM.keep) {
      stats.dropped++;
      continue;
    }
    stats.trimmed++;
    out.push({ ...b, rings: [ring] });
  }
  return { buildings: out, stats };
}
