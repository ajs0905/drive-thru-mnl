/**
 * Cars parked along the curbs, so the streets aren't empty.
 *
 * OSM barely maps street parking here (a few dozen "no parking" tags), so it's placed by
 * rule on minor streets, and only where a car can still get past: at least
 * `PARKING.clearOneway` of road left beside the parked cars on a one-way street,
 * `clearTwoway` on a two-way one. Narrow village streets get none (a parked car would
 * block them). One-way streets park on the right curb only (the Philippines drives on
 * the right, and the left of a one-way street is often the median of a divided one);
 * two-way streets on both sides, or on one if there's only room for one. Sides tagged
 * "no parking" stay empty.
 *
 * Along each side, slots are `slot` meters apart and grouped into stretches of a few
 * slots. Some stretches stay empty, the rest are filled by a seeded coin, so there are
 * long empty runs as well as natural gaps. A slot is skipped near a junction, on a sharp bend, near a crossing,
 * a gate, boom or bollard (likely a driveway), a tree trunk or a pillar, and anywhere the
 * car would stand in a junction, another road's lanes, a building, across a wall or the
 * playable edge.
 * Everything is seeded by the road's id, so the same map always gets the same cars.
 */
import { PARKED_MODELS, PARKED_PAINTS, pickWeighted } from '../src/car/parked';
import { distanceToSegment, pointInRing, ringBounds, segmentDistanceToRing } from '../src/geometry/polygon';
import { pillarCorners } from '../src/geometry/road';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import { seeded } from '../src/map/hash';
import type { MapData, ParkedCar, Point, Road } from '../src/map/types';

export const PARKING = {
  /** Road widths left free beside the parked cars (m). */
  clearOneway: 3.2,
  clearTwoway: 5.6,
  /** Room a parked car takes across the road (m, mirrors included) and its gap to the curb. */
  carWidth: 2.4,
  curbGap: 0.2,
  /** Slot length along the curb (m). */
  slot: 6.2,
  /** Slots per stretch (min, max), the share of stretches with cars, and the share of slots filled in those (about 30% overall). */
  stretch: [3, 8] as const,
  stretchOn: 0.6,
  fill: 0.5,
  /** Room kept from a junction polygon, and from a road end without one (m). */
  fromJunction: 4,
  fromEnd: 2,
  /** No parking where the road turns more than this (degrees) over one slot. */
  maxBend: 12,
  /** Room kept around crossings, fixtures (driveways), trunks and pillars (m). */
  fromCrossing: 3,
  fromFixture: 3,
  fromTree: 0.6,
  fromPillar: 0.8,
  /** Street classes that get parked cars. */
  classes: ['minor'] as Road['cls'][],
} as const;

