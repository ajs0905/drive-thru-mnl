/**
 * What a car is: its model, its size and wheel layout (measured from the converted
 * GLB, see tools/car-to-glb.ts), its mass, and the tuning numbers the arcade handling
 * uses. Everything is in meters, kilograms, newtons and seconds, in the car's own frame:
 * +Y up, +Z forward, +X to the car's left, origin on the ground under its middle.
 */

export type WheelName = 'wheelFL' | 'wheelFR' | 'wheelRL' | 'wheelRR';

export interface WheelSpec {
  name: WheelName;
  /** Wheel center at rest, car frame (left is +x, forward is +z). */
  x: number;
  z: number;
  front: boolean;
}

export interface Tuning {
  /** Rear-wheel drive force at a standstill (N, both wheels together). */
  engineForce: number;
  /** Reverse force (N) and top speeds (m/s). */
  reverseForce: number;
  topSpeed: number;
  reverseSpeed: number;
  /** Brake impulse per wheel per step, full pedal. */
  brake: number;
  /** Rear brake with the handbrake, and the light drag when coasting. */
  handbrake: number;
  coastBrake: number;
  /** Steering lock (radians) at a standstill and at top speed; in between it falls off with speed. */
  maxSteer: number;
  minSteer: number;
  /** How fast the wheels turn toward the input, and back to center (radians per second). */
  steerRate: number;
  steerReturn: number;
  /** Tire grip: how hard the tires push before slipping, sideways stiffness, and rear sideways stiffness with the handbrake (drifts). */
  frictionSlip: number;
  sideFriction: number;
  driftSideFriction: number;
  /** Suspension, as in a Bullet-style ray-cast vehicle (stiffness and damping scale with mass). */
  suspensionStiffness: number;
  suspensionCompression: number;
  suspensionRelaxation: number;
  suspensionTravel: number;
  suspensionRest: number;
  maxSuspensionForce: number;
  /** Extra downward push, N per (m/s)^2: keeps the car planted at speed. */
  downforce: number;
  /** Slows spins and rolls a little, so crashes stay readable. */
  angularDamping: number;
  linearDamping: number;
}

export interface CarSpec {
  id: string;
  /** Path under the site's base URL. */
  model: string;
  mass: number;
  /** Chassis collider: half extents and the height of its center. */
  halfExtents: [number, number, number];
  colliderY: number;
  /** Center of mass height (low, so the car doesn't roll over in every corner). */
  centerOfMassY: number;
  wheelRadius: number;
  /** Wheel center height at rest, from the model. */
  wheelY: number;
  wheels: WheelSpec[];
  tuning: Tuning;
}

const SEDAN_TRACK = 0.873;
const SEDAN_AXLE = 1.368;

/** The test car: the Sedan from the Rgsdev pack, scaled to a real sedan (2.74 m wheelbase). */
export const SEDAN: CarSpec = {
  id: 'sedan',
  model: 'models/sedan.glb',
  mass: 1200,
  halfExtents: [0.95, 0.42, 2.15],
  colliderY: 0.82,
  centerOfMassY: 0.45,
  wheelRadius: 0.345,
  wheelY: 0.345,
  wheels: [
    { name: 'wheelFL', x: SEDAN_TRACK, z: SEDAN_AXLE, front: true },
    { name: 'wheelFR', x: -SEDAN_TRACK, z: SEDAN_AXLE, front: true },
    { name: 'wheelRL', x: SEDAN_TRACK, z: -SEDAN_AXLE, front: false },
    { name: 'wheelRR', x: -SEDAN_TRACK, z: -SEDAN_AXLE, front: false },
  ],
  tuning: {
    engineForce: 8000,
    reverseForce: 3500,
    topSpeed: 50,
    reverseSpeed: 9,
    brake: 40,
    handbrake: 60,
    coastBrake: 2,
    maxSteer: 0.55,
    minSteer: 0.1,
    steerRate: 2.2,
    steerReturn: 3.5,
    frictionSlip: 1.3,
    sideFriction: 1.0,
    driftSideFriction: 0.35,
    suspensionStiffness: 30,
    suspensionCompression: 4.4,
    suspensionRelaxation: 2.3,
    suspensionTravel: 0.2,
    suspensionRest: 0.3,
    maxSuspensionForce: 100000,
    downforce: 2,
    angularDamping: 0.6,
    linearDamping: 0.05,
  },
};

/** Where a wheel's suspension starts (car frame): above the wheel center by the rest length. */
export function wheelHardPoint(spec: CarSpec, w: WheelSpec): [number, number, number] {
  return [w.x, spec.wheelY + spec.tuning.suspensionRest, w.z];
}
