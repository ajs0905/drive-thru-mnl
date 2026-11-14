/**
 * The car on Rapier's ray-cast vehicle (a port of Bullet's): the chassis is one rigid
 * body, and each wheel is a ray cast down from the chassis with a spring, tire grip,
 * engine force and brake. This file sets it up and runs one physics step of driving
 * (`stepVehicle`: input -> arcade controls, drift assist, gearbox -> wheels). It takes
 * Rapier's objects as arguments, so the same code runs in the game and in tests.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import { driveCommand, nextSteer, type DriveCommand, type DriveInput } from './controls';
import { antiSpin, countersteer, driftPush, driftTurn, nextDrifting, nextRearGrip, slipAngle, toLocal, type Vec } from './drift';
import { driveShare, NEW_GEARBOX, stepGearbox, type Gearbox } from './gearbox';
import { wheelHardPoint, type CarSpec } from './spec';

type Rapier = typeof RAPIER;
export type VehicleController = RAPIER.DynamicRayCastVehicleController;

/** Rotational inertia of the chassis box, a bit higher than a plain box so the car turns and rolls calmly. */
export function chassisInertia(spec: CarSpec): [number, number, number] {
  const [hx, hy, hz] = spec.halfExtents.map((h) => h * 2);
  const k = (spec.mass / 12) * 1.5;
  return [k * (hy * hy + hz * hz), k * (hx * hx + hz * hz), k * (hx * hx + hy * hy)];
}

/** The chassis collider: a box, with the mass centered low in the car. */
export function chassisCollider(rapier: Rapier, spec: CarSpec): RAPIER.ColliderDesc {
  const [x, y, z] = spec.halfExtents;
  const [ix, iy, iz] = chassisInertia(spec);
  return rapier.ColliderDesc.cuboid(x, y, z)
    .setTranslation(0, spec.colliderY, 0)
    .setMassProperties(spec.mass, { x: 0, y: spec.centerOfMassY - spec.colliderY, z: 0 }, { x: ix, y: iy, z: iz }, { x: 0, y: 0, z: 0, w: 1 })
    .setFriction(0.3)
    .setRestitution(0.1);
}

