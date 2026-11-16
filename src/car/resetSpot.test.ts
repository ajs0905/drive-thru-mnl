import { describe, expect, it } from 'vitest';
import { distanceToSegment, segmentDistanceToRing } from '../geometry/polygon';
import type { Building, MapData, Point, Road } from '../map/types';
import { carCorners, RESET_SPOT, resetSpotFinder } from './resetSpot';

const road = (id: string, points: Point[], extra: Partial<Road> = {}): Road => ({ id, highway: 'residential', cls: 'minor', w: 8, points, ...extra });
const box = (x0: number, y0: number, x1: number, y1: number): Building => ({ id: `b${x0},${y0}`, type: 'yes', h: 10, hSrc: 'estimate', rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]] });
const map = (roads: Road[], buildings: Building[] = [], extra: Partial<MapData> = {}) => ({ roads, buildings, ...extra });

describe('resetSpotFinder', () => {
  it('moves a car stuck in a narrow alley to the nearest wide road, along it, keeping right', () => {
    const find = resetSpotFinder(map([road('alley', [[0, 0], [0, 40]], { w: 3.5 }), road('street', [[-100, 50], [100, 50]])]));
    const s = find([0, 20], Math.PI / 2)!;
    expect(s).not.toBeNull();
    expect(Math.abs(s.p[1] - 50)).toBeLessThanOrEqual(2 + 1e-9);
    expect(Math.abs(Math.sin(s.heading))).toBeLessThan(1e-9);
    // Right of the way it faces: facing east keeps to the south side, facing west the north.
    expect(s.p[1] - 50).toBeCloseTo(Math.cos(s.heading) > 0 ? -2 : 2);
  });

  it('faces the way of the road closest to where the car was heading, and one-way roads their way', () => {
    const find = resetSpotFinder(map([road('two', [[0, 0], [200, 0]])]));
    expect(Math.cos(find([100, 0], Math.PI - 0.2)!.heading)).toBeLessThan(0);
    const oneway = resetSpotFinder(map([road('one', [[0, 0], [200, 0]], { oneway: true })]));
    expect(Math.cos(oneway([100, 0], Math.PI)!.heading)).toBeGreaterThan(0);
  });

  it('keeps clear of buildings, walls, pillars and the edge, and off parked cars', () => {
    const roads = [road('street', [[0, 0], [300, 0]], { oneway: true })];
    const buildings = [box(90, 3, 150, 20)];
    const find = resetSpotFinder(
      map(roads, buildings, {
        barriers: [{ id: 'w', kind: 'wall', h: 2, points: [[160, -3], [200, -3]] }],
        pillars: [{ p: [220, 0], top: 6, size: 1.8, rot: 0 }],
        parked: [{ p: [240, 0], rot: 0, v: 0, c: 0 }],
      }),
    );
    for (const x of [100, 120, 140, 180, 220, 240]) {
      const s = find([x, 0], 0)!;
      const foot = carCorners(s.p, s.heading);
      const b = buildings[0].rings[0];
      for (let i = 0; i < 4; i++) expect(segmentDistanceToRing(b[i], b[(i + 1) % 4], foot)).toBeGreaterThanOrEqual(RESET_SPOT.clearance);
      expect(segmentDistanceToRing([160, -3], [200, -3], foot)).toBeGreaterThanOrEqual(RESET_SPOT.clearance);
      expect(Math.abs(s.p[0] - 220)).toBeGreaterThan(RESET_SPOT.clearance);
      expect(Math.abs(s.p[0] - 240)).toBeGreaterThan(RESET_SPOT.size[0]);
    }
  });

  it('keeps off loose roadblock pieces it is told about', () => {
    const roads = [road('street', [[0, 0], [300, 0]], { oneway: true })];
    const cones: Point[] = [[100, 0], [104, 0], [108, 0]];
    const s = resetSpotFinder(map(roads), cones)([104, 0], 0)!;
    for (const c of cones) expect(Math.abs(s.p[0] - c[0])).toBeGreaterThan(RESET_SPOT.size[0] / 2 + RESET_SPOT.looseRoom - 1e-9);
  });

  it("stays on the level it's on: under a flyover it picks the street, on the deck the deck", () => {
    const deck = road('deck', [[0, 0], [300, 0]], { cls: 'major', w: 9, z: [8, 8] });
    const street = road('street', [[0, 12], [300, 12]], { w: 8 });
    const find = resetSpotFinder(map([deck, street]));
    expect(find([150, 3], 0, 0)!.z).toBe(0);
    expect(find([150, 3], 0, 8)!.z).toBe(8);
  });

  it('skips paths, scenery, tunnels and roads narrower than 6 m, and gives up past its reach', () => {
    const roads = [road('p', [[0, 0], [100, 0]], { cls: 'path' }), road('s', [[0, 10], [100, 10]], { scenery: true }), road('n', [[0, 20], [100, 20]], { w: 5 })];
    expect(resetSpotFinder(map(roads))([50, 5], 0)).toBeNull();
    expect(resetSpotFinder(map([road('far', [[1000, 0], [1100, 0]])]))([0, 0], 0)).toBeNull();
  });

  it('finds an open road near almost any street spot on the real map', async () => {
    const real = JSON.parse((await import('../../public/data/bgc.json?raw')).default) as MapData;
    const find = resetSpotFinder(real);
    const streets = real.roads.filter((r) => r.cls !== 'path' && !r.scenery && !r.z);
    let found = 0;
    let n = 0;
    for (let i = 0; i < streets.length; i += 25) {
      const r = streets[i];
      const s = find(r.points[0], 0);
      n++;
      if (!s) continue;
      found++;
      expect(Math.min(...real.roads.filter((q) => q.w >= RESET_SPOT.minRoadWidth).flatMap((q) => q.points.slice(1).map((b, k) => distanceToSegment(s.p, q.points[k], b))))).toBeLessThan(3);
    }
    expect(found / n).toBeGreaterThan(0.95);
  }, 60000);
});
