/**
 * What the playable edge looks like from the street, as if the area past it were closed
 * for construction. Where a road crosses it (plus a sidewalk's width either side): a
 * roadblock (roadblocks.ts). Everywhere else: a corrugated construction hoarding with an
 * orange band along its top, built here. (The car is still stopped by the taller
 * invisible wall in collision.ts.)
 *
 * The hoarding is plain boxes, one per stretch; the corrugation and panel seams are drawn
 * by the edge material from the `aux` data on each vertex: meters along the edge, height
 * above the ground, kind and the piece's height.
 */
import type { Building, Point, Ring, Road } from '../map/types';
import { MeshBuilder, to3, type Vec3, type Vec4 } from './meshBuilder';
import { distanceToRing, distanceToSegment, pointInRing, ringBounds, segmentDistanceToRing } from './polygon';
import { SegmentGrid } from './spatialGrid';

export const EDGE_FENCE = {
  hoarding: { height: 2.4, thickness: 0.12 },
  /** Sampling step along the edge when finding road crossings (m), and room past the road's side (a sidewalk). */
  step: 1,
  roadMargin: 2.5,
};

/** Kinds of edge stretch: hoarding, a road (gets a roadblock), or inside a building (nothing: the building is the wall). */
export const EDGE_KIND = { hoarding: 0, barrier: 1, building: 2 } as const;

/** Hoarding pieces shorter than this (m), squeezed between a road and a building, are left out. */
const MIN_HOARDING = 1.5;
/**
 * No hoarding within this distance (m) of a building wall: where the edge runs along a
 * wall the building is the barrier (a fence pressed against it only looked like it went
 * into the building), and where the fence meets a wall it stops just short of it.
 */
const WALL_ROOM = 0.5;

/**
 * Tests against the footprints of buildings standing on the ground (raised ones, with
 * room under them, don't count): is a point inside one, and does a shape touch one?
 */
export function buildingTests(buildings: Building[], ring?: Ring): BuildingTests {
  // The edge, the roadblocks and the collisions all ask about the same buildings near the same edge.
  const cached = ring ? testsCache.get(buildings)?.get(ring) : undefined;
  if (cached) return cached;
  // A grid of building bounding boxes (each building in every cell its box covers), only
  // those within reach of the edge when one is given.
  const CELL = 25;
  const grid = new Map<string, Building[]>();
  const boxes = new Map<Building, ReturnType<typeof ringBounds>>();
  for (const b of buildings) {
    if ((b.minH ?? 0) > 2.5 || !(b.rings[0]?.length >= 3)) continue;
    const bb = ringBounds(b.rings[0]);
    if (ring && distanceToRing([(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2], ring) > Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY) / 2 + EDGE_REACH) continue;
    boxes.set(b, bb);
    for (let gx = Math.floor(bb.minX / CELL); gx <= Math.floor(bb.maxX / CELL); gx++)
      for (let gy = Math.floor(bb.minY / CELL); gy <= Math.floor(bb.maxY / CELL); gy++) {
        const key = `${gx},${gy}`;
        const list = grid.get(key);
        if (list) list.push(b);
        else grid.set(key, [b]);
      }
  }
  const near = (minX: number, minY: number, maxX: number, maxY: number) => {
    const out = new Set<Building>();
    for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++)
      for (let gy = Math.floor(minY / CELL); gy <= Math.floor(maxY / CELL); gy++)
        for (const b of grid.get(`${gx},${gy}`) ?? []) {
          const bb = boxes.get(b)!;
          if (bb.minX <= maxX && bb.maxX >= minX && bb.minY <= maxY && bb.maxY >= minY) out.add(b);
        }
    return out;
  };
  const inside = (p: Point) => [...near(p[0], p[1], p[0], p[1])].some((b) => pointInRing(p, b.rings[0]));
  const touches = (shape: Point[]) => {
    const bb = ringBounds(shape);
    for (const b of near(bb.minX - 0.05, bb.minY - 0.05, bb.maxX + 0.05, bb.maxY + 0.05)) {
      const ring = b.rings[0];
      if (shape.some((q) => pointInRing(q, ring)) || ring.some((q) => pointInRing(q, shape))) return true;
      if (shape.some((q, k) => segmentDistanceToRing(q, shape[(k + 1) % shape.length], ring) < 0.05)) return true;
    }
    return false;
  };
  const tests = { inside, touches };
  if (ring) {
    const byRing = testsCache.get(buildings) ?? new WeakMap<Ring, BuildingTests>();
    byRing.set(ring, tests);
    testsCache.set(buildings, byRing);
  }
  return tests;
}

