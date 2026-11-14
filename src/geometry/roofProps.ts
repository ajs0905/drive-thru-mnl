/**
 * Rooftop details: stair/elevator housings and AC units on bigger flat roofs, water
 * tanks on mid-rises and on some houses (a common sight in Metro Manila).
 *
 * Placement is deterministic (seeded by the building id), aligned with the
 * building's longest wall, and only accepted where the whole prop fits on the roof.
 * The renderer draws all of them with two instanced meshes (boxes and cylinders).
 */
import { seeded } from '../map/hash';
import type { Building, Point } from '../map/types';
import type { Prop } from './props';
import { distanceToRing, pointInRing, ringArea, ringBounds } from './polygon';

export type RoofPropKind = 'housing' | 'ac' | 'tank';

/** A rooftop prop: `base` is the roof height; tanks are sized diameter, height, diameter. */
export type RoofProp = Prop & { kind: RoofPropKind };

/** Direction of the longest edge, so props line up with the walls. */
function mainAngle(ring: Point[]): number {
  let best = 0;
  let angle = 0;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > best) [best, angle] = [len, Math.atan2(b[1] - a[1], b[0] - a[0])];
  }
  return angle;
}

const HOUSES = new Set(['house', 'detached', 'terrace', 'semidetached_house', 'bungalow', 'yes', 'residential']);
const BLANK = new Set(['roof', 'construction', 'parking', 'garage', 'garages']);

export function roofProps(b: Building): RoofProp[] {
  const ring = b.rings[0];
  if (!ring || ring.length < 3 || (b.minH ?? 0) > 0 || b.scenery || BLANK.has(b.type)) return [];
  const area = ringArea(ring);
  const rand = seeded(b.id);
  const rot = mainAngle(ring);
  const bounds = ringBounds(ring);
  const out: RoofProp[] = [];

  /** Tries random spots until the prop (radius r) fits inside the roof and clear of others. */
  const place = (kind: RoofPropKind, size: [number, number, number]) => {
    const r = Math.hypot(size[0], size[2]) / 2 + 0.6;
    for (let attempt = 0; attempt < 14; attempt++) {
      const x = bounds.minX + rand() * (bounds.maxX - bounds.minX);
      const y = bounds.minY + rand() * (bounds.maxY - bounds.minY);
      if (!pointInRing([x, y], ring) || distanceToRing([x, y], ring) < r) continue;
      if (b.rings.slice(1).some((h) => pointInRing([x, y], h) || distanceToRing([x, y], h) < r)) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.y - y) < r + Math.hypot(o.size[0], o.size[2]) / 2)) continue;
      out.push({ kind, x, y, base: b.h, size, rot, tone: rand() });
      return;
    }
  };

  if (b.h >= 9 && area >= 150) {
    // Mid-rises and towers: a stair/elevator housing, some AC units, often a tank.
    const w = Math.min(7, Math.max(3, Math.sqrt(area) * 0.18));
    place('housing', [w, 2.8, w * 0.8]);
    const units = Math.min(4, Math.floor(area / 250));
    for (let i = 0; i < units; i++) place('ac', [1.3, 0.9, 1.0]);
    if (rand() < 0.5) place('tank', [2, 1.8, 2]);
  } else if (HOUSES.has(b.type) && area >= 25 && area <= 400 && b.h < 12) {
    // Houses and small buildings: a water tank on some of them.
    if (rand() < 0.2) place('tank', [1.2, 1.3, 1.2]);
  }
  return out;
}
