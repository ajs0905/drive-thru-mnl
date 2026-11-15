/**
 * The roadblocks along the playable edge (geometry/roadblocks.ts), drawn as instances:
 * one instanced mesh per piece (concrete barrier, barricade, drum, cone, sign), drawn
 * `ROADBLOCK.scale` times real size, only
 * those within `far` of the camera's focus, redone when the focus moves a few meters or a
 * piece moves. Loose pieces knocked about in Drive mode are drawn where the physics put
 * them (`poses`, indexed like `loose`).
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import { yawForHeading } from '../car/spawn';
import { KENNEY_BARRIER, KENNEY_CONE } from '../geometry/kenneyShapes';
import { barricadeShape, drumShape, signShape, type ShapeArrays } from '../geometry/roadblockShapes';
import { ROADBLOCK, type RoadblockKind, type RoadblockProp } from '../geometry/roadblocks';
import type { ParkedPoses } from './parkedPoses';
import { ROADBLOCK_Y } from './roadblockBodies';
import { createSignTexture } from './roadblockSign';
const KINDS: RoadblockKind[] = ['concrete', 'barricade', 'drum', 'cone', 'sign'];
const REFRESH = 4;

function geometryOf(a: ShapeArrays): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(a.position, 3));
  g.setAttribute('normal', new BufferAttribute(a.normal, 3));
  g.setAttribute('color', new BufferAttribute(a.color, 3));
  if (a.uv) g.setAttribute('uv', new BufferAttribute(a.uv, 2));
  return g;
}

export function Roadblocks({ props, loose, poses, far, shadows }: { props: RoadblockProp[]; loose: RoadblockProp[]; poses: ParkedPoses; far: number; shadows: boolean }) {
  const built = useMemo(() => {
    const shapes: Record<RoadblockKind, ShapeArrays> = { concrete: KENNEY_BARRIER, barricade: barricadeShape(), drum: drumShape(), cone: KENNEY_CONE, sign: signShape() };
    const plain = glowing(new MeshLambertMaterial({ vertexColors: true }), 'roadblock');
    const signMap = createSignTexture();
    const sign = glowing(new MeshLambertMaterial({ map: signMap, vertexColors: true }), 'roadblock-sign');
    const count = (k: RoadblockKind) => Math.max(1, props.filter((p) => p.kind === k).length);
    const meshes = Object.fromEntries(
      KINDS.map((k) => {
        const m = new InstancedMesh(geometryOf(shapes[k]), k === 'sign' ? sign : plain, count(k));
        m.count = 0;
        m.frustumCulled = false;
        m.receiveShadow = true;
        return [k, m];
      }),
    ) as unknown as Record<RoadblockKind, InstancedMesh>;
    const looseIndex = new Map(loose.map((p, i) => [p, i]));
    return { meshes, plain, sign, signMap, looseIndex };
  }, [props, loose]);
  useEffect(
    () => () => {
      for (const m of Object.values(built.meshes)) {
        m.geometry.dispose();
        m.dispose();
      }
      [built.plain, built.sign, built.signMap].forEach((x) => x.dispose());
    },
    [built],
  );
  useEffect(() => setShadows(built.meshes, shadows), [built, shadows]);

  const controls = useThree((st) => st.controls) as unknown as { target?: Vector3 } | null;
  const state = useMemo(() => ({ at: new Vector3(Infinity, 0, 0), version: -1, far: -1 }), []);
  useFrame(({ camera, invalidate }) => {
    const focus = controls?.target ?? camera.position;
    if (!needsRefresh(state, focus, poses.version, far)) return;
    fill(built.meshes, props, built.looseIndex, poses, [focus.x, -focus.z], far);
    invalidate();
  });

  return (
    <>
      {KINDS.map((k) => (
        <primitive key={k} object={built.meshes[k]} />
      ))}
    </>
  );
}

/**
 * Safety orange is fluorescent and the white stripes are reflective: in the shade they
 * still look bright. A little of each surface's own color is added on top of the lighting.
 */
const GLOW = 0.22;
function glowing(m: MeshLambertMaterial, key: string): MeshLambertMaterial {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * ${GLOW.toFixed(2)};`);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

function setShadows(meshes: Record<RoadblockKind, InstancedMesh>, on: boolean) {
  for (const m of Object.values(meshes)) m.castShadow = on;
}

function needsRefresh(state: { at: Vector3; version: number; far: number }, focus: Vector3, version: number, far: number): boolean {
  if (focus.distanceTo(state.at) < REFRESH && version === state.version && far === state.far) return false;
  state.at.copy(focus);
  state.version = version;
  state.far = far;
  return true;
}

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const size = new Vector3(ROADBLOCK.scale, ROADBLOCK.scale, ROADBLOCK.scale);
const up = new Vector3(0, 1, 0);

function fill(meshes: Record<RoadblockKind, InstancedMesh>, props: RoadblockProp[], looseIndex: Map<RoadblockProp, number>, poses: ParkedPoses, focus: [number, number], far: number) {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<RoadblockKind, number>;
  for (const p of props) {
    const i = looseIndex.get(p);
    const moved = i === undefined ? undefined : poses.moved.get(i);
    const [x, y] = moved ? [moved.x, -moved.z] : p.p;
    if (Math.hypot(x - focus[0], y - focus[1]) > far) continue;
    if (moved) m4.compose(v3.set(moved.x, moved.y, moved.z), q.set(moved.qx, moved.qy, moved.qz, moved.qw), size);
    else m4.compose(v3.set(p.p[0], ROADBLOCK_Y, -p.p[1]), q.setFromAxisAngle(up, yawForHeading(p.rot)), size);
    meshes[p.kind].setMatrixAt(counts[p.kind]++, m4);
  }
  for (const k of KINDS) {
    meshes[k].count = counts[k];
    meshes[k].instanceMatrix.needsUpdate = true;
  }
}
