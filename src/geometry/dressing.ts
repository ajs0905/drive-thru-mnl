/**
 * Street and lot dressing (MapData.dressing, placed by pipeline/lots.ts and
 * pipeline/sidewalks.ts; drawn by scene/Dressing.tsx from public/models/props.glb, built
 * by tools/props-to-glb.ts). One table for every kind: its size, whether the car hits it,
 * and how far out it's drawn.
 *
 * - `size`: length (along `rot`), width, height in meters. The models are built to it, the
 *   collision box and the placement checks use it.
 * - `solid`: the car hits it: in the static collision, or (`PROP_PHYSICS`) a pooled body
 *   it can knock over or break. Things only ever placed behind
 *   a lot wall (containers, the crane, mounds) aren't: the car can't reach them, and they'd
 *   only add collision triangles. Stall lines and wheel stops are flat enough to drive over.
 * - `reach`: 'far' for landmarks seen over walls and across blocks (cranes, containers),
 *   'mid' for tall things along the streets (street lights, traffic lights), 'near' for
 *   street clutter, which Low leaves out altogether.
 *
 * Poles (lamps, street lights, traffic lights) stand at `p` with their arm reaching out
 * along `rot`: the size is the pole's, so the collision box and the placement checks are
 * the pole's, and the arm overhead doesn't count.
 */
import type { DressingKind, Point } from '../map/types';

export interface DressingSpec {
  size: [number, number, number];
  solid: boolean;
  reach: 'far' | 'mid' | 'near';
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
  lamp: { size: [0.3, 0.3, 4.5], solid: true, reach: 'near' },
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
  // Street and traffic lights (pipeline/lights.ts): poles with an arm out over the road.
  streetlight: { size: [0.35, 0.35, 8], solid: true, reach: 'mid' },
  signal: { size: [0.4, 0.4, 6.2], solid: true, reach: 'mid' },
  signalpole: { size: [0.3, 0.3, 3.6], solid: true, reach: 'mid' },
};

/** Street and traffic light arms: how far out over the road they reach from the pole (m). */
export const ARMS = { streetlight: 2.6, signal: 4.5, lamp: 1.3 };

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

/**
 * Where a model reaches past its `size` on the ground plane (local x from, to, z from, to;
 * +z is the right of rot): the shed's roof, the kiosk's awning. Checked against
 * props.glb in tools/props.test.ts. Poles aren't here: their arms are overhead, so on the
 * ground only the pole counts.
 */
export const DRAWN: Partial<Record<DressingKind, [number, number, number, number]>> = {
  shed: [-2, 2, -1, 0.8],
  kiosk: [-1.25, 1.25, -1, 1.7],
  booth: [-1.1, 1.1, -1.1, 1.1],
  pavilion: [-3.5, 3.5, -3.5, 3.5],
};

/** The ground footprint of what's drawn (the roof or awning included), grown by `margin` (m): for keeping pieces out of each other. */
export function drawnCorners(k: DressingKind, p: Point, rot: number, margin = 0): Point[] {
  const box = DRAWN[k];
  if (!box) return dressingCorners(k, p, rot, margin);
  const [x0, x1, z0, z1] = [box[0] - margin, box[1] + margin, box[2] - margin, box[3] + margin];
  const [c, s] = [Math.cos(rot), Math.sin(rot)];
  // Local (x, z) to the map: x along rot, z to its right (sin, -cos).
  const at = (x: number, z: number): Point => [p[0] + c * x + s * z, p[1] + s * x - c * z];
  return [at(x1, z0), at(x1, z1), at(x0, z1), at(x0, z0)];
}

/**
 * How solid pieces react when the car hits them (Drive mode, scene/PropPhysics.tsx). They
 * aren't in the static collision mesh: near the player they're pooled physics bodies.
 *
 * - 'knock': a dynamic body (mass in kg), asleep on its spot until hit, then it tips,
 *   slides or topples (a street light snaps off its base and falls).
 * - 'break': fixed in place, so a slow bump stops the car like a wall; hit faster than
 *   `BREAKAWAY.speed` it comes apart into its `DEBRIS` pieces and the car drives through.
 *
 * Kinds not listed (the pavilion) stay in the static collision mesh.
 */
