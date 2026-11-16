/**
 * Light roaming traffic: a few dozen cars at most, simulated only around the player,
 * on the avenues and wider streets (the streets with parked cars stay clear: there's no
 * room to pass them), and only on the biggest part of those that's strongly connected,
 * so a car always has somewhere to go next. Pure and seeded: the same seed and player path give the same
 * traffic, so it runs in headless tests and benchmarks.
 *
 * - **Where cars are**: on a lane of a road graph edge, `s` meters along it. Lanes sit
 *   right of the centerline on two-way roads (traffic keeps right), across the width on
 *   one-way roads. At the end of an edge a car takes the next one it picked when it
 *   entered (straight on more often than turning, avenues over streets, no U-turns
 *   unless it's a dead end).
 * - **How fast** (idm.ts): each car follows the nearest thing ahead in its lane: another
 *   car (on this edge or the next, or any car going its way physically in front of it in
 *   its lane's corridor, for merges and roads drawn close together), a stop line it
 *   hasn't been given yet, the player's car, or a car the player knocked out of the
 *   flow. It slows for turns.
 * - **Junctions**: nodes joined by very short roads (a divided avenue's crossing is two or
 *   more nodes a few meters apart) are one junction. A car asks for the junction ahead
 *   about `reserveAt` meters before it, and waits at the stop line until it's free. One
 *   movement at a time (cars following each other in the same lane along the same path
 *   through it go together), requests served in order. The stop line is before the junction polygon
 *   (big on the wide avenues), and a car lets go once it's out of the polygon by its
 *   length and a margin, so it never waits inside a junction it's blocking. Since roads
 *   too short to wait on are inside a junction, waits can't form a loop.
 * - **Around the player**: cars appear between `spawnMin` and `spawnMax` meters away
 *   (out of sight in the city) and go past `despawn`. A knocked car (the player hit it)
 *   leaves the flow: the physics moves it, the others treat it as an obstacle, and it
 *   goes once it's far behind.
 */
import { seeded } from '../map/hash';
import type { Point } from '../map/types';
import { stronglyConnected, type GraphEdge, type RoadGraph } from '../routing/graph';
import { idmAccel } from './idm';

export const TRAFFIC = {
  spawnMin: 140,
  spawnMax: 320,
  despawn: 380,
  /** The first fill can start this close (m): there's nobody around yet. */
  firstMin: 45,
  /** Free room (m) a new car needs on its lane, either side. */
  spawnRoom: 15,
  /** Ask for the next junction this far (m) before its stop line; the stop line is at least this far (m) before the node, and before the junction polygon. */
  reserveAt: 18,
  stopBack: 3,
  /** Let go of a node once this far (m) past its start, plus the car's length. */
  releasePast: 4,
  /** Nodes joined by a road with less than this (m) between the junction polygons at its ends are one junction (the links across a divided avenue's median). */
  cluster: 15,
  /** Speed through a turn (m/s), and from how far before it (m) to slow down. */
  turnSpeed: 6,
  turnFrom: 30,
  /** How far ahead (m) a car looks for what's in front. */
  lookAhead: 80,
  /** Something counts as in a car's lane within this far (m) of its center line. */
  laneHalf: 1.8,
  /** Speeds (m/s) per class, each car a little faster or slower. */
  speed: { major: 13, minor: 10, service: 6 } as Record<string, number>,
  /** Knocked cars go once this far (m) from the player. */
  knockedGone: 160,
};

export interface TrafficModel {
  /** Length and width (m), and how common it is. */
  size: [number, number];
  weight: number;
}

export interface Agent {
  id: number;
  edge: number;
  /** The edge it takes at the end of this one, and the one after that (-1: nowhere to go). */
  next: number;
  after: number;
  lane: number;
  /** Center, meters along the edge; speed (m/s) and wanted speed. */
  s: number;
  v: number;
  v0: number;
  len: number;
  width: number;
  model: number;
  paint: number;
  knocked: boolean;
  /** Distance driven (m). */
  odo: number;
  /** Junctions it holds, and the distance driven when it left each (null: not yet); the junction it's waiting for (-1 none) and since when (s). */
  held: { junction: number; passedAt: number | null }[];
  waiting: number;
  waitSince: number;
  /** Pose, refreshed every step: map position, height above the ground (m), heading and pitch (radians). */
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
}

