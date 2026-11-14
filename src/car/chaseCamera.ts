/**
 * Chase camera: behind and above the car, looking a little ahead of it. The camera's
 * direction trails the car's (it swings around in corners instead of being bolted on),
 * but its position is always computed from where the car is now, so it never falls
 * behind at speed. It pulls back a little as the car speeds up, for a sense of speed.
 * Three.js space throughout (y up).
 */
export type Vec3 = [number, number, number];

export interface ChaseView {
  position: Vec3;
  lookAt: Vec3;
}

export const CHASE = {
  /** Distance behind the car and height above it at a standstill. */
  distance: 6.2,
  height: 2.4,
  /** Extra distance and height per m/s of speed, up to `maxSpeed`. */
  distancePerSpeed: 0.05,
  heightPerSpeed: 0.012,
  maxSpeed: 50,
  /** How far ahead of the car and how high it looks. */
  lookAhead: 3,
  lookHeight: 1.1,
  /** How quickly the camera's direction follows the car's (per second; higher is stiffer). */
  turnRate: 4,
};

/** Share of the way to move toward a goal this frame, for exponential smoothing at any frame rate. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * Math.max(0, dt));
}

/** Camera position and look-at point for a car at `car`, facing the ground direction (fx, fz), at a speed (m/s). */
export function chaseView(car: Vec3, fx: number, fz: number, speed: number): ChaseView {
  const len = Math.hypot(fx, fz) || 1;
  const [dx, dz] = [fx / len, fz / len];
  const s = Math.min(Math.abs(speed), CHASE.maxSpeed);
  const back = CHASE.distance + CHASE.distancePerSpeed * s;
  const up = CHASE.height + CHASE.heightPerSpeed * s;
  return {
    position: [car[0] - dx * back, car[1] + up, car[2] - dz * back],
    lookAt: [car[0] + dx * CHASE.lookAhead, car[1] + CHASE.lookHeight, car[2] + dz * CHASE.lookAhead],
  };
}

/**
 * Turns the camera's ground direction toward the car's by `t` (0..1), along the shorter
 * way round. Returns a unit vector; keeps the old one if the car points straight up or down.
 */
export function turnToward(cur: [number, number], goal: [number, number], t: number): [number, number] {
  const gl = Math.hypot(goal[0], goal[1]);
  if (gl < 1e-3) return cur;
  const a = Math.atan2(cur[1], cur[0]);
  const b = Math.atan2(goal[1], goal[0]);
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const r = a + d * Math.max(0, Math.min(1, t));
  return [Math.cos(r), Math.sin(r)];
}
