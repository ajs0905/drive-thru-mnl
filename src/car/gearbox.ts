/**
 * Automatic gearbox, kept out of sight (no gear display): it decides when the car
 * shifts, so each upshift can have a kick (a short drop in drive, which makes the body
 * dip and the camera nudge), and so engine sounds can follow gears later.
 *
 * Shifts up past each gear's speed and back down a little below it (the gap stops it
 * from hunting between two gears). Reverse is gear -1.
 */
import type { Tuning } from './spec';

export interface Gearbox {
  /** 1, 2, 3... forward; -1 reverse. */
  gear: number;
  /** Seconds left of the drive drop from the last upshift. */
  shifting: number;
  /** Upshifts so far, so the renderer can notice one even between frames. */
  upshifts: number;
}

export const NEW_GEARBOX: Gearbox = { gear: 1, shifting: 0, upshifts: 0 };

/** The gearbox after one step at a forward speed (m/s). */
export function stepGearbox(g: Gearbox, speed: number, dt: number, t: Tuning): Gearbox {
  const shifting = Math.max(0, g.shifting - dt);
  if (speed < -0.5) return { ...g, gear: -1, shifting: 0 };
  let gear = g.gear < 1 ? 1 : g.gear;
  const top = t.upshift.length + 1;
  if (gear < top && speed > t.upshift[gear - 1]) {
    return { gear: gear + 1, shifting: t.shiftTime, upshifts: g.upshifts + 1 };
  }
  if (gear > 1 && speed < t.upshift[gear - 2] - t.downshiftGap) gear--;
  return { ...g, gear, shifting };
}

/** Share of engine drive available: reduced briefly during an upshift. */
export function driveShare(g: Gearbox, t: Tuning): number {
  return g.shifting > 0 ? t.shiftDrive : 1;
}
