/**
 * The road network as a directed graph, built from the map data when it loads (no change
 * to the map file: about 2,300 drivable roads become about 1,900 nodes and 3,600 directed
 * edges in a few milliseconds).
 *
 * - Nodes are road ends. Roads are split where they meet, so the ends of meeting roads
 *   are the same point; ends at different heights (a ramp's foot and a deck above it) are
 *   different nodes.
 * - Each drivable road inside the playable area is one edge, or two (one per direction,
 *   "twins") if it's two-way. Roads poking out past the edge are left out (it's a wall), and
 *   so are roads closed by bollards or blocks across them (closures.ts).
 *   An edge keeps its polyline in the direction of travel, its cumulative lengths, its
 *   heights, its lanes that way and its travel time at the class's free-flow speed.
 * - Strongly connected components (Tarjan) mark the main network: from any edge in it
 *   you can reach any other and come back. Roads cut off by the playable edge (one-way
 *   stubs) fall outside it; routes and traffic stay inside it.
 */
import { distanceToRing, pointInRing } from '../geometry/polygon';
import { SegmentGrid } from '../geometry/spatialGrid';
import { closedRoads } from './closures';
import { laneCount } from '../map/roads';
import type { MapData, Point, Road } from '../map/types';

export type GraphClass = 'major' | 'minor' | 'service';

/** Free-flow speeds (m/s) by class: what travel times and the routes' estimates assume. */
export const SPEEDS: Record<GraphClass, number> = { major: 50 / 3.6, minor: 40 / 3.6, service: 25 / 3.6 };
/** The fastest of them: dividing a straight-line distance by it never overestimates a travel time. */
export const MAX_SPEED = Math.max(...Object.values(SPEEDS));

export interface GraphEdge {
  /** Index into map.roads, and whether it runs along the road's points (or against them). */
  road: number;
  forward: boolean;
  from: number;
  to: number;
  /** Polyline in the direction of travel, cumulative lengths along it (m), and heights above the ground (m). */
  points: Point[];
  acc: number[];
  z: number[];
  length: number;
  /** Seconds at the free-flow speed. */
  time: number;
  /** The edge the other way along the same road, or -1 (one-way). */
  twin: number;
  cls: GraphClass;
  /** Road width (m) and lanes in this direction. */
  w: number;
  lanes: number;
  oneway: boolean;
  /** In the main strongly connected component. */
  main: boolean;
}

export interface RoadGraph {
  nodes: Point[];
  /** Height of each node above the ground (m). */
  nodeZ: number[];
  edges: GraphEdge[];
  /** Edge ids leaving and arriving at each node. */
  out: number[][];
  inc: number[][];
  /** Every segment of every edge (the forward one of a pair), for snapping a point to the network. */
  grid: SegmentGrid<{ edge: number; i: number }>;
}

/** Roads the graph takes: drivable (no footpaths), not scenery, and (given the playable area) inside it all the way. */
export function graphRoad(r: Road, playable?: Point[]): boolean {
  if (r.cls === 'path' || r.scenery || r.points.length < 2) return false;
  if (!playable || playable.length < 3) return true;
  // A road poking out past the edge (a ramp the edge cuts across) can't be driven: the edge is a wall.
  return r.points.every((p) => pointInRing(p, playable) || distanceToRing(p, playable) < 1);
}

