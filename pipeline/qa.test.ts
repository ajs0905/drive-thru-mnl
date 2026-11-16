import { describe, expect, it } from 'vitest';
import type { Building, MapData, Road } from '../src/map/types';
import { countByKind, regressions, runQa } from './qa';

const map = (roads: Road[], buildings: Building[] = []): MapData => ({
  version: 7,
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

  it('finds trees on roads and in buildings, and walls across roads', () => {
    const m: MapData = {
      ...map([road({})], [box(40, 20, 50, 30)]),
      trees: [{ p: [10, 2], shape: 'broad', s: 1 }, { p: [45, 25], shape: 'palm', s: 1 }, { p: [10, 30], shape: 'broad', s: 1 }],
      barriers: [
        { id: 'w', kind: 'wall', h: 2, points: [[60, -20], [60, 20]] },
        { id: 'g', kind: 'rail', h: 1, points: [[0, 4], [100, 4]] },
      ],
    };
    const kinds = countByKind(runQa(m));
    expect(kinds).toEqual({ 'tree-on-road': 1, 'tree-in-building': 1, 'barrier-on-road': 1 });
  });

  it('finds solid street furniture in a road or a building, but not flat stall lines', () => {
    const m: MapData = {
      ...map([road({})], [box(40, 20, 50, 30)]),
      dressing: [
        { k: 'bin', p: [10, 3], rot: 0 },
        { k: 'kiosk', p: [45, 25], rot: 0 },
        { k: 'bench', p: [10, 30], rot: 0 },
        { k: 'stall', p: [20, 0], rot: 0 },
      ],
    };
    expect(countByKind(runQa(m))).toEqual({ 'dressing-in-the-way': 2 });
  });

  it('finds traffic lights facing the wrong way or clustered, poles by crossings or under decks, and furniture drawn into furniture', () => {
    const r = road({});
    const m: MapData = {
      ...map([r, { ...r, id: 'deck', points: [[0, 30], [100, 30]], z: [6, 6] }]),
      crossings: [{ c: [80, 0], dir: [1, 0], half: 3.5, w: 4, z: 0, cls: 'minor' }],
      dressing: [
        // Beside the road at y = 0, its heads facing along it (+x): fine. The same turned a quarter: wrong.
        { k: 'signalpole', p: [20, 4.5], rot: -Math.PI / 2 },
        { k: 'signalpole', p: [40, 4.5], rot: 0 },
        // Two on one corner.
        { k: 'signalpole', p: [60, -4.5], rot: Math.PI / 2 },
        { k: 'signalpole', p: [62, -4.5], rot: Math.PI / 2 },
        // A street light by the crossing, one under the deck, one in a kiosk's awning.
        { k: 'streetlight', p: [80.5, 4.5], rot: -Math.PI / 2 },
        { k: 'streetlight', p: [50, 30], rot: -Math.PI / 2 },
        { k: 'kiosk', p: [10, 20], rot: 0 },
        { k: 'streetlight', p: [10, 18.6], rot: 0 },
      ],
    };
    const n = countByKind(runQa(m));
    expect(n['signal-misaligned']).toBe(1);
    expect(n['signal-cluster']).toBe(1);
    expect(n['pole-by-crossing']).toBe(1);
    expect(n['pole-under-structure']).toBe(1);
    expect(n['dressing-overlap']).toBe(1);
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
