import { describe, expect, it } from 'vitest';
import bgcRaw from '../../public/data/bgc.json?raw';
import type { Crossing, MapData, ParkedCar, Road } from '../map/types';
import { CURB, curbFinder, curbStart } from './curbSpot';
import { PARKED_MODELS } from './parked';
import { carCorners, footprintsOverlap } from './resetSpot';

const road = (id: string, points: [number, number][], extra: Partial<Road> = {}): Road => ({ id, highway: 'residential', cls: 'minor', w: 10, points, ...extra });

describe('curbFinder', () => {
  it('parks on the right-hand curb, parallel to the road, facing the way that lane goes', () => {
    const f = curbFinder({ roads: [road('r', [[0, 0], [200, 0]])] });
    const east = f.near([100, 3])!;
    expect(east.heading).toBeCloseTo(0);
    expect(east.p[0]).toBeCloseTo(100);
    // Right of an eastbound car is south: half the width less the gap.
    expect(east.p[1]).toBeCloseTo(-(5 - CURB.gap));
    const west = f.near([100, 3], Math.PI)!;
    expect(Math.abs(west.heading)).toBeCloseTo(Math.PI);
    expect(west.p[1]).toBeCloseTo(5 - CURB.gap);
  });

  it('follows one-way roads the way they go, on their right', () => {
    const f = curbFinder({ roads: [road('r', [[0, 200], [0, 0]], { oneway: true })] });
    const s = f.near([0, 100], Math.PI / 2)!;
    expect(s.heading).toBeCloseTo(-Math.PI / 2);
    expect(s.p[0]).toBeCloseTo(-(5 - CURB.gap));
  });

  it('slides along the curb past a parked car and a zebra crossing', () => {
    const parked: ParkedCar[] = [{ p: [100, -3.7], rot: 0, v: 0, c: 0 }];
    const crossing: Crossing = { c: [92, 0], dir: [1, 0], half: 5, w: 4, z: 0, cls: 'minor' };
    const f = curbFinder({ roads: [road('r', [[0, 0], [200, 0]])], parked, crossings: [crossing] });
    const s = f.near([100, 0], 0)!;
    const [l, w] = PARKED_MODELS[0].size;
    const car = carCorners(parked[0].p, 0, 0).map(([x, y]) => [x, y] as [number, number]);
    expect(footprintsOverlap(carCorners(s.p, s.heading, CURB.room), car)).toBe(false);
    expect(Math.abs(s.p[0] - 100)).toBeGreaterThan(l / 2 + w / 2);
    expect(Math.abs(s.p[0] - 92)).toBeGreaterThan(2 + CURB.crossingRoom - 1e-9);
  });

  it('keeps away from junctions, and skips narrow, raised and service roads', () => {
    const f = curbFinder({ roads: [road('r', [[0, 0], [30, 0]], { trim: [6, 6] })] });
    const s = f.near([2, 0], 0)!;
    expect(s.p[0]).toBeGreaterThanOrEqual(6 + CURB.fromJunction - 1e-9);
    expect(s.p[0]).toBeLessThanOrEqual(30 - 6 - CURB.fromJunction + 1e-9);
    const none = curbFinder({
      roads: [road('narrow', [[0, 0], [200, 0]], { w: 5 }), road('deck', [[0, 20], [200, 20]], { z: [7, 7] }), road('svc', [[0, 40], [200, 40]], { cls: 'service' })],
    });
    expect(none.near([100, 0])).toBeNull();
  });

  it('starts the real map at a clear curb near High Street', () => {
    const map = JSON.parse(bgcRaw) as MapData;
    const s = curbStart(map)!;
    expect(s).not.toBeNull();
    // On a road, at its curb: within the road's half width but past half of it.
    const hit = map.roads.filter((r) => r.cls === 'major' || r.cls === 'minor').some((r) =>
      r.points.slice(1).some((b, i) => {
        const a = r.points[i];
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const t = Math.max(0, Math.min(1, ((s.p[0] - a[0]) * dx + (s.p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(s.p[0] - a[0] - dx * t, s.p[1] - a[1] - dy * t);
        return Math.abs(d - (r.w / 2 - CURB.gap)) < 0.05 && Math.abs(Math.cos(Math.atan2(dy, dx) - s.heading)) > 0.99;
      }),
    );
    expect(hit).toBe(true);
    for (const c of map.parked ?? []) {
      if (Math.hypot(c.p[0] - s.p[0], c.p[1] - s.p[1]) > 10) continue;
      const [l, w] = PARKED_MODELS[c.v].size;
      const [cs, sn] = [Math.cos(c.rot), Math.sin(c.rot)];
      const foot: [number, number][] = [
        [c.p[0] + cs * l / 2 - sn * w / 2, c.p[1] + sn * l / 2 + cs * w / 2],
        [c.p[0] - cs * l / 2 - sn * w / 2, c.p[1] - sn * l / 2 + cs * w / 2],
        [c.p[0] - cs * l / 2 + sn * w / 2, c.p[1] - sn * l / 2 - cs * w / 2],
        [c.p[0] + cs * l / 2 + sn * w / 2, c.p[1] + sn * l / 2 - cs * w / 2],
      ];
      expect(footprintsOverlap(carCorners(s.p, s.heading), foot)).toBe(false);
    }
  });
});
