/**
 * Street and lot dressing (MapData.dressing: construction yards, park and sidewalk
 * furniture, the parking yard's stalls) from public/models/props.glb, one model per kind
 * (tools/props-to-glb.ts).
 *
 * One instanced mesh per kind for the whole map, so the dressing costs one draw call per
 * kind in view, at most 18 (a first version with a mesh per kind per grid cell added 20 to
 * 50). Each mesh holds only the pieces within reach of where the camera looks, refilled
 * when that point moves `DRESS.step` m: landmarks (cranes, containers, mounds, the
 * pavilion) out to `far`, street and traffic lights out to `mid`, the rest out to `near`,
 * which is 0 on Low (street clutter left out). Container bodies are painted per instance; everything else keeps its baked colors.
 */
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Color, Group, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRESSING, DRESSING_TINTS } from '../geometry/dressing';
import type { Dressing as Piece, DressingKind } from '../map/types';
import type { ParkedPoses } from './parkedPoses';

/** How far the focus moves before the meshes are refilled (m), and how high pieces stand (m): on the sidewalks and the parking yard's asphalt. */
const DRESS = { step: 20, base: 0.1 };

/** One kind: its mesh, and every piece of it as a position, a world matrix and a color, plus where it is in the knockable or breakaway list (-1 if not). */
interface Kind {
  mesh: InstancedMesh;
  reach: 'near' | 'mid' | 'far';
  xs: Float32Array;
  zs: Float32Array;
  matrices: Matrix4[];
  colors: Color[];
  knock: Int32Array;
  broke: Int32Array;
}

/** Pieces the car has knocked over or broken (Drive mode), and where each piece is in those lists. */
export interface MovedProps {
  knock: ParkedPoses;
  broke: ParkedPoses;
  knockOf: Map<object, number>;
  breakOf: Map<object, number>;
}

export function Dressing({ pieces, near, mid, far, shadows, moved }: { pieces: Piece[]; near: number; mid: number; far: number; shadows: boolean; moved?: MovedProps }) {
  const gltf = useLoader(GLTFLoader, `${import.meta.env.BASE_URL}models/props.glb`);
  const controls = useThree((s) => s.controls) as unknown as { target?: Vector3 } | null;

  const built = useMemo(() => {
    const material = new MeshLambertMaterial({ vertexColors: true });
    const models = new Map<string, Mesh>();
    gltf.scene.traverse((o: Object3D) => {
      if ((o as Mesh).isMesh) models.set(o.name, o as Mesh);
    });
    const byKind = new Map<DressingKind, Piece[]>();
    for (const p of pieces) {
      const list = byKind.get(p.k);
      if (list) list.push(p);
      else byKind.set(p.k, [p]);
    }
    const group = new Group();
    const kinds: Kind[] = [];
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const one = new Vector3(1, 1, 1);
    const white = new Color(1, 1, 1);
    const tints = DRESSING_TINTS.map((h) => new Color(h));
    for (const [k, list] of byKind) {
      const model = models.get(k);
      if (!model) continue;
      const mesh = new InstancedMesh(model.geometry, material, list.length);
      mesh.count = 0;
      group.add(mesh);
      kinds.push({
        mesh,
        reach: DRESSING[k].reach,
        xs: Float32Array.from(list, (p) => p.p[0]),
        zs: Float32Array.from(list, (p) => -p.p[1]),
        matrices: list.map((p) => new Matrix4().compose(new Vector3(p.p[0], DRESS.base, -p.p[1]), q.setFromAxisAngle(up, p.rot), one)),
        colors: list.map((p) => (p.c !== undefined ? tints[p.c % tints.length] : white)),
        knock: Int32Array.from(list, (p) => moved?.knockOf.get(p) ?? -1),
        broke: Int32Array.from(list, (p) => moved?.breakOf.get(p) ?? -1),
      });
    }
    return { group, kinds, material };
  }, [gltf, pieces, moved]);

  useEffect(
    () => () => {
      built.kinds.forEach((k) => k.mesh.dispose());
      built.material.dispose();
    },
    [built],
  );
  // Landmarks cast shadows; everything takes them.
  useEffect(() => setShadows(built.kinds, shadows), [built, shadows]);

  const state = useMemo(() => ({ at: new Vector3(Infinity, 0, 0), near: -1, mid: -1, far: -1, kinds: null as Kind[] | null, versions: '' }), []);
  useFrame(({ camera, invalidate }) => {
    const focus = controls?.target ?? camera.position;
    const versions = moved ? `${moved.knock.version}/${moved.broke.version}` : '';
    const same = state.kinds === built.kinds && state.near === near && state.mid === mid && state.far === far && state.versions === versions;
    if (same && Math.hypot(focus.x - state.at.x, focus.z - state.at.z) < DRESS.step) return;
    Object.assign(state, { near, mid, far, kinds: built.kinds, versions });
    state.at.copy(focus);
    fill(built.kinds, focus, { near, mid, far }, moved);
    invalidate();
  });

  return <primitive object={built.group} />;
}

function setShadows(kinds: Kind[], on: boolean) {
  for (const k of kinds) {
    k.mesh.castShadow = on && k.reach === 'far';
    k.mesh.receiveShadow = on;
  }
}

/** Puts the pieces within reach of the focus (plus a step, so nothing pops in at the edge between refills) into each kind's mesh. */
const posed = new Matrix4();
const pq = new Quaternion();
const pv = new Vector3();
const unit = new Vector3(1, 1, 1);

function fill(kinds: Kind[], focus: Vector3, reaches: Record<Kind['reach'], number>, moved?: MovedProps) {
  for (const k of kinds) {
    const reach = reaches[k.reach];
    const r2 = reach > 0 ? (reach + DRESS.step) ** 2 : -1;
    let n = 0;
    for (let i = 0; i < k.matrices.length; i++) {
      // Broken: gone (its debris is drawn instead). Knocked: where its body is.
      if (moved && k.broke[i] >= 0 && moved.broke.moved.has(k.broke[i])) continue;
      const pose = moved && k.knock[i] >= 0 ? moved.knock.moved.get(k.knock[i]) : undefined;
      if (pose && pose.y < -50) continue;
      const [dx, dz] = pose ? [pose.x - focus.x, pose.z - focus.z] : [k.xs[i] - focus.x, k.zs[i] - focus.z];
      if (dx * dx + dz * dz > r2) continue;
      k.mesh.setMatrixAt(n, pose ? posed.compose(pv.set(pose.x, pose.y, pose.z), pq.set(pose.qx, pose.qy, pose.qz, pose.qw), unit) : k.matrices[i]);
      k.mesh.setColorAt(n, k.colors[i]);
      n++;
    }
    k.mesh.count = n;
    k.mesh.visible = n > 0;
    k.mesh.instanceMatrix.needsUpdate = true;
    if (k.mesh.instanceColor) k.mesh.instanceColor.needsUpdate = true;
    // Worked out again from what's in it, for frustum culling.
    k.mesh.boundingSphere = null;
  }
}
