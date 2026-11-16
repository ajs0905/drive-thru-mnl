import { describe, expect, it } from 'vitest';
import type { Point, Ring } from '../map/types';
import {
  clipRingToHalfPlane,
  clipPolylineToRect,
  clipRingToRect,
  convexHull,
  clipSegmentToRect,
  distanceToRing,
  distanceToSegment,
  segmentDistance,
  segmentDistanceToRing,
  isCCW,
  pointInRing,
  polygonArea,
  ringArea,
  signedArea,
  simplifyPolyline,
  simplifyRing,
  vertexCentroid,
  withWinding,
} from './polygon';

const squareCCW: Ring = [[0, 0], [10, 0], [10, 10], [0, 10]];
const squareCW: Ring = [...squareCCW].reverse();
// An L shape (concave), CCW, area 75
const lShape: Ring = [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]];

describe('signedArea (shoelace)', () => {
  it('is positive for counter-clockwise rings', () => {
    expect(signedArea(squareCCW)).toBe(100);
  });

  it('is negative for clockwise rings', () => {
    expect(signedArea(squareCW)).toBe(-100);
  });

  it('handles concave shapes', () => {
    expect(signedArea(lShape)).toBe(75);
  });

  it('is zero for degenerate (collinear) rings', () => {
    expect(signedArea([[0, 0], [5, 0], [10, 0]])).toBe(0);
  });

  it('matches a known triangle', () => {
    expect(ringArea([[0, 0], [4, 0], [0, 3]])).toBe(6);
  });
});

describe('winding', () => {
  it('detects orientation', () => {
    expect(isCCW(squareCCW)).toBe(true);
    expect(isCCW(squareCW)).toBe(false);
  });

  it('reverses only when needed and never mutates the input', () => {
    const copy = squareCW.map((p) => [...p]);
    expect(isCCW(withWinding(squareCW, true))).toBe(true);
    expect(withWinding(squareCCW, true)).toBe(squareCCW);
    expect(squareCW).toEqual(copy);
  });
});

describe('polygonArea', () => {
  it('subtracts holes regardless of their winding', () => {
    const hole: Ring = [[2, 2], [4, 2], [4, 4], [2, 4]];
    expect(polygonArea([squareCCW, hole])).toBe(96);
    expect(polygonArea([squareCW, [...hole].reverse()])).toBe(96);
  });

  it('is zero for no rings', () => {
    expect(polygonArea([])).toBe(0);
  });
});

describe('pointInRing', () => {
  it('works for convex and concave shapes', () => {
    expect(pointInRing([5, 5], squareCCW)).toBe(true);
    expect(pointInRing([15, 5], squareCCW)).toBe(false);
    expect(pointInRing([2, 8], lShape)).toBe(true);
    expect(pointInRing([8, 8], lShape)).toBe(false); // the notch
  });

  it('does not care about winding', () => {
    expect(pointInRing([5, 5], squareCW)).toBe(true);
  });
});

describe('distances', () => {
  it('distanceToSegment clamps to the endpoints', () => {
    expect(distanceToSegment([5, 3], [0, 0], [10, 0])).toBe(3);
    expect(distanceToSegment([-3, 4], [0, 0], [10, 0])).toBe(5);
    expect(distanceToSegment([3, 4], [0, 0], [0, 0])).toBe(5); // zero-length segment
  });

  it('distanceToRing measures to the nearest edge, inside or outside', () => {
    expect(distanceToRing([5, 5], squareCCW)).toBe(5);
    expect(distanceToRing([13, 5], squareCCW)).toBe(3);
    expect(distanceToRing([13, 14], squareCCW)).toBe(5);
  });
});

describe('segment distances', () => {
  it('is 0 for crossing segments', () => {
    expect(segmentDistance([0, 0], [10, 10], [0, 10], [10, 0])).toBe(0);
  });

  it('measures parallel and separate segments', () => {
    expect(segmentDistance([0, 0], [10, 0], [0, 3], [10, 3])).toBe(3);
    expect(segmentDistance([0, 0], [1, 0], [4, 4], [5, 4])).toBe(5);
  });

  it('finds a long segment passing through a ring even with both ends far away', () => {
    expect(segmentDistanceToRing([-1000, 5], [1000, 5], squareCCW)).toBe(0);
    expect(segmentDistanceToRing([-1000, 15], [1000, 15], squareCCW)).toBe(5);
  });
});

describe('vertexCentroid', () => {
  it('averages vertices', () => {
    expect(vertexCentroid(squareCCW)).toEqual([5, 5]);
  });
});

