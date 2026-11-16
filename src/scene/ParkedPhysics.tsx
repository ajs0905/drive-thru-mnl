/**
 * Parked cars in the physics world (Drive mode): runs the pool (parkedPool.ts) once per
 * frame, after the physics step, with the player's position and what's on screen. The
 * roadblocks' loose pieces run through it too, with their own `options` and `groundY`.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useEffect, useMemo } from 'react';
import { Frustum, Matrix4, Sphere, Vector3 } from 'three';
import { screenTest } from './screenTest';
import { PARKED_Y, type ParkedPoses } from './parkedPoses';
import { ParkedPool, type Placed, type PoolOptions } from './parkedPool';

export function ParkedPhysics<T extends Placed>({
  cars,
  poses,
  spawn,
  options,
  groundY = PARKED_Y,
}: {
  cars: T[];
  poses: ParkedPoses;
  spawn: [number, number];
  /** Keep this object stable (a module constant): the pool is rebuilt when it changes. */
  options?: PoolOptions<T>;
  groundY?: number;
}) {
  const { world, rapier } = useRapier();
  const controls = useThree((st) => st.controls) as unknown as { target?: Vector3 } | null;
  const pool = useMemo(() => new ParkedPool<T>(rapier, world, cars, poses, groundY, spawn, options), [rapier, world, cars, poses, groundY, spawn, options]);
  useEffect(() => () => pool.dispose(), [pool]);

  const view = useMemo(() => ({ frustum: new Frustum(), m: new Matrix4(), sphere: new Sphere(new Vector3(), 3) }), []);
  useFrame(({ camera }, dt) => {
    const focus = controls?.target;
    if (!focus) return;
    pool.update([focus.x, -focus.z], dt, screenTest(view, camera.projectionMatrix, camera.matrixWorldInverse));
  });
  return null;
}
