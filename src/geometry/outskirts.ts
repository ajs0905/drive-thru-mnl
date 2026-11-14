/**
 * The city past the edge of the map. Outside the playable area and its scenery ring
 * there's no data, so the map would end in flat ground. Instead, low-detail filler
 * blocks continue the city out to where the haze covers everything, thinning out
 * with distance, with tower clusters where the real skylines are (Makati, Ortigas,
 * Rockwell, Shaw). Seeded, so it's the same on every load.
 *
 * Positions of the skylines are real (projected from their lat/long around the map
 * origin in Bonifacio Global City); the buildings themselves are made up.
 */
import type { MapData, Point } from '../map/types';
import { distanceToRing, pointInRing } from './polygon';

export interface FillerBox {
  x: number;
  y: number;
  /** Footprint across and along, meters. */
  w: number;
  d: number;
  h: number;
  /** Rotation around the vertical axis, radians (map space). */
  rot: number;
  /** 0..1, for color variation. */
  tone: number;
  /** Part of a tower cluster (gets a glassier color). */
  tower: boolean;
}

export interface Skyline {
  name: string;
  /** Map space (meters from the origin in BGC). */
  at: Point;
  radius: number;
  minH: number;
  maxH: number;
}

/** Real business districts around BGC (positions from their lat/long). */
export const SKYLINES: Skyline[] = [
  { name: 'Makati CBD', at: [-2790, 420], radius: 800, minH: 50, maxH: 220 },
  { name: 'Ortigas Center', at: [1195, 3970], radius: 650, minH: 45, maxH: 190 },
  { name: 'Rockwell', at: [-1464, 1557], radius: 280, minH: 45, maxH: 170 },
  { name: 'Shaw', at: [-1056, 2886], radius: 450, minH: 35, maxH: 140 },
];

export interface OutskirtsOptions {
  /** How far out to fill, from the map center (the fog covers everything past it). */
  radius?: number;
  /** Grid cell size, meters. */
  cell?: number;
  /** Keep this distance past the scenery ring free, so filler never touches real data. */
  gap?: number;
  /** 0..1, share of cells to fill (quality tiers use less). */
  density?: number;
  seed?: number;
}

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function outskirts(map: MapData, opts: OutskirtsOptions = {}): FillerBox[] {
  const { radius = 5200, cell = 140, gap = 80, density = 1, seed = 1 } = opts;
  const b = map.bounds;
  const center: Point = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  const ring = map.playable && map.playable.length >= 3 ? map.playable : null;
  const margin = (map.stats.clip?.marginMeters ?? 0) + gap;
  /** True where real map data is (or could be): the playable area and its scenery ring. */
  const isMapped = (p: Point) =>
    ring ? pointInRing(p, ring) || distanceToRing(p, ring) < margin : p[0] > b.minX - gap && p[0] < b.maxX + gap && p[1] > b.minY - gap && p[1] < b.maxY + gap;

  const rand = mulberry32(seed);
  const out: FillerBox[] = [];
  const n = Math.ceil(radius / cell);
  const inner = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2;
  for (let gy = -n; gy <= n; gy++) {
    for (let gx = -n; gx <= n; gx++) {
      // Draw the randoms first, so a cell's look doesn't depend on which cells were skipped.
      const r = [rand(), rand(), rand(), rand(), rand(), rand(), rand(), rand()];
      const c: Point = [center[0] + gx * cell, center[1] + gy * cell];
      const dist = Math.hypot(c[0] - center[0], c[1] - center[1]);
      if (dist > radius || isMapped(c)) continue;
      const far = Math.min(1, Math.max(0, (dist - inner) / (radius - inner)));
      if (r[0] > density * (0.95 - 0.25 * far)) continue;

      // Inside a skyline: towers, closer together and taller toward its middle.
      const sky = SKYLINES.map((s) => ({ s, k: 1 - Math.hypot(c[0] - s.at[0], c[1] - s.at[1]) / s.radius })).find((x) => x.k > 0);
      const count = sky ? 3 + Math.floor(r[1] * 2) : 2 + Math.floor(r[1] * 2);
      const rot = (r[2] - 0.5) * 0.3;
      for (let i = 0; i < count; i++) {
        const q = mulberry32(seed * 7919 + (gx + 1000) * 2003 + (gy + 1000) * 31 + i);
        const ox = (q() - 0.5) * cell * 0.62;
        const oy = (q() - 0.5) * cell * 0.62;
        let w: number;
        let d: number;
        let h: number;
        if (sky) {
          w = 22 + q() * 22;
          d = 22 + q() * 22;
          h = (sky.s.minH + (sky.s.maxH - sky.s.minH) * sky.k) * (0.55 + q() * 0.6);
        } else {
          w = 32 + q() * 40;
          d = 32 + q() * 40;
          const t = q();
          h = t < 0.7 ? 7 + q() * 11 : t < 0.95 ? 18 + q() * 17 : 35 + q() * 30;
        }
        out.push({ x: c[0] + ox, y: c[1] + oy, w, d, h, rot, tone: q(), tower: !!sky });
      }
    }
  }
  return out;
}

export interface Ridge {
  /** Direction range, degrees (map space: 0 = east, 90 = north). */
  from: number;
  to: number;
  distance: number;
  minH: number;
  maxH: number;
  seed: number;
}

/** The Rizal hills and the Sierra Madre foothills, east of BGC, in two layers. */
export const RIDGES: Ridge[] = [
  { from: -35, to: 80, distance: 9000, minH: 140, maxH: 560, seed: 3 },
  { from: -20, to: 95, distance: 11500, minH: 320, maxH: 950, seed: 5 },
];

/**
 * A ridge line: a height for each step of `step` degrees, low-poly (straight segments)
 * and tapering to nothing at both ends.
 */
export function ridgeHeights(r: Ridge, step = 2.5): { angle: number; h: number }[] {
  const rand = mulberry32(r.seed);
  const phases = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
  const out: { angle: number; h: number }[] = [];
  for (let a = r.from; a <= r.to + 1e-9; a += step) {
    const t = (a - r.from) / (r.to - r.from);
    const taper = Math.sin(Math.PI * t) ** 0.6;
    const wave = 0.5 + 0.28 * Math.sin(a * 0.11 + phases[0]) + 0.16 * Math.sin(a * 0.31 + phases[1]) + 0.08 * Math.sin(a * 0.73 + phases[2]);
    const jag = (rand() - 0.5) * 0.22;
    out.push({ angle: a, h: Math.max(0, (r.minH + (r.maxH - r.minH) * Math.min(1, Math.max(0, wave + jag))) * taper) });
  }
  return out;
}