export interface Obstacle {
  p: Point;
  /** Speed (m/s) along `heading`, and its half length (m). */
  speed: number;
  heading: number;
  half: number;
}

interface Movement {
  agent: Agent;
  inEdge: number;
  outEdge: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Lateral offset (m, + right of the travel direction) of a lane's center line. */
export function laneOffset(e: GraphEdge, lane: number): number {
  if (e.oneway) {
    const w = Math.min(3.4, e.w / e.lanes);
    return (lane + 0.5) * w - (w * e.lanes) / 2;
  }
  const w = Math.min(3.4, e.w / 2 / e.lanes);
  return (lane + 0.5) * w;
}

export interface TrafficOptions {
  /** Cars to keep around the player. */
  count: number;
  seed?: string;
  models: TrafficModel[];
  /** Paint weights (index = paint id). */
  paints: number[];
  /** Roads (map indices) traffic keeps off (the ones with parked cars). */
  avoid?: Set<number>;
}

export class TrafficSim {
  readonly agents: Agent[] = [];
  readonly graph: RoadGraph;
  count: number;
  private readonly opts: TrafficOptions;
  private readonly rand: () => number;
  private readonly usable: Uint8Array;
  private readonly usableList: number[];
  private readonly usableLength: number[];
  private nextId = 1;
  private time = 0;
  private filled = false;
  /** Holders and queues per junction (a group of nodes, `group`). */
  private readonly holders = new Map<number, Movement[]>();
  private readonly queues = new Map<number, Movement[]>();
  /** The junction each node belongs to: nodes joined by roads shorter than `TRAFFIC.cluster` are one junction. */
  private readonly group: Int32Array;

  constructor(graph: RoadGraph, opts: TrafficOptions) {
    this.graph = graph;
    this.opts = opts;
    this.count = opts.count;
    this.rand = seeded(opts.seed ?? 'traffic');
    // Junctions: union-find over short roads, so a divided avenue's crossing (two or more nodes a few meters apart) is reserved as one.
    const parent = Int32Array.from(graph.nodes.keys());
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (const e of graph.edges) if (this.internal(e)) parent[find(e.from)] = find(e.to);
    this.group = Int32Array.from(graph.nodes.keys(), (v) => find(v));
    this.usable = new Uint8Array(graph.edges.length);
    this.usableList = [];
    this.usableLength = [];
    // The roads traffic may use, then only their biggest strongly connected part: every car always has a way on (no dead ends to pile up at).
    const wide = graph.edges.map((e) => e.main && (e.cls === 'major' || (e.cls === 'minor' && e.w >= 9)) && !opts.avoid?.has(e.road));
    const comp = stronglyConnected({ nodes: graph.nodes, edges: graph.edges, out: graph.out.map((list) => list.filter((i) => wide[i])) });
    const sizes = new Map<number, number>();
    graph.edges.forEach((e, i) => {
      if (wide[i] && comp[e.from] === comp[e.to]) sizes.set(comp[e.from], (sizes.get(comp[e.from]) ?? 0) + e.length);
    });
    let main = -1;
    for (const [c, len] of sizes) if (main < 0 || len > sizes.get(main)!) main = c;
    let total = 0;
    graph.edges.forEach((e, i) => {
      if (!wide[i] || comp[e.from] !== main || comp[e.to] !== main) return;
      this.usable[i] = 1;
      if (this.internal(e) || e.length - e.trimStart - e.trimEnd < 12) return; // inside a junction, or too short to start a car on
      this.usableList.push(i);
      total += e.length;
      this.usableLength.push(total);
    });
  }

