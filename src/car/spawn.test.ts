import { describe, expect, it } from 'vitest';
import type { Road } from '../map/types';
import { headingOfDirection, spawnOnRoad, startSpot, yawForHeading } from './spawn';

const road = (id: string, points: [number, number][], extra: Partial<Road> = {}): Road => ({
  id,
  highway: 'residential',
  cls: 'minor',
  w: 8,
  points,
  ...extra,
});

describe('spawnOnRoad', () => {
  it('picks the nearest drivable road and keeps right', () => {
    const map = { roads: [road('far', [[0, 100], [100, 100]]), road('near', [[0, 0], [100, 0]])] };
    const s = spawnOnRoad(map, [40, 5], 0)!;
    expect(s.heading).toBeCloseTo(0); // eastbound
    expect(s.p[0]).toBeCloseTo(40);
    expect(s.p[1]).toBeCloseTo(-2); // right of an eastbound road is south: a quarter of 8 m
  });
  it('faces the way the camera looks on two-way roads', () => {
    const map = { roads: [road('r', [[0, 0], [100, 0]])] };
    const s = spawnOnRoad(map, [40, 0], Math.PI)!; // camera looking west
    expect(Math.abs(s.heading)).toBeCloseTo(Math.PI);
    expect(s.p[1]).toBeCloseTo(2); // westbound keeps right: north
  });
  it('follows one-way roads the way they are drawn, on the center line', () => {
    const map = { roads: [road('r', [[0, 0], [0, 100]], { oneway: true })] };
    const s = spawnOnRoad(map, [3, 50], -Math.PI / 2)!;
    expect(s.heading).toBeCloseTo(Math.PI / 2);
    expect(s.p).toEqual([0, 50]);
  });
  it('skips flyovers, underpasses, footpaths and scenery roads', () => {
    const skipped = [
      road('bridge', [[0, 0], [100, 0]], { bridge: true }),
      road('raised', [[0, 0], [100, 0]], { z: [7, 7] }),
      road('tunnel', [[0, 0], [100, 0]], { tunnel: true }),
      road('path', [[0, 0], [100, 0]], { cls: 'path' }),
      road('scenery', [[0, 0], [100, 0]], { scenery: true }),
    ];
    expect(spawnOnRoad({ roads: skipped }, [50, 0])).toBeNull();
    const s = spawnOnRoad({ roads: [...skipped, road('ok', [[0, 50], [100, 50]])] }, [50, 0])!;
    expect(s.p[1]).toBeGreaterThan(40);
  });
  it('keeps headings within -pi..pi', () => {
    const s = spawnOnRoad({ roads: [road('r', [[0, 0], [100, 0]])] }, [10, 0], Math.PI)!;
    expect(s.heading).toBeLessThanOrEqual(Math.PI);
    expect(s.heading).toBeGreaterThanOrEqual(-Math.PI);
  });
});

describe('yawForHeading', () => {
  it('turns the car (facing +z) to face a map heading', () => {
    // Map east is three.js +x; map north is three.js -z.
    for (const [heading, x, z] of [
      [0, 1, 0],
      [Math.PI / 2, 0, -1],
      [Math.PI, -1, 0],
      [-Math.PI / 2, 0, 1],
    ]) {
      const yaw = yawForHeading(heading);
      expect(Math.sin(yaw)).toBeCloseTo(x); // +z turned by yaw around +y
      expect(Math.cos(yaw)).toBeCloseTo(z);
    }
  });
  it('is the inverse of headingOfDirection', () => {
    for (const h of [0.3, 2, -1.2]) {
      const yaw = yawForHeading(h);
      expect(headingOfDirection(Math.sin(yaw), Math.cos(yaw))).toBeCloseTo(h);
    }
  });
});

describe('startSpot', () => {
  const bounds = { minX: -500, minY: -500, maxX: 500, maxY: 500 };
  it('starts on the road nearest the middle of the named street', () => {
    const roads = [road('high', [[100, 200], [300, 200]], { name: 'Bonifacio High Street' }), road('other', [[-400, 0], [400, 0]])];
    const s = startSpot({ roads, bounds }, 'High Street')!;
    expect(s.p[0]).toBeCloseTo(200);
    expect(Math.abs(s.p[1] - 200)).toBeLessThan(3);
  });
  it('falls back to the middle of the playable area, then of the map', () => {
    const roads = [road('a', [[-400, 0], [400, 0]]), road('b', [[-400, 300], [400, 300]])];
    expect(startSpot({ roads, bounds, playable: [[0, 250], [100, 250], [100, 350], [0, 350]] }, 'Nowhere')!.p[1]).toBeGreaterThan(290);
    expect(Math.abs(startSpot({ roads, bounds }, 'Nowhere')!.p[1])).toBeLessThan(3);
  });
});
