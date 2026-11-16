/**
 * Street lights and traffic lights (D1), as dressing (src/geometry/dressing.ts): poles
 * with an arm reaching out over the road, drawn by scene/Dressing.tsx, solid like the
 * rest of the street furniture.
 *
 * - Traffic lights where OSM maps a signal (`highway=traffic_signals`, 132 nodes in BGC),
 *   on the far side (ADR 0021). A signal at or near a junction makes the whole intersection
 *   signalized (junctions joined by short links across a divided avenue's medians are one
 *   intersection): every road arriving from outside it (one-way roads only the way they
 *   flow in) gets a light the way drivers see them here, on the far right-hand corner
 *   (traffic keeps right), past the far crosswalk, on the curb of the road it leaves on
 *   straight ahead, its arm out over the lanes the traffic is heading into and its heads
 *   facing back at it. With no road straight ahead (the stem of a T), the light stands on a
 *   post on the far curb across the junction, in line with the approach. Nothing stands at
 *   the stop line, so a stopped car's driver looks across at the light, and each corner ends
 *   up with one pole. Avenues get a mast arm; narrow streets a light on a short pole. A
 *   signal away from any junction (a mid-block crossing) gets one light per direction, just
 *   past the crossing.
 * - Street lights along the avenues and wider streets, by rule (OSM maps 6 lamps here):
 *   on the curb every `LIGHTS.streetlight.every` m, arm out over the road. Two-way
 *   avenues get both sides, staggered; one-way carriageways (the halves of a divided
 *   avenue) their outer, right-hand side; minor streets one side.
 *
 * A pole is skipped (or, past a junction, slid on along the curb a little) where it would
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
  /** A far-side pole stands this far (m) past the junction polygon (or a mid-block signal's node); it may slide this much further on to find room. */
  past: 1.2,
  slide: 6,
  /** The road leaving within this angle (degrees) of an approach is straight ahead across the junction. */
  ahead: 35,
  /** Junctions this close (m) along a road joining them, a link across a divided avenue's median say, are one intersection. */
  link: 25,
  /** With no road straight ahead, the pole stands on the far curb within this far (m) of the junction's edge. */
  across: 12,
  /** Roads at least this wide (m) get a mast arm; narrower ones a light on a short pole. */
  armFrom: 9,
  /** Street lights: spacing along a curb (m) per class; minor streets only from this width (m). */
  streetlight: { major: 32, minor: 40, minorFrom: 7 },
  /** Room kept between a pole and what's drawn of other furniture (a shed's roof, a kiosk's awning) and parked cars (m). */
  room: 0.5,
  /** Poles stay this far (m) along the road from a zebra crossing's band, so they're clear of its curb ramps. */
  crossingRoom: 1,
  /** A far-side pole stands this far (m) past a zebra crossing at the junction. */
  pastCrossing: 1,
  /** At most one traffic light within this distance (m): no two on one corner. */
  cluster: 9,
  /** A signal node this close (m) to a signalized junction is part of it, not a mid-block crossing. */
  ofJunction: 30,
  /** A street light that can't stand at its spot tries these nudges along the curb (m). */
  nudges: [0, 1, -1, 2, -2, 3, -3],
  /** Room kept under a flyover deck or a raised building above a pole or its arm (m; a deck is about this deep). */
  underClear: 1.5,
  /** A traffic light's heads face along a road within this angle (degrees); see `headsAlongRoad`. */
  facing: 30,
  /** No pole where the street turns more than this (degrees) over 6 m. */
  maxBend: 20,
};

