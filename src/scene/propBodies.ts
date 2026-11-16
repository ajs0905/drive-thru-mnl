/**
 * Physics bodies for the street furniture the car can knock over (planters, bins,
 * hydrants, benches, lamps, street and traffic lights; `PROP_PHYSICS` 'knock'), made by the
 * shared pool (parkedPool.ts) when the player gets near: on their spot and asleep until
 * hit, a box the size of the piece (for poles, the pole), back on their spot once out of
 * sight. Their pool is capped, so a street lined with them never has more than
 * `PROP_POOL.max` bodies at once.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import { yawForHeading } from '../car/spawn';
import { DRESSING, PROP_PHYSICS } from '../geometry/dressing';
import type { DressingKind, Point } from '../map/types';
import type { PoolOptions } from './parkedPool';

/** A piece as the pool sees it: its heading is the piece's `rot` less a quarter turn (the pool turns +z to a heading, the models lie along +x). */
export interface PropItem {
  k: DressingKind;
  p: Point;
  rot: number;
}

/** Props stand on the physics ground's top (the sidewalks are drawn a little lower). */
export const PROP_Y = 0.2;

export const PROP_POOL: PoolOptions<PropItem> = {
  radius: 35,
  margin: 10,
  max: 28,
  restSleep: 3,
  createBody: (rapier, world, item, groundY) => createPropBody(rapier, world, item, groundY),
};

/** The pool's view of a dressing piece. */
export const propItem = (d: { k: DressingKind; p: Point; rot: number }): PropItem => ({ k: d.k, p: d.p, rot: d.rot - Math.PI / 2 });

export function createPropBody(rapier: typeof RAPIER, world: RAPIER.World, item: PropItem, groundY: number): RAPIER.RigidBody {
  const [l, w, h] = DRESSING[item.k].size;
  const mass = PROP_PHYSICS[item.k]?.mass ?? 50;
  const yaw = yawForHeading(item.rot);
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.dynamic()
      .setTranslation(item.p[0], groundY, -item.p[1])
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setLinearDamping(0.3)
      .setAngularDamping(0.5)
      .setCanSleep(true),
  );
  // The yaw comes out as the piece's own rot (what the renderer turns the model by), so the
  // body's local x is the piece's length, like the model's.
  world.createCollider(rapier.ColliderDesc.cuboid(l / 2, h / 2, w / 2).setTranslation(0, h / 2 + 0.01, 0).setMass(mass).setFriction(0.7).setRestitution(0.15), body);
  body.sleep();
  return body;
}
