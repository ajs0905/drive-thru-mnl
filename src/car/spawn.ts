/**
 * Where the car appears when driving starts: on the drivable road nearest to where the
 * camera looks, in the right-hand lane (the Philippines drives on the right), pointing
 * along the road. Flyovers, underpasses, footpaths and scenery roads are skipped.
 */
import type { MapData, Point, Road } from '../map/types';

export interface Spawn {
  /** Map position (meters, x east, y north). */
  p: Point;
  /** Direction the car faces, map space: radians counter-clockwise from east. */
  heading: number;
}

const drivable = (r: Road) =>
  r.cls !== 'path' && !r.scenery && !r.bridge && !r.tunnel && !(r.z && r.z.some((h) => h > 0.5));

/**
 * The spawn on the road nearest `near`. On two-way roads the car faces the direction
 * closest to `facing` (map heading, usually where the camera looks) and keeps right;
 * one-way roads are driven the way they're drawn. Null if the map has no drivable road.
 */
export function spawnOnRoad(map: Pick<MapData, 'roads'>, near: Point, facing?: number): Spawn | null {
  let best: { d: number; road: Road; a: Point; b: Point; q: Point } | null = null;
  for (const road of map.roads) {
    if (!drivable(road)) continue;
    for (let i = 0; i + 1 < road.points.length; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      if (len2 < 1) continue;
      const t = Math.max(0, Math.min(1, ((near[0] - a[0]) * dx + (near[1] - a[1]) * dy) / len2));
      const q: Point = [a[0] + dx * t, a[1] + dy * t];
      const d = Math.hypot(near[0] - q[0], near[1] - q[1]);
      if (!best || d < best.d) best = { d, road, a, b, q };
    }
  }
  if (!best) return null;
  const { road, a, b, q } = best;
  let heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
  if (!road.oneway && facing !== undefined && Math.cos(heading - facing) < 0) heading += Math.PI;
  // Keep right on two-way roads: a quarter of the width, at most 2 m off the center line.
  const off = road.oneway ? 0 : Math.min(road.w / 4, 2);
  const p: Point = [q[0] + Math.sin(heading) * off, q[1] - Math.cos(heading) * off];
  return { p, heading: Math.atan2(Math.sin(heading), Math.cos(heading)) };
}

/**
 * Rotation around three.js +y that turns the car (which faces +z in its own frame) to
 * a map heading. Map (x, y) is three.js (x, -z), so heading h faces (cos h, 0, -sin h).
 */
export function yawForHeading(heading: number): number {
  return Math.atan2(Math.cos(heading), -Math.sin(heading));
}

/** Map heading of a three.js direction (x, z) on the ground. */
export function headingOfDirection(x: number, z: number): number {
  return Math.atan2(-z, x);
}

/** Where Play starts the car: on the drivable road nearest the middle of BGC's High Street. */
export const START_NEAR = 'High Street';

/**
 * The start spot: the drivable road nearest the middle of the roads named after
 * `START_NEAR` (High Street itself is a pedestrian street), else nearest the middle of
 * the playable area. Null if the map has no drivable road.
 */
export function startSpot(map: Pick<MapData, 'roads' | 'bounds' | 'playable'>, near = START_NEAR): Spawn | null {
  const named = map.roads.filter((r) => r.name?.includes(near)).flatMap((r) => r.points);
  const ring = map.playable ?? [];
  const pts = named.length ? named : ring;
  const center: Point = pts.length
    ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
    : [(map.bounds.minX + map.bounds.maxX) / 2, (map.bounds.minY + map.bounds.maxY) / 2];
  return spawnOnRoad(map, center);
}