export interface BuildingTests {
  inside: (p: Point) => boolean;
  touches: (shape: Point[]) => boolean;
}
/** How far from the edge anything along it reaches (m): roadblock rows stand up to about 15 m in. */
const EDGE_REACH = 40;
const testsCache = new WeakMap<Building[], WeakMap<Ring, BuildingTests>>();

export function edgeStretches(
  ring: Ring,
  roads: Road[],
  buildings: Building[] = [],
  tests: BuildingTests = buildingTests(buildings, ring),
): { a: Point; b: Point; from: number; to: number; kind: number; at: number }[] {
  const { inside } = tests;
  const ground = new SegmentGrid<Road>(30);
  for (const r of roads) {
    if (r.cls === 'path') continue;
    for (let i = 0; i < r.points.length - 1; i++) {
      if (r.z && Math.max(r.z[i], r.z[i + 1]) > 1) continue; // flyovers pass over the fence
      ground.insert(r.points[i], r.points[i + 1], r);
    }
  }
  const onRoad = (p: Point) => ground.query(p, p, 20).some((e) => distanceToSegment(p, e.a, e.b) < e.item.w / 2 + EDGE_FENCE.roadMargin);
  const out: ReturnType<typeof edgeStretches> = [];
  let at = 0;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.round(len / EDGE_FENCE.step));
    let start = 0;
    let kind = -1;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const p: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const here = onRoad(p) ? EDGE_KIND.barrier : inside(p) ? EDGE_KIND.building : EDGE_KIND.hoarding;
      if (kind === -1) kind = here;
      if (here !== kind) {
        out.push({ a, b, from: start, to: (k / n) * len, kind, at: at + start });
        start = (k / n) * len;
        kind = here;
      }
    }
    out.push({ a, b, from: start, to: len, kind, at: at + start });
    at += len;
  }
  return out;
}

/**
 * Adds the hoarding along the playable edge (any winding) to `mb`, which needs aux data.
 * Road stretches are left to the roadblocks; none goes through a building (the hoarding
 * stops a little short of its wall), and slivers squeezed between a road and a building
 * are left out.
 */
