/**
 * Roadblocks where a road crosses the playable edge, like a street closed for
 * construction: a back row of concrete barriers on the edge itself, across the road and
 * a sidewalk's width either side (`EDGE_FENCE.roadMargin`); this is what stops the car,
 * together with the invisible wall behind it. Up the road from it, square to the road and
 * centered on its centerline: a "ROAD UNDER CONSTRUCTION" sign, a row of barricades (and
 * drums at its ends) across the road and its sidewalks, and cones scattered in front, all
 * facing the player and all knockable. One roadblock per road crossing the edge, or per
 * group of crossings close together (the two halves of a divided road, a fork, small
 * streets side by side), so rows never stack or cross. Nothing is placed where it would
 * touch a building or another loose piece: on tight streets the row just gets shorter.
 * Where the edge runs along a road instead of across it, there's only the concrete line.
 *
 * Flyovers crossing the edge get the same on their deck, at its height: concrete across
 * the deck at the edge, and the loose rows up the deck. A short dead-end stub (the edge
 * cutting across an alley less than `ROADBLOCK.stub` meters from the junction it leaves)
 * gets no loose roadblock halfway down it: a concrete row closes it off at the junction.
 *
 * Laid out at run time from the edge and the roads, seeded by the position along the
 * edge, so it's the same on every load and the renderer, the collisions and the physics
 * all use the same list.
 */
import type { Building, Point, Ring, Road, RoadClass } from '../map/types';
import { seeded } from '../map/hash';
import { buildingTests, EDGE_KIND, edgeStretches } from './edgeFence';
import { withWinding } from './polygon';
import { SegmentGrid } from './spatialGrid';

export type RoadblockKind = 'concrete' | 'barricade' | 'drum' | 'cone' | 'sign';
export type LooseKind = Exclude<RoadblockKind, 'concrete'>;

export interface RoadblockProp {
  kind: RoadblockKind;
  /** Center on the ground, map space. */
  p: Point;
  /** Map heading the front (+Z of the model) faces: into the playable area, toward the player. */
  rot: number;
  /** Height it stands at (three.js y), for pieces on a flyover deck; the ground otherwise. */
  y?: number;
}

export const ROADBLOCK = {
  /**
   * Everything is drawn this much bigger than real life (and its physics too): at real
   * size, next to roads that are 1.2x wide (MAP_SCALE), the pieces looked like toys.
   */
  scale: 1.25,
  /** Concrete barriers: length along the edge (m, before `scale`), gap between them, and their row's distance in from the edge. */
  concrete: { length: 2, gap: 0.05, row: 0.6 },
  /**
   * The loose rows stand across the road, square to it, centered on its centerline, this
   * far up the road from where it meets the edge (m): the barricade row, the sign just
   * behind it, and the cones in front (`cones.band`). Never closer to the edge than `minRoom`.
   */
  barricadeRow: 7.5,
  signRow: 5.5,
  minRoom: 4,
  /** How far the barricade row reaches past each side of the road, over the sidewalk (m). */
  sidewalk: 2,
  /** The barricade row: room between pieces (m, before `scale`), and their widths. */
  gap: 0.35,
  loose: {
    barricade: { width: 2 },
    drum: { width: 0.62 },
    cone: { width: 0.42 },
  },
  /**
   * Cones: about one every `every` meters across the road (before `scale`), each somewhere
   * between `band` meters up the road, and this share of them left out.
   */
  cones: { every: 1.4, band: [10, 12.5] as const, missing: 0.15 },
  /** Signs on roads at least this wide (m). */
  sign: { minRoad: 3 },
  /**
   * Roads meeting the edge less square than this (the dot product of the road's direction
   * and the edge's normal) run along it rather than across it: they get the concrete line
   * only, like a barrier closing off a lane.
   */
  minFacing: 0.35,
  /**
   * Crossings whose rows (road plus sidewalks) come within this distance (m) along the
   * edge share one roadblock; they share its direction when they run this much the same
   * way (dot product), as the halves of a divided road do.
   */
  groupGap: 1,
  sameWay: 0.9,
  /**
   * A road reaching less than this far (m) from the edge to the junction it leaves is a
   * stub: concrete across its mouth at the junction (`stubBack` m up from the junction's
   * edge), no loose roadblock.
   */
  stub: 15,
  stubBack: 0.8,
  /** On a flyover deck the loose rows stay this far inside its barriers (m, each side). */
  deckInset: 0.5,
};

