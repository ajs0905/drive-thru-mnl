import { describe, expect, it } from 'vitest';
import type { Building, Point, Ring } from '../map/types';
import { addFormedBuilding, buildingForm, HIP, minAreaRect, PODIUM } from './buildingForm';
import { MeshBuilder } from './meshBuilder';
import { pointInRing, ringArea } from './polygon';

const rect = (x0: number, y0: number, w: number, h: number): Ring => [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
const bld = (id: string, type: string, h: number, ring: Ring, extra: Partial<Building> = {}): Building => ({ id, type, h, hSrc: 'estimate', rings: [ring], ...extra });

describe('minAreaRect', () => {
  it('finds the turned rectangle around a turned rectangle', () => {
    const c = Math.cos(0.4);
    const s = Math.sin(0.4);
    const turned = rect(0, 0, 10, 4).map(([x, y]): Point => [x * c - y * s, x * s + y * c]);
    const r = minAreaRect(turned)!;
    expect(r.area).toBeCloseTo(40);
    expect([...r.sides].sort((a, b) => a - b)).toEqual([expect.closeTo(4), expect.closeTo(10)]);
  });
});

describe('buildingForm', () => {
  it('gives low rectangular houses a hip roof over their rectangle', () => {
    const f = buildingForm(bld('h1', 'house', 6, rect(0, 0, 10, 7)));
    expect(f.hip).toBeDefined();
    expect(f.hip!.rise).toBeCloseTo(Math.min(HIP.maxRise, 7 * HIP.pitch));
    expect(HIP.colors).toContain(f.hip!.color);
    expect(f.shops).toBe(false);
  });

  it('leaves odd shapes, tall houses and courtyards flat', () => {
    const ell: Ring = [[0, 0], [12, 0], [12, 4], [4, 4], [4, 12], [0, 12]];
    expect(buildingForm(bld('l', 'house', 6, ell)).hip).toBeUndefined();
    expect(buildingForm(bld('t', 'house', 15, rect(0, 0, 10, 7))).hip).toBeUndefined();
    expect(buildingForm(bld('c', 'house', 6, rect(0, 0, 10, 7), { rings: [rect(0, 0, 10, 7), rect(3, 3, 2, 2)] })).hip).toBeUndefined();
  });

  it('stands big towers on a podium, the tower stepped back inside it all round', () => {
    const ring = rect(0, 0, 50, 40);
    const f = buildingForm(bld('t', 'office', 120, ring));
    expect(f.podium).toBeDefined();
    expect(f.shops).toBe(true);
    const { tower, height } = f.podium!;
    expect(height).toBeGreaterThanOrEqual(PODIUM.floors[0] * 3.2 - 1e-9);
    expect(height).toBeLessThanOrEqual(PODIUM.floors[1] * 3.2 + 1e-9);
    for (const p of tower) {
      expect(pointInRing(p, ring)).toBe(true);
      expect(Math.min(p[0], 50 - p[0], p[1], 40 - p[1])).toBeGreaterThanOrEqual(PODIUM.inset - 1e-6);
    }
    // Small or slim towers, and homes, don't get one.
    expect(buildingForm(bld('s', 'office', 120, rect(0, 0, 20, 20))).podium).toBeUndefined();
    expect(buildingForm(bld('a', 'apartments', 120, ring)).podium).toBeUndefined();
  });

  it('puts shopfronts on most commercial and untyped buildings, never on houses, warehouses or canopies', () => {
    const many = Array.from({ length: 200 }, (_, i) => buildingForm(bld(`c${i}`, 'commercial', 20, rect(0, 0, 30, 20))));
    const share = many.filter((f) => f.shops).length / many.length;
    expect(share).toBeGreaterThan(0.55);
    expect(share).toBeLessThan(0.85);
    expect(buildingForm(bld('w', 'warehouse', 20, rect(0, 0, 30, 20))).shops).toBe(false);
    expect(buildingForm(bld('k', 'commercial', 20, rect(0, 0, 30, 20), { minH: 5 })).shops).toBe(false);
  });

  it('is the same every time', () => {
    const b = bld('same', 'yes', 6, rect(0, 0, 10, 7));
    expect(buildingForm(b)).toEqual(buildingForm(b));
  });
});

describe('addFormedBuilding', () => {
  const colors = { wall: [0.5, 0.5, 0.5] as [number, number, number], roof: [0.4, 0.4, 0.4] as [number, number, number], hipRoof: [0.6, 0.3, 0.2] as [number, number, number] };
  it('adds six roof triangles above the walls for a hip roof, all facing up', () => {
    const b = bld('h1', 'house', 6, rect(0, 0, 10, 7));
    const plain = new MeshBuilder();
    addFormedBuilding(plain, b.rings, 6, colors, { shops: false });
    const mb = new MeshBuilder();
    const form = buildingForm(b);
    addFormedBuilding(mb, b.rings, 6, colors, form);
    expect(mb.triangleCount - plain.triangleCount).toBe(6);
    const m = mb.build();
    const ys = Array.from(m.position).filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(6 + form.hip!.rise);
    const ny = Array.from(m.normal).filter((_, i) => i % 3 === 1).slice(-18);
    expect(ny.every((n) => n > 0)).toBe(true);
  });

  it('builds a podium and a narrower tower above it', () => {
    const ring = rect(0, 0, 50, 40);
    const form = buildingForm(bld('t', 'office', 120, ring));
    const mb = new MeshBuilder();
    expect(addFormedBuilding(mb, [ring], 120, colors, form)).toBe(true);
    expect(ringArea(form.podium!.tower)).toBeLessThan(ringArea(ring));
    expect(mb.triangleCount).toBeGreaterThan(16);
  });
});
