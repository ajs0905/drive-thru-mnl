import { describe, expect, it } from 'vitest';
import type { Point, Road, RoadClass } from '../src/map/types';
import { DECK_HEIGHT, elevateRoads, RAMP, RAMP_OVER } from './elevation';

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
    const approach = road([[-200, 0], [-60, 0], [0, 0]]);
    const side = road([[-60, 0], [-60, 100]], { cls: 'minor' });
    const deck = bridge([[0, 0], [200, 0]]);
    const below = road([[100, -50], [100, 50]]);
    const { roads } = elevateRoads([approach, side, deck, below]);
    expect(zAtX(roads[0], -60)).toBe(0); // junction stays on the ground
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
    // It stays at ground level while it's still inside the cross street (10 m wide, both
    // 10 m wide: they overlap for about 10 m), then climbs over the usual length.
    expect(zAtX(d, 8)).toBe(0);
    expect(zAtX(d, 10 + RAMP.drive.length / 2)).toBeCloseTo(DECK_HEIGHT.drive / 2, 0);
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

  it('never lifts a sidewalk to meet a footbridge; the footbridge slopes down instead', () => {
    const fb = bridge([[0, 0], [60, 0]], {}, 'path');
    const sidewalkW = road([[-100, 0], [0, 0]], {}, 'path');
    const sidewalkE = road([[60, 0], [160, 0]], {}, 'path');
    const avenue = road([[30, -50], [30, 50]]);
    const { roads } = elevateRoads([fb, sidewalkW, sidewalkE, avenue]);
    expect(roads[1].z).toBeUndefined();
    expect(roads[2].z).toBeUndefined();
    expect(zAtX(roads[0], 0)).toBeCloseTo(0, 6);
    expect(zAtX(roads[0], 30)).toBe(DECK_HEIGHT.walk); // full height over the avenue
    expect(zAtX(roads[0], 60)).toBeCloseTo(0, 6);
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

describe('networks keep their own heights', () => {
  it("doesn't lift a road where a footbridge over it shares a node with it", () => {
    // The footbridge crosses the avenue at x=50 and (as often mapped in OSM) shares that node.
    // It also crosses a service road properly (no shared node), which is what gets it raised.
    const avenue = road([[0, 0], [50, 0], [100, 0]]);
    const foot = bridge([[50, -20], [50, 0], [50, 20]], {}, 'path');
    const service = road([[0, 10], [100, 10]], { cls: 'service', highway: 'service' });
    const { roads } = elevateRoads([avenue, foot, service]);
    expect(roads[0].z).toBeUndefined();
    expect(roads[1].z?.every((v) => v === DECK_HEIGHT.walk)).toBe(true);
  });
  it("doesn't lift a path where a flyover shares a node with it", () => {
    const f = flyover();
    const path = road([[140, -30], [140, 0], [140, 30]], {}, 'path');
    const { roads } = elevateRoads([...f.all, path]);
    expect(roads[4].z).toBeUndefined();
    expect(zAtX(roads[1], 140)).toBe(DECK_HEIGHT.drive);
  });
});

describe('ramps stay out of other roads\' lanes', () => {
  /** Heights along a road's centerline every meter, with the distance from the road's start. */
  const profile = (r: Road) => {
    const out: { p: Point; z: number }[] = [];
    const z = r.z ?? r.points.map(() => 0);
    for (let i = 0; i < r.points.length - 1; i++) {
      const [a, b] = [r.points[i], r.points[i + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 0; d < len; d += 1) out.push({ p: [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len], z: z[i] + ((z[i + 1] - z[i]) * d) / len });
    }
    return out;
  };

  it('keeps a ramp at ground level through a gore, where it splits from a frontage road, and climbs after', () => {
    // Approach from the east into a junction at x=0; the ramp goes due west to a deck,
    // a frontage road leaves the same junction 15 degrees to the north.
    const a = (15 * Math.PI) / 180;
    const approach = road([[100, 0], [0, 0]], { oneway: true });
    const ramp = road([[0, 0], [-100, 0]], { oneway: true });
    const frontage = road([[0, 0], [-200 * Math.cos(a), 200 * Math.sin(a)]], { oneway: true });
    const deck = bridge([[-100, 0], [-300, 0]], { oneway: true });
    const below = road([[-200, -50], [-200, 50]]);
    const { roads, stats } = elevateRoads([approach, ramp, frontage, deck, below]);
    const r = roads[1];
    expect(zAtX(r, -100)).toBe(DECK_HEIGHT.drive);
    expect(stats.goresKeptLow).toBeGreaterThanOrEqual(1);
    // Wherever the ramp's ribbon still overlaps the frontage road, it's at ground or clear overhead.
    const f = roads[2].points;
    for (const { p, z } of profile(r)) {
      const across = Math.abs(p[1] * Math.cos(a) + p[0] * Math.sin(a)); // distance from the frontage centerline
      const alongFrontage = -p[0] * Math.cos(a) + p[1] * Math.sin(a);
      // (Ramps are stored as straight pieces between a few sample points, so allow a few centimeters.)
      if (alongFrontage > 0 && alongFrontage < Math.hypot(f[1][0], f[1][1]) && across < 10 - 0.3) expect(z < 0.15 || z >= RAMP_OVER).toBe(true);
    }
    expect(zAtX(r, -5)).toBe(0); // right at the split
  });

  it('never leaves a deck low over a road: when nothing fits, it keeps the plain ramp', () => {
    // A ground road runs right alongside the whole approach, overlapping it: there's no
    // ramp that stays out of its lanes, and the bridge is too short to slope. The plain
    // ramp is kept rather than a deck at car height across the road under the bridge.
    const approach = road([[-100, 0], [0, 0]]);
    const alongside = road([[-100, 6], [60, 6]], { cls: 'major' });
    const deck = bridge([[0, 0], [40, 0]]);
    const cross = road([[20, -50], [20, 50]]);
    const { roads } = elevateRoads([approach, alongside, deck, cross]);
    expect(zAtX(roads[2], 20)).toBe(DECK_HEIGHT.drive); // full height over the cross street
    expect(zAtX(roads[0], -40)).toBeGreaterThan(0); // the approach is the ramp
  });
});
