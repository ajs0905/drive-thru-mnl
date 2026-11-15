/**
 * Roadblocks where a road crosses the playable edge, like a street closed for
 * construction: a back row of concrete barriers on the edge itself, across the road and
 * a sidewalk's width either side (`EDGE_FENCE.roadMargin`); this is what stops the car,
 * together with the invisible wall behind it. Up the road from it, square to the road and
 * centered on its centerline: a "ROAD UNDER CONSTRUCTION" sign, a row of barricades (and
 * drums at its ends) across the road and its sidewalks, and cones scattered in front, all
 * facing the player and all knockable. Nothing is placed where it would touch a building:
 * on tight streets the row just gets shorter. Where the edge runs along a road instead of across it, there's only
 * the concrete line.
 *
 * Laid out at run time from the edge and the roads, seeded by the position along the
 * edge, so it's the same on every load and the renderer, the collisions and the physics
 * all use the same list.
 */
import type { Building, Point, Ring, Road } from '../map/types';
import { seeded } from '../map/hash';
import { buildingTests, EDGE_KIND, edgeStretches } from './edgeFence';
import { distanceToSegment, withWinding } from './polygon';
import { SegmentGrid } from './spatialGrid';

export type RoadblockKind = 'concrete' | 'barricade' | 'drum' | 'cone' | 'sign';
export type LooseKind = Exclude<RoadblockKind, 'concrete'>;

