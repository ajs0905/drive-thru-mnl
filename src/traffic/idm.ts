/**
 * The Intelligent Driver Model (Treiber, Hennecke and Helbing, 2000): how hard a car
 * accelerates or brakes given its speed, the speed it wants, and the gap to the car (or
 * stop line) ahead and how fast it's closing. Collision-free in steady traffic, smooth,
 * and three lines of math: the standard model of car-following in traffic simulation.
 *
 *   a = a_max * (1 - (v / v0)^4 - (s* / gap)^2)
 *   s* = s0 + v T + v dv / (2 sqrt(a_max b))
 *
 * s0 is the gap kept standing still, T the time headway, b a comfortable braking rate,
 * dv the closing speed (positive when catching up).
 */
export const IDM = {
  /** Comfortable acceleration and braking (m/s^2). */
  accel: 1.6,
  brake: 2.5,
  /** Standing gap (m) and time headway (s). */
  s0: 2.2,
  T: 1.2,
  /** Never brake harder than this (m/s^2), whatever the model says (it can ask for more in an emergency). */
  maxBrake: 8,
};

/** Acceleration (m/s^2) for speed v wanting v0, with a leader `gap` meters ahead (bumper to bumper) at speed `lead`; no leader: gap Infinity. */
export function idmAccel(v: number, v0: number, gap: number, lead: number): number {
  const free = 1 - (v / Math.max(0.1, v0)) ** 4;
  if (!Number.isFinite(gap)) return Math.max(-IDM.maxBrake, IDM.accel * free);
  const dv = v - lead;
  const want = IDM.s0 + Math.max(0, v * IDM.T + (v * dv) / (2 * Math.sqrt(IDM.accel * IDM.brake)));
  const a = IDM.accel * (free - (want / Math.max(0.1, gap)) ** 2);
  return Math.max(-IDM.maxBrake, a);
}
