/** Small helpers for building three.js geometry in scene components. */
import type { BufferGeometry } from 'three';

/** Removes one material group (a face nobody sees, like the bottom of a box on a roof) from an indexed geometry. */
export function dropGroup(geometry: BufferGeometry, group: number): BufferGeometry {
  const index = geometry.getIndex()!;
  const { start, count } = geometry.groups[group];
  const kept = Array.from(index.array).filter((_, i) => i < start || i >= start + count);
  geometry.setIndex(kept);
  geometry.clearGroups();
  return geometry;
}
