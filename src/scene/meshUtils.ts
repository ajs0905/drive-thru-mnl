/** Small helpers for building three.js geometry in scene components. */
import { BufferAttribute, BufferGeometry } from 'three';

/** Removes one material group (a face nobody sees, like the bottom of a box on a roof) from an indexed geometry. */
export function dropGroup(geometry: BufferGeometry, group: number): BufferGeometry {
  const index = geometry.getIndex()!;
  const { start, count } = geometry.groups[group];
  const kept = Array.from(index.array).filter((_, i) => i < start || i >= start + count);
  geometry.setIndex(kept);
  geometry.clearGroups();
  return geometry;
}

/** Flat-shaded mesh arrays (position, normal, linear color per vertex) as a geometry. */
export function geometryFromArrays(a: { position: Float32Array; normal: Float32Array; color: Float32Array }): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(a.position, 3));
  g.setAttribute('normal', new BufferAttribute(a.normal, 3));
  g.setAttribute('color', new BufferAttribute(a.color, 3));
  g.computeBoundingSphere();
  return g;
}
