import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type { OrthographicCamera } from 'three';
import type { MapData } from '../map/types';

interface ControlsLike {
  target: { set(x: number, y: number, z: number): void };
  update(): void;
}

/** Centers the top-down orthographic camera on the map and zooms to fit it. */
export function FitCamera({ bounds }: { bounds: MapData['bounds'] }) {
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;

  useEffect(() => {
    const w = Math.max(bounds.maxX - bounds.minX, 1);
    const h = Math.max(bounds.maxY - bounds.minY, 1);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = -(bounds.minY + bounds.maxY) / 2;

    camera.zoom = Math.min(size.width / w, size.height / h) * 0.9;
    // Tiny +z offset so "up" on screen is north and OrbitControls isn't looking straight down its own up axis.
    camera.position.set(cx, 2000, cz + 0.01);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.set(cx, 0, cz);
      controls.update();
    }
    // Only refit when the map changes, not on every resize.
  }, [bounds, controls]);

  return null;
}
