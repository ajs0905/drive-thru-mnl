/**
 * Road heights: raises flyovers and footbridges and builds ramps up to them.
 *
 * OSM only says "this way is a bridge on layer 1". It doesn't say how high, or where
 * the slope is. The rules here:
 *
 *  1. Roads are connected where they share a point (same OSM node -> same coordinates).
 *  2. A chain of connected bridge ways is raised only if some part of it crosses over
 *     another road. Small bridges over creeks stay at ground level.
 *  3. Raised decks sit at layer x 7 m (drivable) or layer x 6 m (footbridges).
 *  4. Where a deck meets a ground road ("attachment"), the ground road becomes the
 *     ramp: it climbs from 0 to deck height over up to 90 m (20 m for walkways),
 *     stopping early at the first junction so side streets aren't lifted.
 *  5. If there's no room for a ramp on the ground side (a junction right at the foot
 *     of the bridge), the bridge itself slopes down instead.
 *
 * Ramp heights follow a smoothstep curve, and extra points are inserted along ramps so
 * the slope isn't one long straight line.
 */
import type { Point, Road } from '../src/map/types';
import { SegmentGrid, segmentsCross } from '../src/geometry/spatialGrid';

export const DECK_HEIGHT = { drive: 7, walk: 6 } as const;
export const RAMP = {
  drive: { length: 90, min: 25 },
  walk: { length: 20, min: 3 },
} as const;

type Net = 'drive' | 'walk';
const netOf = (r: Road): Net => (r.cls === 'path' ? 'walk' : 'drive');
const keyOf = (p: Point) => `${p[0]},${p[1]}`;
const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const dist = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A road is a candidate for raising if OSM puts it above ground and it isn't a tunnel. */
export const isRaisedCandidate = (r: Road) => !r.tunnel && (r.bridge === true || (r.layer ?? 0) > 0);

interface Insert {
  seg: number; // segment index (between points seg and seg+1)
  t: number; // 0..1 from points[seg]
  z: number;
}

interface Step {
  road: number;
  from: number; // point index
  to: number; // point index (from +/- 1)
  d0: number;
  d1: number;
}

export interface ElevationStats {
  raisedRoads: number;
  rampsOnGround: number;
  rampsOnBridge: number;
  bridgesLeftAtGround: number;
}

