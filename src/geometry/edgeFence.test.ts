import { describe, expect, it } from 'vitest';
import type { Ring, Road } from '../map/types';
import { addEdgeFence, EDGE_FENCE, EDGE_KIND, edgeStretches } from './edgeFence';
import { MeshBuilder, triangleNormal, type Vec3 } from './meshBuilder';

const square: Ring = [[0, 0], [100, 0], [100, 100], [0, 100]];
// A road crossing the bottom edge at x = 50, 10 m wide.
const road: Road = { id: 'r', highway: 'residential', cls: 'minor', w: 10, points: [[50, -40], [50, 40]] };

describe('edgeStretches', () => {
  it('marks where a road (and a sidewalk either side) crosses the edge, hoarding everywhere else', () => {
    const s = edgeStretches(square, [road]);
    const barriers = s.filter((x) => x.kind === EDGE_KIND.barrier);
    expect(barriers).toHaveLength(1);
    const b = barriers[0];
    expect(b.from).toBeLessThanOrEqual(50 - 5);
    expect(b.to).toBeGreaterThanOrEqual(50 + 5);
    expect(b.to - b.from).toBeLessThan(10 + 2 * EDGE_FENCE.roadMargin + 2 * EDGE_FENCE.step + 0.01);
    const total = s.reduce((sum, x) => sum + x.to - x.from, 0);
    expect(total).toBeCloseTo(400);
  });

  it('ignores paths and flyovers passing over the edge', () => {
    const path: Road = { ...road, id: 'p', cls: 'path', highway: 'footway' };
    const deck: Road = { ...road, id: 'd', z: [7, 7] };
    expect(edgeStretches(square, [path, deck]).every((x) => x.kind === EDGE_KIND.hoarding)).toBe(true);
  });

  it('counts meters along the whole edge, continuing from segment to segment', () => {
    const s = edgeStretches(square, []);
    expect(s.map((x) => x.at)).toEqual([0, 100, 200, 300]);
  });
});

describe('addEdgeFence', () => {
  it('leaves a gap where the edge runs through a building, stopping short of its walls', () => {
    const block = { id: 'b', type: 'yes', h: 20, hSrc: 'estimate' as const, rings: [[[20, -10], [40, -10], [40, 10], [20, 10]]] as [number, number][][] };
    const mb = new MeshBuilder({ aux: true });
    const meters = addEdgeFence(mb, square, [], [block]);
    expect(meters.hoarding).toBeLessThan(400 - 19);
    const { position } = mb.build();
    for (let v = 0; v < position.length / 3; v++) {
      const [x, z] = [position[v * 3], position[v * 3 + 2]];
      if (Math.abs(z) < 0.2) expect(x <= 20 || x >= 40).toBe(true);
    }
  });

  it('builds the hoarding as closed boxes with every face wound to face out, leaving the road to the roadblock', () => {
    const mb = new MeshBuilder({ aux: true });
    const meters = addEdgeFence(mb, square, [road]);
    expect(meters.hoarding + meters.roadblocks).toBeCloseTo(400);
    expect(meters.roadblocks).toBeGreaterThan(10);
    const { position, normal, aux } = mb.build();
    for (let i = 0; i < position.length / 9; i++) {
      const t = [0, 1, 2].map((k) => Array.from(position.slice((i * 3 + k) * 3, (i * 3 + k) * 3 + 3)) as Vec3);
      const n = triangleNormal(t[0], t[1], t[2]);
      const given = Array.from(normal.slice(i * 9, i * 9 + 3));
      expect(n[0] * given[0] + n[1] * given[1] + n[2] * given[2]).toBeGreaterThan(0.99);
    }
    const ys = Array.from(position).filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(EDGE_FENCE.hoarding.height);
    // aux: height above the ground matches the vertex height, and the kind is 0 or 1.
    for (let v = 0; v < position.length / 3; v++) {
      expect(aux![v * 4 + 1]).toBeCloseTo(position[v * 3 + 1]);
      expect(aux![v * 4 + 2]).toBe(0);
    }
  });
});
