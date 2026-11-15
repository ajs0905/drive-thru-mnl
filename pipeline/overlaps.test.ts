import { describe, expect, it } from 'vitest';
import type { Building, Ring } from '../src/map/types';
import { dropNestedBuildings, insideShare, nestedBuildings } from './overlaps';

const square = (x: number, y: number, s: number): Ring => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
let n = 0;
const building = (ring: Ring, h: number, extra: Partial<Building> = {}): Building => ({ id: `b${n++}`, type: 'yes', h, hSrc: 'estimate', rings: [ring], ...extra });

describe('insideShare', () => {
  it('measures how much of one footprint lies inside another', () => {
    expect(insideShare([square(10, 10, 10)], [square(0, 0, 40)])).toBe(1);
    expect(insideShare([square(0, 0, 10)], [square(5, 0, 40)])).toBeCloseTo(0.5, 1);
    expect(insideShare([square(0, 0, 10)], [square(50, 50, 10)])).toBe(0);
  });

  it("doesn't count a courtyard (hole) as inside", () => {
    const withCourt: Ring[] = [square(0, 0, 40), square(10, 10, 20)];
    expect(insideShare([square(12, 12, 10)], withCourt)).toBe(0);
  });
});

describe('dropNestedBuildings', () => {
  it('drops a building hidden inside a taller one, and duplicates', () => {
    const outer = building(square(0, 0, 40), 30);
    const hidden = building(square(10, 10, 10), 12);
    const twin = building(square(100, 0, 20), 9);
    const twinTall = building(square(100, 0, 20), 15);
    const out = dropNestedBuildings([outer, hidden, twin, twinTall]);
    expect(out.buildings.map((b) => b.id)).toEqual([outer.id, twinTall.id]);
    expect(out.hidden).toBe(2);
  });

  it('drops a construction site outline around the finished, taller building', () => {
    const site = building(square(0, 0, 40), 25, { type: 'construction' });
    const tower = building(square(5, 5, 30), 37, { type: 'office' });
    const out = dropNestedBuildings([site, tower]);
    expect(out.buildings).toEqual([tower]);
    expect(out.outlines).toBe(1);
  });

  it('keeps towers on podiums, spires, shops under raised buildings and buildings that only touch', () => {
    const podium = building(square(0, 0, 60), 15);
    const tower = building(square(10, 10, 30), 130);
    const raised = building(square(100, 0, 40), 26, { minH: 5.2 });
    const shop = building(square(110, 10, 4), 3.2);
    const left = building(square(200, 0, 20), 10);
    const right = building(square(215, 0, 20), 10);
    const all = [podium, tower, raised, shop, left, right];
    expect(dropNestedBuildings(all).buildings).toEqual(all);
    expect(nestedBuildings(all).filter((x) => x.drop)).toHaveLength(0);
  });
});