  /** One step (s). `player`: where the player's car is, or null (nobody to spawn around). `obstacles`: what else is in the way (the player's car). */
  step(dt: number, player: Point | null, obstacles: Obstacle[] = []) {
    this.time += dt;
    if (player) {
      this.despawn(player);
      this.spawn(player);
    }
    const lanes = this.laneLists();
    // Knocked cars are obstacles too, wherever the physics has put them.
    const blocks = [...obstacles, ...this.agents.filter((a) => a.knocked).map((a) => ({ p: [a.x, a.y] as Point, speed: 0, heading: a.heading, half: a.len / 2 }))];
    for (const a of this.agents) {
      if (a.knocked) continue;
      const e = this.graph.edges[a.edge];
      const left = e.length - a.s;
      // Turning ahead: slow for it.
      let v0 = a.v0;
      if (a.next >= 0 && left < TRAFFIC.turnFrom && Math.abs(this.turnOf(a.edge, a.next)) > 0.5) v0 = Math.min(v0, TRAFFIC.turnSpeed + (left / TRAFFIC.turnFrom) * (v0 - TRAFFIC.turnSpeed));
      let gap = Infinity;
      let lead = 0;
      const ahead = this.leader(a, lanes);
      if (ahead) [gap, lead] = ahead;
      // The node ahead: a stop line until it's ours.
      const junction = this.group[e.to];
      // Inside a junction already (on a short link in it), the rest of it is ours.
      const inside = this.group[e.from] === junction && this.internal(e);
      // The stop line is before the junction polygon (wide avenues have big ones), and the asking starts that much earlier.
      const stopAt = Math.max(TRAFFIC.stopBack, e.trimEnd + 1);
      if (a.next >= 0 && left < TRAFFIC.reserveAt + stopAt && !inside && !a.held.some((h) => h.junction === junction)) {
        if (this.request(a, junction)) a.held.push({ junction, passedAt: null });
        else {
          const stop = left - stopAt - a.len / 2;
          if (stop < gap) [gap, lead] = [Math.max(0.1, stop), 0];
        }
      }
      if (a.next < 0) {
        const end = left - a.len / 2 - 1;
        if (end < gap) [gap, lead] = [Math.max(0.1, end), 0];
      }
      // Any car physically in front in this lane's corridor, whatever edge it's on (merges, roads drawn close together, a car stopped in a junction).
      for (const o of this.agents) {
        // Same way, or across the path and slow (stopped in a junction); not moving across or head-on (the junction rules handle those).
        if (o === a || o.knocked || (Math.cos(o.heading - a.heading) < 0.5 && o.v > 2) || Math.cos(o.heading - a.heading) < -0.5) continue;
        const [dx, dy] = [o.x - a.x, o.y - a.y];
        const along = dx * Math.cos(a.heading) + dy * Math.sin(a.heading);
        // Its center ahead of this car's front (one alongside or tangled up with it isn't "ahead": they can pull apart).
        if (along <= a.len / 2 || along > TRAFFIC.lookAhead / 2 || Math.abs(a.z - o.z) > 2) continue;
        const across = -dx * Math.sin(a.heading) + dy * Math.cos(a.heading);
        if (Math.abs(across) > (a.width + o.width) / 2 + 0.3) continue;
        const g = along - a.len / 2 - o.len / 2;
        if (g < gap) [gap, lead] = [Math.max(0.1, g), Math.max(0, o.v * Math.cos(o.heading - a.heading))];
      }
      for (const o of blocks) {
        const [dx, dy] = [o.p[0] - a.x, o.p[1] - a.y];
        const along = dx * Math.cos(a.heading) + dy * Math.sin(a.heading);
        const across = -dx * Math.sin(a.heading) + dy * Math.cos(a.heading);
        if (along > 0 && along < TRAFFIC.lookAhead && Math.abs(across) < TRAFFIC.laneHalf + 0.6) {
          const g = along - a.len / 2 - o.half;
          if (g < gap) [gap, lead] = [Math.max(0.1, g), Math.max(0, o.speed * Math.cos(o.heading - a.heading))];
        }
      }
      a.v = Math.max(0, a.v + idmAccel(a.v, v0, gap, lead) * dt);
      a.s += a.v * dt;
      a.odo += a.v * dt;
      this.advance(a);
      this.place(a);
    }
    this.release();
  }

  /** The player hit this car: it leaves the flow (the physics moves it now). */
  knock(id: number) {
    const a = this.agents.find((x) => x.id === id);
    if (!a || a.knocked) return;
    a.knocked = true;
    a.v = 0;
    this.drop(a);
  }

  /** Where the physics has a knocked car (map position, heading). */
  moveKnocked(id: number, x: number, y: number, z: number, heading: number) {
    const a = this.agents.find((k) => k.id === id);
    if (!a || !a.knocked) return;
    Object.assign(a, { x, y, z, heading });
  }

