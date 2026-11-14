import { describe, expect, it } from 'vitest';
import type { MapData } from '../map/types';
import { decodeMark, MARK } from '../geometry/road';
import { decodeWindows, WINDOWS } from '../geometry/extrude';
import { buildCity, buildingColor, CROSSING_Y, landuseHeights, PALETTE, propColor, propInstanceColor, SIDEWALK_Y, windowStyle, type LayerArrays, type LayerChunk } from './cityGeometry';
import { hexToRgb, srgbToLinear } from '../geometry/meshBuilder';
import { LEAF_REFERENCE } from '../geometry/treeShapes';
import type { Prop } from '../geometry/props';

/** A chunked layer merged back into one set of arrays, for checking totals. */
function merged(chunks: LayerChunk[]): LayerArrays {
  const cat = (pick: (a: LayerArrays) => Float32Array | undefined) => {
    const parts = chunks.map((c) => pick(c.arrays) ?? new Float32Array());
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  const aux = chunks.some((c) => c.arrays.aux);
  return { position: cat((a) => a.position), normal: cat((a) => a.normal), color: cat((a) => a.color), ...(aux && { aux: cat((a) => a.aux) }) };
}

const sample: MapData = {
  version: 7,
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
  const built = buildCity(sample);
  const city = {
    ...built,
    buildings: merged(built.buildings),
    scenery: merged(built.scenery),
    roads: merged(built.roads),
    ground: merged(built.ground),
    props: built.props.flatMap((c) => c.arrays),
  };

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
      const { aux, position } = merged(buildCity(m).roads);
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

  it('splits layers into grid cells, each with its own geometry', () => {
    const wide = buildCity({
      ...sample,
      buildings: [
        ...sample.buildings,
        { id: 'way/9', type: 'office', h: 20, hSrc: 'estimate', rings: [[[2000, 0], [2020, 0], [2020, 20], [2000, 20]]] },
      ],
    });
    expect(wide.buildings.map((c) => c.key)).toEqual(['0,0', '1,0']);
    expect(wide.buildings.every((c) => c.arrays.position.length > 0)).toBe(true);
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

describe('buildCity with barriers, trees and fixtures', () => {
  const plain = buildCity(sample);
  const city = buildCity({
    ...sample,
    barriers: [{ id: 'w', kind: 'wall', h: 2.4, points: [[-90, 90], [-70, 90]] }],
    trees: [{ p: [-60, 80], shape: 'broad', s: 1 }, { p: [1500, 80], shape: 'palm', s: 1 }],
    fixtures: [{ kind: 'boom', p: [-20, -10], rot: Math.PI / 2, span: 5 }],
  });
  const tris = (chunks: LayerChunk[]) => chunks.reduce((n, c) => n + c.arrays.position.length / 9, 0);

  it('draws barriers with the flyover concrete (no extra draw calls)', () => {
    expect(tris(city.structures) - tris(plain.structures)).toBe(4 * 2 + 2);
  });

  it('puts trees in their own grid cells and fixtures with the rooftop props', () => {
    expect(city.simpleTrees.map((c) => [c.key, c.arrays.map((p) => p.kind)])).toEqual([
      ['-1,0', ['trunk', 'canopy']],
      ['1,0', ['palmTrunk', 'crown']],
    ]);
    expect(city.trees.map((c) => c.key)).toEqual(['-1,0', '1,0']);
    expect(city.trees[1].arrays.map((p) => p.kind)).toEqual(['palm']);
    expect(['treeRound', 'treeWide', 'treeTall']).toContain(city.trees[0].arrays[0].kind);
    const kinds = city.props.flatMap((c) => c.arrays.map((p) => p.kind));
    expect(kinds.filter((k) => k === 'post' || k === 'boom')).toEqual(['post', 'boom']);
  });
});

describe('propInstanceColor', () => {
  const prop = (kind: Prop['kind'], tone: number): Prop => ({ kind, x: 0, y: 0, base: 0, size: [1, 1, 1], rot: 0, tone });

  it('gives plain shapes their palette color in linear RGB', () => {
    const p = prop('bollard', 0.5);
    expect(propInstanceColor(p)).toEqual(srgbToLinear(hexToRgb(propColor(p))));
  });
  it('gives tree models the tint that turns their reference green into the palette green', () => {
    for (const tone of [0, 0.3, 0.99]) {
      const p = prop('treeWide', tone);
      const tint = propInstanceColor(p);
      const ref = srgbToLinear(hexToRgb(LEAF_REFERENCE.treeWide));
      const want = srgbToLinear(hexToRgb(propColor(p)));
      for (let c = 0; c < 3; c++) expect(ref[c] * tint[c]).toBeCloseTo(want[c], 6);
    }
  });
});
