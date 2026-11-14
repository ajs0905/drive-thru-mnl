/**
 * The Sedan on flat ground in the real physics engine (Rapier compiled to WebAssembly,
 * same setup code as the game), stepped at the game's 60 Hz. These pin down the feel:
 * if a tuning change makes the car slow, twitchy or easy to roll, a test fails.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { driveCommand, nextSteer, type DriveInput } from './controls';
import { SEDAN } from './spec';
import { applyCommand, chassisCollider, chassisInertia, downforce, setupWheels } from './vehicle';

const DT = 1 / 60;

beforeAll(async () => {
  await RAPIER.init();
});

function makeCar(speed = 0) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.3, 0)); // ground top at 0.2, as in Drive.tsx
  const t = SEDAN.tuning;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.4, 0).setAngularDamping(t.angularDamping).setLinearDamping(t.linearDamping).setCanSleep(false),
  );
  world.createCollider(chassisCollider(RAPIER, SEDAN), body);
  const vc = world.createVehicleController(body);
  setupWheels(vc, SEDAN);
  const car = { world, body, vc, steer: 0, maxTilt: 0, time: 0 };
  drive(car, {}, 1); // settle on the springs
  if (speed) body.setLinvel({ x: 0, y: 0, z: speed }, true);
  return car;
}

type Car = ReturnType<typeof makeCar>;

/** Same loop as Car.tsx's physics step. */
function drive(car: Car, partial: Partial<DriveInput>, seconds: number) {
  const input: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, ...partial };
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const speed = car.vc.currentVehicleSpeed();
    car.steer = nextSteer(car.steer, input.steer, speed, DT, SEDAN.tuning);
    applyCommand(car.vc, SEDAN, driveCommand(input, speed, car.steer, SEDAN.tuning));
    car.body.applyImpulse({ x: 0, y: -downforce(SEDAN, speed) * DT, z: 0 }, true);
    car.vc.updateVehicle(DT);
    car.world.step();
    car.time += DT;
    const r = car.body.rotation();
    const up = 1 - 2 * (r.x * r.x + r.z * r.z);
    car.maxTilt = Math.max(car.maxTilt, (Math.acos(Math.min(1, up)) * 180) / Math.PI);
  }
  return car.vc.currentVehicleSpeed();
}

describe('the Sedan in Rapier', () => {
  it('rests on all four wheels with the springs partly compressed', () => {
    const car = makeCar();
    expect([0, 1, 2, 3].every((i) => car.vc.wheelIsInContact(i))).toBe(true);
    const len = car.vc.wheelSuspensionLength(0)!;
    expect(len).toBeGreaterThan(0.1);
    expect(len).toBeLessThan(SEDAN.tuning.suspensionRest);
    expect(Math.abs(car.vc.currentVehicleSpeed())).toBeLessThan(0.3);
  });

  it('reaches 100 km/h in 5 to 9 seconds and tops out under 180', () => {
    const car = makeCar();
    let t100 = Infinity;
    for (let s = 0; s < 30 * 60 && t100 === Infinity; s++) if (drive(car, { throttle: 1 }, DT) >= 100 / 3.6) t100 = car.time - 1;
    expect(t100).toBeGreaterThan(5);
    expect(t100).toBeLessThan(9);
    expect(drive(car, { throttle: 1 }, 20)).toBeLessThan(SEDAN.tuning.topSpeed);
    expect(car.body.translation().x).toBeCloseTo(0, 1); // straight line
  });

  it('spins its wheels forward as it drives forward', () => {
    const car = makeCar();
    drive(car, { throttle: 1 }, 1);
    const z = car.body.translation().z;
    expect(z).toBeGreaterThan(1);
    expect(car.vc.wheelRotation(2)!).toBeCloseTo(z / SEDAN.wheelRadius, 0); // rolling, not wheelspin
  });

  it('stops from 90 km/h within 25 to 45 m, then reverses on the same key', () => {
    const car = makeCar(25);
    const z0 = car.body.translation().z;
    while (car.body.linvel().z > 0.5 && car.time < 10) drive(car, { brake: 1 }, DT);
    const distance = car.body.translation().z - z0;
    expect(distance).toBeGreaterThan(25);
    expect(distance).toBeLessThan(45);
    const back = drive(car, { brake: 1 }, 4);
    expect(back).toBeLessThan(-5);
    expect(back).toBeGreaterThan(-SEDAN.tuning.reverseSpeed - 0.5);
  });

  it('turns left on left input, with arcade grip and without rolling over', () => {
    const car = makeCar(15);
    drive(car, { throttle: 0.3, steer: 1 }, 3);
    const yawRate = car.body.angvel().y;
    expect(yawRate).toBeGreaterThan(0); // counter-clockwise from above: left
    const lateral = car.vc.currentVehicleSpeed() * yawRate;
    expect(lateral / 9.81).toBeGreaterThan(0.8); // grips like a sporty car...
    expect(lateral / 9.81).toBeLessThan(1.6); // ...not like it's glued down
    expect(car.body.translation().x).toBeGreaterThan(5);

    const fast = makeCar(30);
    drive(fast, { throttle: 0.5, steer: 1 }, 3);
    expect(fast.maxTilt).toBeLessThan(10);
    expect([0, 1, 2, 3].every((i) => fast.vc.wheelIsInContact(i))).toBe(true);
  });

  it('turns tighter with the handbrake (the rear slides)', () => {
    const grip = makeCar(20);
    drive(grip, { steer: 1 }, 1.2);
    const drift = makeCar(20);
    drive(drift, { steer: 1, handbrake: true }, 1.2);
    expect(drift.body.angvel().y).toBeGreaterThan(grip.body.angvel().y);
    expect(drift.vc.currentVehicleSpeed()).toBeLessThan(grip.vc.currentVehicleSpeed()); // and scrubs speed
  });
});

describe('chassis', () => {
  it('has the mass low in the car and calm rotation', () => {
    const [ix, iy, iz] = chassisInertia(SEDAN);
    expect(iy).toBeGreaterThan(ix); // turning is the hardest motion, rolling the easiest
    expect(ix).toBeGreaterThan(iz);
    expect(SEDAN.centerOfMassY).toBeLessThan(SEDAN.colliderY);
  });
  it('adds downforce with the square of speed', () => {
    expect(downforce(SEDAN, 20)).toBeCloseTo(4 * downforce(SEDAN, 10));
    expect(downforce(SEDAN, 0)).toBe(0);
  });
});