describe('clipRingToRect (Sutherland-Hodgman)', () => {
  const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it('keeps a ring that is fully inside', () => {
    expect(ringArea(clipRingToRect(lShape, rect))).toBe(75);
  });

  it('cuts a ring that crosses the rectangle', () => {
    const big: Ring = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
    const clipped = clipRingToRect(big, rect);
    expect(ringArea(clipped)).toBeCloseTo(25, 9);
    for (const [x, y] of clipped) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns the rectangle for a ring that covers it completely', () => {
    const huge: Ring = [[-100, -100], [100, -100], [100, 100], [-100, 100]];
    expect(ringArea(clipRingToRect(huge, rect))).toBeCloseTo(100, 9);
  });

  it('returns [] for a ring fully outside', () => {
    expect(clipRingToRect([[20, 20], [30, 20], [30, 30]], rect)).toEqual([]);
  });

  it('keeps the winding of the input', () => {
    const big: Ring = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
    expect(isCCW(clipRingToRect(big, rect))).toBe(true);
    expect(isCCW(clipRingToRect([...big].reverse(), rect))).toBe(false);
  });
});

describe('clipSegmentToRect (Liang-Barsky)', () => {
  const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it('keeps a segment that is inside', () => {
    expect(clipSegmentToRect([1, 1], [9, 9], rect)).toEqual([[1, 1], [9, 9]]);
  });

  it('cuts a segment that passes through', () => {
    expect(clipSegmentToRect([-10, 5], [20, 5], rect)).toEqual([[0, 5], [10, 5]]);
  });

  it('returns null for a segment outside', () => {
    expect(clipSegmentToRect([-10, -5], [20, -5], rect)).toBeNull();
    expect(clipSegmentToRect([20, 0], [30, 10], rect)).toBeNull();
  });
});

describe('clipPolylineToRect', () => {
  const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it('trims the ends of a line that runs out of the box', () => {
    expect(clipPolylineToRect([[-5, 5], [5, 5], [15, 5]], rect)).toEqual([[[0, 5], [5, 5], [10, 5]]]);
  });

  it('splits a line that leaves and comes back', () => {
    const pieces = clipPolylineToRect([[2, 5], [20, 5], [20, 8], [2, 8]], rect);
    expect(pieces).toEqual([[[2, 5], [10, 5]], [[10, 8], [2, 8]]]);
  });

  it('returns nothing for a line fully outside', () => {
    expect(clipPolylineToRect([[20, 20], [30, 30]], rect)).toEqual([]);
  });
});

describe('convexHull', () => {
  it('wraps a point cloud counter-clockwise, dropping inner and collinear points', () => {
    const hull = convexHull([[0, 0], [5, 0], [10, 0], [10, 10], [0, 10], [5, 5], [2, 7]]);
    expect(hull).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(signedArea(hull)).toBeGreaterThan(0);
  });

  it('handles fewer than three points', () => {
    expect(convexHull([[1, 1], [0, 0]])).toEqual([[0, 0], [1, 1]]);
  });
});

describe('simplifyPolyline / simplifyRing (Ramer-Douglas-Peucker)', () => {
  it('drops points within the tolerance and keeps the corners', () => {
    const stairs: Point[] = [];
    for (let i = 0; i <= 10; i++) stairs.push([i, i % 2 ? 0.3 : 0]);
    stairs.push([10, 10]);
    expect(simplifyPolyline(stairs, 0.5)).toEqual([[0, 0], [10, 0], [10, 10]]);
    expect(simplifyPolyline(stairs, 0.1).length).toBeGreaterThan(3);
  });
  it('turns a traced staircase square into its four corners', () => {
    const ring: Ring = [];
    for (let x = 0; x < 10; x++) ring.push([x, 0]);
    for (let y = 0; y < 10; y++) ring.push([10, y]);
    for (let x = 10; x > 0; x--) ring.push([x, 10]);
    for (let y = 10; y > 0; y--) ring.push([0, y]);
    const out = simplifyRing(ring, 0.5);
    expect(out).toHaveLength(4);
    expect(new Set(out.map((p) => p.join(',')))).toEqual(new Set(['0,0', '10,0', '10,10', '0,10']));
  });
});

describe('clipRingToHalfPlane', () => {
  it('keeps the part of a ring on the normal side of the line, past the offset', () => {
    const sq: Ring = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const kept = clipRingToHalfPlane(sq, [0, 0], [0, 1], 4);
    expect(ringArea(kept)).toBeCloseTo(60);
    expect(Math.min(...kept.map((p) => p[1]))).toBeCloseTo(4);
    expect(clipRingToHalfPlane(sq, [0, 0], [0, 1], 20)).toHaveLength(0);
    expect(clipRingToHalfPlane(sq, [0, 0], [0, 1], -5)).toEqual(sq);
  });
});
