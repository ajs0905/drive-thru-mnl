/**
 * Physics bodies for the roadblocks' loose pieces (cones, drums, barricades, signs), made
 * by the shared pool (parkedPool.ts) when the player gets near: on their spot and asleep,
 * light enough that the car sends them flying, back on their spot once out of sight.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import { yawForHeading } from '../car/spawn';
import { ROADBLOCK, ROADBLOCK_BODIES, type LooseKind, type RoadblockProp } from '../geometry/roadblocks';
import type { PoolOptions } from './parkedPool';

export type LooseProp = RoadblockProp & { kind: LooseKind };

/** Pieces stand on the physics ground's top (roads are drawn at 0.16 to 0.24 m). */
export const ROADBLOCK_Y = 0.2;

/** The pool settings for the loose pieces: smaller than parked cars, so a smaller radius. A constant, so the pool isn't rebuilt. */
export const ROADBLOCK_POOL: PoolOptions<LooseProp> = { radius: 45, margin: 10, createBody: (rapier, world, prop, groundY) => createRoadblockBody(rapier, world, prop, groundY) };

export function createRoadblockBody(rapier: typeof RAPIER, world: RAPIER.World, prop: LooseProp, groundY: number): RAPIER.RigidBody {
  const { mass, half } = ROADBLOCK_BODIES[prop.kind];
  const yaw = yawForHeading(prop.rot);
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.dynamic()
      .setTranslation(prop.p[0], groundY, -prop.p[1])
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setLinearDamping(0.2)
      .setAngularDamping(0.4)
      .setCanSleep(true),
  );
  const [hx, hy, hz] = half.map((h) => h * ROADBLOCK.scale);
  const shape =
    prop.kind === 'cone'
      ? rapier.ColliderDesc.cone(hy, hx)
      : prop.kind === 'drum'
        ? rapier.ColliderDesc.cylinder(hy, hx)
        : rapier.ColliderDesc.cuboid(hx, hy, hz);
  world.createCollider(shape.setTranslation(0, hy + 0.01, 0).setMass(mass).setFriction(0.6).setRestitution(0.2), body);
  body.sleep();
  return body;
}
