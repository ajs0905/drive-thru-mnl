/**
 * What's around the map: filler city out to the haze (one instanced mesh) and hill
 * ridges on the eastern horizon (one mesh). The hills follow the camera like the sky,
 * so they always sit on the horizon; their colors are already mixed with the haze
 * (aerial perspective), so they skip fog and tone mapping and fade out at the bottom
 * into exactly the fog color the ground ends in.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Camera,
} from 'three';
import { outskirts, RIDGES, ridgeHeights } from '../geometry/outskirts';
import type { MapData } from '../map/types';
import { dropGroup } from './meshUtils';
import { SKY, SURROUNDINGS } from './skyConfig';

function useFiller(map: MapData, density: number) {
  const mesh = useMemo(() => {
    const boxes = outskirts(map, { density });
    const geometry = dropGroup(new BoxGeometry(1, 1, 1), 3).translate(0, 0.5, 0);
    const m = new InstancedMesh(geometry, new MeshLambertMaterial(), Math.max(1, boxes.length));
    m.count = boxes.length;
    const mat = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const pos = new Vector3();
    const scale = new Vector3();
    const color = new Color();
    boxes.forEach((b, i) => {
      q.setFromAxisAngle(up, b.rot);
      mat.compose(pos.set(b.x, 0, -b.y), q, scale.set(b.w, b.h, b.d));
      m.setMatrixAt(i, mat);
      const palette = b.tower ? SURROUNDINGS.towers : SURROUNDINGS.blocks;
      m.setColorAt(i, color.set(palette[Math.floor(b.tone * palette.length)]));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.receiveShadow = true;
    return m;
  }, [map, density]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as MeshLambertMaterial).dispose();
      mesh.dispose();
    },
    [mesh],
  );
  return mesh;
}

/** Ridge strips around the origin (the camera, at run time), colored into the haze. */
function ridgeGeometry(): BufferGeometry {
  const haze = new Color(SKY.horizon);
  const pos: number[] = [];
  const col: number[] = [];
  RIDGES.forEach((r, layer) => {
    const top = new Color(SURROUNDINGS.hills).lerp(haze, SURROUNDINGS.hillHaze[layer]);
    const line = ridgeHeights(r);
    const at = (deg: number, h: number) => {
      const a = (deg * Math.PI) / 180;
      return [Math.cos(a) * r.distance, h, -Math.sin(a) * r.distance];
    };
    const base = -SURROUNDINGS.hillBase;
    for (let i = 0; i < line.length - 1; i++) {
      const [p, q] = [line[i], line[i + 1]];
      const quad = [at(p.angle, base), at(q.angle, base), at(q.angle, q.h), at(p.angle, base), at(q.angle, q.h), at(p.angle, p.h)];
      for (const v of quad) {
        pos.push(...v);
        // Bottom in the haze, top in the hill color: distance fading, painted in.
        const c = v[1] <= base ? haze : top;
        col.push(c.r, c.g, c.b);
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  return g;
}

function useHills() {
  const hills = useMemo(() => {
    // Facing the camera from either side; no fog, no tone mapping (colors already final).
    const material = new MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false, side: 2 });
    const mesh = new Mesh(ridgeGeometry(), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -900;
    const update = (camera: Camera) => mesh.position.set(camera.position.x, 0, camera.position.z);
    return { mesh, update };
  }, []);
  useEffect(() => () => (hills.mesh.geometry.dispose(), (hills.mesh.material as MeshBasicMaterial).dispose()), [hills]);
  return hills;
}

export function Surroundings({ map, density }: { map: MapData; density: number }) {
  const filler = useFiller(map, density);
  const hills = useHills();
  useFrame(({ camera }) => hills.update(camera));
  return (
    <>
      <primitive object={filler} />
      <primitive object={hills.mesh} />
    </>
  );
}
