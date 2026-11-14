import { Matrix4, Quaternion, Vector3 } from 'three';
import { yawForHeading } from '../car/spawn';
import type { ParkedCar } from '../map/types';
import { ROAD_Y } from './cityGeometry';

/** Parked cars stand on minor-road asphalt (the physics ground's top is there too). */
export const PARKED_Y = ROAD_Y.minor;

/** A car's pose on its spot, three.js space, model origin on the ground; optionally scaled. */
export function homePose(car: ParkedCar, out = new Matrix4(), scale = new Vector3(1, 1, 1)): Matrix4 {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yawForHeading(car.rot));
  return out.compose(new Vector3(car.p[0], PARKED_Y, -car.p[1]), q, scale);
}

/**
 * Where moved parked cars are now, shared between the physics (Drive mode writes it) and
 * the parked car renderer (which draws everything else where it was parked). One per map.
 */
export interface Pose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export class ParkedPoses {
  /** Moved cars by index into `map.parked`, in three.js space (model origin on the ground). */
  readonly moved = new Map<number, Pose>();
  /** Bumped on every change, so the renderer knows to redraw. */
  version = 0;

  set(i: number, pose: Pose) {
    this.moved.set(i, pose);
    this.version++;
  }

  clear(i: number) {
    if (this.moved.delete(i)) this.version++;
  }

  clearAll() {
    if (this.moved.size) this.version++;
    this.moved.clear();
  }
}
