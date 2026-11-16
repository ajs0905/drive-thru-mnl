/**
 * Waiting sheds, kiosks and the parking yard's booth in the physics world (Drive mode):
 * fixed in place near the player, so a slow bump stops the car like a wall, but hit
 * faster than `BREAKAWAY.speed` they come apart: the fixed body goes before the physics
 * step that would have stopped the car, and their `DEBRIS` parts fly off as light dynamic
 * bodies carried along with the car's speed. Kept out of the components so it can be
 * tested in the real physics engine.
 *
 * Budgets: fixed bodies only within `BREAK.radius` of the player; at most `BREAK.debris`
 * debris bodies (the oldest goes first); debris lying still for `BREAK.rest` seconds is put
 * to sleep, and debris off screen for `BREAK.keep` seconds is removed. A broken piece is
 * whole again once the player is far away and neither it nor its debris is on screen.
 * Debris casts no shadows (the renderer, scene/Debris.tsx).
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import { BREAKAWAY, DEBRIS, DRESSING, dressingCorners, type DebrisPart } from '../geometry/dressing';
import type { Dressing, Point } from '../map/types';
import type { OnScreen } from './parkedPool';
import type { ParkedPoses, Pose } from './parkedPoses';

export const BREAK = {
  radius: 40,
  /** Debris bodies at most, how long debris lies still before it sleeps (s), and how long it stays once off screen (s). */
  debris: 30,
  rest: 3,
  keep: 12,
  /** A broken piece is put back once the player is this far (m) and nothing of it is on screen. */
  restoreFrom: 70,
  /** How far ahead (in physics steps) the car's path is checked against a piece, and the room (m) around both. */
  lookAhead: 3,
  margin: 0.3,
  /** The car's footprint (m). */
  car: [4.45, 2.0] as const,
  /** The debris leaves with this share of the car's velocity, plus a hop up (m/s). */
  carry: 0.75,
  hop: 2.5,
};

