import { describe, expect, it } from 'vitest';
import type { Building, Point, Ring, Road } from '../src/map/types';
import { rampDownFromEnd, settleRaised } from './settleRaised';

const box = (x0: number, y0: number, x1: number, y1: number): Ring => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const mall = (ring: Ring, extra: Partial<Building> = {}): Building => ({
  id: 'mall', type: 'retail', h: 25, hSrc: 'estimate', rings: [ring], ...extra,
});
let n = 0;
const way = (points: Point[], z: number[], extra: Partial<Road> = {}): Road => ({
  id: `w${n++}`, highway: 'footway', cls: 'path', w: 2, points, z, ...extra,
});

describe('settleRaised', () => {
  it('cuts the part of a skywalk that runs through a building', () => {
    const sky = way([[-30, 0], [-10, 0], [10, 0], [30, 0], [60, 0]], [6, 6, 6, 6, 6]);
    const { roads, stats } = settleRaised([sky], [mall(box(-5, -20, 50, 20))]);
    // Only the part outside (x -30..-10) is left; the rest ran inside the mall.
    expect(roads).toHaveLength(1);
    expect(roads[0].points[0]).toEqual([-30, 0]);
    expect(roads[0].points.at(-1)).toEqual([-10, 0]);
    expect(stats.insideRemovedMeters).toBeCloseTo(70, 5);
  });

  it('keeps ground-level paths that pass through buildings (passages, arcades)', () => {
    const passage = way([[-30, 0], [30, 0]], [0, 0]);
    const { roads } = settleRaised([passage], [mall(box(-5, -20, 5, 20))]);
    expect(roads).toHaveLength(1);
  });

  it('keeps a flyover deck over a low building (bad data), but cuts it inside a tall one', () => {
    const deck: Road = { ...way([[-50, 0], [50, 0]], [7, 7]), cls: 'major', highway: 'primary', w: 10 };
    const low = settleRaised([deck], [mall(box(-5, -5, 5, 5), { h: 4 })]);
    expect(low.roads).toHaveLength(1);
    expect(low.roads[0].points[0]).toEqual([-50, 0]);
    expect(low.roads[0].points.at(-1)).toEqual([50, 0]);
    const tall = settleRaised([deck], [mall(box(-60, -5, 60, 5), { h: 30 })]);
    expect(tall.roads).toHaveLength(0);
  });

  it('drops short raised scraps with a loose end', () => {
    const scrap = way([[0, 0], [3, 0]], [6, 6]);
    const { roads, stats } = settleRaised([scrap], []);
    expect(roads).toHaveLength(0);
    expect(stats.scrapsRemoved).toBe(1);
  });

  it('keeps a short raised piece that links two others', () => {
    const a = way([[-50, 0], [0, 0]], [6, 6]);
    const link = way([[0, 0], [3, 0]], [6, 6]);
    const b = way([[3, 0], [50, 0]], [6, 6]);
    const { roads } = settleRaised([a, link, b], []);
    expect(roads.map((r) => r.id)).toContain(link.id);
  });

  it('slopes a mid-air end down to the ground', () => {
    const fb = way([[0, 0], [60, 0]], [6, 6]);
    const stair = way([[60, 0], [70, 0]], [6, 0], { highway: 'steps' });
    const { roads, stats } = settleRaised([fb, stair], []);
    const r = roads.find((x) => x.id === fb.id)!;
    expect(r.z![0]).toBe(0);
    expect(r.z![r.z!.length - 1]).toBe(6); // the end with stairs is untouched
    expect(stats.endsLowered).toBe(1);
  });

  it('leaves an end that stops at a building wall level (a skywalk entrance)', () => {
    const sky = way([[-30, 0], [-5.5, 0]], [6, 6]);
    const { roads, stats } = settleRaised([sky], [mall(box(-5, -20, 50, 20))]);
    expect(roads[0].z![roads[0].z!.length - 1]).toBe(6);
    expect(stats.endsAtBuildings).toBe(1);
    expect(stats.endsLowered).toBe(1); // the other end, out in the open, comes down
  });

  it('ignores canopies when looking for buildings', () => {
    const sky = way([[-30, 0], [30, 0]], [6, 6]);
    const { roads } = settleRaised([sky], [mall(box(-5, -20, 5, 20), { minH: 3.6, h: 4.2 })]);
    expect(roads[0].points[0]).toEqual([-30, 0]);
    expect(roads[0].points.at(-1)).toEqual([30, 0]);
  });
});

describe('rampDownFromEnd', () => {
  it('reaches the ground at the end and full height after R', () => {
    const { points, z } = rampDownFromEnd([[0, 0], [100, 0]], [6, 6], 'start', 20);
    expect(z[0]).toBe(0);
    expect(z[z.length - 1]).toBe(6);
    const at = (x: number) => z[points.findIndex((p) => p[0] === x)];
    expect(at(10)).toBeCloseTo(3, 5);
    expect(at(20)).toBe(6);
  });

  it('works from the far end too', () => {
    const { z } = rampDownFromEnd([[0, 0], [100, 0]], [6, 6], 'end', 20);
    expect(z[0]).toBe(6);
    expect(z[z.length - 1]).toBe(0);
  });
});
