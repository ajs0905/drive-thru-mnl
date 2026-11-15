/**
 * The parked cars in the physics world, run once per frame by ParkedPhysics.tsx (Drive
 * mode). Kept out of the component so it can be tested in the real physics engine. The
 * roadblocks' loose pieces (cones, drums, barricades, signs) use the same pool, with
 * their own bodies and radius (`PoolOptions`).
 *
 * - Only the cars within `PARKED.physicsRadius` of the player are bodies (a pool,
 *   refreshed every few frames). They start asleep on their spots and wake when hit.
 * - A moved car is written to `ParkedPoses`, so the renderer draws it where it is.
 * - It goes back to its spot once neither it nor its spot has been on screen for a
 *   moment and it's nearly still (an off-screen reset), as long as the player isn't on the
 *   spot. A moved car still on screen keeps its body even past the radius, so nothing
 *   vanishes in view; one dropped from the pool off screen is back on its spot next time.
 * - Cars parked where the player appears are moved out of the way at the start (not
 *   drawn) and come back the same way, once their spot is clear and out of sight.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import { createParkedBody, isMoved, poolFor, shouldReturn } from '../car/parked';
import { yawForHeading } from '../car/spawn';
import type { ParkedPoses } from './parkedPoses';

/** Something with a spot in the world: a parked car, a cone. */
export interface Placed {
  p: [number, number];
  rot: number;
}

export interface PoolOptions<T extends Placed> {
  /** Makes the body for an item, on its spot and asleep (default: a parked car's). */
  createBody?: (rapier: typeof RAPIER, world: RAPIER.World, item: T, groundY: number) => RAPIER.RigidBody;
  /** Items within this distance of the player are bodies, and leave the pool this much farther out (m). */
  radius?: number;
  margin?: number;
}

