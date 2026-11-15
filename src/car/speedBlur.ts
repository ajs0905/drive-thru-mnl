/**
 * How much speed blur to draw (scene/SpeedBlur.tsx): none until about 95 km/h, then
 * growing to its full strength at 130 km/h, just under the car's top speed. The strength
 * is how far toward the middle of the screen the blur reaches, as a share of a pixel's
 * distance from it.
 */
import { SEDAN } from './spec';

export const SPEED_BLUR = {
  /** Speeds (m/s) where the blur starts and where it's at full strength. */
  from: 95 / 3.6,
  full: Math.min(130 / 3.6, SEDAN.tuning.topSpeed),
  /**
   * Full strength. A streak at the edges, never a smear over the road ahead (0.045 at first:
   * on the screen that was a few pixels, too little to notice).
   */
  strength: 0.08,
  /** Screen area left sharp around the middle, and where the blur is at its full amount (distance from the middle, 1 = a screen corner). */
  clearRadius: 0.35,
  edgeRadius: 0.95,
  /** How quickly the drawn strength follows the speed (per second), so crashes don't flicker it. */
  rate: 3,
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Blur strength for a speed (m/s, either direction). */
export function speedBlurAmount(speed: number): number {
  return SPEED_BLUR.strength * smoothstep(SPEED_BLUR.from, SPEED_BLUR.full, Math.abs(speed));
}
