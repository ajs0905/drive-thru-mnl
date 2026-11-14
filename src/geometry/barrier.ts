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
export const BARRIER_THICKNESS: Record<BarrierKind, number> = { wall: 0.25, fence: 0.08, hedge: 0.9, rail: 0.4 };

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
