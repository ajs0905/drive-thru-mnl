/**
 * Shortest routes on the road graph by travel time: Dijkstra, A* and ALT (A* with
 * landmark lower bounds, landmarks.ts), all one search with a different heuristic.
 *
 * The search runs over edges, not nodes: a state is "just drove the whole of edge e", so a
 * turn can cost something on its own (a U-turn onto the same road's other direction costs
 * `UTURN` seconds: allowed, for dead ends and a car facing the wrong way, but never picked
 * when another way is close). Start and goal are anchors part way along edges: the start
 * state is the rest of the car's edge (or, turning around, the rest of its twin), and the
 * goal is reached by entering the goal's edge and driving `s` meters along it.
 *
 * With a heuristic that never overestimates (straight-line distance at the top speed, or
 * the landmark bounds) the first goal popped is optimal, so all three give the same
 * cost; they differ in how many states they expand. Time O((E + V) log E), space O(E).
 */
import { MinHeap } from './heap';
import { MAX_SPEED, SPEEDS, type Anchor, type RoadGraph } from './graph';

/** Seconds a U-turn costs, on top of the driving. */
export const UTURN = 30;

/** A lower bound (s) on the time from a node to the goal's start node. */
export type Heuristic = (node: number) => number;

export interface PathResult {
  /** Edges driven in order: the start edge (or its twin) first, the goal's edge last. */
  edges: number[];
  /** Seconds at the free-flow speeds, U-turns included. */
  cost: number;
  /** States taken off the queue: what the heuristic saves. */
  expanded: number;
}

const GOAL = -2;

/** Scratch arrays reused between searches on the same graph (a search allocates nothing else). */
const scratch = new WeakMap<RoadGraph, { g: Float64Array; parent: Int32Array; done: Uint8Array; heap: MinHeap }>();

export function shortestPath(graph: RoadGraph, from: Anchor, to: Anchor, h: Heuristic = () => 0): PathResult | null {
  const { edges, out } = graph;
  let sc = scratch.get(graph);
  if (!sc) {
    sc = { g: new Float64Array(edges.length), parent: new Int32Array(edges.length), done: new Uint8Array(edges.length), heap: new MinHeap(1024) };
    scratch.set(graph, sc);
  }
  const { g, parent, done, heap } = sc;
  g.fill(Infinity);
  done.fill(0);
  heap.clear();
  const speed = (e: number) => SPEEDS[edges[e].cls];
  const goal = to.edge;
  const goalRest = to.s / speed(goal);
  let best = Infinity;
  let bestLast = -1;
  let bestDirect: number[] | null = null;
  const start = (e: number, cost: number, s: number) => {
    // Already on the goal's edge, behind the goal: straight there.
    if (e === goal && to.s >= s) {
      const c = cost + (to.s - s) / speed(e);
      if (c < best) [best, bestLast, bestDirect] = [c, -1, [e]];
    }
    const c = cost + (edges[e].length - s) / speed(e);
    if (c < g[e]) {
      g[e] = c;
      parent[e] = -1;
      heap.push(c + h(edges[e].to), e);
    }
  };
  start(from.edge, 0, from.s);
  const twin = edges[from.edge].twin;
  if (twin >= 0) start(twin, UTURN, edges[twin].length - from.s);
  if (best < Infinity) heap.push(best, GOAL);

  let expanded = 0;
  while (heap.size) {
    const f = heap.peekKey();
    const e = heap.pop();
    if (e === GOAL) {
      if (f > best) continue; // a stale goal entry
      break;
    }
    if (done[e]) continue;
    done[e] = 1;
    expanded++;
    if (f >= best) break;
    const ge = g[e];
    for (const n of out[edges[e].to]) {
      const turn = n === edges[e].twin ? UTURN : 0;
      if (n === goal) {
        const c = ge + turn + goalRest;
        if (c < best) {
          best = c;
          bestLast = e;
          bestDirect = null;
          heap.push(c, GOAL);
        }
      }
      const c = ge + turn + edges[n].time;
      if (c < g[n]) {
        g[n] = c;
        parent[n] = e;
        heap.push(c + h(edges[n].to), n);
      }
    }
  }
  if (best === Infinity) return null;
  if (bestDirect) return { edges: bestDirect, cost: best, expanded };
  const path = [goal];
  for (let e = bestLast; e >= 0; e = parent[e]) path.push(e);
  path.reverse();
  return { edges: path, cost: best, expanded };
}

/** Straight-line distance to the goal at the top speed: never more than the real time. */
export function euclidean(graph: RoadGraph, to: Anchor): Heuristic {
  const target = graph.nodes[graph.edges[to.edge].from];
  return (v) => Math.hypot(graph.nodes[v][0] - target[0], graph.nodes[v][1] - target[1]) / MAX_SPEED;
}

/**
 * Travel times from `source` to every node (or, `reverse`, from every node to it) by plain
 * node-based Dijkstra on edge times. For the landmarks. O((V + E) log V).
 */
export function timesFrom(graph: RoadGraph, source: number, reverse = false): Float64Array {
  const dist = new Float64Array(graph.nodes.length).fill(Infinity);
  const heap = new MinHeap(graph.nodes.length);
  dist[source] = 0;
  heap.push(0, source);
  while (heap.size) {
    const d = heap.peekKey();
    const v = heap.pop();
    if (d > dist[v]) continue;
    for (const ei of reverse ? graph.inc[v] : graph.out[v]) {
      const e = graph.edges[ei];
      const w = reverse ? e.from : e.to;
      const nd = d + e.time;
      if (nd < dist[w]) {
        dist[w] = nd;
        heap.push(nd, w);
      }
    }
  }
  return dist;
}
