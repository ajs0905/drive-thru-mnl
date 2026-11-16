/**
 * Street lights and traffic lights (D1), as dressing (src/geometry/dressing.ts): poles
 * with an arm reaching out over the road, drawn by scene/Dressing.tsx, solid like the
 * rest of the street furniture.
 *
 * - Traffic lights where OSM maps a signal (`highway=traffic_signals`, 132 nodes in BGC).
 *   A signal at or near a junction makes the whole junction signalized: every road
 *   arriving at it (one-way roads only the way they flow in) gets a light at its stop
 *   line, on the right-hand curb (traffic keeps right), its arm out over the lanes and its
 *   heads facing the traffic coming in. Avenues get a mast arm; narrow streets a light on a
 *   short pole. A signal away from any junction (a mid-block crossing) gets one light per
 *   direction at the node.
 * - Street lights along the avenues and wider streets, by rule (OSM maps 6 lamps here):
 *   on the curb every `LIGHTS.streetlight.every` m, arm out over the road. Two-way
 *   avenues get both sides, staggered; one-way carriageways (the halves of a divided
 *   avenue) their outer, right-hand side; minor streets one side.
 *
 * A pole is skipped (or, at a stop line, slid back up the road a little) where it would
 * stand in another road, on a footpath, in a building, across a wall, outside the playable
 * area, or crowd another pole or piece of furniture. Seeded by the road's id.
 */
import { PARKED_MODELS } from '../src/car/parked';
import { ARMS, DRESSING, drawnCorners, dressingCorners } from '../src/geometry/dressing';
import { distanceToRing, distanceToSegment, pointInRing, ringBounds } from '../src/geometry/polygon';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import { seeded } from '../src/map/hash';
import { sidewalkBands } from '../src/map/roads';
import type { Crossing, Dressing, DressingKind, MapData, Point, Road } from '../src/map/types';
import { parkingBlockers } from './parking';
import { along, overlaps } from './sidewalks';

export const LIGHTS = {
  /** Poles stand this far out from the road's edge (m), on the curb. */
  curb: 0.55,
  /** Signals within this distance (m) of a junction polygon signalize it. */
  junctionReach: 15,
  /** A stop line is this far (m) back from the junction polygon; a pole may slide this much further back to find room. */
  stopBack: 1.2,
  slide: 6,
  /** Roads at least this wide (m) get a mast arm; narrower ones a light on a short pole. */
  armFrom: 9,
  /** Street lights: spacing along a curb (m) per class; minor streets only from this width (m). */
  streetlight: { major: 32, minor: 40, minorFrom: 7 },
  /** Room kept between a pole and what's drawn of other furniture (a shed's roof, a kiosk's awning) and parked cars (m). */
  room: 0.5,
  /** Poles stay this far (m) along the road from a zebra crossing's band, so they're clear of its curb ramps. */
  crossingRoom: 1,
  /** A stop line goes this far (m) before a zebra crossing at the junction. */
  beforeCrossing: 1,
  /** At most one traffic light within this distance (m): no two on one corner. */
  cluster: 9,
  /** A signal node this close (m) to a signalized junction is part of it, not a mid-block crossing. */
  ofJunction: 30,
  /** A street light that can't stand at its spot tries these nudges along the curb (m). */
  nudges: [0, 1, -1, 2, -2, 3, -3],
  /** Room kept under a flyover deck or a raised building above a pole or its arm (m; a deck is about this deep). */
  underClear: 1.5,
  /** No pole where the street turns more than this (degrees) over 6 m. */
  maxBend: 20,
};

