/**
 * Map QA for flyovers and the things around them, from problems found while driving them:
 *
 *   pillar-in-lanes        a pillar or post standing in the lanes of a road below it
 *   ramp-in-lanes          a ramp's side wall (at car height) inside another road's lanes,
 *                          one issue per ramp, severity in meters
 *   tree-by-deck           a tree whose crown reaches into a flyover or footbridge
 *   unsupported-building   a building starting above the ground with no posts and nothing
 *                          it leans on (it floats)
 *   deck-joint-gap         two deck pieces meeting end to end with a gap between their edges
 *   flickering-overlap     two overlapping roads of a class drawn in the same plane
 *   parked-car-in-the-way  a parked car in a junction, another road's lanes, a crossing,
 *                          a building, a wall or the playable edge (the parking step's own check)
 */
import { distanceToSegment } from '../src/geometry/polygon';
import { DECKS, DECK_SIDES_FROM, deckEdges, deckJoins, dedupeWithZ, offsetPolyline } from '../src/geometry/road';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import type { MapData, Point, Road } from '../src/map/types';
import { TREE_ROOM } from './barriers';
import type { Issue } from './qa';
import { carFootprint, parkingBlockers, PARKING, SLOT_LENGTH } from './parking';
import { overlapGraph } from './roadLayers';
import { SUPPORTS } from './structures';

/** A car's roof (m): a deck's edge band reaching lower than this blocks the lanes below it. */
const CAR_ROOF = 1.5;