const CELL = 50;
/** Refresh the pool every this many updates. */
const POOL_EVERY = 10;
/** Cars this close to where the player appears are cleared out of the way (m). */
const SPAWN_CLEAR = 4;
/** A spot counts as taken while the player's car is this close to it (m). */
const SPOT_TAKEN = 5;
/** Where cleared cars wait: under the ground, out of sight. */
const AWAY = { x: 0, y: -100, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

/** Is a point (three.js space) on screen? */
export type OnScreen = (x: number, y: number, z: number) => boolean;

export class ParkedPool<T extends Placed = { p: [number, number]; rot: number; v: number }> {
  readonly bodies = new Map<number, RAPIER.RigidBody>();
  private readonly hidden = new Map<number, number>();
  private readonly cleared = new Set<number>();
  private readonly grid = new Map<string, number[]>();
  private frame = 0;
  private readonly rapier: typeof RAPIER;
  private readonly world: RAPIER.World;
  private readonly cars: T[];
  private readonly poses: ParkedPoses;
  private readonly groundY: number;
  private readonly createBody: (rapier: typeof RAPIER, world: RAPIER.World, item: T, groundY: number) => RAPIER.RigidBody;
  private readonly radius?: number;
  private readonly margin?: number;

  constructor(rapier: typeof RAPIER, world: RAPIER.World, cars: T[], poses: ParkedPoses, groundY: number, spawn: [number, number], opts: PoolOptions<T> = {}) {
    this.rapier = rapier;
    this.world = world;
    this.cars = cars;
    this.poses = poses;
    this.groundY = groundY;
    this.createBody = opts.createBody ?? (createParkedBody as unknown as (rapier: typeof RAPIER, world: RAPIER.World, item: T, groundY: number) => RAPIER.RigidBody);
    this.radius = opts.radius;
    this.margin = opts.margin;
    cars.forEach((c, i) => {
      const k = `${Math.floor(c.p[0] / CELL)},${Math.floor(c.p[1] / CELL)}`;
      this.grid.set(k, [...(this.grid.get(k) ?? []), i]);
    });
    for (const i of this.near(spawn[0], spawn[1], SPAWN_CLEAR + 5)) {
      if (Math.hypot(cars[i].p[0] - spawn[0], cars[i].p[1] - spawn[1]) < SPAWN_CLEAR) {
        this.cleared.add(i);
        poses.set(i, AWAY);
      }
    }
  }

  /** Car indices in the grid cells within r of (x, y) (map space). */
  *near(x: number, y: number, r: number): Generator<number> {
    const n = Math.ceil(r / CELL);
    const [cx, cy] = [Math.floor(x / CELL), Math.floor(y / CELL)];
    for (let gx = cx - n; gx <= cx + n; gx++) for (let gy = cy - n; gy <= cy + n; gy++) yield* this.grid.get(`${gx},${gy}`) ?? [];
  }

  /** One frame: `player` in map space, after the physics step. */
  update(player: [number, number], dt: number, onScreen: OnScreen) {
    const { cars, poses } = this;
    const homeOnScreen = (i: number) => onScreen(cars[i].p[0], this.groundY, -cars[i].p[1]);
    const spotFree = (i: number) => Math.hypot(cars[i].p[0] - player[0], cars[i].p[1] - player[1]) > SPOT_TAKEN;

    for (const i of this.cleared) {
      if (!homeOnScreen(i) && spotFree(i)) {
        this.cleared.delete(i);
        poses.clear(i);
      }
    }

    for (const [i, body] of this.bodies) {
      if (body.isSleeping() && !poses.moved.has(i)) continue;
      const car = cars[i];
      const t = body.translation();
      const r = body.rotation();
      const yaw = yawForHeading(car.rot);
      const [hy, hw] = [Math.sin(yaw / 2), Math.cos(yaw / 2)];
      // Angle between the body's rotation and the home one (a turn around y): 2 acos |q1 . q2|.
      const turn = 2 * Math.acos(Math.min(1, Math.abs(r.y * hy + r.w * hw)));
      const offset = Math.hypot(t.x - car.p[0], t.y - this.groundY, t.z + car.p[1]);
      if (!isMoved(offset, turn)) {
        poses.clear(i);
        continue;
      }
      poses.set(i, { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w });
      const hidden = !onScreen(t.x, t.y, t.z) && !homeOnScreen(i);
      this.hidden.set(i, hidden ? (this.hidden.get(i) ?? 0) + dt : 0);
      const v = body.linvel();
      if (shouldReturn(this.hidden.get(i) ?? 0, Math.hypot(v.x, v.y, v.z)) && spotFree(i)) {
        body.setTranslation({ x: car.p[0], y: this.groundY, z: -car.p[1] }, false);
        body.setRotation({ x: 0, y: hy, z: 0, w: hw }, false);
        body.setLinvel({ x: 0, y: 0, z: 0 }, false);
        body.setAngvel({ x: 0, y: 0, z: 0 }, false);
        body.sleep();
        this.hidden.delete(i);
        poses.clear(i);
      }
    }

    if (this.frame++ % POOL_EVERY !== 0) return;
    const keep = (i: number) => poses.moved.has(i) && !this.cleared.has(i);
    const want = poolFor(cars, player, new Set(this.bodies.keys()), keep, (x, y, r) => this.near(x, y, r), this.radius, this.margin);
    for (const i of this.cleared) want.delete(i);
    for (const [i, body] of this.bodies) {
      if (want.has(i)) continue;
      this.world.removeRigidBody(body);
      this.bodies.delete(i);
      this.hidden.delete(i);
      poses.clear(i); // only moved cars that are off screen get here: back on their spot
    }
    for (const i of want) if (!this.bodies.has(i)) this.bodies.set(i, this.createBody(this.rapier, this.world, cars[i], this.groundY));
  }

  /** Leaving Drive mode: remove the bodies; every car back on its spot. */
  dispose() {
    for (const body of this.bodies.values()) if (this.world.getRigidBody(body.handle)) this.world.removeRigidBody(body);
    this.bodies.clear();
    this.poses.clearAll();
  }
}
