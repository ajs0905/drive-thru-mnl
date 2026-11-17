/**
 * Traffic while driving (traffic/sim.ts): the simulation stepped with the physics (60 Hz,
 * before each step, with the bodies of the cars near the player: trafficBodies.ts), drawn
 * with the parked cars' models as instances: bodies that lean (nose down when braking,
 * out of the turn in corners), lit lamps and brake lights, turn signals, the wheels split
 * off to spin and steer, and soft lamp halos. Past `near` from the camera a car is a
 * 32-triangle box car instead (no wheels or halos to draw).
 */
import { useFrame, useLoader } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useMemo, type RefObject } from 'react';
import { BufferAttribute, Color, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stepBodyInto, type BodyMotion } from '../car/bodyMotion';
import { PARKED_MODELS, PARKED_PAINTS } from '../car/parked';
import { yawForHeading } from '../car/spawn';
import { sunShadowPose, type SunShadowPose } from '../car/sunShadow';
import { parkedCarShape } from '../geometry/parkedCarShape';
import type { GameSession } from '../game/session';
import type { MapData } from '../map/types';
import { parkingRoom, TrafficSim, type Agent } from '../traffic/sim';
import { blobShadowGeometry, SUN_SHADOW_DARKNESS } from './carModel';
import { blobMaterial, haloMaterial, TRAFFIC_LAMPS, trafficGeometries, trafficMaterial } from './carPaint';
import { geometryFromArrays } from './meshUtils';
import { SKY } from './skyConfig';
import { carRotation, roadY, stepTraffic, trafficBodies, type TrafficBodies } from './trafficBodies';

const BLOB = { grow: 1.06, darkness: 0.4, lift: 0.04 };
/** Lamp halos (m and brightness): headlights small and steady, tail lights [idle, braking], turn signals (amber, blinking `blink` times a second). Subtle: it's daytime. */
const HALO = { headSize: 0.55, head: 0.32, tailSize: [0.4, 0.8], tail: [0.18, 0.6], signalSize: 0.5, signal: 0.75, blink: 1.6 };
/** How fast the front wheels follow the steering (per second), the brake lights fade, and when brake lights are on: slowing harder than `brakeFrom` (m/s²) or under `stopped` (m/s). */
const LOOK = { steerRate: 10, brakeRate: 10, brakeFrom: -0.8, stopped: 0.3, maxSteer: 0.6 };

