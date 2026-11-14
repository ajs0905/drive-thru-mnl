import { describe, expect, it } from 'vitest';
import type { Building, MapData, Road } from '../src/map/types';
import { countByKind, regressions, runQa } from './qa';

const map = (roads: Road[], buildings: Building[] = []): MapData => ({
  version: 5,
  junctions: [],
  crossings: [],
  origin: { lat: 14.55, lon: 121.05 },
  bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
  roads,
  buildings,
  areas: [],
  stats: { features: 0, roads: roads.length, buildings: buildings.length, areas: 0, skipped: {} },
});
const road = (extra: Partial<Road>): Road => ({ id: 'r', highway: 'primary', cls: 'major', w: 10, points: [[0, 0], [100, 0]], ...extra });
const box = (x0: number, y0: number, x1: number, y1: number): Building => ({
  id: 'b', type: 'yes', h: 20, hSrc: 'estimate', rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
});

describe('runQa', () => {
  it('finds a building standing in a road', () => {
    const kinds = countByKind(runQa(map([road({})], [box(40, -3, 50, 8)])));
    expect(kinds['building-on-major-road (playable)']).toBe(1);
  });

  it('finds a raised walkway running through a building', () => {
    const sky = road({ id: 's', cls: 'path', highway: 'footway', w: 2, z: [6, 6], points: [[0, 0], [100, 0]] });
    const kinds = countByKind(runQa(map([sky], [box(20, -20, 80, 20)])));
    expect(kinds['raised-inside-building']).toBe(1);
  });

  it('finds a raised end hanging in mid-air', () => {
    const deck = road({ z: [7, 7] });
    const kinds = countByKind(runQa(map([deck])));
    expect(kinds['floating-end']).toBe(2);
  });

  it('reports nothing for a clean map', () => {
    expect(runQa(map([road({})], [box(40, 20, 50, 30)]))).toEqual([]);
  });
});

describe('regressions', () => {
  it('flags counts above the baseline and treats missing kinds as 0 allowed', () => {
    expect(regressions({ a: 3, b: 5, c: 1 }, { a: 3, b: 4 })).toEqual([
      { kind: 'b', count: 5, allowed: 4 },
      { kind: 'c', count: 1, allowed: 0 },
    ]);
  });

  it('accepts counts at or below the baseline', () => {
    expect(regressions({ a: 2 }, { a: 3 })).toEqual([]);
  });
});
