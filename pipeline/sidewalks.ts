/**
 * Street furniture on the sidewalks: waiting sheds and planters along the avenues, bins and
 * fire hydrants on every street with a sidewalk, and a few snack kiosks by the open parks.
 * Drawn by scene/Dressing.tsx; all of it is solid (src/geometry/collision.ts), so the
 * sidewalks read as the edge of the street rather than an extra lane.
 *
 * Each kind is spaced along each sidewalk band by arc length (`every` m, with a seeded
 * offset so the streets don't line up), at its own distance from the curb. A piece is
 * skipped near a junction, a crossing, a driveway (gate, boom or bollard), a tree trunk or
 * a pillar, on a sharp bend, where it would stand on another road or a footpath, in a
 * building, across a wall or outside the playable area (the same checks as the parked
 * cars, pipeline/parking.ts), and where it would crowd a piece already placed. Seeded by
 * the road's id, so the same map always gets the same street.
 */
import { DRESSING, drawnCorners, dressingCorners } from '../src/geometry/dressing';
import { distanceToSegment, ringBounds } from '../src/geometry/polygon';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import { seeded } from '../src/map/hash';
import { sidewalkBands } from '../src/map/roads';
import type { Dressing, DressingKind, MapData, Point, Road } from '../src/map/types';
import { LOTS } from './lots';
import { parkingBlockers } from './parking';

/** Per kind: the road classes it goes on, the spacing along a band (m), and where it stands across it (0 at the curb, 1 at the back). */
export const SIDEWALKS = {
  /** Sidewalk widths per road class, as drawn (scene/cityGeometry.ts). */
  width: { major: 3, minor: 2, service: 0, path: 0 } as Record<Road['cls'], number>,
  kinds: [
    { k: 'shed', classes: ['major'], every: 260, across: 1 },
    { k: 'kiosk', classes: ['major', 'minor'], every: 90, across: 1, nearOpen: 90 },
    { k: 'planter', classes: ['major'], every: 34, across: 0 },
    { k: 'bin', classes: ['major', 'minor'], every: 90, across: 0 },
    { k: 'hydrant', classes: ['major', 'minor'], every: 160, across: 0 },
  ] as { k: DressingKind; classes: Road['cls'][]; every: number; across: number; nearOpen?: number }[],
  /** Kiosks at most, gap from the curb and from the back edge (m), and room kept between pieces (m). */
  maxKiosks: 6,
  curbGap: 0.35,
  backGap: 0.1,
  room: 1,
  /** No piece where the street turns more than this (degrees) over its length plus 2 m. */
  maxBend: 15,
  /** Room kept from footpaths crossing the sidewalk (m, past their half width). */
  fromPath: 0.6,
};

export interface SidewalkStats {
  placed: Record<string, number>;
  skipped: Record<string, number>;
}

