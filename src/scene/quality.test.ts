import { describe, expect, it } from 'vitest';
import { guessQuality, QUALITY } from './quality';

describe('guessQuality', () => {
  it('starts phones on low, small machines on medium, the rest on high', () => {
    expect(guessQuality({ coarsePointer: true, memoryGb: 8, cores: 8 })).toBe('low');
    expect(guessQuality({ coarsePointer: false, memoryGb: 4, cores: 8 })).toBe('medium');
    expect(guessQuality({ coarsePointer: false, cores: 4 })).toBe('medium');
    expect(guessQuality({ coarsePointer: false, memoryGb: 16, cores: 12 })).toBe('high');
    expect(guessQuality({ coarsePointer: false })).toBe('high');
  });
});

describe('QUALITY', () => {
  it('only adds cost going up the tiers', () => {
    const [low, medium, high] = [QUALITY.low, QUALITY.medium, QUALITY.high];
    expect(low.shadowMap).toBeLessThanOrEqual(medium.shadowMap);
    expect(medium.shadowMap).toBeLessThanOrEqual(high.shadowMap);
    expect(low.dpr[1]).toBeLessThanOrEqual(medium.dpr[1]);
    expect(medium.dpr[1]).toBeLessThanOrEqual(high.dpr[1]);
    expect(low.post).toBe(false);
  });
});