  /** Everything gone (leaving the drive). */
  clear() {
    this.agents.length = 0;
    this.holders.clear();
    this.queues.clear();
    this.filled = false;
  }

  // --- Spawning and despawning.

  private despawn(player: Point) {
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i];
      const d = Math.hypot(a.x - player[0], a.y - player[1]);
      if (d > (a.knocked ? TRAFFIC.knockedGone : TRAFFIC.despawn) || (!a.knocked && a.next < 0 && this.graph.edges[a.edge].length - a.s < a.len / 2 + 2 && a.v < 0.5)) {
        this.drop(a);
        this.agents.splice(i, 1);
      }
    }
  }

  private spawn(player: Point) {
    const min = this.filled ? TRAFFIC.spawnMin : TRAFFIC.firstMin;
    // A few tries per step: the city fills over a couple of seconds, without a hitch.
    for (let tries = 0; tries < 12 && this.agents.length < this.count && this.usableList.length; tries++) {
      const total = this.usableLength[this.usableLength.length - 1];
      const r = this.rand() * total;
      let lo = 0;
      let hi = this.usableLength.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.usableLength[mid] < r) lo = mid + 1;
        else hi = mid;
      }
      const ei = this.usableList[lo];
      const e = this.graph.edges[ei];
      // On the clear part of the road: not in a junction polygon, not at a stop line.
      const [from, to] = [e.trimStart + 6, e.length - e.trimEnd - TRAFFIC.reserveAt];
      if (to <= from) continue;
      const s = from + this.rand() * (to - from);
      const lane = Math.floor(this.rand() * e.lanes);
      const at = this.poseAt(e, s, lane);
      const d = Math.hypot(at.x - player[0], at.y - player[1]);
      if (d < min || d > TRAFFIC.spawnMax) continue;
      if (this.agents.some((o) => (o.edge === ei && o.lane === lane && Math.abs(o.s - s) < TRAFFIC.spawnRoom) || Math.hypot(o.x - at.x, o.y - at.y) < 8)) continue;
      const model = this.pick(this.opts.models.map((m) => m.weight));
      const [len, width] = this.opts.models[model].size;
      const v0 = (TRAFFIC.speed[e.cls] ?? 10) * (0.85 + 0.3 * this.rand());
      const a: Agent = { id: this.nextId++, edge: ei, next: -1, after: -1, lane, s, v: v0 * 0.7, v0, len, width, model, paint: this.pick(this.opts.paints), knocked: false, odo: 0, held: [], waiting: -1, waitSince: 0, ...at };
      a.next = this.chooseNext(ei);
      a.after = a.next >= 0 ? this.chooseNext(a.next) : -1;
      this.agents.push(a);
    }
    if (this.agents.length >= this.count) this.filled = true;
  }

  private pick(weights: number[]): number {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = this.rand() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  // --- Moving along.

  /** Is this road part of a junction (too little of it between the polygons at its ends to wait on)? */
  private internal(e: GraphEdge): boolean {
    return e.length - e.trimStart - e.trimEnd < TRAFFIC.cluster;
  }

  /** Turn angle (radians, + left) from the end of edge a onto edge b. */
  private turnOf(a: number, b: number): number {
    const [ea, eb] = [this.graph.edges[a], this.graph.edges[b]];
    const [p, q] = [ea.points[ea.points.length - 2], ea.points[ea.points.length - 1]];
    const [r, t] = [eb.points[0], eb.points[1]];
    return wrap(Math.atan2(t[1] - r[1], t[0] - r[0]) - Math.atan2(q[1] - p[1], q[0] - p[0]));
  }

  private chooseNext(edge: number): number {
    const e = this.graph.edges[edge];
    const options = this.graph.out[e.to].filter((n) => this.usable[n] && n !== e.twin);
    if (!options.length) return e.twin >= 0 && this.usable[e.twin] ? e.twin : -1;
    const weights = options.map((n) => (Math.abs(this.turnOf(edge, n)) < 0.5 ? 3 : 1) * (this.graph.edges[n].cls === 'major' ? 1.5 : 1));
    return options[this.pick(weights)];
  }

  private advance(a: Agent) {
    let e = this.graph.edges[a.edge];
    while (a.s > e.length && a.next >= 0) {
      a.s -= e.length;
      // Out of a junction (onto a road that leaves it): count from here how far it's gone past.
      const next = this.graph.edges[a.next];
      if (!this.internal(next)) {
        const h = a.held.find((x) => x.junction === this.group[next.from] && x.passedAt === null);
        // Counted from where the junction polygon ends on the road out.
        if (h) h.passedAt = a.odo - a.s + next.trimStart;
      }
      a.edge = a.next;
      e = this.graph.edges[a.edge];
      a.lane = this.freeLane(a, e);
      a.next = a.after;
      a.after = a.next >= 0 ? this.chooseNext(a.next) : -1;
    }
    if (a.next < 0) a.s = Math.min(a.s, e.length);
  }

  /**
   * The lane a car takes onto a new edge: its own if the edge has it, else the nearest one
   * (by index) with nobody alongside, so two cars from lanes that end don't land in one.
   */
  private freeLane(a: Agent, e: GraphEdge): number {
    const want = Math.min(a.lane, e.lanes - 1);
    const free = (lane: number) => !this.agents.some((o) => o !== a && !o.knocked && o.edge === a.edge && o.lane === lane && Math.abs(o.s - a.s) < (o.len + a.len) / 2 + 2);
    for (let d = 0; d < e.lanes; d++) for (const lane of [want - d, want + d]) if (lane >= 0 && lane < e.lanes && free(lane)) return lane;
    return want;
  }

  /** The nearest car ahead in a's lane (this edge, then the next): [gap bumper to bumper, its speed], or null. */
  private leader(a: Agent, lanes: Map<string, Agent[]>): [number, number] | null {
    const list = lanes.get(`${a.edge}/${a.lane}`) ?? [];
    let best: [number, number] | null = null;
    for (const o of list) {
      if (o === a || o.s <= a.s) continue;
      const g = o.s - o.len / 2 - (a.s + a.len / 2);
      if (!best || g < best[0]) best = [g, o.v];
    }
    if (best) return best;
    if (a.next < 0) return null;
    const left = this.graph.edges[a.edge].length - a.s;
    if (left > TRAFFIC.lookAhead) return null;
    const next = this.graph.edges[a.next];
    // Any lane of the next edge: cars merging into it count.
    for (let lane = 0; lane < next.lanes; lane++) {
      for (const o of lanes.get(`${a.next}/${lane}`) ?? []) {
        if (Math.abs(laneOffset(next, lane) - laneOffset(next, Math.min(a.lane, next.lanes - 1))) > 2) continue;
        const g = left + o.s - o.len / 2 - a.len / 2;
        if (!best || g < best[0]) best = [g, o.v];
      }
    }
    return best;
  }

  private laneLists(): Map<string, Agent[]> {
    const m = new Map<string, Agent[]>();
    for (const a of this.agents) {
      if (a.knocked) continue;
      const k = `${a.edge}/${a.lane}`;
      const l = m.get(k);
      if (l) l.push(a);
      else m.set(k, [a]);
    }
    return m;
  }

  // --- Junctions.

  /**
   * Can two movements through the same node go together? Only cars following each other
   * along the same path through it (same road and lane in, same road out). Letting straight-on
   * movements from opposite sides share a node was tried: the map's junctions are
   * irregular enough near their nodes that paths still crossed. With light traffic,
   * taking turns costs little.
   */
  private compatible(m: Movement, n: Movement): boolean {
    return m.inEdge === n.inEdge && m.outEdge === n.outEdge && m.agent.lane === n.agent.lane;
  }

  /** Asks for a junction; true once a holds it. The movement is the road in and the first road out of the junction. */
  private request(a: Agent, junction: number): boolean {
    let out = a.next;
    // Through a short link inside the junction: what counts is where it leaves.
    if (out >= 0 && this.internal(this.graph.edges[out]) && a.after >= 0) out = a.after;
    const queue = this.queues.get(junction) ?? [];
    let me = queue.find((m) => m.agent === a);
    if (!me) {
      me = { agent: a, inEdge: a.edge, outEdge: out };
      queue.push(me);
      this.queues.set(junction, queue);
      a.waiting = junction;
      a.waitSince = this.time;
    }
    const holders = this.holders.get(junction) ?? [];
    const earlier = queue.slice(0, queue.indexOf(me));
    if (!holders.every((h) => this.compatible(h, me)) || !earlier.every((w) => this.compatible(w, me))) return false;
    this.remove(this.queues, junction, a);
    holders.push(me);
    this.holders.set(junction, holders);
    a.waiting = -1;
    return true;
  }

  /** Lets go of junctions cars are clear of: out of them by their length and a margin. */
  private release() {
    for (const a of this.agents) {
      for (let k = a.held.length - 1; k >= 0; k--) {
        const h = a.held[k];
        if (h.passedAt === null || a.odo - h.passedAt <= a.len + TRAFFIC.releasePast) continue;
        a.held.splice(k, 1);
        this.remove(this.holders, h.junction, a);
      }
    }
  }

  /** Takes a car's movement out of one node's list (holders or queue), dropping the list once it's empty. */
  private remove(lists: Map<number, Movement[]>, node: number, a: Agent) {
    const list = lists.get(node);
    if (!list) return;
    const i = list.findIndex((m) => m.agent === a);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) lists.delete(node);
  }

  /** Takes a car out of every queue and node. */
  private drop(a: Agent) {
    for (const h of a.held) this.remove(this.holders, h.junction, a);
    if (a.waiting >= 0) this.remove(this.queues, a.waiting, a);
    a.held.length = 0;
    a.waiting = -1;
  }

  // --- Poses.

  private poseAt(e: GraphEdge, s: number, lane: number): { x: number; y: number; z: number; heading: number; pitch: number } {
    let i = 0;
    while (i < e.points.length - 2 && e.acc[i + 1] < s) i++;
    const [p, q] = [e.points[i], e.points[i + 1]];
    const seg = e.acc[i + 1] - e.acc[i] || 1;
    const t = Math.max(0, Math.min(1, (s - e.acc[i]) / seg));
    const heading = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const off = laneOffset(e, lane);
    return {
      x: p[0] + (q[0] - p[0]) * t + Math.sin(heading) * off,
      y: p[1] + (q[1] - p[1]) * t - Math.cos(heading) * off,
      z: e.z[i] + (e.z[i + 1] - e.z[i]) * t,
      heading,
      pitch: Math.atan2(e.z[i + 1] - e.z[i], seg),
    };
  }

  private place(a: Agent) {
    Object.assign(a, this.poseAt(this.graph.edges[a.edge], Math.min(a.s, this.graph.edges[a.edge].length), a.lane));
  }
}