export function Traffic({ game, map, count, near, car }: { game: GameSession; map: MapData; count: number; near: number; car: RefObject<RapierRigidBody | null> }) {
  const gltf = useLoader(GLTFLoader, `${import.meta.env.BASE_URL}models/parked-cars.glb`);
  const { world, rapier } = useRapier();
  const sim = useMemo(
    () =>
      new TrafficSim(game.graph, {
        count,
        models: PARKED_MODELS.map((m) => ({ size: [m.size[0], m.size[1]], weight: m.weight })),
        paints: PARKED_PAINTS.map((p) => p.weight),
        room: parkingRoom(map.roads, map.parked ?? []),
        signals: game.signals,
      }),
    [game, map, count],
  );
  const built = useMemo(() => buildTraffic(gltf.scene, Math.max(1, count)), [gltf, count]);
  const bodies = useMemo(() => trafficBodies(), []);
  useEffect(() => () => disposeTraffic(built), [built]);
  useEffect(
    () => () => {
      for (const b of bodies.map.values()) if (world.getRigidBody(b.handle)) world.removeRigidBody(b);
      bodies.map.clear();
      bodies.loose.clear();
      sim.clear();
    },
    [bodies, sim, world],
  );

  useBeforePhysicsStep((w) => stepTraffic(sim, bodies, w, rapier, car.current));
  useFrame(({ camera, clock }, dt) => draw(sim, bodies, built, camera.position, near, clock.elapsedTime, Math.min(dt, 0.1)));
  return (
    <>
      {built.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      <primitive object={built.far} />
      <primitive object={built.wheels} />
      <primitive object={built.blobs} />
      <primitive object={built.sunShadows} />
      <primitive object={built.halos} />
    </>
  );
}

/** What a traffic car looks like right now, kept between frames: wheel angle, brake lights, the body's lean, and the heading a frame ago (for how fast it's turning). */
interface Look extends BodyMotion {
  steer: number;
  brake: number;
  heading: number;
  /** How far the wheels have turned (radians), and the distance driven when it was last updated. */
  spin: number;
  odo: number;
}

type Built = ReturnType<typeof buildTraffic>;

function instanced(geometry: BufferGeometry, material: Material, count: number): InstancedMesh {
  const m = new InstancedMesh(geometry, material, count);
  m.count = 0;
  m.frustumCulled = false;
  return m;
}

/** The far car: the parked cars' box car, with what the traffic material needs (no lamps; brake per instance). */
function farGeometry(count: number): BufferGeometry {
  const box = parkedCarShape();
  const g = geometryFromArrays(box);
  g.setAttribute('paint', new BufferAttribute(box.paint, 1));
  g.setAttribute('shine', new BufferAttribute(box.shine, 1));
  g.setAttribute('lamp', new BufferAttribute(new Float32Array(box.paint.length), 1));
  g.setAttribute('brake', new InstancedBufferAttribute(new Float32Array(count), 1));
  return g;
}

function buildTraffic(scene: Object3D, count: number) {
  const material = trafficMaterial();
  const models = trafficGeometries(scene, count);
  const meshes = models.bodies.map((g) => {
    const m = instanced(g, material, count);
    m.receiveShadow = true;
    return m;
  });
  const farBox = farGeometry(count);
  const far = instanced(farBox, material, count);
  far.receiveShadow = true;
  const wheels = instanced(models.wheel, material, count * 4);
  const blobGeometry = blobShadowGeometry(1, 1, BLOB.darkness);
  const shadowMaterial = blobMaterial();
  const blobs = instanced(blobGeometry, shadowMaterial, count);
  blobs.renderOrder = 1;
  // Shadows from the sun, drawn every frame beside each near car (car/sunShadow.ts): moving cars stay out of the sun's shadow map, which lags behind them.
  const sunGeometry = blobShadowGeometry(1, 1, SUN_SHADOW_DARKNESS);
  const sunShadows = instanced(sunGeometry, shadowMaterial, count);
  sunShadows.renderOrder = 1;
  const haloGeometry = new PlaneGeometry(1, 1);
  const glow = haloMaterial();
  // Four lamps and two turn signals a car.
  const halos = instanced(haloGeometry, glow, count * 6);
  halos.renderOrder = 2;
  // Make the instance colors (the halos' brightness) exist from the start.
  halos.setColorAt(0, new Color(0, 0, 0));
  return {
    material,
    models,
    meshes,
    farBox,
    far,
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
  for (const g of [...b.models.bodies, b.models.wheel, b.farBox, b.blobGeometry, b.sunGeometry, b.haloGeometry]) g.dispose();
  b.shadowMaterial.dispose();
  b.glow.dispose();
  for (const m of [...b.meshes, b.far, b.wheels, b.blobs, b.sunShadows, b.halos]) m.dispose();
}

const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const m4 = new Matrix4();
const base = new Matrix4();
const local = new Matrix4();
const turnM = new Matrix4();
const pos = new Vector3();
const one = new Vector3(1, 1, 1);
const size = new Vector3();
const flat = new Quaternion();
const lean = new Quaternion();
const leanX = new Quaternion();
const leanZ = new Quaternion();
const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);
const lampAt = new Vector3();
const forward = new Vector3();
const toCamera = new Vector3();
const glow = new Color();
const HEAD = new Color(...TRAFFIC_LAMPS.head);
const TAIL = new Color(...TRAFFIC_LAMPS.tail);
const AMBER = new Color(1, 0.5, 0.05);
const sunPose: SunShadowPose = { dx: 0, dz: 0, width: 0, length: 0 };

/**
 * The instances: each car's body where the simulation (or, knocked, the physics) has it,
 * leaning with its braking and turning, with its brake lights; near the camera its four
 * wheels turning with the distance driven and the front ones steered, its lamp halos and
 * turn signals (seen from their side only) and its sun shadow; far off, a box car.
 */
function draw(sim: TrafficSim, bodies: TrafficBodies, built: Built, camera: Vector3, near: number, time: number, dt: number) {
  const counts = built.counts;
  counts.fill(0);
  let [wheels, halos, blobs, far, shadows] = [0, 0, 0, 0, 0];
  const seen = built.seen;
  seen.clear();
  const blinkOn = (time * HALO.blink) % 1 < 0.55;
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
    const look = lookOf(built.looks, a);
    // Knocked loose, the wheels roll with how fast the body moves along its length.
    const rolling = body ? body.linvel().x * Math.cos(a.heading) - body.linvel().z * Math.sin(a.heading) : null;
    updateLook(look, a, dt, rolling, built.models.parts[a.model].wheelRadius || 0.3);
    base.compose(pos, q, one);
    // The body leans on its springs (pitch dips the nose, roll lowers the right side), the wheels don't.
    lean.copy(q).multiply(leanX.setFromAxisAngle(X, look.pitch)).multiply(leanZ.setFromAxisAngle(Z, look.roll));
    m4.compose(pos, lean, one);
    const paint = built.paints[a.paint] ?? built.paints[0];
    const brake = look.brake;

    const close = pos.distanceTo(camera) < near;
    if (!close) {
      const [l, w, h] = PARKED_MODELS[a.model].size;
      local.compose(pos, lean, size.set(w, h, l));
      built.far.setMatrixAt(far, local);
      built.far.setColorAt(far, paint);
      (built.far.geometry.getAttribute('brake') as InstancedBufferAttribute).setX(far++, brake);
    } else {
      const parts = built.models.parts[a.model];
      const mesh = built.meshes[a.model];
      const k = counts[a.model]++;
      mesh.setMatrixAt(k, m4);
      mesh.setColorAt(k, paint);
      (mesh.geometry.getAttribute('brake') as InstancedBufferAttribute).setX(k, brake);

      // Wheels: spin by the distance driven (the wheel's top rolls forward), front ones steered; right ones are the left wheel turned round.
      const spin = look.spin;
      for (let w = 0; w < 4; w++) {
        const [x, y, z] = parts.wheels[w];
        local.makeRotationX(spin);
        if (w % 2 === 1) local.multiply(turnM.makeRotationY(Math.PI));
        if (w < 2) local.premultiply(turnM.makeRotationY(look.steer));
        local.setPosition(x, y, z);
        built.wheels.setMatrixAt(wheels++, turnM.multiplyMatrices(base, local));
      }

      // Lamp halos: brighter when facing the camera, the tail ones bigger and brighter when braking; turn signals blink amber on their side.
      forward.set(0, 0, 1).applyQuaternion(lean);
      for (let k = 0; k < parts.head.length + parts.tail.length; k++) {
        const tail = k >= parts.head.length;
        const l = tail ? parts.tail[k - parts.head.length] : parts.head[k];
        lampAt.set(l[0], l[1], l[2] + (tail ? -0.05 : 0.05)).applyMatrix4(m4);
        const facing = facingOf(lampAt, camera, tail);
        const s = tail ? HALO.tailSize[0] + (HALO.tailSize[1] - HALO.tailSize[0]) * brake : HALO.headSize;
        const strength = (tail ? HALO.tail[0] + (HALO.tail[1] - HALO.tail[0]) * brake : HALO.head) * facing;
        built.halos.setMatrixAt(halos, local.compose(lampAt, flat.identity(), size.set(s, s, s)));
        built.halos.setColorAt(halos++, glow.copy(tail ? TAIL : HEAD).multiplyScalar(strength));
      }
      // Lamps are listed left then right; the signal sits just outside the lamp on its side.
      if (a.signal !== 0 && blinkOn && parts.head.length === 2 && parts.tail.length === 2) {
        const i = a.signal > 0 ? 0 : 1;
        for (const l of [parts.head[i], parts.tail[i]]) {
          const tail = l === parts.tail[i];
          lampAt.set(l[0] + (a.signal > 0 ? 0.12 : -0.12), l[1], l[2] + (tail ? -0.06 : 0.06)).applyMatrix4(m4);
          const facing = Math.max(0.35, facingOf(lampAt, camera, tail));
          built.halos.setMatrixAt(halos, local.compose(lampAt, flat.identity(), size.set(HALO.signalSize, HALO.signalSize, HALO.signalSize)));
          built.halos.setColorAt(halos++, glow.copy(AMBER).multiplyScalar(HALO.signal * facing));
        }
      }
    }

    const yaw = yawForHeading(a.heading);
    flat.setFromAxisAngle(up, yaw);
    size.set(a.width * BLOB.grow, 1, a.len * BLOB.grow);
    const ground = (body ? roadY(sim, a) : pos.y) + BLOB.lift;
    base.compose(lampAt.set(pos.x, ground, pos.z), flat, size);
    built.blobs.setMatrixAt(blobs++, base);
    if (close) {
      sunShadowPose(SKY.sunDir, yaw, a.width, a.len, sunPose);
      base.compose(lampAt.set(pos.x + sunPose.dx, ground - 0.005, pos.z + sunPose.dz), flat, size.set(sunPose.width, 1, sunPose.length));
      built.sunShadows.setMatrixAt(shadows++, base);
    }
  }
  for (const id of built.looks.keys()) if (!seen.has(id)) built.looks.delete(id);
  built.meshes.forEach((m, i) => {
    m.count = counts[i];
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.geometry.getAttribute('brake').needsUpdate = true;
  });
  show(built.far, far);
  if (built.far.instanceColor) built.far.instanceColor.needsUpdate = true;
  built.far.geometry.getAttribute('brake').needsUpdate = true;
  show(built.wheels, wheels);
  show(built.halos, halos);
  show(built.blobs, blobs);
  show(built.sunShadows, shadows);
  if (built.halos.instanceColor) built.halos.instanceColor.needsUpdate = true;
}

