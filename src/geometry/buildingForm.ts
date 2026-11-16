/**
 * Building shapes beyond a plain prism (D3, the lite version), decided per building from
 * its type, height and footprint, seeded by its id so every load is the same:
 *
 * - **Hip roofs on houses.** Low houses with a near-rectangular footprint (at least 90%
 *   of their minimum bounding rectangle) get a hip roof over that rectangle, rising a third
 *   of its short side (at most 2.4 m), in one of a few roof colors (terracotta, rust,
 *   teal, grey, green, blue): the barangays stop reading as a field of boxes.
 * - **Podiums and setback towers.** Towers 40 m and up with a big, near-convex footprint
 *   stand on a podium (3 to 5 floors over the whole footprint) with the tower stepped back
 *   `PODIUM.inset` m all round above it, like most of BGC's.
 * - **Shopfronts.** Most commercial, mixed and untyped buildings at least 9 m tall (and
 *   every podium) get a ground floor of shop windows and a sign band instead of their
 *   upper floors' windows: a flag in the window code (`WINDOWS_SHOPS`), painted by the
 *   building shader.
 *
 * All of it is geometry and shader data at build time: no new draw calls.
 */
import { seeded } from '../map/hash';
import type { Building, Point, Ring } from '../map/types';
import { addFlatPolygon, addWalls, extrudeBuilding, type ExtrudeColors } from './extrude';
import { to3, type MeshBuilder, type RGB, type Vec3 } from './meshBuilder';
import { convexHull, ringArea, vertexCentroid, withWinding } from './polygon';

export const RESIDENTIAL = new Set(['house', 'detached', 'residential', 'apartments', 'terrace', 'semidetached_house', 'bungalow', 'dormitory']);
export const COMMERCIAL = new Set(['office', 'commercial', 'hotel', 'retail', 'supermarket']);
export const CIVIC = new Set(['school', 'university', 'college', 'hospital', 'government', 'public', 'civic', 'church', 'chapel', 'cathedral', 'kindergarten']);
export const UTILITY = new Set(['industrial', 'warehouse', 'garage', 'garages', 'roof', 'parking', 'shed', 'service', 'construction']);
export const HOUSES = new Set(['house', 'detached', 'terrace', 'semidetached_house', 'bungalow']);

export const HIP = {
  /** Houses up to this tall (m), footprints at least this rectangular, short sides in this range (m). */
  maxHeight: 9,
  rectangular: 0.9,
  shortSide: [3.5, 16] as const,
  /** Roof rise: this share of the short side, at most `maxRise` (m). */
  pitch: 0.33,
  maxRise: 2.4,
  colors: ['#a5553a', '#8c4b3b', '#3f6f73', '#6f7377', '#4f6b4a', '#4c5f7a'],
  /** Share of eligible untyped low buildings ('yes', 'residential') that get one. */
  untyped: 0.6,
};

export const PODIUM = {
  minHeight: 40,
  minArea: 900,
  /** Footprint at least this convex (area over its hull's). */
  convex: 0.92,
  /** Floors (3.2 m) in the podium, and how far the tower steps back from its edge (m). */
  floors: [3, 5] as const,
  inset: 3,
  /** The tower keeps at least this much room from its center to its sides (m). */
  minInradius: 9,
};

export const SHOPS = {
  /** Buildings at least this tall (m) get shopfronts, this share of them. */
  minHeight: 9,
  share: 0.7,
  /** Top of the shop floor (m): glass to `glassTop`, then the sign band. Kept in step with the shader. */
  top: 4.3,
};

export interface BuildingForm {
  /** A hip roof: the rectangle's corners (counter-clockwise), its rise (m) and color. */
  hip?: { corners: Point[]; rise: number; color: string };
  /** A podium this tall (m) over the whole footprint, with the tower's footprint above it. */
  podium?: { height: number; tower: Ring };
  /** Shop windows on the ground floor. */
  shops: boolean;
}

/** The minimum-area rectangle around a set of points (rotating calipers over the hull's edges): its corners counter-clockwise, area and sides. */
export function minAreaRect(points: Point[]): { corners: Point[]; area: number; sides: [number, number] } | null {
  const hull = convexHull(points);
  if (hull.length < 3) return null;
  let best: { corners: Point[]; area: number; sides: [number, number] } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const [a, b] = [hull[i], hull[(i + 1) % hull.length]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const u: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const n: Point = [-u[1], u[0]];
    let [u0, u1, n0, n1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of hull) {
      const du = p[0] * u[0] + p[1] * u[1];
      const dn = p[0] * n[0] + p[1] * n[1];
      [u0, u1, n0, n1] = [Math.min(u0, du), Math.max(u1, du), Math.min(n0, dn), Math.max(n1, dn)];
    }
    const area = (u1 - u0) * (n1 - n0);
    if (best && area >= best.area) continue;
    const at = (du: number, dn: number): Point => [u[0] * du + n[0] * dn, u[1] * du + n[1] * dn];
    best = { corners: [at(u0, n0), at(u1, n0), at(u1, n1), at(u0, n1)], area, sides: [u1 - u0, n1 - n0] };
  }
  return best;
}

/** Shortest distance from a point to a ring's edges' lines (the room a scaled copy has to step back). */
function inradiusAt(c: Point, ring: Ring): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    d = Math.min(d, Math.abs((b[0] - a[0]) * (a[1] - c[1]) - (a[0] - c[0]) * (b[1] - a[1])) / len);
  }
  return d;
}

/** Forms already worked out (the city build and the roof props both ask). */
const FORMS = new WeakMap<Building, BuildingForm>();

