/**
 * Small objects drawn as GPU instances: rooftop details, street fixtures and trees.
 * Each is a unit shape (box, cylinder or low-poly blob) scaled, turned and placed;
 * the renderer draws every prop of one shape in a grid cell with a single draw call.
 */
export type PropKind =
  | 'housing' | 'ac' | 'tank'
  | 'pillar' | 'post' | 'boom' | 'bollard' | 'block'
  | 'trunk' | 'palmTrunk' | 'canopy' | 'crown';

export type PropShape = 'box' | 'cylinder' | 'blob';

export const PROP_SHAPE: Record<PropKind, PropShape> = {
  housing: 'box', ac: 'box', tank: 'cylinder',
  pillar: 'box', post: 'box', boom: 'box', bollard: 'cylinder', block: 'box',
  trunk: 'cylinder', palmTrunk: 'cylinder', canopy: 'blob', crown: 'blob',
};

export interface Prop {
  kind: PropKind;
  /** Center of the bottom, map space. */
  x: number;
  y: number;
  /** Height of the bottom above the ground. */
  base: number;
  /** Size along the prop's own x (the `rot` direction), up, and across it. */
  size: [number, number, number];
  /** Rotation around the vertical axis, radians (map space, counter-clockwise from east). */
  rot: number;
  /** 0..1, for picking a color variant. */
  tone: number;
}
