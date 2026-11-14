/**
 * The car on Rapier's ray-cast vehicle (a port of Bullet's): the chassis is one rigid
 * body, and each wheel is a ray cast down from the chassis with a spring, tire grip,
 * engine force and brake. This file sets it up and drives it from a DriveCommand; it
 * takes Rapier's objects as arguments, so the same code runs in the game and in tests.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import type { DriveCommand } from './controls';
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
