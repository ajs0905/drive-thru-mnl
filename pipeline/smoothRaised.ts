/**
 * Rounds the curves of flyovers and ramps. OSM draws curves as a few straight pieces; on
 * a 7 m deck with concrete edges, a corner of 25 to 40 degrees reads as a faceted, cut
 * shape (a U-turn loop looked like an octagon). Extra points are put in along a
 * Catmull-Rom spline through the existing ones until no corner turns more than
 * `maxTurn` degrees. Existing points stay where they are, so the joints with other roads
 * don't move; heights are interpolated along each piece. Footbridges keep their corners
 * (landings and stairs really are square).
 */
import type { Point, Road } from '../src/map/types';

export const SMOOTH = {
  /** Most a raised road may turn at one point after smoothing (degrees). */
  maxTurn: 6,
  /** Most points put into one piece, and the shortest piece left (m). */
  maxSplit: 12,
  minPiece: 1,
} as const;

const turnAt = (a: Point, b: Point, c: Point) => {
  const t = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
  return Math.abs((Math.atan2(Math.sin(t), Math.cos(t)) * 180) / Math.PI);
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Centripetal Catmull-Rom between p1 and p2 at t in 0..1. */
function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const knot = (a: Point, b: Point) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const [t0, t1] = [0, knot(p0, p1)];
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a: Point, b: Point, ta: number, tb: number): Point => {
    const k = (u - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

export function smoothRaisedCurves(roads: Road[]): { roads: Road[]; smoothed: number; added: number } {
  let smoothed = 0;
  let added = 0;
  const out = roads.map((r) => {
    if (!r.z || r.cls === 'path' || Math.max(...r.z) < 1 || r.points.length < 3) return r;
    const pts = r.points;
    const z = r.z;
    // Phantom ends: straight on past the first and last points.
    const at = (i: number): Point =>
      i < 0 ? [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]] : i >= pts.length ? [2 * pts[pts.length - 1][0] - pts[pts.length - 2][0], 2 * pts[pts.length - 1][1] - pts[pts.length - 2][1]] : pts[i];
    const points: Point[] = [pts[0]];
    const zs: number[] = [z[0]];
    let any = false;
    for (let i = 0; i < pts.length - 1; i++) {
      const turn = Math.max(i > 0 ? turnAt(pts[i - 1], pts[i], pts[i + 1]) : 0, i + 2 < pts.length ? turnAt(pts[i], pts[i + 1], pts[i + 2]) : 0);
      const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      // 1.5 times as many pieces as the turn needs on average: the spline bends more near the old corners.
      const n = Math.min(SMOOTH.maxSplit, Math.floor(len / SMOOTH.minPiece), Math.ceil((1.5 * turn) / SMOOTH.maxTurn));
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const p = catmullRom(at(i - 1), pts[i], pts[i + 1], at(i + 2), t);
        points.push([round2(p[0]), round2(p[1])]);
        zs.push(round2(z[i] + (z[i + 1] - z[i]) * t));
        added++;
        any = true;
      }
      points.push(pts[i + 1]);
      zs.push(z[i + 1]);
    }
    if (!any) return r;
    smoothed++;
    return { ...r, points, z: zs };
  });
  return { roads: out, smoothed, added };
}
