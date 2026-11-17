/**
 * Live traffic signals: every intersection with traffic lights (the pipeline's `signal`
 * and `signalpole` dressing, pipeline/lights.ts) runs a fixed two-phase cycle, and the
 * traffic obeys it (traffic/sim.ts). Pure and deterministic: the time is advanced by the
 * caller, so the renderer and the simulation read the same lights.
 *
 * - **Intersections**: a light pole belongs to the junction (traffic/sim.ts
 *   `junctionGroups`: nodes joined by roads too short to wait on, so a divided avenue's
 *   crossing is one) nearest it, within `SIGNAL.reach`.
 * - **Phases**: two, by direction of travel. The intersection's axis is its busiest
 *   approach (avenues first, then the longest); approaches running along that axis
 *   (either way) are phase 0, across it phase 1. A light's heads face the traffic coming
 *   at them, so a pole's phase is its heads' facing turned round, by the same rule.
 * - **Cycle**: green, amber, all red, then the other phase the same, `SIGNAL.cycle` s in
 *   all. Each intersection starts at its own point in the cycle (seeded by its node), so
 *   the city's lights don't all change together.
 *
 * The player can run a red light; nothing stops the player's car (Kamote Mode will count it).
 */
import { seeded } from '../map/hash';
import type { DressingKind, Point } from '../map/types';
import type { RoadGraph } from '../routing/graph';
import { internalEdge, junctionGroups } from './junctions';

export const SIGNAL = {
  /** Seconds of green, amber, and all red (both phases stopped) per phase. */
  green: 18,
  amber: 3,
  allRed: 2,
  /** A pole belongs to the nearest junction node within this far (m). */
  reach: 40,
};

/** One full cycle (s): both phases' green, amber and all red. */
export const CYCLE = 2 * (SIGNAL.green + SIGNAL.amber + SIGNAL.allRed);

export type Lamp = 'red' | 'amber' | 'green';

/** The lamp a phase shows `t` seconds into the cycle (phase 1 runs half a cycle behind phase 0). */
export function lampAt(phase: 0 | 1, t: number): Lamp {
  const half = CYCLE / 2;
  const u = (((t - phase * half) % CYCLE) + CYCLE) % CYCLE;
  if (u < SIGNAL.green) return 'green';
  if (u < SIGNAL.green + SIGNAL.amber) return 'amber';
  return 'red';
}

/** Which phase a direction of travel (radians) belongs to, for an intersection whose axis is `axis`. */
export function phaseOf(direction: number, axis: number): 0 | 1 {
  return Math.abs(Math.cos(direction - axis)) >= Math.SQRT1_2 ? 0 : 1;
}

export interface SignalJunction {
  /** The junction's id (a node standing for its group) and its center (map space). */
  group: number;
  center: Point;
  /** The axis of phase 0 (radians) and where in the cycle it starts (s). */
  axis: number;
  offset: number;
}

export interface SignalPole {
  /** Index into the pieces given to the constructor, its junction (index into `junctions`) and the phase its heads show. */
  piece: number;
  junction: number;
  phase: 0 | 1;
}

export class Signals {
  /** Seconds the signals have run (advanced by the caller). */
  time = 0;
  readonly junctions: SignalJunction[] = [];
  readonly poles: SignalPole[] = [];
  /** Per graph edge that enters a signalled junction: the junction (index into `junctions`) and its phase; -1 for every other edge. */
  private readonly approachJunction: Int32Array;
  private readonly approachPhase: Uint8Array;

  constructor(graph: RoadGraph, pieces: { k: DressingKind; p: Point; rot: number }[], groups: Int32Array = junctionGroups(graph)) {
    this.approachJunction = new Int32Array(graph.edges.length).fill(-1);
    this.approachPhase = new Uint8Array(graph.edges.length);
    // Each signal pole to the junction of its nearest node.
    const byGroup = new Map<number, number>();
    const poleGroups: { piece: number; group: number }[] = [];
    pieces.forEach((d, i) => {
      if (d.k !== 'signal' && d.k !== 'signalpole') return;
      let [best, node] = [SIGNAL.reach, -1];
      graph.nodes.forEach((n, ni) => {
        const dist = Math.hypot(n[0] - d.p[0], n[1] - d.p[1]);
        if (dist < best) [best, node] = [dist, ni];
      });
      if (node >= 0) poleGroups.push({ piece: i, group: groups[node] });
    });
    for (const { group } of poleGroups) {
      if (byGroup.has(group)) continue;
      byGroup.set(group, this.junctions.length);
      this.junctions.push({ group, center: [0, 0], axis: 0, offset: 0 });
    }
    // Approaches: roads into each junction from outside it. The axis follows the busiest.
    const approaches = this.junctions.map(() => [] as { edge: number; dir: number; weight: number }[]);
    graph.edges.forEach((e, ei) => {
      const j = byGroup.get(groups[e.to]);
      if (j === undefined || (internalEdge(e) && groups[e.from] === groups[e.to])) return;
      const [p, q] = [e.points[e.points.length - 2], e.points[e.points.length - 1]];
      approaches[j].push({ edge: ei, dir: Math.atan2(q[1] - p[1], q[0] - p[0]), weight: (e.cls === 'major' ? 1e6 : 0) + e.length * e.lanes });
    });
    this.junctions.forEach((junction, j) => {
      const list = approaches[j];
      const nodes = graph.nodes.filter((_, ni) => groups[ni] === junction.group);
      junction.center = [nodes.reduce((s, n) => s + n[0], 0) / nodes.length, nodes.reduce((s, n) => s + n[1], 0) / nodes.length];
      junction.axis = list.length ? list.reduce((a, b) => (b.weight > a.weight ? b : a)).dir : 0;
      junction.offset = seeded(`signal:${junction.group}`)() * CYCLE;
      for (const a of list) {
        this.approachJunction[a.edge] = j;
        this.approachPhase[a.edge] = phaseOf(a.dir, junction.axis);
      }
    });
    // A pole's heads face the traffic coming at them (the model's -z, the left of the arm's
    // direction `rot`), so that traffic travels the other way: to the arm's right.
    for (const { piece, group } of poleGroups) {
      const j = byGroup.get(group)!;
      const rot = pieces[piece].rot;
      this.poles.push({ piece, junction: j, phase: phaseOf(Math.atan2(-Math.cos(rot), Math.sin(rot)), this.junctions[j].axis) });
    }
  }

  advance(dt: number) {
    this.time += dt;
  }

  /** The lamp a junction's phase shows now. */
  lamp(junction: number, phase: 0 | 1): Lamp {
    return lampAt(phase, this.time + this.junctions[junction].offset);
  }

  /** What a car on this edge sees at its end: the lamp for its approach, or undefined if the junction ahead has no signals. */
  edgeLamp(edge: number): Lamp | undefined {
    const j = this.approachJunction[edge];
    return j < 0 ? undefined : this.lamp(j, this.approachPhase[edge] as 0 | 1);
  }

  /** The phase an approach edge is in (-1 if it doesn't enter a signalled junction). */
  phaseOfEdge(edge: number): number {
    return this.approachJunction[edge] < 0 ? -1 : this.approachPhase[edge];
  }
}
