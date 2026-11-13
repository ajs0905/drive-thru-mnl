import type { Point } from './types';

/**
 * Packs many polylines into ONE flat array of line-segment endpoints
 * (x, y, z per vertex, two vertices per segment) for THREE.LineSegments.
 *
 * One geometry per layer instead of one per road keeps draw calls at a
 * handful no matter how many roads BGC has.
 *
 * Map space (x east, y north) -> three.js (x, height, -y), so north is -z.
 */
export function toSegmentPositions(lines: Point[][], closed: boolean, height = 0): Float32Array {
  let segments = 0;
  for (const line of lines) {
    if (line.length < 2) continue;
    segments += line.length - 1 + (closed && line.length > 2 ? 1 : 0);
  }

  const out = new Float32Array(segments * 6);
  let i = 0;
  const push = (a: Point, b: Point) => {
    out[i++] = a[0]; out[i++] = height; out[i++] = -a[1];
    out[i++] = b[0]; out[i++] = height; out[i++] = -b[1];
  };

  for (const line of lines) {
    if (line.length < 2) continue;
    for (let k = 0; k < line.length - 1; k++) push(line[k], line[k + 1]);
    if (closed && line.length > 2) push(line[line.length - 1], line[0]);
  }
  return out;
}
