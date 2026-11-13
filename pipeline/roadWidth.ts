/**
 * Road surface width in meters, from OSM tags.
 *
 *   1. `width` tag            -> use it
 *   2. `lanes` tag            -> lanes x 3.2 m + shoulders
 *   3. otherwise              -> typical lanes for the road type, fewer if one-way
 *
 * BGC's avenues are mapped as two one-way carriageways side by side, so a one-way
 * piece is only half the road. Treating each half as a full-width road is what made
 * roads spill into buildings.
 */
import type { RoadClass } from '../src/map/types';

export const LANE_WIDTH = 3.2;

type Tags = Record<string, unknown>;

/** "7", "7 m", "7.5m" -> meters. Rejects feet, junk, and silly values. */
export function parseWidth(v: unknown): number | undefined {
  if (typeof v === 'number') return v > 0.5 && v < 60 ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(m)?\s*$/i.exec(v);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n > 0.5 && n < 60 ? n : undefined;
}

/** "3" -> 3. Uses the first number for values like "2;3". */
export function parseLanes(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? Math.floor(n) : undefined;
}

const isOneway = (t: Tags) => t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1' || t.junction === 'roundabout';

/** Typical lane count when the data doesn't say: [two-way, one-way]. */
const DEFAULT_LANES: Record<string, [number, number]> = {
  motorway: [4, 3],
  trunk: [4, 3],
  primary: [4, 3],
  secondary: [4, 2],
  tertiary: [2, 2],
  unclassified: [2, 1],
  residential: [2, 1],
  living_street: [2, 1],
  road: [2, 1],
};

const PATH_WIDTH: Record<string, number> = {
  footway: 2,
  path: 1.5,
  cycleway: 2,
  steps: 2,
  pedestrian: 4,
  track: 3,
  corridor: 2,
  bridleway: 2,
};

export function roadWidth(highway: string, cls: RoadClass, t: Tags): number {
  const tagged = parseWidth(t.width);
  if (tagged) return tagged;

  if (cls === 'path') return PATH_WIDTH[highway] ?? 2;

  const oneway = isOneway(t);
  const lanes = parseLanes(t.lanes);
  if (lanes) return lanes * LANE_WIDTH + (oneway ? 0.6 : 1);

  if (cls === 'service') {
    const kind = t.service;
    if (kind === 'driveway' || kind === 'parking_aisle' || kind === 'drive-through') return 3.5;
    if (kind === 'alley') return 3;
    return oneway ? 3.5 : 5;
  }

  if (highway.endsWith('_link')) return LANE_WIDTH + 0.8; // ramps are one lane unless tagged
  const [two, one] = DEFAULT_LANES[highway] ?? [2, 1];
  return (oneway ? one : two) * LANE_WIDTH + (oneway ? 0.6 : 1);
}
