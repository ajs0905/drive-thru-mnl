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
 * Major roads are left alone: their widths come from lane counts and they rarely clash.
 */
import { segmentDistance } from '../src/geometry/polygon';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import type { Building, Road } from '../src/map/types';

export const MIN_WIDTH = { minor: 3.5, service: 3 } as const;
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
    if (r.cls !== 'minor' && r.cls !== 'service') return r;
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

    const fit = Math.max(MIN_WIDTH[r.cls], 2 * (tightest - GAP));
    if (fit >= r.w) return r;
    stats.narrowed++;
    return { ...r, w: Math.round(fit * 10) / 10 };
  });

  return { roads: out, stats };
}
