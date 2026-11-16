/** The pools' on-screen test (parked cars, roadblock pieces, street furniture, debris). */
import type { Frustum, Matrix4, Sphere } from 'three';

/** A test for "is this point (with a car's size around it) on screen?" for this frame. */
export function screenTest(view: { frustum: Frustum; m: Matrix4; sphere: Sphere }, projection: Matrix4, inverseWorld: Matrix4) {
  view.frustum.setFromProjectionMatrix(view.m.multiplyMatrices(projection, inverseWorld));
  return (x: number, y: number, z: number) => view.frustum.intersectsSphere(view.sphere.set(view.sphere.center.set(x, y + 1, z), 3));
}
