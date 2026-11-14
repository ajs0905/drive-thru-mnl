/**
 * Drift assist: help behind the scenes that makes drifts possible and controllable.
 *
 * Tire grip alone can't do it: Rapier's tires cancel sideways motion almost completely
 * every step, so even with nearly no rear grip the car only slid about 10 degrees.
 * Arcade games turn the car on purpose instead, and so does this:
 *
 * - A drift starts with the handbrake while steering, above walking pace. The handbrake
 *   breaks the rear tires loose instead of locking the wheels, so the car keeps its speed.
 * - While drifting, steering turns the car directly (`driftYaw`): hold it to swing the
 *   tail out, ease off or steer the other way to bring it back.
 * - Holding throttle keeps the rear loose (a power slide); lifting off lets grip come
 *   back over about half a second, so the car flows out instead of snapping straight.
 * - The front wheels steer a little into any slide on their own (countersteer).
 * - Past `maxDrift` the car's rotation is damped, so it holds its angle instead of
 *   spinning out.
 *
 * The car's frame: +x to its left, +z forward, +y up.
 */
import type { Tuning } from './spec';

export interface Vec {
  x: number;
  y: number;
  z: number;
}
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A world-space vector in the frame of a body with rotation `q` (rotated by the inverse of q). */
export function toLocal(v: Vec, q: Quat): Vec {
  // v' = q* v q, with q* the conjugate; written out as t = 2 (u x v), v' = v + w t + u x t for u = -q.xyz.
  const [ux, uy, uz] = [-q.x, -q.y, -q.z];
  const tx = 2 * (uy * v.z - uz * v.y);
  const ty = 2 * (uz * v.x - ux * v.z);
  const tz = 2 * (ux * v.y - uy * v.x);
  return {
    x: v.x + q.w * tx + (uy * tz - uz * ty),
    y: v.y + q.w * ty + (uz * tx - ux * tz),
    z: v.z + q.w * tz + (ux * ty - uy * tx),
  };
}

/** Below this speed (m/s) there's no meaningful slide. */
const SLIP_SPEED = 3;

/**
 * Slip angle (radians): how far the car's travel points away from where it faces.
 * Positive when it's moving toward its left. 0 when slow or reversing.
 */
export function slipAngle(lateral: number, forward: number): number {
  if (forward < SLIP_SPEED) return 0;
  return Math.atan2(lateral, forward);
}

/** Above this forward speed (m/s) the handbrake and steering start a drift; below DRIFT_END_SPEED it ends. */
export const DRIFT_START_SPEED = 8;
const DRIFT_END_SPEED = 4;

/**
 * Whether the car is drifting after this step: starts with the handbrake while steering
 * at speed; ends once the handbrake is off and the car has straightened out (or slowed down).
 */
export function nextDrifting(drifting: boolean, handbrake: boolean, steer: number, speed: number, slip: number): boolean {
  if (speed < DRIFT_END_SPEED) return false;
  if (handbrake && steer !== 0 && speed > DRIFT_START_SPEED) return true;
  return drifting && (handbrake || Math.abs(slip) > 0.06);
}

/**
 * Rear grip, 0 (fully loose) to 1 (normal), for the next step. The handbrake drops it
 * to 0; afterwards it recovers at `gripRecover` per second, but only up to `sustainGrip`
 * while the player holds throttle in a drift.
 */
export function nextRearGrip(grip: number, handbrake: boolean, throttle: number, drifting: boolean, dt: number, t: Tuning): number {
  if (handbrake) return 0;
  // In a power slide grip stops coming back at sustainGrip (it's never taken away by it).
  const cap = drifting && throttle > 0 ? Math.max(t.sustainGrip, grip) : 1;
  return Math.min(cap, grip + t.gripRecover * dt);
}

/** Sideways stiffness of the rear tires for a rear grip value (comes back slowly at first, then quickly). */
export function rearSideFriction(grip: number, t: Tuning): number {
  const g = clamp(grip, 0, 1);
  return t.driftSideFriction + (t.sideFriction - t.driftSideFriction) * g * g;
}

/** Turn added while drifting (rad/s, per second), from the steering input (-1..1, positive left). */
export function driftTurn(steerInput: number, drifting: boolean, t: Tuning): number {
  return drifting ? clamp(steerInput, -1, 1) * t.driftYaw : 0;
}

/** Extra front wheel angle that steers into a slide (radians, same sign as the slip). */
export function countersteer(slip: number, t: Tuning): number {
  return clamp(slip * t.countersteer, -t.maxSteer, t.maxSteer);
}

/**
 * Change in rotation speed around the vertical (rad/s, per second) that stops a spin:
 * only when the car is past `maxDrift` and still turning further into the slide.
 * A positive slip (moving toward its left) grows when the car turns right (negative yaw rate).
 */
export function antiSpin(slip: number, yawRate: number, t: Tuning): number {
  const excess = Math.abs(slip) - t.maxDrift;
  if (excess <= 0 || slip * yawRate >= 0) return 0;
  return -yawRate * t.antiSpin * clamp(excess / 0.3, 0, 1);
}

/**
 * Push (m/s^2) along the direction of travel while drifting on throttle, fading out
 * toward top speed: tires scrubbing sideways would otherwise bleed most of the speed.
 */
export function driftPush(drifting: boolean, throttle: number, speed: number, t: Tuning): number {
  if (!drifting || throttle <= 0) return 0;
  return t.driftPush * throttle * clamp(1 - speed / (t.topSpeed * 0.8), 0, 1);
}
