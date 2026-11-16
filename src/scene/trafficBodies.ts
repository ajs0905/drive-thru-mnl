/**
 * Traffic's side of the physics (drawn by Traffic.tsx): each step, the simulation, and the
 * bodies of the cars near the player.
 *
 * - Cars within `PHYSICS_RADIUS` of the player are kinematic bodies that follow the
 *   simulation exactly: solid to the player, pushed by nothing.
 * - When the player's car (or a car already knocked loose) touches one, that car is
 *   knocked out of the flow: its body turns dynamic and gets the impulse the bump would
 *   have given it at the point they touched (traffic/impact.ts), so it's shoved and spun
 *   the way it was hit, and the car that hit it keeps the momentum it didn't hand over
 *   (instead of bouncing off an unmovable body).
 * - Knocked cars slide sideways on their tires' grip, roll on along their length and stay
 *   upright. Once one has settled facing along a lane, it steers back onto it and rejoins
 *   the flow (TrafficSim.rejoin).
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { yawForHeading } from '../car/spawn';
import { closestOnBox, impactOf, type Vec2 } from '../traffic/impact';
import type { Agent, Obstacle, TrafficSim } from '../traffic/sim';
import { ROAD_Y } from './cityGeometry';

/** Cars this close (m) to the player are physics bodies. */
export const PHYSICS_RADIUS = 70;
/** Masses (kg): traffic cars, and the player's car (car/spec.ts SEDAN). */
const MASS = 1200;
const PLAYER_MASS = 1200;
/**
 * Knocked cars: sideways grip and rolling drag of the tires (m/s²; the box's own friction
 * is low, and the lower of the two in a contact counts, so these decide it), yaw damping, and when a car may rejoin: at least `after` s
 * after the knock, turning slower than `turn` rad/s and sliding slower than `slide` m/s
 * for `settle` s, rolling no faster than `roll` m/s, with the player at least `clear` m away.
 */
export const KNOCKED = { grip: 7, rolling: 1.2, friction: 0.08, angularDamping: 0.8, after: 1.5, turn: 0.35, slide: 0.8, settle: 0.6, roll: 6, clear: 7 };
/** Kept between steps (no garbage each step): the player as an obstacle, and the cars still around. */
const PLAYER: Obstacle = { p: [0, 0], speed: 0, heading: 0, half: 2.25 };
const PLAYER_LIST = [PLAYER];
const NOTHING: Obstacle[] = [];
const ALIVE = new Set<number>();

/** A knocked car's state on the physics side: when it was knocked (s), how long it's been settled (s), and its velocity a step ago (three.js x, z). */
export interface Loose {
  at: number;
  still: number;
  vx: number;
  vz: number;
}

export interface TrafficBodies {
  map: Map<number, RAPIER.RigidBody>;
  loose: Map<number, Loose>;
  time: number;
  /** The player's velocity a step ago (before any contact this step). */
  vx: number;
  vz: number;
}

/** A new set of traffic bodies (kept with the simulation). */
export function trafficBodies(): TrafficBodies {
  return { map: new Map(), loose: new Map(), time: 0, vx: 0, vz: 0 };
}

const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const side = new Vector3();
const pitchQ = new Quaternion();

/** The rotation of a car driving along `heading` (map), tipped by `pitch` (up a ramp). */
export function carRotation(heading: number, pitch: number, out: Quaternion): Quaternion {
  out.setFromAxisAngle(up, yawForHeading(heading));
  // Nose up for a positive pitch: around the car's own left-right axis.
  side.set(1, 0, 0).applyQuaternion(out);
  pitchQ.setFromAxisAngle(side, -pitch);
  return out.premultiply(pitchQ);
}

/** Height of the road under a car (three.js y). */
export const roadY = (sim: TrafficSim, a: Agent) => ROAD_Y[sim.graph.edges[a.edge].cls] + a.z;

/** A body's heading on the map from its rotation (the car's +z, three.js, turned into map angles). */
const headingOf = (r: { x: number; y: number; z: number; w: number }) => Math.atan2(-(1 - 2 * (r.x * r.x + r.y * r.y)), 2 * (r.x * r.z + r.w * r.y));

const hitPoint: Vec2 = [0, 0];

/**
 * One physics step: the simulation, bodies in and out of the radius, kinematic targets,
 * knocks from contacts this step, knocked cars' tires, and cars rejoining.
 */