export interface LightStats {
  signalNodes: number;
  junctions: number;
  signals: number;
  signalPoles: number;
  /** Lights on a post across the junction: no road straight ahead, or no room on it. */
  across?: number;
  /** Signalized junctions grouped into intersections (a divided avenue's crossing is two or more junctions). */
  intersections?: number;
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
  // Junction polygons are paved out to the corners, past the roads' edges.
  const paved = new SegmentGrid<Point[]>(40);
  for (const j of map.junctions) {
    if (j.z > 1) continue;
    const jb = ringBounds(j.ring);
    paved.insert([jb.minX, jb.minY], [jb.maxX, jb.maxY], j.ring);
  }
  const junctionAt = (p: Point) => paved.query(p, p, 1).some((e) => pointInRing(p, e.item) || distanceToRing(p, e.item) < 0.3);
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
    if (junctionAt(p)) return 'junction';
    if (byCrossing(p)) return 'crossing';
    if (underSomething(k, p, rot)) return 'overhead';
    if (k !== 'streetlight' && headsAlongRoad(p, rot, roads) < Math.cos((LIGHTS.facing * Math.PI) / 180)) return 'facing';
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
  const kindFor = (road: Road): DressingKind => (road.w >= LIGHTS.armFrom ? 'signal' : 'signalpole');
  /** Try each spot in turn; the first clear one gets the light. */
  const tryPut = (spots: Iterable<{ kind: DressingKind; p: Point; rot: number; own: Road; across?: boolean }>): string | undefined => {
    let why: string | undefined = 'none';
    for (const { kind, p, rot, own, across } of spots) {
      why = blocked(kind, p, rot, own);
      if (why) continue;
      put(kind, p, rot);
      if (kind === 'signal') stats.signals++;
      else stats.signalPoles++;
      if (across) stats.across = (stats.across ?? 0) + 1;
      return undefined;
    }
    return why;
  };
  /** The pole for traffic moving along `dir` (unit) at a curb point c: on its right-hand curb, the arm reaching left over the lanes, heads facing back at the traffic. */
  const curbSpot = (kind: DressingKind, c: Point, dir: Point, w: number, own: Road) => ({
    kind,
    p: [c[0] + dir[1] * (w / 2 + LIGHTS.curb), c[1] - dir[0] * (w / 2 + LIGHTS.curb)] as Point,
    rot: Math.atan2(dir[0], -dir[1]),
    own,
  });
  type End = { road: Road; end: 0 | 1; ji: number; run: Point[]; acc: number[]; out: Point; trim: number };
  /** Every road end at a junction, as a run going away from it. */
  const endsCache = new Map<number, End[]>();
  const endsAt = (ji: number): End[] => {
    const hit = endsCache.get(ji);
    if (hit) return hit;
    const j = map.junctions[ji];
    const b = ringBounds(j.ring);
    const seen = new Set<string>();
    const ends: End[] = [];
    for (const { item } of endsNear.query([b.minX, b.minY], [b.maxX, b.maxY], 3)) {
      const { road, end } = item;
      const pts = road.points;
      const e = end === 1 ? pts[pts.length - 1] : pts[0];
      if (!(pointInRing(e, j.ring) || distanceToRing(e, j.ring) < 3)) continue;
      if (seen.has(`${road.id}:${end}`)) continue;
      seen.add(`${road.id}:${end}`);
      const run = end === 0 ? pts : [...pts].reverse();
      const acc = [0];
      for (let i = 1; i < run.length; i++) acc.push(acc[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
      const trim = Math.max(0, road.trim?.[end] ?? 0);
      // The way out of the junction, over the road's first few meters past it.
      const far = along(run, acc, Math.min(acc[acc.length - 1], trim + 8)).p;
      const [dx, dy] = [far[0] - run[0][0], far[1] - run[0][1]];
      const l = Math.hypot(dx, dy) || 1;
      ends.push({ road, end, ji, run, acc, out: [dx / l, dy / l], trim });
    }
    endsCache.set(ji, ends);
    return ends;
  };
  /** The junction a road end sits at. */
  const junctionOf = (p: Point): number | undefined => {
    for (const e of junctions.query(p, p, 3)) {
      const ringJ = map.junctions[e.item].ring;
      if (pointInRing(p, ringJ) || distanceToRing(p, ringJ) < 3) return e.item;
    }
    return undefined;
  };
  const otherEnd = (e: End) => junctionOf(e.run[e.run.length - 1]);
  /**
   * A road leaving a junction, carried on through plain joins (a road split for a crossing, a change of tags) until it's
   * `need` m long or reaches another junction, so a short piece past the junction still has a curb to stand on.
   */
  const carryOn = (e: End, need: number) => {
    const run = [...e.run];
    const acc = [...e.acc];
    const pieces: { from: number; road: Road }[] = [{ from: 0, road: e.road }];
    let road = e.road;
    for (let n = 0; n < 6 && acc[acc.length - 1] < need; n++) {
      const tip = run[run.length - 1];
      if (junctionOf(tip) !== undefined) break;
      const l = Math.min(acc[acc.length - 1], 8);
      const back = along(run, acc, acc[acc.length - 1] - l).p;
      const dir: Point = [(tip[0] - back[0]) / (l || 1), (tip[1] - back[1]) / (l || 1)];
      let next: { road: Road; pts: Point[]; dot: number } | undefined;
      for (const { item } of endsNear.query(tip, tip, 0.5)) {
        const r = item.road;
        if (r === road || (r.oneway && item.end === 1)) continue;
        const pts = item.end === 0 ? r.points : [...r.points].reverse();
        if (Math.hypot(pts[0][0] - tip[0], pts[0][1] - tip[1]) > 0.5 || pts.length < 2) continue;
        const [dx, dy] = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]];
        const dot = (dx * dir[0] + dy * dir[1]) / (Math.hypot(dx, dy) || 1);
        if (dot >= Math.cos((LIGHTS.ahead * Math.PI) / 180) && (!next || dot > next.dot)) next = { road: r, pts, dot };
      }
      if (!next) break;
      pieces.push({ from: acc[acc.length - 1], road: next.road });
      for (let i = 1; i < next.pts.length; i++) {
        acc.push(acc[acc.length - 1] + Math.hypot(next.pts[i][0] - run[run.length - 1][0], next.pts[i][1] - run[run.length - 1][1]));
        run.push(next.pts[i]);
      }
      road = next.road;
    }
    const roadAt = (s: number) => pieces.reduce((r, p) => (s >= p.from ? p.road : r), e.road);
    return { run, acc, roadAt };
  };
  // One intersection can be several junction polygons: a divided avenue crossing another is a junction per carriageway,
  // joined by short links across the medians. Group them, so "far side" means past the whole intersection.
  const groupOf = new Map<number, number>();
  const groups: number[][] = [];
  for (const ji of [...lit].sort((a, b) => a - b)) {
    if (groupOf.has(ji)) continue;
    const g = [ji];
    groupOf.set(ji, groups.length);
    for (let i = 0; i < g.length; i++) {
      for (const e of endsAt(g[i])) {
        if (e.acc[e.acc.length - 1] - e.trim - Math.max(0, e.road.trim?.[e.end === 0 ? 1 : 0] ?? 0) > LIGHTS.link) continue;
        const jo = otherEnd(e);
        if (jo === undefined || groupOf.has(jo)) continue;
        groupOf.set(jo, groups.length);
        g.push(jo);
      }
    }
    groups.push(g);
  }
  stats.intersections = groups.length;
  const ahead = Math.cos((LIGHTS.ahead * Math.PI) / 180);
  for (const g of groups) {
    const gi = groupOf.get(g[0]);
    const inside = (e: End) => {
      const jo = otherEnd(e);
      return jo !== undefined && groupOf.get(jo) === gi;
    };
    // Approaches from outside the intersection, widest roads first: where two would want one corner, the bigger road keeps it.
    // Traffic arrives along a road at its last end, against it at its first; one-way roads only arrive at their last end.
    const approaches = g
      .flatMap(endsAt)
      .filter((e) => !inside(e) && !(e.road.oneway && e.end === 0))
      .sort((x, y) => y.road.w - x.road.w || (x.road.id < y.road.id ? -1 : x.road.id > y.road.id ? 1 : x.end - y.end));
    for (const a of approaches) {
      const kind = kindFor(a.road);
      // Straight ahead through the intersection, across the medians: at each junction the road leaving most in line
      // with the way the traffic is going (one-way roads only leave from their first end).
      let [ji, dir, from, last]: [number, Point, Road, End] = [a.ji, [-a.out[0], -a.out[1]], a.road, a];
      let exit: End | undefined;
      for (let hop = 0; hop < 4; hop++) {
        let best: End | undefined;
        for (const d of endsAt(ji)) {
          if (d.road === from || (d.road.oneway && d.end === 1)) continue;
          const dot = d.out[0] * dir[0] + d.out[1] * dir[1];
          if (dot >= ahead && (!best || dot > best.out[0] * dir[0] + best.out[1] * dir[1] + 1e-9)) best = d;
        }
        if (!best || !inside(best)) {
          exit = best;
          break;
        }
        // Across a median link to the next junction, arriving the way the link ends.
        const { run, acc } = best;
        const total = acc[acc.length - 1];
        const before = along(run, acc, Math.max(0, total - 8)).p;
        const end = run[run.length - 1];
        const l = Math.hypot(end[0] - before[0], end[1] - before[1]) || 1;
        [ji, dir, from, last] = [otherEnd(best)!, [(end[0] - before[0]) / l, (end[1] - before[1]) / l], best.road, best];
      }
      const j = map.junctions[ji];
      const spots = function* () {
        if (exit) {
          // Its right-hand curb, past the junction and past a zebra crossing there.
          const { run, acc, roadAt } = carryOn(exit, exit.trim + 40);
          const trim = exit.trim;
          const total = acc[acc.length - 1];
          let s = trim + LIGHTS.past;
          for (const { item: c } of crossings.query(run[0], run[0], 40)) {
            const q = projectOnto(run, acc, c.c);
            if (q.d < 1.5 && q.s < trim + 35) s = Math.max(s, q.s + c.w / 2 + LIGHTS.pastCrossing);
          }
          for (let k = 0; k <= LIGHTS.slide && s + k < total - 2; k += 1.5) {
            const at = along(run, acc, s + k);
            const road = roadAt(s + k);
            yield curbSpot(kind, at.p, [Math.cos(at.dir), Math.sin(at.dir)], road.w, road);
          }
        }
        // No road straight ahead (the stem of a T) or no room on it: the far curb across the junction, in line with the
        // approach's right-hand curb, from the junction's far edge on so it can't end up beside the junction. No lanes
        // there for an arm to hang over, so the heads go on a post.
        const e = last === a ? a.run[0] : last.run[last.run.length - 1];
        const edge = Math.max(...j.ring.map((v) => (v[0] - e[0]) * dir[0] + (v[1] - e[1]) * dir[1]));
        let out = false;
        for (let t = Math.max(0, edge), from = 0; t <= edge + 60; t += 0.5) {
          const c: Point = [e[0] + dir[0] * t, e[1] + dir[1] * t];
          const spot = curbSpot('signalpole', c, dir, a.road.w, a.road);
          if (!out) {
            if (pointInRing(spot.p, j.ring) || distanceToRing(spot.p, j.ring) < 0.5) continue;
            out = true;
            from = t;
          }
          if (t - from > LIGHTS.across) break;
          yield { ...spot, across: true };
        }
      };
      const why = tryPut(spots());
      if (why) skip(`signal-${why}`);
    }
  }
  // Mid-block signals: one light per direction, at the nearest road, past the crossing.
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
      const spots = function* () {
        for (let k = LIGHTS.past; k <= LIGHTS.past + LIGHTS.slide * 2; k += 1.5) yield curbSpot(kindFor(road), [q[0] + dir[0] * k, q[1] + dir[1] * k], dir, road.w, road);
      };
      const why = tryPut(spots());
      if (why) skip(`signal-${why}`);
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

/**
 * How well a traffic light's heads (the model's -z, (-sin, cos) of rot) line up with a road: one it stands beside (curb
 * within 3 m; a corner pole has two) or the one it looks back at across a junction, 15 m in front of the heads (a post
 * across the top of a T). The best |cos| of the angle, or -1 with no road there. Shared with map QA.
 */
export function headsAlongRoad(p: Point, rot: number, ground: SegmentGrid<Road>): number {
  const back: Point = [p[0] - Math.sin(rot) * 15, p[1] + Math.cos(rot) * 15];
  const beside = [p, back].flatMap((q) => ground.query(q, q, 15).filter((e) => distanceToSegment(q, e.a, e.b) < e.item.w / 2 + 3));
  if (!beside.length) return -1;
  return Math.max(
    ...beside.map((e) => {
      const l = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) || 1;
      return Math.abs((-Math.sin(rot) * (e.b[0] - e.a[0]) + Math.cos(rot) * (e.b[1] - e.a[1])) / l);
    }),
  );
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
