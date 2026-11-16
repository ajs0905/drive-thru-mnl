/**
 * A route as the game uses it: the polyline from the car to the destination (for the
 * minimap's line and the checkpoints), its length and its expected time, plus the router
 * that answers "how do I get from here to there" with the best heuristic available, and
 * tracking where along a route the car is.
 */
import type { Point } from '../map/types';
import { anchorPose, type Anchor, type RoadGraph } from './graph';
import { altHeuristic, buildLandmarks, type Landmarks } from './landmarks';
import { shortestPath } from './search';

export interface Route {
  /** Polyline from the start anchor to the goal anchor (map space). */
  points: Point[];
  /** Cumulative length along it (m). */
  acc: number[];
  length: number;
  /** Seconds at the free-flow speeds (U-turns included). */
  time: number;
  edges: number[];
  from: Anchor;
  to: Anchor;
}

/** Part of an edge's polyline between s0 and s1 (meters along it). */
function slice(graph: RoadGraph, edge: number, s0: number, s1: number): Point[] {
  const e = graph.edges[edge];
  const pts: Point[] = [anchorPose(graph, { edge, s: s0 }).p];
  for (let i = 1; i < e.points.length - 1; i++) if (e.acc[i] > s0 && e.acc[i] < s1) pts.push(e.points[i]);
  pts.push(anchorPose(graph, { edge, s: s1 }).p);
  return pts;
}

/** Turns a search result into the route's polyline, length and time. */
export function routeFrom(graph: RoadGraph, from: Anchor, to: Anchor, edges: number[], cost: number): Route {
  const points: Point[] = [];
  const add = (pts: Point[]) => {
    for (const p of pts) {
      const last = points[points.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.05) points.push(p);
    }
  };
  edges.forEach((ei, k) => {
    const e = graph.edges[ei];
    // The first edge starts where the car is (on its twin, at the mirrored spot); the last ends at the goal.
    const s0 = k === 0 ? (ei === from.edge ? from.s : e.length - from.s) : 0;
    const s1 = k === edges.length - 1 ? to.s : e.length;
    add(slice(graph, ei, Math.max(0, s0), Math.max(Math.max(0, s0), s1)));
  });
  const acc = [0];
  for (let i = 1; i < points.length; i++) acc.push(acc[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return { points, acc, length: acc[acc.length - 1], time: cost, edges, from, to };
}

/** Plans routes on one graph: builds its landmarks once, then answers with ALT. */
export class Router {
  readonly graph: RoadGraph;
  readonly landmarks: Landmarks;

  constructor(graph: RoadGraph, landmarks = 8) {
    this.graph = graph;
    this.landmarks = buildLandmarks(graph, landmarks);
  }

  route(from: Anchor, to: Anchor): Route | null {
    const r = shortestPath(this.graph, from, to, altHeuristic(this.graph, this.landmarks, to));
    return r && routeFrom(this.graph, from, to, r.edges, r.cost);
  }
}

/** Where along a route the car is: meters along it, and how far off it (m). Searches near `hint` (the last answer) first. */
export function progressOnRoute(route: Route, p: Point, hint = 0): { s: number; off: number } {
  const { points, acc } = route;
  let best = { s: 0, off: Infinity };
  // Look a window around the last position first; fall back to the whole route if that's far off.
  const scan = (from: number, to: number) => {
    for (let i = Math.max(0, from); i < Math.min(points.length - 1, to); i++) {
      const [a, b] = [points[i], points[i + 1]];
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      const off = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
      if (off < best.off) best = { s: acc[i] + t * Math.sqrt(l2), off };
    }
  };
  let i = 0;
  while (i < points.length - 2 && acc[i + 1] < hint) i++;
  scan(i - 20, i + 40);
  if (best.off > 30) scan(0, points.length);
  return best;
}

/** The point and direction (radians) `s` meters along a route. */
export function pointOnRoute(route: Route, s: number): { p: Point; heading: number } {
  const { points, acc } = route;
  if (points.length < 2) return { p: points[0] ?? [0, 0], heading: 0 };
  let i = 0;
  while (i < points.length - 2 && acc[i + 1] < s) i++;
  const [a, b] = [points[i], points[i + 1]];
  const t = Math.max(0, Math.min(1, (s - acc[i]) / (acc[i + 1] - acc[i] || 1)));
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

/** Expected seconds for what's left of a route, from where the car is along it. */
export function timeLeft(route: Route, s: number): number {
  return route.length > 0 ? route.time * Math.max(0, 1 - s / route.length) : 0;
}

