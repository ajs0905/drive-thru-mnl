/**
 * The empty land inside the drivable area, closed off or opened up the way an open-world
 * racer does it: most empty blocks are walled at the sidewalk so the streets stay the
 * game, and a few signature spots are left open to drive into.
 *
 * - Open (`LOTS.open`): Terra 28th (a park), the Simon Mann Sports Field, and the surface
 *   parking lot by Kalayaan Avenue. OSM has no outline for the lot, only its parking
 *   aisles: stalls are laid out along them (lines, wheel stops, parked cars, a guard booth)
 *   and paved with the hull of it all. The parks get lamps, benches, a pavilion and
 *   clusters of trees. A few more parks stay open as they are (`LOTS.openParks`).
 * - Closed: construction lots get construction hoarding (ribbed metal panels on steel
 *   posts) with a yard behind it (containers, mounds, pipes, crates, work lights, a tower
 *   crane on the biggest); greenfield, brownfield and grass lots a plastered lot wall; the
 *   other parks a hedge. The walls are barriers, so they're drawn, solid and checked by map
 *   QA like the ones from OSM.
 *
 * Where a wall goes: a lot's land is rasterized at `LOTS.cell` with roads plus their
 * sidewalks and buildings taken out (OSM's land use outlines often run to the middle of
 * the road), its outline traced, simplified with Ramer-Douglas-Peucker, and every piece
 * of it that doesn't back onto a building becomes wall. Where that line crosses a
 * footpath it's a row of bollards instead, and where it crosses a driveway running into the
 * lot, a gate (a wall piece of its own). Thin strips (verges, medians) aren't lots. Everything placed is seeded by the lot's id, so every build is the same.
 */
import type { FeatureCollection } from 'geojson';
import { PARKED_MODELS, PARKED_PAINTS, pickWeighted } from '../src/car/parked';
import { createProjection } from '../src/geo/projection';
import { DRESSING_TINTS, dressingCorners } from '../src/geometry/dressing';
import { convexHull, distanceToSegment, pointInRing, ringArea, ringBounds, simplifyRing } from '../src/geometry/polygon';
import { SegmentGrid } from '../src/geometry/spatialGrid';
import { sidewalkBands } from '../src/map/roads';
import { seeded } from '../src/map/hash';
import type { Area, Barrier, BarrierKind, Dressing, DressingKind, Fixture, LotStats, MapData, ParkedCar, Point, Ring, Road, Tree } from '../src/map/types';

export type LotKind = 'park' | 'field' | 'yard' | 'construction' | 'vacant' | 'garden';

export const LOTS = {
  /** Raster cell (m). */
  cell: 1,
  /** Smaller free land isn't a lot (m2), and nor is a strip without a spot this far (m) from its edge. */
  minArea: 1200,
  minDepth: 6,
  /**
   * Sidewalk widths per road class (as drawn, scene/cityGeometry.ts) plus this are kept clear
   * of walls (m). More than the outline simplification can move a corner, so a simplified
   * wall never reaches a road without a sidewalk.
   */
  sidewalk: { major: 3, minor: 2, service: 0.6, path: 0 } as Record<Road['cls'], number>,
  curbRoom: 1,
  /** A wall piece backing onto a building closer than this (m) is left out. */
  buildingRoom: 1.5,
  /** Ramer-Douglas-Peucker tolerance for the traced outlines (m), and the shortest wall kept (m). */
  simplify: 0.8,
  minWall: 2,
  /** The open zones, by OSM id, and parks left open as they are. */
  open: { 'way/145147836': 'park', 'way/174398018': 'field' } as Record<string, LotKind>,
  openParks: ['way/174398019', 'way/32836617'],
  /** The Kalayaan surface lot: the parking aisles within `radius` of `near`. */
  yard: { near: [-937, 506] as Point, radius: 150 },
  /** Walls by lot kind: barrier kind and height (m). */
  walls: { construction: ['hoarding', 2.4], vacant: ['lotwall', 2.2], garden: ['hedge', 1.1] } as Partial<Record<LotKind, [BarrierKind, number]>>,
  /** Tower cranes on the biggest construction lots (at least this big, m2), at most `max`. */
  crane: { minArea: 12000, max: 3 },
  /** Parking stalls (m): width, depth, the aisle's half width, the share with a car in it. */
  stall: { width: 2.6, depth: 5, aisleHalf: 3, fill: 0.5 },
  /** Lamps along the edge of an open park, every `every` m, `inset` m in; benches along its paths. */
  lamps: { every: 28, inset: 2.5 },
  benches: { every: 22 },
};

