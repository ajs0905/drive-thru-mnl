/**
 * The broken sheds', kiosks' and booth's pieces (scene/breakaway.ts), as one instanced box
 * mesh: each instance a unit box scaled to its part, at its body's pose, in its color.
 * Casts no shadows (small, moving, and the shadow map re-renders only every few frames).
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import { BREAK, type DebrisStore } from './breakaway';

export function Debris({ store }: { store: DebrisStore }) {
  const built = useMemo(() => {
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshLambertMaterial();
    const mesh = new InstancedMesh(geometry, material, BREAK.debris);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return { mesh, geometry, material };
  }, []);
  useEffect(
    () => () => {
      built.mesh.dispose();
      built.geometry.dispose();
      built.material.dispose();
    },
    [built],
  );
  const seen = useRef(-1);
  useFrame(({ invalidate }) => {
    if (store.version === seen.current) return;
    seen.current = store.version;
    drawParts(built.mesh, store);
    invalidate();
  });
  return <primitive object={built.mesh} />;
}

const m = new Matrix4();
const q = new Quaternion();
const v = new Vector3();
const s = new Vector3();
const c = new Color();

function drawParts(mesh: InstancedMesh, store: DebrisStore) {
  const n = Math.min(store.parts.length, BREAK.debris);
  for (let i = 0; i < n; i++) {
    const { pose, size, color } = store.parts[i];
    mesh.setMatrixAt(i, m.compose(v.set(pose.x, pose.y, pose.z), q.set(pose.qx, pose.qy, pose.qz, pose.qw), s.set(size[0], size[1], size[2])));
    mesh.setColorAt(i, c.set(color));
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
