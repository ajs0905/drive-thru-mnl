/**
 * Road signs, as dressing (src/geometry/dressing.ts): a post on the curb with the sign on
 * top facing the traffic it's for, drawn by scene/Dressing.tsx and knocked over like the
 * rest of the street furniture. OSM maps no stop or give-way points here, so they're
 * placed by rule from the roads:
 *
 * - Stop: on every road arriving at an unsignalized junction where a bigger road crosses
 *   (a street meeting an avenue, a driveway meeting a street), on the approach's
 *   right-hand curb just before the junction (and before a zebra crossing there).
 * - One way: where a one-way street leaves a junction, for each road arriving from the
 *   side, on the one-way street's curb on that driver's side, facing them, the arrow
 *   showing which way the street goes (so at the top of a T the stem's drivers see which
 *   way to turn). Streets only: not driveways and lot aisles, a roundabout, or the halves
 *   of a divided road (a one-way way with one going the other way alongside).
 * - Speed limit: on the avenues, just past a junction, facing the traffic leaving it, at
 *   most one per direction within `SIGNS.speedEvery` m. The speed is the road's
 *   `maxspeed` tag, or 60 on primary and trunk roads and 40 on the rest.
 *
 * A sign is skipped (or slid along the curb a little) where it would stand in a road
 * (a driveway's mouth included), on a footpath, in a building, across a wall, in a
 * junction, beside a zebra crossing, outside the playable area or crowding other
 * furniture or a parked car. Placed after the lights and the sidewalk furniture, so it
 * keeps clear of them.
 */
import { PARKED_MODELS } from '../src/car/parked';
import { dressingCorners, drawnCorners, SIGN_SPEEDS } from '../src/geometry/dressing';
import { distanceToRing, distanceToSegment, pointInRing, ringBounds } from '../src/geometry/polygon';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import type { Dressing, DressingKind, MapData, Point, Road } from '../src/map/types';
import { along, overlaps } from './sidewalks';

export const SIGNS = {
  /** Posts stand this far out from the road's edge (m). */
  curb: 0.45,
  /** A sign stands from this far (m) past the junction polygon's edge, sliding up to `slide` m further to find room. */
  from: 1.2,
  slide: 6,
  /** Signals (traffic lights) within this distance (m) of a junction mean it's signalized: no stop signs. */
  signalized: 30,
  /** Another road's surface, a footpath, a building, a wall: kept this far (m) from the post. */
  roadRoom: 0.6,
  room: 0.4,
  /** Kept this far (m) along the road from a zebra crossing's band. */
  crossingRoom: 0.8,
  /** A one-way sign is for roads arriving at least this far off the one-way street's line (sine of the angle). */
  side: 0.6,
  /** A one-way street needs this much length (m) past its junctions to get signs: not a short link across a median. */
  onewayFrom: 15,
  twinGap: 25,
  /** Speed limit signs: this far (m) past the junction, at most one per direction within `speedEvery` m, on roads at least `speedFrom` m long. */
  speedAt: 22,
  speedEvery: 260,
  speedFrom: 60,
};