/** Road surface heights (three.js y) per class, as drawn (scene/cityGeometry.ts `ROAD_Y`); a deck's surface is this plus its `z`. */
export type SurfaceY = Record<RoadClass, number>;
const FLAT_SURFACE: SurfaceY = { path: 0.12, service: 0.16, minor: 0.2, major: 0.24 };

/** Physics of the loose pieces (scene/roadblockBodies.ts): mass (kg) and collider half sizes (m, before `ROADBLOCK.scale`: x along the row, y up, z across). */
export const ROADBLOCK_BODIES: Record<LooseKind, { mass: number; half: [number, number, number] }> = {
  cone: { mass: 3, half: [0.21, 0.35, 0.21] },
  drum: { mass: 15, half: [0.3, 0.475, 0.3] },
  barricade: { mass: 9, half: [1, 0.55, 0.12] },
  sign: { mass: 10, half: [0.6, 0.95, 0.15] },
};

/** A piece's footprint (map space, counter-clockwise): `length` along the row, `depth` across it, facing `rot`. */
export function roadblockCorners(p: Point, rot: number, length: number, depth: number): Point[] {
  const [fx, fy] = [Math.cos(rot), Math.sin(rot)];
  const [ax, ay] = [fy, -fx]; // along the row
  const [l, d] = [length / 2, depth / 2];
  return [
    [p[0] - ax * l - fx * d, p[1] - ay * l - fy * d],
    [p[0] + ax * l - fx * d, p[1] + ay * l - fy * d],
    [p[0] + ax * l + fx * d, p[1] + ay * l + fy * d],
    [p[0] - ax * l + fx * d, p[1] - ay * l + fy * d],
  ];
}

/** Concrete barrier size as drawn: length along the row, depth, height (m). */
export const CONCRETE_SIZE: [number, number, number] = [2 * ROADBLOCK.scale, 0.6 * ROADBLOCK.scale, 0.8 * ROADBLOCK.scale];

/** Footprint of a piece as drawn: length along its row and depth (m). */
function footprint(kind: RoadblockKind): [number, number] {
  const k = ROADBLOCK.scale;
  if (kind === 'concrete') return [CONCRETE_SIZE[0], CONCRETE_SIZE[1]];
  const h = ROADBLOCK_BODIES[kind].half;
  // Barricades and signs stand on feet 0.7 m deep.
  return [2 * h[0] * k, kind === 'barricade' || kind === 'sign' ? 0.7 * k : 2 * h[2] * k];
}

