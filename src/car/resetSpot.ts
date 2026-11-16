/**
 * Where the reset key puts the car: the nearest spot on a road wide enough to drive off
 * from, with room around it. Resetting in place used to leave the car wedged where it was
 * stuck (against a wall, between a pillar and a parked car, in a narrow alley).
 *
 * Candidate spots lie along every drivable road at least `minRoadWidth` wide, every
 * `step` meters, in the right-hand lane of two-way roads. The nearest spot (counting a
 * height difference three times, so a car under a flyover isn't put on its deck) whose
 * car footprint keeps `clearance` meters from buildings, walls, pillars and the playable
 * edge, and doesn't touch a parked car or solid street furniture, wins. The car faces
 * along the road, the way closest to where it was heading (one-way roads: their way), at
 * the road's height. Deck spots skip the ground checks: the deck has its own barriers.
 */
import { DRESSING, dressingCorners } from '../geometry/dressing';
import { pillarCorners } from '../geometry/road';
import { pointInRing, segmentDistanceToRing } from '../geometry/polygon';
import { SegmentGrid } from '../geometry/spatialGrid';
import type { MapData, Point, Road } from '../map/types';
import { PARKED_MODELS } from './parked';

export const RESET_SPOT = {
  /** Only roads at least this wide (m). */
  minRoadWidth: 6,
  /** Room kept between the car's footprint and buildings, walls, pillars and the edge (m). */
  clearance: 3,
  /** Spacing of the candidate spots along a road (m), and the farthest a reset moves the car (m). */
  step: 4,
  reach: 250,
  /** The car's footprint (m): length and width, mirrors included. */
  size: [4.45, 2.4] as const,
  /** A height difference counts this many times its meters when picking the nearest spot. */
  heightWeight: 3,
  /** Spots on a road higher than this (m) are deck spots. */
  deck: 1,
  /** Room kept from loose pieces passed in `avoid` (roadblock cones, drums, barricades) (m). */
  looseRoom: 1.5,
};

export interface ResetSpot {
  /** Map position (m) and heading (radians counter-clockwise from east). */
  p: Point;
  heading: number;
  /** Height of the road above the ground there (its `z`), and its class (for its surface height). */
  z: number;
  cls: Road['cls'];
}

interface Candidate extends ResetSpot {
  oneway: boolean;
  /** How far right of the centerline the car goes (m): 0 on one-way roads. */
  off: number;
}

/** The car's footprint corners at p facing `heading`, grown by `margin` (m). */
export function carCorners(p: Point, heading: number, margin = 0): Point[] {
  const [hl, hw] = [RESET_SPOT.size[0] / 2 + margin, RESET_SPOT.size[1] / 2 + margin];
  const [c, s] = [Math.cos(heading), Math.sin(heading)];
  return [
    [p[0] + c * hl - s * hw, p[1] + s * hl + c * hw],
    [p[0] - c * hl - s * hw, p[1] - s * hl + c * hw],
    [p[0] - c * hl + s * hw, p[1] - s * hl - c * hw],
    [p[0] + c * hl + s * hw, p[1] + s * hl - c * hw],
  ];
}

/** Do two convex polygons overlap (separating axis test)? */
function overlaps(a: Point[], b: Point[]): boolean {
  for (const ring of [a, b])
    for (let i = 0; i < ring.length; i++) {
      const [p, q] = [ring[i], ring[(i + 1) % ring.length]];
      const n: Point = [q[1] - p[1], p[0] - q[0]];
      const span = (r: Point[]) => r.map((v) => v[0] * n[0] + v[1] * n[1]);
      const [sa, sb] = [span(a), span(b)];
      if (Math.max(...sa) <= Math.min(...sb) || Math.max(...sb) <= Math.min(...sa)) return false;
    }
  return true;
}

const drivable = (r: Road) => r.cls !== 'path' && !r.scenery && !r.tunnel && r.w >= RESET_SPOT.minRoadWidth;

/**
 * Builds the lookup once per map (spots and obstacles in grids), and returns the search:
 * the reset spot nearest `at` (map space) at height `y` (m above the ground), for a car
 * heading `heading`, or null if none is clear within `RESET_SPOT.reach`.
 */
