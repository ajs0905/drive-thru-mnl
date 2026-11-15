/**
 * Parked cars, drawn as instances: the real model (one instanced mesh per model) within
 * `near` of where the camera looks, a 30-triangle box car from there out to `far`, and
 * nothing beyond (distance culling), nor outside the camera's view (with some margin, so
 * cars don't pop in at the edges). Which cars are drawn is worked out again whenever the
 * focus moves a few meters, the camera turns a little, or a car moves, from a grid of the
 * cars, so only the cars around the focus are ever touched.
 *
 * Each car's paint comes from its instance color, applied only where the model is painted
 * (a `paint` vertex attribute), so windows, tires and trim keep their colors. Paint, glass
 * and rims catch the sky like the player's car (carShine.ts). Every drawn car also gets a
 * soft blob shadow under it (one more instanced draw call), so cars sit on the road on
 * Low and past the shadow map's reach too. Cars moved by the physics in Drive mode are
 * drawn where the physics put them (`ParkedPoses`).
 */
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, Color, Euler, Frustum, InstancedMesh, Matrix4, MeshBasicMaterial, MeshLambertMaterial, Quaternion, Sphere, Vector3, type BufferGeometry, type Camera, type Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PARKED_MODELS, PARKED_PAINTS } from '../car/parked';
import { parkedCarShape } from '../geometry/parkedCarShape';
import type { ParkedCar } from '../map/types';
import { blobShadowGeometry, restoreShine } from './carModel';
import { withCarShine } from './carShine';
import { geometryFromArrays } from './meshUtils';
import { homePose, PARKED_Y, type ParkedPoses } from './parkedPoses';

const CELL = 50;
/** Redo the lists once the focus has moved this far (m), or the camera turned this much (rad). */
const REFRESH = 4;
const TURN = 0.14;
/** Cars this close to the view's edge still count as in view (m): covers the turn between refreshes. */
const VIEW_MARGIN = 8;

/** Blob shadow size around a car's footprint, and how dark it is in the middle. */
const BLOB = { grow: 1.06, darkness: 0.4, lift: 0.04 };

/** Lambert with vertex colors where instance color replaces the painted parts, plus the shine. */
function paintMaterial(): MeshLambertMaterial {
  return withCarShine(new MeshLambertMaterial({ vertexColors: true }), 'parked', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paint;')
      // After three's own color code (vertex color times instance color): paint takes the
      // instance color outright, everything else keeps its vertex color.
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\n  vColor.rgb = mix(color.rgb, instanceColor.rgb, paint);\n#endif');
  });
}

