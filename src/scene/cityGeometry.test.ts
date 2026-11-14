import { describe, expect, it } from 'vitest';
import type { MapData } from '../map/types';
import { decodeMark, MARK } from '../geometry/road';
import { decodeWindows, WINDOWS } from '../geometry/extrude';
import { buildCity, buildingColor, CROSSING_Y, landuseHeights, PALETTE, SIDEWALK_Y, windowStyle } from './cityGeometry';

const sample: MapData = {
  version: 5,
  junctions: [],
  crossings: [],
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

  it('gives every road vertex marking data', () => {
    expect(city.roads.aux!.length).toBe((city.roads.position.length / 3) * 4);
  });

  it('draws junction polygons, sidewalks and zebra crossings into the road layer', () => {
    const modes = (m: MapData) => {
      const { aux, position } = buildCity(m).roads;
      const out = new Map<number, number[]>(); // mode -> heights
      for (let v = 0; v < aux!.length / 4; v++) {
        const mode = decodeMark(aux![v * 4 + 3]).mode;
        out.set(mode, [...(out.get(mode) ?? []), position[v * 3 + 1]]);
      }
      return out;
    };
    const base = modes(sample);
    expect(base.get(MARK.lanes)?.length).toBeGreaterThan(0);
    expect(base.get(MARK.sidewalk)!.every((y) => Math.abs(y - SIDEWALK_Y) < 1e-6)).toBe(true); // major road, both sides by default

    const more = modes({
      ...sample,
      crossings: [{ c: [-50, -10], dir: [1, 0], half: 5, w: 3, z: 0, cls: 'major' }],
      junctions: [{ id: 'j0', ring: [[-5, -15], [5, -15], [5, -5], [-5, -5]], z: 0, cls: 'major' }],
    });
    expect(more.get(MARK.zebra)!.every((y) => Math.abs(y - CROSSING_Y) < 1e-6)).toBe(true);
    expect(more.get(MARK.plain)!.length).toBeGreaterThan(base.get(MARK.plain)?.length ?? 0);
  });

  it('gives building walls window data and puts props on the playable office roof', () => {
    expect(city.buildings.aux!.length).toBe((city.buildings.position.length / 3) * 4);
    expect(city.props.length).toBeGreaterThan(0);
    expect(city.props.every((p) => p.base === 45)).toBe(true); // only way/1 (scenery way/2 gets none)
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

describe('windowStyle', () => {
  const b = { id: 'x', rings: [], hSrc: 'estimate' as const };
  const kind = (extra: { type: string; h: number; minH?: number }) => decodeWindows(windowStyle({ ...b, ...extra })).kind;
  it('picks windows by type and height', () => {
    expect(kind({ type: 'office', h: 80 })).toBe(WINDOWS.glass);
    expect(kind({ type: 'office', h: 15 })).toBe(WINDOWS.office);
    expect(kind({ type: 'apartments', h: 30 })).toBe(WINDOWS.apartment);
    expect(kind({ type: 'house', h: 6 })).toBe(WINDOWS.house);
    expect(kind({ type: 'yes', h: 60 })).toBe(WINDOWS.glass);
    expect(kind({ type: 'parking', h: 12 })).toBe(WINDOWS.parking);
  });

  it('leaves warehouses, canopies and sheds blank', () => {
    expect(windowStyle({ ...b, type: 'warehouse', h: 10 })).toBe(0);
    expect(windowStyle({ ...b, type: 'roof', h: 4.2, minH: 3.6 })).toBe(0);
    expect(windowStyle({ ...b, type: 'yes', h: 2 })).toBe(0);
  });

  it('counts whole floors', () => {
    expect(decodeWindows(windowStyle({ ...b, type: 'office', h: 32 })).floors).toBe(10);
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
