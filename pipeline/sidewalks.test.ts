import { describe, expect, it } from 'vitest';
import { DRESSING } from '../src/geometry/dressing';
import type { Crossing, MapData, Road } from '../src/map/types';
import { acrossOffset, placeSidewalkDressing, SIDEWALKS } from './sidewalks';

const map = (roads: Road[], extra: Partial<MapData> = {}): MapData => ({
  version: 7,
  origin: { lat: 14.55, lon: 121.05 },
  bounds: { minX: -2000, minY: -2000, maxX: 2000, maxY: 2000 },
  roads,
  junctions: [],
  crossings: [],
  buildings: [],
  areas: [],
  stats: { features: 0, roads: 0, buildings: 0, areas: 0, skipped: {} },
  ...extra,
});
const avenue = (extra: Partial<Road> = {}): Road => ({ id: 'ave', highway: 'primary', cls: 'major', w: 12, points: [[0, 0], [1500, 0]], ...extra });

describe('acrossOffset', () => {
  it('puts curb pieces by the curb and back pieces against the back edge', () => {
    expect(acrossOffset(12, 3, 0.8, 0)).toBeCloseTo(6 + SIDEWALKS.curbGap + 0.4);
    expect(acrossOffset(12, 3, 1.6, 1)).toBeCloseTo(6 + 3 - SIDEWALKS.backGap - 0.8);
  });
  it("leaves out what doesn't fit the sidewalk", () => {
    expect(acrossOffset(7, 2, 2, 1)).toBeUndefined();
  });
});

describe('placeSidewalkDressing', () => {
  it('lines an avenue with sheds, planters, bins and hydrants, all on its sidewalks', () => {
    const { dressing, stats } = placeSidewalkDressing(map([avenue()]));
    for (const k of ['shed', 'planter', 'bin', 'hydrant']) expect(stats.placed[k]).toBeGreaterThan(0);
    for (const d of dressing) {
      const half = DRESSING[d.k].size[1] / 2;
      expect(Math.abs(d.p[1]) - half).toBeGreaterThan(6);
      expect(Math.abs(d.p[1]) + half).toBeLessThan(6 + 3);
      // Along the street.
      expect(Math.abs(Math.sin(d.rot))).toBeLessThan(1e-3);
    }
    // Both sides.
    expect(new Set(dressing.map((d) => Math.sign(d.p[1])))).toEqual(new Set([-1, 1]));
  });

  it('turns waiting sheds to face the road', () => {
    const sheds = placeSidewalkDressing(map([avenue()])).dressing.filter((d) => d.k === 'shed');
    expect(sheds.length).toBeGreaterThan(0);
    // The open side (+z of the model) faces the right of rot, (sin, -cos): toward y = 0.
    for (const s of sheds) expect(-Math.cos(s.rot) * Math.sign(s.p[1])).toBeLessThan(0);
  });

  it('keeps pieces from crowding each other', () => {
    const { dressing } = placeSidewalkDressing(map([avenue()]));
    for (let i = 0; i < dressing.length; i++)
      for (let j = i + 1; j < dressing.length; j++) {
        const [a, b] = [dressing[i], dressing[j]];
        if (Math.sign(a.p[1]) !== Math.sign(b.p[1])) continue;
        const gap = Math.abs(a.p[0] - b.p[0]) - (DRESSING[a.k].size[0] + DRESSING[b.k].size[0]) / 2;
        if (Math.abs(a.p[1] - b.p[1]) < (DRESSING[a.k].size[1] + DRESSING[b.k].size[1]) / 2 + SIDEWALKS.room) expect(gap).toBeGreaterThan(SIDEWALKS.room - 1e-6);
      }
  });

  it('keeps clear of crossings, footpaths and sidewalks the road has none of', () => {
    const crossing: Crossing = { c: [750, 0], dir: [1, 0], w: 4, half: 6, z: 0, cls: 'major' };
    const path: Road = { id: 'p', highway: 'footway', cls: 'path', w: 2, points: [[300, -20], [300, 20]] };
    const { dressing } = placeSidewalkDressing(map([avenue({ sidewalk: 'right' }), path], { crossings: [crossing] }));
    expect(dressing.length).toBeGreaterThan(0);
    for (const d of dressing) {
      expect(d.p[1]).toBeLessThan(0);
      expect(Math.abs(d.p[0] - 750)).toBeGreaterThan(4);
      expect(Math.abs(d.p[0] - 300)).toBeGreaterThan(1 + SIDEWALKS.fromPath);
    }
  });

  it('skips paths, service roads, flyovers and scenery', () => {
    const roads: Road[] = [avenue({ id: 'a', z: [6, 6] }), avenue({ id: 'b', scenery: true }), avenue({ id: 'c', cls: 'service', w: 4 })];
    expect(placeSidewalkDressing(map(roads)).dressing).toHaveLength(0);
  });

  it('is the same every time', () => {
    expect(placeSidewalkDressing(map([avenue()]))).toEqual(placeSidewalkDressing(map([avenue()])));
  });
});
