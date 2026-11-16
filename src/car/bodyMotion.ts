/**
 * Body pitch and roll, for looks only (the physics chassis stays as it is): the body
 * squats when the car speeds up, dips its nose when it brakes, and leans out of corners,
 * on a slightly bouncy spring so it settles with a small overshoot. Upshifts add a
 * little nose-down kick. The wheels don't move with it.
 *
 * Angles in radians, as rotations of the body around the car's own axes: pitch around
 * +x (positive dips the nose), roll around +z (positive lowers the right side).
 */
export interface BodyMotion {
  pitch: number;
  pitchVel: number;
  roll: number;
  rollVel: number;
}

export const BODY = {
  /** Lean per m/s^2 of acceleration, and the most it ever leans. */
  pitchPerAccel: 0.005,
  rollPerAccel: 0.006,
  maxPitch: 0.045,
  maxRoll: 0.06,
  /** Spring (per s^2) and damping (per s): a little under critical, so it overshoots once. */
  stiffness: 140,
  damping: 15,
  /** Nose-down spin given to the body at each upshift (rad/s). */
  shiftKick: 0.35,
};

export const STILL: BodyMotion = { pitch: 0, pitchVel: 0, roll: 0, rollVel: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Where the body wants to lean for a forward and a leftward acceleration (m/s^2). */
export function leanFor(forward: number, left: number): { pitch: number; roll: number } {
  return {
    pitch: clamp(-forward * BODY.pitchPerAccel, -BODY.maxPitch, BODY.maxPitch),
    roll: clamp(left * BODY.rollPerAccel, -BODY.maxRoll, BODY.maxRoll),
  };
}

/** The body after `dt` seconds, springing toward the lean for these accelerations. */
export function stepBody(b: BodyMotion, forward: number, left: number, dt: number): BodyMotion {
  return stepBodyInto({ ...b }, forward, left, dt);
}

/** `stepBody` in place (no new object: traffic steps dozens of these a frame). Returns `b`. */
export function stepBodyInto(b: BodyMotion, forward: number, left: number, dt: number): BodyMotion {
  const goal = leanFor(forward, left);
  const h = Math.min(dt, 1 / 30); // keep the spring stable through slow frames
  b.pitchVel += (BODY.stiffness * (goal.pitch - b.pitch) - BODY.damping * b.pitchVel) * h;
  b.rollVel += (BODY.stiffness * (goal.roll - b.roll) - BODY.damping * b.rollVel) * h;
  b.pitch = clamp(b.pitch + b.pitchVel * h, -BODY.maxPitch * 1.5, BODY.maxPitch * 1.5);
  b.roll = clamp(b.roll + b.rollVel * h, -BODY.maxRoll * 1.5, BODY.maxRoll * 1.5);
  return b;
}

/** The body with an upshift's kick added. */
export function kick(b: BodyMotion): BodyMotion {
  return { ...b, pitchVel: b.pitchVel + BODY.shiftKick };
}
