/**
 * Road surfaces from centerlines: offset the polyline left and right by half the
 * road width, joining segments with miters (clamped so sharp turns don't spike).
 */
import type { Point } from '../map/types';
import { MeshBuilder, to3, type RGB, type Vec4 } from './meshBuilder';

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
 * Road marking styles, packed into one float per vertex for the road shader
 * (src/scene/roadMaterial.ts): mode + 4·oneway + 8·rank + 32·lanes.
 */
export const MARK = { plain: 0, lanes: 1, zebra: 2, sidewalk: 3 } as const;
export type MarkMode = (typeof MARK)[keyof typeof MARK];

export function markCode(mode: MarkMode, o: { lanes?: number; oneway?: boolean; rank?: number } = {}): number {
  const lanes = Math.max(1, Math.min(7, Math.round(o.lanes ?? 1)));
  const rank = Math.max(0, Math.min(3, o.rank ?? 0));
  return mode + 4 * (o.oneway ? 1 : 0) + 8 * rank + 32 * lanes;
}

export function decodeMark(code: number): { mode: number; oneway: boolean; rank: number; lanes: number } {
  return { mode: code % 4, oneway: Math.floor(code / 4) % 2 === 1, rank: Math.floor(code / 8) % 4, lanes: Math.floor(code / 32) };
}

/**
 * Cuts `start` meters off the beginning and `end` meters off the end of a polyline,
 * interpolating heights. Returns null when nothing is left. `u0` is where the kept
 * piece starts, measured along the original line (keeps dashes in step).
 */
export function trimPolyline(
  points: Point[],
  z: number[],
  start: number,
  end: number,
): { pts: Point[]; zs: number[]; u0: number } | null {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  const a = Math.max(0, start);
  const b = total - Math.max(0, end);
  if (b - a < MIN_SEGMENT) return null;

  const at = (d: number): { p: Point; z: number } => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = Math.max(0, Math.min(1, (d - cum[i - 1]) / seg));
    const [p0, p1] = [points[i - 1], points[i]];
    return { p: [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t], z: z[i - 1] + (z[i] - z[i - 1]) * t };
  };
  const s = at(a);
  const e = at(b);
  const pts: Point[] = [s.p];
  const zs = [s.z];
  for (let i = 0; i < points.length; i++) {
    if (cum[i] > a && cum[i] < b) {
      pts.push(points[i]);
      zs.push(z[i]);
    }
  }
  pts.push(e.p);
  zs.push(e.z);
  return { pts, zs, u0: a };
}

/**
 * The stretches of a road cut back for junctions (`trim`), as separate polylines.
 * Drawn as plain asphalt under the junction polygons so nothing shows through when
 * a polygon doesn't follow the road exactly (curves, merges).
 */
export function cutBackPieces(points: Point[], z: number[] | undefined, trim: [number, number] | undefined): { pts: Point[]; zs: number[] }[] {
  if (!trim) return [];
  const { pts, zs } = dedupeWithZ(points, z);
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const out: { pts: Point[]; zs: number[] }[] = [];
  const [start, end] = [Math.min(trim[0], total), Math.min(trim[1], total)];
  if (start > 0) {
    const piece = trimPolyline(pts, zs, 0, total - start);
    if (piece) out.push(piece);
  }
  if (end > 0 && start < total) {
    const piece = trimPolyline(pts, zs, Math.max(0, total - end), 0);
    if (piece) out.push(piece);
  }
  return out;
}

export interface RibbonOptions {
  /** Height of each point above the ground (flyovers and ramps). */
  z?: number[];
  /** Meters to leave out at the start and end (junction polygons cover them). */
  trim?: [number, number];
  /** Marking style from markCode(); needs a MeshBuilder with aux. */
  mark?: number;
}

/**
 * Adds a road ribbon. `y` is a small per-class offset to stop flicker.
 * Each vertex carries [u along, v across (left +), half width, mark] for the road shader.
 * Returns triangles added.
 */
export function addRoadRibbon(mb: MeshBuilder, points: Point[], width: number, y: number, color: RGB, o: RibbonOptions = {}): number {
  let { pts, zs } = dedupeWithZ(points, o.z);
  let u0 = 0;
  if (o.trim && (o.trim[0] > 0 || o.trim[1] > 0)) {
    const t = trimPolyline(pts, zs, o.trim[0], o.trim[1]);
    if (!t) return 0;
    ({ pts, zs, u0 } = t);
    ({ pts, zs } = dedupeWithZ(pts, zs));
  }
  const half = width / 2;
  const { left, right } = offsetPolyline(pts, half);
  const mark = o.mark ?? 0;
  let tris = 0;
  let u = u0;
  for (let i = 0; i < left.length - 1; i++) {
    const y0 = zs[i] + y;
    const y1 = zs[i + 1] + y;
    const u1 = u + Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const l0 = to3(left[i][0], left[i][1], y0);
    const r0 = to3(right[i][0], right[i][1], y0);
    const l1 = to3(left[i + 1][0], left[i + 1][1], y1);
    const r1 = to3(right[i + 1][0], right[i + 1][1], y1);
    const al0: Vec4 = [u, half, half, mark];
    const ar0: Vec4 = [u, -half, half, mark];
    const al1: Vec4 = [u1, half, half, mark];
    const ar1: Vec4 = [u1, -half, half, mark];
    // Counter-clockwise seen from above (three.js +y). Slopes on ramps are gentle,
    // so an up normal is close enough for lighting.
    mb.triangle(r0, r1, l1, UP, color, [ar0, ar1, al1]);
    mb.triangle(r0, l1, l0, UP, color, [ar0, al1, al0]);
    tris += 2;
    u = u1;
  }
  return tris;
}

