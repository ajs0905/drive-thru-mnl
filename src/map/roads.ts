/** Small facts about roads shared by the pipeline and the renderer. */
import type { Road, RoadClass, SidewalkSides } from './types';

const LANE = 3.3;

/** Lanes: the tag if it fits the width, otherwise derived from the width. */
export function laneCount(r: Pick<Road, 'w' | 'lanes'>): number {
  const fit = Math.max(1, Math.floor(r.w / 2.6));
  if (r.lanes) return Math.max(1, Math.min(r.lanes, fit));
  return Math.max(1, Math.round(r.w / LANE));
}

/** 0 service, 1 minor, 2 major (paths are -1). */
export const RANK: Record<RoadClass, number> = { path: -1, service: 0, minor: 1, major: 2 };

/** Which sides get a sidewalk band. Untagged major and minor roads get both, service roads none. */
export function sidewalkBands(r: Pick<Road, 'cls' | 'sidewalk'>): { left: boolean; right: boolean } {
  const s: SidewalkSides = r.sidewalk ?? (r.cls === 'major' || r.cls === 'minor' ? 'both' : 'none');
  return { left: s === 'both' || s === 'left', right: s === 'both' || s === 'right' };
}