/** Map road indices with parked cars along them (a parked car within its half width plus a bit of its center line). */
export function roadsWithParking(roads: { points: Point[]; w: number; cls: string }[], parked: { p: Point }[]): Set<number> {
  const out = new Set<number>();
  if (!parked.length) return out;
  const cell = 40;
  const grid = new Map<string, number[]>();
  parked.forEach((c, i) => {
    const k = `${Math.floor(c.p[0] / cell)},${Math.floor(c.p[1] / cell)}`;
    grid.set(k, [...(grid.get(k) ?? []), i]);
  });
  roads.forEach((r, ri) => {
    if (r.cls === 'path') return;
    for (let i = 0; i + 1 < r.points.length && !out.has(ri); i++) {
      const [a, b] = [r.points[i], r.points[i + 1]];
      const [x0, x1] = [Math.floor(Math.min(a[0], b[0]) / cell) - 1, Math.floor(Math.max(a[0], b[0]) / cell) + 1];
      const [y0, y1] = [Math.floor(Math.min(a[1], b[1]) / cell) - 1, Math.floor(Math.max(a[1], b[1]) / cell) + 1];
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const l2 = dx * dx + dy * dy || 1;
      for (let gx = x0; gx <= x1 && !out.has(ri); gx++)
        for (let gy = y0; gy <= y1 && !out.has(ri); gy++)
          for (const ci of grid.get(`${gx},${gy}`) ?? []) {
            const p = parked[ci].p;
            const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
            if (t < 0 || t > 1) continue;
            if (Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t) < r.w / 2 + 0.5) {
              out.add(ri);
              break;
            }
          }
    }
  });
  return out;
}
