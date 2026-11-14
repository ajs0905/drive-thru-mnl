/**
 * Rooftop details as two instanced meshes: boxes (stair housings, AC units) and
 * hexagonal cylinders (water tanks). Two draw calls for all of them.
 */
import { useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { RoofProp } from '../geometry/roofProps';
import { ROOF_PROP_COLORS } from './cityGeometry';
import { dropGroup } from './meshUtils';

function makeInstances(props: RoofProp[], geometry: BufferGeometry, pick: (p: RoofProp) => string): InstancedMesh {
  const mesh = new InstancedMesh(geometry, new MeshLambertMaterial(), Math.max(1, props.length));
  mesh.count = props.length;
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const scale = new Vector3();
  const color = new Color();
  props.forEach((p, i) => {
    // Map space (x, y) at height h -> three.js (x, h, -y). A turn by +a around three.js +y takes
    // x toward -z, which is map +y: the same counter-clockwise angle as in map space.
    q.setFromAxisAngle(up, p.rot);
    pos.set(p.x, p.base, -p.y);
    scale.set(p.size[0], p.size[1], p.size[2]);
    m.compose(pos, q, scale);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.set(pick(p)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function RoofProps({ props }: { props: RoofProp[] }) {
  const meshes = useMemo(() => {
    // Unit shapes standing on y = 0, so `base` is the roof height.
    // Bottoms sit on the roof and are never seen, so they're dropped (box group 3 = -y,
    // cylinder group 2 = bottom cap): 10 triangles per box, 18 per tank.
    const box = dropGroup(new BoxGeometry(1, 1, 1), 3).translate(0, 0.5, 0);
    const tank = dropGroup(new CylinderGeometry(0.5, 0.5, 1, 6), 2).translate(0, 0.5, 0);
    const boxes = props.filter((p) => p.kind !== 'tank');
    const tanks = props.filter((p) => p.kind === 'tank');
    return [
      makeInstances(boxes, box, (p) => (p.kind === 'housing' ? ROOF_PROP_COLORS.housing : ROOF_PROP_COLORS.ac)),
      makeInstances(tanks, tank, (p) => ROOF_PROP_COLORS.tanks[Math.floor(p.tone * ROOF_PROP_COLORS.tanks.length)]),
    ];
  }, [props]);
  useEffect(
    () => () => {
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as MeshLambertMaterial).dispose();
        m.dispose();
      }
    },
    [meshes],
  );
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}
