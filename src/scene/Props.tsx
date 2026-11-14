/**
 * Props as instanced meshes: one mesh per shape (box, cylinder, blob, or a tree model)
 * per grid cell, so thousands of rooftop details, street fixtures or trees cost a few
 * draw calls. Cells off screen are skipped by frustum culling, and cells farther than
 * `maxDistance` from where the camera looks are hidden.
 *
 * Plain shapes take their whole color from the instance; tree models carry vertex
 * colors (bark, shaded leaves) that the instance color tints.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { Chunk } from '../geometry/chunks';
import { PROP_SHAPE, type Prop, type PropShape } from '../geometry/props';
import { TREE_MODELS, treeMesh } from '../geometry/treeShapes';
import { propInstanceColor } from './cityGeometry';
import { dropGroup, geometryFromArrays } from './meshUtils';

function makeInstances(props: Prop[], geometry: BufferGeometry, material: MeshLambertMaterial): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, props.length));
  mesh.count = props.length;
  const m = new Matrix4();
  const q = new Quaternion();
  const tilt = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const forward = new Vector3(0, 0, 1);
  const pos = new Vector3();
  const scale = new Vector3();
  const color = new Color();
  props.forEach((p, i) => {
    // Map space (x, y) at height h -> three.js (x, h, -y). A turn by +a around three.js +y takes
    // x toward -z, which is map +y: the same counter-clockwise angle as in map space.
    q.setFromAxisAngle(up, p.rot);
    // Lean: tip the prop's +y toward its own +x (a turn around its own z), before the turn by rot.
    if (p.lean) q.multiply(tilt.setFromAxisAngle(forward, -p.lean));
    pos.set(p.x, p.base, -p.y);
    scale.set(p.size[0], p.size[1], p.size[2]);
    m.compose(pos, q, scale);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.setRGB(...propInstanceColor(p)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Unit shapes standing on y = 0. Bottoms are never seen, so they're dropped (box group 3 = -y, cylinder group 2 = bottom cap). */
function unitShapes(): Record<PropShape, BufferGeometry> {
  return {
    box: dropGroup(new BoxGeometry(1, 1, 1), 3).translate(0, 0.5, 0),
    cylinder: dropGroup(new CylinderGeometry(0.5, 0.5, 1, 6), 2).translate(0, 0.5, 0),
    // 20 flat-shaded faces: a low-poly tree crown.
    blob: new IcosahedronGeometry(0.5, 0).translate(0, 0.5, 0),
    treeRound: geometryFromArrays(treeMesh('treeRound')),
    treeWide: geometryFromArrays(treeMesh('treeWide')),
    treeTall: geometryFromArrays(treeMesh('treeTall')),
    palm: geometryFromArrays(treeMesh('palm')),
  };
}

const SHAPES: PropShape[] = ['box', 'cylinder', 'blob', ...TREE_MODELS];

/** Plain shapes, tree models (vertex colors), and palms (vertex colors, fronds seen from both sides). */
function materialsFor() {
  const plain = new MeshLambertMaterial();
  const tree = new MeshLambertMaterial({ vertexColors: true });
  const palm = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const of = (shape: PropShape) => (shape === 'palm' ? palm : (TREE_MODELS as string[]).includes(shape) ? tree : plain);
  return { all: [plain, tree, palm], of };
}

export function Props({ cells, maxDistance }: { cells: Chunk<Prop[]>[]; maxDistance: number }) {
  const props = useMemo(() => {
    const shapes = unitShapes();
    const materials = materialsFor();
    const meshes = cells.flatMap(({ arrays }) =>
      SHAPES.flatMap((shape) => {
        const list = arrays.filter((p) => PROP_SHAPE[p.kind] === shape);
        return list.length ? [makeInstances(list, shapes[shape], materials.of(shape))] : [];
      }),
    );
    /** Hides cells whose nearest prop is farther than `limit` from the focus point. */
    const update = (focus: Vector3, limit: number) => {
      for (const m of meshes) {
        const s = m.boundingSphere!;
        m.visible = s.center.distanceTo(focus) - s.radius < limit;
      }
    };
    return { meshes, shapes, materials: materials.all, update };
  }, [cells]);
  useEffect(
    () => () => {
      for (const m of props.meshes) m.dispose();
      for (const g of Object.values(props.shapes)) g.dispose();
      for (const m of props.materials) m.dispose();
    },
    [props],
  );
  const controls = useThree((st) => st.controls) as unknown as { target?: Vector3 } | null;
  useFrame(({ camera }) => props.update(controls?.target ?? camera.position, maxDistance));
  return (
    <>
      {props.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}