export interface LightStats {
  signalNodes: number;
  junctions: number;
  signals: number;
  signalPoles: number;
  streetlights: number;
  /** Street lights moved along the curb to find room. */
  nudged?: number;
  skipped: Record<string, number>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const keyOf = (p: Point) => `${p[0]},${p[1]}`;
const ground = (r: Road) => !r.z || Math.max(...r.z) <= 1;

export function placeLights(map: MapData, signals: Point[]): { dressing: Dressing[]; stats: LightStats } {
  const stats: LightStats = { signalNodes: signals.length, junctions: 0, signals: 0, signalPoles: 0, streetlights: 0, skipped: {} };
  const skip = (why: string) => {
    stats.skipped[why] = (stats.skipped[why] ?? 0) + 1;
  };
  const out: Dressing[] = [];
  const ring = map.playable ?? [];
  const inPlay = (p: Point) => ring.length < 3 || pointInRing(p, ring);

  // Obstacles: other roads' surfaces, footpaths, buildings, walls, the edge; and what's placed so far.
  const roads = new SegmentGrid<Road>(30);
  const paths = new SegmentGrid<Road>(30);
  for (const r of map.roads) {
    if (r.scenery) continue;
    // Every piece at ground level (a ramp's foot too).
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
  // What's drawn (roofs and awnings included), and the parked cars.
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
  const crossings = new SegmentGrid<Crossing>(30);
  for (const c of map.crossings) if (c.z <= 1) crossings.insert(c.c, c.c, c);
  /** Is p beside a zebra crossing's band (on its road or the sidewalks at its ends)? */
  const byCrossing = (p: Point) =>
    crossings.query(p, p, 15).some(({ item: c }) => {
      const [dx, dy] = [p[0] - c.c[0], p[1] - c.c[1]];
      const along = Math.abs(dx * c.dir[0] + dy * c.dir[1]);
      const across = Math.abs(-dx * c.dir[1] + dy * c.dir[0]);
      return along < c.w / 2 + LIGHTS.crossingRoom && across < c.half + 4;
    });
  const signalPoles = new SegmentGrid<Point>(30);
  // Overhead: flyover decks and raised buildings (skybridges, canopies) a pole or its arm would reach into.
  const decks = new SegmentGrid<{ z: number; w: number }>(30);
  for (const r of map.roads) {
    if (!r.z) continue;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const z = Math.min(r.z[i], r.z[i + 1]);
      if (z > 1.5) decks.insert(r.points[i], r.points[i + 1], { z, w: r.w });
    }
  }
  const raised = new SegmentGrid<{ ring: Point[]; minH: number }>(40);
  for (const b of map.buildings) {
    if ((b.minH ?? 0) <= 2.5) continue;
    const bb = ringBounds(b.rings[0]);
    raised.insert([bb.minX, bb.minY], [bb.maxX, bb.maxY], { ring: b.rings[0], minH: b.minH ?? 0 });
  }
  /** Would a pole of kind k at p (arm along rot) reach into a deck or raised building above it? */
  const underSomething = (k: DressingKind, p: Point, rot: number) => {
    const h = DRESSING[k].size[2];
    const arm = ARMS[k as keyof typeof ARMS] ?? 0;
    const pts: Point[] = [p, [p[0] + Math.cos(rot) * arm, p[1] + Math.sin(rot) * arm]];
    return pts.some(
      (q) =>
        decks.query(q, q, 15).some((e) => e.item.z - LIGHTS.underClear < h && distanceToSegment(q, e.a, e.b) < e.item.w / 2 + 0.5) ||
        raised.query(q, q, 2).some((e) => e.item.minH < h + LIGHTS.underClear && (pointInRing(q, e.item.ring) || distanceToRing(q, e.item.ring) < 0.5)),
    );
  };

  /** Why a pole of kind k can't stand at p (beside `own`), or undefined if it can. */
  const blocked = (k: DressingKind, p: Point, rot: number, own: Road): string | undefined => {
    if (!inPlay(p)) return 'outside';
    const [lo, hi]: Point[] = [[p[0] - 15, p[1] - 15], [p[0] + 15, p[1] + 15]];
    // Its own road too, where it curves back toward the pole.
    if (roads.query(lo, hi).some((e) => distanceToSegment(p, e.a, e.b) < e.item.w / 2 + (e.item === own ? 0.2 : 0.3))) return 'road';
    if (paths.query(lo, hi).some((e) => distanceToSegment(p, e.a, e.b) < e.item.w / 2 + 0.3)) return 'footpath';
    if (buildings.query(p, p, 2).some((e) => pointInRing(p, e.item) || distanceToRing(p, e.item) < 0.4)) return 'building';
    if (walls.query(p, p, 2).some((e) => distanceToSegment(p, e.a, e.b) < 0.4)) return 'wall';
    if (byCrossing(p)) return 'crossing';
    if (underSomething(k, p, rot)) return 'overhead';
    if (k !== 'streetlight' && signalPoles.query(p, p, LIGHTS.cluster).some((e) => Math.hypot(e.a[0] - p[0], e.a[1] - p[1]) < LIGHTS.cluster)) return 'cluster';
    const grown = dressingCorners(k, p, rot, LIGHTS.room);
    if (taken.query(lo, hi).some((e) => overlaps(grown, e.item))) return 'crowded';
    return undefined;
  };
  const put = (k: DressingKind, p: Point, rot: number) => {
    out.push({ k, p: [round2(p[0]), round2(p[1])], rot: round3(rot) });
    take(dressingCorners(k, p, rot));
    if (k !== 'streetlight') signalPoles.insert(p, p, p);
  };

  // --- Traffic lights.
  const junctions = new SegmentGrid<number>(40);
  map.junctions.forEach((j, i) => {
    if (j.patch || j.z > 1) return;
    const b = ringBounds(j.ring);
    junctions.insert([b.minX, b.minY], [b.maxX, b.maxY], i);
  });
  const lit = new Set<number>();
  const midBlock: Point[] = [];
  for (const s of signals) {
    if (!inPlay(s)) continue;
    let best: { i: number; d: number } | null = null;
    for (const e of junctions.query(s, s, LIGHTS.junctionReach)) {
      const ringJ = map.junctions[e.item].ring;
      const d = pointInRing(s, ringJ) ? 0 : distanceToRing(s, ringJ);
      if (d <= LIGHTS.junctionReach && (!best || d < best.d)) best = { i: e.item, d };
    }
    if (best) lit.add(best.i);
    else midBlock.push(s);
  }
  // A node a little farther out from a signalized junction (a crossing just past it) belongs to the junction.
  const nearLit = (s: Point) => [...lit].some((i) => distanceToRing(s, map.junctions[i].ring) < LIGHTS.ofJunction);
  stats.junctions = lit.size;
  // Road ends at each junction: roads are split at junctions, so their ends meet there.
  const endsNear = new SegmentGrid<{ road: Road; end: 0 | 1 }>(40);
  for (const r of map.roads) {
    if (r.cls === 'path' || r.scenery || !ground(r) || r.points.length < 2) continue;
    endsNear.insert(r.points[0], r.points[0], { road: r, end: 0 });
    endsNear.insert(r.points[r.points.length - 1], r.points[r.points.length - 1], { road: r, end: 1 });
  }
  /** A light for traffic on `road` moving along `dir` (unit) toward `stop`: on the right-hand curb, arm over the road. */
  const signalFor = (road: Road, stop: Point, dir: Point, back: (k: number) => Point) => {
    const kind: DressingKind = road.w >= LIGHTS.armFrom ? 'signal' : 'signalpole';
    const off = road.w / 2 + LIGHTS.curb;
    // The arm reaches left of the way the traffic moves, over the lanes; heads face it.
    const rot = Math.atan2(dir[0], -dir[1]);
    for (let k = 0; k <= LIGHTS.slide; k += 1.5) {
      const c = k === 0 ? stop : back(k);
      const p: Point = [c[0] + dir[1] * off, c[1] - dir[0] * off];
      const why = blocked(kind, p, rot, road);
      if (why) {
        if (k + 1.5 > LIGHTS.slide) skip(`signal-${why}`);
        continue;
      }
      put(kind, p, rot);
      if (kind === 'signal') stats.signals++;
      else stats.signalPoles++;
      return;
    }
  };
  for (const ji of [...lit].sort((a, b) => a - b)) {
    const j = map.junctions[ji];
    const b = ringBounds(j.ring);
    const seen = new Set<string>();
    // Widest roads first: where two approaches would want one corner, the bigger road keeps it.
    const arriving = endsNear
      .query([b.minX, b.minY], [b.maxX, b.maxY], 3)
      .sort((x, y) => y.item.road.w - x.item.road.w || (x.item.road.id < y.item.road.id ? -1 : x.item.road.id > y.item.road.id ? 1 : x.item.end - y.item.end));
    for (const { item } of arriving) {
      const { road, end } = item;
      const pts = road.points;
      const e = end === 1 ? pts[pts.length - 1] : pts[0];
      if (!(pointInRing(e, j.ring) || distanceToRing(e, j.ring) < 3)) continue;
      if (seen.has(`${road.id}:${end}`)) continue;
      seen.add(`${road.id}:${end}`);
      // Traffic arriving: along the road at its last end, against it at its first; one-way roads only arrive at their last end.
      if (road.oneway && end === 0) continue;
      const run = end === 1 ? pts : [...pts].reverse();
      const acc = [0];
      for (let i = 1; i < run.length; i++) acc.push(acc[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
      const total = acc[acc.length - 1];
      const trim = Math.max(0, road.trim?.[end] ?? 0);
      let s = total - trim - LIGHTS.stopBack;
      // Before a zebra crossing on this approach, so the pole stands clear of it.
      for (const { item: c } of crossings.query(run[run.length - 1], run[run.length - 1], 40)) {
        const q = projectOnto(run, acc, c.c);
        if (q.d < 1.5 && q.s > total - trim - 35 && q.s < total + 1) s = Math.min(s, q.s - c.w / 2 - LIGHTS.beforeCrossing);
      }
      if (s < 2) continue;
      const at = along(run, acc, s);
      const dir: Point = [Math.cos(at.dir), Math.sin(at.dir)];
      signalFor(road, at.p, dir, (k) => along(run, acc, Math.max(0, s - k)).p);
    }
  }
  // Mid-block signals: one light per direction, at the nearest road.
  for (const s of midBlock) {
    if (nearLit(s)) continue;
    let best: { d: number; road: Road; a: Point; b: Point } | null = null;
    for (const e of roads.query(s, s, 10)) {
      const d = distanceToSegment(s, e.a, e.b);
      if (d < 10 && (!best || d < best.d)) best = { d, road: e.item, a: e.a, b: e.b };
    }
    if (!best) {
      skip('signal-no-road');
      continue;
    }
    const { road, a, b } = best;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const t = Math.max(0, Math.min(1, ((s[0] - a[0]) * u[0] + (s[1] - a[1]) * u[1]) / len));
    const q: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (const dir of road.oneway ? [u] : [u, [-u[0], -u[1]] as Point]) {
      signalFor(road, q, dir, (k) => [q[0] - dir[0] * k, q[1] - dir[1] * k]);
    }
  }

  // --- Street lights.
  const { blocked: curbBlocked, shared } = parkingBlockers(map);
  for (const road of map.roads) {
    if (road.scenery || !ground(road) || road.points.length < 2) continue;
    const every = road.cls === 'major' ? LIGHTS.streetlight.major : road.cls === 'minor' && road.w >= LIGHTS.streetlight.minorFrom ? LIGHTS.streetlight.minor : 0;
    if (!every) continue;
    const bands = sidewalkBands(road);
    const rand = seeded(`lights:${road.id}`);
    // +1 left of the way's direction, -1 right.
    let sides: (1 | -1)[] = road.oneway ? [-1] : road.cls === 'major' ? [-1, 1] : [rand() < 0.5 ? -1 : 1];
    sides = sides.filter((sd) => (sd === 1 ? bands.left : bands.right));
    if (!sides.length) continue;
    const pts = road.points;
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = acc[acc.length - 1];
    const endRoom = (atStart: boolean) => {
      const trim = road.trim?.[atStart ? 0 : 1] ?? -1;
      if (trim >= 0) return trim + 3;
      return (shared.get(keyOf(pts[atStart ? 0 : pts.length - 1])) ?? 0) > 1 ? 3 : 1;
    };
    const [from, to] = [endRoom(true), total - endRoom(false)];
    if (to <= from) continue;
    const start = rand() * every;
    sides.forEach((side, si) => {
      // The second side is staggered half a spacing.
      for (let s0 = from + ((start + si * every * 0.5) % every); s0 <= to; s0 += every) {
        // The spot, or the nearest clear one within a few meters along the curb.
        let why: string | undefined = 'none';
        for (const nudge of LIGHTS.nudges) {
          const s = s0 + nudge;
          if (s < from || s > to) continue;
          const { p: c, dir } = along(pts, acc, s);
          const bend = Math.abs(along(pts, acc, s + 3).dir - along(pts, acc, s - 3).dir);
          if (Math.min(bend, 2 * Math.PI - bend) > (LIGHTS.maxBend * Math.PI) / 180) {
            why = 'bend';
            continue;
          }
          const [nx, ny] = [-Math.sin(dir), Math.cos(dir)];
          const off = road.w / 2 + LIGHTS.curb;
          const p: Point = [c[0] + nx * off * side, c[1] + ny * off * side];
          // The arm reaches back over the road.
          const rot = Math.atan2(-ny * side, -nx * side);
          const foot = dressingCorners('streetlight', p, rot, 0.4);
          why = curbBlocked(road, foot, p) ?? blocked('streetlight', p, rot, road);
          if (why) continue;
          put('streetlight', p, rot);
          stats.streetlights++;
          if (nudge !== 0) stats.nudged = (stats.nudged ?? 0) + 1;
          break;
        }
        if (why) skip(`light-${why}`);
      }
    });
  }
  return { dressing: out, stats };
}

/** Where p falls along a polyline (arc length s) and how far it is from it (d). */
function projectOnto(pts: Point[], acc: number[], p: Point): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
    const l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2));
    const d = Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t);
    if (d < best.d) best = { s: acc[i] + t * Math.sqrt(l2), d };
  }
  return best;
}