/** Position and heading at arc length s along a polyline. */
export function along(pts: Point[], acc: number[], s: number): { p: Point; dir: number } {
  let i = 0;
  while (i < pts.length - 2 && acc[i + 1] < s) i++;
  const seg = acc[i + 1] - acc[i] || 1;
  const t = Math.max(0, Math.min(1, (s - acc[i]) / seg));
  const [a, b] = [pts[i], pts[i + 1]];
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

/** Do two convex polygons overlap (separating axis test)? */
export function overlaps(a: Point[], b: Point[]): boolean {
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

const keyOf = (p: Point) => `${p[0]},${p[1]}`;

/**
 * Where a piece's center goes across a sidewalk band of width `band` beside a road of width
 * `roadW`: `across` 0 puts its curb side `curbGap` from the curb, 1 its back `backGap` from
 * the back edge. Undefined if it doesn't fit.
 */
export function acrossOffset(roadW: number, band: number, depth: number, across: number): number | undefined {
  const lo = roadW / 2 + SIDEWALKS.curbGap + depth / 2;
  const hi = roadW / 2 + band - SIDEWALKS.backGap - depth / 2;
  if (hi < lo - 1e-9) return undefined;
  return lo + (hi - lo) * across;
}

export function placeSidewalkDressing(map: MapData): { dressing: Dressing[]; stats: SidewalkStats } {
  const stats: SidewalkStats = { placed: {}, skipped: {} };
  const skip = (why: string) => {
    stats.skipped[why] = (stats.skipped[why] ?? 0) + 1;
  };
  const out: Dressing[] = [];
  const { blocked, shared } = parkingBlockers(map);
  const paths = new SegmentGrid<Road>(30);
  for (const r of map.roads) {
    if (r.cls !== 'path' || r.z) continue;
    for (let i = 0; i < r.points.length - 1; i++) paths.insert(r.points[i], r.points[i + 1], r);
  }
  const taken = new SegmentGrid<Point[]>(30);
  for (const d of map.dressing ?? []) {
    const foot = drawnCorners(d.k, d.p, d.rot);
    const b = ringBounds(foot);
    taken.insert([b.minX, b.minY], [b.maxX, b.maxY], foot);
  }
  const open = map.areas.filter((a) => LOTS.openParks.includes(a.id) || LOTS.open[a.id]).flatMap((a) => a.rings);
  const nearOpen = (p: Point, d: number) => open.some((ring) => ring.some((q, i) => distanceToSegment(p, q, ring[(i + 1) % ring.length]) < d));
  let kiosks = 0;

  for (const spec of SIDEWALKS.kinds) {
    const [len, depth] = DRESSING[spec.k].size;
    for (const road of map.roads) {
      if (!spec.classes.includes(road.cls) || road.scenery || road.z || road.points.length < 2) continue;
      const band = SIDEWALKS.width[road.cls];
      const offset = acrossOffset(road.w, band, depth, spec.across);
      if (offset === undefined) continue;
      const bands = sidewalkBands(road);
      const pts = road.points;
      const acc = [0];
      for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = acc[acc.length - 1];
      const endRoom = (atStart: boolean) => {
        const trim = road.trim?.[atStart ? 0 : 1] ?? -1;
        if (trim >= 0) return trim + 4;
        return (shared.get(keyOf(pts[atStart ? 0 : pts.length - 1])) ?? 0) > 1 ? 4 : 1;
      };
      const [from, to] = [endRoom(true) + len / 2, total - endRoom(false) - len / 2];
      if (to <= from) continue;

      for (const side of [1, -1] as const) {
        if (!(side === 1 ? bands.left : bands.right)) continue;
        const rand = seeded(`sidewalk:${spec.k}:${road.id}:${side}`);
        for (let s = from + rand() * spec.every; s <= to; s += spec.every * (0.8 + 0.4 * rand())) {
          const { p: c, dir } = along(pts, acc, s);
          const bend = Math.abs(along(pts, acc, s + len / 2 + 1).dir - along(pts, acc, s - len / 2 - 1).dir);
          if (Math.min(bend, 2 * Math.PI - bend) > (SIDEWALKS.maxBend * Math.PI) / 180) {
            skip('bend');
            continue;
          }
          const [nx, ny] = [-Math.sin(dir), Math.cos(dir)];
          const p: Point = [c[0] + nx * offset * side, c[1] + ny * offset * side];
          if (spec.nearOpen !== undefined && (kiosks >= SIDEWALKS.maxKiosks || !nearOpen(p, spec.nearOpen))) continue;
          // The model's open side (+z) faces the road: the right of `rot`.
          const rot = side === 1 ? dir : dir + Math.PI;
          const foot = dressingCorners(spec.k, p, rot);
          const why = blocked(road, foot, p);
          if (why) {
            skip(why);
            continue;
          }
          const b = ringBounds(foot);
          const [lo, hi]: Point[] = [[b.minX - 3, b.minY - 3], [b.maxX + 3, b.maxY + 3]];
          if (paths.query(lo, hi).some((e) => foot.some((q) => distanceToSegment(q, e.a, e.b) < e.item.w / 2 + SIDEWALKS.fromPath))) {
            skip('footpath');
            continue;
          }
          // What's drawn (a shed's roof, a kiosk's awning) keeps its room from what's there.
          const drawn = drawnCorners(spec.k, p, rot);
          const grown = drawnCorners(spec.k, p, rot, SIDEWALKS.room);
          if (taken.query(lo, hi).some((e) => overlaps(grown, e.item))) {
            skip('crowded');
            continue;
          }
          const db = ringBounds(drawn);
          taken.insert([db.minX, db.minY], [db.maxX, db.maxY], drawn);
          out.push({ k: spec.k, p: [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100], rot: Math.round(rot * 1000) / 1000 });
          stats.placed[spec.k] = (stats.placed[spec.k] ?? 0) + 1;
          if (spec.k === 'kiosk') kiosks++;
        }
      }
    }
  }
  return { dressing: out, stats };
}