export function structureIssues(map: MapData): Issue[] {
  const issues: Issue[] = [];
  const drive = new SegmentGrid<[Road, number]>(30);
  for (const r of map.roads) {
    if (r.cls === 'path' || r.scenery) continue;
    for (let i = 0; i < r.points.length - 1; i++) drive.insert(r.points[i], r.points[i + 1], [r, i]);
  }
  const lowAt = (r: Road, i: number) => (r.z ? Math.min(r.z[i], r.z[i + 1]) : 0);
  /** A road's height where it passes closest to p. */
  const heightNear = (r: Road, i: number, p: Point) => {
    if (!r.z) return 0;
    const [a, b] = [r.points[i], r.points[i + 1]];
    const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2)) : 0;
    return r.z[i] + (r.z[i + 1] - r.z[i]) * t;
  };

  // Pillars and posts in lanes (a pillar on the centerline of a wide two-way avenue is in its median: allowed).
  for (const p of map.pillars ?? []) {
    let worst = 0;
    for (const { a, b, item: [r, i] } of drive.query(p.p, p.p, 20)) {
      if (heightNear(r, i, p.p) >= p.top) continue; // a deck above it: the one it holds up
      const d = distanceToSegment(p.p, a, b);
      if (!r.oneway && r.w >= 10 && d <= 0.5) continue;
      worst = Math.max(worst, r.w / 2 + p.size / 2 - d);
    }
    if (worst > 0.05) issues.push({ kind: 'pillar-in-lanes', at: p.p, detail: `${worst.toFixed(1)} m into the lanes`, severity: worst });
  }

  // Ramps whose side walls stand in another road's lanes.
  for (const r of map.roads) {
    if (!r.z || r.scenery || r.cls === 'path') continue;
    const { pts, zs } = dedupeWithZ(r.points, r.z);
    if (pts.length < 2) continue;
    const { left, right } = offsetPolyline(pts, r.w / 2);
    let meters = 0;
    let at: Point | undefined;
    for (let k = 0; k < pts.length - 1; k++) {
      for (const side of [left, right]) {
        const [a, b] = [side[k], side[k + 1]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let s = 0.5; s < len; s += 1) {
          const t = s / len;
          const z = zs[k] + (zs[k + 1] - zs[k]) * t;
          if (z < DECK_SIDES_FROM || z - DECKS.drive.depth > CAR_ROOF) continue;
          const p: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          const hit = drive.query(p, p, 12).some(({ a: c, b: d, item: [g, i] }) => g !== r && lowAt(g, i) < 0.3 && distanceToSegment(p, c, d) < g.w / 2 - 0.3);
          if (hit) {
            meters++;
            at ??= p;
          }
        }
      }
    }
    if (meters > 0 && at) issues.push({ kind: 'ramp-in-lanes', at, detail: `${r.id} ${meters} m`, severity: meters });
  }

  // Trees into decks.
  const decks = new SegmentGrid<[Road, number]>(30);
  for (const r of map.roads) {
    if (!r.z) continue;
    for (let i = 0; i < r.points.length - 1; i++) if (Math.max(r.z[i], r.z[i + 1]) >= 1) decks.insert(r.points[i], r.points[i + 1], [r, Math.max(r.z[i], r.z[i + 1])]);
  }
  for (const t of map.trees ?? []) {
    const room = TREE_ROOM[t.shape];
    const [radius, top] = [room.radius * t.s, room.top * t.s];
    let worst = 0;
    for (const { a, b, item: [r, z] } of decks.query(t.p, t.p, radius + 12)) {
      if (z - (r.cls === 'path' ? 1 : 1.2) > top) continue;
      worst = Math.max(worst, r.w / 2 + 1 + radius - distanceToSegment(t.p, a, b));
    }
    if (worst > 0.05) issues.push({ kind: 'tree-by-deck', at: t.p, detail: `crown ${worst.toFixed(1)} m into a deck`, severity: worst });
  }

  // Raised buildings with nothing holding them up.
  const walls = new SegmentGrid<number>(30);
  map.buildings.forEach((b, bi) => {
    for (const ring of b.rings) for (let i = 0; i < ring.length; i++) walls.insert(ring[i], ring[(i + 1) % ring.length], bi);
  });
  const posts = new SegmentGrid<number>(30);
  (map.pillars ?? []).forEach((p, i) => posts.insert(p.p, p.p, i));
  map.buildings.forEach((b, bi) => {
    if ((b.minH ?? 0) <= SUPPORTS.minLift) return;
    const ring = b.rings[0];
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const hasPost = posts.query([Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]).length > 0;
    const leans = ring.some((p, i) => {
      const q = ring[(i + 1) % ring.length];
      const m: Point = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      return walls.query(m, m, 3).some((e) => e.item !== bi && distanceToSegment(m, e.a, e.b) < SUPPORTS.leans);
    });
    if (!hasPost && !leans) issues.push({ kind: 'unsupported-building', at: ring[0], detail: `${b.id} from ${b.minH} m`, severity: 1 });
  });

  // Gaps where deck pieces meet.
  const joins = deckJoins(map.roads);
  const ends = new Map<string, { r: Road; l: Point; rr: Point; start: boolean }[]>();
  for (const r of map.roads) {
    if (!r.z) continue;
    const { pts, zs } = dedupeWithZ(r.points, r.z);
    if (pts.length < 2) continue;
    const { left, right } = deckEdges(pts, r.w / 2, joins.get(r.id));
    for (const i of [0, pts.length - 1]) {
      if (zs[i] < DECK_SIDES_FROM) continue;
      const k = `${r.cls === 'path' ? 'w' : 'd'}${pts[i][0]},${pts[i][1]}`;
      const list = ends.get(k) ?? [];
      list.push({ r, l: left[i], rr: right[i], start: i === 0 });
      ends.set(k, list);
    }
  }
  for (const list of ends.values()) {
    if (list.length !== 2) continue;
    const [a, b] = list;
    const pairs = a.start === b.start ? [[a.l, b.rr], [a.rr, b.l]] : [[a.l, b.l], [a.rr, b.rr]];
    const gap = Math.max(...pairs.map(([p, q]) => Math.hypot(p[0] - q[0], p[1] - q[1]))) - Math.abs(a.r.w - b.r.w) / 2;
    if (gap > 0.1) issues.push({ kind: 'deck-joint-gap', at: a.l, detail: `${a.r.id} / ${b.r.id} ${gap.toFixed(2)} m`, severity: gap });
  }

  // Overlapping same-class roads drawn in the same plane.
  const edges = overlapGraph(map.roads);
  edges.forEach((others, i) => {
    for (const j of others) {
      if (j <= i || (map.roads[i].lift ?? 0) !== (map.roads[j].lift ?? 0)) continue;
      issues.push({ kind: 'flickering-overlap', at: map.roads[i].points[0], detail: `${map.roads[i].id} / ${map.roads[j].id}`, severity: 1 });
    }
  });

  // Parked cars standing in the way.
  if (map.parked?.length) {
    const { blocked } = parkingBlockers(map);
    for (const car of map.parked) {
      // Its own street is whichever road it stands on (a street can be split into pieces right there).
      const foot = carFootprint(car.p, car.rot, SLOT_LENGTH, PARKING.carWidth);
      const own = new Set(drive.query(car.p, car.p, 15).filter(({ a, b, item: [r] }) => distanceToSegment(car.p, a, b) < r.w / 2).map((e) => e.item[0]));
      const reasons = own.size ? [...own].map((r) => blocked(r, foot, car.p)) : [blocked(undefined, foot, car.p)];
      if (reasons.every((why) => why)) issues.push({ kind: 'parked-car-in-the-way', at: car.p, detail: reasons[0]!, severity: 1 });
    }
  }

  return issues;
}
