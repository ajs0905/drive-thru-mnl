import { describe, expect, it } from 'vitest';
import { SKY } from './skyConfig';

describe('SKY', () => {
  it('has the sun above the horizon', () => {
    expect(SKY.sunDir.length()).toBeCloseTo(1);
    expect(SKY.sunDir.y).toBeGreaterThan(0.3);
  });

  it('keeps cloud coverage and density in the shader range', () => {
    for (const v of [SKY.clouds.coverage, SKY.clouds.density, SKY.clouds.elevation]) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });
});
