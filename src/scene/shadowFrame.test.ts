import { describe, expect, it } from 'vitest';
import { shadowHalfSize, snapToTexel } from './shadowFrame';

describe('shadowHalfSize', () => {
  it('grows with distance between sensible limits', () => {
    expect(shadowHalfSize(10)).toBe(120);
    expect(shadowHalfSize(500)).toBe(400);
    expect(shadowHalfSize(10000)).toBe(1400);
  });
});

describe('snapToTexel', () => {
  it('moves the shadow square in whole texels', () => {
    const texel = (2 * 100) / 1000; // 0.2 m
    const v = snapToTexel(12.345, 100, 1000);
    expect(v / texel).toBeCloseTo(Math.round(v / texel));
    expect(Math.abs(v - 12.345)).toBeLessThanOrEqual(texel / 2);
  });
});
