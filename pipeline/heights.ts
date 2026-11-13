/**
 * Building heights.
 *
 * Only about 2.5% of BGC buildings in OSM have a `height` or `building:levels`
 * tag, so most heights are estimated. The rule, in order:
 *
 *   1. `height` tag             -> use it
 *   2. `building:levels` tag    -> levels x 3.2 m
 *   3. building type            -> fixed height for types with a typical size
 *                                  (houses, garages, churches, schools, ...)
 *   4. footprint area           -> small footprints are low, mid-size footprints
 *                                  are towers, very large footprints are malls
 *                                  and podiums (wide but not that tall)
 *
 * Estimates get a deterministic +/-20% variation from the building id so a
 * block of similar buildings doesn't look like copy-paste. Same id, same height,
 * every build.
 */
import { idUnit } from '../src/map/hash';
import type { HeightSource } from '../src/map/types';

export { idUnit };

export const LEVEL_HEIGHT = 3.2;
export const MIN_HEIGHT = 3;

const BY_TYPE: Record<string, number> = {
  // tiny structures
  garage: 3, garages: 3, shed: 3, roof: 4, carport: 3, kiosk: 3, hut: 3,
  toilets: 3, guardhouse: 3, service: 4, gatehouse: 4, transformer_tower: 6,
  // low residential
  house: 6, detached: 6, semidetached_house: 6, terrace: 6, bungalow: 4,
  // mid-size, typical heights
  church: 14, chapel: 9, cathedral: 20, mosque: 12, temple: 10,
  school: 13, kindergarten: 7, university: 18, college: 18,
  hospital: 22, government: 16, public: 12, civic: 12, fire_station: 10,
  industrial: 9, warehouse: 9, hangar: 12, parking: 14, stadium: 20,
  construction: 6,
};

export interface HeightInput {
  id: string;
  type: string;
  height?: number;
  levels?: number;
  /** Footprint area in m² (outer ring minus holes). */
  footprint: number;
}

export interface HeightResult {
  h: number;
  hSrc: HeightSource;
}

/** Height for a building with no tags, from its footprint area in m². */
export function heightFromFootprint(area: number): number {
  if (!Number.isFinite(area) || area <= 0) return MIN_HEIGHT * 2;
  if (area < 100) return 5; // small houses
  if (area < 250) return 8;
  if (area < 600) return 15; // walk-ups, small offices
  if (area < 1500) return 45; // typical BGC tower footprint
  if (area < 4000) return 80; // big towers
  return 30; // malls, podiums, big boxes: wide, not super tall
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function estimateHeight(b: HeightInput): HeightResult {
  if (b.height && b.height > 0) return { h: round1(Math.max(MIN_HEIGHT, b.height)), hSrc: 'tag' };
  if (b.levels && b.levels > 0) return { h: round1(Math.max(MIN_HEIGHT, b.levels * LEVEL_HEIGHT)), hSrc: 'levels' };

  let base = BY_TYPE[b.type];
  if (base === undefined) {
    base = heightFromFootprint(b.footprint);
    // Retail is usually wide and low even when the footprint is big.
    if (b.type === 'retail' || b.type === 'supermarket' || b.type === 'commercial') base = Math.min(base, 30);
    if (b.type === 'residential' || b.type === 'apartments') base = Math.min(base, 60);
  }

  const variation = 0.8 + idUnit(b.id) * 0.4; // 0.8 .. 1.2
  return { h: round1(Math.max(MIN_HEIGHT, base * variation)), hSrc: 'estimate' };
}
