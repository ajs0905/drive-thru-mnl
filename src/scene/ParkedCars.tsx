/**
 * Parked cars, drawn as instances: the real model (one instanced mesh per model) within
 * `near` of where the camera looks, a 30-triangle box car from there out to `far`, and
 * nothing beyond (distance culling), nor outside the camera's view (with some margin, so
 * cars don't pop in at the edges). Which cars are drawn is worked out again whenever the
 * focus moves a few meters, the camera turns a little, or a car moves, from a grid of the
 * cars, so only the cars around the focus are ever touched.
 *
 * Each car's paint comes from its instance color, applied only where the model is painted
 * (a `paint` vertex attribute), so windows, tires and trim keep their colors. Cars moved
 * by the physics in Drive mode are drawn where the physics put them (`ParkedPoses`).
 */
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, Color, Frustum, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Sphere, Vector3, type BufferGeometry, type Camera, type Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PARKED_MODELS, PARKED_PAINTS } from '../car/parked';
import { parkedCarShape } from '../geometry/parkedCarShape';
import type { ParkedCar } from '../map/types';
import { geometryFromArrays } from './meshUtils';
import { homePose, type ParkedPoses } from './parkedPoses';

const CELL = 50;
/** Redo the lists once the focus has moved this far (m), or the camera turned this much (rad). */
const REFRESH = 4;
const TURN = 0.14;
/** Cars this close to the view's edge still count as in view (m): covers the turn between refreshes. */
const VIEW_MARGIN = 8;

/** Lambert with vertex colors where instance color replaces the painted parts. */
function paintMaterial(): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paint;')
      // After three's own color code (vertex color times instance color): paint takes the
      // instance color outright, everything else keeps its vertex color.
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\n  vColor.rgb = mix(color.rgb, instanceColor.rgb, paint);\n#endif');
  };
  m.customProgramCacheKey = () => 'parked-paint';
  return m;
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
      return g;
    });
    const count = (v: number) => cars.filter((c) => c.v === v).length;
    const nearMeshes = geometries.map((g, v) => new InstancedMesh(g, material, Math.max(1, count(v))));
    const box = parkedCarShape();
    const boxGeometry = geometryFromArrays(box);
    boxGeometry.setAttribute('paint', new BufferAttribute(box.paint, 1));
    const farMesh = new InstancedMesh(boxGeometry, material, Math.max(1, cars.length));
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
    return { material, geometries, boxGeometry, nearMeshes, farMesh, paints, grid };
  }, [gltf, cars]);
  useEffect(
    () => () => {
      built.material.dispose();
      for (const g of built.geometries) g.dispose();
      built.boxGeometry.dispose();
      for (const m of [...built.nearMeshes, built.farMesh]) m.dispose();
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

/** Puts the cars around `focus` (map space) into the near and far instanced meshes. */
function fill(
  built: { nearMeshes: InstancedMesh[]; farMesh: InstancedMesh; paints: Color[]; grid: Map<string, number[]> },
  cars: ParkedCar[],
  poses: ParkedPoses,
  focus: [number, number],
  near: number,
  far: number,
  inView: (x: number, z: number) => boolean,
) {
  const counts = built.nearMeshes.map(() => 0);
  let farCount = 0;
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
  built.farMesh.count = farCount;
  built.farMesh.instanceMatrix.needsUpdate = true;
  if (built.farMesh.instanceColor) built.farMesh.instanceColor.needsUpdate = true;
}