const landuseKind = (a: Area): LotKind | undefined => {
  if (LOTS.open[a.id]) return LOTS.open[a.id];
  if (a.kind === 'landuse') {
    if (a.landuse === 'construction') return 'construction';
    if (a.landuse === 'greenfield' || a.landuse === 'brownfield' || a.landuse === 'grass' || a.landuse === 'vacant') return 'vacant';
    return undefined;
  }
  if (a.kind === 'park') {
    if (LOTS.openParks.includes(a.id)) return undefined;
    // Mapped grass (landuse=grass, kept as a park) is an empty lot, not a park.
    return a.landuse === 'grass' ? 'vacant' : 'garden';
  }
  return undefined;
};

/** A lot's free land on a grid: which cells, and how far each is from the edge (cells). */
interface Raster {
  x0: number;
  y0: number;
  w: number;
  h: number;
  mask: Uint8Array;
  depth: Uint16Array<ArrayBufferLike>;
}

const at = (r: Raster, i: number): Point => [r.x0 + ((i % r.w) + 0.5) * LOTS.cell, r.y0 + (Math.floor(i / r.w) + 0.5) * LOTS.cell];

/** Distance (in cells, 4-connected) from every lot cell to the nearest cell outside it. */
function depthOf(mask: Uint8Array, w: number, h: number): Uint16Array {
  const depth = new Uint16Array(mask.length);
  const queue: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const [x, y] = [i % w, Math.floor(i / w)];
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w];
    if (edge) {
      depth[i] = 1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= mask.length || !mask[j] || depth[j]) continue;
      depth[j] = depth[i] + 1;
      queue.push(j);
    }
  }
  return depth;
}

/**
 * The outline of a lot's cells as closed rings in map space, the lot on the left of each
 * edge (outer rings counter-clockwise, holes clockwise).
 */
export function traceOutline(r: Pick<Raster, 'x0' | 'y0' | 'w' | 'h' | 'mask'>, cell = LOTS.cell): Ring[] {
  const { w, h, mask } = r;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // Directed edges along cell sides with the lot on the left, keyed by their start corner.
  const next = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (w + 1) + x;
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay);
    const list = next.get(k);
    if (list) list.push(key(bx, by));
    else next.set(k, [key(bx, by)]);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) add(x, y, x + 1, y); // bottom side, going east
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1); // right side, going north
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1); // top side, going west
      if (!on(x - 1, y)) add(x, y + 1, x, y); // left side, going south
    }
  const rings: Ring[] = [];
  for (const [start] of next) {
    while (next.get(start)?.length) {
      const ring: Point[] = [];
      let k = start;
      do {
        ring.push([r.x0 + (k % (w + 1)) * cell, r.y0 + Math.floor(k / (w + 1)) * cell]);
        const outs = next.get(k)!;
        const n = outs.pop()!;
        if (!outs.length) next.delete(k);
        k = n;
      } while (k !== start && next.has(k));
      // Cell-side midpoints instead of corners: a diagonal edge's stairs become a nearly
      // straight line that simplifies cleanly (corners leave a sawtooth RDP can't remove).
      const mid = ring.map((p, i): Point => {
        const q = ring[(i + 1) % ring.length];
        return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      });
      if (ring.length >= 4) rings.push(simplifyRing(dropStraight(mid), LOTS.simplify));
    }
  }
  return rings;
}

/** Drops the points in the middle of straight runs (a traced outline has one per cell). */
function dropStraight(ring: Point[]): Point[] {
  return ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length];
    const b = ring[(i + 1) % ring.length];
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-9;
  });
}

export interface LotsResult {
  barriers: Barrier[];
  fixtures: Fixture[];
  dressing: Dressing[];
  trees: Tree[];
  parked: ParkedCar[];
  areas: Area[];
  stats: LotStats;
}

/**
 * Lots, their walls and what's in them. `raw` is the OSM export (for the parking aisles,
 * which the map itself leaves out).
 */