/** How much a lamp faces the camera (0 to 1): headlights forward, tail lights back (`forward` holds the car's direction). */
function facingOf(lamp: Vector3, camera: Vector3, tail: boolean): number {
  toCamera.subVectors(camera, lamp).normalize();
  return Math.max(0, Math.min(1, (toCamera.dot(forward) * (tail ? -1 : 1) - 0.05) * 2.2));
}

function show(m: InstancedMesh, count: number) {
  m.count = count;
  m.instanceMatrix.needsUpdate = true;
}

function lookOf(looks: Map<number, Look>, a: Agent): Look {
  let look = looks.get(a.id);
  if (!look) {
    look = { steer: 0, brake: 0, heading: a.heading, pitch: 0, pitchVel: 0, roll: 0, rollVel: 0, spin: 0, odo: a.odo };
    looks.set(a.id, look);
  }
  return look;
}

/**
 * Front wheels eased toward the simulation's steering angle, wheel spin from the distance
 * driven (knocked loose: from `rolling`, the body's speed along its length), brake lights
 * on when slowing or stopped (eased), and the body's lean from its braking and how hard
 * it's turning.
 */
function updateLook(look: Look, a: Agent, dt: number, rolling: number | null, wheelRadius: number) {
  look.spin += (rolling === null ? a.odo - look.odo : rolling * dt) / wheelRadius;
  look.odo = a.odo;
  const steer = a.knocked ? 0 : Math.max(-LOOK.maxSteer, Math.min(LOOK.maxSteer, a.steer));
  look.steer += (steer - look.steer) * Math.min(1, dt * LOOK.steerRate);
  const braking = !a.knocked && (a.acc < LOOK.brakeFrom || a.v < LOOK.stopped) ? 1 : 0;
  look.brake += (braking - look.brake) * Math.min(1, dt * LOOK.brakeRate);
  // Sideways acceleration: speed times how fast the heading turns (left positive).
  const yawRate = dt > 0 ? Math.atan2(Math.sin(a.heading - look.heading), Math.cos(a.heading - look.heading)) / dt : 0;
  look.heading = a.heading;
  stepBodyInto(look, a.knocked ? 0 : a.acc, a.knocked ? 0 : a.v * yawRate, dt);
}
