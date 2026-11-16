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
import { restLift, wheelHardPoint, type CarSpec } from './spec';

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
  /**
   * Crashes so far (a counter, so the renderer notices one between frames), the last
   * one's total speed change (m/s; a crash spreads over a few steps), and whether one is
   * still going on.
   */
  impacts: number;
  impact: number;
  crashing: boolean;
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
  impacts: 0,
  impact: 0,
  crashing: false,
});

/** Above this deceleration (m/s^2, about 3 g) a change in speed is a crash, not braking. */
const IMPACT_ACCEL = 30;

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
    const dv = Math.hypot(vel.x - s.lastVel.x, vel.z - s.lastVel.z);
    const hit = dv / dt > IMPACT_ACCEL;
    if (hit && s.crashing) s.impact += dv;
    else if (hit) {
      s.impacts++;
      s.impact = dv;
    }
    s.crashing = hit;
    const a = toLocal({ x: (vel.x - s.lastVel.x) / dt, y: (vel.y - s.lastVel.y) / dt, z: (vel.z - s.lastVel.z) / dt }, rot);
    const k = 1 - Math.exp(-dt / ACCEL_SMOOTHING);
    s.accel = { forward: s.accel.forward + (a.z - s.accel.forward) * k, left: s.accel.left + (a.x - s.accel.left) * k };
  }
  s.lastVel = { x: vel.x, y: vel.y, z: vel.z };

  s.slip = slipAngle(local.x, local.z);
  s.gearbox = stepGearbox(s.gearbox, speed, dt, t);
  s.drifting = nextDrifting(s.drifting, input.handbrake, input.steer, input.throttle, speed, s.slip);
  s.grip = nextRearGrip(s.grip, input.handbrake, input.throttle, s.drifting, dt, t);
  s.steer = nextSteer(s.steer, input.steer, speed, dt, t);
  const steer = Math.max(-t.maxSteer, Math.min(t.maxSteer, s.steer + countersteer(s.slip, t)));

  const cmd = driveCommand(input, speed, steer, t, s.grip);
  applyCommand(vc, spec, { ...cmd, engine: cmd.engine * driveShare(s.gearbox, t) });
  s.braking = input.handbrake || cmd.brakeFront > t.coastBrake;

  body.applyImpulse({ x: 0, y: -downforce(spec, speed) * dt, z: 0 }, true);
  const push = driftPush(s.drifting, input.handbrake ? 0 : input.throttle, Math.hypot(vel.x, vel.z), t);
  if (push) {
    const h = Math.hypot(vel.x, vel.z);
    body.applyImpulse({ x: (vel.x / h) * push * spec.mass * dt, y: 0, z: (vel.z / h) * push * spec.mass * dt }, true);
  }
  const turn = driftTurn(input.steer, s.drifting, t) + antiSpin(s.slip, body.angvel().y, t);
  if (turn) body.applyTorqueImpulse({ x: 0, y: turn * chassisInertia(spec)[1] * dt, z: 0 }, true);
  vc.updateVehicle(dt);
}

/** Reset (R, the reset button, or upside down for a while): how often, and where the ground is looked for. */
export const RESET = {
  /** Presses closer together than this (seconds) are ignored, so spamming reset can't stack anything. */
  cooldown: 0.5,
  /** The ground is looked for straight down from this far above the car (m), so a flyover deck the car is on counts and one high above doesn't. */
  probe: 2,
  /** ...down to this far (m). */
  reach: 300,
};

/** Where a reset puts the car instead of where it is (three.js space): the road surface height there, and the yaw. */
export interface ResetPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * Puts the car back on its wheels where it is (or at `to`): upright, facing the way it was heading,
 * standing still, at its resting height on the static ground below it (the ground plane,
 * a road deck; not a parked car or a cone). The height comes from the ground, never from
 * where the car was, so resetting again and again lands it in the same place. With no
 * ground found (fallen off the world), it goes to `fallbackY`.
 */
export function resetOnGround(world: RAPIER.World, rapier: Rapier, body: RAPIER.RigidBody, spec: CarSpec, fallbackY: number, to?: ResetPose) {
  const p = to ? { x: to.x, y: to.y, z: to.z } : body.translation();
  const r = body.rotation();
  // Heading from the car's forward (+z) axis, flattened.
  const fx = 2 * (r.x * r.z + r.w * r.y);
  const fz = 1 - 2 * (r.x * r.x + r.y * r.y);
  const yaw = to ? to.yaw : Math.atan2(fx, fz);
  const from = { x: p.x, y: p.y + RESET.probe, z: p.z };
  const hit = world.castRay(new rapier.Ray(from, { x: 0, y: -1, z: 0 }), RESET.reach, true, undefined, undefined, undefined, body, (c) => {
    const parent = c.parent();
    return !parent || parent.isFixed();
  });
  const groundY = hit ? from.y - hit.timeOfImpact : fallbackY;
  body.setTranslation({ x: p.x, y: groundY + restLift(spec), z: p.z }, true);
  body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}
