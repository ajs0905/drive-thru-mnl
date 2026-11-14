import type { MapData } from './types';

export type MapSource = 'bgc' | 'sample';

export const MAP_VERSION = 6;

type FetchResult = { ok: true; map: MapData } | { ok: false; outdated: boolean };

async function tryFetch(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, outdated: false };
    // Vite's dev server answers missing files with index.html, so parse defensively.
    const data = (await res.json()) as Partial<MapData> & { version?: number };
    if (!data || !Array.isArray(data.roads)) return { ok: false, outdated: false };
    if (data.version !== MAP_VERSION) return { ok: false, outdated: true };
    return { ok: true, map: data as MapData };
  } catch {
    return { ok: false, outdated: false };
  }
}

/** Loads the real BGC map, falling back to the bundled sample if the pipeline hasn't been run. */
export async function loadMap(): Promise<{ map: MapData; source: MapSource }> {
  const base = import.meta.env.BASE_URL;
  const real = await tryFetch(`${base}data/bgc.json`);
  if (real.ok) return { map: real.map, source: 'bgc' };
  if (real.outdated) throw new Error('Map data is from an older version. Run `npm run pipeline` to rebuild it.');
  const sample = await tryFetch(`${base}data/sample.json`);
  if (sample.ok) return { map: sample.map, source: 'sample' };
  throw new Error('No map data found. Run `npm run pipeline` (or `npm run pipeline:sample`).');
}
