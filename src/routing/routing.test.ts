import { describe, expect, it } from 'vitest';
import bgcRaw from '../../public/data/bgc.json?raw';
import { seeded } from '../map/hash';
import type { MapData, Point, Road } from '../map/types';
import { buildRoadGraph, snap, SPEEDS, stronglyConnected, type RoadGraph } from './graph';
import { MinHeap } from './heap';
import { altHeuristic, buildLandmarks } from './landmarks';
import { pointOnRoute, progressOnRoute, Router } from './route';
import { euclidean, shortestPath, UTURN } from './search';

const road = (id: string, points: Point[], extra: Partial<Road> = {}): Road => ({ id, highway: 'residential', cls: 'minor', w: 8, points, ...extra });

describe('MinHeap', () => {
  it('pops in priority order, growing as needed', () => {
    const h = new MinHeap(2);
    const keys = [5, 1, 9, 3, 3, 7, 0, 8];
    keys.forEach((k, i) => h.push(k, i));
    const out: number[] = [];
    while (h.size) out.push(keys[h.pop()]);
    expect(out).toEqual([...keys].sort((a, b) => a - b));
    expect(h.pop()).toBe(-1);
  });
});

describe('road graph', () => {
  // A square block: four two-way streets, plus a one-way shortcut across it going east.
  const grid = (): MapData =>
    ({
      roads: [
        // Split where they meet, as the pipeline splits roads.
        road('s', [[0, 0], [100, 0]]),
        road('e1', [[100, 0], [100, 50]]),
        road('e2', [[100, 50], [100, 100]]),
        road('n', [[100, 100], [0, 100]]),
        road('w2', [[0, 100], [0, 50]]),
        road('w1', [[0, 50], [0, 0]]),
        road('cut', [[0, 50], [100, 50]], { oneway: true }),
        road('path', [[0, 0], [-50, 0]], { cls: 'path' }),
      ],
    }) as unknown as MapData;

  it('makes a node per road end, an edge per direction, and leaves footpaths out', () => {
    const g = buildRoadGraph(grid());
    // Two-way roads: twins pointing at each other; the one-way road: one edge.
    expect(g.edges.filter((e) => e.oneway)).toHaveLength(1);
    for (const e of g.edges) if (e.twin >= 0) expect(g.edges[e.twin].twin).toBe(g.edges.indexOf(e));
    expect(g.edges.some((e) => e.road === 7)).toBe(false);
  });

  it('finds the strongly connected main network', () => {
    const m: MapData = { roads: [road('a', [[0, 0], [100, 0]]), road('stub', [[100, 0], [200, 0]], { oneway: true })] } as unknown as MapData;
    const g = buildRoadGraph(m);
    expect(g.edges.filter((e) => e.main)).toHaveLength(2);
    expect(g.edges.find((e) => e.oneway)!.main).toBe(false);
    const comp = stronglyConnected(g);
    expect(new Set(comp).size).toBe(2);
  });

  it('routes by time, takes one-way roads only their way, and turns around only when it pays', () => {
    const g = buildRoadGraph(grid());
    const router = new Router(g, 2);
    const from = snap(g, [0, 25], { heading: Math.PI / 2 })!; // on the west side, heading north
    const to = snap(g, [100, 75], { heading: Math.PI / 2 })!; // on the east side, heading north
    const r = router.route(from, to)!;
    // Up to the cut, east along it (its way), up the east side.
    expect(r.length).toBeCloseTo(25 + 100 + 25, 0);
    expect(r.time).toBeCloseTo(r.length / SPEEDS.minor, 3);
    // Back west can't use the cut: around the block.
    const back = router.route(snap(g, [100, 75], { heading: -Math.PI / 2 })!, snap(g, [0, 25], { heading: -Math.PI / 2 })!)!;
    expect(back.length).toBeGreaterThan(150);
    // Facing away from a goal just behind: turning around beats going around the block.
    const behind = router.route(snap(g, [50, 0], { heading: 0 })!, snap(g, [40, 0], { heading: Math.PI })!)!;
    expect(behind.time).toBeCloseTo(UTURN + 10 / SPEEDS.minor, 3);
    // The polyline is continuous and starts and ends at the anchors.
    for (let i = 1; i < r.points.length; i++) expect(Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1])).toBeLessThan(101);
    expect(r.points[0][1]).toBeCloseTo(25);
    expect(r.points[r.points.length - 1][1]).toBeCloseTo(75);
  });

  it('tracks progress along a route', () => {
    const g = buildRoadGraph(grid());
    const r = new Router(g, 2).route(snap(g, [0, 25], { heading: Math.PI / 2 })!, snap(g, [100, 75], { heading: Math.PI / 2 })!)!;
    const mid = pointOnRoute(r, 75);
    expect(mid.p[0]).toBeCloseTo(50);
    expect(mid.p[1]).toBeCloseTo(50);
    const at = progressOnRoute(r, [50, 53]);
    expect(at.s).toBeCloseTo(75);
    expect(at.off).toBeCloseTo(3);
  });
});

describe('on the real map', () => {
  const map = JSON.parse(bgcRaw) as MapData;
  const g: RoadGraph = buildRoadGraph(map);
  const lm = buildLandmarks(g, 8);
  const mainEdges = g.edges.map((e, i) => (e.main ? i : -1)).filter((i) => i >= 0);

  it('has one big main network', () => {
    expect(mainEdges.length / g.edges.length).toBeGreaterThan(0.85);
  });

  it('Dijkstra, A* and ALT agree on every route, and the heuristics expand fewer states', () => {
    const rand = seeded('routing-test');
    let [dij, ast, alt] = [0, 0, 0];
    for (let k = 0; k < 150; k++) {
      const pick = () => {
        const e = mainEdges[Math.floor(rand() * mainEdges.length)];
        return { edge: e, s: rand() * g.edges[e].length };
      };
      const [from, to] = [pick(), pick()];
      const a = shortestPath(g, from, to)!;
      const b = shortestPath(g, from, to, euclidean(g, to))!;
      const c = shortestPath(g, from, to, altHeuristic(g, lm, to))!;
      expect(a).not.toBeNull();
      expect(b.cost).toBeCloseTo(a.cost, 6);
      expect(c.cost).toBeCloseTo(a.cost, 6);
      dij += a.expanded;
      ast += b.expanded;
      alt += c.expanded;
    }
    expect(ast).toBeLessThan(dij);
    expect(alt).toBeLessThan(ast);
  });
});
