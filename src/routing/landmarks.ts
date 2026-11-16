/**
 * ALT: A*, Landmarks and the Triangle inequality (Goldberg and Harrelson, 2005).
 *
 * A few landmark nodes are picked far apart, around the edge of the network, and the
 * travel time from every node to each landmark and back is computed once (two Dijkstras
 * per landmark). For any nodes v and t and a landmark L, the triangle inequality gives
 *
 *   d(v, t) >= d(L, t) - d(L, v)    and    d(v, t) >= d(v, L) - d(t, L)
 *
 * so the largest of these over the landmarks is a lower bound on the time from v to t:
 * a heuristic A* can use without losing optimality. It's much tighter than the
 * straight-line one when roads wind, one-ways force detours or the fast roads go around,
 * because it knows the real network.
 *
 * Landmarks are picked by "farthest": each next one is the node whose nearest landmark
 * is farthest away (by travel time), starting from the node farthest from an arbitrary
 * one. Precompute O(k (V + E) log V), memory 2kV numbers (8 landmarks on BGC: about
 * 120 KB as Float32), and each heuristic call is O(k).
 */
import { euclidean, timesFrom, type Heuristic } from './search';
import type { Anchor, RoadGraph } from './graph';

const ROUNDING = 1e-3;

export interface Landmarks {
  nodes: number[];
  /** Per landmark: time from it to each node, and from each node to it (s; Infinity if unreachable). */
  from: Float32Array[];
  to: Float32Array[];
}

export function buildLandmarks(graph: RoadGraph, k = 8): Landmarks {
  const main = new Uint8Array(graph.nodes.length);
  for (const e of graph.edges) if (e.main) main[e.from] = main[e.to] = 1;
  const candidates = [...main.keys()].filter((v) => main[v]);
  const out: Landmarks = { nodes: [], from: [], to: [] };
  if (!candidates.length) return out;
  // Nearest-landmark time of each node, by either direction.
  const nearest = new Float64Array(graph.nodes.length).fill(Infinity);
  let next = farthest(timesFrom(graph, candidates[0]), candidates);
  for (let i = 0; i < Math.min(k, candidates.length); i++) {
    const from = timesFrom(graph, next);
    const to = timesFrom(graph, next, true);
    out.nodes.push(next);
    out.from.push(Float32Array.from(from));
    out.to.push(Float32Array.from(to));
    for (const v of candidates) nearest[v] = Math.min(nearest[v], from[v], to[v]);
    next = farthest(nearest, candidates);
  }
  return out;
}

/** The candidate with the largest finite value. */
function farthest(times: ArrayLike<number>, candidates: number[]): number {
  let best = candidates[0];
  for (const v of candidates) if (Number.isFinite(times[v]) && (!Number.isFinite(times[best]) || times[v] > times[best])) best = v;
  return best;
}

/** The ALT heuristic toward an anchor's edge start, never below the straight-line bound. */
export function altHeuristic(graph: RoadGraph, lm: Landmarks, to: Anchor): Heuristic {
  const t = graph.edges[to.edge].from;
  const straight = euclidean(graph, to);
  const k = lm.nodes.length;
  const fromT = lm.from.map((a) => a[t]);
  const toT = lm.to.map((a) => a[t]);
  return (v) => {
    let h = straight(v);
    for (let i = 0; i < k; i++) {
      // Less a hair for the Float32 rounding, so the bound can't come out over the real time.
      const a = fromT[i] - lm.from[i][v] - ROUNDING;
      const b = lm.to[i][v] - toT[i] - ROUNDING;
      // A landmark that can't reach (or be reached from) one of them says nothing.
      if (Number.isFinite(a) && a > h) h = a;
      if (Number.isFinite(b) && b > h) h = b;
    }
    return h;
  };
}
