/**
 * Uniform grid (spatial hash) for segments. Answers "which segments are near this
 * one?" without comparing against every segment in the city.
 */
import type { Point } from '../map/types';

export class SegmentGrid<T> {
  private cells = new Map<string, { a: Point; b: Point; item: T }[]>();
  private readonly cellSize: number;

  constructor(cellSize = 50) {
    if (!(cellSize > 0)) throw new RangeError('cellSize must be > 0');
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number) {
    return `${cx},${cy}`;
  }

  private cellsFor(a: Point, b: Point, pad = 0): string[] {
    const s = this.cellSize;
    const x0 = Math.floor((Math.min(a[0], b[0]) - pad) / s);
    const x1 = Math.floor((Math.max(a[0], b[0]) + pad) / s);
    const y0 = Math.floor((Math.min(a[1], b[1]) - pad) / s);
    const y1 = Math.floor((Math.max(a[1], b[1]) + pad) / s);
    const keys: string[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(this.key(x, y));
    return keys;
  }

  insert(a: Point, b: Point, item: T) {
    const entry = { a, b, item };
    for (const k of this.cellsFor(a, b)) {
      const list = this.cells.get(k);
      if (list) list.push(entry);
      else this.cells.set(k, [entry]);
    }
  }

  /** Segments whose cells overlap the segment's bounding box (plus `pad`). May include far ones; never misses near ones. */
  query(a: Point, b: Point, pad = 0): { a: Point; b: Point; item: T }[] {
    const seen = new Set<{ a: Point; b: Point; item: T }>();
    for (const k of this.cellsFor(a, b, pad)) for (const e of this.cells.get(k) ?? []) seen.add(e);
    return [...seen];
  }
}

/** True if segments ab and cd properly cross (touching at an end point does not count). */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
