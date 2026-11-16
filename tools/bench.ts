/**
 * Headless benchmarks on the real map: `npm run bench`.
 *
 * Routing: 1,000 random routes between points on the main road network (seeded, so the
 * same every run), each solved by Dijkstra, A* with the straight-line bound and ALT with
 * 8 landmarks. Prints states expanded and time per route, checks all three agree, and
 * the one-off costs (building the graph, the landmarks).
 *
 * Traffic: the light traffic (traffic/sim.ts) around a player driving across BGC for
 * five minutes, at each tier's count: time per 60 Hz step, how much of the time cars are
 * moving, and how often two cars' footprints overlap (sampled twice a second).
 *
 * Physics: the golden replays (tests/replays) played headless in the real physics with
 * the map's collision: steps per second, against the 60 a second the game needs.
 *
 * Numbers depend on the machine; the expanded counts don't.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { readdirSync, readFileSync } from 'node:fs';
import { playReplay } from '../src/sim/headless';
import { PARKED_MODELS, PARKED_PAINTS } from '../src/car/parked';
import { footprintsOverlap } from '../src/car/resetSpot';
import { snap } from '../src/routing/graph';
import { pointOnRoute, Router } from '../src/routing/route';
import { parkingRoom, TrafficSim, type Agent } from '../src/traffic/sim';
import type { Replay } from '../src/sim/replay';
import { seeded } from '../src/map/hash';
import type { MapData } from '../src/map/types';
import { buildRoadGraph } from '../src/routing/graph';
import { altHeuristic, buildLandmarks } from '../src/routing/landmarks';
import { euclidean, shortestPath, type Heuristic } from '../src/routing/search';

const map = JSON.parse(readFileSync(process.argv[2] ?? 'public/data/bgc.json', 'utf8')) as MapData;
const ms = (t0: number) => performance.now() - t0;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
const fixed = (n: number, d = 3) => n.toFixed(d).padStart(8);

let t0 = performance.now();
const graph = buildRoadGraph(map);
const tGraph = ms(t0);
t0 = performance.now();
const lm = buildLandmarks(graph, 8);
const tLandmarks = ms(t0);
const main = graph.edges.map((e, i) => (e.main ? i : -1)).filter((i) => i >= 0);
console.log(`road graph: ${graph.nodes.length} nodes, ${graph.edges.length} directed edges (${main.length} in the main network), built in ${tGraph.toFixed(1)} ms`);
console.log(`landmarks: ${lm.nodes.length}, built in ${tLandmarks.toFixed(1)} ms, ${((lm.nodes.length * graph.nodes.length * 2 * 4) / 1024).toFixed(0)} KB`);

const rand = seeded('bench-routing');
const pairs = Array.from({ length: 1000 }, () => {
  const pick = () => {
    const e = main[Math.floor(rand() * main.length)];
    return { edge: e, s: rand() * graph.edges[e].length };
  };
  return [pick(), pick()] as const;
});

const methods: [string, (to: (typeof pairs)[number][1]) => Heuristic][] = [
  ['Dijkstra', () => () => 0],
  ['A* (straight line)', (to) => euclidean(graph, to)],
  ['ALT (8 landmarks)', (to) => altHeuristic(graph, lm, to)],
];
// Warm up the JIT so the first method isn't charged for it.
for (const [from, to] of pairs.slice(0, 100)) for (const [, h] of methods) shortestPath(graph, from, to, h(to));

const costs: number[][] = [];
console.log('\nrouting, 1,000 random routes:');
console.log('method                 expanded (mean / p95)     ms (mean / p95)');
for (const [name, h] of methods) {
  const expanded: number[] = [];
  const times: number[] = [];
  const c: number[] = [];
  for (const [from, to] of pairs) {
    const t = performance.now();
    const r = shortestPath(graph, from, to, h(to));
    times.push(ms(t));
    expanded.push(r?.expanded ?? 0);
    c.push(r?.cost ?? Infinity);
  }
  costs.push(c);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  console.log(`${name.padEnd(22)} ${fixed(mean(expanded), 0)} / ${fixed(pct(expanded, 0.95), 0)}      ${fixed(mean(times))} / ${fixed(pct(times, 0.95))}`);
}
const disagree = costs[0].filter((c, i) => costs.some((o) => Math.abs(o[i] - c) > 1e-6)).length;
console.log(disagree ? `\n${disagree} routes where the methods disagree: a bug` : '\nall three methods agree on every route');
if (disagree) process.exitCode = 1;

// --- Physics, headless.
await RAPIER.init();
console.log('\nphysics, golden replays played headless (map collision included):');
for (const f of readdirSync('tests/replays').filter((x) => x.endsWith('.json'))) {
  const replay = JSON.parse(readFileSync(`tests/replays/${f}`, 'utf8')) as Replay;
  let steps = 0;
  let t1 = 0;
  const t = performance.now();
  playReplay(RAPIER, map, replay, (_, i) => {
    steps = i + 1;
    if (i === 0) t1 = performance.now();
  });
  const run = ms(t1);
  console.log(`${f.replace('.json', '').padEnd(22)} ${steps} steps in ${run.toFixed(0)} ms: ${Math.round((steps / run) * 1000).toLocaleString('en-US')} steps/s (setup ${(t1 - t).toFixed(0)} ms)`);
}

// --- Traffic.
const across = new Router(graph, 4).route(snap(graph, [-500, -600])!, snap(graph, [800, 1200])!)!;
const room = parkingRoom(map.roads, map.parked ?? []);
const foot = (a: Agent): [number, number][] => {
  const [c, s, hl, hw] = [Math.cos(a.heading), Math.sin(a.heading), a.len / 2, a.width / 2];
  return [[a.x + c * hl - s * hw, a.y + s * hl + c * hw], [a.x - c * hl - s * hw, a.y - s * hl + c * hw], [a.x - c * hl + s * hw, a.y - s * hl - c * hw], [a.x + c * hl + s * hw, a.y + s * hl - c * hw]];
};
console.log(`\ntraffic, 5 minutes around a player driving ${(across.length / 1000).toFixed(1)} km across BGC at 12 m/s:`);
console.log('cars   us per step   moving   overlapping footprints (samples)   touching a parked car (samples)');
// Parked cars on a grid, to check traffic keeps clear of them.
const parkedGrid = new Map<string, [number, number][][]>();
for (const c of map.parked ?? []) {
  const [l, w] = PARKED_MODELS[c.v].size;
  const [co, si] = [Math.cos(c.rot), Math.sin(c.rot)];
  const corners: [number, number][] = [[l / 2, w / 2], [-l / 2, w / 2], [-l / 2, -w / 2], [l / 2, -w / 2]].map(([x, y]) => [c.p[0] + co * x - si * y, c.p[1] + si * x + co * y]);
  const k = `${Math.floor(c.p[0] / 20)},${Math.floor(c.p[1] / 20)}`;
  parkedGrid.set(k, [...(parkedGrid.get(k) ?? []), corners]);
}
for (const count of [6, 10, 14, 18]) {
  const sim = new TrafficSim(graph, { count, models: PARKED_MODELS.map((m) => ({ size: [m.size[0], m.size[1]], weight: m.weight })), paints: PARKED_PAINTS.map((p) => p.weight), room });
  let [moving, total, overlaps, time, parked] = [0, 0, 0, 0, 0];
  for (let i = 0; i < 60 * 300; i++) {
    const at = pointOnRoute(across, ((i / 60) * 12) % across.length);
    const t = performance.now();
    sim.step(1 / 60, at.p, [{ p: at.p, speed: 12, heading: at.heading, half: 2.25 }]);
    time += performance.now() - t;
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
    if (i % 30 === 0)
      for (const a of sim.agents) {
        const [gx, gy] = [Math.floor(a.x / 20), Math.floor(a.y / 20)];
        const mine = foot(a);
        let hit = false;
        for (let x = gx - 1; x <= gx + 1 && !hit; x++) for (let y = gy - 1; y <= gy + 1 && !hit; y++) for (const c of parkedGrid.get(`${x},${y}`) ?? []) if (a.z < 1 && footprintsOverlap(mine, c)) hit = true;
        if (hit) parked++;
      }
  }
  console.log(`${String(count).padStart(4)}   ${fixed((time / (60 * 300)) * 1000, 0)}       ${fixed((moving / total) * 100, 0)}%   ${overlaps} of ${60 * 10}                       ${parked} of ${count * 600}`);
}
