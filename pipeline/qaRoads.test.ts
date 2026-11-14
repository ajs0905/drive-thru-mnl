import { describe, expect, it } from 'vitest';
import type { Crossing, Junction, MapData } from '../src/map/types';
import { roadIssues } from './qaRoads';

const base: MapData = {
  version: 5,
  origin: { lat: 0, lon: 0 },
  bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
  roads: [
    { id: 'a', highway: 'residential', cls: 'minor', w: 8, points: [[-50, 0], [0, 0]] },
    { id: 'b', highway: 'residential', cls: 'minor', w: 8, points: [[0, 0], [50, 0]] },
    { id: 'c', highway: 'residential', cls: 'minor', w: 8, points: [[0, 0], [0, 50]] },
  ],
  junctions: [{ id: 'j0', ring: [[-4, -4], [4, -4], [4, 4], [-4, 4]], z: 0, cls: 'minor' }],
  crossings: [],
  buildings: [],
  areas: [],
  stats: { features: 0, roads: 3, buildings: 0, areas: 0, skipped: {} },
};
const zebra = (x: number, y: number): Crossing => ({ c: [x, y], dir: [1, 0], half: 4, w: 3, z: 0, cls: 'minor' });
const kinds = (m: MapData) => roadIssues(m).map((i) => i.kind);

describe('roadIssues', () => {
  it('passes a clean junction', () => {
    expect(kinds({ ...base, crossings: [zebra(20, 0)] })).toEqual([]);
  });

  it('flags zebras that overlap or sit inside a junction', () => {
    expect(kinds({ ...base, crossings: [zebra(20, 0), zebra(21, 0)] })).toEqual(['zebra-overlap']);
    expect(kinds({ ...base, crossings: [zebra(1, 0)] })).toEqual(['zebra-overlap']);
  });

  it('flags a junction polygon reaching far past its roads', () => {
    const spiky: Junction = { id: 'j0', ring: [[-4, -4], [4, -4], [40, 0], [4, 4], [-4, 4]], z: 0, cls: 'minor' };
    expect(kinds({ ...base, junctions: [spiky] })).toContain('junction-spike');
  });
});
