/**
 * Bollards and concrete blocks left standing in a road's lanes. OSM maps them as points,
 * usually on the road's line, so they land on the centerline. Where they close the road
 * (a row across it, src/routing/closures.ts) that's what they're for, and they stay. Where
 * the road stays open around them, a block in the middle of a lane is a placement error:
 * the real one stands at the side. Those move to just past the curb on their side of the
 * road (or the right side, if they're on the centerline), or are dropped if that's inside a
 * building or on another road.
 *
 * `fixturesInLanes` is the same test for map QA (kind `fixture-in-lanes`).
 */
import { distanceToSegment } from '../src/geometry/polygon';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import type { Fixture, Point, Road } from '../src/map/types';
import { closedRoads } from '../src/routing/closures';

export const FIXTURE_LANES = {
  /** A fixture counts as in the lanes when it reaches more than this far (m) in from the road's edge. */
  edge: 0.6,
  /** Moved ones stand this far (m) past the edge of the road. */
  past: 0.15,
};

/** Half sizes (m): along their `rot`, and across it. Bollards are round. */
const HALF = { bollard: [0.11, 0.11], block: [0.75, 0.3] } as const;

const drivable = (r: Road) => r.cls !== 'path' && !r.scenery && !r.tunnel && !(r.z && r.z.some((z) => z > 1));

interface Hit {
  road: number;
  /** Signed distance from the centerline (m, + right of the road's direction), the nearest point on it and the right-hand normal. */
  signed: number;
  foot: Point;
  normal: Point;
  /** How far the fixture reaches across the road from its center (m). */
  across: number;
}

function roadGrid(roads: Road[]) {
  const grid = new SegmentGrid<number>(30);
  roads.forEach((r, ri) => {
    if (!drivable(r)) return;
    for (let i = 0; i + 1 < r.points.length; i++) grid.insert(r.points[i], r.points[i + 1], ri);
  });
  return grid;
}

/** The roads whose lanes a fixture at `p` (turned `rot`) stands in: deeper than `edge` from the road's edge. */
function lanesHit(roads: Road[], grid: SegmentGrid<number>, kind: 'bollard' | 'block', p: Point, rot: number): Hit[] {
  const hits = new Map<number, Hit>();
  for (const { item, a, b } of grid.query(p, p, 20)) {
    const r = roads[item];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(dx, dy) || 1;
    const d = distanceToSegment(p, a, b);
    const dir = Math.atan2(dy, dx);
    const [along, side] = HALF[kind];
    const across = Math.abs(Math.sin(rot - dir)) * along + Math.abs(Math.cos(rot - dir)) * side;
    if (d - across >= r.w / 2 - FIXTURE_LANES.edge) continue;
    const prev = hits.get(item);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len)));
    const signed = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
    if (!prev || Math.abs(signed) < Math.abs(prev.signed)) hits.set(item, { road: item, signed, foot: [a[0] + dx * t, a[1] + dy * t], normal: [dy / len, -dx / len], across });
  }
  return [...hits.values()];
}

const solid = (f: Fixture): f is Fixture & { kind: 'bollard' | 'block' } => f.kind === 'bollard' || f.kind === 'block';

/** The open road a fixture is stray in, if any: none if it's in the lanes of a road it helps close (it's doing its job there, even if it also reaches into a road beside). */
const strayHit = (hits: Hit[], closed: Set<number>): Hit | undefined => (hits.some((h) => closed.has(h.road)) ? undefined : hits[0]);

/** Bollards and blocks in the lanes of a road they don't close. */
export function fixturesInLanes(roads: Road[], fixtures: Fixture[]): { fixture: Fixture; road: Road }[] {
  const closed = closedRoads(roads, fixtures);
  const grid = roadGrid(roads);
  const out: { fixture: Fixture; road: Road }[] = [];
  for (const f of fixtures) {
    if (!solid(f)) continue;
    const hit = strayHit(lanesHit(roads, grid, f.kind, f.p, f.rot), closed);
    if (hit) out.push({ fixture: f, road: roads[hit.road] });
  }
  return out;
}

/** Moves bollards and blocks out of the lanes of roads they don't close (see the top). `blocked`: inside a building. */
export function moveOutOfLanes(roads: Road[], fixtures: Fixture[], blocked: (p: Point) => boolean = () => false): { fixtures: Fixture[]; moved: number; dropped: number } {
  const closed = closedRoads(roads, fixtures);
  const grid = roadGrid(roads);
  const out: Fixture[] = [];
  let [moved, dropped] = [0, 0];
  for (const f of fixtures) {
    const hit = solid(f) ? strayHit(lanesHit(roads, grid, f.kind, f.p, f.rot), closed) : undefined;
    if (!hit || !solid(f)) {
      out.push(f);
      continue;
    }
    const r = roads[hit.road];
    const offset = r.w / 2 + hit.across + FIXTURE_LANES.past;
    // Its own side first (the right if it's on the centerline), then the other.
    const first = hit.signed < -0.05 ? -1 : 1;
    let placed: Point | null = null;
    for (const side of [first, -first]) {
      const p: Point = [Math.round((hit.foot[0] + hit.normal[0] * offset * side) * 100) / 100, Math.round((hit.foot[1] + hit.normal[1] * offset * side) * 100) / 100];
      if (blocked(p) || lanesHit(roads, grid, f.kind, p, f.rot).length) continue;
      placed = p;
      break;
    }
    if (placed) {
      out.push({ ...f, p: placed });
      moved++;
    } else dropped++;
  }
  return { fixtures: out, moved, dropped };
}
