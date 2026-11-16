/**
 * Spots at the curb: the car parked parallel to the road on its right-hand side (traffic
 * keeps right), facing the way that side's lane goes. Free roam starts the car here, and
 * the cargo runs' loading bays and drop-offs use the same spots.
 *
 * A spot keeps the car's footprint clear of parked cars, solid street furniture, fixtures
 * (gates, booms, bollards: likely driveways), pillars, walls and zebra crossings, with room
 * to pull out ahead and to pull in from behind clear of parked cars and furniture too (no
 * car boxed in at the start of a drive or a run, none in the way of a drop-off), stays out
 * from beside or under a ramp or deck too low to drive under (its side walls reach the
 * ground), away from junctions and bends, and is on the ground (no flyovers). If the asked-for spot isn't clear it slides
 * along the curb, nearest first, up to `CURB.search` meters either way.
 */
import { DRESSING, dressingCorners } from '../geometry/dressing';
import { distanceToSegment, segmentDistanceToRing } from '../geometry/polygon';
import { pillarCorners } from '../geometry/road';
import { SegmentGrid } from '../geometry/spatialGrid';
import type { MapData, Point, Road } from '../map/types';
import { PARKED_MODELS } from './parked';
import { carCorners, footprintsOverlap, RESET_SPOT } from './resetSpot';
import { startPoint, startSpot, type Spawn } from './spawn';

export const CURB = {
  /** From the curb to the car's centerline (m): half the body (0.95) plus a gap. */
  gap: 1.3,
  /** Only roads at least this wide (m). */
  minWidth: 6,
  /** Spots keep this far (m) from the end of a road at a junction polygon (or its end). */
  fromJunction: 8,
  /** Slide this far (m) along the curb at most, in steps of `step`. */
  search: 80,
  step: 2,
  /** Room (m) kept around the car's footprint from parked cars and furniture. */
  room: 0.4,
  /** Clear lane (m) ahead of the car to pull out into, and behind it to pull in from. */
  ahead: 7,
  behind: 8,
  /** No spot where the road turns more than this (degrees) over 8 m. */
  maxBend: 12,
  /** Room (m) along the road kept from a zebra crossing's band. */
  crossingRoom: 3,
  /** Room (m) kept from walls and pillars, and from a ramp or deck lower than `lowDeck` (m) beside or over the spot. */
  wallRoom: 1,
  lowDeck: 5,
};

/** On the ground, drivable, a real street (not a service lane), wide enough to park on. */
export const curbRoad = (r: Road) =>
  (r.cls === 'major' || r.cls === 'minor') && !r.scenery && !r.bridge && !r.tunnel && !(r.z && r.z.some((h) => h > 0.5)) && r.w >= CURB.minWidth;

/** A curb spot, and the class of its road (for the road surface's height). */
export interface CurbSpot extends Spawn {
  cls: Road['cls'];
}

export interface CurbFinder {
  /** The curb spot nearest `p`; on two-way roads facing the way closest to `facing` (map heading), if given. */
  near(p: Point, facing?: number): CurbSpot | null;
  /** The curb spot on `road` at `s` meters along it, on the right of traffic going `forward` along its points (or against them). */
  along(road: Road, s: number, forward: boolean): CurbSpot | null;
}

