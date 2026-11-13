import { describe, expect, it } from 'vitest';
import type { Point, Road, RoadClass } from '../src/map/types';
import { DECK_HEIGHT, elevateRoads, RAMP } from './elevation';

let n = 0;
const road = (points: Point[], extra: Partial<Road> = {}, cls: RoadClass = 'major'): Road => ({
  id: `r${n++}`,
  highway: cls === 'path' ? 'footway' : 'primary',
  cls,
  w: cls === 'path' ? 2 : 10,
  points,
  ...extra,
});
const bridge = (points: Point[], extra: Partial<Road> = {}, cls: RoadClass = 'major') =>
  road(points, { bridge: true, layer: 1, ...extra }, cls);

/** Height of a road at a given x, by linear interpolation along its points (roads run along x in these tests). */
const zAtX = (r: Road, x: number) => {
  const z = r.z ?? r.points.map(() => 0);
  for (let i = 0; i < r.points.length - 1; i++) {
    const [a, b] = [r.points[i][0], r.points[i + 1][0]];
    if ((x - a) * (x - b) <= 0) return a === b ? z[i] : z[i] + ((z[i + 1] - z[i]) * (x - a)) / (b - a);
  }
  return NaN;
};

// A flyover from x=0 to x=300 that crosses a north-south street at x=150,
// with plain approach roads 200 m long on both sides.
function flyover() {
  const west = road([[-200, 0], [0, 0]]);
  const deck = bridge([[0, 0], [140, 0], [300, 0]]);
  const east = road([[300, 0], [500, 0]]);
  const below = road([[150, -100], [150, 100]], { cls: 'minor', highway: 'residential' });
  return { west, deck, east, below, all: [west, deck, east, below] };
}

