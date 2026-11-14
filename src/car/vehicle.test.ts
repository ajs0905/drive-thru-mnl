/**
 * The Sedan on flat ground in the real physics engine (Rapier compiled to WebAssembly,
 * same setup code as the game), stepped at the game's 60 Hz. These pin down the feel:
 * if a tuning change makes the car slow, twitchy or easy to roll, a test fails.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DriveInput } from './controls';
import { SEDAN } from './spec';
import { buildCollision } from '../geometry/collision';
import type { MapData } from '../map/types';
import bgc from '../../public/data/bgc.json?raw';
import { chassisCollider, chassisInertia, downforce, newDriveState, setupWheels, stepVehicle } from './vehicle';

const DT = 1 / 60;

beforeAll(async () => {
  await RAPIER.init();
});

type Solids = Parameters<typeof buildCollision>[0];
const SURFACE = { path: 0.12, service: 0.16, minor: 0.2, major: 0.24 };

function makeCar(speed = 0, solids?: Solids, at = { x: 0, z: 0, yaw: 0 }) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.3, 0)); // ground top at 0.2, as in Drive.tsx
  if (solids) {
    const solid = buildCollision(solids, { surfaceY: SURFACE }); // the same static meshes Drive.tsx builds from the map
    if (solid.walls.indices.length) world.createCollider(RAPIER.ColliderDesc.trimesh(solid.walls.vertices, solid.walls.indices).setFriction(0.2).setRestitution(0.1));
    if (solid.structures.indices.length) {
      world.createCollider(RAPIER.ColliderDesc.trimesh(solid.structures.vertices, solid.structures.indices).setFriction(1).setRestitution(0.1));
    }
  }
  const t = SEDAN.tuning;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(at.x, 0.4, at.z)
      .setRotation({ x: 0, y: Math.sin(at.yaw / 2), z: 0, w: Math.cos(at.yaw / 2) })
      .setAngularDamping(t.angularDamping).setLinearDamping(t.linearDamping).setCcdEnabled(true).setCanSleep(false),
  );
  world.createCollider(chassisCollider(RAPIER, SEDAN), body);
  const vc = world.createVehicleController(body);
  setupWheels(vc, SEDAN);
  const car = { world, body, vc, state: newDriveState(), maxTilt: 0, maxSlip: 0, maxImpact: 0, time: 0, everDrifted: false, gears: [] as number[] };
  drive(car, {}, 1); // settle on the springs
  if (speed) {
    body.setLinvel({ x: 0, y: 0, z: speed }, true);
    car.state.lastVel = null; // a speed set from outside isn't a crash
  }
  return car;
}

type Car = ReturnType<typeof makeCar>;

/** Same loop as Car.tsx's physics step. */
function drive(car: Car, partial: Partial<DriveInput>, seconds: number) {
  const input: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, ...partial };
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepVehicle(car.vc, car.body, SEDAN, car.state, input, DT);
    car.world.step();
    car.maxSlip = Math.max(car.maxSlip, Math.abs(car.state.slip));
    car.everDrifted ||= car.state.drifting;
    car.maxImpact = Math.max(car.maxImpact, car.state.impact);
    if (car.gears.at(-1) !== car.state.gearbox.gear) car.gears.push(car.state.gearbox.gear);
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

  it('never drifts without the handbrake, even in a hard corner', () => {
    const car = makeCar(20);
    drive(car, { throttle: 1, steer: 1 }, 3);
    expect(car.everDrifted).toBe(false);
    expect(car.maxSlip).toBeLessThan(0.1);
  });

  it('starts a drift from a quick tap of the handbrake', () => {
    const car = makeCar(20);
    drive(car, { steer: 1, handbrake: true }, 0.15);
    drive(car, { steer: 1, throttle: 1 }, 1.2);
    expect(car.state.drifting).toBe(true);
    expect(car.maxSlip).toBeGreaterThan(0.35);
  });

  it('drifts with a handbrake kick and holds the slide on throttle, without spinning out', () => {
    const car = makeCar(20);
    drive(car, { steer: 1, handbrake: true }, 0.3);
    drive(car, { steer: 1, throttle: 1 }, 1.5);
    expect(car.state.drifting).toBe(true);
    expect(car.maxSlip).toBeGreaterThan(0.45); // a real slide: past 25 degrees
    expect(car.maxSlip).toBeLessThan(0.8); // held near the limit (about 30 degrees), not spun out
    const v = car.body.linvel();
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(12); // keeps most of its 72 km/h
    expect(car.maxTilt).toBeLessThan(15);
  });

  it('flows out of a drift when the player lets go of the steering', () => {
    const car = makeCar(20);
    drive(car, { steer: 1, handbrake: true }, 0.3);
    drive(car, { steer: 1, throttle: 1 }, 1);
    drive(car, { throttle: 1 }, 2.5);
    expect(car.state.drifting).toBe(false);
    expect(Math.abs(car.state.slip)).toBeLessThan(0.05);
    expect(car.state.grip).toBe(1);
    expect(car.vc.currentVehicleSpeed()).toBeGreaterThan(12);
  });

  it("doesn't start a drift at walking pace", () => {
    const car = makeCar(4);
    drive(car, { steer: 1, handbrake: true }, 1);
    expect(car.everDrifted).toBe(false);
  });

  it('shifts up through the gears as it speeds up, and down again as it slows', () => {
    const car = makeCar();
    drive(car, { throttle: 1 }, 12);
    expect(car.state.gearbox.gear).toBeGreaterThanOrEqual(4);
    expect(car.gears).toEqual([1, 2, 3, 4, ...(car.state.gearbox.gear === 5 ? [5] : [])]);
    expect(car.state.gearbox.upshifts).toBe(car.state.gearbox.gear - 1);
    drive(car, { brake: 1 }, 6);
    expect(car.state.gearbox.gear).toBe(-1); // stopped, then reversing
  });

  it('feels the upshift: the drive drops for a moment', () => {
    const car = makeCar();
    let before = 0;
    let during = Infinity;
    for (let i = 0; i < 6 * 60; i++) {
      const shifting = car.state.gearbox.shifting > 0;
      drive(car, { throttle: 1 }, DT);
      if (car.state.gearbox.gear === 2 && !shifting && car.state.gearbox.shifting > 0) before = car.state.accel.forward;
      if (car.state.gearbox.gear === 2 && car.state.gearbox.shifting > 0) during = Math.min(during, car.state.accel.forward);
    }
    expect(before).toBeGreaterThan(2);
    expect(during).toBeLessThan(before * 0.75);
  });

  it('measures acceleration in the car frame: forward when speeding up, sideways in turns', () => {
    const car = makeCar();
    drive(car, { throttle: 1 }, 1);
    expect(car.state.accel.forward).toBeGreaterThan(3);
    const turning = makeCar(15);
    drive(turning, { steer: 1, throttle: 0.3 }, 2);
    expect(turning.state.accel.left).toBeGreaterThan(5); // turning left pulls the car left
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

describe('the Sedan against the map', () => {
  // Three.js z is map -y, and the car starts at the origin facing +z: map points ahead of it have negative y.
  const wallAcross = (z: number, kind: 'wall' | 'fence' = 'wall'): Solids => ({
    buildings: [],
    roads: [],
    barriers: [{ id: 'w', kind, h: 2.4, points: [[-30, -z], [30, -z]] }],
  });
  const buildingAhead = (z: number): Solids => ({
    buildings: [{ id: 'b', type: 'yes', h: 20, hSrc: 'estimate', rings: [[[-30, -z], [30, -z], [30, -z - 20], [-30, -z - 20]]] } as MapData['buildings'][number]],
    roads: [],
  });
  const front = (car: Car) => car.body.translation().z + SEDAN.halfExtents[2];

  it('stops at a building instead of driving through it', () => {
    const car = makeCar(25, buildingAhead(30));
    drive(car, { throttle: 1 }, 3);
    expect(front(car)).toBeLessThan(30.3);
    expect(Math.abs(car.vc.currentVehicleSpeed())).toBeLessThan(3);
  });

  it("doesn't tunnel through a thin wall even at 180 km/h", () => {
    const car = makeCar(50, wallAcross(40));
    drive(car, { throttle: 1 }, 2);
    expect(front(car)).toBeLessThan(40.3);
  });

  it('stops at a thin wall from its back side too', () => {
    // A wall the car meets from the other side of its quad (the line runs the other way).
    const car = makeCar(25, { buildings: [], roads: [], barriers: [{ id: 'w', kind: 'fence', h: 1.8, points: [[30, -30], [-30, -30]] }] });
    drive(car, { throttle: 1 }, 3);
    expect(front(car)).toBeLessThan(30.3);
  });

  it('scrapes along a wall it hits at a shallow angle instead of stopping dead', () => {
    // A wall along the car's path, slightly angled into it.
    const solids: Solids = { buildings: [], roads: [], barriers: [{ id: 'w', kind: 'wall', h: 2.4, points: [[-1.2, 0], [4, -120]] }] };
    const car = makeCar(25, solids);
    drive(car, { throttle: 1 }, 2.5);
    expect(car.vc.currentVehicleSpeed()).toBeGreaterThan(12);
    expect(car.body.translation().z).toBeGreaterThan(40);
    expect(car.maxTilt).toBeLessThan(30);
  });

  it('can still drive away after a crash', () => {
    const car = makeCar(20, buildingAhead(25));
    drive(car, { throttle: 1 }, 2);
    drive(car, { brake: 1 }, 2); // reverse out
    expect(car.vc.currentVehicleSpeed()).toBeLessThan(-2);
    expect(front(car)).toBeLessThan(24);
  });
});

describe('the Sedan on flyovers', () => {
  // A ramp straight ahead of the car (map -y is three.js +z): flat for 10 m, up to 7 m over 70 m, then flat on top.
  const ramp: Solids = {
    buildings: [],
    roads: [{ id: 'r', highway: 'primary', cls: 'major', w: 9, points: [[0, -10], [0, -20], [0, -90], [0, -300]], z: [0, 0, 7, 7] }],
  };

  it('drives up a ramp onto the flyover and stays on it', () => {
    const car = makeCar(15, ramp);
    drive(car, { throttle: 1 }, 6);
    const p = car.body.translation();
    expect(p.z).toBeGreaterThan(95); // past the top of the ramp
    expect(p.y).toBeGreaterThan(6.8); // up on the deck, not underneath it
    expect([0, 1, 2, 3].every((i) => car.vc.wheelIsInContact(i))).toBe(true);
  });

  it("can't drive off the side of the flyover: the barrier holds it", () => {
    const car = makeCar(15, ramp);
    drive(car, { throttle: 1 }, 5); // up on the deck
    drive(car, { throttle: 1, steer: 1 }, 2); // turn into the side
    expect(car.body.translation().y).toBeGreaterThan(6.5);
    expect(Math.abs(car.body.translation().x)).toBeLessThan(5);
  });

  it('drives underneath a high flyover between its pillars', () => {
    // 40 m long, so its pillar (every 30 m, starting 15 m in) stands 10 m to the car's left.
    const over: Solids = { buildings: [], roads: [{ id: 'o', highway: 'primary', cls: 'major', w: 12, points: [[-25, -40], [15, -40]], z: [8, 8] }] };
    const car = makeCar(15, over);
    drive(car, { throttle: 1 }, 4);
    expect(car.body.translation().z).toBeGreaterThan(50);
    expect(car.body.translation().y).toBeLessThan(1);
  });

  it("can't climb onto a raised deck from the side", () => {
    const side: Solids = { buildings: [], roads: [{ id: 's', highway: 'primary', cls: 'major', w: 10, points: [[-50, -30], [50, -30]], z: [2, 2] }] };
    const car = makeCar(15, side);
    drive(car, { throttle: 1 }, 3);
    expect(car.body.translation().z + SEDAN.halfExtents[2]).toBeLessThan(25.5);
    expect(car.body.translation().y).toBeLessThan(1);
  });
});

describe('crash detection', () => {
  it('counts a crash, with its change in speed', () => {
    const car = makeCar(20, { buildings: [{ id: 'b', type: 'yes', h: 20, hSrc: 'estimate', rings: [[[-30, -30], [30, -30], [30, -50], [-30, -50]]] }], roads: [] });
    drive(car, { throttle: 1 }, 3);
    expect(car.state.impacts).toBeGreaterThanOrEqual(1);
    expect(car.maxImpact).toBeGreaterThan(10);
  });
  it('never mistakes hard braking, a drift or a hard corner for a crash', () => {
    const car = makeCar(25);
    drive(car, { brake: 1 }, 3);
    drive(car, { throttle: 1 }, 4);
    drive(car, { steer: 1, handbrake: true }, 0.3);
    drive(car, { steer: 1, throttle: 1 }, 2);
    drive(car, { steer: -1, throttle: 1 }, 2);
    expect(car.state.impacts).toBe(0);
  });
});

describe('the Sedan on the real map', () => {
  // The Kalayaan Overpass, westbound: the approach road (way/744999969) splits at a gore
  // into the ramp (way/23240433, 7 m up over 36 m) on the left and a frontage road on the right.
  const map = JSON.parse(bgc) as MapData;
  const heading = Math.atan2(501 - 495, -547 - -525); // along the approach road
  const at = { x: -530, z: -496.4, yaw: Math.atan2(Math.cos(heading), -Math.sin(heading)) };
  const climb = (steer: number) => {
    const car = makeCar(0, map, at);
    drive(car, { throttle: 1 }, 1);
    drive(car, { throttle: 1, steer }, 0.8);
    drive(car, { throttle: 1 }, 5);
    return car;
  };

  it('gets up the Kalayaan Overpass ramp onto the deck', () => {
    const car = climb(0.1); // a slight left, onto the ramp
    expect(car.body.translation().y).toBeGreaterThan(6.8);
    expect(car.maxTilt).toBeLessThan(25);
  });

  it('is held on by the ramp barrier even going straight at the gore, where the ramp overlaps the frontage road', () => {
    const car = climb(0);
    expect(car.maxTilt).toBeLessThan(45); // no roll off the ramp's edge
  });
});
