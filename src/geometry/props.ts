/**
 * Small objects drawn as GPU instances: rooftop details, street fixtures and trees.
 * Each is a unit shape (box, cylinder, low-poly blob, or one of the tree models from
 * treeShapes.ts) scaled, turned and placed; the renderer draws every prop of one shape
 * in a grid cell with a single draw call.
 */
import type { TreeModel } from './treeShapes';

export type PropKind =
  | 'housing' | 'ac' | 'tank'
  | 'pillar' | 'post' | 'boom' | 'bollard' | 'block'
  | 'trunk' | 'palmTrunk' | 'canopy' | 'crown'
  | TreeModel;

export type PropShape = 'box' | 'cylinder' | 'blob' | TreeModel;

export const PROP_SHAPE: Record<PropKind, PropShape> = {
  housing: 'box', ac: 'box', tank: 'cylinder',
  pillar: 'box', post: 'box', boom: 'box', bollard: 'cylinder', block: 'box',
  trunk: 'cylinder', palmTrunk: 'cylinder', canopy: 'blob', crown: 'blob',
  treeRound: 'treeRound', treeWide: 'treeWide', treeTall: 'treeTall', palm: 'palm',
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
  /** Tilt from upright toward the `rot` direction, radians (leaning palms). */
  lean?: number;
}
