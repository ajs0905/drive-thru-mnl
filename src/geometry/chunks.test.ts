import { describe, expect, it } from 'vitest';
import { ChunkedBuilder, chunkKey } from './chunks';

describe('chunkKey', () => {
  it('groups points into grid cells, negative coordinates included', () => {
    expect(chunkKey([10, 10], 100)).toBe('0,0');
    expect(chunkKey([99.9, 0], 100)).toBe('0,0');
    expect(chunkKey([100, 0], 100)).toBe('1,0');
    expect(chunkKey([-1, -1], 100)).toBe('-1,-1');
  });
});

describe('ChunkedBuilder', () => {
  it('keeps one builder per cell and builds only cells with geometry, in a stable order', () => {
    const cb = new ChunkedBuilder({ aux: true }, 100);
    const tri = (mb: ReturnType<typeof cb.at>) => mb.triangle([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 1, 1]);
    tri(cb.at([150, 10]));
    tri(cb.at([160, 20]));
    tri(cb.at([-50, 10]));
    cb.at([500, 500]); // touched but empty
    const chunks = cb.build();
    expect(chunks.map((c) => c.key)).toEqual(['-1,0', '1,0']);
    expect(chunks[1].arrays.position.length).toBe(2 * 9);
    expect(chunks[1].arrays.aux?.length).toBe(2 * 12);
    expect(cb.triangleCount).toBe(3);
  });
});
