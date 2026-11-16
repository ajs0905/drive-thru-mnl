/**
 * Roads a car can't get through: bollards or concrete blocks standing across the
 * carriageway (mapped as barriers on the road, often a street closed to cars). They're
 * solid in the game, so a route through them is a route into a wall.
 *
 * For each road, the bollards and blocks on it are grouped by where they stand along it
 * (within 2.5 m: one row); a row closes the road when the widest free gap across the
 * road between them and the curbs is narrower than a car needs.
 */
import { distanceToSegment } from '../geometry/polygon';
import { SegmentGrid } from '../geometry/spatialGrid';
import type { Fixture, Road } from '../map/types';

/** Narrowest gap (m) a car fits through: 1.9 m of body plus room. */
export const CAR_GAP = 2.6;
/** Half widths (m) across and along of what blocks: bollards are 0.22 m posts, blocks 1.5 x 0.6 m. */
const HALF = { bollard: [0.11, 0.11], block: [0.75, 0.3] } as const;

/** Indices of the roads closed to cars. O(F log S) with a grid of the road segments (F fixtures, S segments). */
export function closedRoads(roads: Road[], fixtures: Fixture[]): Set<number> {
  const closed = new Set<number>();
  const solid = fixtures.filter((f) => f.kind === 'bollard' || f.kind === 'block');
  if (!solid.length) return closed;
  const grid = new SegmentGrid<{ road: number; i: number; s0: number }>(30);
  roads.forEach((r, ri) => {
    if (r.cls === 'path' || r.points.length < 2) return;
    let acc = 0;
    for (let i = 0; i + 1 < r.points.length; i++) {
      grid.insert(r.points[i], r.points[i + 1], { road: ri, i, s0: acc });
      acc += Math.hypot(r.points[i + 1][0] - r.points[i][0], r.points[i + 1][1] - r.points[i][1]);
    }
  });
  // Each fixture on a road: how far along (s) and across (d, + to the left) it is, and how wide it stands across.
  const onRoad = new Map<number, { s: number; d: number; r: number }[]>();
  for (const f of solid) {
    const seen = new Set<number>();
    for (const { item, a, b } of grid.query(f.p, f.p, 15)) {
      const r = roads[item.road];
      if (seen.has(item.road) || distanceToSegment(f.p, a, b) >= r.w / 2 + 0.3) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const [dx, dy] = [f.p[0] - a[0], f.p[1] - a[1]];
      const t = dx * ux + dy * uy;
      if (t < -0.5 || t > len + 0.5) continue;
      seen.add(item.road);
      const [hx, hy] = HALF[f.kind as 'bollard' | 'block'];
      const turn = f.rot - Math.atan2(uy, ux);
      const list = onRoad.get(item.road) ?? [];
      list.push({ s: item.s0 + t, d: -dx * uy + dy * ux, r: Math.abs(Math.cos(turn)) * hy + Math.abs(Math.sin(turn)) * hx });
      onRoad.set(item.road, list);
    }
  }
  for (const [ri, on] of onRoad) {
    const half = roads[ri].w / 2;
    on.sort((x, y) => x.s - y.s);
    for (let i = 0; i < on.length; ) {
      let j = i;
      while (j + 1 < on.length && on[j + 1].s - on[i].s < 2.5) j++;
      const row = on.slice(i, j + 1).sort((x, y) => x.d - x.r - (y.d - y.r));
      // The widest free stretch across the road, from curb to curb, between the pieces.
      let edge = -half;
      let widest = 0;
      for (const p of row) {
        widest = Math.max(widest, p.d - p.r - edge);
        edge = Math.max(edge, p.d + p.r);
      }
      widest = Math.max(widest, half - edge);
      if (widest < CAR_GAP) {
        closed.add(ri);
        break;
      }
      i = j + 1;
    }
  }
  return closed;
}