export function elevateRoads(input: Road[]): { roads: Road[]; stats: ElevationStats } {
  const roads = input.map((r) => ({ ...r, points: r.points }));

  // Node index per network: node key -> list of [road, point index].
  const at = { drive: new Map<string, [number, number][]>(), walk: new Map<string, [number, number][]>() };
  roads.forEach((r, ri) =>
    r.points.forEach((p, pi) => {
      const m = at[netOf(r)];
      const k = keyOf(p);
      const list = m.get(k);
      if (list) list.push([ri, pi]);
      else m.set(k, [[ri, pi]]);
    }),
  );

  const neighbors = (net: Net, k: string): Set<string> => {
    const s = new Set<string>();
    for (const [ri, pi] of at[net].get(k) ?? []) {
      const pts = roads[ri].points;
      if (pi > 0) s.add(keyOf(pts[pi - 1]));
      if (pi < pts.length - 1) s.add(keyOf(pts[pi + 1]));
    }
    return s;
  };

  // --- 2. Which bridge chains actually pass over a road? -----------------------------
  const candidate = roads.map(isRaisedCandidate);
  const parent = roads.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const net of ['drive', 'walk'] as Net[]) {
    for (const list of at[net].values()) {
      const cands = list.map(([ri]) => ri).filter((ri) => candidate[ri]);
      for (let i = 1; i < cands.length; i++) parent[find(cands[i])] = find(cands[0]);
    }
  }

  const grid = new SegmentGrid<number>(40);
  roads.forEach((r, ri) => {
    if (candidate[ri]) return;
    for (let i = 0; i < r.points.length - 1; i++) grid.insert(r.points[i], r.points[i + 1], ri);
  });
  const crossesRoad = new Set<number>(); // component roots
  roads.forEach((r, ri) => {
    if (!candidate[ri]) return;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [a, b] = [r.points[i], r.points[i + 1]];
      if (grid.query(a, b).some((e) => segmentsCross(a, b, e.a, e.b))) {
        crossesRoad.add(find(ri));
        return;
      }
    }
  });

  const raised = roads.map((_, ri) => candidate[ri] && crossesRoad.has(find(ri)));
  const deck = (r: Road) => Math.max(1, r.layer ?? 1) * DECK_HEIGHT[netOf(r)];

  // --- 3. Decks -----------------------------------------------------------------------
  const nodeZ = new Map<string, number>();
  const nodeCap = new Map<string, number>(); // lowered by bridge-side ramps
  const raisedNode = new Set<string>();
  roads.forEach((r, ri) => {
    if (!raised[ri]) return;
    const h = deck(r);
    for (const p of r.points) {
      const k = keyOf(p);
      raisedNode.add(k);
      nodeZ.set(k, Math.max(nodeZ.get(k) ?? 0, h));
    }
  });

  const inserts = roads.map((): Insert[] => []);

  /**
   * Walks from a point along one road in one direction and keeps going through
   * plain joins (nodes with exactly 2 neighbors) into the next road, up to maxDist.
   * Stops at junctions, dead ends, or when the road type (raised or not) changes.
   */
  function walk(net: Net, startRoad: number, startIdx: number, dir: 1 | -1, maxDist: number, wantRaised: boolean): Step[] {
    const steps: Step[] = [];
    const seen = new Set<string>([keyOf(roads[startRoad].points[startIdx])]);
    let ri = startRoad;
    let i = startIdx;
    let d = 0;
    for (;;) {
      const pts = roads[ri].points;
      const j = i + dir;
      if (j < 0 || j >= pts.length) {
        // End of this way: continue into the next way if this is a plain join.
        const k = keyOf(pts[i]);
        if (neighbors(net, k).size !== 2) break;
        const next = (at[net].get(k) ?? []).find(([r2]) => r2 !== ri && raised[r2] === wantRaised);
        if (!next) break;
        const [r2, i2] = next;
        const len = roads[r2].points.length;
        // The next way must start or end here; anything else would be a junction.
        if (i2 !== 0 && i2 !== len - 1) break;
        ri = r2;
        i = i2;
        dir = i2 === 0 ? 1 : -1;
        continue;
      }
      const k = keyOf(pts[j]);
      if (seen.has(k)) break;
      seen.add(k);
      const len = dist(pts[i], pts[j]);
      steps.push({ road: ri, from: i, to: j, d0: d, d1: d + len });
      d += len;
      if (d >= maxDist) break;
      // A junction in the middle of a way also ends the walk.
      if (neighbors(net, k).size > 2) break;
      i = j;
    }
    return steps;
  }

  /** Adds ramp sample points inside the walked segments at the given distances. */
  function sample(steps: Step[], distances: number[], zAt: (d: number) => number) {
    for (const s of steps) {
      for (const target of distances) {
        if (target <= s.d0 + 0.5 || target >= s.d1 - 0.5) continue;
        const f = (target - s.d0) / (s.d1 - s.d0);
        const seg = Math.min(s.from, s.to);
        inserts[s.road].push({ seg, t: s.from < s.to ? f : 1 - f, z: zAt(target) });
      }
    }
  }

  const stats: ElevationStats = { raisedRoads: raised.filter(Boolean).length, rampsOnGround: 0, rampsOnBridge: 0, bridgesLeftAtGround: 0 };
  stats.bridgesLeftAtGround = candidate.filter((c, i) => c && !raised[i]).length;

  // --- 4 & 5. Ramps at each attachment ---------------------------------------------------
  for (const net of ['drive', 'walk'] as Net[]) {
    const { length: R, min: MIN } = RAMP[net];
    for (const [k, list] of at[net]) {
      if (!raisedNode.has(k)) continue;
      const groundHere = list.filter(([ri]) => !raised[ri]);
      const raisedHere = list.filter(([ri]) => raised[ri]);
      if (groundHere.length === 0 || raisedHere.length === 0) continue;
      const h = nodeZ.get(k) ?? 0;

      // Try the ground side: every ground direction leaving this node.
      const plainJoin = neighbors(net, k).size === 2;
      const groundWalks: Step[][] = [];
      if (plainJoin) {
        for (const [ri, pi] of groundHere) {
          const len = roads[ri].points.length;
          if (pi > 0) groundWalks.push(walk(net, ri, pi, -1, R, false));
          if (pi < len - 1) groundWalks.push(walk(net, ri, pi, 1, R, false));
        }
      }
      const room = groundWalks.length ? Math.min(...groundWalks.map((w) => (w.length ? w[w.length - 1].d1 : 0))) : 0;

      if (plainJoin && room >= MIN) {
        const L = Math.min(room, R);
        const zAt = (d: number) => round2(h * smooth(1 - d / L));
        for (const steps of groundWalks) {
          for (const s of steps) {
            const pk = keyOf(roads[s.road].points[s.to]);
            nodeZ.set(pk, Math.max(nodeZ.get(pk) ?? 0, zAt(s.d1)));
          }
          sample(steps, [L / 4, L / 2, (3 * L) / 4, L], zAt);
        }
        stats.rampsOnGround++;
      } else {
        // No room on the ground: slope the bridge down to this node instead.
        nodeCap.set(k, 0);
        for (const [ri, pi] of raisedHere) {
          const len = roads[ri].points.length;
          const dirs: (1 | -1)[] = [];
          if (pi > 0) dirs.push(-1);
          if (pi < len - 1) dirs.push(1);
          for (const dir of dirs) {
            const steps = walk(net, ri, pi, dir, R, true);
            const zAt = (d: number) => round2(h * smooth(d / R));
            for (const s of steps) {
              const pk = keyOf(roads[s.road].points[s.to]);
              nodeCap.set(pk, Math.min(nodeCap.get(pk) ?? Infinity, zAt(s.d1)));
            }
            sample(steps, [R / 4, R / 2, (3 * R) / 4], zAt);
          }
        }
        stats.rampsOnBridge++;
      }
    }
  }

  // --- Rebuild roads with heights and inserted ramp points --------------------------------
  const zOf = (p: Point) => {
    const k = keyOf(p);
    return Math.min(nodeZ.get(k) ?? 0, nodeCap.get(k) ?? Infinity);
  };

  const out = roads.map((r, ri) => {
    const ins = inserts[ri].sort((a, b) => a.seg - b.seg || a.t - b.t);
    const points: Point[] = [];
    const z: number[] = [];
    let n = 0;
    for (let i = 0; i < r.points.length; i++) {
      points.push(r.points[i]);
      z.push(zOf(r.points[i]));
      while (n < ins.length && ins[n].seg === i) {
        const { t } = ins[n];
        const [a, b] = [r.points[i], r.points[i + 1]];
        const p: Point = [round2(a[0] + (b[0] - a[0]) * t), round2(a[1] + (b[1] - a[1]) * t)];
        const prev = points[points.length - 1];
        if (dist(prev, p) > 0.3 && dist(p, b) > 0.3) {
          points.push(p);
          z.push(ins[n].z);
        }
        n++;
      }
    }
    const { z: _old, ...rest } = r;
    return z.some((v) => v > 0) ? { ...rest, points, z } : { ...rest, points };
  });

  return { roads: out, stats };
}
