/**
 * Chase camera: behind and above the car, looking a little ahead of it. The camera's
 * direction trails the car's (it swings around in corners instead of being bolted on),
 * but its position is always computed from where the car is now, so it never falls
 * behind at speed. It pulls back a little as the car speeds up, for a sense of speed.
 *
 * It also reacts, subtly, to how hard the car speeds up or slows down: it hangs back up
 * to about a meter under full throttle and eases in about a meter under hard braking,
 * and the view widens a few degrees at speed. That makes acceleration, braking and
 * gear shifts readable on screen.
 *
 * Crashes stop the car in a fraction of a second, which would yank all of that at once
 * (the camera jumped about 2 m in and zoomed in a 79 km/h crash). So the camera follows
 * a smoothed speed, reads at most hard braking's worth of deceleration, and shows a
 * crash with a short shake instead. Three.js space throughout (y up).
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
  distancePerSpeed: 0.065,
  heightPerSpeed: 0.016,
  maxSpeed: 38,
  /** How far ahead of the car and how high it looks. */
  lookAhead: 3,
  lookHeight: 1.1,
  /** How quickly the camera's direction follows the car's (per second; higher is stiffer). */
  turnRate: 4,
  /** Extra distance per m/s^2 of forward acceleration, capped: back when speeding up, in when braking. */
  pullPerAccel: 0.13,
  maxPullBack: 0.8,
  maxPullIn: 1.0,
  /** How quickly the pull follows the acceleration (per second). */
  pullRate: 3,
  /** Most acceleration the pull reads (m/s^2): about hard braking; a crash counts as no more than that. */
  maxAccel: 12,
  /** How quickly the speed the camera uses (distance, field of view) follows the car's (per second). */
  speedRate: 2,
  /** Crash shake: how far the camera jolts (m) at full strength, how fast it dies out (per second), and the speed change (m/s) of a full-strength crash. */
  shake: 0.16,
  shakeDecay: 7,
  shakeImpact: 15,
  /** Field of view (degrees) at a standstill, and how much it widens per m/s up to `maxSpeed`. */
  fov: 50,
  fovPerSpeed: 0.18,
  /**
   * When a wall is between the car and the camera, the camera moves in front of it:
   * `clipMargin` meters short of the wall, never closer than `minDistance` to the car,
   * snapping in at once and easing back out at `clipRelease` per second.
   */
  clipMargin: 0.4,
  minDistance: 1.5,
  clipRelease: 3,
  /**
   * Pressed in closer than `liftFrom` meters (backing up to a wall), the camera rises
   * `liftPerMeter` for every meter closer, so it looks down over the roof instead of
   * ending up inside the car's body (which is behind the roof line up to about 2.3 m).
   */
  liftFrom: 3,
  liftPerMeter: 0.9,
  /** The camera's view line starts this high above the car's base (about its roof). */
  focusHeight: 1.3,
};

/**
 * How far along the line from the car to the camera the camera goes this frame: all the
 * way (`full`) when nothing is in between, else just in front of the wall at `hit`.
 * Moves in at once (never shows the inside of a wall) and back out smoothly.
 */
export function clipDistance(current: number, hit: number | null, full: number, dt: number): number {
  const goal = hit === null ? full : Math.min(full, Math.max(CHASE.minDistance, hit - CHASE.clipMargin));
  if (goal <= current) return goal;
  return Math.min(goal, current + (goal - current) * damp(CHASE.clipRelease, dt));
}

/** How much higher the camera goes (m) when a wall has pressed it in to `clip` meters from the car's roof. */
export function compressedLift(clip: number): number {
  return Math.max(0, CHASE.liftFrom - clip) * CHASE.liftPerMeter;
}

/** Extra distance behind the car (m) for its forward acceleration (m/s^2): positive is farther. */
export function cameraPull(forwardAccel: number): number {
  const a = Math.max(-CHASE.maxAccel, Math.min(CHASE.maxAccel, forwardAccel));
  return Math.max(-CHASE.maxPullIn, Math.min(CHASE.maxPullBack, a * CHASE.pullPerAccel));
}

/** Shake strength (0..1) for a crash that changed the car's speed by `dv` m/s. */
export function crashShake(dv: number): number {
  return Math.min(1, Math.max(0, dv / CHASE.shakeImpact));
}

/** Camera jolt (m: sideways, up) for a shake strength at a time (s): a quick, uneven wobble. */
export function shakeOffset(strength: number, time: number): [number, number] {
  const a = strength * CHASE.shake;
  if (a === 0) return [0, 0];
  return [
    a * (0.7 * Math.sin(time * 41) + 0.3 * Math.sin(time * 67 + 1.3)),
    a * (0.7 * Math.sin(time * 53 + 0.7) + 0.3 * Math.sin(time * 79)),
  ];
}

/** Field of view (degrees) at a speed. */
export function speedFov(speed: number): number {
  return CHASE.fov + Math.min(Math.abs(speed), CHASE.maxSpeed) * CHASE.fovPerSpeed;
}

/** Share of the way to move toward a goal this frame, for exponential smoothing at any frame rate. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * Math.max(0, dt));
}

/**
 * Camera position and look-at point for a car at `car`, facing the ground direction
 * (fx, fz), at a speed (m/s), with `pull` meters of extra distance (see cameraPull).
 */
export function chaseView(car: Vec3, fx: number, fz: number, speed: number, pull = 0): ChaseView {
  const len = Math.hypot(fx, fz) || 1;
  const [dx, dz] = [fx / len, fz / len];
  const s = Math.min(Math.abs(speed), CHASE.maxSpeed);
  const back = CHASE.distance + CHASE.distancePerSpeed * s + pull;
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
