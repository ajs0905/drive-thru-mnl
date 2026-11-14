/**
 * Arcade handling: turns what the player presses into what the wheels do. Pure functions,
 * so the feel can be unit tested and tuned without a browser.
 *
 * - One pedal for brake and reverse: holding brake slows the car, and once it's
 *   (nearly) stopped the same key reverses, as in most arcade racers.
 * - Steering lock falls off with speed, and the wheels turn toward the input at a
 *   limited rate (faster back to center), so a keyboard tap doesn't jerk the car.
 * - Engine force fades out toward the top speed instead of cutting off.
 * - The handbrake locks the rear wheels and drops their sideways grip: a drift.
 */
import type { Tuning } from './spec';

export interface DriveKeys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
}

export interface DriveInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1..1, positive steers left. */
  steer: number;
  handbrake: boolean;
}

export interface DriveCommand {
  /** Force on each rear wheel (N), positive forward. */
  engine: number;
  /** Brake impulse on each front and each rear wheel. */
  brakeFront: number;
  brakeRear: number;
  /** Front wheel angle (radians), positive left. */
  steer: number;
  /** Sideways grip of the rear tires. */
  rearSideFriction: number;
}

export const NO_KEYS: DriveKeys = { up: false, down: false, left: false, right: false, handbrake: false };

/** Keyboard code -> the control it drives (WASD and the arrow keys, space for the handbrake). */
export const KEY_BINDINGS: Record<string, keyof DriveKeys> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'handbrake',
};

export function inputFromKeys(k: DriveKeys): DriveInput {
  return {
    throttle: k.up ? 1 : 0,
    brake: k.down ? 1 : 0,
    steer: (k.left ? 1 : 0) - (k.right ? 1 : 0),
    handbrake: k.handbrake,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Steering lock at a forward speed (m/s): full when slow, down to `minSteer` at top speed. */
export function maxSteer(speed: number, t: Tuning): number {
  const f = clamp(Math.abs(speed) / t.topSpeed, 0, 1);
  return t.maxSteer + (t.minSteer - t.maxSteer) * Math.sqrt(f);
}

/** Moves the wheel angle toward what the input asks for, at a limited rate. */
export function nextSteer(current: number, input: number, speed: number, dt: number, t: Tuning): number {
  const goal = clamp(input, -1, 1) * maxSteer(speed, t);
  const returning = Math.abs(goal) < Math.abs(current) || goal * current < 0;
  const step = (returning ? t.steerReturn : t.steerRate) * dt;
  return current + clamp(goal - current, -step, step);
}

/** What the wheels should do this step, for an input, the car's forward speed (m/s) and its current wheel angle. */
export function driveCommand(input: DriveInput, speed: number, steer: number, t: Tuning): DriveCommand {
  let engine = 0;
  let brake = 0;
  if (input.throttle > 0) {
    if (speed < -0.5) brake = input.throttle * t.brake; // rolling backward: throttle brakes first
    else engine = (input.throttle * t.engineForce * clamp(1 - (speed / t.topSpeed) ** 2, 0, 1)) / 2;
  }
  if (input.brake > 0) {
    if (speed > 0.5) brake = Math.max(brake, input.brake * t.brake);
    else engine = (-input.brake * t.reverseForce * clamp(1 - (-speed / t.reverseSpeed) ** 2, 0, 1)) / 2;
  }
  if (input.throttle === 0 && input.brake === 0) brake = t.coastBrake;
  return {
    engine,
    brakeFront: brake,
    brakeRear: input.handbrake ? Math.max(brake, t.handbrake) : brake,
    steer,
    rearSideFriction: input.handbrake ? t.driftSideFriction : t.sideFriction,
  };
}
