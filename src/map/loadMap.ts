import type { MapData } from './types';

export type MapSource = 'bgc' | 'sample';

export const MAP_VERSION = 7;

type FetchResult = { ok: true; map: MapData } | { ok: false; outdated: boolean };

/**
 * Download progress: the share done (0..1) when the size is known, and the bytes so far.
 * The share is unknown (undefined) when the server compresses the file on the way: then
 * the size it announces isn't the size that arrives.
 */
export type LoadProgress = (done: number | undefined, bytes: number) => void;

/** Reads a response's body, reporting progress as it arrives. */
export async function readWithProgress(res: Response, onProgress?: LoadProgress): Promise<string> {
  const length = Number(res.headers.get('content-length'));
  const total = !res.headers.get('content-encoding') && length > 0 ? length : undefined;
  if (!res.body || !onProgress) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytes += value.length;
    onProgress(total ? Math.min(1, bytes / total) : undefined, bytes);
  }
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(all);
}

async function tryFetch(url: string, onProgress?: LoadProgress): Promise<FetchResult> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, outdated: false };
    // Vite's dev server answers missing files with index.html, so parse defensively.
    const data = JSON.parse(await readWithProgress(res, onProgress)) as Partial<MapData> & { version?: number };
    if (!data || !Array.isArray(data.roads)) return { ok: false, outdated: false };
    if (data.version !== MAP_VERSION) return { ok: false, outdated: true };
    return { ok: true, map: data as MapData };
  } catch {
    return { ok: false, outdated: false };
  }
}

/** Loads the real BGC map, falling back to the bundled sample if the pipeline hasn't been run. */
export async function loadMap(onProgress?: LoadProgress): Promise<{ map: MapData; source: MapSource }> {
  const base = import.meta.env.BASE_URL;
  const real = await tryFetch(`${base}data/bgc.json`, onProgress);
  if (real.ok) return { map: real.map, source: 'bgc' };
  if (real.outdated) throw new Error('Map data is from an older version. Run `npm run pipeline` to rebuild it.');
  const sample = await tryFetch(`${base}data/sample.json`);
  if (sample.ok) return { map: sample.map, source: 'sample' };
  throw new Error('No map data found. Run `npm run pipeline` (or `npm run pipeline:sample`).');
}