export interface RoadblockProp {
  kind: RoadblockKind;
  /** Center on the ground, map space. */
  p: Point;
  /** Map heading the front (+Z of the model) faces: into the playable area, toward the player. */
  rot: number;
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
   * Longer than this (m), a stretch isn't a road crossing the edge but the edge running
   * along a road: it gets the concrete line only, like a barrier closing off a lane.
   */
  crossingMax: 30,
};

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
export function roadblocksFor(map: { playable?: Ring; roads: Road[]; buildings: Building[] }): { props: RoadblockProp[]; loose: (RoadblockProp & { kind: LooseKind })[] } {
  const props = roadblockLayout(map.playable ?? [], map.roads, map.buildings);
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

/** Every roadblock piece along the playable edge (any winding), clear of the buildings. */
export function roadblockLayout(ring: Ring, roads: Road[], buildings: Building[] = []): RoadblockProp[] {
  if (ring.length < 3) return [];
  const tests = buildingTests(buildings, ring);
  const { touches } = tests;
  const ccw = withWinding(ring, true);
  const ground = new SegmentGrid<Road>(30);
  for (const r of roads) {
    if (r.cls === 'path') continue;
    for (let i = 0; i < r.points.length - 1; i++) if (!r.z || Math.max(r.z[i], r.z[i + 1]) <= 1) ground.insert(r.points[i], r.points[i + 1], r);
  }
  const k = ROADBLOCK.scale;
  const out: RoadblockProp[] = [];
  /** Adds a piece unless it would stand in a building. */
  const place = (prop: RoadblockProp) => {
    const [l, d] = footprint(prop.kind);
    if (!touches(roadblockCorners(prop.p, prop.rot, l, d))) out.push(prop);
  };
  for (const s of edgeStretches(ccw, roads, buildings, tests)) {
    if (s.kind !== EDGE_KIND.barrier) continue;
    const length = s.to - s.from;
    if (length < 1) continue;
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const [ux, uy] = [(s.b[0] - s.a[0]) / len, (s.b[1] - s.a[1]) / len];
    // Inside a counter-clockwise ring is to the left of each edge.
    const [nx, ny] = [-uy, ux];
    const edgeRot = Math.atan2(ny, nx);
    const onEdge = (along: number, inward: number): Point => [
      round2(s.a[0] + ux * (s.from + along) + nx * inward),
      round2(s.a[1] + uy * (s.from + along) + ny * inward),
    ];

    // Back row: concrete barriers end to end along the edge, centered on the stretch.
    const { gap, row } = ROADBLOCK.concrete;
    const cl = CONCRETE_SIZE[0];
    const n = Math.max(1, Math.round((length + gap) / (cl + gap)));
    const span = n * cl + (n - 1) * gap;
    for (let i = 0; i < n; i++) place({ kind: 'concrete', p: onEdge((length - span) / 2 + cl / 2 + i * (cl + gap), row), rot: edgeRot });
    if (length > ROADBLOCK.crossingMax) continue;

    // The road this stretch closes: the one nearest its middle. The loose rows stand square
    // to it, centered on where its centerline meets the edge, facing up the road.
    const mid = onEdge(length / 2, 0);
    let best: { d: number; a: Point; b: Point; road: Road } | undefined;
    for (const e of ground.query(mid, mid, 20)) {
      const d = distanceToSegment(mid, e.a, e.b);
      if (!best || d < best.d) best = { d, a: e.a, b: e.b, road: e.item };
    }
    if (!best) continue;
    let [dx, dy] = [best.b[0] - best.a[0], best.b[1] - best.a[1]];
    const dl = Math.hypot(dx, dy) || 1;
    [dx, dy] = [dx / dl, dy / dl];
    if (dx * nx + dy * ny < 0) [dx, dy] = [-dx, -dy];
    const facing = dx * nx + dy * ny;
    if (facing < 0.35) continue; // the road runs almost along the edge: concrete only
    // Where the centerline meets the edge line.
    const t = ((mid[0] - best.a[0]) * nx + (mid[1] - best.a[1]) * ny) / facing;
    const cross: Point = [best.a[0] + dx * t, best.a[1] + dy * t];
    const c = Math.hypot(cross[0] - mid[0], cross[1] - mid[1]) < length / 2 ? cross : mid;
    const rot = Math.atan2(dy, dx);
    const [px, py] = [dy, -dx]; // across the road
    // Barricades across the road and onto the sidewalks; cones on the road itself.
    const width = Math.min(best.road.w, length);
    const fullWidth = Math.min(best.road.w + 2 * ROADBLOCK.sidewalk, length);
    // Far enough up the road that the whole row is inside the edge, even on a slant.
    const room = (depth: number) => Math.max(depth, (ROADBLOCK.minRoom + (fullWidth / 2) * Math.abs(px * nx + py * ny)) / facing);
    const at = (depth: number, across: number): Point => [round2(c[0] + dx * room(depth) + px * across), round2(c[1] + dy * room(depth) + py * across)];
    const rand = seeded(`roadblock:${Math.round(s.at * 10)}`);

    // Barricade row across the road and its sidewalks, symmetric about the centerline: a
    // drum at each end, barricades between, and a drum in the middle when there's room.
    const [bw, dw, g] = [ROADBLOCK.loose.barricade.width * k, ROADBLOCK.loose.drum.width * k, ROADBLOCK.gap * k];
    const pieces = barricadeRow(fullWidth, bw, dw, g);
    centered(
      pieces.map((kind) => (kind === 'drum' ? dw : bw)),
      pieces.slice(1).map(() => g),
    ).forEach((x, i) => place({ kind: pieces[i], p: at(ROADBLOCK.barricadeRow, x), rot }));

    // The sign, on the centerline just behind the barricades.
    if (best.road.w >= ROADBLOCK.sign.minRoad) place({ kind: 'sign', p: at(ROADBLOCK.signRow, 0), rot });

    // Cones scattered in a loose band in front, across the road: evenly spread, but each
    // nudged a little, at its own distance and turned its own way, the odd one missing.
    const every = ROADBLOCK.cones.every * k;
    const count = Math.max(2, Math.round(width / every));
    const spread = width / count;
    const [near, far] = ROADBLOCK.cones.band;
    for (let i = 0; i < count; i++) {
      const [skip, dx, dd, turn] = [rand(), rand(), rand(), rand()];
      if (skip < ROADBLOCK.cones.missing) continue;
      const across = (i - (count - 1) / 2) * spread + (dx - 0.5) * spread * 0.5;
      place({ kind: 'cone', p: at(near + dd * (far - near), across), rot: rot + (turn - 0.5) * 1.2 });
    }
  }
  return out;
}
