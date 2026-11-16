/**
 * 2D polygon helpers in map space (x east, y north, meters).
 * Rings are open: the first point is not repeated at the end.
 */
import type { Point, Ring } from '../map/types';

/**
 * Shoelace formula. Positive = counter-clockwise (in a y-up / north-up frame),
 * negative = clockwise, ~0 = degenerate.
 */
export function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum / 2;
}

export function ringArea(ring: Ring): number {
  return Math.abs(signedArea(ring));
}

export function isCCW(ring: Ring): boolean {
  return signedArea(ring) > 0;
}

/** Returns the ring in the requested winding, reversing a copy if needed. */
export function withWinding(ring: Ring, ccw: boolean): Ring {
  return isCCW(ring) === ccw ? ring : [...ring].reverse();
}

/** Area of the outer ring minus its holes. */
export function polygonArea(rings: Ring[]): number {
  if (rings.length === 0) return 0;
  return rings.slice(1).reduce((a, hole) => a - ringArea(hole), ringArea(rings[0]));
}

/** Average of the vertices. Good enough to decide which zone a building is in. */
export function vertexCentroid(ring: Ring): Point {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

/** Even-odd ray casting. Points exactly on an edge may go either way. */
export function pointInRing([x, y]: Point, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distanceToSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Shortest distance between segments ab and cd (0 if they cross). */
export function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b));
}

/** Distance from a segment to the nearest edge of a ring (0 if it crosses an edge). */
export function segmentDistanceToRing(a: Point, b: Point, ring: Ring): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    best = Math.min(best, segmentDistance(a, b, ring[j], ring[i]));
    if (best === 0) break;
  }
  return best;
}

/** Distance from a point to the nearest edge of a closed ring. */
export function distanceToRing(p: Point, ring: Ring): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    best = Math.min(best, distanceToSegment(p, ring[j], ring[i]));
  }
  return best;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function ringBounds(ring: Ring): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Sutherland-Hodgman clip of a ring against a half-plane: keeps the part where
 * (p - origin) . normal >= offset (`normal` a unit vector).
 */
export function clipRingToHalfPlane(ring: Ring, origin: Point, normal: Point, offset: number): Ring {
  const side = (p: Point) => (p[0] - origin[0]) * normal[0] + (p[1] - origin[1]) * normal[1] - offset;
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    const [sa, sb] = [side(a), side(b)];
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/**
 * Sutherland-Hodgman clip of a ring against an axis-aligned rectangle.
 * Works for any (even concave) subject polygon because the clip shape is convex.
 * Returns [] if nothing is left.
 */
export function clipRingToRect(ring: Ring, r: Rect): Ring {
  type Edge = { inside: (p: Point) => boolean; cut: (a: Point, b: Point) => Point };
  const lerpX = (a: Point, b: Point, x: number): Point => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const lerpY = (a: Point, b: Point, y: number): Point => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];
  const edges: Edge[] = [
    { inside: (p) => p[0] >= r.minX, cut: (a, b) => lerpX(a, b, r.minX) },
    { inside: (p) => p[0] <= r.maxX, cut: (a, b) => lerpX(a, b, r.maxX) },
    { inside: (p) => p[1] >= r.minY, cut: (a, b) => lerpY(a, b, r.minY) },
    { inside: (p) => p[1] <= r.maxY, cut: (a, b) => lerpY(a, b, r.maxY) },
  ];

  let out: Ring = ring;
  for (const edge of edges) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = edge.inside(cur);
      const prevIn = edge.inside(prev);
      if (curIn) {
        if (!prevIn) out.push(edge.cut(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(edge.cut(prev, cur));
      }
    }
  }
  return out.length >= 3 ? out : [];
}

/**
 * Liang-Barsky clip of segment ab to a rectangle. Returns the visible part, or null.
 */
export function clipSegmentToRect(a: Point, b: Point, r: Rect): [Point, Point] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a[0] - r.minX],
    [dx, r.maxX - a[0]],
    [-dy, a[1] - r.minY],
    [dy, r.maxY - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  const at = (t: number): Point => [a[0] + t * dx, a[1] + t * dy];
  return [t0 === 0 ? a : at(t0), t1 === 1 ? b : at(t1)];
}

/** Clips a polyline to a rectangle. A line that leaves and re-enters becomes several pieces. */
export function clipPolylineToRect(points: Point[], r: Rect): Point[][] {
  const out: Point[][] = [];
  let cur: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const seg = clipSegmentToRect(points[i], points[i + 1], r);
    if (!seg) {
      if (cur.length >= 2) out.push(cur);
      cur = [];
      continue;
    }
    const last = cur[cur.length - 1];
    if (last && (last[0] !== seg[0][0] || last[1] !== seg[0][1])) {
      if (cur.length >= 2) out.push(cur);
      cur = [];
    }
    if (cur.length === 0) cur.push(seg[0]);
    cur.push(seg[1]);
    // The segment was cut at its far end: the line leaves the box here.
    if (seg[1] !== points[i + 1]) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) out.push(cur);
  return out.filter((l) => l.length >= 2);
}

/**
 * Convex hull (Andrew's monotone chain), counter-clockwise, without collinear points.
 * O(n log n).
 */
export function convexHull(points: Point[]): Ring {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/**
 * Ramer-Douglas-Peucker: drops the points of a polyline that lie within `tolerance` (m) of
 * the line through their neighbors, keeping the ends. Turns a traced staircase outline
 * into a few straight runs.
 */
export function simplifyPolyline(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let [far, at] = [-1, -1];
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(points[i], points[a], points[b]);
      if (d > far) [far, at] = [d, i];
    }
    if (far > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** simplifyPolyline for a closed ring (no repeated first point): split at the point farthest from the first, simplified as two halves. */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 3) return ring.slice();
  let far = 0;
  for (let i = 1; i < ring.length; i++) if (Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]) > Math.hypot(ring[far][0] - ring[0][0], ring[far][1] - ring[0][1])) far = i;
  const a = simplifyPolyline(ring.slice(0, far + 1), tolerance);
  const b = simplifyPolyline([...ring.slice(far), ring[0]], tolerance);
  return [...a, ...b.slice(1, -1)];
}