export interface ParkingStats {
  roads: number;
  slots: number;
  cars: number;
  skipped: Record<string, number>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const keyOf = (p: Point) => `${p[0]},${p[1]}`;

/** Position and heading at arc length s along a polyline. */
function along(pts: Point[], acc: number[], s: number): { p: Point; dir: number } {
  let i = 0;
  while (i < pts.length - 2 && acc[i + 1] < s) i++;
  const seg = acc[i + 1] - acc[i] || 1;
  const t = Math.max(0, Math.min(1, (s - acc[i]) / seg));
  const [a, b] = [pts[i], pts[i + 1]];
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

/** A car's footprint: rectangle corners (map space), counter-clockwise. */
export function carFootprint(p: Point, rot: number, length: number, width: number): Point[] {
  const [c, s] = [Math.cos(rot), Math.sin(rot)];
  const [l, w] = [length / 2, width / 2];
  return [
    [p[0] - c * l + s * w, p[1] - s * l - c * w],
    [p[0] + c * l + s * w, p[1] + s * l - c * w],
    [p[0] + c * l - s * w, p[1] + s * l + c * w],
    [p[0] - c * l - s * w, p[1] - s * l + c * w],
  ];
}

/** Distance from a point to a convex polygon (0 inside). */
function distanceToPolygon(q: Point, ring: Point[]): number {
  if (pointInRing(q, ring)) return 0;
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) d = Math.min(d, distanceToSegment(q, ring[i], ring[(i + 1) % ring.length]));
  return d;
}

/** Do two convex polygons overlap (separating axis test)? */
function overlaps(a: Point[], b: Point[]): boolean {
  for (const ring of [a, b]) {
    for (let i = 0; i < ring.length; i++) {
      const [p, q] = [ring[i], ring[(i + 1) % ring.length]];
      const n: Point = [q[1] - p[1], p[0] - q[0]];
      const proj = (r: Point[]) => r.map((v) => v[0] * n[0] + v[1] * n[1]);
      const [pa, pb] = [proj(a), proj(b)];
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

/** The longest parked model plus a little: the footprint every slot is checked with. */
export const SLOT_LENGTH = Math.max(...PARKED_MODELS.map((m) => m.size[0])) + 0.4;

/**
 * What a parked car must keep clear of: returns a check giving the reason a car with this
 * footprint can't park here (or undefined if it can). Also used by map QA.
 */
export function parkingBlockers(map: MapData): { blocked: (road: Road | undefined, foot: Point[], center: Point) => string | undefined; shared: Map<string, number> } {
  const drive = new SegmentGrid<Road>(30);
  const shared = new Map<string, number>();
  for (const r of map.roads) {
    if (r.cls === 'path') continue;
    for (let i = 0; i < r.points.length - 1; i++) drive.insert(r.points[i], r.points[i + 1], r);
    for (const p of r.points) shared.set(keyOf(p), (shared.get(keyOf(p)) ?? 0) + 1);
  }
  const junctionEdges = new SegmentGrid<number>(30);
  (map.junctions ?? []).forEach((j, ji) => {
    for (let i = 0; i < j.ring.length; i++) junctionEdges.insert(j.ring[i], j.ring[(i + 1) % j.ring.length], ji);
  });
  const points = new SegmentGrid<{ kind: 'tree' | 'fixture'; p: Point }>(30);
  for (const t of map.trees ?? []) points.insert(t.p, t.p, { kind: 'tree', p: t.p });
  for (const f of map.fixtures ?? []) points.insert(f.p, f.p, { kind: 'fixture', p: f.p });
  const pillars = new SegmentGrid<Point[]>(30);
  for (const p of map.pillars ?? []) pillars.insert(p.p, p.p, pillarCorners(p));
  const zebras = new SegmentGrid<Point[]>(30);
  for (const c of map.crossings ?? []) {
    const [dx, dy] = c.dir;
    const len = Math.hypot(dx, dy) || 1;
    const [ux, uy] = [dx / len, dy / len];
    const [hl, hw] = [c.w / 2 + PARKING.fromCrossing, c.half + 1];
    const ring: Point[] = [
      [c.c[0] - ux * hl + uy * hw, c.c[1] - uy * hl - ux * hw],
      [c.c[0] + ux * hl + uy * hw, c.c[1] + uy * hl - ux * hw],
      [c.c[0] + ux * hl - uy * hw, c.c[1] + uy * hl + ux * hw],
      [c.c[0] - ux * hl - uy * hw, c.c[1] - uy * hl + ux * hw],
    ];
    const b = ringBounds(ring);
    zebras.insert([b.minX, b.minY], [b.maxX, b.maxY], ring);
  }
  const buildings = new SegmentGrid<number>(30);
  map.buildings.forEach((b, bi) => {
    if ((b.minH ?? 0) > 2.5) return; // things park under canopies
    const r = b.rings[0];
    for (let i = 0; i < r.length; i++) buildings.insert(r[i], r[(i + 1) % r.length], bi);
  });
  const walls = new SegmentGrid<true>(30);
  for (const w of map.barriers ?? []) for (let i = 0; i < w.points.length - 1; i++) walls.insert(w.points[i], w.points[i + 1], true);
  // The playable edge is a wall too (and nothing parks outside it).
  const edge = map.playable ?? [];
  for (let i = 0; i < edge.length; i++) walls.insert(edge[i], edge[(i + 1) % edge.length], true);

  const blocked = (road: Road | undefined, foot: Point[], center: Point): string | undefined => {
    const b = ringBounds(foot);
    const [lo, hi]: Point[] = [[b.minX - 4, b.minY - 4], [b.maxX + 4, b.maxY + 4]];
    for (const { item } of points.query(lo, hi)) {
      const room = item.kind === 'tree' ? PARKING.fromTree : PARKING.fromFixture;
      if (distanceToPolygon(item.p, foot) < room) return item.kind;
    }
    for (const { item } of pillars.query(lo, hi)) {
      if (overlaps(foot, item) || item.some((q) => distanceToPolygon(q, foot) < PARKING.fromPillar)) return 'pillar';
    }
    for (const { item } of zebras.query(lo, hi)) if (overlaps(foot, item)) return 'crossing';
    const near = junctionEdges.query(lo, hi).map((e) => e.item);
    for (const ji of new Set(near)) {
      const ring = map.junctions[ji].ring;
      if (foot.some((q) => pointInRing(q, ring)) || distanceToPolygon(center, ring) < PARKING.fromJunction) return 'junction';
    }
    for (const e of drive.query(lo, hi)) {
      if (e.item === road) continue;
      if (foot.some((q) => distanceToSegment(q, e.a, e.b) < e.item.w / 2) || distanceToSegment(center, e.a, e.b) < e.item.w / 2 + 1) return 'other-road';
    }
    for (const e of buildings.query(lo, hi)) {
      const ring = map.buildings[e.item].rings[0];
      if (segmentDistanceToRing(e.a, e.b, foot) < 0.2 || pointInRing(center, ring)) return 'building';
    }
    for (const e of walls.query(lo, hi)) if (segmentDistanceToRing(e.a, e.b, foot) < 0.3) return 'wall';
    if (edge.length >= 3 && !pointInRing(center, edge)) return 'outside';
    return undefined;
  };
  return { blocked, shared };
}

export function placeParkedCars(map: MapData): { parked: ParkedCar[]; stats: ParkingStats } {
  const stats: ParkingStats = { roads: 0, slots: 0, cars: 0, skipped: {} };
  const skip = (why: string) => {
    stats.skipped[why] = (stats.skipped[why] ?? 0) + 1;
  };
  const parked: ParkedCar[] = [];
  const { blocked, shared } = parkingBlockers(map);

  for (const road of map.roads) {
    if (!PARKING.classes.includes(road.cls) || road.scenery || road.z || road.points.length < 2) continue;
    const room = PARKING.carWidth + PARKING.curbGap;
    const spare = road.w - (road.oneway ? PARKING.clearOneway : PARKING.clearTwoway);
    if (spare < room) continue;
    const rand = seeded(`parking:${road.id}`);
    // Sides: +1 is the left of the way's direction, -1 the right.
    let sides: (1 | -1)[] = road.oneway ? [-1] : spare >= 2 * room ? [-1, 1] : [rand() < 0.5 ? -1 : 1];
    if (road.noParking === 'both') sides = [];
    else if (road.noParking) sides = sides.filter((s) => s !== (road.noParking === 'left' ? 1 : -1));
    if (!sides.length) continue;

    const pts = road.points;
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = acc[acc.length - 1];
    const endRoom = (atStart: boolean) => {
      const trim = road.trim?.[atStart ? 0 : 1] ?? -1;
      if (trim >= 0) return trim + PARKING.fromJunction;
      return (shared.get(keyOf(pts[atStart ? 0 : pts.length - 1])) ?? 0) > 1 ? 0.5 : PARKING.fromEnd;
    };
    const [from, to] = [endRoom(true), total - endRoom(false)];
    if (to - from < PARKING.slot) continue;
    stats.roads++;

    for (const side of sides) {
      const offset = road.w / 2 - PARKING.curbGap - PARKING.carWidth / 2;
      const count = Math.floor((to - from) / PARKING.slot);
      const start = from + (to - from - count * PARKING.slot) / 2 + PARKING.slot / 2;
      let [left, on] = [0, false];
      for (let k = 0; k < count; k++) {
        stats.slots++;
        if (left === 0) {
          const [lo, hi] = PARKING.stretch;
          left = lo + Math.floor(rand() * (hi - lo + 1));
          on = rand() < PARKING.stretchOn;
        }
        left--;
        const s = start + k * PARKING.slot;
        const fill = rand();
        const pickModel = rand();
        const pickPaint = rand();
        if (!on || fill >= PARKING.fill) continue;
        const { p: c, dir } = along(pts, acc, s);
        const bend = Math.abs(along(pts, acc, s + PARKING.slot / 2).dir - along(pts, acc, s - PARKING.slot / 2).dir);
        if (Math.min(bend, 2 * Math.PI - bend) > (PARKING.maxBend * Math.PI) / 180) {
          skip('bend');
          continue;
        }
        const [nx, ny] = [-Math.sin(dir), Math.cos(dir)];
        const center: Point = [c[0] + nx * offset * side, c[1] + ny * offset * side];
        // With the traffic on that side: on two-way streets, cars on the left face the other way.
        const rot = !road.oneway && side === 1 ? dir + Math.PI : dir;
        const foot = carFootprint(center, rot, SLOT_LENGTH, PARKING.carWidth);
        const why = blocked(road, foot, center);
        if (why) {
          skip(why);
          continue;
        }
        const v = pickWeighted(PARKED_MODELS.map((m) => m.weight), pickModel);
        const paint = pickWeighted(PARKED_PAINTS.map((m) => m.weight), pickPaint);
        parked.push({ p: [round2(center[0]), round2(center[1])], rot: round3(Math.atan2(Math.sin(rot), Math.cos(rot))), v, c: paint });
      }
    }
  }
  stats.cars = parked.length;
  return { parked, stats };
}
