/**
 * Light traffic while driving (traffic/sim.ts): the simulation stepped with the physics
 * (60 Hz, before each step), drawn with the parked cars' models as instances: bodies
 * with lit lamps and brake lights, the wheels split off to spin and steer, and soft lamp
 * halos.
 *
 * Cars within `PHYSICS_RADIUS` of the player are kinematic bodies that follow the
 * simulation exactly: solid to the player, pushed by nothing. When the player crashes
 * into one (the car's crash counter goes up with one touching it), that car is knocked
 * out of the flow: its body turns dynamic, keeps its speed plus some of the hit, and the
 * physics moves it from then on; the others treat it as an obstacle, and it goes once
 * it's far behind.
 */
import { useFrame, useLoader } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier, type RapierRigidBody } from '@react-three/rapier';
import type RAPIER from '@dimforge/rapier3d-compat';
import { useEffect, useMemo, type RefObject } from 'react';
import { Color, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, Vector3, type BufferGeometry, type InstancedBufferAttribute, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { steerFor } from '../car/carParts';
import { PARKED_MODELS, PARKED_PAINTS } from '../car/parked';
import { yawForHeading } from '../car/spawn';
import type { GameSession } from '../game/session';
import type { DriveSession } from './driveSession';
import type { MapData } from '../map/types';
import { parkingRoom, TrafficSim, type Agent, type Obstacle } from '../traffic/sim';
import { sunShadowPose, type SunShadowPose } from '../car/sunShadow';
import { blobShadowGeometry, SUN_SHADOW_DARKNESS } from './carModel';
import { SKY } from './skyConfig';
import { blobMaterial, haloMaterial, TRAFFIC_LAMPS, trafficGeometries, trafficMaterial } from './carPaint';
import { ROAD_Y } from './cityGeometry';

/** Cars this close (m) to the player are physics bodies. */
const PHYSICS_RADIUS = 70;
/** A crash counts against a traffic car within this far (m) of the player's car, bodies' edges apart. */
const HIT_REACH = 0.8;
const MASS = 1200;
const BLOB = { grow: 1.06, darkness: 0.4, lift: 0.04 };
/** Lamp halos (m and brightness): headlights small and steady, tail lights [idle, braking]. Subtle: it's daytime. */
const HALO = { headSize: 0.55, head: 0.32, tailSize: [0.4, 0.8], tail: [0.18, 0.6] };
/** How fast the front wheels follow the path's turn and the brake lights fade (per second), and when brake lights are on: slowing harder than `brakeFrom` (m/s²) or under `stopped` (m/s). */
const LOOK = { steerRate: 8, brakeRate: 10, brakeFrom: -0.8, stopped: 0.3 };

/** Kept between steps (no garbage each step): the player as an obstacle, and the cars still around. */
const PLAYER: Obstacle = { p: [0, 0], speed: 0, heading: 0, half: 2.25 };
const PLAYER_LIST = [PLAYER];
const NOTHING: Obstacle[] = [];
const ALIVE = new Set<number>();

interface Bodies {
  map: Map<number, RAPIER.RigidBody>;
  impacts: number;
}

export function Traffic({ game, session, map, count, car }: { game: GameSession; session: DriveSession; map: MapData; count: number; car: RefObject<RapierRigidBody | null> }) {
  const gltf = useLoader(GLTFLoader, `${import.meta.env.BASE_URL}models/parked-cars.glb`);
  const { world, rapier } = useRapier();
  const sim = useMemo(
    () =>
      new TrafficSim(game.graph, {
        count,
        models: PARKED_MODELS.map((m) => ({ size: [m.size[0], m.size[1]], weight: m.weight })),
        paints: PARKED_PAINTS.map((p) => p.weight),
        room: parkingRoom(map.roads, map.parked ?? []),
      }),
    [game, map, count],
  );
  const built = useMemo(() => buildTraffic(gltf.scene, Math.max(1, count)), [gltf, count]);
  const bodies = useMemo<Bodies>(() => ({ map: new Map(), impacts: 0 }), []);
  useEffect(() => () => disposeTraffic(built), [built]);
  useEffect(
    () => () => {
      for (const b of bodies.map.values()) if (world.getRigidBody(b.handle)) world.removeRigidBody(b);
      bodies.map.clear();
      sim.clear();
    },
    [bodies, sim, world],
  );

  useBeforePhysicsStep((w) => stepTraffic(sim, bodies, w, rapier, car.current, session));
  useFrame(({ camera }, dt) => draw(sim, bodies, built, camera.position, Math.min(dt, 0.1)));
  return (
    <>
      {built.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      <primitive object={built.wheels} />
      <primitive object={built.blobs} />
      <primitive object={built.sunShadows} />
      <primitive object={built.halos} />
    </>
  );
}

/** What a traffic car looks like right now, kept between frames: wheel angle, brake lights, and the last heading and distance (for the steering). */
interface Look {
  steer: number;
  brake: number;
  heading: number;
  odo: number;
  turn: number;
}

type Built = ReturnType<typeof buildTraffic>;

function instanced(geometry: BufferGeometry, material: Material, count: number): InstancedMesh {
  const m = new InstancedMesh(geometry, material, count);
  m.count = 0;
  m.frustumCulled = false;
  return m;
}

function buildTraffic(scene: Object3D, count: number) {
  const material = trafficMaterial();
  const models = trafficGeometries(scene, count);
  const meshes = models.bodies.map((g) => {
    const m = instanced(g, material, count);
    m.receiveShadow = true;
    return m;
  });
  const wheels = instanced(models.wheel, material, count * 4);
  const blobGeometry = blobShadowGeometry(1, 1, BLOB.darkness);
  const shadowMaterial = blobMaterial();
  const blobs = instanced(blobGeometry, shadowMaterial, count);
  blobs.renderOrder = 1;
  // Shadows from the sun, drawn every frame beside each car (car/sunShadow.ts): moving cars stay out of the sun's shadow map, which lags behind them.
  const sunGeometry = blobShadowGeometry(1, 1, SUN_SHADOW_DARKNESS);
  const sunShadows = instanced(sunGeometry, shadowMaterial, count);
  sunShadows.renderOrder = 1;
  const haloGeometry = new PlaneGeometry(1, 1);
  const glow = haloMaterial();
  const halos = instanced(haloGeometry, glow, count * 4);
  halos.renderOrder = 2;
  // Make the instance colors (the halos' brightness) exist from the start.
  halos.setColorAt(0, new Color(0, 0, 0));
  return {
    material,
    models,
    meshes,
    wheels,
    blobGeometry,
    shadowMaterial,
    blobs,
    sunGeometry,
    sunShadows,
    haloGeometry,
    glow,
    halos,
    paints: PARKED_PAINTS.map((p) => new Color(p.hex)),
    looks: new Map<number, Look>(),
    // Reused every frame.
    counts: meshes.map(() => 0),
    seen: new Set<number>(),
  };
}

function disposeTraffic(b: Built) {
  b.material.dispose();
  for (const g of [...b.models.bodies, b.models.wheel, b.blobGeometry, b.sunGeometry, b.haloGeometry]) g.dispose();
  b.shadowMaterial.dispose();
  b.glow.dispose();
  for (const m of [...b.meshes, b.wheels, b.blobs, b.sunShadows, b.halos]) m.dispose();
}

const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const side = new Vector3();
const pitchQ = new Quaternion();

/** The rotation of a car driving along `heading` (map), tipped by `pitch` (up a ramp). */
function carRotation(heading: number, pitch: number, out: Quaternion): Quaternion {
  out.setFromAxisAngle(up, yawForHeading(heading));
  // Nose up for a positive pitch: around the car's own left-right axis.
  side.set(1, 0, 0).applyQuaternion(out);
  pitchQ.setFromAxisAngle(side, -pitch);
  return out.premultiply(pitchQ);
}

/** Height of the road under a car (three.js y). */
const roadY = (sim: TrafficSim, a: Agent) => ROAD_Y[sim.graph.edges[a.edge].cls] + a.z;

/** One physics step: the simulation, bodies in and out of the radius, kinematic targets, knocks. */
function stepTraffic(sim: TrafficSim, bodies: Bodies, world: RAPIER.World, rapier: typeof RAPIER, player: RapierRigidBody | null, session: DriveSession) {
  const p = player?.translation();
  const pv = player?.linvel();
  const pr = player?.rotation();
  const at: [number, number] | null = p ? PLAYER.p : null;
  if (p && pr && pv) {
    PLAYER.p[0] = p.x;
    PLAYER.p[1] = -p.z;
    PLAYER.heading = Math.atan2(-(1 - 2 * (pr.x * pr.x + pr.y * pr.y)), 2 * (pr.x * pr.z + pr.w * pr.y));
    PLAYER.speed = Math.hypot(pv.x, pv.z);
  }
  sim.step(world.timestep, at, at ? PLAYER_LIST : NOTHING);
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
      body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(a.x, roadY(sim, a), -a.y).setRotation(carRotation(a.heading, a.pitch, q)).setLinearDamping(0.3).setAngularDamping(0.8));
      const hy = 0.75;
      world.createCollider(rapier.ColliderDesc.cuboid(a.width / 2, hy, a.len / 2).setTranslation(0, hy + 0.01, 0).setMass(MASS).setFriction(0.6).setRestitution(0.1), body);
      bodies.map.set(a.id, body);
    }
    if (a.knocked) {
      const t = body.translation();
      const r = body.rotation();
      sim.moveKnocked(a.id, t.x, -t.z, t.y, Math.atan2(-(1 - 2 * (r.x * r.x + r.y * r.y)), 2 * (r.x * r.z + r.w * r.y)));
      continue;
    }
    body.setNextKinematicTranslation({ x: a.x, y: roadY(sim, a), z: -a.y });
    body.setNextKinematicRotation(carRotation(a.heading, a.pitch, q));
  }
  for (const [id, body] of bodies.map) {
    if (alive.has(id)) continue;
    world.removeRigidBody(body);
    bodies.map.delete(id);
  }
  // A crash this step: knock out the traffic car touching the player, if one is.
  const impacts = session.car.impacts;
  if (impacts !== bodies.impacts) {
    bodies.impacts = impacts;
    let hit: Agent | null = null;
    let best = Infinity;
    for (const a of sim.agents) {
      if (a.knocked || !bodies.map.has(a.id)) continue;
      const d = Math.hypot(a.x - at[0], a.y - at[1]) - (a.len / 2 + 2.25);
      if (d < HIT_REACH && d < best) [hit, best] = [a, d];
    }
    if (hit) {
      const body = bodies.map.get(hit.id)!;
      const v = hit.v;
      sim.knock(hit.id);
      body.setBodyType(rapier.RigidBodyType.Dynamic, true);
      body.setLinvel({ x: Math.cos(hit.heading) * v + (pv?.x ?? 0) * 0.4, y: 0, z: -Math.sin(hit.heading) * v + (pv?.z ?? 0) * 0.4 }, true);
    }
  }
}

