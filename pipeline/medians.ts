/**
 * Carriageways that almost touch. Divided roads are mapped as two one-way roads, and
 * where their fitted widths leave a gap of under a meter between them, the ground (or
 * a sidewalk band) shows through as a thin light line. Such pairs are widened to meet.
 * Wider gaps are real medians and stay.
 */
import { distanceToSegment } from '../src/geometry/polygon';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import type { Point, Road } from '../src/map/types';

const MAX_GAP = 1.2; // meters; wider is a real median
const PARALLEL_SIN = Math.sin((12 * Math.PI) / 180);
const STEP = 4; // meters between samples along a road
const SHARE = 0.4; // at least this share of a road's samples must run along the gap

export interface MedianStats {
  widened: number;
}

const flat = (r: Road) => !r.z || r.z.every((v) => Math.abs(v - r.z![0]) < 0.3);

/** For each road, the gap to apply (0 = leave it). Exported for tests. */
export function medianGaps(roads: Road[]): number[] {
  const drive = roads.map((r) => r.cls !== 'path' && flat(r));
  const grid = new SegmentGrid<{ ri: number; i: number }>(20);
  roads.forEach((r, ri) => {
    if (!drive[ri]) return;
    for (let i = 0; i < r.points.length - 1; i++) grid.insert(r.points[i], r.points[i + 1], { ri, i });
  });

  return roads.map((r, ri) => {
    if (!drive[ri]) return 0;
    const gaps: number[] = [];
    let samples = 0;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [a, b] = [r.points[i], r.points[i + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) continue;
      const d: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      for (let s = STEP / 2; s < len; s += STEP) {
        const p: Point = [a[0] + d[0] * s, a[1] + d[1] * s];
        samples++;
        let best = Infinity;
        for (const { a: c, b: e, item } of grid.query(p, p, r.w / 2 + MAX_GAP + 10)) {
          if (item.ri === ri) continue;
          const o = roads[item.ri];
          const el = Math.hypot(e[0] - c[0], e[1] - c[1]);
          if (el < 0.5 || Math.abs(d[0] * (e[1] - c[1]) - d[1] * (e[0] - c[0])) / el > PARALLEL_SIN) continue;
          if ((r.z?.[0] ?? 0) !== (o.z?.[0] ?? 0)) continue;
          const gap = distanceToSegment(p, c, e) - r.w / 2 - o.w / 2;
          if (gap < best) best = gap;
        }
        if (best > 0.05 && best <= MAX_GAP) gaps.push(best);
      }
    }
    if (samples === 0 || gaps.length / samples < SHARE) return 0;
    gaps.sort((x, y) => x - y);
    return gaps[Math.floor(gaps.length / 2)];
  });
}

/** Widens each road by its gap, so both carriageways grow halfway and meet. */
export function closeMedianGaps(roads: Road[]): { roads: Road[]; stats: MedianStats } {
  const gaps = medianGaps(roads);
  let widened = 0;
  const out = roads.map((r, i) => {
    if (gaps[i] <= 0) return r;
    widened++;
    return { ...r, w: Math.round((r.w + gaps[i]) * 100) / 100 };
  });
  return { roads: out, stats: { widened } };
}
