import { describe, expect, it } from 'vitest';
import { convexOverlap, zebraCorners } from './zebra';

describe('zebraCorners', () => {
  it('spans the road short of its edges and the band width along it', () => {
    expect(zebraCorners({ c: [0, 0], dir: [1, 0], half: 5, w: 3 })).toEqual([[-1.5, -4.5], [1.5, -4.5], [1.5, 4.5], [-1.5, 4.5]]);
  });
});

describe('convexOverlap', () => {
  const sq = (x: number, y: number, s = 2): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
  it('detects overlapping squares and separated ones', () => {
    expect(convexOverlap(sq(0, 0), sq(1, 1))).toBe(true);
    expect(convexOverlap(sq(0, 0), sq(3, 0))).toBe(false);
  });
  it('does not count touching edges', () => {
    expect(convexOverlap(sq(0, 0), sq(2, 0))).toBe(false);
  });
  it('finds a separating axis on a rotated shape', () => {
    const diamond: [number, number][] = [[4, 2.9], [5.1, 4], [4, 5.1], [2.9, 4]];
    expect(convexOverlap(sq(0, 0), diamond)).toBe(false);
  });
});
