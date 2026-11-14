import { describe, expect, it } from 'vitest';
import type { Point } from '../map/types';
import { isPlainContinuation, junctionShape, lineIntersection, selfIntersects, type Arm } from './junction';
import { pointInRing, ringArea, signedArea } from './polygon';

const arm = (deg: number, half = 4, len = 100): Arm => {
  const r = (deg * Math.PI) / 180;
  return { dir: [Math.cos(r), Math.sin(r)], half, len };
};
const O: Point = [0, 0];

describe('lineIntersection', () => {
  it('finds where two lines meet', () => {
    const hit = lineIntersection([0, 0], [1, 0], [5, -5], [0, 1])!;
    expect(hit[0]).toBeCloseTo(5);
    expect(hit[1]).toBeCloseTo(5);
  });

  it('returns null for parallel lines', () => {
    expect(lineIntersection([0, 0], [1, 0], [0, 1], [1, 0])).toBeNull();
  });
});

describe('junctionShape', () => {
  it('makes a square for a 4-way crossing of equal roads', () => {
    const s = junctionShape(O, [arm(0), arm(90), arm(180), arm(270)])!;
    expect(s.cuts.map((c) => +c.toFixed(6))).toEqual([4, 4, 4, 4]);
    expect(ringArea(s.ring)).toBeCloseTo(64, 6); // 8 x 8
    expect(signedArea(s.ring)).toBeGreaterThan(0);
  });

  it('cuts the through road back by the side road half-width at a T', () => {
    // Main road (8 m wide) east-west, side road (6 m wide) to the north.
    const s = junctionShape(O, [arm(0, 4), arm(180, 4), arm(90, 3)])!;
    expect(s.cuts[0]).toBeCloseTo(3); // main road east arm: cut to the side road's edge
    expect(s.cuts[1]).toBeCloseTo(3);
    expect(s.cuts[2]).toBeCloseTo(4); // side road: cut to the main road's edge
    expect(pointInRing([0, 0], s.ring)).toBe(true);
  });

  it('fills the outside of a bend with a straight edge', () => {
    const s = junctionShape(O, [arm(0), arm(120)])!;
    expect(s).not.toBeNull();
    expect(s.cuts.every((c) => c > 0)).toBe(true);
    expect(selfIntersects(s.ring)).toBe(false);
    expect(pointInRing([-1, -1], s.ring)).toBe(true); // the outer wedge is covered
  });

  it('handles a Y split and stays a simple polygon', () => {
    const s = junctionShape(O, [arm(180, 5), arm(20, 3.5), arm(-20, 3.5)])!;
    expect(s).not.toBeNull();
    expect(selfIntersects(s.ring)).toBe(false);
  });

  it('needs no polygon when a road splits almost straight into two (they just overlap)', () => {
    expect(junctionShape(O, [arm(180, 4), arm(3, 4), arm(-3, 4)])).toBeNull();
  });

  it('wraps around two arms that overlap in a sharp merge instead of zig-zagging', () => {
    const s = junctionShape(O, [arm(180, 4), arm(15, 4), arm(-15, 4), arm(90, 3)])!;
    expect(s).not.toBeNull();
    expect(selfIntersects(s.ring)).toBe(false);
    for (const c of s.cuts) expect(c).toBeLessThanOrEqual(2.5 * 4 + 1e-9);
  });

  it('never cuts past the far end of a short arm', () => {
    const s = junctionShape(O, [arm(0, 4, 3), arm(90), arm(180), arm(270)])!;
    expect(s.cuts[0]).toBeLessThanOrEqual(3);
  });

  it('tapers a straight join where the road changes width', () => {
    const s = junctionShape(O, [arm(0, 4), arm(180, 3)])!;
    expect(s).not.toBeNull();
    expect(s.cuts[0]).toBeCloseTo(1);
    expect(s.cuts[1]).toBeCloseTo(3); // the narrow side takes the longer taper
    expect(ringArea(s.ring)).toBeCloseTo(((8 + 6) / 2) * 4, 6);
  });

  it('handles a wide road meeting a narrow one at a shallow bend', () => {
    // the inner corner sits a little behind the center on the wide road
    const s = junctionShape(O, [arm(0, 6.9), arm(140, 2.5)])!;
    expect(s).not.toBeNull();
    expect(selfIntersects(s.ring)).toBe(false);
  });

  it('keeps the caps of a T where the side road is short', () => {
    const s = junctionShape(O, [arm(0, 5), arm(180, 5, 8), arm(-90, 1.25, 6)])!;
    expect(s).not.toBeNull();
    expect(s.cuts[2]).toBeCloseTo(5);
  });

  it('returns null for fewer than two arms', () => {
    expect(junctionShape(O, [arm(0)])).toBeNull();
  });

  it('returns cuts in the same order as the input arms', () => {
    const s = junctionShape(O, [arm(270, 2), arm(0, 6), arm(90, 2), arm(180, 6)])!;
    expect(s.cuts[1]).toBeCloseTo(2); // wide road cut back by the narrow road's half width
    expect(s.cuts[0]).toBeCloseTo(6); // narrow road cut back by the wide road's half width
  });
});

describe('isPlainContinuation', () => {
  it('is true for a straight join of equal widths', () => {
    expect(isPlainContinuation([arm(0), arm(180)])).toBe(true);
    expect(isPlainContinuation([arm(0), arm(185)])).toBe(true);
  });

  it('is false for a bend, a width change or a real junction', () => {
    expect(isPlainContinuation([arm(0), arm(150)])).toBe(false);
    expect(isPlainContinuation([arm(0, 4), arm(180, 3)])).toBe(false);
    expect(isPlainContinuation([arm(0), arm(90), arm(180)])).toBe(false);
  });
});

describe('selfIntersects', () => {
  it('detects a bow tie', () => {
    expect(selfIntersects([[0, 0], [10, 10], [10, 0], [0, 10]])).toBe(true);
    expect(selfIntersects([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(false);
  });
});
