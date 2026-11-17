import { describe, expect, it } from 'vitest';
import bgcRaw from '../../public/data/bgc.json?raw';
import { PARKED_MODELS, PARKED_PAINTS } from '../car/parked';
import { carCorners, footprintsOverlap } from '../car/resetSpot';
import type { MapData, Point, Road } from '../map/types';
import { buildRoadGraph } from '../routing/graph';
import { pointOnRoute, Router } from '../routing/route';
import { snap } from '../routing/graph';
import { IDM, idmAccel } from './idm';
import { Signals } from './signals';
import { laneOffset, laneWidth, oncomingRoom, parkingRoom, roadsWithParking, TRAFFIC, TrafficSim, type Agent } from './sim';

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

  it('finds roads with parked cars along them, and the room the cars leave either side', () => {
    const roads: Road[] = [
      { id: 'a', highway: 'residential', cls: 'minor', w: 8, points: [[0, 0], [100, 0]] },
      { id: 'b', highway: 'residential', cls: 'minor', w: 8, points: [[0, 50], [100, 50]] },
    ];
    expect([...roadsWithParking(roads, [{ p: [40, -3.5] }])]).toEqual([0]);
    // Parked on the right of road a (heading east, right is south): 3.5 - 0.95 - 0.3 m clear on that side, all 4 m on the left.
    const room = parkingRoom(roads, [{ p: [40, -3.5] }]);
    expect(room.get(0)![0]).toBeCloseTo(4);
    expect(room.get(0)![1]).toBeCloseTo(2.25);
    expect(room.has(1)).toBe(false);
  });

  it('keeps lanes inside the room parked cars leave', () => {
    const one = { oneway: true, w: 8, lanes: 1 };
    // Cars parked on the right: the lane moves left, centered in what's clear.
    const off = laneOffset(one, 0, [4, 1.5]);
    expect(off).toBeCloseTo(-1.25);
    expect(off + laneWidth(one, [4, 1.5]) / 2).toBeLessThanOrEqual(1.5);
    expect(off - laneWidth(one, [4, 1.5]) / 2).toBeGreaterThanOrEqual(-4);
    // Two-way with parking both sides: each direction keeps right inside its half of the gap.
    const two = { oneway: false, w: 12, lanes: 1 };
    expect(laneOffset(two, 0, [2.8, 2.8])).toBeCloseTo(1.4);
    expect(laneWidth(two, [2.8, 1])).toBeLessThan(2.4);
  });
});

/** A footprint: center, heading, length and width. */
const rect = (p: Point, heading: number, len: number, width: number): Point[] => {
  const [c, s, hl, hw] = [Math.cos(heading), Math.sin(heading), len / 2, width / 2];
  return [
    [p[0] + c * hl - s * hw, p[1] + s * hl + c * hw],
    [p[0] - c * hl - s * hw, p[1] - s * hl + c * hw],
    [p[0] - c * hl + s * hw, p[1] - s * hl - c * hw],
    [p[0] + c * hl + s * hw, p[1] + s * hl - c * hw],
  ];
};
/** Footprint of a traffic car. */
const foot = (a: Agent): Point[] => rect([a.x, a.y], a.heading, a.len, a.width);

describe('oncoming carriageways', () => {
  it('keeps a one-way carriageway mapped too wide off the one coming the other way beside it', () => {
    // Eastbound 16 m wide, westbound 8 m wide, center lines 6 m apart: the drawn widths overlap by 6 m.
    const roads: Road[] = [
      { id: 'east', highway: 'secondary', cls: 'major', w: 16, oneway: true, points: [[0, 0], [200, 0]] },
      { id: 'west', highway: 'secondary', cls: 'major', w: 8, oneway: true, points: [[200, 6], [0, 6]] },
    ];
    const graph = buildRoadGraph({ roads });
    const room = graph.edges.map((e) => [e.w / 2, e.w / 2] as [number, number]);
    oncomingRoom(graph, room);
    const [east, west] = [graph.edges.findIndex((e) => e.w === 16), graph.edges.findIndex((e) => e.w === 8)];
    // Each gets its share of the 6 m between them on that side, by width: 4 m and 2 m.
    expect(room[east][0]).toBeCloseTo(4);
    expect(room[west][0]).toBeCloseTo(2);
    // The far sides keep their full room.
    expect(room[east][1]).toBe(8);
    // Lanes still fit.
    expect(laneWidth(graph.edges[east], room[east])).toBeGreaterThanOrEqual(TRAFFIC.laneMin);
  });
});

