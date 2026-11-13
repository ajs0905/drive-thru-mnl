import { describe, expect, it } from 'vitest';
import {
  BGC_ORIGIN,
  createProjection,
  distance,
  EARTH_RADIUS_M,
  haversineMeters,
  type LatLon,
} from './projection';

const proj = createProjection(BGC_ORIGIN);

// Deterministic PRNG so failures are reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random point inside the BGC export box (about 3 x 3 km). */
function randomBgcPoint(rand: () => number): LatLon {
  return {
    lat: 14.537 + rand() * (14.565 - 14.537),
    lon: 121.037 + rand() * (121.064 - 121.037),
  };
}

describe('createProjection', () => {
  it('maps the origin to (0, 0)', () => {
    const v = proj.toLocal(BGC_ORIGIN);
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.y).toBeCloseTo(0, 9);
  });

  it('north is +y and east is +x', () => {
    const north = proj.toLocal({ lat: BGC_ORIGIN.lat + 0.001, lon: BGC_ORIGIN.lon });
    const east = proj.toLocal({ lat: BGC_ORIGIN.lat, lon: BGC_ORIGIN.lon + 0.001 });
    expect(north.y).toBeGreaterThan(0);
    expect(north.x).toBeCloseTo(0, 9);
    expect(east.x).toBeGreaterThan(0);
    expect(east.y).toBeCloseTo(0, 9);
  });

  it('0.01 deg of latitude is about 1111.95 m', () => {
    const v = proj.toLocal({ lat: BGC_ORIGIN.lat + 0.01, lon: BGC_ORIGIN.lon });
    expect(v.y).toBeCloseTo(1111.95, 1);
  });

  it('0.01 deg of longitude shrinks by cos(latitude) (~1076.3 m at BGC)', () => {
    const v = proj.toLocal({ lat: BGC_ORIGIN.lat, lon: BGC_ORIGIN.lon + 0.01 });
    const expected = EARTH_RADIUS_M * (Math.PI / 180) * 0.01 * Math.cos((BGC_ORIGIN.lat * Math.PI) / 180);
    expect(v.x).toBeCloseTo(expected, 6);
    expect(v.x).toBeCloseTo(1076.3, 0);
  });

  it('round-trips lat/lon -> local -> lat/lon', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const p = randomBgcPoint(rand);
      const back = proj.toLatLon(proj.toLocal(p));
      expect(back.lat).toBeCloseTo(p.lat, 10);
      expect(back.lon).toBeCloseTo(p.lon, 10);
    }
  });

  it('round-trips local -> lat/lon -> local', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = { x: (rand() - 0.5) * 4000, y: (rand() - 0.5) * 4000 };
      const back = proj.toLocal(proj.toLatLon(v));
      expect(back.x).toBeCloseTo(v.x, 6);
      expect(back.y).toBeCloseTo(v.y, 6);
    }
  });

  it('local distances match great-circle distances within 0.05% across BGC', () => {
    const rand = mulberry32(1234);
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const a = randomBgcPoint(rand);
      const b = randomBgcPoint(rand);
      const truth = haversineMeters(a, b);
      if (truth < 10) continue; // relative error is meaningless at tiny distances
      const approx = distance(proj.toLocal(a), proj.toLocal(b));
      worst = Math.max(worst, Math.abs(approx - truth) / truth);
    }
    expect(worst).toBeLessThan(0.0005);
  });

  it('absolute error stays under 1 m for points inside the BGC box', () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 2000; i++) {
      const a = randomBgcPoint(rand);
      const b = randomBgcPoint(rand);
      const err = Math.abs(distance(proj.toLocal(a), proj.toLocal(b)) - haversineMeters(a, b));
      expect(err).toBeLessThan(1);
    }
  });

  it('rejects non-finite and polar origins', () => {
    expect(() => createProjection({ lat: NaN, lon: 121 })).toThrow(RangeError);
    expect(() => createProjection({ lat: 14.5, lon: Infinity })).toThrow(RangeError);
    expect(() => createProjection({ lat: 89.5, lon: 0 })).toThrow(RangeError);
  });
});

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(BGC_ORIGIN, BGC_ORIGIN)).toBe(0);
  });

  it('is symmetric', () => {
    const a = { lat: 14.55, lon: 121.04 };
    const b = { lat: 14.56, lon: 121.06 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 9);
  });

  it('one degree of longitude on the equator is about 111.195 km', () => {
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111_195, -1);
  });
});
