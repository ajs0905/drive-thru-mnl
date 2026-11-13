/**
 * Road surfaces from centerlines: offset the polyline left and right by half the
 * road width, joining segments with miters (clamped so sharp turns don't spike).
 */
import type { Point } from '../map/types';
import { MeshBuilder, to3, type RGB } from './meshBuilder';

export const MIN_SEGMENT = 0.05; // meters; shorter steps are treated as duplicate points

/** Drops points closer than MIN_SEGMENT to the previous kept point. */
export function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= MIN_SEGMENT) out.push(p);
  }
  return out;
}

/**
 * Returns the left and right edges of a ribbon around the polyline.
 * Left is to the left of the travel direction in map space (x east, y north).
 * The miter is clamped at `miterLimit` x halfWidth, which bevels very sharp turns.
 */
export function offsetPolyline(
  input: Point[],
  halfWidth: number,
  miterLimit = 2,
): { left: Point[]; right: Point[] } {
  const pts = dedupe(input);
  if (pts.length < 2 || !(halfWidth > 0)) return { left: [], right: [] };

  // Left normal of each segment.
  const normals: Point[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    normals.push([-dy / len, dx / len]);
  }

  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    let ox: number;
    let oy: number;
    if (i === 0 || i === pts.length - 1) {
      const n = normals[i === 0 ? 0 : i - 1];
      ox = n[0] * halfWidth;
      oy = n[1] * halfWidth;
    } else {
      const n0 = normals[i - 1];
      const n1 = normals[i];
      let mx = n0[0] + n1[0];
      let my = n0[1] + n1[1];
      const mlen = Math.hypot(mx, my);
      if (mlen < 1e-9) {
        // The road turns back on itself; fall back to the incoming normal.
        mx = n0[0];
        my = n0[1];
      } else {
        mx /= mlen;
        my /= mlen;
      }
      const cos = mx * n0[0] + my * n0[1]; // cos of half the turn angle
      const length = Math.min(halfWidth / Math.max(cos, 1e-9), halfWidth * miterLimit);
      ox = mx * length;
      oy = my * length;
    }
    const [x, y] = pts[i];
    left.push([x + ox, y + oy]);
    right.push([x - ox, y - oy]);
  }
  return { left, right };
}

const UP: [number, number, number] = [0, 1, 0];
const DOWN: [number, number, number] = [0, -1, 0];

/**
 * Drops near-duplicate points like `dedupe`, keeping the matching heights.
 * Returns parallel arrays so ribbons and structures line up.
 */
export function dedupeWithZ(points: Point[], z?: number[]): { pts: Point[]; zs: number[] } {
  const pts: Point[] = [];
  const zs: number[] = [];
  points.forEach((p, i) => {
    const prev = pts[pts.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= MIN_SEGMENT) {
      pts.push(p);
      zs.push(z?.[i] ?? 0);
    }
  });
  return { pts, zs };
}

/**
 * Adds a road ribbon. `y` is a small per-class offset to stop flicker; `z` is the
 * height of each point above the ground (flyovers and ramps). Returns triangles added.
 */
export function addRoadRibbon(mb: MeshBuilder, points: Point[], width: number, y: number, color: RGB, z?: number[]): number {
  const { pts, zs } = dedupeWithZ(points, z);
  const { left, right } = offsetPolyline(pts, width / 2);
  let tris = 0;
  for (let i = 0; i < left.length - 1; i++) {
    const y0 = zs[i] + y;
    const y1 = zs[i + 1] + y;
    const l0 = to3(left[i][0], left[i][1], y0);
    const r0 = to3(right[i][0], right[i][1], y0);
    const l1 = to3(left[i + 1][0], left[i + 1][1], y1);
    const r1 = to3(right[i + 1][0], right[i + 1][1], y1);
    // Counter-clockwise seen from above (three.js +y). Slopes on ramps are gentle,
    // so an up normal is close enough for lighting.
    mb.triangle(r0, r1, l1, UP, color);
    mb.triangle(r0, l1, l0, UP, color);
    tris += 2;
  }
  return tris;
}

/** Flat disc at height y. Fills the wedge-shaped gaps where road pieces meet at an angle. */
export function addDisc(mb: MeshBuilder, [cx, cy]: Point, radius: number, y: number, color: RGB, sides = 8): number {
  if (!(radius > 0)) return 0;
  const c = to3(cx, cy, y);
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    // Counter-clockwise in map space (y north) faces up after the y -> -z flip.
    const p0 = to3(cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius, y);
    const p1 = to3(cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, y);
    mb.triangle(c, p0, p1, UP, color);
  }
  return sides;
}

