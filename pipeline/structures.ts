/**
 * Pillars under flyovers and footbridges, and support posts under raised buildings and
 * canopies, placed once here so the renderer and the car's collisions use the same ones.
 *
 * Deck pillars go along the deck every `pillarEvery` meters (as before), but never in a
 * lane below: a pillar that would land in someone's lane slides along the deck, up to
 * half a spacing either way, to the nearest spot clear of every road underneath. A
 * two-way road at least `MEDIAN_ROAD` wide running along the deck may have it on its
 * centerline, where its median is (viaducts built over an avenue stand in its median;
 * a street crossing underneath gets none), so the pillar may also
 * shift sideways under the deck to line up with one. If nothing under the deck is clear
 * (a viaduct built right over a road), the pillar may stand just beside the deck, up to
 * `OUTRIGGER` past its edge, with a cap beam reaching under the deck (an outrigger pier,
 * as real viaducts over roads have). If that doesn't fit either, the deck spans further.
 *
 * Buildings that start above the ground (canopies over driveways, buildings over a
 * passage) used to float. They get slim posts along their outline every `every` meters,
 * except along walls that lean on another building (skybridges, wings: that building
 * carries them) and except where a post would stand on a road.
 */
import { distanceToSegment } from '../src/geometry/polygon';
import { DECKS, dedupeWithZ } from '../src/geometry/road';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import type { Building, Pillar, Point, Road } from '../src/map/types';

export const SUPPORTS = {
  /** Only buildings starting higher than this (m) need posts. */
  minLift: 2.5,
  /** Most room between posts along an outline (m). */
  every: 10,
  /** Post widths (m): canopies (at most `thin` m thick) and whole buildings. */
  canopy: 0.35,
  building: 0.8,
  thin: 2,
  /** Posts stand this far inside the outline (m). */
  inset: 0.5,
  /** A wall closer than this (m) to another building leans on it: no posts. */
  leans: 1.2,
} as const;

/** Room kept between a pillar's side and a road's edge (m). */
const ROAD_MARGIN = 0.3;
/** Two-way roads at least this wide (m) can have pillars in their median (centerline). */
const MEDIAN_ROAD = 10;
/** How far off a centerline (m) a median pillar may stand. */
const MEDIAN_SLACK = 0.5;
/** How far past the deck's edge (m) an outrigger pillar may stand. */
const OUTRIGGER = 2.5;
/** Pillars only where the deck's underside is more than this high (m). */
const MIN_TOP = 2;
/** A low curb around a road deck's pillar, reaching this far past its sides (m), where that keeps out of the lanes below. */
const CURB = 0.45;