/** The map's roadblocks, and the loose ones on their own (the physics and the renderer index them the same way). */
export function roadblocksFor(map: { playable?: Ring; roads: Road[]; buildings: Building[] }, surfaceY: SurfaceY = FLAT_SURFACE): { props: RoadblockProp[]; loose: (RoadblockProp & { kind: LooseKind })[] } {
  const props = roadblockLayout(map.playable ?? [], map.roads, map.buildings, surfaceY);
  return { props, loose: props.filter((p): p is RoadblockProp & { kind: LooseKind } => p.kind !== 'concrete') };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Widths (m) placed side by side with gaps, centered on 0: the center of each. */
function centered(widths: number[], gaps: number[]): number[] {
  const total = widths.reduce((s, w) => s + w, 0) + gaps.reduce((s, g) => s + g, 0);
  const out: number[] = [];
  let x = -total / 2;
  widths.forEach((w, i) => {
    out.push(x + w / 2);
    x += w + (gaps[i] ?? 0);
  });
  return out;
}

/**
 * The pieces of a barricade row `width` wide: drums at both ends and barricades between,
 * plus a drum in the middle if the barricades leave room for one; just drums on a
 * street too narrow for a barricade. Symmetric, so the row looks the same from both sides
 * of the road.
 */
export function barricadeRow(width: number, bw: number, dw: number, g: number): LooseKind[] {
  /** How many pieces `w` wide fit in `room`, with gaps between. */
  const fits = (room: number, w: number) => Math.max(0, Math.floor((room + g) / (w + g)));
  if (width < bw + 2 * (dw + g)) {
    if (width >= bw) return ['barricade'];
    return Array.from({ length: fits(width, dw) }, (): LooseKind => 'drum');
  }
  const inner = width - 2 * (dw + g);
  const n = fits(inner, bw);
  const leftover = inner - (n * bw + (n - 1) * g);
  const middle = n % 2 === 0 && leftover >= dw + g;
  const half = Array.from({ length: Math.floor(n / 2) }, (): LooseKind => 'barricade');
  const centre: LooseKind[] = n % 2 === 1 ? ['barricade'] : middle ? ['drum'] : [];
  return ['drum', ...half, ...centre, ...half, 'drum'];
}

/** Where a road's centerline crosses the playable edge. */
export interface EdgeCrossing {
  road: Road;
  /** The crossing point, and how far along the edge it is (m). */
  p: Point;
  at: number;
  /** The road's direction into the playable area, and the edge's inward normal there (unit vectors). */
  dir: Point;
  normal: Point;
  /** The road's height there (its `z`; 0 on the ground). */
  z: number;
  /** How far the road runs on from here into the playable area (m), the end it gets to, and the road's direction arriving there. */
  inside: number;
  end: Point;
  endDir: Point;
  /** Which end of the road that is (for its junction trim). */
  endIndex: 0 | 1;
}

/**
 * Every place a road's centerline crosses the edge (a counter-clockwise ring), at least
 * `minFacing` square to it (the dot product of the road's direction and the edge's
 * inward normal; lower is a road running along the edge, which only gets concrete).
 * Ground roads, or with `raised`, flyover decks (more than 1 m up) instead.
 */
export function edgeCrossings(ccw: Ring, roads: Road[], minFacing = ROADBLOCK.minFacing, raised = false): EdgeCrossing[] {
  const edge = new SegmentGrid<{ start: number; normal: Point }>(30);
  let at = 0;
  for (let i = 0; i < ccw.length; i++) {
    const [a, b] = [ccw[i], ccw[(i + 1) % ccw.length]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    edge.insert(a, b, { start: at, normal: [-(b[1] - a[1]) / len, (b[0] - a[0]) / len] });
    at += len;
  }
  const out: EdgeCrossing[] = [];
  for (const road of roads) {
    if (road.cls === 'path') continue;
    for (let i = 0; i + 1 < road.points.length; i++) {
      const high = !!road.z && Math.max(road.z[i], road.z[i + 1]) > 1;
      if (high !== raised) continue; // flyovers pass over the ground's roadblocks
      const [a, b] = [road.points[i], road.points[i + 1]];
      for (const e of edge.query(a, b)) {
        const hit = segmentHit(a, b, e.a, e.b);
        if (!hit) continue;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let dir: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        const n = e.item.normal;
        if (dir[0] * n[0] + dir[1] * n[1] < 0) dir = [-dir[0], -dir[1]];
        if (dir[0] * n[0] + dir[1] * n[1] < minFacing) continue;
        const p: Point = [e.a[0] + (e.b[0] - e.a[0]) * hit, e.a[1] + (e.b[1] - e.a[1]) * hit];
        // Where on the road (share of segment i), its height, and the run from here on inward to the road's end.
        const t = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? (p[0] - a[0]) / (b[0] - a[0]) : (p[1] - a[1]) / (b[1] - a[1]);
        const z = road.z ? road.z[i] + (road.z[i + 1] - road.z[i]) * t : 0;
        const forward = dir[0] * (b[0] - a[0]) + dir[1] * (b[1] - a[1]) > 0;
        const run = forward ? [p, ...road.points.slice(i + 1)] : [p, ...road.points.slice(0, i + 1).reverse()];
        let inside = 0;
        for (let k = 1; k < run.length; k++) inside += Math.hypot(run[k][0] - run[k - 1][0], run[k][1] - run[k - 1][1]);
        const [pe, last] = [run[run.length - 2], run[run.length - 1]];
        const el = Math.hypot(last[0] - pe[0], last[1] - pe[1]) || 1;
        out.push({
          road,
          p,
          at: e.item.start + hit * Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]),
          dir,
          normal: n,
          z,
          inside,
          end: last,
          endDir: [(last[0] - pe[0]) / el, (last[1] - pe[1]) / el],
          endIndex: forward ? 1 : 0,
        });
      }
    }
  }
  return out.sort((x, y) => x.at - y.at || x.road.id.localeCompare(y.road.id));
}

/** Where segment ab crosses segment cd, as a share of cd (ends included), or null. */
function segmentHit(a: Point, b: Point, c: Point, d: Point): number | null {
  const [rx, ry, sx, sy] = [b[0] - a[0], b[1] - a[1], d[0] - c[0], d[1] - c[1]];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? u : null;
}

/** Half of the stretch of edge a crossing's road and sidewalks take up (m). */
const edgeHalf = (c: EdgeCrossing) => (c.road.w / 2 + ROADBLOCK.sidewalk) / (c.dir[0] * c.normal[0] + c.dir[1] * c.normal[1]);