function blobMaterial(): MeshBasicMaterial {
  // Drawn just over the road surface without fighting it (like the player's blob).
  return new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

export function ParkedCars({ cars, near, far, poses, shadows }: { cars: ParkedCar[]; near: number; far: number; poses: ParkedPoses; shadows: boolean }) {
  const gltf = useLoader(GLTFLoader, `${import.meta.env.BASE_URL}models/parked-cars.glb`);
  const built = useMemo(() => {
    const material = paintMaterial();
    const geometries = PARKED_MODELS.map((m) => {
      const mesh = gltf.scene.getObjectByName(m.name) as Mesh | undefined;
      if (!mesh) throw new Error(`parked-cars.glb has no ${m.name}`);
      const g = (mesh.geometry as BufferGeometry).clone();
      g.setAttribute('paint', g.getAttribute('_paint') ?? new BufferAttribute(new Float32Array(g.getAttribute('position').count), 1));
      g.deleteAttribute('_paint');
      restoreShine(g);
      return g;
    });
    const count = (v: number) => cars.filter((c) => c.v === v).length;
    const nearMeshes = geometries.map((g, v) => new InstancedMesh(g, material, Math.max(1, count(v))));
    const box = parkedCarShape();
    const boxGeometry = geometryFromArrays(box);
    boxGeometry.setAttribute('paint', new BufferAttribute(box.paint, 1));
    boxGeometry.setAttribute('shine', new BufferAttribute(box.shine, 1));
    const farMesh = new InstancedMesh(boxGeometry, material, Math.max(1, cars.length));
    const blobGeometry = blobShadowGeometry(1, 1, BLOB.darkness);
    const shadowMaterial = blobMaterial();
    const blobs = new InstancedMesh(blobGeometry, shadowMaterial, Math.max(1, cars.length));
    blobs.count = 0;
    blobs.frustumCulled = false;
    blobs.renderOrder = 1;
    const paints = PARKED_PAINTS.map((p) => new Color(p.hex));
    for (const m of [...nearMeshes, farMesh]) {
      m.count = 0;
      m.frustumCulled = false; // only cars around the focus are ever in it
      m.receiveShadow = true;
    }
    // A grid of the cars, for finding the ones around the focus quickly.
    const grid = new Map<string, number[]>();
    cars.forEach((c, i) => {
      const k = `${Math.floor(c.p[0] / CELL)},${Math.floor(c.p[1] / CELL)}`;
      const list = grid.get(k) ?? [];
      list.push(i);
      grid.set(k, list);
    });
    return { material, geometries, boxGeometry, nearMeshes, farMesh, paints, grid, blobGeometry, shadowMaterial, blobs };
  }, [gltf, cars]);
  useEffect(
    () => () => {
      built.material.dispose();
      for (const g of built.geometries) g.dispose();
      built.boxGeometry.dispose();
      built.blobGeometry.dispose();
      built.shadowMaterial.dispose();
      for (const m of [...built.nearMeshes, built.farMesh, built.blobs]) m.dispose();
    },
    [built],
  );
  useEffect(() => setShadows(built.nearMeshes, shadows), [built, shadows]);

  const controls = useThree((st) => st.controls) as unknown as { target?: Vector3 } | null;
  const state = useMemo(() => ({ at: new Vector3(Infinity, 0, 0), facing: new Quaternion(), version: -1, near: -1, far: -1 }), []);
  useFrame(({ camera, invalidate }) => {
    const focus = controls?.target ?? camera.position;
    if (!needsRefresh(state, focus, camera, poses.version, near, far)) return;
    fill(built, cars, poses, [focus.x, -focus.z], near, far, viewOf(camera));
    invalidate();
  });

  return (
    <>
      {built.nearMeshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      <primitive object={built.farMesh} />
      <primitive object={built.blobs} />
    </>
  );
}

function setShadows(meshes: InstancedMesh[], on: boolean) {
  for (const m of meshes) m.castShadow = on;
}

/** True (and remembers the new state) when the drawn cars need working out again. */
function needsRefresh(
  state: { at: Vector3; facing: Quaternion; version: number; near: number; far: number },
  focus: Vector3,
  camera: Camera,
  version: number,
  near: number,
  far: number,
): boolean {
  const same = focus.distanceTo(state.at) < REFRESH && camera.quaternion.angleTo(state.facing) < TURN;
  if (same && version === state.version && near === state.near && far === state.far) return false;
  state.at.copy(focus);
  state.facing.copy(camera.quaternion);
  state.version = version;
  state.near = near;
  state.far = far;
  return true;
}

const frustum = new Frustum();
const viewMatrix = new Matrix4();
const sphere = new Sphere(new Vector3(), VIEW_MARGIN);

/** Is a point (three.js space) in the camera's view, give or take the margin? */
function viewOf(camera: Camera): (x: number, z: number) => boolean {
  camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  return (x, z) => frustum.intersectsSphere(sphere.set(sphere.center.set(x, 1, z), VIEW_MARGIN));
}

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const one = new Vector3(1, 1, 1);
const size = new Vector3();
const euler = new Euler(0, 0, 0, 'YXZ');
const flat = new Quaternion();

/** The blob shadow under a car: on the road, turned with the car (yaw only), sized to its footprint. */
function blobPose(car: ParkedCar, moved: { x: number; z: number } | undefined, out: Matrix4) {
  const [l, w] = PARKED_MODELS[car.v].size;
  size.set(w * BLOB.grow, 1, l * BLOB.grow);
  if (!moved) {
    homePose(car, out, size);
    out.elements[13] += BLOB.lift;
    return;
  }
  euler.setFromQuaternion(q, 'YXZ');
  flat.setFromAxisAngle(v3.set(0, 1, 0), euler.y);
  out.compose(v3.set(moved.x, PARKED_Y + BLOB.lift, moved.z), flat, size);
}

/** Puts the cars around `focus` (map space) into the near and far instanced meshes. */
function fill(
  built: { nearMeshes: InstancedMesh[]; farMesh: InstancedMesh; blobs: InstancedMesh; paints: Color[]; grid: Map<string, number[]> },
  cars: ParkedCar[],
  poses: ParkedPoses,
  focus: [number, number],
  near: number,
  far: number,
  inView: (x: number, z: number) => boolean,
) {
  const counts = built.nearMeshes.map(() => 0);
  let farCount = 0;
  let blobCount = 0;
  const r = Math.ceil(far / CELL);
  const [cx, cy] = [Math.floor(focus[0] / CELL), Math.floor(focus[1] / CELL)];
  for (let gx = cx - r; gx <= cx + r; gx++) {
    for (let gy = cy - r; gy <= cy + r; gy++) {
      for (const i of built.grid.get(`${gx},${gy}`) ?? []) {
        const car = cars[i];
        const moved = poses.moved.get(i);
        const [x, y] = moved ? [moved.x, -moved.z] : car.p;
        const d = Math.hypot(x - focus[0], y - focus[1]);
        if (d > far || !inView(x, -y)) continue;
        const color = built.paints[car.c] ?? built.paints[0];
        if (moved) q.set(moved.qx, moved.qy, moved.qz, moved.qw);
        blobPose(car, moved, m4);
        built.blobs.setMatrixAt(blobCount++, m4);
        if (d <= near) {
          if (moved) m4.compose(v3.set(moved.x, moved.y, moved.z), q, one);
          else homePose(car, m4);
          const mesh = built.nearMeshes[car.v];
          mesh.setMatrixAt(counts[car.v], m4);
          mesh.setColorAt(counts[car.v], color);
          counts[car.v]++;
        } else {
          const [l, w, h] = PARKED_MODELS[car.v].size;
          size.set(w, h, l);
          if (moved) m4.compose(v3.set(moved.x, moved.y, moved.z), q, size);
          else homePose(car, m4, size);
          built.farMesh.setMatrixAt(farCount, m4);
          built.farMesh.setColorAt(farCount, color);
          farCount++;
        }
      }
    }
  }
  built.nearMeshes.forEach((m, v) => {
    m.count = counts[v];
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  built.blobs.count = blobCount;
  built.blobs.instanceMatrix.needsUpdate = true;
  built.farMesh.count = farCount;
  built.farMesh.instanceMatrix.needsUpdate = true;
  if (built.farMesh.instanceColor) built.farMesh.instanceColor.needsUpdate = true;
}
