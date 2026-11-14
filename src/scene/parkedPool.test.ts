import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { PARKED } from '../car/parked';
import type { ParkedCar } from '../map/types';
import { ParkedPoses } from './parkedPoses';
import { ParkedPool } from './parkedPool';

beforeAll(async () => {
  await RAPIER.init();
});

const GROUND = 0.2;
const DT = 1 / 60;
function setup(cars: ParkedCar[], spawn: [number, number] = [-500, -500]) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, GROUND - 0.5, 0));
  const poses = new ParkedPoses();
  const pool = new ParkedPool(RAPIER, world, cars, poses, GROUND, spawn);
  const run = (player: [number, number], seconds: number, onScreen = () => true) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      world.step();
      pool.update(player, DT, onScreen);
    }
  };
  return { world, poses, pool, run };
}
const car = (x: number, y: number): ParkedCar => ({ p: [x, y], rot: 0, v: 0, c: 0 });

describe('ParkedPool', () => {
  it('gives bodies only to the cars near the player', () => {
    const { pool, run } = setup([car(10, 0), car(PARKED.physicsRadius + 30, 0)]);
    run([0, 0], 0.2);
    expect([...pool.bodies.keys()]).toEqual([0]);
  });

  it('draws a shoved car where it is while on screen, and sends it home once out of sight and still', () => {
    const { pool, poses, run } = setup([car(10, 0)]);
    run([0, 0], 0.1);
    pool.bodies.get(0)!.applyImpulse({ x: 4000, y: 0, z: 0 }, true);
    run([0, 0], 1.5);
    expect(poses.moved.has(0)).toBe(true);
    const moved = poses.moved.get(0)!;
    expect(moved.x).toBeGreaterThan(10.5);
    run([0, 0], 2); // still on screen: stays where it ended up
    expect(poses.moved.has(0)).toBe(true);
    run([0, 0], PARKED.hiddenFor + 0.5, () => false);
    expect(poses.moved.has(0)).toBe(false);
    const t = pool.bodies.get(0)!.translation();
    expect(Math.hypot(t.x - 10, t.z)).toBeLessThan(0.01);
    run([0, 0], 3, () => false); // and settles back to sleep there
    expect(pool.bodies.get(0)!.isSleeping()).toBe(true);
    expect(poses.moved.has(0)).toBe(false);
  });

  it("doesn't put a car back on its spot while the player is standing there", () => {
    const { pool, poses, run } = setup([car(10, 0)]);
    run([0, 0], 0.1);
    pool.bodies.get(0)!.applyImpulse({ x: 0, y: 0, z: 6000 }, true);
    run([10, 0], 3, () => false);
    expect(poses.moved.has(0)).toBe(true);
    run([30, 0], PARKED.hiddenFor + 0.5, () => false);
    expect(poses.moved.has(0)).toBe(false);
  });

  it('moves cars parked where the player appears out of the way, and brings them back unseen once the spot is free', () => {
    const { pool, poses, run } = setup([car(0, 1), car(30, 0)], [0, 0]);
    expect(poses.moved.get(0)?.y).toBeLessThan(-50);
    run([0, 0], 0.5, () => false);
    expect(pool.bodies.has(0)).toBe(false);
    expect(poses.moved.has(0)).toBe(true);
    run([40, 0], 0.5, () => false);
    expect(poses.moved.has(0)).toBe(false);
    expect(pool.bodies.has(0)).toBe(true);
  });

  it('drops a far car from the pool: back on its spot if out of sight, kept if still on screen', () => {
    const { pool, poses, run } = setup([car(10, 0)]);
    run([0, 0], 0.1);
    pool.bodies.get(0)!.applyImpulse({ x: 4000, y: 0, z: 0 }, true);
    run([0, 0], 1);
    run([500, 0], 0.5); // far, but on screen
    expect(pool.bodies.has(0)).toBe(true);
    run([500, 0], PARKED.hiddenFor + 0.5, () => false);
    expect(pool.bodies.has(0)).toBe(false);
    expect(poses.moved.has(0)).toBe(false);
  });

  it('removes every body and puts every car back when driving ends', () => {
    const { world, pool, poses, run } = setup([car(10, 0), car(0, 1)], [0, 0]);
    run([0, 0], 0.2);
    pool.dispose();
    expect(pool.bodies.size).toBe(0);
    expect(poses.moved.size).toBe(0);
    expect(world.bodies.len()).toBe(0); // the ground is a collider without a body
  });
});