describe('elevateRoads', () => {
  it('raises a bridge that crosses a road to deck height', () => {
    const f = flyover();
    const { roads } = elevateRoads(f.all);
    const deck = roads[1];
    expect(zAtX(deck, 150)).toBe(DECK_HEIGHT.drive);
    expect(deck.z?.every((v) => v === DECK_HEIGHT.drive)).toBe(true);
  });

  it('leaves the road underneath at ground level', () => {
    const { roads } = elevateRoads(flyover().all);
    expect(roads[3].z).toBeUndefined();
  });

  it('turns the approach roads into ramps that reach the ground within the ramp length', () => {
    const { roads, stats } = elevateRoads(flyover().all);
    const [west, , east] = roads;
    const R = RAMP.drive.length;
    expect(zAtX(west, 0)).toBe(DECK_HEIGHT.drive);
    expect(zAtX(west, -R / 2)).toBeCloseTo(DECK_HEIGHT.drive / 2, 1);
    expect(zAtX(west, -R)).toBe(0);
    expect(zAtX(west, -200)).toBe(0);
    expect(zAtX(east, 300 + R / 2)).toBeCloseTo(DECK_HEIGHT.drive / 2, 1);
    expect(stats.rampsOnGround).toBe(2);
  });

  it('inserts extra points along ramps so the slope is a curve, not one straight line', () => {
    const { roads } = elevateRoads(flyover().all);
    expect(roads[0].points.length).toBeGreaterThan(4);
    // Heights only go down as we move away from the bridge.
    const z = roads[0].z!;
    for (let i = 1; i < z.length; i++) expect(z[i]).toBeGreaterThanOrEqual(z[i - 1]);
  });

  it('keeps a small bridge over a creek (crossing no road) at ground level', () => {
    const creek = bridge([[0, 0], [20, 0]]);
    const { roads, stats } = elevateRoads([road([[-100, 0], [0, 0]]), creek, road([[20, 0], [100, 0]])]);
    expect(roads.every((r) => r.z === undefined)).toBe(true);
    expect(stats.bridgesLeftAtGround).toBe(1);
  });

  it('raises the whole chain when only one piece crosses a road', () => {
    const a = bridge([[0, 0], [100, 0]]);
    const b = bridge([[100, 0], [200, 0]]);
    const below = road([[150, -50], [150, 50]]);
    const { roads } = elevateRoads([road([[-200, 0], [0, 0]]), a, b, below]);
    expect(roads[1].z?.every((v) => v === DECK_HEIGHT.drive)).toBe(true);
    expect(roads[2].z?.every((v) => v === DECK_HEIGHT.drive)).toBe(true);
  });

  it('stops a ramp at the first junction so side streets are not lifted', () => {
    const approach = road([[-200, 0], [-40, 0], [0, 0]]);
    const side = road([[-40, 0], [-40, 100]], { cls: 'minor' });
    const deck = bridge([[0, 0], [200, 0]]);
    const below = road([[100, -50], [100, 50]]);
    const { roads } = elevateRoads([approach, side, deck, below]);
    expect(zAtX(roads[0], -40)).toBe(0); // junction stays on the ground
    expect(zAtX(roads[0], -20)).toBeGreaterThan(0);
    expect(roads[1].z).toBeUndefined();
  });

  it('slopes the bridge itself when a junction sits right at its foot', () => {
    const cross = road([[0, -50], [0, 0], [0, 50]], { cls: 'minor' }); // junction at the bridge end
    const approach = road([[-100, 0], [0, 0]]);
    const deck = bridge([[0, 0], [100, 0], [200, 0], [300, 0]]);
    const below = road([[150, -50], [150, 50]]);
    const { roads, stats } = elevateRoads([cross, approach, deck, below]);
    const d = roads[2];
    expect(zAtX(d, 0)).toBe(0);
    expect(zAtX(d, RAMP.drive.length / 2)).toBeCloseTo(DECK_HEIGHT.drive / 2, 1);
    expect(zAtX(d, 150)).toBe(DECK_HEIGHT.drive);
    expect(roads[1].z).toBeUndefined(); // approach stays flat
    expect(stats.rampsOnBridge).toBeGreaterThanOrEqual(1);
  });

  it('continues a ramp through plain joins into the next way', () => {
    const far = road([[-200, 0], [-30, 0]]);
    const near = road([[-30, 0], [0, 0]]);
    const deck = bridge([[0, 0], [200, 0]]);
    const below = road([[100, -50], [100, 50]]);
    const { roads } = elevateRoads([far, near, deck, below]);
    expect(zAtX(roads[0], -45)).toBeGreaterThan(0);
    expect(zAtX(roads[0], -45)).toBeLessThan(DECK_HEIGHT.drive);
  });

  it('uses layer for deck height', () => {
    const deck = bridge([[0, 0], [200, 0]], { layer: 2 });
    const { roads } = elevateRoads([deck, road([[100, -50], [100, 50]])]);
    expect(roads[0].z?.[0]).toBe(2 * DECK_HEIGHT.drive);
  });

  it('raises footbridges with short stair ramps', () => {
    const fb = bridge([[0, 0], [30, 0]], {}, 'path');
    const stairsW = road([[-12, 0], [0, 0]], { highway: 'steps' }, 'path');
    const stairsE = road([[30, 0], [42, 0]], { highway: 'steps' }, 'path');
    const avenue = road([[15, -50], [15, 50]]);
    const { roads } = elevateRoads([fb, stairsW, stairsE, avenue]);
    expect(roads[0].z?.every((v) => v === DECK_HEIGHT.walk)).toBe(true);
    expect(zAtX(roads[1], -12)).toBe(0);
    expect(zAtX(roads[1], 0)).toBe(DECK_HEIGHT.walk);
    expect(roads[3].z).toBeUndefined();
  });

  it('never raises tunnels', () => {
    const t = road([[0, 0], [100, 0]], { tunnel: true, layer: 1 });
    const { roads } = elevateRoads([t, road([[50, -50], [50, 50]])]);
    expect(roads[0].z).toBeUndefined();
  });

  it('leaves a map with no bridges untouched', () => {
    const input = [road([[0, 0], [100, 0]]), road([[100, 0], [100, 100]])];
    const { roads } = elevateRoads(input);
    expect(roads.map((r) => r.points)).toEqual(input.map((r) => r.points));
    expect(roads.every((r) => r.z === undefined)).toBe(true);
  });

  it('keeps z the same length as points', () => {
    const { roads } = elevateRoads(flyover().all);
    for (const r of roads) if (r.z) expect(r.z).toHaveLength(r.points.length);
  });
});
