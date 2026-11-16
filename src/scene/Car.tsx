/**
 * The player's car: the model on a Rapier rigid body driven by a ray-cast vehicle
 * (src/car/vehicle.ts), keyboard input, the chase camera, the blob shadow, brake lights
 * and lamp halos, and the body's pitch and roll.
 *
 * Physics steps at a fixed 60 Hz (Drive.tsx); before each step `stepVehicle` turns the
 * keys into what the wheels do (arcade controls, drift assist, gearbox). The rendered
 * car is interpolated between steps by @react-three/rapier, and after that, each frame,
 * the wheels, body lean, camera, shadow and lights are placed from it. Moving the map
 * controls' target along with the car keeps the sun's shadow area and the prop distance
 * limits centered on it. Each frame the car also writes where it is to the drive session
 * (for the HUD), and each physics step reads the touch buttons from it.
 */
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { RigidBody, useBeforePhysicsStep, useRapier, type RapierCollider, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { kick, STILL, stepBody } from '../car/bodyMotion';
import { CHASE, cameraPull, chaseView, clipDistance, compressedLift, crashShake, damp, shakeOffset, speedFov, turnToward, type Vec3 } from '../car/chaseCamera';
import { inputFromKeys, KEY_BINDINGS, NO_KEYS } from '../car/controls';
import { headingOfDirection } from '../car/spawn';
import { restLift, wheelHardPoint, type CarSpec } from '../car/spec';
import { chassisCollider, newDriveState, resetOnGround, RESET, setupWheels, stepVehicle, type ResetPose, type VehicleController } from '../car/vehicle';
import { blinkAfterReset, blobShadow, placeShadow, poseBody, prepareCarModel, setBrakeLights, setReverseLights, updateHalos } from './carModel';
import { mergeKeys, type DriveSession } from './driveSession';

/** Seconds upside down (or fallen off the world) before the car puts itself back on its wheels. */
const STUCK_RESET = 2;

/** When driving ends, the map camera rises to this far behind and above the car. */
const EXIT_VIEW = { back: 70, up: 90 };

export function Car({
  spec,
  spawn,
  onSpeed,
  cameraBlockers,
  session,
  paused = false,
  findReset,
}: {
  spec: CarSpec;
  spawn: { position: Vec3; yaw: number };
  /** Called every frame with the forward speed (m/s). */
  onSpeed?: (speed: number) => void;
  /** The collider the chase camera keeps in front of (buildings and walls); anything if not given. */
  cameraBlockers?: RefObject<RapierCollider | null>;
  /** Shared with the HUD and the touch controls. */
  session?: DriveSession;
  /** The physics is stopped (loading, pause menu, big map): the camera holds still too. */
  paused?: boolean;
  /** Where a reset puts the car (an open road nearby), given where it is (three.js space) and its map heading; null resets it in place. */
  findReset?: (x: number, y: number, z: number, heading: number) => ResetPose | null;
}) {
  const gltf = useLoader(GLTFLoader, `${import.meta.env.BASE_URL}${spec.model}`);
  const model = useMemo(() => prepareCarModel(gltf.scene), [gltf]);
  const shadow = useMemo(() => blobShadow(spec), [spec]);
  useEffect(
    () => () => {
      model.dispose();
      shadow.geometry.dispose();
      shadow.material.dispose();
    },
    [model, shadow],
  );

  const body = useRef<RapierRigidBody>(null);
  const { world, rapier } = useRapier();
  const sim = useRef({ vc: null as VehicleController | null, drive: newDriveState(), keys: { ...NO_KEYS }, held: { ...NO_KEYS }, reset: false, stuck: 0, time: 0, lastReset: -Infinity });
  const view = useRef({
    dir: [0, 1] as [number, number],
    placed: false,
    pull: 0,
    clip: Infinity,
    speed: 0,
    shake: 0,
    impacts: 0,
    body: STILL,
    upshifts: 0,
    pos: new Vector3(),
    quat: new Quaternion(),
    fwd: new Vector3(),
    toCamera: new Vector3(),
  });

  // Chassis collider and the vehicle, once the rigid body exists.
  useEffect(() => {
    const b = body.current;
    if (!b) return;
    const s = sim.current;
    const collider = world.createCollider(chassisCollider(rapier, spec), b);
    const vc = world.createVehicleController(b);
    setupWheels(vc, spec);
    s.vc = vc;
    return () => {
      s.vc = null;
      world.removeVehicleController(vc);
      world.removeCollider(collider, false);
    };
  }, [world, rapier, spec]);

  // Leaving drive mode: lift the camera to an overview behind where the car stopped, so the
  // map view doesn't start inside a building.
  const get = useThree((s) => s.get);
  useEffect(() => {
    const v = view.current;
    const camera = get().camera as PerspectiveCamera;
    const fov = camera.fov;
    return () => {
      camera.fov = fov; // undo the speed widening
      camera.updateProjectionMatrix();
      if (!v.placed) return;
      camera.position.set(v.pos.x - v.dir[0] * EXIT_VIEW.back, v.pos.y + EXIT_VIEW.up, v.pos.z - v.dir[1] * EXIT_VIEW.back);
      camera.lookAt(v.pos);
    };
  }, [get]);

  // Keyboard: held keys drive, R puts the car back on its wheels.
  useEffect(() => {
    const s = sim.current;
    const down = (e: KeyboardEvent) => {
      const key = KEY_BINDINGS[e.code];
      if (key) {
        s.keys[key] = true;
        e.preventDefault(); // arrows and space would scroll the page
      } else if (e.code === 'KeyR') s.reset = true;
    };
    const up = (e: KeyboardEvent) => {
      const key = KEY_BINDINGS[e.code];
      if (key) s.keys[key] = false;
    };
    const release = () => Object.assign(s.keys, NO_KEYS);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
    };
  }, []);

  useBeforePhysicsStep((w) => {
    const s = sim.current;
    const b = body.current;
    if (!s.vc || !b) return;
    const dt = w.timestep;
    const r = b.rotation();
    const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
    s.stuck = upY < 0.3 || b.translation().y < -20 ? s.stuck + dt : 0;
    s.time += dt;
    if (session?.takeReset()) s.reset = true;
    if (s.reset || s.stuck > STUCK_RESET) {
      // Not again while the last reset is still settling: spamming it can't stack anything.
      if (s.time - s.lastReset >= RESET.cooldown) {
        const t = b.translation();
        const heading = headingOfDirection(2 * (r.x * r.z + r.w * r.y), 1 - 2 * (r.x * r.x + r.y * r.y));
        resetOnGround(w, rapier, b, spec, spawn.position[1] - restLift(spec), findReset?.(t.x, t.y, t.z, heading) ?? undefined);
        Object.assign(s, { lastReset: s.time, drive: { ...newDriveState(), gearbox: { ...s.drive.gearbox, gear: 1, shifting: 0 } } });
      }
      Object.assign(s, { reset: false, stuck: 0 });
    }
    const keys = session ? mergeKeys(s.keys, session.touch, s.held) : s.keys;
    stepVehicle(s.vc, b, spec, s.drive, inputFromKeys(keys), dt);
  });

  useFrame((state, frameDt) => {
    const vc = sim.current.vc;
    if (!vc) return;
    // Paused, everything holds still (after the first frame, which places the camera).
    if (paused && view.current.placed) return;
    // A long gap (coming back from a pause, a slow frame) isn't time to catch up on.
    const dt = Math.min(frameDt, 0.1);
    // Wheels: suspension travel, steering, spin.
    spec.wheels.forEach((w, i) => {
      const node = model.wheels[w.name];
      node.position.y = wheelHardPoint(spec, w)[1] - (vc.wheelSuspensionLength(i) ?? spec.tuning.suspensionRest);
      node.rotation.set(vc.wheelRotation(i) ?? 0, vc.wheelSteering(i) ?? 0, 0);
    });

    // Blinking for a moment after a reset.
    blinkAfterReset(model, sim.current.time - sim.current.lastReset);

    const v = view.current;
    const drive = sim.current.drive;
    model.root.getWorldPosition(v.pos);
    model.root.getWorldQuaternion(v.quat);
    v.fwd.set(0, 0, 1).applyQuaternion(v.quat);
    const speed = vc.currentVehicleSpeed();

    // Body lean from acceleration, with a nose-down kick at each upshift.
    v.body = stepBody(v.body, drive.accel.forward, drive.accel.left, dt);
    if (drive.gearbox.upshifts > v.upshifts) v.body = kick(v.body);
    v.upshifts = drive.gearbox.upshifts;
    poseBody(model, v.body.pitch, v.body.roll);

    // Chase camera: snaps behind the car the first time, then its direction trails the
    // car's; its distance eases with the car's acceleration, and the view widens with a
    // smoothed speed (so a crash doesn't yank it). A crash shakes it instead.
    const first = !v.placed;
    v.dir = first ? turnToward(v.dir, [v.fwd.x, v.fwd.z], 1) : turnToward(v.dir, [v.fwd.x, v.fwd.z], damp(CHASE.turnRate, dt));
    v.pull += (cameraPull(drive.accel.forward) - v.pull) * (first ? 1 : damp(CHASE.pullRate, dt));
    v.speed += (Math.abs(speed) - v.speed) * (first ? 1 : damp(CHASE.speedRate, dt));
    if (drive.impacts > v.impacts || drive.crashing) v.shake = Math.max(v.shake, crashShake(drive.impact));
    v.impacts = drive.impacts;
    v.shake *= 1 - damp(CHASE.shakeDecay, dt);
    v.placed = true;
    const cam = chaseView([v.pos.x, v.pos.y, v.pos.z], v.dir[0], v.dir[1], v.speed, v.pull);
    // Keep buildings and walls from coming between the car and the camera (thin posts and
    // overhead decks don't count: the camera passing a tree trunk looks fine, snapping in front of it didn't).
    const from = { x: v.pos.x, y: v.pos.y + CHASE.focusHeight, z: v.pos.z };
    const to = { x: cam.position[0] - from.x, y: cam.position[1] - from.y, z: cam.position[2] - from.z };
    const full = Math.hypot(to.x, to.y, to.z);
    const dir = { x: to.x / full, y: to.y / full, z: to.z / full };
    const blockers = cameraBlockers?.current;
    const hit = world.castRay(new rapier.Ray(from, dir), full, true, undefined, undefined, undefined, body.current ?? undefined, blockers ? (c) => c.handle === blockers.handle : undefined);
    v.clip = clipDistance(Math.min(v.clip, full), hit ? hit.timeOfImpact : null, full, dt);
    const camera = state.camera as PerspectiveCamera;
    const [sx, sy] = shakeOffset(v.shake, state.clock.elapsedTime);
    camera.position.set(from.x + dir.x * v.clip - dir.z * sx, from.y + dir.y * v.clip + sy + compressedLift(v.clip), from.z + dir.z * v.clip + dir.x * sx);
    camera.lookAt(...cam.lookAt);
    const fov = speedFov(v.speed);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // The map controls stay mounted while driving and turn the camera toward their target on
    // every frame, enabled or not. Their target is the point the chase camera looks at, so
    // that turn changes nothing; it was the car's origin, and once paused (this frame no
    // longer running) the camera tipped down toward the wheels. The target also centers the
    // sun's shadows and the prop distances.
    const controls = state.controls as unknown as { target?: Vector3 } | null;
    controls?.target?.set(...cam.lookAt);

    // Blob shadow on the ground under the wheels that touch it.
    let y = 0;
    let n = 0;
    for (let i = 0; i < spec.wheels.length; i++) {
      if (!vc.wheelIsInContact(i)) continue;
      y += vc.wheelContactPoint(i)?.y ?? 0;
      n++;
    }
    placeShadow(shadow, v.pos.x, n > 0 ? y / n : null, v.pos.z, Math.atan2(v.fwd.x, v.fwd.z));
    // Backing up: reverse lights on, and no brake lights (the brake key is also reverse).
    const reversing = speed < -0.3;
    const braking = drive.braking && !reversing;
    setBrakeLights(model, braking);
    setReverseLights(model, reversing);
    v.toCamera.copy(camera.position).sub(v.pos).normalize();
    const facing = v.fwd.dot(v.toCamera);
    updateHalos(model, braking, -facing, facing, reversing);
    if (session) writeCar(session, v.pos, v.fwd, speed);
    onSpeed?.(speed);
  });

  return (
    <>
      <RigidBody
        ref={body}
        colliders={false}
        position={spawn.position}
        rotation={[0, spawn.yaw, 0]}
        canSleep={false}
        ccd
        angularDamping={spec.tuning.angularDamping}
        linearDamping={spec.tuning.linearDamping}
      >
        <primitive object={model.root} />
      </RigidBody>
      <primitive object={shadow} />
    </>
  );
}

/** Where the car is, for the HUD (map space). */
function writeCar(session: DriveSession, pos: Vector3, fwd: Vector3, speed: number) {
  const c = session.car;
  c.x = pos.x;
  c.y = -pos.z;
  c.height = pos.y;
  c.heading = headingOfDirection(fwd.x, fwd.z);
  c.speed = speed;
  c.placed = true;
}