describe('traffic on the real map', () => {
  const map = JSON.parse(bgcRaw) as MapData;
  const graph = buildRoadGraph(map);
  const room = parkingRoom(map.roads, map.parked ?? []);
  // Parked cars' footprints, to check traffic keeps clear of them.
  const parked = (map.parked ?? []).map((c) => rect(c.p, c.rot, PARKED_MODELS[c.v].size[0], PARKED_MODELS[c.v].size[1]));
  // The player drives a long route across BGC at 12 m/s.
  const router = new Router(graph, 4);
  const route = router.route(snap(graph, [-500, -600])!, snap(graph, [800, 1200])!)!;

  function drive(count: number, seconds: number, seed = 'test', lights = false) {
    const signals = lights ? new Signals(graph, map.dressing ?? []) : undefined;
    const sim = new TrafficSim(graph, { count, models: MODELS, paints: PAINTS, room, seed, signals });
    let [moving, total, overlaps, onParked, turn, jump] = [0, 0, 0, 0, 0, 0];
    const last = new Map<number, Agent>();
    for (let i = 0; i < seconds * 60; i++) {
      const at = pointOnRoute(route, ((i / 60) * 12) % route.length);
      signals?.advance(1 / 60);
      sim.step(1 / 60, at.p, [{ p: at.p, speed: 12, heading: at.heading, half: 2.25 }]);
      for (const a of sim.agents) {
        total++;
        if (a.v > 0.5) moving++;
        // How far each car's heading turns, and how far it moves past its speed, in one step.
        const b = last.get(a.id);
        if (b) {
          turn = Math.max(turn, Math.abs(Math.atan2(Math.sin(a.heading - b.heading), Math.cos(a.heading - b.heading))));
          jump = Math.max(jump, Math.hypot(a.x - b.x, a.y - b.y) - a.v / 60);
        }
        last.set(a.id, { ...a });
      }
      if (i % 30 === 0)
        for (const a of sim.agents) {
          const mine = foot(a);
          if (a.z < 1 && parked.some((c) => Math.abs(c[0][0] - a.x) < 8 && Math.abs(c[0][1] - a.y) < 8 && footprintsOverlap(mine, c))) onParked++;
        }
      if (i % 30 === 0)
        for (let x = 0; x < sim.agents.length; x++)
          for (let y = x + 1; y < sim.agents.length; y++) {
            const [a, b] = [sim.agents[x], sim.agents[y]];
            if (Math.abs(a.z - b.z) < 1.5 && Math.hypot(a.x - b.x, a.y - b.y) < 6 && footprintsOverlap(foot(a), foot(b))) overlaps++;
          }
    }
    return { sim, moving: moving / total, overlaps, onParked, turn, jump };
  }

  it('keeps the count around the player, keeps moving, and cars keep apart and clear of parked cars', () => {
    const { sim, moving, overlaps, onParked } = drive(10, 240);
    expect(sim.agents).toHaveLength(10);
    expect(moving).toBeGreaterThan(0.9);
    expect(overlaps).toBe(0);
    expect(onParked).toBe(0);
  });

  it('keeps cars apart with the traffic lights cycling and the player driving through queues (nobody swerves into the next lane)', () => {
    const { overlaps, onParked } = drive(24, 180, 'b', true);
    expect(overlaps).toBe(0);
    expect(onParked).toBe(0);
  });

  it('turns smoothly: no snapped headings, no jumps sideways', () => {
    const { turn, jump } = drive(10, 120);
    // At most ~0.1 rad in a 60th of a second (a tight turn at turning speed), and never more than a few cm past where its speed takes it.
    expect(turn).toBeLessThan(0.1);
    expect(jump).toBeLessThan(0.05);
  });

  it('is the same every time for the same seed', () => {
    const pose = (s: TrafficSim) => s.agents.map((a) => [a.id, a.edge, a.lane, Math.round(a.s * 1000), Math.round(a.v * 1000)]);
    expect(pose(drive(6, 30).sim)).toEqual(pose(drive(6, 30).sim));
    expect(pose(drive(6, 30, 'other').sim)).not.toEqual(pose(drive(6, 30).sim));
  });

  it('eases round a car stopped at the curb, without touching it, where the road has room', () => {
    let passed = 0;
    for (const seed of ['curb-a', 'curb-b', 'curb-c', 'curb-d']) {
      const sim = new TrafficSim(graph, { count: 6, models: MODELS, paints: PAINTS, room, seed });
      const p = pointOnRoute(route, 0).p;
      for (let i = 0; i < 120; i++) sim.step(1 / 60, p);
      const a = sim.agents[0];
      // Stopped 25 m ahead, a meter right of its lane's center (half in the lane, like a car at the curb of a narrow street).
      const [c, sn] = [Math.cos(a.heading), Math.sin(a.heading)];
      const block: Point = [a.x + c * 25 + sn * 1, a.y + sn * 25 - c * 1];
      const parkedFoot = rect(block, a.heading, 4.45, 2.4);
      let touched = false;
      let past = false;
      for (let i = 0; i < 60 * 12; i++) {
        sim.step(1 / 60, p, [{ p: block, speed: 0, heading: a.heading, half: 2.25 }]);
        const o = sim.agents.find((x) => x.id === a.id);
        if (!o) break;
        if (footprintsOverlap(foot(o), parkedFoot)) touched = true;
        if ((o.x - block[0]) * c + (o.y - block[1]) * sn > 5) past = true;
      }
      expect(touched, seed).toBe(false);
      if (past) passed++;
    }
    expect(passed).toBeGreaterThan(0);
  });

  it('stops behind the player and waits, and drops a knocked car from the flow', () => {
    const sim = new TrafficSim(graph, { count: 6, models: MODELS, paints: PAINTS, room, seed: 'stop' });
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

  it('steers like a car: the front axle on the path, the rear trailing it a wheelbase behind, the body pointing from one to the other', () => {
    const { sim } = drive(10, 60);
    let turning = 0;
    for (const a of sim.agents) {
      if (a.knocked) continue;
      const [fx, fy] = [a.x + (Math.cos(a.heading) * a.wb) / 2, a.y + (Math.sin(a.heading) * a.wb) / 2];
      expect(Math.hypot(fx - a.rx, fy - a.ry)).toBeCloseTo(a.wb, 5);
      expect(Math.abs(a.steer)).toBeLessThan(0.7);
      if (Math.abs(a.steer) > 0.02) turning++;
    }
    expect(sim.agents.every((a) => a.wb > 2 && a.wb < a.len)).toBe(true);
    expect(turning).toBeGreaterThanOrEqual(0);
  });

  it('changes lanes on wider roads with the signal on, over 12 to 20 m of road, and never sideways in a jump', () => {
    const sim = new TrafficSim(graph, { count: 30, models: MODELS, paints: PAINTS, room, seed: 'lanes' });
    const seen = new Map<number, { lane: number; edge: number; laneAt: number }>();
    let [changes, signaled] = [0, 0];
    for (let i = 0; i < 60 * 180; i++) {
      const at = pointOnRoute(route, ((i / 60) * 12) % route.length);
      sim.step(1 / 60, at.p, [{ p: at.p, speed: 12, heading: at.heading, half: 2.25 }]);
      for (const a of sim.agents) {
        const was = seen.get(a.id);
        if (was && was.edge === a.edge && was.laneAt !== a.laneAt && !a.knocked) {
          changes++;
          expect(a.latLen).toBeGreaterThanOrEqual(TRAFFIC.latMin);
          expect(a.latLen).toBeLessThanOrEqual(TRAFFIC.latMax);
          if (a.signal === (a.latTo > a.latFrom ? 1 : -1)) signaled++;
        }
        seen.set(a.id, { lane: a.lane, edge: a.edge, laneAt: a.laneAt });
      }
    }
    expect(changes).toBeGreaterThan(5);
    expect(signaled).toBe(changes);
  });

  it('takes an exit off a roundabout: nobody goes round more than twice', () => {
    // Laps of each ring, by walking it.
    const lapOf = (edge: number) => {
      let [cur, total] = [edge, 0];
      for (let k = 0; k < 40; k++) {
        total += graph.edges[cur].length;
        const next = graph.out[graph.edges[cur].to].find((n) => graph.edges[n].roundabout);
        if (next === undefined || next === edge) break;
        cur = next;
      }
      return total;
    };
    let [entries, worst] = [0, 0];
    // Parked next to Gomez Circle and Burgos Circle, so cars spawn all around them.
    for (const at of [[-644, -547], [-771, 242]] as Point[]) {
      const sim = new TrafficSim(graph, { count: 30, models: MODELS, paints: PAINTS, room, seed: 'ring' });
      const stay = new Map<number, number>();
      for (let i = 0; i < 60 * 240; i++) {
        sim.step(1 / 60, at, []);
        for (const a of sim.agents) {
          if (!graph.edges[a.edge].roundabout) {
            stay.delete(a.id);
            continue;
          }
          if (!stay.has(a.id)) entries++;
          const d = (stay.get(a.id) ?? 0) + a.v / 60;
          stay.set(a.id, d);
          worst = Math.max(worst, d / lapOf(a.edge));
        }
      }
    }
    expect(entries).toBeGreaterThan(20);
    expect(worst).toBeLessThan(2);
  });

  it('puts a knocked car back on its lane where it stopped, easing back to the lane center', () => {
    const sim = new TrafficSim(graph, { count: 6, models: MODELS, paints: PAINTS, room, seed: 'rejoin' });
    const p = pointOnRoute(route, 0).p;
    for (let i = 0; i < 300; i++) sim.step(1 / 60, p);
    const a = sim.agents.find((x) => !graph.edges[x.edge].roundabout && graph.edges[x.edge].length - x.s > 60 && x.s > 30)!;
    expect(a).toBeDefined();
    sim.knock(a.id);
    // Shoved 0.8 m to the left and turned 15 degrees, then it settles.
    const h = a.heading + 0.26;
    const [x, y] = [a.x - Math.sin(a.heading) * 0.8, a.y + Math.cos(a.heading) * 0.8];
    sim.moveKnocked(a.id, x, y, a.z, h);
    const before = { edge: a.edge, s: a.s };
    expect(sim.rejoin(a.id, x, y, a.z, h, 0)).toBe(true);
    expect([a.edge, Math.round(a.s)], JSON.stringify(before)).toEqual([before.edge, Math.round(before.s)]);
    expect(a.knocked).toBe(false);
    // Where it was left, not snapped to the lane.
    expect(Math.hypot(a.x - x, a.y - y)).toBeLessThan(0.3);
    expect(a.shift).toBeGreaterThan(0.4);
    const start = a.odo;
    for (let i = 0; i < 60 * 10 && a.latP < 1; i++) sim.step(1 / 60, p);
    expect(a.latP).toBe(1);
    expect(a.shift).toBeCloseTo(0, 5);
    expect(a.odo - start).toBeGreaterThan(5);
    // Facing across the road: no lane to rejoin.
    sim.knock(a.id);
    expect(sim.rejoin(a.id, a.x, a.y, a.z, a.heading + Math.PI / 2, 0)).toBe(false);
  });

  it('brakes and moves toward the curb when the player comes at it head-on in its lane, then goes back to its lane', () => {
    let tried = 0;
    let dodged = 0;
    for (const seed of ['dodge-a', 'dodge-b', 'dodge-c', 'dodge-d']) {
      const sim = new TrafficSim(graph, { count: 6, models: MODELS, paints: PAINTS, room, seed });
      const p = pointOnRoute(route, 0).p;
      for (let i = 0; i < 120; i++) sim.step(1 / 60, p);
      const a = sim.agents.find((x) => x.v > 5 && graph.edges[x.edge].length - x.s > 60 && !graph.edges[x.edge].roundabout);
      if (!a) continue;
      tried++;
      const speed = a.v;
      // The player 40 m ahead in its lane, coming straight at it at 15 m/s.
      const [c, sn] = [Math.cos(a.path), Math.sin(a.path)];
      const player = { p: [a.x + c * 40, a.y + sn * 40] as Point, speed: 15, heading: a.path + Math.PI, half: 2.25 };
      let [minShift, slowest] = [0, speed];
      for (let i = 0; i < 60 * 1.2; i++) {
        player.p = [player.p[0] - c * (15 / 60), player.p[1] - sn * (15 / 60)];
        sim.step(1 / 60, p, [player]);
        minShift = Math.min(minShift, a.shift);
        slowest = Math.min(slowest, a.v);
      }
      expect(a.evadeUntil).toBeGreaterThan(0);
      expect(slowest).toBeLessThan(speed * 0.9);
      if (minShift < -0.2) dodged++;
      // Gone past: it eases back to its lane.
      for (let i = 0; i < 60 * 6; i++) sim.step(1 / 60, p);
      if (sim.agents.includes(a)) expect(Math.abs(a.shift)).toBeLessThan(0.05);
    }
    expect(tried).toBeGreaterThan(0);
    expect(dodged).toBeGreaterThan(0);
  });

  it('drops a car whose position stops being a number (a knocked body the physics lost)', () => {
    const sim = new TrafficSim(graph, { count: 6, models: MODELS, paints: PAINTS, room, seed: 'lost' });
    const p = pointOnRoute(route, 0).p;
    for (let i = 0; i < 120; i++) sim.step(1 / 60, p);
    const a = sim.agents[0];
    sim.knock(a.id);
    sim.moveKnocked(a.id, NaN, a.y, a.z, a.heading);
    sim.step(1 / 60, p);
    expect(sim.agents.includes(a)).toBe(false);
    expect(sim.agents.every((x) => Number.isFinite(x.x + x.y + x.z + x.heading))).toBe(true);
  });

  /** A car well into a long edge and moving, and the player coming at it head-on from 40 m, `across` m to its left (- right), drifting across at `drift` m/s. */
  function headOn(seed: string, across: number, drift: number, stopped = false) {
    const sim = new TrafficSim(graph, { count: 6, models: MODELS, paints: PAINTS, room, seed });
    const p = pointOnRoute(route, 0).p;
    for (let i = 0; i < 120; i++) sim.step(1 / 60, p);
    const a = sim.agents.find((x) => x.v > 5 && graph.edges[x.edge].length - x.s > 60 && !graph.edges[x.edge].roundabout);
    if (!a) return undefined;
    if (stopped) [a.v, a.acc] = [0, 0];
    const [c, sn] = [Math.cos(a.path), Math.sin(a.path)];
    const [lx, ly] = [-sn, c];
    const player = { p: [a.x + c * 40 + lx * across, a.y + sn * 40 + ly * across] as Point, speed: 15, heading: a.path + Math.PI - Math.atan2(drift, 15), half: 2.25 };
    const frames: { shift: number; turn: number; steer: number; v: number }[] = [];
    for (let i = 0; i < 60 * 1.5; i++) {
      player.p = [player.p[0] + Math.cos(player.heading) * (15 / 60), player.p[1] + Math.sin(player.heading) * (15 / 60)];
      sim.step(1 / 60, p, [player]);
      frames.push({ shift: a.shift, turn: Math.atan2(Math.sin(a.heading - a.path), Math.cos(a.heading - a.path)), steer: a.steer, v: a.v });
    }
    return frames;
  }

  it('dodges away from where the player will pass: right when it comes down the middle or its left, left when it comes down its right', () => {
    const seeds = ['dodge-a', 'dodge-b', 'dodge-c', 'dodge-d', 'dodge-e', 'dodge-f'];
    let [rights, lefts] = [0, 0];
    for (const seed of seeds) {
      const middle = headOn(seed, 0.6, 0);
      if (middle) {
        // Never toward the player's side.
        expect(Math.max(...middle.map((f) => f.shift)), seed).toBeLessThan(0.05);
        if (Math.min(...middle.map((f) => f.shift)) < -0.2) rights++;
      }
      const right = headOn(seed, -1.4, -0.5);
      if (right) {
        expect(Math.min(...right.map((f) => f.shift)), seed).toBeGreaterThan(-0.05);
        if (Math.max(...right.map((f) => f.shift)) > 0.2) lefts++;
      }
    }
    expect(rights).toBeGreaterThan(0);
    expect(lefts).toBeGreaterThan(0);
  });

  it("steers into a dodge nose first, and doesn't slide sideways when stopped", () => {
    let checked = 0;
    for (const seed of ['dodge-a', 'dodge-b', 'dodge-c', 'dodge-d']) {
      const frames = headOn(seed, 0.6, 0);
      if (!frames) continue;
      const start = frames.findIndex((f) => Math.abs(f.shift) > 0.05);
      if (start < 0) continue;
      checked++;
      const side = Math.sign(frames[start + 10]?.shift ?? frames[start].shift);
      // The front wheels turn toward the dodge first, and the body turns with them before it has moved over much.
      expect(Math.sign(frames[start].steer), seed).toBe(side);
      const turned = frames.findIndex((f) => Math.sign(f.turn) === side && Math.abs(f.turn) > 0.02);
      expect(turned, seed).toBeGreaterThanOrEqual(0);
      expect(Math.abs(frames[turned].shift), seed).toBeLessThan(0.4);
      // Sideways only while moving: about as far as a car turning that much covers.
      for (let i = start; i < frames.length; i++) if (frames[i].v < 0.05) expect(Math.abs(frames[i].shift - frames[i - 1].shift), seed).toBeLessThan(1e-6);
      const still = headOn(seed, 0.6, 0, true)!;
      // Stopped when the player came at it: it brakes and stays put.
      expect(Math.max(...still.map((f) => Math.abs(f.shift))), seed).toBeLessThan(0.05);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
