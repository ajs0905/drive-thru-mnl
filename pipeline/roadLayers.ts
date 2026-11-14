/**
 * Drawing order for roads that overlap. Roads of different classes are drawn at slightly
 * different heights already (the renderer's ROAD_Y), but two of the same class that
 * overlap (parallel carriageways meeting at a median, a ramp and the road it splits from)
 * were drawn in exactly the same plane: the GPU can't tell which is in front, so their
 * lane lines flickered as the camera moved (z-fighting).
 *
 * Here every pair of same-class roads whose surfaces overlap at the same height, away
 * from where they simply meet at a junction, is found, and each road gets a layer so no
 * two overlapping roads share one (greedy graph coloring). The renderer lifts each layer
 * by a few millimeters: invisible, but enough to decide which is on top.
 */
import { distanceToSegment } from '../src/geometry/polygon';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import type { Point, Road } from '../src/map/types';

export const LAYERS = {
  /** Most layers handed out (the renderer lifts each by a few mm; they must stay under crossings). */
  max: 8,
  /** Surfaces overlapping by less than this (m) are just touching. */
  slack: 0.1,
  /** Sampling step along each road (m). */
  step: 2,
} as const;

const keyOf = (p: Point) => `${p[0]},${p[1]}`;

/**
 * Which roads overlap which (by index): same class, surfaces overlapping at the same
 * height, away from where the two simply meet.
 */
export function overlapGraph(roads: Road[]): Set<number>[] {
  const grid = new SegmentGrid<[number, number]>(30);
  roads.forEach((r, ri) => {
    for (let i = 0; i < r.points.length - 1; i++) grid.insert(r.points[i], r.points[i + 1], [ri, i]);
  });
  const zAt = (r: Road, i: number, t: number) => (r.z ? r.z[i] + (r.z[i + 1] - r.z[i]) * t : 0);
  const ends = roads.map((r) => new Set(r.points.map(keyOf)));

  // Overlap graph.
  const edges = roads.map(() => new Set<number>());
  roads.forEach((a, ai) => {
    for (let i = 0; i < a.points.length - 1; i++) {
      const [p0, p1] = [a.points[i], a.points[i + 1]];
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      for (let s = 0; s <= len; s += LAYERS.step) {
        const t = len ? s / len : 0;
        const p: Point = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
        const za = zAt(a, i, t);
        const reach = a.w / 2 + 12;
        for (const e of grid.query([p[0] - reach, p[1] - reach], [p[0] + reach, p[1] + reach])) {
          const [bi, j] = e.item;
          if (bi === ai || edges[ai].has(bi)) continue;
          const b = roads[bi];
          if (b.cls !== a.cls) continue;
          const d = distanceToSegment(p, e.a, e.b);
          if (d >= (a.w + b.w) / 2 - LAYERS.slack) continue;
          const segLen = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) || 1;
          const u = Math.max(0, Math.min(1, ((p[0] - e.a[0]) * (e.b[0] - e.a[0]) + (p[1] - e.a[1]) * (e.b[1] - e.a[1])) / (segLen * segLen)));
          if (Math.abs(zAt(b, j, u) - za) > 0.05) continue;
          // Not where they just meet: near a point the two share.
          const shared = [...ends[ai]].filter((k) => ends[bi].has(k));
          const nearShared = shared.some((k) => {
            const [x, y] = k.split(',').map(Number);
            return Math.hypot(p[0] - x, p[1] - y) < Math.max(a.w, b.w);
          });
          if (nearShared) continue;
          edges[ai].add(bi);
          edges[bi].add(ai);
        }
      }
    }
  });
  return edges;
}

export function layerRoads(roads: Road[]): { roads: Road[]; stats: { overlapping: number; lifted: number; layers: number } } {
  const edges = overlapGraph(roads);

  // Greedy coloring, most-connected first (ties by id, so the result is stable).
  const order = roads.map((_, i) => i).filter((i) => edges[i].size > 0);
  order.sort((x, y) => edges[y].size - edges[x].size || (roads[x].id < roads[y].id ? -1 : 1));
  const layer = new Map<number, number>();
  for (const i of order) {
    const used = new Set([...edges[i]].map((j) => layer.get(j)).filter((l) => l !== undefined));
    let l = 0;
    while (used.has(l) && l < LAYERS.max - 1) l++;
    layer.set(i, l);
  }

  const out = roads.map((r, i): Road => {
    const { lift: _old, ...rest } = r;
    const l = layer.get(i) ?? 0;
    return l > 0 ? { ...rest, lift: l } : rest;
  });
  return {
    roads: out,
    stats: { overlapping: order.length, lifted: out.filter((r) => r.lift).length, layers: Math.max(0, ...layer.values()) + (order.length ? 1 : 0) },
  };
}
