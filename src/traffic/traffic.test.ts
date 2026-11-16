import { describe, expect, it } from 'vitest';
import bgcRaw from '../../public/data/bgc.json?raw';
import { PARKED_MODELS, PARKED_PAINTS } from '../car/parked';
import { carCorners, footprintsOverlap } from '../car/resetSpot';
import type { MapData, Point, Road } from '../map/types';
import { buildRoadGraph } from '../routing/graph';
import { pointOnRoute, Router } from '../routing/route';
import { snap } from '../routing/graph';
import { IDM, idmAccel } from './idm';
import { laneOffset, roadsWithParking, TrafficSim, type Agent } from './sim';

const MODELS = PARKED_MODELS.map((m) => ({ size: [m.size[0], m.size[1]] as [number, number], weight: m.weight }));
const PAINTS = PARKED_PAINTS.map((p) => p.weight);

describe('the Intelligent Driver Model', () => {
  it('speeds up toward the wanted speed on a free road, and no further', () => {
    let v = 0;
    for (let t = 0; t < 60; t += 0.1) v += idmAccel(v, 13, Infinity, 0) * 0.1;
    expect(v).toBeGreaterThan(12.5);
    expect(v).toBeLessThanOrEqual(13);
    expect(idmAccel(0, 13, Infinity, 0)).toBeCloseTo(IDM.accel);
  });

  it('stops behind a stopped car, about the standing gap short of it, without touching it', () => {
    let [x, v] = [0, 13];
    const wall = 120;
    let closest = Infinity;
    for (let t = 0; t < 60; t += 0.05) {
      v = Math.max(0, v + idmAccel(v, 13, wall - x, 0) * 0.05);
      x += v * 0.05;
      closest = Math.min(closest, wall - x);
    }
    expect(v).toBeLessThan(0.05);
    expect(closest).toBeGreaterThan(IDM.s0 * 0.8);
    expect(closest).toBeLessThan(IDM.s0 * 1.5);
  });
});

describe('lanes', () => {
  it('keeps right on two-way roads and spreads across one-way ones', () => {
    const two = { oneway: false, w: 12, lanes: 2 } as Parameters<typeof laneOffset>[0];
    expect(laneOffset(two, 0)).toBeGreaterThan(0);
    expect(laneOffset(two, 1)).toBeGreaterThan(laneOffset(two, 0));
    expect(laneOffset(two, 1)).toBeLessThan(6);
    const one = { oneway: true, w: 10, lanes: 3 } as Parameters<typeof laneOffset>[0];
    expect(laneOffset(one, 0) + laneOffset(one, 2)).toBeCloseTo(0);
  });

  it('finds roads with parked cars along them', () => {
    const roads: Road[] = [
      { id: 'a', highway: 'residential', cls: 'minor', w: 8, points: [[0, 0], [100, 0]] },
      { id: 'b', highway: 'residential', cls: 'minor', w: 8, points: [[0, 50], [100, 50]] },
    ];
    expect([...roadsWithParking(roads, [{ p: [40, -3.5] }])]).toEqual([0]);
  });
});

/** Footprint of a traffic car. */
const foot = (a: Agent): Point[] => {
  const [c, s, hl, hw] = [Math.cos(a.heading), Math.sin(a.heading), a.len / 2, a.width / 2];
  return [
    [a.x + c * hl - s * hw, a.y + s * hl + c * hw],
    [a.x - c * hl - s * hw, a.y - s * hl + c * hw],
    [a.x - c * hl + s * hw, a.y - s * hl - c * hw],
    [a.x + c * hl + s * hw, a.y + s * hl - c * hw],
  ];
};

describe('traffic on the real map', () => {
  const map = JSON.parse(bgcRaw) as MapData;
  const graph = buildRoadGraph(map);
  const avoid = roadsWithParking(map.roads, map.parked ?? []);
  // The player drives a long route across BGC at 12 m/s.
  const router = new Router(graph, 4);
  const route = router.route(snap(graph, [-500, -600])!, snap(graph, [800, 1200])!)!;

  function drive(count: number, seconds: number, seed = 'test') {
    const sim = new TrafficSim(graph, { count, models: MODELS, paints: PAINTS, avoid, seed });
    let [moving, total, overlaps] = [0, 0, 0];
    for (let i = 0; i < seconds * 60; i++) {
      const at = pointOnRoute(route, ((i / 60) * 12) % route.length);
      sim.step(1 / 60, at.p, [{ p: at.p, speed: 12, heading: at.heading, half: 2.25 }]);
      for (const a of sim.agents) {
        total++;
        if (a.v > 0.5) moving++;
      }
      if (i % 30 === 0)
        for (let x = 0; x < sim.agents.length; x++)
          for (let y = x + 1; y < sim.agents.length; y++) {
            const [a, b] = [sim.agents[x], sim.agents[y]];
            if (Math.abs(a.z - b.z) < 1.5 && Math.hypot(a.x - b.x, a.y - b.y) < 6 && footprintsOverlap(foot(a), foot(b))) overlaps++;
          }
    }
    return { sim, moving: moving / total, overlaps };
  }

  it('keeps the count around the player, keeps moving, and cars keep apart', () => {
    const { sim, moving, overlaps } = drive(6, 240);
    expect(sim.agents).toHaveLength(6);
    expect(moving).toBeGreaterThan(0.9);
    expect(overlaps).toBe(0);
    // On the avenues and wider streets, never on a road with parked cars.
    for (const a of sim.agents) expect(avoid.has(graph.edges[a.edge].road)).toBe(false);
  });

  it('is the same every time for the same seed', () => {
    const pose = (s: TrafficSim) => s.agents.map((a) => [a.id, a.edge, a.lane, Math.round(a.s * 1000), Math.round(a.v * 1000)]);
    expect(pose(drive(6, 30).sim)).toEqual(pose(drive(6, 30).sim));
    expect(pose(drive(6, 30, 'other').sim)).not.toEqual(pose(drive(6, 30).sim));
  });

  it('stops behind the player and waits, and drops a knocked car from the flow', () => {
    const sim = new TrafficSim(graph, { count: 6, models: MODELS, paints: PAINTS, avoid, seed: 'stop' });
    const p = pointOnRoute(route, 0).p;
    for (let i = 0; i < 120; i++) sim.step(1 / 60, p);
    const a = sim.agents[0];
    // The player's car parked 25 m ahead of it, in its lane.
    const block: Point = [a.x + Math.cos(a.heading) * 25, a.y + Math.sin(a.heading) * 25];
    const before = a.s;
    for (let i = 0; i < 60 * 15; i++) sim.step(1 / 60, p, [{ p: block, speed: 0, heading: a.heading, half: 2.25 }]);
    const moved = sim.agents.find((x) => x.id === a.id);
    if (moved && moved.edge === a.edge) {
      expect(moved.v).toBeLessThan(0.1);
      expect(footprintsOverlap(foot(moved), carCorners(block, a.heading))).toBe(false);
    }
    expect(moved === undefined || moved.edge !== a.edge || moved.s > before).toBe(true);
    sim.knock(a.id);
    expect(sim.agents.find((x) => x.id === a.id)?.knocked).toBe(true);
  });
});
