import { describe, expect, it } from 'vitest';
import { SIGN_SPEEDS } from '../src/geometry/dressing';
import type { Dressing, Junction, MapData, Point, Road } from '../src/map/types';
import { placeSigns, SIGNS, speedIndex } from './signs';

const map = (roads: Road[], junctions: Junction[], extra: Partial<MapData> = {}): MapData => ({
  version: 7,
  origin: { lat: 14.55, lon: 121.05 },
  bounds: { minX: -500, minY: -500, maxX: 500, maxY: 500 },
  roads,
  junctions,
  crossings: [],
  buildings: [],
  areas: [],
  stats: { features: 0, roads: 0, buildings: 0, areas: 0, skipped: {} },
  ...extra,
});
const avenue = (id: string, points: Point[], extra: Partial<Road> = {}): Road => ({ id, highway: 'primary', cls: 'major', w: 12, points, ...extra });
const street = (id: string, points: Point[], extra: Partial<Road> = {}): Road => ({ id, highway: 'residential', cls: 'minor', w: 7, points, ...extra });
const square = (c: Point, h: number): Point[] => [[c[0] - h, c[1] - h], [c[0] + h, c[1] - h], [c[0] + h, c[1] + h], [c[0] - h, c[1] + h]];
/** The way a sign faces (the model's -z): (-sin rot, cos rot). */
const faces = (d: Dressing): Point => [-Math.sin(d.rot), Math.cos(d.rot)];

/** An avenue along x through the origin, a street coming down to it from the north (a T). */
function tee(streetExtra: Partial<Road> = {}): { roads: Road[]; junctions: Junction[] } {
  return {
    roads: [
      avenue('west', [[-300, 0], [0, 0]], { trim: [-1, 6] }),
      avenue('east', [[0, 0], [300, 0]], { trim: [6, -1] }),
      street('north', [[0, 200], [0, 0]], { trim: [-1, 7], ...streetExtra }),
    ],
    junctions: [{ id: 'j', ring: square([0, 0], 7), z: 0, cls: 'major' }],
  };
}

describe('placeSigns', () => {
  it('puts a stop sign on a street meeting an avenue, on its right-hand curb before the junction, facing the driver', () => {
    const { roads, junctions } = tee();
    const stops = placeSigns(map(roads, junctions)).dressing.filter((d) => d.k === 'signstop');
    expect(stops).toHaveLength(1);
    const [s] = stops;
    // Southbound traffic: its right is the west curb (x < 0), north of the junction, the face looking back north at it.
    expect(s.p[0]).toBeCloseTo(-(3.5 + SIGNS.curb), 1);
    expect(s.p[1]).toBeGreaterThan(7);
    expect(faces(s)[1]).toBeGreaterThan(0.99);
  });

  it('leaves a signalized junction to its lights', () => {
    const { roads, junctions } = tee();
    const dressing: Dressing[] = [{ k: 'signal', p: [-20, 8], rot: 0 }];
    expect(placeSigns(map(roads, junctions, { dressing })).dressing.filter((d) => d.k === 'signstop')).toHaveLength(0);
  });

  it('shows the avenue traffic which way a one-way street leaving it goes', () => {
    // The street one-way north, away from the avenue.
    const { roads, junctions } = tee({ oneway: true });
    roads[2] = { ...roads[2], points: [[0, 0], [0, 200]], trim: [7, -1] };
    const signs = placeSigns(map(roads, junctions)).dressing;
    expect(signs.filter((d) => d.k === 'signstop')).toHaveLength(0);
    const oneway = signs.filter((d) => d.k === 'signoneway');
    // One for each side the avenue's traffic comes from, on that side's curb, facing it.
    expect(oneway).toHaveLength(2);
    const fromWest = oneway.find((d) => d.p[0] < 0)!;
    const fromEast = oneway.find((d) => d.p[0] > 0)!;
    expect(faces(fromWest)[0]).toBeLessThan(-0.99);
    expect(faces(fromEast)[0]).toBeGreaterThan(0.99);
    // Eastbound drivers see the street go off to their left, westbound to their right.
    expect(fromWest.c).toBe(1);
    expect(fromEast.c).toBe(0);
  });

  it('puts speed limits on the avenues past the junction, facing the traffic, with the tagged limit', () => {
    const { roads, junctions } = tee();
    roads[1] = { ...roads[1], maxspeed: 50 };
    const speed = placeSigns(map(roads, junctions)).dressing.filter((d) => d.k === 'signspeed');
    expect(speed).toHaveLength(2);
    const east = speed.find((d) => d.p[0] > 0)!;
    // Eastbound: on the right (south) curb, facing back west, showing 50.
    expect(east.p[1]).toBeCloseTo(-(6 + SIGNS.curb), 1);
    expect(faces(east)[0]).toBeLessThan(-0.99);
    expect(SIGN_SPEEDS[east.c!]).toBe(50);
    const west = speed.find((d) => d.p[0] < 0)!;
    expect(SIGN_SPEEDS[west.c!]).toBe(60);
  });

  it('rounds a limit down to a sign there is', () => {
    expect(SIGN_SPEEDS[speedIndex({ highway: 'secondary', maxspeed: 45 })]).toBe(40);
    expect(SIGN_SPEEDS[speedIndex({ highway: 'secondary' })]).toBe(40);
    expect(SIGN_SPEEDS[speedIndex({ highway: 'trunk' })]).toBe(60);
  });
});
