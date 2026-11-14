/**
 * Polygon -> low-poly 3D: building prisms (walls + flat roof) and flat ground shapes.
 */
import earcut from 'earcut';
import type { Ring } from '../map/types';
import { MeshBuilder, to3, type RGB, type Vec3, type Vec4 } from './meshBuilder';
import { withWinding } from './polygon';

const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];

/**
 * Triangulates a polygon (outer ring + holes) with earcut and adds it as a flat,
 * upward-facing surface at height `y`. Returns the number of triangles added.
 */
export function addFlatPolygon(mb: MeshBuilder, rings: Ring[], y: number, color: RGB, facingDown = false): number {
  if (rings.length === 0 || rings[0].length < 3) return 0;
  const flat: number[] = [];
  const holes: number[] = [];
  rings.forEach((ring, i) => {
    if (i > 0) holes.push(flat.length / 2);
    for (const [x, z] of ring) flat.push(x, z);
  });

  const idx = earcut(flat, holes.length ? holes : undefined, 2);
  for (let t = 0; t < idx.length; t += 3) {
    const p = (k: number): [number, number] => [flat[idx[k] * 2], flat[idx[k] * 2 + 1]];
    const [a, b, c] = [p(t), p(t + 1), p(t + 2)];
    // In map space (y north), counter-clockwise seen from above has a positive cross product.
    // After mapping y -> -z that same order faces up in three.js.
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cross === 0) continue; // sliver
    const up = cross > 0 !== facingDown;
    const [v1, v2] = up ? [b, c] : [c, b];
    mb.triangle(to3(a[0], a[1], y), to3(v1[0], v1[1], y), to3(v2[0], v2[1], y), facingDown ? DOWN : UP, color);
  }
  return idx.length / 3;
}

/** Floor-to-floor height used for windows (matches the height estimates in pipeline/heights.ts). */
export const FLOOR_HEIGHT = 3.2;

/**
 * Window styles, packed into one float per wall vertex for the building shader
 * (src/scene/buildingMaterial.ts): kind + 8·variant + 128·floors.
 */
export const WINDOWS = { none: 0, glass: 1, office: 2, apartment: 3, house: 4, parking: 5 } as const;
export type WindowKind = (typeof WINDOWS)[keyof typeof WINDOWS];

export function windowCode(kind: WindowKind, variant: number, floors: number): number {
  const v = Math.max(0, Math.min(15, Math.floor(variant)));
  const f = Math.max(0, Math.min(200, Math.floor(floors)));
  return kind + 8 * v + 128 * f;
}

export function decodeWindows(code: number): { kind: number; variant: number; floors: number } {
  return { kind: code % 8, variant: Math.floor(code / 8) % 16, floors: Math.floor(code / 128) };
}

/**
 * Adds walls for one ring. For an outward-facing wall the ring must be wound so the
 * solid is on its left: counter-clockwise for the outer ring, clockwise for holes.
 * With `windows` (a windowCode) and a MeshBuilder with aux, each vertex carries
 * [meters along this wall, meters above the base, wall length, windows].
 */
export function addWalls(mb: MeshBuilder, ring: Ring, base: number, top: number, color: RGB, windows = 0) {
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    // Outward = right of the edge direction in map space: (dy, -dx). In three.js: (dy, 0, dx).
    const n: Vec3 = [dy / len, 0, dx / len];
    const a0 = to3(ax, ay, base);
    const b0 = to3(bx, by, base);
    const a1 = to3(ax, ay, top);
    const b1 = to3(bx, by, top);
    const h = top - base;
    const [u0, u1, v0, v1]: Vec4[] = [[0, 0, len, windows], [len, 0, len, windows], [0, h, len, windows], [len, h, len, windows]];
    mb.triangle(a0, b0, b1, n, color, [u0, u1, v1]);
    mb.triangle(a0, b1, a1, n, color, [u0, v1, v0]);
  }
}

export interface ExtrudeColors {
  wall: RGB;
  roof: RGB;
  /** Window style for the walls (windowCode); 0 = plain. */
  windows?: number;
}

/**
 * Extrudes a building footprint into a prism. Fixes winding (OSM outlines come in
 * both directions) so walls always face out. Returns false for unusable input.
 */
export function extrudeBuilding(
  mb: MeshBuilder,
  rings: Ring[],
  height: number,
  colors: ExtrudeColors,
  base = 0,
): boolean {
  if (rings.length === 0 || rings[0].length < 3 || !(height > 0)) return false;
  const outer = withWinding(rings[0], true);
  const holes = rings.slice(1).filter((h) => h.length >= 3).map((h) => withWinding(h, false));
  const top = base + height;
  addWalls(mb, outer, base, top, colors.wall, colors.windows);
  for (const h of holes) addWalls(mb, h, base, top, colors.wall, colors.windows);
  addFlatPolygon(mb, [outer, ...holes], top, colors.roof);
  // Raised structures (canopies, skybridges) are seen from below.
  if (base > 0) addFlatPolygon(mb, [outer, ...holes], base, colors.roof, true);
  return true;
}