export interface DeckStyle {
  /** Thickness of the deck below the road surface. */
  depth: number;
  /** Height of the side barriers above the road surface. 0 = none. */
  barrier: number;
  /** Distance between pillars along the road. */
  pillarEvery: number;
  /** Pillar width. */
  pillarSize: number;
  color: RGB;
  underside: RGB;
}

/** Quad from a to b (top edge) down to bottom heights, facing `n`. Wound to match n. */
function wall(mb: MeshBuilder, a: Point, b: Point, topA: number, topB: number, botA: number, botB: number, n: [number, number, number], color: RGB) {
  const a1 = to3(a[0], a[1], topA);
  const b1 = to3(b[0], b[1], topB);
  const a0 = to3(a[0], a[1], botA);
  const b0 = to3(b[0], b[1], botB);
  // Pick the winding that faces n (checked by tests).
  const ux = b0[0] - a0[0], uy = b0[1] - a0[1], uz = b0[2] - a0[2];
  const vx = b1[0] - a0[0], vy = b1[1] - a0[1], vz = b1[2] - a0[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) {
    mb.triangle(a0, b0, b1, n, color);
    mb.triangle(a0, b1, a1, n, color);
  } else {
    mb.triangle(a0, b1, b0, n, color);
    mb.triangle(a0, a1, b1, n, color);
  }
}

/**
 * Concrete structure for a raised road: deck edges, underside, side barriers and
 * pillars. Only drawn where the road is off the ground. Returns triangles added.
 */
export function addDeckStructure(mb: MeshBuilder, points: Point[], width: number, z: number[], style: DeckStyle): number {
  const { pts, zs } = dedupeWithZ(points, z);
  const { left, right } = offsetPolyline(pts, width / 2);
  const start = mb.triangleCount;
  const LIFT = 0.3; // below this the road is basically on the ground

  for (let i = 0; i < left.length - 1; i++) {
    const za = zs[i];
    const zb = zs[i + 1];
    if (Math.max(za, zb) < LIFT) continue;
    const ba = Math.max(0, za - style.depth);
    const bb = Math.max(0, zb - style.depth);
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy) || 1;
    const nl: [number, number, number] = [-dy / len, 0, -dx / len]; // left in map -> three (x, 0, -y)
    const nr: [number, number, number] = [dy / len, 0, dx / len];

    // Deck edges and underside.
    wall(mb, left[i], left[i + 1], za, zb, ba, bb, nl, style.color);
    wall(mb, right[i], right[i + 1], za, zb, ba, bb, nr, style.color);
    if (ba > 0 || bb > 0) {
      const l0 = to3(left[i][0], left[i][1], ba);
      const r0 = to3(right[i][0], right[i][1], ba);
      const l1 = to3(left[i + 1][0], left[i + 1][1], bb);
      const r1 = to3(right[i + 1][0], right[i + 1][1], bb);
      mb.triangle(r0, l1, r1, DOWN, style.underside);
      mb.triangle(r0, l0, l1, DOWN, style.underside);
    }

    // Barriers, both faces, once the road is clearly up in the air.
    if (style.barrier > 0 && Math.min(za, zb) > 1.5) {
      const h = style.barrier;
      const inl: [number, number, number] = [-nl[0], 0, -nl[2]];
      const inr: [number, number, number] = [-nr[0], 0, -nr[2]];
      wall(mb, left[i], left[i + 1], za + h, zb + h, za, zb, nl, style.color);
      wall(mb, left[i], left[i + 1], za + h, zb + h, za, zb, inl, style.color);
      wall(mb, right[i], right[i + 1], za + h, zb + h, za, zb, nr, style.color);
      wall(mb, right[i], right[i + 1], za + h, zb + h, za, zb, inr, style.color);
    }
  }

  // Pillars along the centerline, wherever the deck is high enough to need one.
  let next = style.pillarEvery / 2;
  let d = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    while (next <= d + seg) {
      const t = (next - d) / seg;
      const zc = zs[i] + (zs[i + 1] - zs[i]) * t;
      const top = zc - style.depth;
      if (top > 2) {
        const cx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
        const cy = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
        const s = style.pillarSize / 2;
        const c: Point[] = [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]];
        const normals: [number, number, number][] = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]];
        for (let k = 0; k < 4; k++) wall(mb, c[k], c[(k + 1) % 4], top, top, 0, 0, normals[k], style.color);
      }
      next += style.pillarEvery;
    }
    d += seg;
  }

  return mb.triangleCount - start;
}
