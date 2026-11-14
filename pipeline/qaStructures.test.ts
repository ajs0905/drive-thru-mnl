import { describe, expect, it } from 'vitest';
import type { Building, MapData, Pillar, Road, Tree } from '../src/map/types';
import { structureIssues } from './qaStructures';

const map = (extra: Partial<MapData>): MapData => ({
  version: 7,
  origin: { lat: 14.55, lon: 121.05 },
  bounds: { minX: -500, minY: -500, maxX: 500, maxY: 500 },
  roads: [],
  junctions: [],
  crossings: [],
  buildings: [],
  areas: [],
  stats: { features: 0, roads: 0, buildings: 0, areas: 0, skipped: {} },
  ...extra,
});
const road = (id: string, extra: Partial<Road>): Road => ({ id, highway: 'primary', cls: 'major', w: 10, oneway: true, points: [[0, 0], [100, 0]], ...extra });
const kinds = (m: MapData) => structureIssues(m).map((i) => i.kind);

describe('structureIssues', () => {
  it('finds a pillar standing in the lanes of a road below, but not one in an avenue median or under its own deck', () => {
    const street = road('s', { points: [[50, -50], [50, 50]] });
    const deck = road('d', { z: [7, 7] });
    const inLane: Pillar = { p: [50, 2], top: 5.8, size: 1.8, rot: 0 };
    expect(kinds(map({ roads: [street, deck], pillars: [inLane] }))).toEqual(['pillar-in-lanes']);
    const avenue = road('a', { oneway: undefined, w: 14, points: [[0, 0], [100, 0]] });
    expect(kinds(map({ roads: [avenue, road('v', { points: [[0, 2.7], [100, 2.7]], z: [7, 7] })], pillars: [{ p: [30, 0.2], top: 5.8, size: 1.8, rot: 0 }] }))).toEqual([]);
    expect(kinds(map({ roads: [deck], pillars: [{ p: [30, 0], top: 5.8, size: 1.8, rot: 0 }] }))).toEqual([]);
  });

  it("finds a ramp whose side wall stands in another road's lanes", () => {
    const ramp = road('r', { w: 7, points: [[0, 0], [30, 0], [60, 0]], z: [0, 1.5, 3] });
    const frontage = road('f', { points: [[0, 4], [60, 4]] });
    expect(kinds(map({ roads: [ramp, frontage] }))).toEqual(['ramp-in-lanes', 'flickering-overlap']);
  });

  it('finds a tree whose crown reaches into a flyover', () => {
    const tree: Tree = { p: [50, 7], shape: 'broad', s: 1 };
    expect(kinds(map({ roads: [road('d', { z: [7, 7] })], trees: [tree] }))).toEqual(['tree-by-deck']);
    expect(kinds(map({ roads: [road('d', { z: [7, 7] })], trees: [{ ...tree, p: [50, 20] }] }))).toEqual([]);
  });

  it('finds a raised building with nothing holding it up', () => {
    const canopy: Building = { id: 'c', type: 'roof', h: 4.2, minH: 3.6, hSrc: 'tag', rings: [[[0, 0], [20, 0], [20, 10], [0, 10]]] };
    expect(kinds(map({ buildings: [canopy] }))).toEqual(['unsupported-building']);
    expect(kinds(map({ buildings: [canopy], pillars: [{ p: [1, 1], top: 3.6, size: 0.35, rot: 0 }] }))).toEqual([]);
  });

  it('finds overlapping roads of a class drawn in the same plane, and not once they are layered', () => {
    const a = road('a', {});
    const b = road('b', { points: [[100, 9], [0, 9]] });
    expect(kinds(map({ roads: [a, b] }))).toEqual(['flickering-overlap']);
    expect(kinds(map({ roads: [a, { ...b, lift: 1 }] }))).toEqual([]);
  });
});
