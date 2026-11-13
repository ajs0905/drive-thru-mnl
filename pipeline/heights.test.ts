import { describe, expect, it } from 'vitest';
import { estimateHeight, heightFromFootprint, idUnit, LEVEL_HEIGHT, MIN_HEIGHT } from './heights';

const base = { id: 'way/1', type: 'yes', footprint: 500 };

describe('estimateHeight', () => {
  it('uses the height tag first', () => {
    expect(estimateHeight({ ...base, height: 120, levels: 10 })).toEqual({ h: 120, hSrc: 'tag' });
  });

  it('uses levels when there is no height tag', () => {
    expect(estimateHeight({ ...base, levels: 10 })).toEqual({ h: 10 * LEVEL_HEIGHT, hSrc: 'levels' });
  });

  it('never goes below the minimum, even with tags', () => {
    expect(estimateHeight({ ...base, height: 1 }).h).toBe(MIN_HEIGHT);
  });

  it('uses a typical height for known types', () => {
    const house = estimateHeight({ ...base, type: 'house', footprint: 5000 });
    expect(house.hSrc).toBe('estimate');
    expect(house.h).toBeGreaterThanOrEqual(6 * 0.8);
    expect(house.h).toBeLessThanOrEqual(6 * 1.2);
  });

  it('falls back to footprint for generic buildings', () => {
    const r = estimateHeight({ ...base, type: 'yes', footprint: 1000 });
    expect(r.h).toBeGreaterThanOrEqual(45 * 0.8);
    expect(r.h).toBeLessThanOrEqual(45 * 1.2);
  });

  it('caps retail so malls stay wide and low', () => {
    const r = estimateHeight({ ...base, type: 'retail', footprint: 3000 });
    expect(r.h).toBeLessThanOrEqual(30 * 1.2);
  });

  it('is deterministic for the same id', () => {
    const a = estimateHeight({ ...base, id: 'way/42' });
    const b = estimateHeight({ ...base, id: 'way/42' });
    expect(a).toEqual(b);
  });

  it('varies between ids within +/-20%', () => {
    const hs = Array.from({ length: 200 }, (_, i) => estimateHeight({ ...base, id: `way/${i}` }).h);
    expect(Math.min(...hs)).toBeGreaterThanOrEqual(15 * 0.8);
    expect(Math.max(...hs)).toBeLessThanOrEqual(15 * 1.2);
    expect(new Set(hs).size).toBeGreaterThan(20);
  });
});

describe('heightFromFootprint', () => {
  it('goes up with footprint, then drops for huge podiums', () => {
    expect(heightFromFootprint(50)).toBeLessThan(heightFromFootprint(200));
    expect(heightFromFootprint(200)).toBeLessThan(heightFromFootprint(1000));
    expect(heightFromFootprint(1000)).toBeLessThan(heightFromFootprint(2500));
    expect(heightFromFootprint(10000)).toBeLessThan(heightFromFootprint(2500));
  });

  it('handles junk areas', () => {
    expect(heightFromFootprint(0)).toBeGreaterThanOrEqual(MIN_HEIGHT);
    expect(heightFromFootprint(NaN)).toBeGreaterThanOrEqual(MIN_HEIGHT);
  });
});

describe('idUnit', () => {
  it('stays in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const u = idUnit(`relation/${i}#${i % 3}`);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});
