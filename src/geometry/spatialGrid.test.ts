import { describe, expect, it } from 'vitest';
import type { Point } from '../map/types';
import { SegmentGrid, segmentsCross } from './spatialGrid';

describe('SegmentGrid', () => {
  it('finds segments near a query and skips far ones', () => {
    const g = new SegmentGrid<string>(10);
    g.insert([0, 0], [5, 0], 'near');
    g.insert([500, 500], [505, 500], 'far');
    const hits = g.query([1, -1], [1, 1]).map((e) => e.item);
    expect(hits).toEqual(['near']);
  });

  it('finds long segments that span many cells', () => {
    const g = new SegmentGrid<string>(10);
    g.insert([-100, 0], [100, 0], 'long');
    expect(g.query([55, -1], [55, 1]).map((e) => e.item)).toEqual(['long']);
  });

  it('returns each segment once even if it shares several cells with the query', () => {
    const g = new SegmentGrid<number>(10);
    g.insert([0, 0], [30, 0], 1);
    expect(g.query([0, -1], [30, 1])).toHaveLength(1);
  });

  it('agrees with brute force on random segments', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 400;
    const segs: [Point, Point][] = Array.from({ length: 300 }, () => {
      const a: Point = [rand(), rand()];
      return [a, [a[0] + rand() / 10, a[1] + rand() / 10]];
    });
    const g = new SegmentGrid<number>(25);
    segs.forEach(([a, b], i) => g.insert(a, b, i));
    for (let i = 0; i < 50; i++) {
      const [a, b] = segs[i];
      const brute = segs.flatMap(([c, d], j) => (segmentsCross(a, b, c, d) ? [j] : [])).sort((x, y) => x - y);
      const grid = g
        .query(a, b)
        .filter((e) => segmentsCross(a, b, e.a, e.b))
        .map((e) => e.item)
        .sort((x, y) => x - y);
      expect(grid).toEqual(brute);
    }
  });

  it('rejects a bad cell size', () => {
    expect(() => new SegmentGrid(0)).toThrow(RangeError);
  });
});

describe('segmentsCross', () => {
  it('detects a proper crossing', () => {
    expect(segmentsCross([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
  });
  it('does not count touching at an end point (a junction)', () => {
    expect(segmentsCross([0, 0], [10, 0], [10, 0], [10, 10])).toBe(false);
  });
  it('does not count parallel segments', () => {
    expect(segmentsCross([0, 0], [10, 0], [0, 1], [10, 1])).toBe(false);
  });
});
