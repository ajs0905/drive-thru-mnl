import { describe, expect, it } from 'vitest';
import { SPEED_BLUR, speedBlurAmount } from './speedBlur';

describe('speedBlurAmount', () => {
  it('is zero in city traffic speeds, up to about 95 km/h', () => {
    expect(speedBlurAmount(0)).toBe(0);
    expect(speedBlurAmount(60 / 3.6)).toBe(0);
    expect(speedBlurAmount(SPEED_BLUR.from)).toBe(0);
  });

  it('grows with speed to its full strength near top speed, and no further', () => {
    const mid = speedBlurAmount((SPEED_BLUR.from + SPEED_BLUR.full) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(SPEED_BLUR.strength);
    expect(speedBlurAmount(SPEED_BLUR.full)).toBeCloseTo(SPEED_BLUR.strength);
    expect(speedBlurAmount(SPEED_BLUR.full * 2)).toBeCloseTo(SPEED_BLUR.strength);
  });

  it('is the same going backwards', () => {
    expect(speedBlurAmount(-35)).toBe(speedBlurAmount(35));
  });
});
