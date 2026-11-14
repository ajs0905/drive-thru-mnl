/**
 * The player's car: the model on a Rapier rigid body driven by a ray-cast vehicle
 * (src/car/vehicle.ts), keyboard input, the chase camera, the blob shadow, and brake
 * lights that light up while braking.
 *
 * Physics steps at a fixed 60 Hz (Drive.tsx); before each step the keys become a drive
 * command. The rendered car is interpolated between steps by @react-three/rapier, and
 * after that, each frame, the wheels, camera and shadow are placed from it. Moving the
 * map controls' target along with the car keeps the sun's shadow area and the prop
 * distance limits centered on it.
 */
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { RigidBody, useBeforePhysicsStep, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import { Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CHASE, chaseView, damp, turnToward, type Vec3 } from '../car/chaseCamera';
import { driveCommand, inputFromKeys, KEY_BINDINGS, NO_KEYS, nextSteer } from '../car/controls';
import { wheelHardPoint, type CarSpec } from '../car/spec';
import { applyCommand, chassisCollider, downforce, setupWheels, type VehicleController } from '../car/vehicle';
import { blobShadow, placeShadow, prepareCarModel, setBrakeLights } from './carModel';

/** Seconds upside down (or fallen off the world) before the car puts itself back on its wheels. */
const STUCK_RESET = 2;
/** When driving ends, the map camera rises to this far behind and above the car. */
const EXIT_VIEW = { back: 70, up: 90 };

export function Car({
  spec,
  spawn,
  onSpeed,
}: {
  spec: CarSpec;
  spawn: { position: Vec3; yaw: number };
  /** Called every frame with the forward speed (m/s). */
  onSpeed?: (speed: number) => void;
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
  const sim = useRef({ vc: null as VehicleController | null, steer: 0, keys: { ...NO_KEYS }, reset: false, stuck: 0, braking: false });
  const view = useRef({ dir: [0, 1] as [number, number], placed: false, pos: new Vector3(), quat: new Quaternion(), fwd: new Vector3() });

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
    return () => {
      if (!v.placed) return;
      const { camera } = get();
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
    if (s.reset || s.stuck > STUCK_RESET) {
      putBackOnWheels(b, spawn.position[1]);
      Object.assign(s, { reset: false, stuck: 0, steer: 0 });
    }
    const speed = s.vc.currentVehicleSpeed();
    const input = inputFromKeys(s.keys);
    s.steer = nextSteer(s.steer, input.steer, speed, dt, spec.tuning);
    const cmd = driveCommand(input, speed, s.steer, spec.tuning);
    applyCommand(s.vc, spec, cmd);
    s.braking = input.handbrake || cmd.brakeFront > spec.tuning.coastBrake;
    b.applyImpulse({ x: 0, y: -downforce(spec, speed) * dt, z: 0 }, true);
    s.vc.updateVehicle(dt);
  });

  useFrame((state, dt) => {
    const vc = sim.current.vc;
    if (!vc) return;
    // Wheels: suspension travel, steering, spin.
    spec.wheels.forEach((w, i) => {
      const node = model.wheels[w.name];
      node.position.y = wheelHardPoint(spec, w)[1] - (vc.wheelSuspensionLength(i) ?? spec.tuning.suspensionRest);
      node.rotation.set(vc.wheelRotation(i) ?? 0, vc.wheelSteering(i) ?? 0, 0);
    });

    const v = view.current;
    model.root.getWorldPosition(v.pos);
    model.root.getWorldQuaternion(v.quat);
    v.fwd.set(0, 0, 1).applyQuaternion(v.quat);
    const speed = vc.currentVehicleSpeed();

    // Chase camera: snaps behind the car the first time, then its direction trails the car's.
    v.dir = v.placed ? turnToward(v.dir, [v.fwd.x, v.fwd.z], damp(CHASE.turnRate, dt)) : turnToward(v.dir, [v.fwd.x, v.fwd.z], 1);
    v.placed = true;
    const cam = chaseView([v.pos.x, v.pos.y, v.pos.z], v.dir[0], v.dir[1], speed);
    state.camera.position.set(...cam.position);
    state.camera.lookAt(...cam.lookAt);
    const controls = state.controls as unknown as { target?: Vector3 } | null;
    controls?.target?.copy(v.pos);

    // Blob shadow on the ground under the wheels that touch it.
    let y = 0;
    let n = 0;
    for (let i = 0; i < spec.wheels.length; i++) {
      if (!vc.wheelIsInContact(i)) continue;
      y += vc.wheelContactPoint(i)?.y ?? 0;
      n++;
    }
    placeShadow(shadow, v.pos.x, n > 0 ? y / n : null, v.pos.z, Math.atan2(v.fwd.x, v.fwd.z));
    setBrakeLights(model, sim.current.braking);
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

/** Upright, facing the way the car was heading, a little above where it was, at rest. */
function putBackOnWheels(b: RapierRigidBody, minY: number) {
  const r = b.rotation();
  const fwd = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(r.x, r.y, r.z, r.w));
  const yaw = Math.atan2(fwd.x, fwd.z);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const p = b.translation();
  b.setTranslation({ x: p.x, y: Math.max(p.y, minY) + 1, z: p.z }, true);
  b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
  b.setLinvel({ x: 0, y: 0, z: 0 }, true);
  b.setAngvel({ x: 0, y: 0, z: 0 }, true);
}
