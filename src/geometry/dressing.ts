/**
 * Street and lot dressing (MapData.dressing, placed by pipeline/lots.ts and
 * pipeline/sidewalks.ts; drawn by scene/Dressing.tsx from public/models/props.glb, built
 * by tools/props-to-glb.ts). One table for every kind: its size, whether the car hits it,
 * and how far out it's drawn.
 *
 * - `size`: length (along `rot`), width, height in meters. The models are built to it, the
 *   collision box and the placement checks use it.
 * - `solid`: in the static collision (the car stops at it). Things only ever placed behind
 *   a lot wall (containers, the crane, mounds) aren't: the car can't reach them, and they'd
 *   only add collision triangles. Stall lines and wheel stops are flat enough to drive over.
 * - `reach`: 'far' for landmarks seen over walls and across blocks (cranes, containers),
 *   'near' for street clutter, which Low leaves out altogether.
 */
import type { DressingKind, Point } from '../map/types';

export interface DressingSpec {
  size: [number, number, number];
  solid: boolean;
  reach: 'far' | 'near';
}

export const DRESSING: Record<DressingKind, DressingSpec> = {
  // Construction yards (behind hoarding).
  container: { size: [6.1, 2.44, 2.6], solid: false, reach: 'far' },
  crane: { size: [4, 4, 46], solid: false, reach: 'far' },
  mound: { size: [9, 7, 2.2], solid: false, reach: 'far' },
  pipes: { size: [6, 2.4, 1.2], solid: false, reach: 'near' },
  crates: { size: [2.4, 1.8, 1.6], solid: false, reach: 'near' },
  dumpster: { size: [2.2, 1.6, 1.4], solid: false, reach: 'near' },
  worklight: { size: [0.6, 0.6, 2.6], solid: false, reach: 'near' },
  // Parks.
  lamp: { size: [0.3, 0.3, 5.5], solid: true, reach: 'near' },
  bench: { size: [1.8, 0.6, 0.85], solid: true, reach: 'near' },
  pavilion: { size: [7, 7, 3.6], solid: true, reach: 'far' },
  // Open parking yards.
  booth: { size: [2.2, 2.2, 2.7], solid: true, reach: 'near' },
  stall: { size: [5, 0.12, 0.02], solid: false, reach: 'near' },
  wheelstop: { size: [1.8, 0.25, 0.12], solid: false, reach: 'near' },
  // Sidewalks.
  shed: { size: [4, 1.6, 2.6], solid: true, reach: 'near' },
  kiosk: { size: [2.4, 2, 2.6], solid: true, reach: 'near' },
  planter: { size: [1.8, 0.8, 0.8], solid: true, reach: 'near' },
  hydrant: { size: [0.4, 0.4, 0.8], solid: true, reach: 'near' },
  bin: { size: [0.6, 0.6, 1], solid: true, reach: 'near' },
};

/** Container paints (DressingKind 'container' takes `c`): the usual shipping line colors. */
export const DRESSING_TINTS = ['#b8432f', '#2f6c9e', '#d79a2a', '#4f7d48', '#8a8f94', '#e2e2dc'];

/** The four corners of a dressing piece's footprint (map space), grown by `margin` (m). */
export function dressingCorners(k: DressingKind, p: Point, rot: number, margin = 0): Point[] {
  const [l, w] = DRESSING[k].size;
  const [hl, hw] = [l / 2 + margin, w / 2 + margin];
  const [c, s] = [Math.cos(rot), Math.sin(rot)];
  return [
    [p[0] + c * hl - s * hw, p[1] + s * hl + c * hw],
    [p[0] - c * hl - s * hw, p[1] - s * hl + c * hw],
    [p[0] - c * hl + s * hw, p[1] - s * hl - c * hw],
    [p[0] + c * hl + s * hw, p[1] + s * hl - c * hw],
  ];
}
