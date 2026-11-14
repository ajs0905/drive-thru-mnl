import { describe, expect, it } from 'vitest';
import type { Point, Road } from '../src/map/types';
import { pointInRing } from '../src/geometry/polygon';
import { laneCount } from '../src/map/roads';
import { buildJunctions } from './junctions';

let n = 0;
const road = (points: Point[], extra: Partial<Road> = {}): Road => ({
  id: `r${n++}`, highway: 'residential', cls: 'minor', w: 8, points, ...extra,
});

describe('buildJunctions', () => {
  it('splits a road that runs straight through a crossroads', () => {
    const ew = road([[-100, 0], [0, 0], [100, 0]]);
    const ns = road([[0, -100], [0, 0], [0, 100]]);
    const { roads, junctions, stats } = buildJunctions([ew, ns]);
    expect(roads).toHaveLength(4);
    expect(stats.split).toBe(2);
    expect(junctions).toHaveLength(1);
    expect(pointInRing([0, 0], junctions[0].ring)).toBe(true);
    // every piece is cut back by the other road's half width at the junction end
    for (const r of roads) expect(r.trim!.filter((t) => t >= 0)).toEqual([4]);
  });

  it('makes a T-junction where a side road ends on a through road', () => {
    const main = road([[-100, 0], [0, 0], [100, 0]], { cls: 'major', highway: 'primary', w: 12 });
    const side = road([[0, 0], [0, 80]]);
    const { roads, junctions } = buildJunctions([main, side]);
    expect(junctions).toHaveLength(1);
    expect(junctions[0].cls).toBe('major');
    const sidePiece = roads.find((r) => r.id === side.id)!;
    expect(sidePiece.trim).toEqual([6, -1]); // cut back to the main road's edge
  });

  it('skips plain continuations and leaves those ends untrimmed', () => {
    const a = road([[-100, 0], [0, 0]]);
    const b = road([[0, 0], [100, 0]]);
    const { roads, junctions, stats } = buildJunctions([a, b]);
    expect(junctions).toHaveLength(0);
    expect(stats.continuations).toBe(1);
    expect(roads.every((r) => r.trim === undefined)).toBe(true);
  });

  it('fills a bend between two road pieces', () => {
    const a = road([[-100, 0], [0, 0]]);
    const b = road([[0, 0], [60, 60]]);
    const { junctions } = buildJunctions([a, b]);
    expect(junctions).toHaveLength(1);
  });

  it('keeps the height of junctions on raised roads', () => {
    const a = road([[-100, 0], [0, 0]], { z: [7, 7] });
    const b = road([[0, 0], [0, 100]], { z: [7, 7] });
    const c = road([[0, 0], [100, 0]], { z: [7, 7] });
    const { junctions, roads } = buildJunctions([a, b, c]);
    expect(junctions[0].z).toBe(7);
    expect(roads.every((r) => r.z?.length === r.points.length)).toBe(true);
  });

  it('leaves paths out of the graph', () => {
    const ew = road([[-100, 0], [0, 0], [100, 0]]);
    const footway = road([[0, -50], [0, 0], [0, 50]], { cls: 'path', highway: 'footway', w: 2 });
    const { roads, junctions } = buildJunctions([ew, footway]);
    expect(roads).toHaveLength(2);
    expect(junctions).toHaveLength(0);
    expect(roads.find((r) => r.cls === 'path')?.lanes).toBeUndefined();
  });

  it('fills in lane counts for drivable roads', () => {
    const { roads } = buildJunctions([road([[0, 0], [10, 0]], { w: 7.4 }), road([[50, 0], [60, 0]], { w: 2.8 })]);
    expect(roads.map((r) => r.lanes)).toEqual([2, 1]);
  });
});

describe('laneCount', () => {
  it('uses the tag when it fits the width, and derives it otherwise', () => {
    expect(laneCount(road([], { w: 10.2, lanes: 3 }))).toBe(3);
    expect(laneCount(road([], { w: 5, lanes: 4 }))).toBe(1); // narrowed to fit between houses
    expect(laneCount(road([], { w: 13.8 }))).toBe(4);
    expect(laneCount(road([], { w: 3.5 }))).toBe(1);
  });
});