export function addEdgeFence(mb: MeshBuilder, ring: Ring, roads: Road[], buildings: Building[] = []): { hoarding: number; roadblocks: number } {
  const meters = { hoarding: 0, roadblocks: 0 };
  const tests = buildingTests(buildings, ring);
  const { touches } = tests;
  for (const s0 of edgeStretches(ring, roads, buildings, tests)) {
    if (s0.kind === EDGE_KIND.barrier) {
      meters.roadblocks += s0.to - s0.from;
      continue;
    }
    if (s0.kind === EDGE_KIND.building) continue;
    // Cut out anything within WALL_ROOM of a building, down to 25 cm (the stretches are
    // sampled a meter apart, which can miss a corner or a narrow building): halve the
    // stretch until each part is clear or too short to keep.
    const L = Math.hypot(s0.b[0] - s0.a[0], s0.b[1] - s0.a[1]);
    const [ux0, uy0] = [(s0.b[0] - s0.a[0]) / L, (s0.b[1] - s0.a[1]) / L];
    const strip = (from: number, to: number): Point[] => {
      const [nx0, ny0] = [uy0 * WALL_ROOM, -ux0 * WALL_ROOM];
      // Grown by WALL_ROOM at the ends too, so the fence stops short of a wall it runs into.
      const [f, t] = [from - WALL_ROOM, to + WALL_ROOM];
      const p0: Point = [s0.a[0] + ux0 * f, s0.a[1] + uy0 * f];
      const p1: Point = [s0.a[0] + ux0 * t, s0.a[1] + uy0 * t];
      return [[p0[0] + nx0, p0[1] + ny0], [p1[0] + nx0, p1[1] + ny0], [p1[0] - nx0, p1[1] - ny0], [p0[0] - nx0, p0[1] - ny0]];
    };
    const clear: [number, number][] = [];
    const split = (from: number, to: number) => {
      if (!touches(strip(from, to))) clear.push([from, to]);
      else if (to - from > 0.25) {
        const m = (from + to) / 2;
        split(from, m);
        split(m, to);
      }
    };
    split(s0.from, s0.to);
    // Join neighbouring clear parts back into pieces.
    const pieces: [number, number][] = [];
    for (const [from, to] of clear) {
      const last = pieces[pieces.length - 1];
      if (last && Math.abs(last[1] - from) < 1e-9) last[1] = to;
      else pieces.push([from, to]);
    }
    for (const [from, to] of pieces) {
      if (to - from < MIN_HOARDING) continue;
      addHoarding(mb, { ...s0, from, to, at: s0.at + from - s0.from });
      meters.hoarding += to - from;
    }
  }
  return meters;
}

/** One stretch of hoarding: a thin box with edge data per vertex. */
function addHoarding(mb: MeshBuilder, s: { a: Point; b: Point; from: number; to: number; kind: number; at: number }) {
  const spec = EDGE_FENCE.hoarding;
  const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
  const [ux, uy] = [(s.b[0] - s.a[0]) / len, (s.b[1] - s.a[1]) / len];
  const [nx, ny] = [uy * (spec.thickness / 2), -ux * (spec.thickness / 2)];
  const p0: Point = [s.a[0] + ux * s.from, s.a[1] + uy * s.from];
  const p1: Point = [s.a[0] + ux * s.to, s.a[1] + uy * s.to];
  const piece = s.to - s.from;
  const h = spec.height;
  /** A vertex at map point p, height y, `d` meters along the edge from the piece's start. */
  const v = (p: Point, side: number, y: number): Vec3 => to3(p[0] + nx * side, p[1] + ny * side, y);
  const aux = (d: number, y: number): Vec4 => [s.at + d, y, s.kind, h];
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, xa: Vec4, xb: Vec4, xc: Vec4, xd: Vec4) => {
    mb.triangle(a, b, c, n, [1, 1, 1], [xa, xb, xc]);
    mb.triangle(a, c, d, n, [1, 1, 1], [xa, xc, xd]);
  };
  const right: Vec3 = [uy, 0, ux]; // three.js normal of the map-space right side (dy, -dx)
  const left: Vec3 = [-uy, 0, -ux];
  // Right side (+1), left side (-1), top, and both ends.
  quad(v(p0, 1, 0), v(p1, 1, 0), v(p1, 1, h), v(p0, 1, h), right, aux(0, 0), aux(piece, 0), aux(piece, h), aux(0, h));
  quad(v(p1, -1, 0), v(p0, -1, 0), v(p0, -1, h), v(p1, -1, h), left, aux(piece, 0), aux(0, 0), aux(0, h), aux(piece, h));
  quad(v(p0, 1, h), v(p1, 1, h), v(p1, -1, h), v(p0, -1, h), [0, 1, 0], aux(0, h), aux(piece, h), aux(piece, h), aux(0, h));
  quad(v(p0, -1, 0), v(p0, 1, 0), v(p0, 1, h), v(p0, -1, h), [-ux, 0, uy], aux(0, 0), aux(0, 0), aux(0, h), aux(0, h));
  quad(v(p1, 1, 0), v(p1, -1, 0), v(p1, -1, h), v(p1, 1, h), [ux, 0, -uy], aux(piece, 0), aux(piece, 0), aux(piece, h), aux(piece, h));
}
