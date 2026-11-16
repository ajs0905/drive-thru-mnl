/**
 * Light traffic while driving (traffic/sim.ts): the simulation stepped with the physics
 * (60 Hz, before each step), drawn with the parked cars' models as instances.
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
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PARKED_MODELS, PARKED_PAINTS } from '../car/parked';
import { yawForHeading } from '../car/spawn';
import type { GameSession } from '../game/session';
import type { DriveSession } from './driveSession';
import type { MapData } from '../map/types';
import { roadsWithParking, TrafficSim, type Agent } from '../traffic/sim';
import { blobShadowGeometry } from './carModel';
import { blobMaterial, paintMaterial, parkedGeometries } from './carPaint';
import { ROAD_Y } from './cityGeometry';

/** Cars this close (m) to the player are physics bodies. */
const PHYSICS_RADIUS = 70;
/** A crash counts against a traffic car within this far (m) of the player's car, bodies' edges apart. */
const HIT_REACH = 0.8;
const MASS = 1200;
const BLOB = { grow: 1.06, darkness: 0.4, lift: 0.04 };

interface Bodies {
  map: Map<number, RAPIER.RigidBody>;
  impacts: number;
}

export function Traffic({ game, session, map, count, shadows, car }: { game: GameSession; session: DriveSession; map: MapData; count: number; shadows: boolean; car: RefObject<RapierRigidBody | null> }) {
  const gltf = useLoader(GLTFLoader, `${import.meta.env.BASE_URL}models/parked-cars.glb`);
  const { world, rapier } = useRapier();
  const sim = useMemo(
    () =>
      new TrafficSim(game.graph, {
        count,
        models: PARKED_MODELS.map((m) => ({ size: [m.size[0], m.size[1]], weight: m.weight })),
        paints: PARKED_PAINTS.map((p) => p.weight),
        avoid: roadsWithParking(map.roads, map.parked ?? []),
      }),
    [game, map, count],
  );
  const built = useMemo(() => {
    const material = paintMaterial();
    const geometries = parkedGeometries(gltf.scene);
    const meshes = geometries.map((g) => {
      const m = new InstancedMesh(g, material, Math.max(1, count));
      m.count = 0;
      m.frustumCulled = false;
      m.receiveShadow = true;
      return m;
    });
    const blobGeometry = blobShadowGeometry(1, 1, BLOB.darkness);
    const shadowMaterial = blobMaterial();
    const blobs = new InstancedMesh(blobGeometry, shadowMaterial, Math.max(1, count));
    blobs.count = 0;
    blobs.frustumCulled = false;
    blobs.renderOrder = 1;
    return { material, geometries, meshes, blobGeometry, shadowMaterial, blobs, paints: PARKED_PAINTS.map((p) => new Color(p.hex)) };
  }, [gltf, count]);
  const bodies = useMemo<Bodies>(() => ({ map: new Map(), impacts: 0 }), []);
  useEffect(() => castShadows(built.meshes, shadows), [built, shadows]);
  useEffect(
    () => () => {
      built.material.dispose();
      for (const g of built.geometries) g.dispose();
      built.blobGeometry.dispose();
      built.shadowMaterial.dispose();
      for (const m of [...built.meshes, built.blobs]) m.dispose();
    },
    [built],
  );
  useEffect(
    () => () => {
      for (const b of bodies.map.values()) if (world.getRigidBody(b.handle)) world.removeRigidBody(b);
      bodies.map.clear();
      sim.clear();
    },
    [bodies, sim, world],
  );

  useBeforePhysicsStep((w) => stepTraffic(sim, bodies, w, rapier, car.current, session));
  useFrame(() => draw(sim, bodies, built));
  return (
    <>
      {built.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      <primitive object={built.blobs} />
    </>
  );
}

function castShadows(meshes: InstancedMesh[], on: boolean) {
  for (const m of meshes) m.castShadow = on;
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
  const at: [number, number] | null = p ? [p.x, -p.z] : null;
  let heading = 0;
  if (pr) heading = Math.atan2(-(1 - 2 * (pr.x * pr.x + pr.y * pr.y)), 2 * (pr.x * pr.z + pr.w * pr.y));
  const speed = pv ? Math.hypot(pv.x, pv.z) : 0;
  sim.step(world.timestep, at, at ? [{ p: at, speed, heading, half: 2.25 }] : []);
  if (!at) return;
  const alive = new Set<number>();
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
const pos = new Vector3();
const one = new Vector3(1, 1, 1);
const size = new Vector3();
const flat = new Quaternion();

/** The instances: each car's model where the simulation (or, knocked, the physics) has it, and its blob shadow. */
function draw(sim: TrafficSim, bodies: Bodies, built: { meshes: InstancedMesh[]; blobs: InstancedMesh; paints: Color[] }) {
  const counts = built.meshes.map(() => 0);
  let blobs = 0;
  for (const a of sim.agents) {
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
    const mesh = built.meshes[a.model];
    m4.compose(pos, q, one);
    mesh.setMatrixAt(counts[a.model], m4);
    mesh.setColorAt(counts[a.model], built.paints[a.paint] ?? built.paints[0]);
    counts[a.model]++;
    flat.setFromAxisAngle(up, yawForHeading(a.heading));
    size.set(a.width * BLOB.grow, 1, a.len * BLOB.grow);
    m4.compose(pos.set(pos.x, (body ? roadY(sim, a) : pos.y) + BLOB.lift, pos.z), flat, size);
    built.blobs.setMatrixAt(blobs++, m4);
  }
  built.meshes.forEach((m, i) => {
    m.count = counts[i];
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  built.blobs.count = blobs;
  built.blobs.instanceMatrix.needsUpdate = true;
}
