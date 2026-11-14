/**
 * Parked cars in the physics world (Drive mode): runs the pool (parkedPool.ts) once per
 * frame, after the physics step, with the player's position and what's on screen.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useEffect, useMemo } from 'react';
import { Frustum, Matrix4, Sphere, Vector3 } from 'three';
import type { ParkedCar } from '../map/types';
import { PARKED_Y, type ParkedPoses } from './parkedPoses';
import { ParkedPool } from './parkedPool';

export function ParkedPhysics({ cars, poses, spawn }: { cars: ParkedCar[]; poses: ParkedPoses; spawn: [number, number] }) {
  const { world, rapier } = useRapier();
  const controls = useThree((st) => st.controls) as unknown as { target?: Vector3 } | null;
  const pool = useMemo(() => new ParkedPool(rapier, world, cars, poses, PARKED_Y, spawn), [rapier, world, cars, poses, spawn]);
  useEffect(() => () => pool.dispose(), [pool]);

  const view = useMemo(() => ({ frustum: new Frustum(), m: new Matrix4(), sphere: new Sphere(new Vector3(), 3) }), []);
  useFrame(({ camera }, dt) => {
    const focus = controls?.target;
    if (!focus) return;
    pool.update([focus.x, -focus.z], dt, screenTest(view, camera.projectionMatrix, camera.matrixWorldInverse));
  });
  return null;
}

/** A test for "is this point (with a car's size around it) on screen?" for this frame. */
function screenTest(view: { frustum: Frustum; m: Matrix4; sphere: Sphere }, projection: Matrix4, inverseWorld: Matrix4) {
  view.frustum.setFromProjectionMatrix(view.m.multiplyMatrices(projection, inverseWorld));
  return (x: number, y: number, z: number) => view.frustum.intersectsSphere(view.sphere.set(view.sphere.center.set(x, y + 1, z), 3));
}