export function placeLots(map: MapData, raw?: FeatureCollection): LotsResult {
  const ring = map.playable ?? [];
  const inPlay = (p: Point) => ring.length < 3 || pointInRing(p, ring);
  // Ground-level road pieces only (a ramp's foot counts, the deck above doesn't).
  const ground = (r: Road, i: number) => Math.max(r.z?.[i] ?? 0, r.z?.[i + 1] ?? 0) <= 1;
  const roads = new SegmentGrid<Road>(30);
  for (const r of map.roads) {
    if (r.cls === 'path') continue;
    for (let i = 0; i < r.points.length - 1; i++) if (ground(r, i)) roads.insert(r.points[i], r.points[i + 1], r);
  }
  const paths = new SegmentGrid<Road>(30);
  for (const r of map.roads) if (r.cls === 'path') for (let i = 0; i < r.points.length - 1; i++) if (ground(r, i)) paths.insert(r.points[i], r.points[i + 1], r);
  const buildings = new SegmentGrid<Ring>(30);
  for (const b of map.buildings) {
    if (b.scenery || (b.minH ?? 0) > 2.5) continue;
    const r = b.rings[0];
    const bb = ringBounds(r);
    buildings.insert([bb.minX, bb.minY], [bb.maxX, bb.maxY], r);
  }
  const inBuilding = (p: Point, room = 0) =>
    buildings.query([p[0] - room, p[1] - room], [p[0] + room, p[1] + room]).some((e) => pointInRing(p, e.item) || (room > 0 && nearRing(p, e.item, room)));
  const reach = (r: Road) => {
    const s = sidewalkBands(r);
    return r.w / 2 + (s.left || s.right ? LOTS.sidewalk[r.cls] : r.cls === 'service' ? LOTS.sidewalk.service : 0) + LOTS.curbRoom;
  };
  const onRoad = (p: Point, ignore?: Set<Road>) =>
    roads.query([p[0] - 12, p[1] - 12], [p[0] + 12, p[1] + 12]).some((e) => !ignore?.has(e.item) && distanceToSegment(p, e.a, e.b) < reach(e.item));
  const pathsIn = (r: Raster) =>
    paths.query([r.x0, r.y0], [r.x0 + r.w * LOTS.cell, r.y0 + r.h * LOTS.cell]).map((e) => ({ a: e.a, b: e.b, w: e.item.w }));
  const nearPath = (p: Point, room: number) => paths.query([p[0] - room, p[1] - room], [p[0] + room, p[1] + room]).some((e) => distanceToSegment(p, e.a, e.b) < e.item.w / 2 + room);

  const claimed = new Set<string>();
  const cellKey = (p: Point) => `${Math.floor(p[0] / LOTS.cell)},${Math.floor(p[1] / LOTS.cell)}`;
  const out: LotsResult = {
    barriers: [],
    fixtures: [],
    dressing: [],
    trees: [],
    parked: [],
    areas: [],
    stats: { byKind: {}, wallMeters: {}, openArea: 0, closedArea: 0, stalls: 0 },
  };
  const placed: Point[][] = [];
  /** Reserves a footprint unless it overlaps one already taken. */
  const claim = (foot: Point[]): boolean => {
    if (placed.some((f) => overlap(f, foot))) return false;
    placed.push(foot);
    return true;
  };
  const put = (d: Dressing, margin = 0.4): boolean => {
    if (!claim(dressingCorners(d.k, d.p, d.rot, margin))) return false;
    out.dressing.push({ ...d, p: [round2(d.p[0]), round2(d.p[1])], rot: round3(d.rot) });
    return true;
  };

  // Biggest first: where lots overlap, the bigger one keeps the land.
  const candidates = map.areas
    .map((a) => ({ a, kind: landuseKind(a) }))
    .filter((c): c is { a: Area; kind: LotKind } => !!c.kind && c.a.rings[0]?.length >= 3)
    .sort((x, y) => ringArea(y.a.rings[0]) - ringArea(x.a.rings[0]) || x.a.id.localeCompare(y.a.id));
  let cranes = 0;
  for (const { a, kind } of candidates) {
    const outer = a.rings[0];
    const b = ringBounds(outer);
    const x0 = Math.floor(b.minX) - 2;
    const y0 = Math.floor(b.minY) - 2;
    const w = Math.ceil((b.maxX - x0 + 2) / LOTS.cell);
    const h = Math.ceil((b.maxY - y0 + 2) / LOTS.cell);
    if (w * h > 400000) continue;
    // Service roads that run inside the lot belong to it (a wall closes across them).
    const inside = new Set<Road>();
    for (const r of map.roads) if (r.cls === 'service' && r.points.filter((p) => pointInRing(p, outer)).length > r.points.length / 2) inside.add(r);
    const mask = new Uint8Array(w * h);
    const raster: Raster = { x0, y0, w, h, mask, depth: new Uint16Array(0) };
    let cells = 0;
    for (let i = 0; i < mask.length; i++) {
      const p = at(raster, i);
      if (!pointInRing(p, outer) || a.rings.slice(1).some((hole) => pointInRing(p, hole))) continue;
      if (!inPlay(p) || claimed.has(cellKey(p)) || onRoad(p, inside) || inBuilding(p)) continue;
      mask[i] = 1;
      cells++;
    }
    if (cells * LOTS.cell * LOTS.cell < LOTS.minArea) continue;
    raster.depth = depthOf(mask, w, h);
    let deepest = 0;
    for (let i = 0; i < mask.length; i++) if (raster.depth[i] > raster.depth[deepest]) deepest = i;
    if (raster.depth[deepest] * LOTS.cell < LOTS.minDepth) continue;
    for (let i = 0; i < mask.length; i++) if (mask[i]) claimed.add(cellKey(at(raster, i)));
    const area = cells * LOTS.cell * LOTS.cell;
    out.stats.byKind[kind] = (out.stats.byKind[kind] ?? 0) + 1;
    const rand = seeded(`lot:${a.id}`);
    const outline = traceOutline(raster);
    const axis = mainAxis(outline);

    const wall = LOTS.walls[kind];
    if (wall) {
      out.stats.closedArea += area;
      const [barrierKind, height] = wall;
      let n = 0;
      // Where the wall line would stand on a footpath there's a row of bollards instead (the
      // way into a park or a site, or a path along its edge: open to people, closed to cars);
      // where on a road, a gate: a piece of the same wall of its own, so map QA can tell it
      // closes the road on purpose.
      const addWall = (points: Point[], id: string) => {
        out.barriers.push({ id, kind: barrierKind, h: height, points: points.map(([x, y]) => [round2(x), round2(y)]) });
        out.stats.wallMeters[barrierKind] = (out.stats.wallMeters[barrierKind] ?? 0) + lengthOf(points);
      };
      for (const loop of outline) {
        for (const piece of wallPieces(loop, (p) => inBuilding(p, LOTS.buildingRoom) || !inPlay(p))) {
          if (lengthOf(piece) < LOTS.minWall) continue;
          const on = standsOn(piece, (p) => {
            if (roads.query(p, p, 12).some((e) => distanceToSegment(p, e.a, e.b) < e.item.w / 2 + 0.05)) return 'road';
            if (paths.query(p, p, 6).some((e) => distanceToSegment(p, e.a, e.b) < e.item.w / 2 + 0.3)) return 'path';
            return undefined;
          });
          // A gate a little wider than the road, so the wall beside it stays clear of the asphalt.
          for (const c of on) if (c.on === 'road') [c.from, c.to] = [c.from - 0.3, c.to + 0.3];
          for (const run of cutAt(piece, on)) {
            if (run.on === 'path') {
              out.stats.openings = (out.stats.openings ?? 0) + 1;
              for (const q of postsAlongRun(run.points, 1.3)) out.fixtures.push({ kind: 'bollard', p: [round2(q[0]), round2(q[1])], rot: 0 });
            } else if (run.on === 'road') {
              addWall(run.points, `lot/${a.id}/${n++}/gate`);
              out.stats.gates = (out.stats.gates ?? 0) + 1;
            } else if (lengthOf(run.points) >= 0.5) addWall(run.points, `lot/${a.id}/${n++}`);
          }
        }
      }
    } else out.stats.openArea += area;

    // What's inside: spots at least `room` cells from the edge, in a seeded order.
    const spots = (room: number) => {
      const list: number[] = [];
      for (let i = 0; i < mask.length; i++) if (mask[i] && raster.depth[i] >= room) list.push(i);
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list.map((i) => at(raster, i));
    };
    const fill = (k: DressingKind, count: number, room: number, turn = () => axis + (rand() < 0.5 ? 0 : Math.PI / 2), extra?: (p: Point) => boolean) => {
      let n = 0;
      for (const p of spots(room)) {
        if (n >= count) break;
        if (extra && !extra(p)) continue;
        const d: Dressing = { k, p, rot: turn() };
        if (k === 'container') d.c = Math.floor(rand() * DRESSING_TINTS.length);
        if (put(d, k === 'container' ? 0.6 : 1)) n++;
      }
      return n;
    };
    if (kind === 'construction') {
      if (area >= LOTS.crane.minArea && cranes < LOTS.crane.max) {
        if (put({ k: 'crane', p: at(raster, deepest), rot: axis }, 3)) cranes++;
      }
      fill('container', clamp(Math.round(area / 1800), 2, 9), 5);
      fill('mound', clamp(Math.round(area / 4500), 1, 4), 6);
      fill('pipes', clamp(Math.round(area / 9000), 1, 3), 4);
      fill('crates', clamp(Math.round(area / 6000), 1, 4), 3);
      fill('dumpster', 1, 3);
      // Work lights just inside the hoarding.
      fill('worklight', clamp(Math.round(area / 5000), 2, 6), 2, () => rand() * Math.PI * 2, (p) => raster.depth[indexOf(raster, p)] <= 3);
    } else if (kind === 'vacant' && area > 4000) {
      fill('mound', 1, 6);
    } else if (kind === 'park' || kind === 'field') {
      dressPark(kind, raster, outline, rand, put, claim, nearPath, pathsIn, out.trees);
    }
  }

  if (raw) placeYard(map, raw, out, put, onRoad, inBuilding, inPlay);
  out.stats.wallMeters = Object.fromEntries(Object.entries(out.stats.wallMeters).map(([k, v]) => [k, Math.round(v)]));
  out.stats.openArea = Math.round(out.stats.openArea);
  out.stats.closedArea = Math.round(out.stats.closedArea);
  return out;
}

