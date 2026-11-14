import { describe, expect, it } from 'vitest';
import type { Building } from '../map/types';
import { distanceToRing, pointInRing } from './polygon';
import { roofProps } from './roofProps';

const square = (s: number): [number, number][] => [[0, 0], [s, 0], [s, s], [0, s]];
const building = (extra: Partial<Building>): Building => ({
  id: 'way/1', type: 'office', h: 40, hSrc: 'estimate', rings: [square(30)], ...extra,
});

describe('roofProps', () => {
  it('puts a housing and AC units on a big roof, fully on the roof and at roof height', () => {
    const b = building({});
    const props = roofProps(b);
    expect(props.some((p) => p.kind === 'housing')).toBe(true);
    expect(props.some((p) => p.kind === 'ac')).toBe(true);
    for (const p of props) {
      expect(pointInRing([p.x, p.y], b.rings[0])).toBe(true);
      expect(distanceToRing([p.x, p.y], b.rings[0])).toBeGreaterThanOrEqual(Math.hypot(p.size[0], p.size[2]) / 2);
      expect(p.base).toBe(40);
    }
  });

  it('keeps props apart', () => {
    const props = roofProps(building({}));
    for (let i = 0; i < props.length; i++) {
      for (let k = i + 1; k < props.length; k++) {
        const gap = Math.hypot(props[i].x - props[k].x, props[i].y - props[k].y);
        expect(gap).toBeGreaterThan(Math.hypot(props[k].size[0], props[k].size[2]) / 2);
      }
    }
  });

  it('is the same on every build', () => {
    expect(roofProps(building({ id: 'way/77' }))).toEqual(roofProps(building({ id: 'way/77' })));
  });

  it('lines props up with the longest wall', () => {
    const rotated = building({ rings: [[[0, 0], [30, 30], [10, 50], [-20, 20]]] });
    for (const p of roofProps(rotated)) expect(p.rot).toBeCloseTo(Math.PI / 4);
  });

  it('skips scenery, canopies, parking structures and roofs too small to fit anything', () => {
    expect(roofProps(building({ scenery: true }))).toEqual([]);
    expect(roofProps(building({ minH: 3.6 }))).toEqual([]);
    expect(roofProps(building({ type: 'parking' }))).toEqual([]);
    expect(roofProps(building({ type: 'house', h: 6, rings: [square(2)] }))).toEqual([]);
  });

  it('never places a prop over a courtyard', () => {
    const hole: [number, number][] = [[5, 5], [25, 5], [25, 25], [5, 25]];
    for (let i = 0; i < 20; i++) {
      for (const p of roofProps(building({ id: `way/${i}`, rings: [square(30), hole] }))) expect(pointInRing([p.x, p.y], hole)).toBe(false);
    }
  });
});
