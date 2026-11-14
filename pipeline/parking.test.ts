import { describe, expect, it } from 'vitest';
import { PARKED_MODELS } from '../src/car/parked';
import type { MapData, Point, Road } from '../src/map/types';
import { carFootprint, PARKING, placeParkedCars } from './parking';

const map = (roads: Road[], extra: Partial<MapData> = {}): MapData => ({
  version: 7,
  origin: { lat: 14.55, lon: 121.05 },
  bounds: { minX: -500, minY: -500, maxX: 500, maxY: 500 },
  roads,
  junctions: [],
  crossings: [],
  buildings: [],
  areas: [],
  stats: { features: 0, roads: 0, buildings: 0, areas: 0, skipped: {} },
  ...extra,
});
let n = 0;
const street = (extra: Partial<Road> = {}): Road => ({ id: `s${n++}`, highway: 'residential', cls: 'minor', w: 7, oneway: true, points: [[0, 0], [200, 0]], ...extra });
/** Which side of a west-east street each car is on: +1 north (left), -1 south (right). */
const sides = (cars: { p: Point }[]) => new Set(cars.map((c) => Math.sign(c.p[1])));

describe('placeParkedCars', () => {
  it('parks along the right curb of a one-way street with room for one side, facing the traffic', () => {
    const { parked } = placeParkedCars(map([street()]));
    expect(parked.length).toBeGreaterThan(8);
    expect(sides(parked)).toEqual(new Set([-1]));
    for (const c of parked) {
      expect(c.p[1]).toBeCloseTo(-(7 / 2 - PARKING.curbGap - PARKING.carWidth / 2), 1);
      expect(c.rot).toBeCloseTo(0);
    }
  });

  it('parks on both sides of a wide two-way street, each side facing its own traffic', () => {
    const { parked } = placeParkedCars(map([street({ oneway: undefined, w: 13.8 })]));
    expect(sides(parked)).toEqual(new Set([-1, 1]));
    for (const c of parked) expect(Math.cos(c.rot)).toBeCloseTo(c.p[1] < 0 ? 1 : -1);
  });

  it("leaves narrow streets, major roads, flyovers and scenery empty (they'd be blocked or aren't parked on)", () => {
    expect(placeParkedCars(map([street({ w: 3.6 })])).parked).toHaveLength(0);
    expect(placeParkedCars(map([street({ oneway: undefined, w: 7 })])).parked).toHaveLength(0);
    expect(placeParkedCars(map([street({ cls: 'major', highway: 'secondary', w: 10.2 })])).parked).toHaveLength(0);
    expect(placeParkedCars(map([street({ z: [7, 7] })])).parked).toHaveLength(0);
    expect(placeParkedCars(map([street({ scenery: true })])).parked).toHaveLength(0);
  });

  it('respects "no parking" tags', () => {
    expect(placeParkedCars(map([street({ noParking: 'both' })])).parked).toHaveLength(0);
    const wide = placeParkedCars(map([street({ oneway: undefined, w: 13.8, noParking: 'right' })])).parked;
    expect(sides(wide)).toEqual(new Set([1]));
  });

  it('keeps clear of crossings, driveways (gates), tree trunks and junctions', () => {
    const plain = placeParkedCars(map([street({ id: 'same' })])).parked;
    const busy = placeParkedCars(
      map([street({ id: 'same', trim: [20, -1] })], {
        crossings: [{ c: [100, 0], dir: [1, 0], half: 3.5, w: 3, z: 0, cls: 'minor' }],
        fixtures: [{ kind: 'gate', p: [150, -3.5], rot: 0 }],
        trees: [{ p: [60, -3], shape: 'broad', s: 1 }],
      }),
    ).parked;
    expect(busy.length).toBeLessThan(plain.length);
    for (const c of busy) {
      expect(Math.abs(c.p[0] - 100)).toBeGreaterThan(PARKING.fromCrossing);
      expect(Math.abs(c.p[0] - 150)).toBeGreaterThan(PARKING.fromFixture);
      expect(c.p[0]).toBeGreaterThan(20 + PARKING.fromJunction);
    }
  });

  it('never parks across a wall, in a building or outside the playable area', () => {
    const wall = placeParkedCars(map([street()], { barriers: [{ id: 'w', kind: 'wall', h: 2, points: [[0, -2.5], [200, -2.5]] }] })).parked;
    expect(wall).toHaveLength(0);
    const playable: Point[] = [[0, -50], [100, -50], [100, 50], [0, 50]];
    for (const c of placeParkedCars(map([street()], { playable })).parked) expect(c.p[0] + PARKED_MODELS[c.v].size[0] / 2).toBeLessThan(100);
  });

  it('is the same every time (seeded by the road id), with a mix of models and paints', () => {
    const a = placeParkedCars(map([street({ id: 'x', w: 13.8, oneway: undefined, points: [[0, 0], [600, 0]] })])).parked;
    const b = placeParkedCars(map([street({ id: 'x', w: 13.8, oneway: undefined, points: [[0, 0], [600, 0]] })])).parked;
    expect(a).toEqual(b);
    expect(new Set(a.map((c) => c.v)).size).toBeGreaterThan(2);
    expect(new Set(a.map((c) => c.c)).size).toBeGreaterThan(2);
  });

  it('builds footprints as rectangles of the given size, turned', () => {
    const f = carFootprint([0, 0], Math.PI / 2, 4, 2);
    const xs = f.map((p) => p[0]);
    const ys = f.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4);
  });
});