export interface StructureStats {
  deckPillars: number;
  /** Deck pillars moved along the deck off a road. */
  moved: number;
  /** Pillars beside the deck with a cap beam reaching under it. */
  outriggers: number;
  /** Places left without a pillar (no spot clear of the roads below). */
  skipped: number;
  /** Deck pillars with a curb around their base. */
  curbs?: number;
  /** Raised buildings and canopies, and the posts under them. */
  raisedBuildings: number;
  supports: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function placeStructures(roads: Road[], buildings: Building[]): { pillars: Pillar[]; stats: StructureStats } {
  const stats: StructureStats = { deckPillars: 0, moved: 0, outriggers: 0, skipped: 0, raisedBuildings: 0, supports: 0 };
  const pillars: Pillar[] = [];

  // Drivable roads, to keep pillars and posts out of their lanes. A road counts where it's
  // lower than the pillar's top (it runs underneath).
  const grid = new SegmentGrid<[number, number]>(30);
  roads.forEach((r, ri) => {
    if (r.cls === 'path') return;
    for (let i = 0; i < r.points.length - 1; i++) grid.insert(r.points[i], r.points[i + 1], [ri, i]);
  });
  /** A two-way avenue whose segment a-b runs along a deck heading `along` (within 30 degrees). */
  const median = (r: Road, a: Point, b: Point, along: number) =>
    !r.oneway && r.w >= MEDIAN_ROAD && Math.abs(Math.sin(Math.atan2(b[1] - a[1], b[0] - a[0]) - along)) < 0.5;
  /**
   * True if a post `size` wide at p stands in the lanes of a road lower than `top`. With
   * `along` (a deck's heading), the median of an avenue running along it is allowed.
   */
  const onRoad = (p: Point, size: number, top: number, self?: Road, along?: number): boolean =>
    grid.query([p[0] - 20, p[1] - 20], [p[0] + 20, p[1] + 20]).some(({ a, b, item: [ri, i] }) => {
      const r = roads[ri];
      if (r === self) return false;
      const d = distanceToSegment(p, a, b);
      if (d >= r.w / 2 + size / 2 + ROAD_MARGIN) return false;
      if (along !== undefined && d <= MEDIAN_SLACK && median(r, a, b, along)) return false;
      const z = r.z ? Math.min(r.z[i], r.z[i + 1]) : 0;
      return z < top;
    });
  /** Centerline spots of avenues along the deck near p, within `reach` sideways (along normal n). */
  const medianSpots = (p: Point, n: Point, reach: number, top: number, along: number): Point[] =>
    grid
      .query([p[0] - 20, p[1] - 20], [p[0] + 20, p[1] + 20])
      .filter(({ a, b, item: [ri, i] }) => median(roads[ri], a, b, along) && (roads[ri].z ? Math.min(roads[ri].z![i], roads[ri].z![i + 1]) : 0) < top)
      .flatMap(({ a, b }) => {
        // Where the line through p along n meets this centerline segment.
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const den = n[0] * dy - n[1] * dx;
        if (Math.abs(den) < 1e-6) return [];
        const k = ((a[0] - p[0]) * dy - (a[1] - p[1]) * dx) / den;
        const u = ((a[0] - p[0]) * n[1] - (a[1] - p[1]) * n[0]) / den;
        return Math.abs(k) <= reach && u >= 0 && u <= 1 ? [[p[0] + n[0] * k, p[1] + n[1] * k] as Point] : [];
      });

  for (const road of roads) {
    if (!road.z) continue;
    const shape = road.cls === 'path' ? DECKS.walk : DECKS.drive;
    const { pts, zs } = dedupeWithZ(road.points, road.z);
    if (pts.length < 2) continue;
    // Arc length at each point, and a lookup of position, height and direction at s.
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = acc[acc.length - 1];
    const at = (s: number) => {
      let i = 0;
      while (i < pts.length - 2 && acc[i + 1] < s) i++;
      const seg = acc[i + 1] - acc[i] || 1;
      const t = Math.max(0, Math.min(1, (s - acc[i]) / seg));
      const [a, b] = [pts[i], pts[i + 1]];
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as Point, top: zs[i] + (zs[i + 1] - zs[i]) * t - shape.depth, rot: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    };
    const half = shape.pillarEvery / 2;
    for (let s0 = half; s0 <= total; s0 += shape.pillarEvery) {
      if (at(s0).top <= MIN_TOP) continue;
      // Nearest spot clear of the roads below: 0, +1, -1, +2, -2 ... up to half a spacing
      // along the deck; under the deck first (centerline, sideways, a median), then beside it.
      const offsets = [0];
      for (let o = 1; o < half; o++) offsets.push(o, -o);
      const under = road.w / 2 - shape.pillarSize / 2;
      const sideways = (max: number, min = 0) => {
        const out: number[] = [];
        for (let l = 0.5; l <= max + 1e-9; l += 0.5) if (l > min + 1e-9) out.push(l, -l);
        return out;
      };
      let placed = false;
      for (const pass of ['under', 'outrigger'] as const) {
        for (const o of offsets) {
          const s = s0 + o;
          if (s < 0 || s > total) continue;
          const c = at(s);
          if (c.top <= MIN_TOP) continue;
          const n: Point = [-Math.sin(c.rot), Math.cos(c.rot)];
          const shift = (l: number): Point => [c.p[0] + n[0] * l, c.p[1] + n[1] * l];
          const spots =
            pass === 'under'
              ? [c.p, ...medianSpots(c.p, n, under, c.top, c.rot), ...sideways(under).map(shift)]
              : sideways(road.w / 2 + OUTRIGGER, under).map(shift);
          const spot = spots.find((q) => !onRoad(q, shape.pillarSize, c.top, road, c.rot));
          if (!spot) continue;
          const pillar: Pillar = { p: [round2(spot[0]), round2(spot[1])], top: round2(c.top), size: shape.pillarSize, rot: round2(c.rot) };
          if (pass === 'outrigger') {
            pillar.cap = [round2(c.p[0]), round2(c.p[1])];
            stats.outriggers++;
          }
          // Under road decks, a curb around the base where it stays out of the lanes (same margin as the pillar itself).
          if (road.cls !== 'path' && !onRoad(spot, shape.pillarSize + 2 * CURB, c.top, road, c.rot)) {
            pillar.curb = CURB;
            stats.curbs = (stats.curbs ?? 0) + 1;
          }
          pillars.push(pillar);
          stats.deckPillars++;
          if (o !== 0 || spot !== c.p) stats.moved++;
          placed = true;
          break;
        }
        if (placed) break;
      }
      if (!placed) stats.skipped++;
    }
  }

  // Raised buildings and canopies.
  const walls = new SegmentGrid<number>(30);
  buildings.forEach((b, bi) => {
    for (const ring of b.rings) for (let i = 0; i < ring.length; i++) walls.insert(ring[i], ring[(i + 1) % ring.length], bi);
  });
  buildings.forEach((b, bi) => {
    const lift = b.minH ?? 0;
    if (lift <= SUPPORTS.minLift) return;
    const ring = b.rings[0];
    if (!ring || ring.length < 3) return;
    stats.raisedBuildings++;
    const size = b.h - lift <= SUPPORTS.thin ? SUPPORTS.canopy : SUPPORTS.building;
    // Inward normal: to the left of each edge for a counter-clockwise ring.
    let area2 = 0;
    for (let i = 0; i < ring.length; i++) {
      const [a, c] = [ring[i], ring[(i + 1) % ring.length]];
      area2 += a[0] * c[1] - c[0] * a[1];
    }
    const inward = area2 > 0 ? 1 : -1;
    const leans = (p: Point) =>
      walls.query([p[0] - 3, p[1] - 3], [p[0] + 3, p[1] + 3]).some((e) => e.item !== bi && distanceToSegment(p, e.a, e.b) < SUPPORTS.leans + SUPPORTS.inset);
    const seen = new Set<string>();
    for (let i = 0; i < ring.length; i++) {
      const [a, c] = [ring[i], ring[(i + 1) % ring.length]];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.5) continue;
      const [ux, uy] = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
      const [nx, ny] = [-uy * inward, ux * inward];
      const n = Math.max(1, Math.ceil(len / SUPPORTS.every));
      // From the corner (pulled in along the edge too) to just before the next corner.
      for (let k = 0; k < n; k++) {
        const along = k === 0 ? Math.min(SUPPORTS.inset, len / 2) : (len * k) / n;
        const p: Point = [a[0] + ux * along + nx * SUPPORTS.inset, a[1] + uy * along + ny * SUPPORTS.inset];
        const key = `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
        if (seen.has(key) || leans(p) || onRoad(p, size, lift)) continue;
        seen.add(key);
        pillars.push({ p: [round2(p[0]), round2(p[1])], top: round2(lift), size, rot: round2(Math.atan2(uy, ux)) });
        stats.supports++;
      }
    }
  });

  return { pillars, stats };
}