export function buildRoadGraph(map: Pick<MapData, 'roads'> & Partial<Pick<MapData, 'playable' | 'fixtures'>>): RoadGraph {
  const nodes: Point[] = [];
  const nodeZ: number[] = [];
  const ids = new Map<string, number>();
  const node = (p: Point, z: number) => {
    const key = `${p[0].toFixed(2)},${p[1].toFixed(2)},${Math.round(z)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = nodes.length;
      ids.set(key, id);
      nodes.push(p);
      nodeZ.push(z);
    }
    return id;
  };
  const edges: GraphEdge[] = [];
  const closed = closedRoads(map.roads, map.fixtures ?? []);
  map.roads.forEach((r, ri) => {
    if (!graphRoad(r, map.playable) || closed.has(ri)) return;
    const z = r.points.map((_, i) => r.z?.[i] ?? 0);
    const acc = [0];
    for (let i = 1; i < r.points.length; i++) acc.push(acc[i - 1] + Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1]));
    const length = acc[acc.length - 1];
    if (length < 0.5) return;
    const cls = r.cls as GraphClass;
    const [a, b] = [node(r.points[0], z[0]), node(r.points[r.points.length - 1], z[z.length - 1])];
    const total = laneCount(r);
    const lanes = r.oneway ? total : Math.max(1, Math.floor(total / 2));
    const base = { road: ri, length, time: length / SPEEDS[cls], cls, w: r.w, lanes, oneway: !!r.oneway, main: false };
    const fwd = edges.length;
    edges.push({ ...base, forward: true, from: a, to: b, points: r.points, acc, z, twin: -1 });
    if (!r.oneway) {
      edges.push({ ...base, forward: false, from: b, to: a, points: [...r.points].reverse(), acc: acc.map((s) => length - s).reverse(), z: [...z].reverse(), twin: fwd });
      edges[fwd].twin = fwd + 1;
    }
  });
  const out: number[][] = nodes.map(() => []);
  const inc: number[][] = nodes.map(() => []);
  edges.forEach((e, i) => {
    out[e.from].push(i);
    inc[e.to].push(i);
  });
  const grid = new SegmentGrid<{ edge: number; i: number }>(40);
  edges.forEach((e, ei) => {
    if (!e.forward) return;
    for (let i = 0; i + 1 < e.points.length; i++) grid.insert(e.points[i], e.points[i + 1], { edge: ei, i });
  });
  const graph = { nodes, nodeZ, edges, out, inc, grid };
  const comp = stronglyConnected(graph);
  const sizes = new Map<number, number>();
  for (const c of comp) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  let main = -1;
  for (const [c, n] of sizes) if (main < 0 || n > sizes.get(main)!) main = c;
  // An edge is in the main network when both its ends are.
  for (const e of edges) e.main = comp[e.from] === main && comp[e.to] === main;
  return graph;
}

/** Strongly connected component of each node (Tarjan's algorithm, iterative so deep graphs can't overflow the stack). O(V + E). */
export function stronglyConnected(g: Pick<RoadGraph, 'nodes' | 'out' | 'edges'>): Int32Array {
  const n = g.nodes.length;
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const comp = new Int32Array(n).fill(-1);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  let counter = 0;
  let comps = 0;
  for (let root = 0; root < n; root++) {
    if (index[root] >= 0) continue;
    // Each frame: the node and how many of its out-edges have been looked at.
    const work: [number, number][] = [[root, 0]];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = 1;
    while (work.length) {
      const top = work[work.length - 1];
      const [v, k] = top;
      const outs = g.out[v];
      if (k < outs.length) {
        top[1]++;
        const w = g.edges[outs[k]].to;
        if (index[w] < 0) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          work.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low[parent] = Math.min(low[parent], low[v]);
      }
      if (low[v] === index[v]) {
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = 0;
          comp[w] = comps;
        } while (w !== v);
        comps++;
      }
    }
  }
  return comp;
}

/** A place on the network: `s` meters along edge `edge`. */
export interface Anchor {
  edge: number;
  s: number;
}

/** Where an anchor is (map space), the edge's heading there (radians) and its height (m). */
export function anchorPose(g: RoadGraph, a: Anchor): { p: Point; heading: number; z: number } {
  const e = g.edges[a.edge];
  const s = Math.max(0, Math.min(e.length, a.s));
  let i = 0;
  while (i < e.points.length - 2 && e.acc[i + 1] < s) i++;
  const [p, q] = [e.points[i], e.points[i + 1]];
  const t = Math.max(0, Math.min(1, (s - e.acc[i]) / (e.acc[i + 1] - e.acc[i] || 1)));
  return { p: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], heading: Math.atan2(q[1] - p[1], q[0] - p[0]), z: e.z[i] + (e.z[i + 1] - e.z[i]) * t };
}

/**
 * The anchor nearest `p` (map space), at height `z` above the ground (a height difference
 * counts three times, so a car under a flyover snaps to the road it's on, not the deck).
 * With a heading, two-way roads give the direction closest to it. Only main-network edges
 * unless `any`. Null if nothing within `reach` meters.
 */
export function snap(g: RoadGraph, p: Point, opts: { heading?: number; z?: number; reach?: number; any?: boolean } = {}): (Anchor & { d: number }) | null {
  const reach = opts.reach ?? 60;
  let best: (Anchor & { d: number }) | null = null;
  for (const { item } of g.grid.query([p[0] - reach, p[1] - reach], [p[0] + reach, p[1] + reach])) {
    let e = g.edges[item.edge];
    let ei = item.edge;
    const [a, b] = [e.points[item.i], e.points[item.i + 1]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    const z = e.z[item.i] + (e.z[item.i + 1] - e.z[item.i]) * t;
    const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t, ((opts.z ?? z) - z) * 3);
    if (d > reach || (best && d >= best.d)) continue;
    let s = e.acc[item.i] + t * Math.sqrt(l2);
    // The way along the road closest to the heading.
    if (opts.heading !== undefined && e.twin >= 0 && Math.cos(Math.atan2(dy, dx) - opts.heading) < 0) {
      ei = e.twin;
      s = e.length - s;
      e = g.edges[ei];
    }
    if (!opts.any && !e.main) continue;
    best = { edge: ei, s, d };
  }
  return best;
}