const m4 = new Matrix4();
const local = new Matrix4();
const turnM = new Matrix4();
const pos = new Vector3();
const one = new Vector3(1, 1, 1);
const size = new Vector3();
const flat = new Quaternion();
const lampAt = new Vector3();
const forward = new Vector3();
const toCamera = new Vector3();
const glow = new Color();
const HEAD = new Color(...TRAFFIC_LAMPS.head);
const sunPose: SunShadowPose = { dx: 0, dz: 0, width: 0, length: 0 };
const TAIL = new Color(...TRAFFIC_LAMPS.tail);

/**
 * The instances: each car's body where the simulation (or, knocked, the physics) has it,
 * with its brake lights; its four wheels turning with the distance driven, the front ones
 * steered by how fast it's turning; its lamp halos (seen from their side only); and its
 * blob shadow.
 */
function draw(sim: TrafficSim, bodies: Bodies, built: Built, camera: Vector3, dt: number) {
  const counts = built.counts;
  counts.fill(0);
  let [wheels, halos, blobs] = [0, 0, 0];
  const seen = built.seen;
  seen.clear();
  for (const a of sim.agents) {
    seen.add(a.id);
    const body = a.knocked ? bodies.map.get(a.id) : undefined;
    if (body) {
      const t = body.translation();
      const r = body.rotation();
      pos.set(t.x, t.y, t.z);
      q.set(r.x, r.y, r.z, r.w);
    } else {
      pos.set(a.x, roadY(sim, a), -a.y);
      carRotation(a.heading, a.pitch, q);
    }
    const parts = built.models.parts[a.model];
    const look = lookOf(built.looks, a);
    updateLook(look, a, parts.wheels[0][2] - parts.wheels[2][2], dt);

    const mesh = built.meshes[a.model];
    m4.compose(pos, q, one);
    const k = counts[a.model]++;
    mesh.setMatrixAt(k, m4);
    mesh.setColorAt(k, built.paints[a.paint] ?? built.paints[0]);
    (mesh.geometry.getAttribute('brake') as InstancedBufferAttribute).setX(k, look.brake);

    // Wheels: spin by the distance driven (the wheel's top rolls forward), front ones steered; right ones are the left wheel turned round.
    const spin = a.odo / (parts.wheelRadius || 0.3);
    for (let w = 0; w < 4; w++) {
      const [x, y, z] = parts.wheels[w];
      local.makeRotationX(spin);
      if (w % 2 === 1) local.multiply(turnM.makeRotationY(Math.PI));
      if (w < 2) local.premultiply(turnM.makeRotationY(look.steer));
      local.setPosition(x, y, z);
      built.wheels.setMatrixAt(wheels++, turnM.multiplyMatrices(m4, local));
    }

    // Lamp halos: brighter when facing the camera, the tail ones bigger and brighter when braking.
    forward.set(0, 0, 1).applyQuaternion(q);
    for (let k = 0; k < parts.head.length + parts.tail.length; k++) {
      const tail = k >= parts.head.length;
      const l = tail ? parts.tail[k - parts.head.length] : parts.head[k];
      lampAt.set(l[0], l[1], l[2] + (tail ? -0.05 : 0.05)).applyMatrix4(m4);
      toCamera.subVectors(camera, lampAt).normalize();
      const facing = Math.max(0, Math.min(1, (toCamera.dot(forward) * (tail ? -1 : 1) - 0.05) * 2.2));
      const s = tail ? HALO.tailSize[0] + (HALO.tailSize[1] - HALO.tailSize[0]) * look.brake : HALO.headSize;
      const strength = (tail ? HALO.tail[0] + (HALO.tail[1] - HALO.tail[0]) * look.brake : HALO.head) * facing;
      built.halos.setMatrixAt(halos, local.compose(lampAt, flat.identity(), size.set(s, s, s)));
      built.halos.setColorAt(halos++, glow.copy(tail ? TAIL : HEAD).multiplyScalar(strength));
    }

    const yaw = yawForHeading(a.heading);
    flat.setFromAxisAngle(up, yaw);
    size.set(a.width * BLOB.grow, 1, a.len * BLOB.grow);
    const ground = (body ? roadY(sim, a) : pos.y) + BLOB.lift;
    m4.compose(pos.set(pos.x, ground, pos.z), flat, size);
    built.blobs.setMatrixAt(blobs, m4);
    sunShadowPose(SKY.sunDir, yaw, a.width, a.len, sunPose);
    m4.compose(lampAt.set(pos.x + sunPose.dx, ground - 0.005, pos.z + sunPose.dz), flat, size.set(sunPose.width, 1, sunPose.length));
    built.sunShadows.setMatrixAt(blobs++, m4);
  }
  for (const id of built.looks.keys()) if (!seen.has(id)) built.looks.delete(id);
  built.meshes.forEach((m, i) => {
    m.count = counts[i];
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.geometry.getAttribute('brake').needsUpdate = true;
  });
  show(built.wheels, wheels);
  show(built.halos, halos);
  show(built.blobs, blobs);
  show(built.sunShadows, blobs);
  if (built.halos.instanceColor) built.halos.instanceColor.needsUpdate = true;
}

