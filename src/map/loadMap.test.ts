import { describe, expect, it } from 'vitest';
import { readWithProgress } from './loadMap';

const streamed = (chunks: string[], headers: Record<string, string>) => {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s));
      c.close();
    },
  });
  return new Response(body, { headers });
};

describe('readWithProgress', () => {
  it('reports the share read when the size is known', async () => {
    const seen: (number | undefined)[] = [];
    const text = await readWithProgress(streamed(['{"a":', '1}'], { 'content-length': '7' }), (done) => seen.push(done));
    expect(text).toBe('{"a":1}');
    expect(seen.at(-1)).toBe(1);
    expect(seen[0]).toBeCloseTo(5 / 7);
  });
  it('reports only bytes when the size is unknown or compressed', async () => {
    const seen: [number | undefined, number][] = [];
    await readWithProgress(streamed(['abc', 'de'], { 'content-length': '3', 'content-encoding': 'gzip' }), (done, bytes) => seen.push([done, bytes]));
    expect(seen).toEqual([
      [undefined, 3],
      [undefined, 5],
    ]);
  });
  it('reads normally without a progress callback', async () => {
    expect(await readWithProgress(streamed(['hi'], {}))).toBe('hi');
  });
});
