import { describe, expect, it } from 'vitest';
import type { Point, Road } from '../src/map/types';
import { closeMedianGaps } from './medians';

const road = (id: string, points: Point[], w: number, extra: Partial<Road> = {}): Road => ({
  id, highway: 'primary', cls: 'major', w, points, oneway: true, ...extra,
});

describe('closeMedianGaps', () => {
  it('widens two carriageways that almost touch so they meet', () => {
    // centerlines 8 m apart, 7 m wide each: a 1 m sliver between them
    const north = road('n', [[0, 4], [100, 4]], 7);
    const south = road('s', [[100, -4], [0, -4]], 7);
    const { roads, stats } = closeMedianGaps([north, south]);
    expect(stats.widened).toBe(2);
    expect(roads.map((r) => r.w)).toEqual([8, 8]); // edges now at y = 0 from both sides
  });

  it('leaves a real median alone', () => {
    const north = road('n', [[0, 6], [100, 6]], 7);
    const south = road('s', [[100, -6], [0, -6]], 7); // 5 m median
    expect(closeMedianGaps([north, south]).stats.widened).toBe(0);
  });

  it('ignores roads that only cross or touch briefly', () => {
    const a = road('a', [[0, 0], [100, 0]], 7);
    const b = road('b', [[50, -50], [50, 50]], 7);
    expect(closeMedianGaps([a, b]).stats.widened).toBe(0);
  });

  it('does not widen a road next to a flyover deck', () => {
    const ground = road('g', [[0, 4], [100, 4]], 7);
    const deck = road('d', [[100, -4], [0, -4]], 7, { z: [7, 7] });
    expect(closeMedianGaps([ground, deck]).stats.widened).toBe(0);
  });
});
