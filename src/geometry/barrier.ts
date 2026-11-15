/**
 * Walls, fences, hedges and guard rails: a thin strip around the centerline, extruded
 * up. Joins are mitered like road edges, so corners close without gaps.
 */
import type { BarrierKind, Point } from '../map/types';
import { addFlatPolygon, addWalls } from './extrude';
import type { MeshBuilder, RGB } from './meshBuilder';
import { withWinding } from './polygon';
import { offsetPolyline } from './road';

/** Thickness in meters. Fences are drawn solid but thin. */
export const BARRIER_THICKNESS: Record<BarrierKind, number> = { wall: 0.25, fence: 0.08, hedge: 0.9, rail: 0.4, hoarding: 0.12, lotwall: 0.2 };

/**
 * Posts along a barrier (m): construction hoarding's steel posts and a lot wall's pillars,
 * every `every` meters and at both ends, `size` square, `rise` above the barrier.
 */
export const BARRIER_POSTS: Partial<Record<BarrierKind, { every: number; size: number; rise: number }>> = {
  hoarding: { every: 2.4, size: 0.16, rise: 0 },
  lotwall: { every: 4, size: 0.4, rise: 0.15 },
};

/** Points every `every` meters along a polyline (its ends included), with the direction there. */
export function postsAlong(points: Point[], every: number): { p: Point; dir: Point }[] {
  const out: { p: Point; dir: Point }[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  if (total < 1e-6) return out;
  const n = Math.max(1, Math.round(total / every));
  const step = total / n;
  let i = 0;
  let walked = 0;
  for (let k = 0; k <= n; k++) {
    const s = Math.min(total, k * step);
    while (i < points.length - 2 && walked + Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]) < s) {
      walked += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
      i++;
    }
    const [a, b] = [points[i], points[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = Math.min(1, (s - walked) / len);
    out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] });
  }
  return out;
}

/** A band around a barrier between two heights (a painted stripe along the top of hoarding). */
export function addBarrierBand(mb: MeshBuilder, points: Point[], thickness: number, from: number, to: number, color: RGB): number {
  const { left, right } = offsetPolyline(points, thickness / 2);
  if (left.length < 2) return 0;
  const outline = withWinding([...left, ...right.reverse()], true);
  const before = mb.triangleCount;
  addWalls(mb, outline, from, to, color);
  return mb.triangleCount - before;
}

/** Adds one barrier standing on the ground. Returns the number of triangles added. */
export function addBarrier(mb: MeshBuilder, points: Point[], thickness: number, h: number, color: RGB, top: RGB = color): number {
  const { left, right } = offsetPolyline(points, thickness / 2);
  if (left.length < 2) return 0;
  const outline = withWinding([...left, ...right.reverse()], true);
  const before = mb.triangleCount;
  addWalls(mb, outline, 0, h, color);
  addFlatPolygon(mb, [outline], h, top);
  return mb.triangleCount - before;
}
