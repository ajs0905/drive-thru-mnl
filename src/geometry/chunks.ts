/**
 * Chunked mesh building: geometry goes into one MeshBuilder per grid cell, so each
 * layer becomes a handful of meshes instead of one. The renderer can then skip the
 * cells that are off screen (frustum culling) or outside the shadow map's area.
 *
 * Cells are big (1.2 km) to keep draw calls low: the playable area plus its scenery
 * ring is about 3 x 3 cells. Each item goes into the cell of one reference point;
 * meshes get bounding spheres from their actual vertices, so an item reaching into a
 * neighbouring cell is still culled correctly.
 */
import type { Point } from '../map/types';
import { MeshBuilder } from './meshBuilder';

export const CHUNK_SIZE = 1200;

export function chunkKey([x, y]: Point, size = CHUNK_SIZE): string {
  return `${Math.floor(x / size)},${Math.floor(y / size)}`;
}

export interface Chunk<T> {
  key: string;
  arrays: T;
}

export class ChunkedBuilder {
  private builders = new Map<string, MeshBuilder>();
  private readonly opts: { aux?: boolean };
  private readonly size: number;

  constructor(opts: { aux?: boolean } = {}, size = CHUNK_SIZE) {
    this.opts = opts;
    this.size = size;
  }

  /** The builder for the cell containing `p`. */
  at(p: Point): MeshBuilder {
    const key = chunkKey(p, this.size);
    let mb = this.builders.get(key);
    if (!mb) {
      mb = new MeshBuilder(this.opts);
      this.builders.set(key, mb);
    }
    return mb;
  }

  get triangleCount(): number {
    let n = 0;
    for (const mb of this.builders.values()) n += mb.triangleCount;
    return n;
  }

  /** Non-empty cells, in a stable order. */
  build(): Chunk<ReturnType<MeshBuilder['build']>>[] {
    return [...this.builders]
      .filter(([, mb]) => mb.triangleCount > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, mb]) => ({ key, arrays: mb.build() }));
  }
}
