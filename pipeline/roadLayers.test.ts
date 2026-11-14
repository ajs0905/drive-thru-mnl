import { describe, expect, it } from 'vitest';
import type { Point, Road } from '../src/map/types';
import { layerRoads } from './roadLayers';

let n = 0;
const road = (points: Point[], extra: Partial<Road> = {}): Road => ({ id: `r${n++}`, highway: 'primary', cls: 'major', w: 10, oneway: true, points, ...extra });

describe('layerRoads', () => {
  it('puts parallel carriageways that overlap at the median on different layers', () => {
    const { roads, stats } = layerRoads([road([[0, 0], [100, 0]]), road([[100, 9], [0, 9]])]);
    expect(new Set(roads.map((r) => r.lift ?? 0)).size).toBe(2);
    expect(stats).toEqual({ overlapping: 2, lifted: 1, layers: 2 });
  });

  it('leaves roads that only meet at a junction, or merely touch, on the ground layer', () => {
    const meet = layerRoads([road([[0, 0], [100, 0]]), road([[100, 0], [200, 0]]), road([[100, 0], [100, 100]])]);
    expect(meet.roads.every((r) => r.lift === undefined)).toBe(true);
    const touch = layerRoads([road([[0, 0], [100, 0]]), road([[0, 10], [100, 10]])]);
    expect(touch.roads.every((r) => r.lift === undefined)).toBe(true);
  });

  it("doesn't layer roads of different classes or heights (they're drawn apart already)", () => {
    const classes = layerRoads([road([[0, 0], [100, 0]]), road([[0, 5], [100, 5]], { cls: 'minor', highway: 'residential' })]);
    expect(classes.roads.every((r) => r.lift === undefined)).toBe(true);
    const heights = layerRoads([road([[0, 0], [100, 0]]), road([[0, 5], [100, 5]], { z: [7, 7] })]);
    expect(heights.roads.every((r) => r.lift === undefined)).toBe(true);
  });

  it('gives three mutually overlapping roads three layers', () => {
    const { roads } = layerRoads([road([[0, 0], [100, 0]]), road([[0, 4], [100, 4]]), road([[0, 8], [100, 8]])]);
    expect(new Set(roads.map((r) => r.lift ?? 0)).size).toBe(3);
  });
});
