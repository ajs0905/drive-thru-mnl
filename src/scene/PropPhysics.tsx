/**
 * Street furniture in the physics world (Drive mode): the knockable pieces through the
 * shared pool (capped, see propBodies.ts), and the breakaway ones (sheds, kiosks, the
 * booth) through `Breakaways`, which checks the car's path before each physics step.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useMemo, type RefObject } from 'react';
import { Frustum, Matrix4, Sphere, Vector3 } from 'three';
import { headingOfDirection } from '../car/spawn';
import type { Dressing } from '../map/types';
import { Breakaways, type DebrisStore } from './breakaway';
import { ParkedPhysics } from './ParkedPhysics';
import type { ParkedPoses } from './parkedPoses';
import { PROP_POOL, PROP_Y, propItem } from './propBodies';
import { screenTest } from './screenTest';

export function PropPhysics({
  knock,
  broke,
  knockPoses,
  breakPoses,
  debris,
  spawn,
  car,
}: {
  knock: Dressing[];
  broke: Dressing[];
  knockPoses: ParkedPoses;
  breakPoses: ParkedPoses;
  debris: DebrisStore;
  spawn: [number, number];
  car: RefObject<RapierRigidBody | null>;
}) {
  const { world, rapier } = useRapier();
  const items = useMemo(() => knock.map(propItem), [knock]);
  const breaks = useMemo(() => new Breakaways(rapier, world, broke, breakPoses, debris, PROP_Y), [rapier, world, broke, breakPoses, debris]);
  useEffect(() => () => breaks.dispose(), [breaks]);

  useBeforePhysicsStep((w) => {
    const b = car.current;
    if (!b) return;
    const t = b.translation();
    const r = b.rotation();
    const heading = headingOfDirection(2 * (r.x * r.z + r.w * r.y), 1 - 2 * (r.x * r.x + r.y * r.y));
    breaks.beforeStep({ p: [t.x, -t.z], v: b.linvel(), heading }, w.timestep);
  });

  const controls = useThree((st) => st.controls) as unknown as { target?: Vector3 } | null;
  const view = useMemo(() => ({ frustum: new Frustum(), m: new Matrix4(), sphere: new Sphere(new Vector3(), 3) }), []);
  useFrame(({ camera }, dt) => {
    const focus = controls?.target;
    if (!focus) return;
    breaks.update([focus.x, -focus.z], dt, screenTest(view, camera.projectionMatrix, camera.matrixWorldInverse));
  });

  return items.length > 0 ? <ParkedPhysics cars={items} poses={knockPoses} spawn={spawn} options={PROP_POOL} groundY={PROP_Y} /> : null;
}