export interface SignStats {
  placed: Record<string, number>;
  skipped: Record<string, number>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const RANK = { major: 3, minor: 2, service: 1, path: 0 } as const;
const ground = (r: Road) => !r.z || Math.max(...r.z) <= 1;

/** The speed limit sign a road gets: the index into SIGN_SPEEDS of its limit (rounded down to one there is). */
export function speedIndex(road: Pick<Road, 'highway' | 'maxspeed'>): number {
  const kmh = road.maxspeed ?? (road.highway.startsWith('primary') || road.highway.startsWith('trunk') ? 60 : 40);
  let best = 0;
  SIGN_SPEEDS.forEach((s, i) => {
    if (s <= kmh) best = i;
  });
  return best;
}

export function placeSigns(map: MapData): { dressing: Dressing[]; stats: SignStats } {
  const stats: SignStats = { placed: {}, skipped: {} };
  const skip = (why: string) => {
    stats.skipped[why] = (stats.skipped[why] ?? 0) + 1;
  };
  const out: Dressing[] = [];
  const ring = map.playable ?? [];
  const inPlay = (p: Point) => ring.length < 3 || pointInRing(p, ring);

  // What a post can't stand in or beside.
  const roads = new SegmentGrid<Road>(30);
  const paths = new SegmentGrid<Road>(30);
  for (const r of map.roads) {
    if (r.scenery) continue;
    for (let i = 0; i + 1 < r.points.length; i++) {
      if (Math.max(r.z?.[i] ?? 0, r.z?.[i + 1] ?? 0) > 1) continue;
      (r.cls === 'path' ? paths : roads).insert(r.points[i], r.points[i + 1], r);
    }
  }
  const buildings = new SegmentGrid<Point[]>(40);
  for (const b of map.buildings) {
    if ((b.minH ?? 0) > 2.5) continue;
    const bb = ringBounds(b.rings[0]);
    buildings.insert([bb.minX, bb.minY], [bb.maxX, bb.maxY], b.rings[0]);
  }
  const walls = new SegmentGrid<true>(30);
  for (const w of map.barriers ?? []) for (let i = 0; i + 1 < w.points.length; i++) walls.insert(w.points[i], w.points[i + 1], true);
  const taken = new SegmentGrid<Point[]>(30);
  const take = (foot: Point[]) => {
    const b = ringBounds(foot);
    taken.insert([b.minX, b.minY], [b.maxX, b.maxY], foot);
  };
  for (const d of map.dressing ?? []) take(drawnCorners(d.k, d.p, d.rot));
  for (const c of map.parked ?? []) {
    const [l, w] = PARKED_MODELS[c.v]?.size ?? [4.6, 1.9];
    const [cs, sn] = [Math.cos(c.rot), Math.sin(c.rot)];
    const [hl, hw] = [l / 2, w / 2];
    take([
      [c.p[0] + cs * hl - sn * hw, c.p[1] + sn * hl + cs * hw],
      [c.p[0] - cs * hl - sn * hw, c.p[1] - sn * hl + cs * hw],
      [c.p[0] - cs * hl + sn * hw, c.p[1] - sn * hl - cs * hw],
      [c.p[0] + cs * hl + sn * hw, c.p[1] + sn * hl - cs * hw],
    ]);
  }
  const zebras = new SegmentGrid<MapData['crossings'][number]>(30);
  for (const c of map.crossings) if (c.z <= 1) zebras.insert(c.c, c.c, c);
  const byCrossing = (p: Point) =>
    zebras.query(p, p, 15).some(({ item: c }) => {
      const [dx, dy] = [p[0] - c.c[0], p[1] - c.c[1]];
      return Math.abs(dx * c.dir[0] + dy * c.dir[1]) < c.w / 2 + SIGNS.crossingRoom && Math.abs(-dx * c.dir[1] + dy * c.dir[0]) < c.half + 4;
    });
  const paved = new SegmentGrid<Point[]>(40);
  for (const j of map.junctions) {
    if (j.z > 1) continue;
    const jb = ringBounds(j.ring);
    paved.insert([jb.minX, jb.minY], [jb.maxX, jb.maxY], j.ring);
  }
  const signals = new SegmentGrid<true>(30);
  for (const d of map.dressing ?? []) if (d.k === 'signal' || d.k === 'signalpole') signals.insert(d.p, d.p, true);

  /** Why a post can't stand at p beside its own road, or undefined if it can. */
  const blocked = (k: DressingKind, p: Point, rot: number, own: Road): string | undefined => {
    if (!inPlay(p)) return 'outside';
    const [lo, hi]: Point[] = [[p[0] - 15, p[1] - 15], [p[0] + 15, p[1] + 15]];
    if (roads.query(lo, hi).some((e) => distanceToSegment(p, e.a, e.b) < e.item.w / 2 + (e.item === own ? 0.2 : SIGNS.roadRoom))) return 'road';
    if (paths.query(lo, hi).some((e) => distanceToSegment(p, e.a, e.b) < e.item.w / 2 + 0.3)) return 'footpath';
    if (buildings.query(p, p, 2).some((e) => pointInRing(p, e.item) || distanceToRing(p, e.item) < SIGNS.room)) return 'building';
    if (walls.query(p, p, 2).some((e) => distanceToSegment(p, e.a, e.b) < SIGNS.room)) return 'wall';
    if (paved.query(p, p, 1).some((e) => pointInRing(p, e.item) || distanceToRing(p, e.item) < 0.4)) return 'junction';
    if (byCrossing(p)) return 'crossing';
    const grown = dressingCorners(k, p, rot, SIGNS.room);
    if (taken.query(lo, hi).some((e) => overlaps(grown, e.item))) return 'crowded';
    return undefined;
  };
  const put = (k: DressingKind, p: Point, rot: number, c?: number) => {
    out.push({ k, p: [round2(p[0]), round2(p[1])], rot: round3(rot), ...(c !== undefined && { c }) });
    take(dressingCorners(k, p, rot));
    stats.placed[k] = (stats.placed[k] ?? 0) + 1;
  };

  // Road ends at junctions (roads are split at junctions, so their ends meet there).
  const endsNear = new SegmentGrid<{ road: Road; end: 0 | 1 }>(40);
  for (const r of map.roads) {
    if (r.cls === 'path' || r.scenery || !ground(r) || r.points.length < 2) continue;
    endsNear.insert(r.points[0], r.points[0], { road: r, end: 0 });
    endsNear.insert(r.points[r.points.length - 1], r.points[r.points.length - 1], { road: r, end: 1 });
  }
  type End = { road: Road; end: 0 | 1; run: Point[]; acc: number[]; out: Point; trim: number; length: number };
  const endsAt = (ringJ: Point[]): End[] => {
    const b = ringBounds(ringJ);
    const ends: End[] = [];
    for (const { item } of endsNear.query([b.minX, b.minY], [b.maxX, b.maxY], 3)) {
      const { road, end } = item;
      const e = end === 1 ? road.points[road.points.length - 1] : road.points[0];
      if (!(pointInRing(e, ringJ) || distanceToRing(e, ringJ) < 3)) continue;
      if (ends.some((x) => x.road === road && x.end === end)) continue;
      const run = end === 0 ? road.points : [...road.points].reverse();
      const acc = [0];
      for (let i = 1; i < run.length; i++) acc.push(acc[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
      const trim = Math.max(0, road.trim?.[end] ?? 0);
      const far = along(run, acc, Math.min(acc[acc.length - 1], trim + 8)).p;
      const [dx, dy] = [far[0] - run[0][0], far[1] - run[0][1]];
      const l = Math.hypot(dx, dy) || 1;
      const otherTrim = Math.max(0, road.trim?.[end === 0 ? 1 : 0] ?? 0);
      ends.push({ road, end, run, acc, out: [dx / l, dy / l], trim, length: acc[acc.length - 1] - trim - otherTrim });
    }
    return ends;
  };
  /** One half of a divided road: another one-way way within `twinGap` m of its middle, going the other way. */
  const twin = (road: Road) => {
    const pts = road.points;
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const { p: mid, dir } = along(pts, acc, acc[acc.length - 1] / 2);
    return roads.query(mid, mid, SIGNS.twinGap).some((e) => {
      if (e.item === road || !e.item.oneway || distanceToSegment(mid, e.a, e.b) > SIGNS.twinGap) return false;
      const [dx, dy] = [e.b[0] - e.a[0], e.b[1] - e.a[1]];
      return (dx * Math.cos(dir) + dy * Math.sin(dir)) / (Math.hypot(dx, dy) || 1) < -0.85;
    });
  };
  /** Traffic reaches the junction along this end (it leaves the junction the other way). */
  const arrives = (e: End) => !e.road.oneway || e.end === 1;
  const leaves = (e: End) => !e.road.oneway || e.end === 0;
  /**
   * Spots along an end's run going away from the junction, on one curb: `side` +1 is left of the run, -1 right. Its
   * sidewalk, where it has one, decides nothing: a sign stands on a verge as well.
   */
  const spots = function* (e: End, side: 1 | -1, start: number) {
    const total = e.acc[e.acc.length - 1];
    for (let k = 0; k <= SIGNS.slide; k += 1) {
      const s = e.trim + start + k;
      if (s > total - 2) return;
      const { p: c, dir } = along(e.run, e.acc, s);
      const [nx, ny] = [-Math.sin(dir), Math.cos(dir)];
      const off = e.road.w / 2 + SIGNS.curb;
      yield [c[0] + nx * off * side, c[1] + ny * off * side] as Point;
    }
  };
  /** The rot that turns a sign's face toward `n` (unit, map): the model faces -z, (-sin rot, cos rot). */
  const facing = (n: Point) => Math.atan2(-n[0], n[1]);
  const tryPut = (k: DressingKind, at: Iterable<Point>, rot: number, own: Road, c?: number) => {
    let why: string | undefined = 'none';
    for (const p of at) {
      why = blocked(k, p, rot, own);
      if (!why) {
        put(k, p, rot, c);
        return;
      }
    }
    skip(`${k}-${why}`);
  };

  const speedSigns = new SegmentGrid<Point>(SIGNS.speedEvery);
  const speedEnds: End[] = [];
  map.junctions.forEach((j) => {
    if (j.z > 1 || j.patch) return;
    const ends = endsAt(j.ring);
    if (ends.length < 3) {
      // A plain join or a dead end: only the avenues' speed limits.
      for (const e of ends) if (e.road.cls === 'major' && leaves(e)) speedEnds.push(e);
      return;
    }
    const jb = ringBounds(j.ring);
    const lit = signals.query([jb.minX, jb.minY], [jb.maxX, jb.maxY], SIGNS.signalized).some((s) => pointInRing(s.a, j.ring) || distanceToRing(s.a, j.ring) < SIGNS.signalized);
    const top = Math.max(...ends.map((e) => RANK[e.road.cls]));
    for (const e of ends) {
      // Stop: before an unsignalized junction with a bigger road; on the approach's right (the run's left: it points away).
      if (!lit && arrives(e) && RANK[e.road.cls] < top && !e.road.roundabout) {
        const toward: Point = [-e.out[0], -e.out[1]];
        tryPut('signstop', spots(e, 1, SIGNS.from), facing([-toward[0], -toward[1]]), e.road);
      }
      if (e.road.cls === 'major' && leaves(e)) speedEnds.push(e);
      // One way: a one-way street leaving here, for the roads arriving from its sides.
      if (!e.road.oneway || e.end !== 0 || e.road.roundabout || e.road.cls !== 'minor' || e.length < SIGNS.onewayFrom || twin(e.road)) continue;
      const d = e.out;
      const done = new Set<number>();
      for (const a of ends) {
        if (a === e || !arrives(a)) continue;
        // The way the arriving traffic goes, into the junction.
        const t: Point = [-a.out[0], -a.out[1]];
        const across = d[0] * t[1] - d[1] * t[0];
        if (Math.abs(across) < SIGNS.side) continue;
        // On the one-way street's curb on the side the driver comes from (-t), facing them.
        const side: 1 | -1 = -d[1] * -t[0] + d[0] * -t[1] > 0 ? 1 : -1;
        if (done.has(side)) continue;
        done.add(side);
        // The arrow: right if the street goes off to the driver's right ((t1, -t0)).
        const c = d[0] * t[1] - d[1] * t[0] > 0 ? 0 : 1;
        tryPut('signoneway', spots(e, side, SIGNS.from), facing([-t[0], -t[1]]), e.road, c);
      }
    }
  });

  // Speed limits: longest roads first, one per direction within `speedEvery`; on the traffic's right (the run's right).
  speedEnds.sort((x, y) => y.length - x.length || (x.road.id < y.road.id ? -1 : x.road.id > y.road.id ? 1 : x.end - y.end));
  const seen = new Set<string>();
  for (const e of speedEnds) {
    const key = `${e.road.id}:${e.end}`;
    if (seen.has(key) || e.length < SIGNS.speedFrom) continue;
    seen.add(key);
    const at = along(e.run, e.acc, e.trim + SIGNS.speedAt).p;
    const near = speedSigns.query(at, at, SIGNS.speedEvery).some((s) => {
      const [dx, dy] = [s.a[0] - at[0], s.a[1] - at[1]];
      const heading = s.item;
      return Math.hypot(dx, dy) < SIGNS.speedEvery && heading[0] * e.out[0] + heading[1] * e.out[1] > 0.7;
    });
    if (near) {
      skip('signspeed-spacing');
      continue;
    }
    const before = out.length;
    tryPut('signspeed', spots(e, -1, SIGNS.speedAt), facing([-e.out[0], -e.out[1]]), e.road, speedIndex(e.road));
    if (out.length > before) speedSigns.insert(at, at, e.out);
  }
  return { dressing: out, stats };
}
