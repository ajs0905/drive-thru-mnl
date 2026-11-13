import type { MapData } from './types';

export type MapSource = 'bgc' | 'sample';

async function tryFetch(url: string): Promise<MapData | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    // Vite's dev server answers missing files with index.html, so parse defensively.
    const data = (await res.json()) as MapData;
    return data && data.version === 1 && Array.isArray(data.roads) ? data : null;
  } catch {
    return null;
  }
}

/** Loads the real BGC map, falling back to the bundled sample if the pipeline hasn't been run. */
export async function loadMap(): Promise<{ map: MapData; source: MapSource }> {
  const base = import.meta.env.BASE_URL;
  const real = await tryFetch(`${base}data/bgc.json`);
  if (real) return { map: real, source: 'bgc' };
  const sample = await tryFetch(`${base}data/sample.json`);
  if (sample) return { map: sample, source: 'sample' };
  throw new Error('No map data found. Run `npm run pipeline` (or `npm run pipeline:sample`).');
}