export const PROP_PHYSICS: Partial<Record<DressingKind, { kind: 'knock' | 'break'; mass: number }>> = {
  lamp: { kind: 'knock', mass: 60 },
  bench: { kind: 'knock', mass: 35 },
  planter: { kind: 'knock', mass: 180 },
  hydrant: { kind: 'knock', mass: 50 },
  bin: { kind: 'knock', mass: 15 },
  streetlight: { kind: 'knock', mass: 160 },
  signal: { kind: 'knock', mass: 220 },
  signalpole: { kind: 'knock', mass: 70 },
  shed: { kind: 'break', mass: 0 },
  kiosk: { kind: 'break', mass: 0 },
  booth: { kind: 'break', mass: 0 },
};

/** Breakaway pieces come apart when the car hits them faster than `speed` (m/s, about 30 km/h). */
export const BREAKAWAY = { speed: 8 };

/** A loose piece of a broken structure: its size (m: x along the piece's length, y up, z across), where its center sits on the piece (same axes), mass (kg) and color. */
export interface DebrisPart {
  size: [number, number, number];
  at: [number, number, number];
  mass: number;
  color: string;
}

/** What each breakaway kind comes apart into. */
export const DEBRIS: Partial<Record<DressingKind, DebrisPart[]>> = {
  shed: [
    { size: [4.2, 0.15, 1.8], at: [0, 2.5, -0.1], mass: 40, color: '#2f5d49' },
    { size: [3.6, 1.8, 0.05], at: [0, 1.2, -0.65], mass: 25, color: '#5d7f95' },
    { size: [0.12, 2.45, 0.12], at: [-1.8, 1.2, -0.65], mass: 12, color: '#3b3f42' },
    { size: [0.12, 2.45, 0.12], at: [1.8, 1.2, -0.65], mass: 12, color: '#3b3f42' },
    { size: [3.2, 0.06, 0.4], at: [0, 0.48, -0.35], mass: 15, color: '#3b3f42' },
  ],
  kiosk: [
    { size: [2.4, 1, 2], at: [0, 0.5, 0], mass: 60, color: '#d65f2c' },
    { size: [2.4, 1.2, 0.08], at: [0, 1.6, -0.85], mass: 15, color: '#d8d2c4' },
    { size: [2.5, 0.25, 2], at: [0, 2.3, 0], mass: 20, color: '#d65f2c' },
    { size: [2.4, 0.08, 0.8], at: [0, 1.9, 1.3], mass: 8, color: '#2f6c9e' },
  ],
  booth: [
    { size: [2.2, 1.1, 0.1], at: [0, 0.55, 1.05], mass: 25, color: '#d8d2c4' },
    { size: [2.2, 1.1, 0.1], at: [0, 0.55, -1.05], mass: 25, color: '#d8d2c4' },
    { size: [0.1, 1.1, 2], at: [1.05, 0.55, 0], mass: 20, color: '#d8d2c4' },
    { size: [2.4, 0.3, 2.4], at: [0, 2.55, 0], mass: 30, color: '#3b3f42' },
  ],
};

/** The map's knockable and breakaway pieces, each in its own list, and where each piece sits in its list (for the renderer and the physics to agree). */
export function propLists(pieces: { k: DressingKind; p: Point; rot: number; c?: number }[]) {
  const knock: typeof pieces = [];
  const broke: typeof pieces = [];
  const knockOf = new Map<object, number>();
  const breakOf = new Map<object, number>();
  for (const d of pieces) {
    const how = PROP_PHYSICS[d.k]?.kind;
    if (how === 'knock') {
      knockOf.set(d, knock.length);
      knock.push(d);
    } else if (how === 'break') {
      breakOf.set(d, broke.length);
      broke.push(d);
    }
  }
  return { knock, broke, knockOf, breakOf };
}