/** Lamps along the edge, benches along the paths, a pavilion (parks), clusters of trees. */
function dressPark(
  kind: LotKind,
  raster: Raster,
  outline: Ring[],
  rand: () => number,
  put: (d: Dressing, margin?: number) => boolean,
  claim: (foot: Point[]) => boolean,
  nearPath: (p: Point, room: number) => boolean,
  pathSegments: (r: Raster) => { a: Point; b: Point; w: number }[],
  trees: Tree[],
) {
  const inside = (p: Point) => {
    const i = indexOf(raster, p);
    return i >= 0 && raster.mask[i] === 1;
  };
  for (const loop of outline) {
    walkRing(loop, LOTS.lamps.every, (p, dir) => {
      // Inside is on the left of the outline.
      const q: Point = [p[0] - dir[1] * LOTS.lamps.inset, p[1] + dir[0] * LOTS.lamps.inset];
      if (inside(q) && !nearPath(q, 0.6)) put({ k: 'lamp', p: q, rot: Math.atan2(dir[1], dir[0]) }, 0.5);
    });
  }
  // Benches beside the footpaths, every `LOTS.benches.every` m, alternating sides.
  let side = 1;
  for (const seg of pathSegments(raster)) {
    const len = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]);
    if (len < 4) continue;
    const [ux, uy] = [(seg.b[0] - seg.a[0]) / len, (seg.b[1] - seg.a[1]) / len];
    for (let s = LOTS.benches.every / 2; s < len - 2; s += LOTS.benches.every) {
      side = -side;
      const off = seg.w / 2 + 0.8;
      const p: Point = [seg.a[0] + ux * s - uy * off * side, seg.a[1] + uy * s + ux * off * side];
      if (!inside(p) || nearPath(p, 0.3)) continue;
      // Facing the path: its back away from it.
      put({ k: 'bench', p, rot: Math.atan2(uy, ux) + (side > 0 ? Math.PI : 0) }, 0.4);
    }
  }
  if (kind === 'park') {
    let deepest = 0;
    for (let i = 0; i < raster.mask.length; i++) if (raster.depth[i] > raster.depth[deepest]) deepest = i;
    for (let tries = 0, done = false; tries < 400 && !done; tries++) {
      const i = Math.floor(rand() * raster.mask.length);
      if (raster.depth[i] < 6) continue;
      const p = at(raster, i);
      if (nearPath(p, 4)) continue;
      done = put({ k: 'pavilion', p, rot: rand() * Math.PI }, 1.5);
    }
    // Clusters of three to five trees, clear of the paths.
    for (let c = 0, tries = 0; c < 5 && tries < 300; tries++) {
      const i = Math.floor(rand() * raster.mask.length);
      if (raster.depth[i] < 5) continue;
      const center = at(raster, i);
      if (nearPath(center, 4)) continue;
      const n = 3 + Math.floor(rand() * 3);
      let planted = 0;
      for (let t = 0; t < n * 3 && planted < n; t++) {
        const a = rand() * Math.PI * 2;
        const r = 2 + rand() * 5;
        const p: Point = [round2(center[0] + Math.cos(a) * r), round2(center[1] + Math.sin(a) * r)];
        if (!inside(p) || raster.depth[indexOf(raster, p)] < 3 || nearPath(p, 2.5)) continue;
        if (trees.some((q) => Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) < 4)) continue;
        if (!claim(dressingCorners('bin', p, 0, 1.6))) continue; // room for the crown's trunk
        trees.push({ p, shape: 'broad', s: round2(0.85 + rand() * 0.35) });
        planted++;
      }
      if (planted) c++;
    }
  }
}