/** Where a broken piece's home pose goes, so the renderer leaves it out: under the ground. */
const GONE: Pose = { x: 0, y: -100, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

/** The debris now flying or lying about, for the renderer: pose, size and color of each part, and a version bumped on every change. */
export class DebrisStore {
  parts: { pose: Pose; size: [number, number, number]; color: string }[] = [];
  version = 0;
}

interface Piece {
  body: RAPIER.RigidBody;
  part: DebrisPart;
  owner: number;
  born: number;
  still: number;
  hidden: number;
}

/** Do two convex polygons overlap (separating axis test)? */
function overlaps(a: Point[], b: Point[]): boolean {
  for (const ring of [a, b])
    for (let i = 0; i < ring.length; i++) {
      const [p, q] = [ring[i], ring[(i + 1) % ring.length]];
      const n: Point = [q[1] - p[1], p[0] - q[0]];
      const span = (r: Point[]) => r.map((v) => v[0] * n[0] + v[1] * n[1]);
      const [sa, sb] = [span(a), span(b)];
      if (Math.max(...sa) <= Math.min(...sb) || Math.max(...sb) <= Math.min(...sa)) return false;
    }
  return true;
}

export class Breakaways {
  readonly fixed = new Map<number, RAPIER.RigidBody>();
  readonly broken = new Set<number>();
  readonly debris: Piece[] = [];
  private time = 0;
  private readonly rapier: typeof RAPIER;
  private readonly world: RAPIER.World;
  private readonly pieces: Dressing[];
  private readonly poses: ParkedPoses;
  private readonly store: DebrisStore;
  private readonly groundY: number;

  constructor(rapier: typeof RAPIER, world: RAPIER.World, pieces: Dressing[], poses: ParkedPoses, store: DebrisStore, groundY: number) {
    this.rapier = rapier;
    this.world = world;
    this.pieces = pieces;
    this.poses = poses;
    this.store = store;
    this.groundY = groundY;
  }

  /**
   * Before a physics step: breaks whatever the car (map position, three.js velocity, map
   * heading) is about to hit faster than the break speed.
   */
  beforeStep(car: { p: Point; v: { x: number; y: number; z: number }; heading: number }, dt: number) {
    const speed = Math.hypot(car.v.x, car.v.z);
    if (speed < BREAKAWAY.speed) return;
    const ahead: Point = [car.p[0] + car.v.x * dt * BREAK.lookAhead, car.p[1] - car.v.z * dt * BREAK.lookAhead];
    const [hl, hw] = [BREAK.car[0] / 2 + BREAK.margin, BREAK.car[1] / 2 + BREAK.margin];
    const [c, s] = [Math.cos(car.heading), Math.sin(car.heading)];
    const box = (q: Point): Point[] => [
      [q[0] + c * hl - s * hw, q[1] + s * hl + c * hw],
      [q[0] - c * hl - s * hw, q[1] - s * hl + c * hw],
      [q[0] - c * hl + s * hw, q[1] - s * hl - c * hw],
      [q[0] + c * hl + s * hw, q[1] + s * hl - c * hw],
    ];
    const [now, next] = [box(car.p), box(ahead)];
    for (const i of this.fixed.keys()) {
      const d = this.pieces[i];
      const foot = dressingCorners(d.k, d.p, d.rot, BREAK.margin);
      if (overlaps(now, foot) || overlaps(next, foot)) this.breakApart(i, car.v);
    }
  }

  /** Takes piece i apart: its fixed body goes, its debris flies off with the car. */
  breakApart(i: number, v: { x: number; y: number; z: number }) {
    const body = this.fixed.get(i);
    if (body) this.world.removeRigidBody(body);
    this.fixed.delete(i);
    this.broken.add(i);
    this.poses.set(i, GONE);
    const d = this.pieces[i];
    const [c, s] = [Math.cos(d.rot), Math.sin(d.rot)];
    const q = { x: 0, y: Math.sin(d.rot / 2), z: 0, w: Math.cos(d.rot / 2) };
    for (const part of DEBRIS[d.k] ?? []) {
      // The part's center: along the piece's length (x), up, across (model +z is the map's right of rot).
      const [ax, ay, az] = part.at;
      const mx = d.p[0] + c * ax + s * az;
      const my = d.p[1] + s * ax - c * az;
      const b = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.dynamic()
          .setTranslation(mx, this.groundY + ay, -my)
          .setRotation(q)
          .setLinvel(v.x * BREAK.carry + (Math.random() - 0.5) * 2, BREAK.hop + Math.random() * 2, v.z * BREAK.carry + (Math.random() - 0.5) * 2)
          .setAngvel({ x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 })
          .setLinearDamping(0.2)
          .setAngularDamping(0.4)
          .setCanSleep(true),
      );
      this.world.createCollider(this.rapier.ColliderDesc.cuboid(part.size[0] / 2, part.size[1] / 2, part.size[2] / 2).setMass(part.mass).setFriction(0.6).setRestitution(0.2), b);
      this.debris.push({ body: b, part, owner: i, born: this.time, still: 0, hidden: 0 });
    }
    // Over budget: the oldest debris goes.
    while (this.debris.length > BREAK.debris) this.world.removeRigidBody(this.debris.shift()!.body);
    this.write();
  }

  /** One frame, after the physics step: `player` in map space. */
  update(player: Point, dt: number, onScreen: OnScreen) {
    this.time += dt;
    // Fixed bodies for the whole pieces near the player.
    for (let i = 0; i < this.pieces.length; i++) {
      const d = this.pieces[i];
      const near = Math.hypot(d.p[0] - player[0], d.p[1] - player[1]) < BREAK.radius;
      const has = this.fixed.get(i);
      if (near && !has && !this.broken.has(i)) this.fixed.set(i, this.createFixed(d));
      else if (!near && has) {
        this.world.removeRigidBody(has);
        this.fixed.delete(i);
      }
    }
    // Debris: asleep once still, gone once off screen for a while.
    let changed = false;
    for (let k = this.debris.length - 1; k >= 0; k--) {
      const piece = this.debris[k];
      const { body } = piece;
      const t = body.translation();
      const v = body.linvel();
      const w = body.angvel();
      piece.still = Math.hypot(v.x, v.y, v.z) < 0.15 && Math.hypot(w.x, w.y, w.z) < 0.25 ? piece.still + dt : 0;
      if (piece.still > BREAK.rest && !body.isSleeping()) body.sleep();
      piece.hidden = onScreen(t.x, t.y, t.z) ? 0 : piece.hidden + dt;
      if (piece.hidden > BREAK.keep || t.y < -20) {
        this.world.removeRigidBody(body);
        this.debris.splice(k, 1);
        changed = true;
      } else if (!body.isSleeping()) changed = true;
    }
    // Broken pieces whole again once the player is far and none of it is in view.
    for (const i of this.broken) {
      const d = this.pieces[i];
      if (Math.hypot(d.p[0] - player[0], d.p[1] - player[1]) < BREAK.restoreFrom) continue;
      if (onScreen(d.p[0], this.groundY, -d.p[1]) || this.debris.some((p) => p.owner === i)) continue;
      this.broken.delete(i);
      this.poses.clear(i);
    }
    if (changed) this.write();
  }

  private createFixed(d: Dressing): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(d.p[0], this.groundY, -d.p[1])
        .setRotation({ x: 0, y: Math.sin(d.rot / 2), z: 0, w: Math.cos(d.rot / 2) }),
    );
    const [l, w, h] = DRESSING[d.k].size;
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(l / 2, h / 2, w / 2).setTranslation(0, h / 2, 0).setFriction(0.3), body);
    return body;
  }

  /** The debris poses, for the renderer. */
  private write() {
    this.store.parts = this.debris.map(({ body, part }) => {
      const t = body.translation();
      const r = body.rotation();
      return { pose: { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w }, size: part.size, color: part.color };
    });
    this.store.version++;
  }

  /** Leaving Drive mode: every body gone, every piece whole. */
  dispose() {
    for (const b of this.fixed.values()) if (this.world.getRigidBody(b.handle)) this.world.removeRigidBody(b);
    for (const p of this.debris) if (this.world.getRigidBody(p.body.handle)) this.world.removeRigidBody(p.body);
    this.fixed.clear();
    this.debris.length = 0;
    this.broken.clear();
    this.poses.clearAll();
    this.store.parts = [];
    this.store.version++;
  }
}
