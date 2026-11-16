/**
 * The parts of a merged car model (the vehicle pack's cars as tools/parked-cars-to-glb.ts
 * writes them: one mesh, non-indexed triangles, vertex colors, a `shine` per vertex) that
 * traffic needs to animate: the four wheels (shine 3), to spin and steer them, and the
 * lamp lenses (by their colors), to light them. Pure, on plain arrays.
 */

/** Model frame: +x left, +y up, +z forward (meters). */
export type Vec3 = [number, number, number];

/** Lens colors as the model files have them (linear RGB), and how close counts. */
export const LENS = {
  head: [0.84, 0.81, 0.72] as Vec3,
  tail: [0.09, 0.01, 0.01] as Vec3,
  tolerance: 0.02,
};

export const LAMP = { none: 0, head: 1, tail: 2 } as const;

export interface CarParts {
  /** Per triangle: -1 body, else the wheel it belongs to (index into `wheels`). */
  triangle: Int8Array;
  /** Wheel centers: front left, front right, rear left, rear right. */
  wheels: [Vec3, Vec3, Vec3, Vec3];
  wheelRadius: number;
  /** Per vertex: LAMP.none, head or tail. */
  lamp: Float32Array;
  /** Lamp centers, left then right. Empty when a model has none. */
  head: Vec3[];
  tail: Vec3[];
}

const near = (c: ArrayLike<number>, i: number, want: Vec3) => Math.abs(c[i * 3] - want[0]) < LENS.tolerance && Math.abs(c[i * 3 + 1] - want[1]) < LENS.tolerance && Math.abs(c[i * 3 + 2] - want[2]) < LENS.tolerance;

export function carParts(position: ArrayLike<number>, color: ArrayLike<number>, shine: ArrayLike<number>): CarParts {
  const vertices = position.length / 3;
  const triangle = new Int8Array(vertices / 3).fill(-1);
  // Wheels: the shine-3 triangles, sorted into four by side and end.
  const box = Array.from({ length: 4 }, () => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let t = 0; t < vertices / 3; t++) {
    if (shine[t * 3] < 2.5) continue;
    let [cx, cz] = [0, 0];
    for (let k = 0; k < 3; k++) [cx, cz] = [cx + position[(t * 3 + k) * 3], cz + position[(t * 3 + k) * 3 + 2]];
    const w = (cz > 0 ? 0 : 2) + (cx > 0 ? 0 : 1);
    triangle[t] = w;
    for (let k = 0; k < 3; k++)
      for (let d = 0; d < 3; d++) {
        const v = position[(t * 3 + k) * 3 + d];
        box[w][d] = Math.min(box[w][d], v);
        box[w][d + 3] = Math.max(box[w][d + 3], v);
      }
  }
  const wheels = box.map((b) => (b[0] === Infinity ? [0, 0, 0] : [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2])) as CarParts['wheels'];
  const wheelRadius = box[0][0] === Infinity ? 0 : (box[0][4] - box[0][1]) / 2;
  // Lamps: the lens colors (tail lenses only in the back half: the same dark red trims some fronts).
  const lamp = new Float32Array(vertices);
  const sums = { head: [new Float64Array(4), new Float64Array(4)], tail: [new Float64Array(4), new Float64Array(4)] };
  for (let i = 0; i < vertices; i++) {
    const z = position[i * 3 + 2];
    const kind = near(color, i, LENS.head) && z > 0 ? 'head' : near(color, i, LENS.tail) && z < 0 ? 'tail' : null;
    if (!kind) continue;
    lamp[i] = LAMP[kind];
    const sum = sums[kind][position[i * 3] > 0 ? 0 : 1];
    for (let d = 0; d < 3; d++) sum[d] += position[i * 3 + d];
    sum[3]++;
  }
  const centers = (pair: Float64Array[]): Vec3[] => (pair.every((s) => s[3] > 0) ? pair.map((s) => [s[0] / s[3], s[1] / s[3], s[2] / s[3]] as Vec3) : []);
  return { triangle, wheels, wheelRadius, lamp, head: centers(sums.head), tail: centers(sums.tail) };
}

/** Front wheel angle (radians, + left) for a path turning at `curvature` (1/m, + left), by the bicycle model, within ±`max`. */
export function steerFor(curvature: number, wheelbase: number, max = 0.6): number {
  return Math.max(-max, Math.min(max, Math.atan(wheelbase * curvature)));
}