/** `loose`: pieces that can be knocked about (the roadblocks' cones and barricades), kept clear too. */
export function curbFinder(map: Pick<MapData, 'roads'> & Partial<Pick<MapData, 'parked' | 'dressing' | 'fixtures' | 'crossings' | 'pillars' | 'barriers'>>, loose: Point[] = []): CurbFinder {
  const roads = map.roads.filter(curbRoad);
  const segments = new SegmentGrid<{ road: Road; i: number }>(40);
  for (const road of roads) for (let i = 0; i + 1 < road.points.length; i++) segments.insert(road.points[i], road.points[i + 1], { road, i });

  // What the car mustn't overlap.
  const blockers = new SegmentGrid<Point[]>(30);
  const block = (foot: Point[]) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of foot) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    blockers.insert([x0, y0], [x1, y1], foot);
  };
  for (const c of map.parked ?? []) {
    const [l, w] = PARKED_MODELS[c.v]?.size ?? [4.6, 1.9];
    const [hl, hw, cs, sn] = [l / 2, w / 2, Math.cos(c.rot), Math.sin(c.rot)];
    block([
      [c.p[0] + cs * hl - sn * hw, c.p[1] + sn * hl + cs * hw],
      [c.p[0] - cs * hl - sn * hw, c.p[1] - sn * hl + cs * hw],
      [c.p[0] - cs * hl + sn * hw, c.p[1] - sn * hl - cs * hw],
      [c.p[0] + cs * hl + sn * hw, c.p[1] + sn * hl - cs * hw],
    ]);
  }
  for (const d of map.dressing ?? []) if (DRESSING[d.k].solid) block(dressingCorners(d.k, d.p, d.rot));
  for (const f of map.fixtures ?? []) {
    const r = Math.max(1.5, (f.span ?? 0) / 2);
    block([[f.p[0] - r, f.p[1] - r], [f.p[0] + r, f.p[1] - r], [f.p[0] + r, f.p[1] + r], [f.p[0] - r, f.p[1] + r]]);
  }
  for (const q of map.pillars ?? []) block(pillarCorners(q));
  for (const q of loose) block([[q[0] - 1, q[1] - 1], [q[0] + 1, q[1] - 1], [q[0] + 1, q[1] + 1], [q[0] - 1, q[1] + 1]]);
  // Walls, and ramps and decks too low to drive under (their sides reach the ground): kept `wallRoom` away.
  const walls = new SegmentGrid<true>(30);
  for (const w of map.barriers ?? []) if (!w.scenery) for (let i = 0; i + 1 < w.points.length; i++) walls.insert(w.points[i], w.points[i + 1], true);
  const decks = new SegmentGrid<number>(30);
  for (const r of map.roads) {
    if (!r.z || r.cls === 'path') continue;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const z = Math.min(r.z[i], r.z[i + 1]);
      if (Math.max(r.z[i], r.z[i + 1]) > 0.5 && z < CURB.lowDeck) decks.insert(r.points[i], r.points[i + 1], r.w / 2);
    }
  }
  const crossings = map.crossings ?? [];

  const lengths = new Map<Road, number[]>();
  const accOf = (road: Road) => {
    let acc = lengths.get(road);
    if (!acc) {
      acc = [0];
      for (let i = 1; i < road.points.length; i++) acc.push(acc[i - 1] + Math.hypot(road.points[i][0] - road.points[i - 1][0], road.points[i][1] - road.points[i - 1][1]));
      lengths.set(road, acc);
    }
    return acc;
  };
  /** Point and direction (radians, along the points) at arc length s. */
  const at = (road: Road, acc: number[], s: number): { p: Point; dir: number } => {
    let i = 0;
    while (i < road.points.length - 2 && acc[i + 1] < s) i++;
    const [a, b] = [road.points[i], road.points[i + 1]];
    const t = Math.max(0, Math.min(1, (s - acc[i]) / (acc[i + 1] - acc[i] || 1)));
    return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  };

  const spotAt = (road: Road, acc: number[], s: number, forward: boolean): CurbSpot | null => {
    const { p: c, dir } = at(road, acc, s);
    const turn = Math.abs(at(road, acc, s + 4).dir - at(road, acc, s - 4).dir);
    if (Math.min(turn, 2 * Math.PI - turn) > (CURB.maxBend * Math.PI) / 180) return null;
    const h = forward ? dir : dir + Math.PI;
    const off = Math.max(0, road.w / 2 - CURB.gap);
    const p: Point = [c[0] + Math.sin(h) * off, c[1] - Math.cos(h) * off];
    for (const x of crossings) {
      const [dx, dy] = [p[0] - x.c[0], p[1] - x.c[1]];
      if (Math.abs(dx * x.dir[0] + dy * x.dir[1]) < x.w / 2 + CURB.crossingRoom && Math.abs(-dx * x.dir[1] + dy * x.dir[0]) < x.half + 2) return null;
    }
    const foot = carCorners(p, h, CURB.room);
    const [lo, hi]: Point[] = [[p[0] - 6, p[1] - 6], [p[0] + 6, p[1] + 6]];
    // The car's footprint, stretched along the curb lane by the room to pull out and in.
    const hw = RESET_SPOT.size[1] / 2 + CURB.room;
    const [front, back] = [RESET_SPOT.size[0] / 2 + CURB.ahead, RESET_SPOT.size[0] / 2 + CURB.behind];
    const [cs, sn] = [Math.cos(h), Math.sin(h)];
    const lane: Point[] = [
      [p[0] + cs * front - sn * hw, p[1] + sn * front + cs * hw],
      [p[0] - cs * back - sn * hw, p[1] - sn * back + cs * hw],
      [p[0] - cs * back + sn * hw, p[1] - sn * back - cs * hw],
      [p[0] + cs * front + sn * hw, p[1] + sn * front - cs * hw],
    ];
    const reach = Math.max(front, back) + 2;
    if (blockers.query([p[0] - reach, p[1] - reach], [p[0] + reach, p[1] + reach]).some((e) => footprintsOverlap(lane, e.item))) return null;
    if (walls.query(lo, hi).some((e) => segmentDistanceToRing(e.a, e.b, foot) < CURB.wallRoom)) return null;
    if (decks.query(lo, hi, 15).some((e) => foot.some((c) => distanceToSegment(c, e.a, e.b) < e.item + CURB.wallRoom))) return null;
    return { p, heading: Math.atan2(Math.sin(h), Math.cos(h)), cls: road.cls };
  };

  const along = (road: Road, s0: number, forward: boolean): CurbSpot | null => {
    const acc = accOf(road);
    const total = acc[acc.length - 1];
    const lo = Math.max(0, road.trim?.[0] ?? -1) + CURB.fromJunction;
    const hi = total - Math.max(0, road.trim?.[1] ?? -1) - CURB.fromJunction;
    if (hi < lo) return null;
    for (let k = 0; k <= CURB.search / CURB.step; k++) {
      for (const sign of k === 0 ? [1] : [1, -1]) {
        const s = s0 + sign * k * CURB.step;
        if (s < lo || s > hi) continue;
        const spot = spotAt(road, acc, s, forward);
        if (spot) return spot;
      }
    }
    return null;
  };

  const near = (p: Point, facing?: number): CurbSpot | null => {
    // The nearest roads first (by distance to their nearest segment), so a blocked one falls back to the next.
    const found = new Map<Road, { d: number; s: number; dir: number }>();
    for (let r = 60; r <= 480 && found.size < 3; r *= 2) {
      for (const { item } of segments.query([p[0] - r, p[1] - r], [p[0] + r, p[1] + r])) {
        const { road, i } = item;
        const [a, b] = [road.points[i], road.points[i + 1]];
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
        const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
        const prev = found.get(road);
        if (!prev || d < prev.d) found.set(road, { d, s: accOf(road)[i] + t * Math.sqrt(l2), dir: Math.atan2(dy, dx) });
      }
    }
    for (const [road, f] of [...found].sort((x, y) => x[1].d - y[1].d || (x[0].id < y[0].id ? -1 : 1))) {
      const forward = road.oneway || facing === undefined || Math.cos(f.dir - facing) >= 0;
      const spot = along(road, f.s, forward);
      if (spot) return spot;
    }
    return null;
  };

  return { near, along };
}

/**
 * Where free roam starts the car: parked at the curb nearest the middle of High Street
 * (`startPoint`), or in the lane there (`startSpot`) if no curb nearby is clear.
 */
export function curbStart(map: Parameters<typeof curbFinder>[0] & Pick<MapData, 'bounds' | 'playable'>, finder = curbFinder(map)): Spawn | null {
  return finder.near(startPoint(map)) ?? startSpot(map);
}