/**
 * Crossings close enough along the edge that their rows would overlap, grouped: the two
 * halves of a divided road, a fork just inside the edge, small streets side by side, or a
 * road split where it meets the edge. Each group gets one roadblock.
 */
export function crossingGroups(crossings: EdgeCrossing[], edgeLength: number): EdgeCrossing[][] {
  const groups: { list: EdgeCrossing[]; end: number }[] = [];
  for (const c of crossings) {
    const last = groups[groups.length - 1];
    if (last && c.at - edgeHalf(c) <= last.end + ROADBLOCK.groupGap) {
      last.list.push(c);
      last.end = Math.max(last.end, c.at + edgeHalf(c));
    } else groups.push({ list: [c], end: c.at + edgeHalf(c) });
  }
  // The edge is a loop: the last group can run into the first.
  if (groups.length > 1) {
    const [first, last] = [groups[0], groups[groups.length - 1]];
    if (last.end - edgeLength + ROADBLOCK.groupGap >= first.list[0].at - edgeHalf(first.list[0])) {
      first.list.unshift(...last.list);
      groups.pop();
    }
  }
  return groups.map((g) => g.list);
}

/** Do two convex footprints overlap? */
function overlaps(a: Point[], b: Point[]): boolean {
  // Separating axis test on the edges of both.
  for (const shape of [a, b])
    for (let i = 0; i < shape.length; i++) {
      const [p, q] = [shape[i], shape[(i + 1) % shape.length]];
      const [ax, ay] = [q[1] - p[1], p[0] - q[0]];
      const span = (s: Point[]) => s.map((v) => v[0] * ax + v[1] * ay);
      const [sa, sb] = [span(a), span(b)];
      if (Math.max(...sa) <= Math.min(...sb) || Math.max(...sb) <= Math.min(...sa)) return false;
    }
  return true;
}