/**
 * A zebra crossing: a flat band `w` wide along the road at `c`, spanning the road
 * across (stopping `margin` short of each edge). Aux u runs across the road, so the
 * shader's stripes alternate across it and each bar lies along the road.
 */
export function addZebra(mb: MeshBuilder, c: Point, dir: Point, half: number, w: number, y: number, color: RGB, margin = 0.5): number {
  const H = half - margin;
  if (!(H > 0.5) || !(w > 0)) return 0;
  const n: Point = [-dir[1], dir[0]];
  const at = (along: number, across: number) => to3(c[0] + dir[0] * along + n[0] * across, c[1] + dir[1] * along + n[1] * across, y);
  const mark = MARK.zebra;
  const h = w / 2 + 0.25; // the shader trims 0.25 off each end of the bars
  const ax = (along: number, across: number): Vec4 => [across, along, h, mark];
  const [p0, p1, p2, p3] = [at(-w / 2, -H), at(w / 2, -H), at(w / 2, H), at(-w / 2, H)];
  const [a0, a1, a2, a3] = [ax(-w / 2, -H), ax(w / 2, -H), ax(w / 2, H), ax(-w / 2, H)];
  mb.triangle(p0, p1, p2, UP, color, [a0, a1, a2]);
  mb.triangle(p0, p2, p3, UP, color, [a0, a2, a3]);
  return 2;
}

/**
 * Sidewalk band along one side of a road, from the road edge (the curb) outwards.
 * Its aux v runs from 0 at the curb to `width` at the outer edge.
 */
export function addSidewalk(mb: MeshBuilder, points: Point[], roadWidth: number, width: number, side: 'left' | 'right', y: number, color: RGB): number {
  const pts = dedupe(points);
  const inner = offsetPolyline(pts, roadWidth / 2);
  const outer = offsetPolyline(pts, roadWidth / 2 + width);
  if (inner.left.length < 2) return 0;
  const mark = MARK.sidewalk;
  const [inEdge, outEdge] = side === 'left' ? [inner.left, outer.left] : [inner.right, outer.right];
  let u = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const u1 = u + Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const i0 = to3(inEdge[i][0], inEdge[i][1], y);
    const i1 = to3(inEdge[i + 1][0], inEdge[i + 1][1], y);
    const o0 = to3(outEdge[i][0], outEdge[i][1], y);
    const o1 = to3(outEdge[i + 1][0], outEdge[i + 1][1], y);
    const ai0: Vec4 = [u, 0, width, mark];
    const ai1: Vec4 = [u1, 0, width, mark];
    const ao0: Vec4 = [u, width, width, mark];
    const ao1: Vec4 = [u1, width, width, mark];
    if (side === 'left') {
      mb.triangle(i0, i1, o1, UP, color, [ai0, ai1, ao1]);
      mb.triangle(i0, o1, o0, UP, color, [ai0, ao1, ao0]);
    } else {
      mb.triangle(o0, o1, i1, UP, color, [ao0, ao1, ai1]);
      mb.triangle(o0, i1, i0, UP, color, [ao0, ai1, ai0]);
    }
    u = u1;
  }
  return (pts.length - 1) * 2;
}

/**
 * Flat disc at height y. Fills the wedge-shaped gaps where road pieces meet at an angle.
 * `aux` gives the shader data for a point, so markings run on across the disc.
 */
export function addDisc(mb: MeshBuilder, [cx, cy]: Point, radius: number, y: number, color: RGB, sides = 8, aux?: (p: Point) => Vec4): number {
  if (!(radius > 0)) return 0;
  const c = to3(cx, cy, y);
  const zero: Vec4 = [0, 0, 0, 0];
  const ac = aux ? aux([cx, cy]) : zero;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const q0: Point = [cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius];
    const q1: Point = [cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius];
    // Counter-clockwise in map space (y north) faces up after the y -> -z flip.
    const p0 = to3(q0[0], q0[1], y);
    const p1 = to3(q1[0], q1[1], y);
    mb.triangle(c, p0, p1, UP, color, [ac, aux ? aux(q0) : zero, aux ? aux(q1) : zero]);
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
  const LIFT = 1; // below this a ramp's side walls would just look like lines painted on the road

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
