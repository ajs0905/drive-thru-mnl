import { describe, expect, it } from 'vitest';
import { normalBiasFor, shadowHalfSize, snapToTexel } from './shadowFrame';

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

describe('normalBiasFor', () => {
  it('is a texel and a half up close, within 0.15 to 0.5 m', () => {
    // Driving: a 240 m square on a 2048 map is 0.117 m a texel.
    expect(normalBiasFor(120, 2048)).toBeCloseTo(0.176, 3);
    expect(normalBiasFor(120, 1024)).toBeCloseTo(0.352, 3);
    expect(normalBiasFor(1400, 2048)).toBe(0.5);
    expect(normalBiasFor(10, 4096)).toBe(0.15);
  });
});