export function buildingForm(b: Building): BuildingForm {
  let f = FORMS.get(b);
  if (!f) FORMS.set(b, (f = formOf(b)));
  return f;
}

function formOf(b: Building): BuildingForm {
  const ring = b.rings[0];
  const base = b.minH ?? 0;
  const tall = b.h - base;
  const none: BuildingForm = { shops: false };
  if (!ring || ring.length < 3 || base > 0 || tall < 2.5) return none;
  const rand = seeded(`${b.id}#form`);
  const [rHip, rColor, rShops, rFloors] = [rand(), rand(), rand(), rand()];
  const single = b.rings.length === 1;

  // Houses: a hip roof over the footprint's rectangle.
  const houseLike = HOUSES.has(b.type) || ((b.type === 'yes' || b.type === 'residential') && rHip < HIP.untyped);
  if (houseLike && tall <= HIP.maxHeight && single) {
    const rect = minAreaRect(ring);
    const short = rect ? Math.min(...rect.sides) : 0;
    if (rect && ringArea(ring) >= HIP.rectangular * rect.area && short >= HIP.shortSide[0] && short <= HIP.shortSide[1]) {
      return { shops: false, hip: { corners: withWinding(rect.corners, true), rise: Math.min(HIP.maxRise, short * HIP.pitch), color: HIP.colors[Math.floor(rColor * HIP.colors.length)] } };
    }
  }

  const commercial = COMMERCIAL.has(b.type) || b.type === 'yes' || b.type === 'mixed' || b.type === 'mixed_use' || b.type === 'apartments';
  let shops = commercial && !UTILITY.has(b.type) && tall >= SHOPS.minHeight && rShops < SHOPS.share;

  // Towers: a podium, the tower stepped back above it.
  if (tall >= PODIUM.minHeight && single && !RESIDENTIAL.has(b.type) && !UTILITY.has(b.type) && !CIVIC.has(b.type)) {
    const area = ringArea(ring);
    const hull = convexHull(ring);
    if (area >= PODIUM.minArea && hull.length >= 3 && area >= PODIUM.convex * ringArea(hull)) {
      const c = vertexCentroid(ring);
      const r = inradiusAt(c, ring);
      if (r - PODIUM.inset >= PODIUM.minInradius) {
        const s = (r - PODIUM.inset) / r;
        const tower = ring.map(([x, y]): Point => [c[0] + (x - c[0]) * s, c[1] + (y - c[1]) * s]);
        const floors = PODIUM.floors[0] + Math.floor(rFloors * (PODIUM.floors[1] - PODIUM.floors[0] + 1));
        shops = true;
        return { shops, podium: { height: floors * 3.2, tower } };
      }
    }
  }
  return { shops };
}

/** A hip roof over a rectangle (corners counter-clockwise) from `top`, rising `rise` m to a ridge along its long side. */
export function addHipRoof(mb: MeshBuilder, corners: Point[], top: number, rise: number, color: RGB) {
  let [c0, c1, c2, c3] = corners;
  // Start on a long side.
  if (Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) < Math.hypot(c2[0] - c1[0], c2[1] - c1[1])) [c0, c1, c2, c3] = [c1, c2, c3, c0];
  const long = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
  const short = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
  const u: Point = [(c1[0] - c0[0]) / long, (c1[1] - c0[1]) / long];
  const mid: Point = [(c0[0] + c2[0]) / 2, (c0[1] + c2[1]) / 2];
  const half = Math.max(0, (long - short) / 2);
  const r0: Point = [mid[0] - u[0] * half, mid[1] - u[1] * half];
  const r1: Point = [mid[0] + u[0] * half, mid[1] + u[1] * half];
  const [a0, a1, a2, a3] = [c0, c1, c2, c3].map(([x, y]) => to3(x, y, top));
  const [p0, p1] = [r0, r1].map(([x, y]) => to3(x, y, top + rise));
  const face = (a: Vec3, b: Vec3, c: Vec3) => {
    const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n: Vec3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / l, n[1] / l, n[2] / l];
    if (n[1] < 0) mb.triangle(a, c, b, [-n[0], -n[1], -n[2]], color);
    else mb.triangle(a, b, c, n, color);
  };
  face(a0, a1, p1);
  face(a0, p1, p0);
  face(a2, a3, p0);
  face(a2, p0, p1);
  face(a1, a2, p1);
  face(a3, a0, p0);
}

/**
 * A building with its form (see `buildingForm`): a plain prism, a prism under a hip roof,
 * or a podium with a stepped-back tower (`towerWindows` on the tower's walls).
 */
export function addFormedBuilding(
  mb: MeshBuilder,
  rings: Ring[],
  height: number,
  colors: ExtrudeColors & { hipRoof?: RGB; towerWindows?: number },
  form: BuildingForm,
  base = 0,
): boolean {
  if (!form.podium) {
    const ok = extrudeBuilding(mb, rings, height, colors, base);
    if (ok && form.hip && colors.hipRoof) addHipRoof(mb, form.hip.corners, base + height, form.hip.rise, colors.hipRoof);
    return ok;
  }
  const outer = withWinding(rings[0], true);
  const tower = withWinding(form.podium.tower, true);
  const ph = form.podium.height;
  addWalls(mb, outer, base, base + ph, colors.wall, colors.windows);
  addFlatPolygon(mb, [outer, withWinding(tower, false)], base + ph, colors.roof);
  addWalls(mb, tower, base + ph, base + height, colors.wall, colors.towerWindows ?? colors.windows);
  addFlatPolygon(mb, [tower], base + height, colors.roof);
  return true;
}
