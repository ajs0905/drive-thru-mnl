/**
 * Junction polygons: where roads meet, each road is cut back to where its edges
 * meet its neighbours' edges, and the space in the middle becomes one polygon.
 *
 *        |   |
 *        | B |
 *   -----+   +-----        Each road ("arm") leaves the center point in direction d
 *     A    J    C          with half width h. Going counter-clockwise around the
 *   -----+---+-----        center, the left edge of one arm meets the right edge of
 *                          the next at a corner. The arm is cut back to its corners,
 * and the polygon runs: right cap, left cap, corner, next arm's right cap, ...
 * Corners that don't exist (the outside of a bend, very sharp merges) are replaced
 * by a straight edge between the two cap points.
 */
import type { Point, Ring } from '../map/types';
import { ringArea, signedArea } from './polygon';

export interface Arm {
  /** Unit direction leaving the center. */
  dir: Point;
  /** Half the road width. */
  half: number;
  /** Length of road available on this arm (cuts never go past its far end). */
  len: number;
}

export interface JunctionShape {
  /** Counter-clockwise polygon. */
  ring: Ring;
  /** How far back each arm (in input order) is cut, in meters. */
  cuts: number[];
}

const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const add = (p: Point, d: Point, s: number): Point => [p[0] + d[0] * s, p[1] + d[1] * s];
const leftOf = (d: Point): Point => [-d[1], d[0]];

/** Intersection of p + t·d and q + s·e. Returns [t, s] or null if (nearly) parallel. */
export function lineIntersection(p: Point, d: Point, q: Point, e: Point): [number, number] | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-6) return null;
  const w: Point = [q[0] - p[0], q[1] - p[1]];
  return [cross(w, e) / den, cross(w, d) / den];
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** True if any two non-adjacent edges of the ring cross. */
export function selfIntersects(ring: Ring): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Two arms that just continue each other (same direction, same width) need no junction. */
export function isPlainContinuation(arms: Arm[], maxBendDeg = 8, maxWidthDiff = 0.3): boolean {
  if (arms.length !== 2) return false;
  const [a, b] = arms;
  const dot = a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1]; // -1 = straight through
  const bend = 180 - (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
  return bend <= maxBendDeg && Math.abs(a.half - b.half) * 2 <= maxWidthDiff;
}

/**
 * Builds the junction polygon for arms meeting at `center`.
 * Returns null when no sensible polygon exists (the caller falls back to simple overlap).
 */
export function junctionShape(center: Point, arms: Arm[]): JunctionShape | null {
  if (arms.length < 2) return null;
  const maxHalf = Math.max(...arms.map((a) => a.half));
  const maxCut = 2.5 * maxHalf;

  const order = arms
    .map((a, i) => ({ ...a, i, angle: Math.atan2(a.dir[1], a.dir[0]) }))
    .sort((x, y) => x.angle - y.angle);
  const n = order.length;
  const limit = order.map((a) => Math.min(maxCut, a.len));

  // Corner between arm k's left edge and arm k+1's right edge.
  type Corner = { kind: 'ok'; p: Point; tA: number; tB: number } | { kind: 'diverge' | 'sharp' };
  const corners: Corner[] = order.map((A, k) => {
    const B = order[(k + 1) % n];
    const pA = add(center, leftOf(A.dir), A.half);
    const pB = add(center, leftOf(B.dir), -B.half);
    const hit = lineIntersection(pA, A.dir, pB, B.dir);
    let gap = B.angle - A.angle;
    if (gap <= 0) gap += 2 * Math.PI;
    // Outside of a bend (or straight through): the edges never meet on this side.
    if (gap >= Math.PI - 1e-3) return { kind: 'diverge' };
    const merging = gap < Math.PI / 2;
    if (!hit) return { kind: merging ? 'sharp' : 'diverge' }; // parallel edges
    const [tA, tB] = hit;
    // Corner far down the road: a sharp merge overlaps, a wide angle gets a straight edge.
    if (tA > maxCut || tB > maxCut) return { kind: merging ? 'sharp' : 'diverge' };
    // A wide road meeting a narrow one can put the corner a little behind the center
    // on the wide road; that's fine, but not too far behind.
    if (Math.min(tA, tB) < -maxHalf) return { kind: 'diverge' };
    return { kind: 'ok', p: add(pA, A.dir, tA), tA: Math.max(0, tA), tB: Math.max(0, tB) };
  });

  const cut = order.map((_, k) => {
    const left = corners[k];
    const right = corners[(k + n - 1) % n];
    const fromLeft = left.kind === 'ok' ? left.tA : 0;
    const fromRight = right.kind === 'ok' ? right.tB : 0;
    const c = Math.min(limit[k], Math.max(fromLeft, fromRight));
    // No corner on either side (a straight join with a width change): taper over a
    // short stretch instead of meeting at a single line.
    return c > 0 ? c : Math.min(limit[k], 1 + 2 * (maxHalf - order[k].half));
  });

  // Where two arms overlap in a sharp merge, their inner cap points sit inside each
  // other; skip them so the polygon wraps around both arms instead of zig-zagging.
  const ring: Ring = [];
  order.forEach((A, k) => {
    const left = leftOf(A.dir);
    const base = add(center, A.dir, cut[k]);
    const sharpBefore = corners[(k + n - 1) % n].kind === 'sharp';
    const sharpAfter = corners[k].kind === 'sharp';
    if (!sharpBefore) ring.push(add(base, left, -A.half)); // right cap
    if (!sharpAfter) ring.push(add(base, left, A.half)); // left cap
    const c = corners[k];
    if (c.kind === 'ok') ring.push(c.p);
  });

  // Drop consecutive duplicate points (a corner exactly at a cap point).
  const clean: Ring = ring.filter((p, i) => {
    const q = ring[(i + ring.length - 1) % ring.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-3;
  });
  if (clean.length < 3 || ringArea(clean) < 0.5 || signedArea(clean) <= 0 || selfIntersects(clean)) return null;

  const cuts = new Array<number>(arms.length);
  order.forEach((A, k) => (cuts[A.i] = cut[k]));
  return { ring: clean, cuts };
}