/**
 * The open parking yard by Kalayaan Avenue: stalls along both sides of its parking aisles,
 * each with side lines and a wheel stop, about half with a car in; the whole thing paved;
 * a guard booth at the aisle nearest a street.
 */
function placeYard(
  map: MapData,
  raw: FeatureCollection,
  out: LotsResult,
  put: (d: Dressing, margin?: number) => boolean,
  onRoad: (p: Point) => boolean,
  inBuilding: (p: Point, room?: number) => boolean,
  inPlay: (p: Point) => boolean,
) {
  const proj = createProjection(map.origin, map.scale);
  const aisles: Point[][] = [];
  for (const f of raw.features) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    if (props.service !== 'parking_aisle' || f.geometry?.type !== 'LineString') continue;
    const pts = f.geometry.coordinates.map(([lon, lat]) => {
      const { x, y } = proj.toLocal({ lat, lon });
      return [x, y] as Point;
    });
    if (pts.some((p) => Math.hypot(p[0] - LOTS.yard.near[0], p[1] - LOTS.yard.near[1]) < LOTS.yard.radius)) aisles.push(pts);
  }
  if (!aisles.length) return;
  out.stats.byKind.yard = 1;
  const { width, depth, aisleHalf, fill } = LOTS.stall;
  const rand = seeded('lot:yard');
  const corners: Point[] = aisles.flat();
  const lines = new Set<string>();
  let stalls = 0;
  for (const aisle of aisles) {
    for (let i = 0; i < aisle.length - 1; i++) {
      const [a, b] = [aisle[i], aisle[i + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < width * 2) continue;
      const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      for (const side of [1, -1]) {
        const [nx, ny] = [-uy * side, ux * side];
        for (let s = width; s + width <= len - width / 2; s += width) {
          const along: Point = [a[0] + ux * s, a[1] + uy * s];
          const c: Point = [along[0] + nx * (aisleHalf + depth / 2), along[1] + ny * (aisleHalf + depth / 2)];
          const foot: Point[] = [-1, 1].flatMap((e) => [-1, 1].map((f): Point => [c[0] + ux * e * (width / 2) + nx * f * (depth / 2), c[1] + uy * e * (width / 2) + ny * f * (depth / 2)]));
          if (!inPlay(c) || foot.some((q) => onRoad(q) || inBuilding(q, 0.3))) continue;
          // The stall claims its ground (as a wheel stop's footprint grown to the stall's).
          if (!put({ k: 'wheelstop', p: [c[0] + nx * (depth / 2 - 0.5), c[1] + ny * (depth / 2 - 0.5)], rot: Math.atan2(uy, ux) }, 0.1)) continue;
          stalls++;
          corners.push(...foot);
          // Its two side lines, shared with the next stall.
          for (const e of [-1, 1]) {
            const p: Point = [round2(c[0] + ux * e * (width / 2)), round2(c[1] + uy * e * (width / 2))];
            const k = `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
            if (lines.has(k)) continue;
            lines.add(k);
            out.dressing.push({ k: 'stall', p, rot: round3(Math.atan2(ny, nx)) });
          }
          if (rand() < fill) {
            const v = pickWeighted(PARKED_MODELS.map((m) => m.weight), rand());
            const paint = pickWeighted(PARKED_PAINTS.map((p) => p.weight), rand());
            // Nose in: the car faces the back of the stall.
            out.parked.push({ p: [round2(c[0] + nx * 0.2), round2(c[1] + ny * 0.2)], rot: round3(Math.atan2(ny, nx)), v, c: paint });
          }
        }
      }
    }
  }
  out.stats.stalls = stalls;
  const hull = convexHull(corners);
  out.areas.push({ id: 'lot/yard', kind: 'parking', rings: [hull.map(([x, y]) => [round2(x), round2(y)] as Point)] });
  out.stats.openArea += Math.round(ringArea(hull));
  // The guard booth: beside the aisle end nearest a street.
  let best: { p: Point; dir: Point; d: number } | undefined;
  for (const aisle of aisles)
    for (const [end, prev] of [[aisle[0], aisle[1]], [aisle[aisle.length - 1], aisle[aisle.length - 2]]] as [Point, Point][]) {
      const d = Math.min(...map.roads.filter((r) => r.cls !== 'path').flatMap((r) => r.points.slice(1).map((q, i) => distanceToSegment(end, r.points[i], q))));
      const len = Math.hypot(end[0] - prev[0], end[1] - prev[1]) || 1;
      if (!best || d < best.d) best = { p: end, dir: [(end[0] - prev[0]) / len, (end[1] - prev[1]) / len], d };
    }
  if (best) {
    const { p, dir } = best;
    for (const back of [6, 9, 12]) {
      const q: Point = [p[0] - dir[0] * back - dir[1] * (aisleHalf + 1.6), p[1] - dir[1] * back + dir[0] * (aisleHalf + 1.6)];
      if (!onRoad(q) && !inBuilding(q, 0.5) && put({ k: 'booth', p: q, rot: Math.atan2(dir[1], dir[0]) }, 0.3)) break;
    }
  }
}

/** The pieces of a closed outline to wall: everything except where `skip` holds just outside it. */
export function wallPieces(loop: Ring, skip: (outside: Point) => boolean): Point[][] {
  const n = loop.length;
  const keep = loop.map((a, i) => {
    const b = loop[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // The lot is on the left; just outside is on the right.
    const mid: Point = [(a[0] + b[0]) / 2 + ((b[1] - a[1]) / len) * 1, (a[1] + b[1]) / 2 - ((b[0] - a[0]) / len) * 1];
    return !skip(mid);
  });
  if (keep.every(Boolean)) return [[...loop, loop[0]]];
  const pieces: Point[][] = [];
  // Start right after a skipped edge, so runs don't wrap around the start.
  const start = keep.findIndex((k, i) => k && !keep[(i + n - 1) % n]);
  if (start < 0) return [];
  let run: Point[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (keep[i]) {
      if (!run.length) run.push(loop[i]);
      run.push(loop[(i + 1) % n]);
    } else if (run.length) {
      pieces.push(run);
      run = [];
    }
  }
  if (run.length) pieces.push(run);
  return pieces;
}

/** The stretches of a polyline that stand on something (sampled every 0.25 m): intervals in meters along it. */
export function standsOn<T extends string>(line: Point[], on: (p: Point) => T | undefined): { from: number; to: number; on: T }[] {
  const out: { from: number; to: number; on: T }[] = [];
  let start = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / 0.25));
    for (let k = 0; k <= steps; k++) {
      const d = start + (len * k) / steps;
      const here = on([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
      if (!here) continue;
      const last = out[out.length - 1];
      // Stretch a sample's interval half a step each way so neighbors join.
      if (last && last.on === here && d - last.to <= 0.3) last.to = d + 0.125;
      else out.push({ from: d - 0.125, to: d + 0.125, on: here });
    }
    start += len;
  }
  return out;
}

/**
 * A polyline cut into runs at the given intervals (merged where they overlap; a road wins
 * over a path): the runs between them (`on` undefined) and the intervals themselves.
 */
export function cutAt<T extends string>(line: Point[], cuts: { from: number; to: number; on: T }[]): { on: T | undefined; points: Point[] }[] {
  const total = lengthOf(line);
  const merged: { from: number; to: number; on: T }[] = [];
  for (const c of [...cuts].sort((x, y) => x.from - y.from)) {
    const [from, to] = [Math.max(0, c.from), Math.min(total, c.to)];
    if (to <= from) continue;
    const last = merged[merged.length - 1];
    if (last && from <= last.to) {
      last.to = Math.max(last.to, to);
      if (c.on === ('road' as T)) last.on = c.on;
    } else merged.push({ from, to, on: c.on });
  }
  const runs: { on: T | undefined; points: Point[] }[] = [];
  let s = 0;
  for (const c of merged) {
    if (c.from > s) runs.push({ on: undefined, points: slice(line, s, c.from) });
    runs.push({ on: c.on, points: slice(line, c.from, c.to) });
    s = c.to;
  }
  if (s < total) runs.push({ on: undefined, points: slice(line, s, total) });
  return runs.filter((r) => r.points.length >= 2 && lengthOf(r.points) > 1e-3);
}

/** The part of a polyline between two distances along it. */
function slice(line: Point[], from: number, to: number): Point[] {
  const out: Point[] = [];
  let s = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lerp = (d: number): Point => [a[0] + ((b[0] - a[0]) * (d - s)) / (len || 1), a[1] + ((b[1] - a[1]) * (d - s)) / (len || 1)];
    if (s + len >= from && s <= to) {
      if (!out.length) out.push(lerp(Math.max(from, s)));
      if (s + len <= to) out.push(b);
      else {
        out.push(lerp(to));
        break;
      }
    }
    s += len;
  }
  return out;
}

/** Points every `every` meters along a run, its ends included. */
function postsAlongRun(points: Point[], every: number): Point[] {
  const total = lengthOf(points);
  const n = Math.max(1, Math.round(total / every));
  const out: Point[] = [];
  let i = 0;
  let walked = 0;
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * total;
    while (i < points.length - 2 && walked + Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]) < s) {
      walked += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
      i++;
    }
    const [a, b] = [points[i], points[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = Math.min(1, (s - walked) / len);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Calls `fn` every `every` meters along a closed ring, with the direction there. */
function walkRing(ring: Ring, every: number, fn: (p: Point, dir: Point) => void) {
  let carry = every / 2;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const dir: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    let s = carry;
    for (; s < len; s += every) fn([a[0] + dir[0] * s, a[1] + dir[1] * s], dir);
    carry = s - len;
  }
}

/** The direction of a lot's longest wall run (radians), so its contents line up with it. */
function mainAxis(outline: Ring[]): number {
  let best = 0;
  let angle = 0;
  for (const loop of outline)
    for (let i = 0; i < loop.length; i++) {
      const [a, b] = [loop[i], loop[(i + 1) % loop.length]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > best) [best, angle] = [len, Math.atan2(b[1] - a[1], b[0] - a[0])];
    }
  return angle;
}

function indexOf(r: Raster, p: Point): number {
  const x = Math.floor((p[0] - r.x0) / LOTS.cell);
  const y = Math.floor((p[1] - r.y0) / LOTS.cell);
  return x < 0 || y < 0 || x >= r.w || y >= r.h ? -1 : y * r.w + x;
}

function nearRing(p: Point, ring: Ring, room: number): boolean {
  for (let i = 0; i < ring.length; i++) if (distanceToSegment(p, ring[i], ring[(i + 1) % ring.length]) < room) return true;
  return false;
}

function lengthOf(points: Point[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return s;
}

/** Do two convex footprints overlap (separating axis test)? */
function overlap(a: Point[], b: Point[]): boolean {
  for (const shape of [a, b])
    for (let i = 0; i < shape.length; i++) {
      const [p, q] = [shape[i], shape[(i + 1) % shape.length]];
      const [ax, ay] = [q[1] - p[1], p[0] - q[0]];
      let [amin, amax, bmin, bmax] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const v of a) {
        const d = v[0] * ax + v[1] * ay;
        [amin, amax] = [Math.min(amin, d), Math.max(amax, d)];
      }
      for (const v of b) {
        const d = v[0] * ax + v[1] * ay;
        [bmin, bmax] = [Math.min(bmin, d), Math.max(bmax, d)];
      }
      if (amax <= bmin || bmax <= amin) return false;
    }
  return true;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

