/**
 * Road graph and junctions for drivable roads.
 *
 *  1. Split roads at every junction node, so every junction sits at road ends
 *     (OSM ways often run straight through an intersection).
 *  2. At each node where road ends meet, build one junction polygon
 *     (src/geometry/junction.ts) and record how far each road end is cut back.
 *  3. Fill in lane counts for every drivable road (tagged, or derived from width).
 *
 * Paths (footways, crossings) are not part of the graph; they're drawn on their own.
 */
import { isPlainContinuation, junctionShape, type Arm, type JunctionShape } from '../src/geometry/junction';
import { convexHull, ringArea } from '../src/geometry/polygon';
import { laneCount, RANK } from '../src/map/roads';
import type { Junction, Point, Road } from '../src/map/types';

const keyOf = (p: Point) => `${p[0]},${p[1]}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface JunctionStats {
  split: number;
  junctions: number;
  continuations: number;
  failed: number;
  /** Groups of nearby junctions (divided roads crossing) merged into one polygon. */
  clusters: number;
  merged: number;
}

/** A connector shorter than this after both ends are cut back joins its junctions into one. */
const CLUSTER_GAP = 3;
/** Merged junctions wider than this stay separate (a hull would swallow too much). */
const CLUSTER_MAX_SIZE = 80;

function splitAt(r: Road, cutIdx: number[]): Road[] {
  if (cutIdx.length === 0) return [r];
  const bounds = [0, ...cutIdx, r.points.length - 1];
  return bounds.slice(0, -1).map((from, k) => {
    const to = bounds[k + 1];
    return {
      ...r,
      id: `${r.id}/${k}`,
      points: r.points.slice(from, to + 1),
      ...(r.z && { z: r.z.slice(from, to + 1) }),
    };
  });
}

function length(points: Point[]): number {
  let d = 0;
  for (let i = 0; i < points.length - 1; i++) d += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  return d;
}

/**
 * Direction leaving a road end, towards the point `reach` meters along the road
 * (at least the first point 1 m away). Aiming at where the road will be cut back
 * makes the junction polygon follow curved roads.
 */
export function leavingDir(points: Point[], fromStart: boolean, reach = 1): Point {
  const pts = fromStart ? points : [...points].reverse();
  const o = pts[0];
  let target = pts[pts.length - 1];
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (walked + seg >= reach && Math.hypot(pts[i][0] - o[0], pts[i][1] - o[1]) >= 1) {
      const t = Math.max(0, Math.min(1, (reach - walked) / (seg || 1)));
      const p: Point = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      target = Math.hypot(p[0] - o[0], p[1] - o[1]) >= 1 ? p : pts[i];
      break;
    }
    walked += seg;
  }
  const dx = target[0] - o[0];
  const dy = target[1] - o[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

export function buildJunctions(input: Road[]): { roads: Road[]; junctions: Junction[]; stats: JunctionStats } {
  const stats: JunctionStats = { split: 0, junctions: 0, continuations: 0, failed: 0, clusters: 0, merged: 0 };
  const isDrive = (r: Road) => r.cls !== 'path';

  // --- 1. Split at junction nodes -------------------------------------------------------
  const neighbors = new Map<string, Set<string>>();
  for (const r of input) {
    if (!isDrive(r)) continue;
    r.points.forEach((p, i) => {
      const k = keyOf(p);
      const set = neighbors.get(k) ?? neighbors.set(k, new Set()).get(k)!;
      if (i > 0) set.add(keyOf(r.points[i - 1]));
      if (i < r.points.length - 1) set.add(keyOf(r.points[i + 1]));
    });
  }
  const roads: Road[] = [];
  for (const r of input) {
    if (!isDrive(r)) {
      roads.push(r);
      continue;
    }
    const cuts: number[] = [];
    for (let i = 1; i < r.points.length - 1; i++) if ((neighbors.get(keyOf(r.points[i]))?.size ?? 0) >= 3) cuts.push(i);
    const pieces = splitAt(r, cuts);
    stats.split += pieces.length - 1;
    for (const p of pieces) roads.push({ ...p, lanes: laneCount(p) });
  }

  // --- 2. Junction polygons at road ends -------------------------------------------------
  const ends = new Map<string, { ri: number; atStart: boolean }[]>();
  roads.forEach((r, ri) => {
    if (!isDrive(r)) return;
    for (const atStart of [true, false]) {
      const k = keyOf(atStart ? r.points[0] : r.points[r.points.length - 1]);
      const list = ends.get(k) ?? ends.set(k, []).get(k)!;
      list.push({ ri, atStart });
    }
  });

  const trims = roads.map((): [number, number] => [-1, -1]);
  const lengths = roads.map((r) => length(r.points));
  interface NodeJunction {
    key: string;
    shape: JunctionShape;
    z: number;
    cls: Road['cls'];
    list: { ri: number; atStart: boolean }[];
  }
  const found: NodeJunction[] = [];
  for (const [k, list] of ends) {
    if (list.length < 2) continue;
    const center = k.split(',').map(Number) as Point;
    const armsToward = (reach: number[]): Arm[] =>
      list.map(({ ri, atStart }, a) => ({
        dir: leavingDir(roads[ri].points, atStart, reach[a]),
        half: roads[ri].w / 2,
        len: lengths[ri],
      }));
    let arms = armsToward(list.map(() => 1));
    if (isPlainContinuation(arms)) {
      stats.continuations++;
      continue;
    }
    let shape = junctionShape(center, arms);
    // Refine: aim each arm at where it gets cut back, so curved roads line up.
    for (let pass = 0; pass < 2 && shape; pass++) {
      arms = armsToward(shape.cuts.map((c) => Math.max(1, c)));
      shape = junctionShape(center, arms) ?? shape;
    }
    if (!shape) {
      stats.failed++;
      continue;
    }
    const first = roads[list[0].ri];
    const z = list[0].atStart ? (first.z?.[0] ?? 0) : (first.z?.[first.points.length - 1] ?? 0);
    const cls = list.map(({ ri }) => roads[ri].cls).reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
    found.push({ key: k, shape, z, cls, list });
    list.forEach(({ ri, atStart }, a) => (trims[ri][atStart ? 0 : 1] = round2(shape.cuts[a])));
  }

  // --- 3. Merge junctions joined by a connector that's (almost) all cut away -------------
  // Where divided roads cross, each carriageway crossing gets its own polygon and the
  // short pieces between them vanish, leaving gaps. Those become one convex polygon.
  const index = new Map(found.map((f, i) => [f.key, i]));
  const parent = found.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const internal = new Set<number>();
  roads.forEach((r, ri) => {
    if (!isDrive(r) || trims[ri][0] < 0 || trims[ri][1] < 0) return;
    if (lengths[ri] - trims[ri][0] - trims[ri][1] >= CLUSTER_GAP) return;
    const a = index.get(keyOf(r.points[0]));
    const b = index.get(keyOf(r.points[r.points.length - 1]));
    if (a === undefined || b === undefined || a === b) return;
    if (Math.abs(found[a].z - found[b].z) > 0.5) return;
    internal.add(ri);
    parent[root(a)] = root(b);
  });
  const groups = new Map<number, number[]>();
  found.forEach((_, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), i]));

  const junctions: Junction[] = [];
  const add = (ring: Point[], z: number, cls: Road['cls']) =>
    junctions.push({ id: `j${junctions.length}`, ring: ring.map(([x, y]): Point => [round2(x), round2(y)]), z: round2(z), cls });
  const mergedRoots = new Set<number>();
  for (const [groupRoot, members] of groups) {
    const hull = members.length > 1 ? convexHull(members.flatMap((i) => found[i].shape.ring)) : null;
    let size = 0;
    if (hull) for (const p of hull) for (const q of hull) size = Math.max(size, Math.hypot(p[0] - q[0], p[1] - q[1]));
    if (hull && hull.length >= 3 && size <= CLUSTER_MAX_SIZE && ringArea(hull) > 0.5) {
      const cls = members.map((i) => found[i].cls).reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
      add(hull, members.reduce((sum, i) => sum + found[i].z, 0) / members.length, cls);
      stats.clusters++;
      stats.merged += members.length;
      mergedRoots.add(groupRoot);
    } else {
      for (const i of members) add(found[i].shape.ring, found[i].z, found[i].cls);
    }
  }
  stats.junctions = junctions.length;

  // Connectors inside a merged junction aren't drawn: the polygon covers them.
  for (const ri of internal) {
    if (mergedRoots.has(root(index.get(keyOf(roads[ri].points[0]))!))) trims[ri] = [round2(lengths[ri]), 0];
  }

  const out = roads.map((r, ri) => (trims[ri][0] === -1 && trims[ri][1] === -1 ? r : { ...r, trim: trims[ri] }));
  return { roads: out, junctions, stats };
}