export function stepTraffic(sim: TrafficSim, bodies: TrafficBodies, world: RAPIER.World, rapier: typeof RAPIER, player: RAPIER.RigidBody | null) {
  const dt = world.timestep;
  bodies.time += dt;
  const p = player?.translation();
  const pv = player?.linvel();
  const pr = player?.rotation();
  const at: [number, number] | null = p ? PLAYER.p : null;
  if (p && pr && pv) {
    PLAYER.p[0] = p.x;
    PLAYER.p[1] = -p.z;
    PLAYER.heading = headingOf(pr);
    PLAYER.speed = Math.hypot(pv.x, pv.z);
  }

  // Contacts from the last step: the player's car, or a knocked car, touching a car still in the flow.
  if (player && pv) {
    for (const a of sim.agents) {
      if (a.knocked) continue;
      const body = bodies.map.get(a.id);
      if (!body) continue;
      const target = body.collider(0);
      let hit = false;
      for (let i = 0; i < player.numColliders() && !hit; i++) hit = touching(world, player.collider(i), target);
      if (hit) {
        knock(sim, bodies, rapier, a, body, player.translation(), [bodies.vx, bodies.vz], PLAYER_MASS, player, pv.y);
        continue;
      }
      for (const [id, loose] of bodies.loose) {
        const other = bodies.map.get(id);
        if (!other || Math.hypot(other.translation().x - a.x, -other.translation().z - a.y) > 8 || !touching(world, other.collider(0), target)) continue;
        knock(sim, bodies, rapier, a, body, other.translation(), [loose.vx, loose.vz], MASS, other, other.linvel().y);
        break;
      }
    }
    bodies.vx = pv.x;
    bodies.vz = pv.z;
  }

  sim.step(dt, at, at ? PLAYER_LIST : NOTHING);
  if (!at) return;
  const alive = ALIVE;
  alive.clear();
  for (const a of sim.agents) {
    alive.add(a.id);
    let body = bodies.map.get(a.id);
    const near = Math.hypot(a.x - at[0], a.y - at[1]) < PHYSICS_RADIUS;
    if (!a.knocked && !near) {
      if (body) {
        world.removeRigidBody(body);
        bodies.map.delete(a.id);
      }
      continue;
    }
    if (!body) {
      body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(a.x, roadY(sim, a), -a.y).setRotation(carRotation(a.heading, a.pitch, q)).setLinearDamping(0.1).setAngularDamping(KNOCKED.angularDamping));
      const hy = 0.75;
      world.createCollider(rapier.ColliderDesc.cuboid(a.width / 2, hy, a.len / 2).setTranslation(0, hy + 0.01, 0).setMass(MASS).setFriction(KNOCKED.friction).setFrictionCombineRule(rapier.CoefficientCombineRule.Min).setRestitution(0.1), body);
      bodies.map.set(a.id, body);
    }
    if (a.knocked) {
      looseStep(sim, bodies, rapier, a, body, at, dt);
      continue;
    }
    body.setNextKinematicTranslation({ x: a.x, y: roadY(sim, a), z: -a.y });
    body.setNextKinematicRotation(carRotation(a.heading, a.pitch, q));
  }
  for (const [id, body] of bodies.map) {
    if (alive.has(id)) continue;
    world.removeRigidBody(body);
    bodies.map.delete(id);
    bodies.loose.delete(id);
  }
}

/** Are two colliders touching (the last step's contacts, with at least one point the solver used)? Leaves where in `hitPoint`. */
function touching(world: RAPIER.World, a: RAPIER.Collider, b: RAPIER.Collider): boolean {
  let yes = false;
  world.contactPair(a, b, (manifold) => {
    const n = manifold.numSolverContacts();
    if (n === 0) return;
    // The middle of the contact points: a face pressed flat on a face touches at its corners.
    let [x, z] = [0, 0];
    for (let i = 0; i < n; i++) {
      const c = manifold.solverContactPoint(i);
      [x, z] = [x + c.x, z + c.z];
    }
    [hitPoint[0], hitPoint[1]] = [x / n, z / n];
    yes = true;
  });
  return yes;
}

