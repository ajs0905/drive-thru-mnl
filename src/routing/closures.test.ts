import { describe, expect, it } from 'vitest';
import type { Fixture, Road } from '../map/types';
import { CAR_GAP, closedRoads } from './closures';

const road = (w: number): Road => ({ id: 'r', highway: 'service', cls: 'service', w, points: [[0, 0], [50, 0]] });
const bollard = (x: number, y: number): Fixture => ({ kind: 'bollard', p: [x, y], rot: 0 });

describe('closedRoads', () => {
  it('closes a road with a row of bollards across it, and not one a car can get past', () => {
    // 6 m road, bollards every 1.5 m across it at x = 20: no gap a car fits.
    const row = [-2.25, -0.75, 0.75, 2.25].map((y) => bollard(20, y));
    expect(closedRoads([road(6)], row).has(0)).toBe(true);
    // One bollard in the middle of the same road: about 2.9 m either side.
    expect(closedRoads([road(6)], [bollard(20, 0)]).has(0)).toBe(false);
    // A block along the middle of a 4.2 m lane leaves under 2 m each side.
    expect(closedRoads([road(4.2)], [{ kind: 'block', p: [20, 0], rot: 0 }]).has(0)).toBe(true);
    // Bollards spread along the road (not one row) each leave room.
    expect(closedRoads([road(6)], [bollard(10, -1.5), bollard(20, 0), bollard(30, 1.5)]).has(0)).toBe(false);
    expect(CAR_GAP).toBeGreaterThan(1.9);
  });
});