/** Every roadblock piece along the playable edge (any winding), clear of the buildings and of each other. */
export function roadblockLayout(ring: Ring, roads: Road[], buildings: Building[] = [], surfaceY: SurfaceY = FLAT_SURFACE): RoadblockProp[] {
  if (ring.length < 3) return [];
  const tests = buildingTests(buildings, ring);
  const { touches } = tests;
  const ccw = withWinding(ring, true);
  const k = ROADBLOCK.scale;
  const out: RoadblockProp[] = [];
  const looseFeet: Point[][] = [];
  /** Adds a piece unless it would stand in a building (or, loose ones, on another loose piece). Pieces on a deck are above the buildings' reach. */
  const place = (prop: RoadblockProp) => {
    const [l, d] = footprint(prop.kind);
    const foot = roadblockCorners(prop.p, prop.rot, l, d);
    if (prop.y === undefined && touches(foot)) return;
    if (prop.kind !== 'concrete') {
      if (looseFeet.some((f) => overlaps(f, foot))) return;
      looseFeet.push(foot);
    }
    out.push(prop);
  };
  /**
   * A line of concrete barriers end to end, `length` long, centered on c, along unit u,
   * facing `rot`. With `deckAt`, on a deck: each at the deck's height, and left out where
   * there's no deck under it.
   */
  const concreteLine = (c: Point, u: Point, length: number, rot: number, deckAt?: (p: Point) => number | undefined) => {
    const { gap } = ROADBLOCK.concrete;
    const cl = CONCRETE_SIZE[0];
    const n = Math.max(1, Math.round((length + gap) / (cl + gap)));
    for (let i = 0; i < n; i++) {
      const along = (i - (n - 1) / 2) * (cl + gap);
      const p: Point = [round2(c[0] + u[0] * along), round2(c[1] + u[1] * along)];
      if (!deckAt) {
        place({ kind: 'concrete', p, rot });
        continue;
      }
      const y = deckAt(p);
      if (y !== undefined) place({ kind: 'concrete', p, rot, y: round2(y) });
    }
  };

  // Back row: concrete barriers end to end along the edge wherever a road (and its
  // sidewalks) meets it, centered on each stretch.
  for (const s of edgeStretches(ccw, roads, buildings, tests)) {
    if (s.kind !== EDGE_KIND.barrier) continue;
    const length = s.to - s.from;
    if (length < 1) continue;
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const [ux, uy] = [(s.b[0] - s.a[0]) / len, (s.b[1] - s.a[1]) / len];
    // Inside a counter-clockwise ring is to the left of each edge.
    const [nx, ny] = [-uy, ux];
    const { gap, row } = ROADBLOCK.concrete;
    const cl = CONCRETE_SIZE[0];
    const n = Math.max(1, Math.round((length + gap) / (cl + gap)));
    const span = n * cl + (n - 1) * gap;
    for (let i = 0; i < n; i++) {
      const along = s.from + (length - span) / 2 + cl / 2 + i * (cl + gap);
      place({ kind: 'concrete', p: [round2(s.a[0] + ux * along + nx * row), round2(s.a[1] + uy * along + ny * row)], rot: Math.atan2(ny, nx) });
    }
  }

  const edgeLength = ccw.reduce((sum, p, i) => sum + Math.hypot(ccw[(i + 1) % ccw.length][0] - p[0], ccw[(i + 1) % ccw.length][1] - p[1]), 0);
  const widest = (g: EdgeCrossing[]) => Math.max(...g.map((c) => c.road.w));
  // Road ends shared with another road: a stub that gets to one meets a junction there.
  const ends = new Map<string, number>();
  for (const r of roads) {
    if (r.cls === 'path') continue;
    for (const q of [r.points[0], r.points[r.points.length - 1]]) ends.set(`${q[0]},${q[1]}`, (ends.get(`${q[0]},${q[1]}`) ?? 0) + 1);
  }
  const isStub = (c: EdgeCrossing) => c.road.cls !== 'major' && c.inside < ROADBLOCK.stub;

  // Short stubs: concrete across the mouth at the junction (the edge's own row closes the
  // other end), and nothing loose halfway down a walled alley.
  const ground = crossingGroups(edgeCrossings(ccw, roads), edgeLength);
  for (const group of ground) {
    if (!group.every(isStub)) continue;
    for (const c of group) {
      if ((ends.get(`${c.end[0]},${c.end[1]}`) ?? 0) < 2) continue; // a dead end: the edge's row is enough
      const back = (c.road.trim?.[c.endIndex] ?? 0) + ROADBLOCK.stubBack;
      const [dx, dy] = c.endDir;
      const mouth: Point = [c.end[0] - dx * back, c.end[1] - dy * back];
      // Facing the junction (the way a driver coming out of it sees them).
      concreteLine(mouth, [dy, -dx], c.road.w + 1, Math.atan2(-dy, -dx));
    }
  }

  // The loose pieces: one roadblock per road crossing the edge (or group of crossings close
  // together), square to the road, centered on it, facing up the road. Widest roads first,
  // so where two would clash the bigger road keeps its row. Flyovers get theirs on the deck.
  const raised = crossingGroups(edgeCrossings(ccw, roads, ROADBLOCK.minFacing, true), edgeLength);
  const groups = [...ground.filter((g) => !g.every(isStub)).map((g) => ({ g, deck: false })), ...raised.map((g) => ({ g, deck: true }))];
  for (const { g: group, deck } of groups.sort((a, b) => widest(b.g) - widest(a.g) || a.g[0].at - b.g[0].at)) {
    // The edge's inward normal here, and the row's direction: along the roads when they run
    // the same way (a divided road), else straight in from the edge (a fork).
    const sum = (f: (c: EdgeCrossing) => Point): Point => {
      const v = group.reduce<Point>((s, c) => [s[0] + f(c)[0], s[1] + f(c)[1]], [0, 0]);
      const l = Math.hypot(v[0], v[1]) || 1;
      return [v[0] / l, v[1] / l];
    };
    const [nx, ny] = sum((c) => c.normal);
    const parallel = group.every((a) => group.every((b) => a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] >= ROADBLOCK.sameWay));
    const [dx, dy] = parallel ? sum((c) => c.dir) : [nx, ny];
    const facing = dx * nx + dy * ny;
    if (facing < ROADBLOCK.minFacing) continue;
    const rot = Math.atan2(dy, dx);
    const [px, py] = [dy, -dx]; // across the road
    // Where the roads' surfaces reach across the row, measured from the first crossing.
    const c0 = group[0].p;
    let [lo, hi] = [Infinity, -Infinity];
    for (const c of group) {
      const x = (c.p[0] - c0[0]) * px + (c.p[1] - c0[1]) * py;
      const half = c.road.w / 2 / Math.max(0.5, Math.abs(c.dir[0] * dx + c.dir[1] * dy));
      [lo, hi] = [Math.min(lo, x - half), Math.max(hi, x + half)];
    }
    // The row's center, slid along the edge to the middle of the roads.
    const [ux, uy] = [ny, -nx]; // along the edge
    const slide = (lo + hi) / 2 / (ux * px + uy * py || 1);
    const c: Point = [c0[0] + ux * slide, c0[1] + uy * slide];
    const width = hi - lo;
    // On a deck the rows stay between its barriers; on the ground they reach over the sidewalks.
    const fullWidth = deck ? Math.max(0, width - 2 * ROADBLOCK.deckInset) : width + 2 * ROADBLOCK.sidewalk;
    // Far enough up the road that the whole row is inside the edge, even on a slant.
    const room = (depth: number) => Math.max(depth, (ROADBLOCK.minRoom + (fullWidth / 2) * Math.abs(px * nx + py * ny)) / facing);
    const at = (depth: number, across: number): Point => [round2(c[0] + dx * room(depth) + px * across), round2(c[1] + dy * room(depth) + py * across)];
    // Height of a piece: the deck's surface under it, else the ground.
    const put = (kind: RoadblockKind, q: Point, r: number) => {
      if (!deck) return place({ kind, p: q, rot: r });
      // On a deck: only where there's deck under it (not in the gap between two).
      const y = deckSurface(group, q, surfaceY);
      if (y !== undefined) place({ kind, p: q, rot: r, y: round2(y) });
    };
    const rand = seeded(`roadblock:${deck ? 'deck:' : ''}${Math.round(group[0].at * 10)}`);

    // On a deck, the concrete row across it at the edge (the ground's runs along the edge itself).
    if (deck) {
      const edgeDir: Point = [ux, uy];
      const across = width / Math.max(0.35, Math.abs(px * ux + py * uy));
      const q: Point = [c[0] + nx * ROADBLOCK.concrete.row, c[1] + ny * ROADBLOCK.concrete.row];
      concreteLine(q, edgeDir, Math.max(0, across - 2 * ROADBLOCK.deckInset), Math.atan2(ny, nx), (p) => deckSurface(group, p, surfaceY));
    }

    // Barricade row across the roads (and their sidewalks), symmetric about the middle: a
    // drum at each end, barricades between, and a drum in the middle when there's room.
    const [bw, dw, g] = [ROADBLOCK.loose.barricade.width * k, ROADBLOCK.loose.drum.width * k, ROADBLOCK.gap * k];
    const pieces = barricadeRow(fullWidth, bw, dw, g);
    centered(
      pieces.map((kind) => (kind === 'drum' ? dw : bw)),
      pieces.slice(1).map(() => g),
    ).forEach((x, i) => put(pieces[i], at(ROADBLOCK.barricadeRow, x), rot));

    // The sign, in the middle just behind the barricades.
    if (widest(group) >= ROADBLOCK.sign.minRoad) put('sign', at(ROADBLOCK.signRow, 0), rot);

    // Cones scattered in a loose band in front, across the road: evenly spread, but each
    // nudged a little, at its own distance and turned its own way, the odd one missing.
    const coneWidth = deck ? fullWidth : width;
    const every = ROADBLOCK.cones.every * k;
    const count = Math.max(2, Math.round(coneWidth / every));
    const spread = coneWidth / count;
    const [near, far] = ROADBLOCK.cones.band;
    for (let i = 0; i < count; i++) {
      const [skip, jx, jd, turn] = [rand(), rand(), rand(), rand()];
      if (skip < ROADBLOCK.cones.missing) continue;
      const across = (i - (count - 1) / 2) * spread + (jx - 0.5) * spread * 0.5;
      put('cone', at(near + jd * (far - near), across), rot + (turn - 0.5) * 1.2);
    }
  }
  return out;
}

/**
 * The surface height (three.js y) of the nearest deck in the group at q (its class's road
 * height plus its `z` there), or undefined if q isn't on one (between two decks).
 */
function deckSurface(group: EdgeCrossing[], q: Point, surfaceY: SurfaceY): number | undefined {
  let best = { d: Infinity, y: 0, half: 0 };
  for (const { road } of group) {
    for (let i = 0; i + 1 < road.points.length; i++) {
      const [a, b] = [road.points[i], road.points[i + 1]];
      const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
      const l2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / l2));
      const d = Math.hypot(q[0] - a[0] - vx * t, q[1] - a[1] - vy * t);
      if (d >= best.d) continue;
      const z = road.z ? road.z[i] + (road.z[i + 1] - road.z[i]) * t : 0;
      best = { d, y: surfaceY[road.cls] + z, half: road.w / 2 };
    }
  }
  return best.d <= best.half - ROADBLOCK.deckInset ? best.y : undefined;
}
