/**
 * The drive without a screen: the same physics world Drive.tsx builds (the ground, the
 * map's walls and structures as static meshes, the Sedan on Rapier's ray-cast vehicle)
 * stepped at 60 Hz by the same step function the game runs. Rapier is passed in, so this
 * runs in Node (tests, benchmarks, recording replays) as well as anywhere else.
 *
 * Left out: the pooled bodies near the player (parked cars, roadblock pieces, street
 * furniture). A drive that hits one plays differently here.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import { inputFromKeys, NO_KEYS, type DriveKeys } from '../car/controls';
import { restLift, SEDAN, type CarSpec } from '../car/spec';
import { chassisCollider, newDriveState, resetOnGround, setupWheels, stepVehicle, type DriveState, type VehicleController } from '../car/vehicle';
import { buildCollision } from '../geometry/collision';
import { decodeKeys, keysOf, type Replay } from './replay';

type Rapier = typeof RAPIER;

/** The top of the physics ground and the road surfaces' heights (as in Drive.tsx and cityGeometry.ts). */
export const GROUND_Y = 0.2;
export const SURFACE = { path: 0.12, service: 0.16, minor: 0.2, major: 0.24 };
/** Seconds upside down before the car rights itself (as in Car.tsx). */
const STUCK_RESET = 2;

export interface SimCar {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  vc: VehicleController;
  state: DriveState;
  spec: CarSpec;
  time: number;
  stuck: number;
  /** Map pose and speed, refreshed every step. */
  x: number;
  y: number;
  height: number;
  heading: number;
  speed: number;
}

/** A world with the map's static collision and the car at `start` (three.js space). */
export function createSim(rapier: Rapier, map: Parameters<typeof buildCollision>[0], start: Replay['start'], spec: CarSpec = SEDAN): SimCar {
  const world = new rapier.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  world.createCollider(rapier.ColliderDesc.cuboid(6000, 0.5, 6000).setTranslation(start.x, GROUND_Y - 0.5, start.z).setFriction(1));
  const solid = buildCollision(map, { surfaceY: SURFACE });
  if (solid.walls.indices.length) world.createCollider(rapier.ColliderDesc.trimesh(solid.walls.vertices, solid.walls.indices).setFriction(0.2).setRestitution(0.1));
  if (solid.structures.indices.length) world.createCollider(rapier.ColliderDesc.trimesh(solid.structures.vertices, solid.structures.indices).setFriction(1).setRestitution(0.1));
  const t = spec.tuning;
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.dynamic()
      .setTranslation(start.x, start.y, start.z)
      .setRotation({ x: 0, y: Math.sin(start.yaw / 2), z: 0, w: Math.cos(start.yaw / 2) })
      .setAngularDamping(t.angularDamping)
      .setLinearDamping(t.linearDamping)
      .setCcdEnabled(true)
      .setCanSleep(false),
  );
  world.createCollider(chassisCollider(rapier, spec), body);
  const vc = world.createVehicleController(body);
  setupWheels(vc, spec);
  const car: SimCar = { world, body, vc, state: newDriveState(), spec, time: 0, stuck: 0, x: 0, y: 0, height: 0, heading: 0, speed: 0 };
  read(car);
  return car;
}

/** The start pose for a map position and heading, at the car's resting height on the ground. */
export function startAt(p: [number, number], heading: number, spec: CarSpec = SEDAN): Replay['start'] {
  return { x: p[0], y: GROUND_Y + restLift(spec), z: -p[1], yaw: Math.atan2(Math.cos(heading), -Math.sin(heading)) };
}

function read(car: SimCar) {
  const p = car.body.translation();
  const r = car.body.rotation();
  car.x = p.x;
  car.y = -p.z;
  car.height = p.y;
  // The car's forward (+z) in three.js space, as a map heading.
  const fx = 2 * (r.x * r.z + r.w * r.y);
  const fz = 1 - 2 * (r.x * r.x + r.y * r.y);
  car.heading = Math.atan2(-fz, fx);
  car.speed = car.vc.currentVehicleSpeed();
}

/** One 60 Hz step with these keys: the game's step, then the world's. */
export function stepSim(rapier: Rapier, car: SimCar, keys: DriveKeys) {
  const dt = car.world.timestep;
  const r = car.body.rotation();
  const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
  car.stuck = upY < 0.3 || car.body.translation().y < -20 ? car.stuck + dt : 0;
  if (car.stuck > STUCK_RESET) {
    resetOnGround(car.world, rapier, car.body, car.spec, GROUND_Y);
    car.state = { ...newDriveState(), impacts: car.state.impacts };
    car.stuck = 0;
  }
  stepVehicle(car.vc, car.body, car.spec, car.state, inputFromKeys(keys), dt);
  car.world.step();
  car.time += dt;
  read(car);
}

/** Plays a replay from its start; `each` sees the car after every step. Returns the car at the end. */
export function playReplay(rapier: Rapier, map: Parameters<typeof buildCollision>[0], replay: Replay, each?: (car: SimCar, step: number) => void): SimCar {
  const car = createSim(rapier, map, replay.start);
  const masks = decodeKeys(replay.keys);
  const keys = { ...NO_KEYS };
  for (let i = 0; i < masks.length; i++) {
    stepSim(rapier, car, keysOf(masks[i], keys));
    each?.(car, i);
  }
  return car;
}