/**
 * Knocks a traffic car out of the flow: dynamic from now, moving as it was, plus the
 * impulse of the bump at the point it was touched (so it's shoved and turned the way it
 * was hit); the car that hit it gets the opposite impulse on its velocity from before the
 * bump, instead of the bounce off an unmovable body it just had.
 */
function knock(sim: TrafficSim, bodies: TrafficBodies, rapier: typeof RAPIER, a: Agent, body: RAPIER.RigidBody, hitter: { x: number; z: number }, hitterVel: Vec2, hitterMass: number, hitterBody: RAPIER.RigidBody, hitterVy: number) {
  const t = body.translation();
  const h = a.heading;
  const forward: Vec2 = [Math.cos(h), -Math.sin(h)];
  const targetVel: Vec2 = [forward[0] * a.v, forward[1] * a.v];
  const center: Vec2 = [t.x, t.z];
  const half: Vec2 = [a.len / 2, a.width / 2];
  // The solver's contact point, unless it's well off the car (then the box point nearest the hitter).
  const point = Math.hypot(hitPoint[0] - t.x, hitPoint[1] - t.z) < a.len ? closestOnBox(center, forward, half, hitPoint) : closestOnBox(center, forward, half, [hitter.x, hitter.z]);
  const hit = impactOf({ center, forward, half, point, hitterVel, targetVel, hitterMass, targetMass: MASS });
  sim.knock(a.id);
  body.setBodyType(rapier.RigidBodyType.Dynamic, true);
  // Upright: it can spin and slide, not roll over.
  body.setEnabledRotations(false, true, false, true);
  body.setLinvel({ x: targetVel[0], y: 0, z: targetVel[1] }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.applyImpulseAtPoint({ x: hit.impulse[0], y: 0, z: hit.impulse[1] }, { x: point[0], y: t.y + 0.6, z: point[1] }, true);
  bodies.loose.set(a.id, { at: bodies.time, still: 0, vx: targetVel[0], vz: targetVel[1] });
  // The hitter keeps what it didn't hand over (only if it was moving into the car at all).
  if (hit.closing > 0.2) hitterBody.setLinvel({ x: hitterVel[0] - hit.impulse[0] / hitterMass, y: hitterVy, z: hitterVel[1] - hit.impulse[1] / hitterMass }, true);
}

/** A knocked car's step: its tires (grip sideways, roll along), and back into the flow once it has settled facing along a lane. */
function looseStep(sim: TrafficSim, bodies: TrafficBodies, rapier: typeof RAPIER, a: Agent, body: RAPIER.RigidBody, player: [number, number], dt: number) {
  const t = body.translation();
  const r = body.rotation();
  const heading = headingOf(r);
  sim.moveKnocked(a.id, t.x, -t.z, t.y, heading);
  const loose = bodies.loose.get(a.id);
  if (!loose) return;
  const v = body.linvel();
  const [fx, fz] = [Math.cos(heading), -Math.sin(heading)];
  const along = v.x * fx + v.z * fz;
  const [sx, sz] = [v.x - along * fx, v.z - along * fz];
  const slide = Math.hypot(sx, sz);
  // Tires: sideways speed dies fast, rolling speed slowly.
  const keepSide = slide > 1e-6 ? Math.max(0, slide - KNOCKED.grip * dt) / slide : 0;
  const keepAlong = Math.abs(along) > 1e-6 ? Math.max(0, Math.abs(along) - KNOCKED.rolling * dt) / Math.abs(along) : 0;
  const [nx, nz] = [along * keepAlong * fx + sx * keepSide, along * keepAlong * fz + sz * keepSide];
  body.setLinvel({ x: nx, y: v.y, z: nz }, true);
  [loose.vx, loose.vz] = [nx, nz];
  const settled = Math.abs(body.angvel().y) < KNOCKED.turn && slide < KNOCKED.slide && Math.abs(along) < KNOCKED.roll;
  loose.still = settled ? loose.still + dt : 0;
  if (bodies.time - loose.at < KNOCKED.after || loose.still < KNOCKED.settle || Math.hypot(a.x - player[0], a.y - player[1]) < KNOCKED.clear) return;
  loose.still = 0;
  if (!sim.rejoin(a.id, t.x, -t.z, a.z, heading, Math.max(0, along))) return;
  bodies.loose.delete(a.id);
  body.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
  body.setEnabledRotations(true, true, true, true);
}