/** Adds the four wheels with the spec's suspension and grip; forward is +z, up is +y. */
export function setupWheels(controller: VehicleController, spec: CarSpec) {
  const t = spec.tuning;
  controller.indexUpAxis = 1;
  controller.setIndexForwardAxis = 2; // (sic) Rapier's setter for the forward axis
  spec.wheels.forEach((w, i) => {
    const [x, y, z] = wheelHardPoint(spec, w);
    controller.addWheel({ x, y, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, t.suspensionRest, spec.wheelRadius);
    controller.setWheelSuspensionStiffness(i, t.suspensionStiffness);
    controller.setWheelSuspensionCompression(i, t.suspensionCompression);
    controller.setWheelSuspensionRelaxation(i, t.suspensionRelaxation);
    controller.setWheelMaxSuspensionTravel(i, t.suspensionTravel);
    controller.setWheelMaxSuspensionForce(i, t.maxSuspensionForce);
    controller.setWheelFrictionSlip(i, t.frictionSlip);
    controller.setWheelSideFrictionStiffness(i, t.sideFriction);
  });
}

/** Applies one step's command to the wheels (rear-wheel drive, front-wheel steering). */
export function applyCommand(controller: VehicleController, spec: CarSpec, cmd: DriveCommand) {
  spec.wheels.forEach((w, i) => {
    controller.setWheelSteering(i, w.front ? cmd.steer : 0);
    controller.setWheelEngineForce(i, w.front ? 0 : cmd.engine);
    controller.setWheelBrake(i, w.front ? cmd.brakeFront : cmd.brakeRear);
    if (!w.front) controller.setWheelSideFrictionStiffness(i, cmd.rearSideFriction);
  });
}

/** Downward push for a speed (N), applied as an impulse each step. */
export function downforce(spec: CarSpec, speed: number): number {
  return spec.tuning.downforce * speed * speed;
}

/** What the car remembers between physics steps. */
export interface DriveState {
  /** Wheel angle from the player's input (radians), before countersteer. */
  steer: number;
  /** Rear grip, 0 loose to 1 normal, and whether the car is drifting (drift.ts). */
  grip: number;
  drifting: boolean;
  gearbox: Gearbox;
  /** Slip angle (radians, positive moving toward the car's left). */
  slip: number;
  /** Smoothed acceleration in the car's frame (m/s^2): forward and toward its left. */
  accel: { forward: number; left: number };
  /** World velocity at the last step, to measure acceleration. */
  lastVel: Vec | null;
  /** Brake lights on. */
  braking: boolean;
}

export const newDriveState = (): DriveState => ({
  steer: 0,
  grip: 1,
  drifting: false,
  gearbox: NEW_GEARBOX,
  slip: 0,
  accel: { forward: 0, left: 0 },
  lastVel: null,
  braking: false,
});

/** Acceleration readings are smoothed over about this long (s), so bumps don't shake the camera. */
const ACCEL_SMOOTHING = 0.08;

/** One physics step of driving: reads the car, updates `s`, sets the wheels and pushes the body. Call before the world steps. */
export function stepVehicle(vc: VehicleController, body: RAPIER.RigidBody, spec: CarSpec, s: DriveState, input: DriveInput, dt: number) {
  const t = spec.tuning;
  const rot = body.rotation();
  const vel = body.linvel();
  const local = toLocal(vel, rot);
  const speed = vc.currentVehicleSpeed();

  // Acceleration in the car's frame, from the change in world velocity (so turning shows as sideways acceleration).
  if (s.lastVel) {
    const a = toLocal({ x: (vel.x - s.lastVel.x) / dt, y: (vel.y - s.lastVel.y) / dt, z: (vel.z - s.lastVel.z) / dt }, rot);
    const k = 1 - Math.exp(-dt / ACCEL_SMOOTHING);
    s.accel = { forward: s.accel.forward + (a.z - s.accel.forward) * k, left: s.accel.left + (a.x - s.accel.left) * k };
  }
  s.lastVel = { x: vel.x, y: vel.y, z: vel.z };

  s.slip = slipAngle(local.x, local.z);
  s.gearbox = stepGearbox(s.gearbox, speed, dt, t);
  s.drifting = nextDrifting(s.drifting, input.handbrake, input.steer, speed, s.slip);
  s.grip = nextRearGrip(s.grip, input.handbrake, input.throttle, s.drifting, dt, t);
  s.steer = nextSteer(s.steer, input.steer, speed, dt, t);
  const steer = Math.max(-t.maxSteer, Math.min(t.maxSteer, s.steer + countersteer(s.slip, t)));

  const cmd = driveCommand(input, speed, steer, t, s.grip);
  applyCommand(vc, spec, { ...cmd, engine: cmd.engine * driveShare(s.gearbox, t) });
  s.braking = input.handbrake || cmd.brakeFront > t.coastBrake;

  body.applyImpulse({ x: 0, y: -downforce(spec, speed) * dt, z: 0 }, true);
  const push = driftPush(s.drifting, input.throttle, Math.hypot(vel.x, vel.z), t);
  if (push) {
    const h = Math.hypot(vel.x, vel.z);
    body.applyImpulse({ x: (vel.x / h) * push * spec.mass * dt, y: 0, z: (vel.z / h) * push * spec.mass * dt }, true);
  }
  const turn = driftTurn(input.steer, s.drifting, t) + antiSpin(s.slip, body.angvel().y, t);
  if (turn) body.applyTorqueImpulse({ x: 0, y: turn * chassisInertia(spec)[1] * dt, z: 0 }, true);
  vc.updateVehicle(dt);
}
