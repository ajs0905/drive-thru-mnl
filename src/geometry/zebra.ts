/** Zebra crossing footprints and overlap tests (shared by the pipeline and map QA). */
import type { Point } from '../map/types';

export interface ZebraBand {
  c: Point;
  dir: Point;
  half: number;
  w: number;
}

/** The four corners of a zebra band, `margin` short of each road edge, counter-clockwise. */
export function zebraCorners(z: ZebraBand, margin = 0.5): Point[] {
  const n: Point = [-z.dir[1], z.dir[0]];
  const H = z.half - margin;
  const at = (a: number, b: number): Point => [z.c[0] + z.dir[0] * a + n[0] * b, z.c[1] + z.dir[1] * a + n[1] * b];
  return [at(-z.w / 2, -H), at(z.w / 2, -H), at(z.w / 2, H), at(-z.w / 2, H)];
}

/** Separating axis test for two convex polygons. Touching (within `eps` meters) doesn't count. */
export function convexOverlap(a: Point[], b: Point[], eps = 0.05): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const axis: Point = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
      const proj = (pts: Point[]) => pts.map((v) => v[0] * axis[0] + v[1] * axis[1]);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.min(...pa) >= Math.max(...pb) - eps || Math.min(...pb) >= Math.max(...pa) - eps) return false;
    }
  }
  return true;
}
