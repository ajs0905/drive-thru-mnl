import { describe, expect, it } from 'vitest';
import { dprFor, guessQuality, nextFactor, QUALITY } from './quality';

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
    expect(low.msaa).toBe(false);
    expect(low.propsDistance).toBeLessThanOrEqual(medium.propsDistance);
    expect(medium.propsDistance).toBeLessThanOrEqual(high.propsDistance);
    expect(low.treeDistance).toBeLessThanOrEqual(medium.treeDistance);
    expect(medium.treeDistance).toBeLessThanOrEqual(high.treeDistance);
  });
});

describe('dprFor', () => {
  it('scales within the range and never above the screen', () => {
    expect(dprFor([1, 1.5], 1, 2)).toBe(1.5);
    expect(dprFor([1, 1.5], 0, 2)).toBe(1);
    expect(dprFor([1, 1.5], 0.5, 2)).toBe(1.25);
    expect(dprFor([1, 1.5], 1, 1)).toBe(1); // a plain 1x screen
    expect(dprFor([0.6, 1], 3, 1)).toBe(1);
  });
});

describe('nextFactor', () => {
  it('steps down on slow frames, up with headroom, and holds in between', () => {
    expect(nextFactor(1, 30)).toBe(0.8);
    expect(nextFactor(0.1, 30)).toBe(0);
    expect(nextFactor(0.5, 120)).toBe(0.6);
    expect(nextFactor(1, 144)).toBe(1);
    expect(nextFactor(0.7, 50)).toBe(0.7);
  });
});
