/**
 * Lat/long <-> local game meters.
 *
 * Equirectangular projection around a fixed origin. At city scale (a few km)
 * the error vs. true great-circle distance is far below a meter, which is
 * plenty for a game, and it's cheap and trivially invertible.
 *
 * Game axes: x = meters east of origin, y = meters north of origin.
 * (The 3D scene maps this to three.js as (x, 0, -y) since -z is "north".)
 */

/** Mean Earth radius in meters (IUGG). */
export const EARTH_RADIUS_M = 6_371_008.8;

const DEG = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** Roughly the middle of BGC (5th Ave / High Street area). */
export const BGC_ORIGIN: LatLon = { lat: 14.5509, lon: 121.0503 };

export interface Projection {
  origin: LatLon;
  toLocal(p: LatLon): Vec2;
  toLatLon(v: Vec2): LatLon;
}

export function createProjection(origin: LatLon = BGC_ORIGIN): Projection {
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) {
    throw new RangeError('Projection origin must be finite');
  }
  if (Math.abs(origin.lat) >= 89) {
    // cos(lat) -> 0 makes x meaningless near the poles. Not a Manila problem,
    // but fail loudly instead of returning garbage.
    throw new RangeError('Equirectangular projection is not usable near the poles');
  }

  const cosLat0 = Math.cos(origin.lat * DEG);
  const metersPerDegLat = EARTH_RADIUS_M * DEG;
  const metersPerDegLon = metersPerDegLat * cosLat0;

  return {
    origin: { ...origin },
    toLocal({ lat, lon }) {
      return {
        x: (lon - origin.lon) * metersPerDegLon,
        y: (lat - origin.lat) * metersPerDegLat,
      };
    },
    toLatLon({ x, y }) {
      return {
        lat: origin.lat + y / metersPerDegLat,
        lon: origin.lon + x / metersPerDegLon,
      };
    },
  };
}

/** Great-circle distance in meters. Used as the reference in tests. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