function show(m: InstancedMesh, count: number) {
  m.count = count;
  m.instanceMatrix.needsUpdate = true;
}

function lookOf(looks: Map<number, Look>, a: Agent): Look {
  let look = looks.get(a.id);
  if (!look) {
    look = { steer: 0, brake: 0, heading: a.heading, odo: a.odo, turn: 0 };
    looks.set(a.id, look);
  }
  return look;
}

/** Steering from how fast the heading turns per meter driven (eased), brake lights on when slowing or stopped (eased). */
function updateLook(look: Look, a: Agent, wheelbase: number, dt: number) {
  const moved = a.odo - look.odo;
  if (moved > 0.05) {
    look.turn = steerFor(Math.atan2(Math.sin(a.heading - look.heading), Math.cos(a.heading - look.heading)) / moved, wheelbase);
    look.heading = a.heading;
    look.odo = a.odo;
  } else if (a.v < 0.1) look.turn *= 1 - Math.min(1, dt);
  look.steer += (look.turn - look.steer) * Math.min(1, dt * LOOK.steerRate);
  const braking = !a.knocked && (a.acc < LOOK.brakeFrom || a.v < LOOK.stopped) ? 1 : 0;
  look.brake += (braking - look.brake) * Math.min(1, dt * LOOK.brakeRate);
}
