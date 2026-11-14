import { describe, expect, it } from 'vitest';
import type { Building, MapData, Ring } from '../src/map/types';
import { clipToPlayable, trimPolyline, zoneOf } from './clip';

// A 100 x 100 m playable square, 50 m scenery margin.
const playable: Ring = [[0, 0], [100, 0], [100, 100], [0, 100]];
const MARGIN = 50;

const square = (cx: number, cy: number, d = 5): Ring => [
  [cx - d, cy - d], [cx + d, cy - d], [cx + d, cy + d], [cx - d, cy + d],
];
const building = (id: string, cx: number, cy: number): Building => ({
  id, type: 'yes', h: 10, hSrc: 'estimate', rings: [square(cx, cy)],
});

const map: MapData = {
  version: 7,
  junctions: [],
  crossings: [],
  origin: { lat: 14.55, lon: 121.05 },
  bounds: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
  buildings: [
    building('in', 50, 50),
    building('ring', 130, 50), // 30 m outside
    building('out', 300, 50), // 200 m outside
  ],
  roads: [
    { id: 'through', highway: 'primary', cls: 'major', w: 10, points: [[-500, 50], [-100, 50], [-20, 50], [50, 50], [120, 50], [500, 50]] },
    { id: 'ringonly', highway: 'service', cls: 'service', w: 5, points: [[120, -10], [120, 110]] },
    { id: 'far', highway: 'residential', cls: 'minor', w: 7, points: [[500, 500], [600, 600]] },
    { id: 'longsegment', highway: 'primary', cls: 'major', w: 10, points: [[-2000, 50], [2000, 50]] },
    { id: 'inout', highway: 'residential', cls: 'minor', w: 7, points: [[50, 50], [50, 120], [50, 400], [50, 900], [50, 120], [50, 60]] },
  ],
  areas: [
    { id: 'huge', kind: 'landuse', landuse: 'residential', rings: [[[-5000, -5000], [5000, -5000], [5000, 5000], [-5000, 5000]]] },
    { id: 'faraway', kind: 'park', rings: [square(3000, 3000, 50)] },
  ],
  stats: { features: 10, roads: 5, buildings: 3, areas: 2, skipped: {} },
};

const clipped = clipToPlayable(map, playable, MARGIN);
const byId = <T extends { id: string }>(xs: T[], id: string) => xs.find((x) => x.id === id);

describe('zoneOf', () => {
  it('classifies inside, ring and out', () => {
    expect(zoneOf([50, 50], playable, MARGIN)).toBe('inside');
    expect(zoneOf([130, 50], playable, MARGIN)).toBe('ring');
    expect(zoneOf([150, 50], playable, MARGIN)).toBe('ring'); // exactly on the margin
    expect(zoneOf([151, 50], playable, MARGIN)).toBe('out');
  });
});

describe('trimPolyline', () => {
  // Keep a segment if either end is in x 0..10.
  const inX = ([x]: [number, number]) => x >= 0 && x <= 10;
  const keep = (a: [number, number], b: [number, number]) => inX(a) || inX(b);

  it('keeps runs of segments, reaching one point past the area on each side', () => {
    const runs = trimPolyline([[-20, 0], [-10, 0], [5, 0], [20, 0], [30, 0]], keep);
    expect(runs).toEqual([[[-10, 0], [5, 0], [20, 0]]]);
  });

  it('splits into several runs when the line leaves and comes back', () => {
    const runs = trimPolyline([[5, 0], [50, 0], [60, 0], [5, 1]], keep);
    expect(runs).toEqual([[[5, 0], [50, 0]], [[60, 0], [5, 1]]]);
  });

  it('returns nothing when no segment is kept', () => {
    expect(trimPolyline([[50, 0], [60, 0]], keep)).toEqual([]);
  });
});

describe('clipToPlayable', () => {
  it('keeps playable buildings, tags scenery and drops far ones', () => {
    expect(byId(clipped.buildings, 'in')?.scenery).toBeUndefined();
    expect(byId(clipped.buildings, 'ring')?.scenery).toBe(true);
    expect(byId(clipped.buildings, 'out')).toBeUndefined();
  });

  it('trims long roads to the area and marks playable vs scenery', () => {
    const through = byId(clipped.roads, 'through')!;
    expect(through.scenery).toBeUndefined();
    expect(through.points[0]).toEqual([-50, 50]); // trimmed at the edge of the scenery box
    expect(through.points.at(-1)).toEqual([150, 50]);
    expect(byId(clipped.roads, 'ringonly')?.scenery).toBe(true);
    expect(byId(clipped.roads, 'far')).toBeUndefined();
  });

  it('keeps a long segment that crosses the area even though both ends are far outside', () => {
    const r = byId(clipped.roads, 'longsegment');
    expect(r?.points).toEqual([[-50, 50], [150, 50]]);
    expect(r?.scenery).toBeUndefined();
  });

  it('splits a road that leaves and re-enters into separate pieces', () => {
    const pieces = clipped.roads.filter((r) => r.id.startsWith('inout'));
    expect(pieces.map((r) => r.id)).toEqual(['inout~0', 'inout~1']);
  });

  it('clips huge land-use areas to the box around the playable area', () => {
    const huge = byId(clipped.areas, 'huge')!;
    for (const [x, y] of huge.rings[0]) {
      expect(x).toBeGreaterThanOrEqual(-MARGIN);
      expect(x).toBeLessThanOrEqual(100 + MARGIN);
      expect(y).toBeGreaterThanOrEqual(-MARGIN);
      expect(y).toBeLessThanOrEqual(100 + MARGIN);
    }
    expect(byId(clipped.areas, 'faraway')).toBeUndefined();
  });

  it('stores the outline, recomputes bounds and reports what was dropped', () => {
    expect(clipped.playable).toEqual(playable);
    expect(clipped.bounds.minX).toBeGreaterThanOrEqual(-MARGIN);
    expect(clipped.bounds.maxX).toBeLessThanOrEqual(100 + MARGIN);
    expect(clipped.stats.clip).toEqual({
      marginMeters: MARGIN,
      playableBuildings: 1,
      sceneryBuildings: 1,
      droppedBuildings: 1,
      droppedRoads: 1,
      droppedAreas: 1,
    });
    expect(clipped.stats.buildings).toBe(2);
  });

  it('does not mutate the input map', () => {
    expect(map.buildings).toHaveLength(3);
    expect(map.roads[0].points).toHaveLength(6);
  });

  it('rejects a degenerate playable area', () => {
    expect(() => clipToPlayable(map, [[0, 0], [1, 1]])).toThrow(RangeError);
  });
});
