import { describe, expect, it } from 'vitest';
import type { MapData } from '../map/types';
import { buildCity, buildingColor, landuseHeights, PALETTE } from './cityGeometry';

const sample: MapData = {
  version: 3,
  origin: { lat: 14.5509, lon: 121.0503 },
  bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
  buildings: [
    { id: 'way/1', type: 'office', h: 45, hSrc: 'estimate', rings: [[[0, 0], [20, 0], [20, 20], [0, 20]]] },
    {
      id: 'way/2', type: 'yes', h: 12, hSrc: 'levels', scenery: true,
      rings: [[[40, 40], [60, 40], [60, 60], [40, 60]], [[45, 45], [55, 45], [55, 55], [45, 55]]],
    },
  ],
  roads: [
    { id: 'way/3', highway: 'primary', cls: 'major', w: 10, points: [[-100, -10], [0, -10], [50, 30]] },
    { id: 'way/4', highway: 'footway', cls: 'path', w: 2, points: [[-50, 50], [-50, 50], [-40, 60]] },
  ],
  areas: [
    { id: 'way/5', kind: 'park', rings: [[[-80, -80], [-40, -80], [-40, -40], [-80, -40]]] },
    { id: 'way/6', kind: 'landuse', landuse: 'commercial', rings: [[[-100, -100], [100, -100], [100, 100], [-100, 100]]] },
  ],
  stats: { features: 6, roads: 2, buildings: 2, areas: 2, skipped: {} },
};

describe('buildCity', () => {
  const city = buildCity(sample);

  it('fills every layer and keeps scenery separate', () => {
    expect(city.buildings.position.length / 9).toBe(4 * 2 + 2);
    expect(city.scenery.position.length / 9).toBe(8 * 2 + 8);
    expect(city.roads.position.length).toBeGreaterThan(0);
    expect(city.ground.position.length).toBeGreaterThan(0);
  });

  it('keeps position, normal and color arrays the same length', () => {
    for (const layer of [city.buildings, city.scenery, city.roads, city.ground, city.edge]) {
      expect(layer.normal.length).toBe(layer.position.length);
      expect(layer.color.length).toBe(layer.position.length);
      expect(layer.position.length % 9).toBe(0);
    }
  });

  it('never produces NaN or Infinity', () => {
    for (const layer of [city.buildings, city.roads, city.ground]) {
      expect(layer.position.every(Number.isFinite)).toBe(true);
      expect(layer.normal.every(Number.isFinite)).toBe(true);
    }
  });

  it('builds no fence when there is no playable area', () => {
    expect(sample.playable).toBeUndefined();
    expect(city.edge.position.length).toBe(0);
  });

  it('builds a fence when there is one', () => {
    const withEdge = buildCity({ ...sample, playable: [[0, 0], [100, 0], [100, 100], [0, 100]] });
    expect(withEdge.edge.position.length / 9).toBe(4 * 2);
  });
});

describe('buildingColor', () => {
  const b = { id: 'x', rings: [], hSrc: 'estimate' as const };
  it('colors by type, and untyped towers as commercial', () => {
    expect(buildingColor({ ...b, type: 'house', h: 6 })).toBe(PALETTE.residential);
    expect(buildingColor({ ...b, type: 'school', h: 13 })).toBe(PALETTE.civic);
    expect(buildingColor({ ...b, type: 'yes', h: 80 })).toBe(PALETTE.commercial);
    expect(buildingColor({ ...b, type: 'yes', h: 6 })).toBe(PALETTE.lowGeneric);
  });
});

describe('landuseHeights', () => {
  it('puts smaller land-use areas on top of bigger ones, whatever the file order', () => {
    const sq = (d: number): [number, number][] => [[0, 0], [d, 0], [d, d], [0, d]];
    const small = { id: 'cemetery', kind: 'landuse' as const, landuse: 'cemetery', rings: [sq(10)] };
    const big = { id: 'military', kind: 'landuse' as const, landuse: 'military', rings: [sq(1000)] };
    for (const order of [[small, big], [big, small]]) {
      const y = landuseHeights(order);
      expect(y.get(small)!).toBeGreaterThan(y.get(big)!);
    }
  });
});
