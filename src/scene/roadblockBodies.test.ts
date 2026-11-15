import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { ROADBLOCK_BODIES } from '../geometry/roadblocks';
import { ParkedPoses } from './parkedPoses';
import { ParkedPool } from './parkedPool';
import { createRoadblockBody, ROADBLOCK_POOL, ROADBLOCK_Y, type LooseProp } from './roadblockBodies';

beforeAll(async () => {
  await RAPIER.init();
});

const DT = 1 / 60;
function world() {
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  w.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, ROADBLOCK_Y - 0.5, 0));
  return w;
}
const prop = (kind: LooseProp['kind'], x = 0): LooseProp => ({ kind, p: [x, 0], rot: Math.PI / 2 });

describe('roadblock bodies', () => {
  it('stand still and asleep on their spot, upright', () => {
    for (const kind of ['cone', 'drum', 'barricade', 'sign'] as const) {
      const w = world();
      const b = createRoadblockBody(RAPIER, w, prop(kind), ROADBLOCK_Y);
      for (let i = 0; i < 60; i++) w.step();
      expect(b.translation().y, kind).toBeCloseTo(ROADBLOCK_Y, 1);
      expect(b.rotation().w ** 2 + b.rotation().y ** 2, kind).toBeCloseTo(1, 3); // still upright
      expect(b.isSleeping(), kind).toBe(true);
    }
  });

  it('are light: a car-sized hit sends a cone flying and knocks a barricade over', () => {
    const w = world();
    const cone = createRoadblockBody(RAPIER, w, prop('cone'), ROADBLOCK_Y);
    const barricade = createRoadblockBody(RAPIER, w, prop('barricade', 10), ROADBLOCK_Y);
    // A 1,200 kg car at 15 m/s hitting along the row.
    const car = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-6, ROADBLOCK_Y + 0.7, 0).setLinvel(15, 0, 0));
    w.createCollider(RAPIER.ColliderDesc.cuboid(2.15, 0.6, 0.95).setMass(1200).setFriction(0), car);
    for (let i = 0; i < 150; i++) w.step();
    expect(Math.hypot(cone.translation().x, cone.translation().z)).toBeGreaterThan(3);
    const r = barricade.rotation();
    const tilt = (Math.acos(Math.min(1, 1 - 2 * (r.x * r.x + r.z * r.z))) * 180) / Math.PI;
    expect(tilt + Math.abs(barricade.translation().x - 10)).toBeGreaterThan(10);
    expect(car.linvel().x).toBeGreaterThan(8); // the car barely slows down
    expect(ROADBLOCK_BODIES.cone.mass).toBeLessThan(ROADBLOCK_BODIES.drum.mass);
  });

  it('run through the shared pool: near the player only, and back on their spot once out of sight', () => {
    const w = world();
    const props = [prop('drum', 10), prop('cone', ROADBLOCK_POOL.radius! + 30)];
    const poses = new ParkedPoses();
    const pool = new ParkedPool(RAPIER, w, props, poses, ROADBLOCK_Y, [-500, -500], ROADBLOCK_POOL);
    const run = (s: number, onScreen = () => true) => {
      for (let i = 0; i < Math.round(s / DT); i++) {
        w.step();
        pool.update([0, 0], DT, onScreen);
      }
    };
    run(0.2);
    expect([...pool.bodies.keys()]).toEqual([0]);
    pool.bodies.get(0)!.applyImpulse({ x: 60, y: 0, z: 0 }, true);
    run(1.5);
    expect(poses.moved.has(0)).toBe(true);
    run(3, () => false);
    expect(poses.moved.has(0)).toBe(false);
  });
});