export function resetSpotFinder(
  map: Pick<MapData, 'roads' | 'buildings'> & Partial<Pick<MapData, 'barriers' | 'pillars' | 'playable' | 'parked' | 'dressing'>>,
  avoid: Point[] = [],
): (at: Point, heading: number, y?: number) => ResetSpot | null {
  const R = RESET_SPOT;
  const spots = new SegmentGrid<Candidate>(40);
  for (const road of map.roads) {
    if (!drivable(road)) continue;
    // Two-way roads: the right-hand lane of the way it's drawn (flipped when the car faces
    // the other way, see below), a quarter of the width off the centerline, at most 2 m.
    const off = road.oneway ? 0 : Math.min(road.w / 4, 2);
    for (let i = 0; i + 1 < road.points.length; i++) {
      const [a, b] = [road.points[i], road.points[i + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1) continue;
      const heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const [za, zb] = [road.z?.[i] ?? 0, road.z?.[i + 1] ?? 0];
      const n = Math.max(1, Math.round(len / R.step));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const p: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        spots.insert(p, p, { p, heading, z: za + (zb - za) * t, cls: road.cls, oneway: !!road.oneway, off });
      }
    }
  }

  const hard = new SegmentGrid<true>(30);
  const rings = new SegmentGrid<Point[]>(60);
  for (const b of map.buildings) {
    if (b.scenery || (b.minH ?? 0) > 2.5) continue;
    for (const ring of b.rings) for (let i = 0; i < ring.length; i++) hard.insert(ring[i], ring[(i + 1) % ring.length], true);
    const r = b.rings[0];
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of r) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    rings.insert([x0, y0], [x1, y1], r);
  }
  for (const w of map.barriers ?? []) {
    if (w.scenery) continue;
    for (let i = 0; i + 1 < w.points.length; i++) hard.insert(w.points[i], w.points[i + 1], true);
  }
  for (const p of map.pillars ?? []) {
    const c = pillarCorners(p);
    for (let i = 0; i < 4; i++) hard.insert(c[i], c[(i + 1) % 4], true);
  }
  const edge = map.playable ?? [];
  for (let i = 0; i < edge.length; i++) hard.insert(edge[i], edge[(i + 1) % edge.length], true);
  // Things the car shouldn't appear inside of, but may stand close to.
  const soft = new SegmentGrid<Point[]>(30);
  const addSoft = (foot: Point[]) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of foot) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    soft.insert([x0, y0], [x1, y1], foot);
  };
  for (const c of map.parked ?? []) {
    const [l, w] = PARKED_MODELS[c.v]?.size ?? [4.6, 1.9];
    const [hl, hw] = [l / 2, w / 2];
    const [cs, sn] = [Math.cos(c.rot), Math.sin(c.rot)];
    addSoft([
      [c.p[0] + cs * hl - sn * hw, c.p[1] + sn * hl + cs * hw],
      [c.p[0] - cs * hl - sn * hw, c.p[1] - sn * hl + cs * hw],
      [c.p[0] - cs * hl + sn * hw, c.p[1] - sn * hl - cs * hw],
      [c.p[0] + cs * hl + sn * hw, c.p[1] + sn * hl - cs * hw],
    ]);
  }
  for (const d of map.dressing ?? []) if (DRESSING[d.k].solid) addSoft(dressingCorners(d.k, d.p, d.rot));
  // Loose pieces (the roadblocks' cones and barricades): a small square around each.
  const r = R.looseRoom;
  for (const q of avoid) addSoft([[q[0] - r, q[1] - r], [q[0] + r, q[1] - r], [q[0] + r, q[1] + r], [q[0] - r, q[1] + r]]);

  const clear = (p: Point, heading: number, deck: boolean): boolean => {
    const foot = carCorners(p, heading);
    const reach = R.clearance + R.size[0];
    const [lo, hi]: Point[] = [[p[0] - reach, p[1] - reach], [p[0] + reach, p[1] + reach]];
    if (!deck) {
      if (edge.length >= 3 && !pointInRing(p, edge)) return false;
      if (hard.query(lo, hi).some((e) => segmentDistanceToRing(e.a, e.b, foot) < R.clearance)) return false;
      if (rings.query(p, p).some((e) => pointInRing(p, e.item))) return false;
      if (soft.query(lo, hi).some((e) => overlaps(foot, e.item))) return false;
    }
    return true;
  };

  return (at: Point, heading: number, y = 0) => {
    const near = spots
      .query([at[0] - R.reach, at[1] - R.reach], [at[0] + R.reach, at[1] + R.reach])
      .map((e) => e.item)
      .map((c) => ({ c, d: Math.hypot(c.p[0] - at[0], c.p[1] - at[1], (c.z - y) * R.heightWeight) }))
      .filter((x) => x.d <= R.reach)
      .sort((x, y2) => x.d - y2.d);
    const seen = new Set<Candidate>();
    for (const { c } of near) {
      if (seen.has(c)) continue;
      seen.add(c);
      // Face the road's way closest to the car's heading (one-way roads: their way).
      const flip = !c.oneway && Math.cos(c.heading - heading) < 0;
      const h = flip ? c.heading + Math.PI : c.heading;
      // Keep right: to the right of the way the car faces.
      const p: Point = [c.p[0] + Math.sin(h) * c.off, c.p[1] - Math.cos(h) * c.off];
      const deck = c.z > R.deck;
      if (!clear(p, h, deck)) continue;
      return { p, heading: Math.atan2(Math.sin(h), Math.cos(h)), z: c.z, cls: c.cls };
    }
    return null;
  };
}
