import { describe, expect, it } from 'vitest';
import { toSegmentPositions } from './segments';
import type { Point } from './types';

describe('toSegmentPositions', () => {
  it('makes n-1 segments for an open polyline', () => {
    const line: Point[] = [[0, 0], [10, 0], [10, 10]];
    const out = toSegmentPositions([line], false);
    expect(out.length).toBe(2 * 6);
  });

  it('adds a closing segment for rings', () => {
    const ring: Point[] = [[0, 0], [10, 0], [10, 10]];
    const out = toSegmentPositions([ring], true);
    expect(out.length).toBe(3 * 6);
    // last segment goes from the last point back to the first
    expect(Array.from(out.slice(12))).toEqual([10, 0, -10, 0, 0, -0]);
  });

  it('maps north (+y) to -z and applies the height', () => {
    const out = toSegmentPositions([[[1, 2], [3, 4]]], false, 0.5);
    expect(Array.from(out)).toEqual([1, 0.5, -2, 3, 0.5, -4]);
  });

  it('packs multiple lines into one buffer', () => {
    const out = toSegmentPositions([[[0, 0], [1, 0]], [[5, 5], [6, 5], [7, 5]]], false);
    expect(out.length).toBe(3 * 6);
  });

  it('ignores lines with fewer than 2 points', () => {
    expect(toSegmentPositions([[], [[1, 1]]], true).length).toBe(0);
  });
});
