import type { FeatureCollection } from 'geojson';
import { describe, expect, it } from 'vitest';
import { createProjection } from '../src/geo/projection';
import type { Barrier, Building, MapData, Point, Road } from '../src/map/types';
import {
  cutPolyline,
  extractExtras,
  mergeIntervals,
  placeExtras,
  pointsAlong,
  pushOff,
  TREE_ROOM,
  treeShape,
  WALL_GATE_WIDTH,
  type RawExtras,
} from './barriers';

const origin = { lat: 14.55, lon: 121.05 };
const proj = createProjection(origin);
/** Local meters -> GeoJSON [lon, lat]. */
const ll = ([x, y]: Point): [number, number] => {
  const { lat, lon } = proj.toLatLon({ x, y });
  return [lon, lat];
};

const map = (roads: Road[], buildings: Building[] = []): MapData => ({
  version: 7,
  origin,
  bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
  roads,
  junctions: [],
  crossings: [],
  buildings,
  areas: [],
  stats: { features: 0, roads: roads.length, buildings: buildings.length, areas: 0, skipped: {} },
});
/** A 10 m wide road along the x axis. */
const road: Road = { id: 'r', highway: 'primary', cls: 'major', w: 10, points: [[-100, 0], [100, 0]] };
const raw = (extra: Partial<RawExtras>): RawExtras => ({ barriers: [], trees: [], fixtures: [], skipped: {}, ...extra });
const wall = (points: Point[], kind: Barrier['kind'] = 'wall'): Barrier => ({ id: 'w', kind, h: 2.4, points });
const len = (pts: Point[]) => pts.slice(1).reduce((d, p, i) => d + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

describe('treeShape', () => {
  it('reads palms from species and leaf_cycle', () => {
    expect(treeShape({ species: 'Roystonea regia' }, 0.9)).toBe('palm');
    expect(treeShape({ leaf_cycle: 'palm' }, 0.9)).toBe('palm');
  });
  it('keeps tagged broadleaf trees broad and seeds the untagged ones', () => {
    expect(treeShape({ species: 'Pterocarpus indicus' }, 0)).toBe('broad');
    expect(treeShape({ leaf_type: 'broadleaved' }, 0)).toBe('broad');
    expect(treeShape({}, 0.1)).toBe('palm');
    expect(treeShape({}, 0.9)).toBe('broad');
  });
});

describe('polyline helpers', () => {
  it('spaces points along a line, half a step in', () => {
    expect(pointsAlong([[0, 0], [20, 0]], 8)).toEqual([[4, 0], [12, 0]]);
  });
  it('merges overlapping intervals', () => {
    expect(mergeIntervals([[5, 8], [0, 2], [1, 3]])).toEqual([[0, 3], [5, 8]]);
  });
  it('cuts the gaps out of a polyline and drops tiny leftovers', () => {
    const parts = cutPolyline([[0, 0], [10, 0], [10, 10]], [[4, 6], [19.8, 30]]);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual([[0, 0], [4, 0]]);
    expect(parts[1][0]).toEqual([6, 0]);
    expect(len(parts[1])).toBeCloseTo(13.8, 5);
  });
  it('pushes a point straight out of a segment', () => {
    const [x, y] = pushOff([5, 4], [0, 0], [10, 0], 2);
    expect(x).toBeCloseTo(5);
    expect(y).toBeCloseTo(6.01);
  });
});

describe('extractExtras', () => {
  const fc: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', id: 'node/1', properties: { natural: 'tree', species: 'Roystonea regia' }, geometry: { type: 'Point', coordinates: ll([1, 2]) } },
      { type: 'Feature', id: 'way/2', properties: { natural: 'tree_row' }, geometry: { type: 'LineString', coordinates: [ll([0, 50]), ll([24, 50])] } },
      { type: 'Feature', id: 'way/3', properties: { barrier: 'wall', height: '3' }, geometry: { type: 'LineString', coordinates: [ll([0, 20]), ll([30, 20])] } },
      { type: 'Feature', id: 'way/4', properties: { barrier: 'hedge' }, geometry: { type: 'Polygon', coordinates: [[ll([0, 0]), ll([5, 0]), ll([5, 5]), ll([0, 0])]] } },
      { type: 'Feature', id: 'node/5', properties: { barrier: 'lift_gate' }, geometry: { type: 'Point', coordinates: ll([3, 3]) } },
      { type: 'Feature', id: 'node/6', properties: { barrier: 'kerb' }, geometry: { type: 'Point', coordinates: ll([3, 3]) } },
      { type: 'Feature', id: 'way/7', properties: { barrier: 'kerb' }, geometry: { type: 'LineString', coordinates: [ll([0, 0]), ll([1, 0])] } },
    ],
  };
  const out = extractExtras(fc, origin);

  it('reads trees, tree rows, barriers and fixtures', () => {
    expect(out.trees).toHaveLength(1 + 3);
    expect(out.trees[0]).toMatchObject({ shape: 'palm' });
    expect(out.barriers.map((b) => [b.id, b.kind, b.h])).toEqual([['way/3', 'wall', 3], ['way/4', 'hedge', 1.3]]);
    expect(out.fixtures).toEqual([{ kind: 'boom', p: [3, 3] }]);
    expect(out.skipped).toEqual({ 'barrier:kerb': 2 });
  });

  it('is deterministic', () => {
    expect(extractExtras(fc, origin)).toEqual(out);
  });
});

describe('placeExtras', () => {
  it('cuts a wall open where a road passes through it', () => {
    const { barriers, stats } = placeExtras(raw({ barriers: [wall([[0, -30], [0, 30]])] }), map([road]));
    expect(barriers).toHaveLength(2);
    expect(stats.gapsCut).toBe(1);
    // Road half width 5 + 0.4 clearance on each side, give or take a sample step.
    for (const b of barriers) for (const [, y] of b.points) expect(Math.abs(y)).toBeGreaterThan(5.3);
  });

  it('leaves guard rails along a road whole', () => {
    const { barriers } = placeExtras(raw({ barriers: [wall([[-20, 4], [20, 4]], 'rail')] }), map([road]));
    expect(barriers).toHaveLength(1);
  });

  it('opens a gap in a wall at a gate with no road through it', () => {
    const { barriers, fixtures } = placeExtras(
      raw({ barriers: [wall([[-20, 30], [20, 30]])], fixtures: [{ kind: 'gate', p: [0, 30] }] }),
      map([road]),
    );
    expect(barriers).toHaveLength(2);
    expect(len(barriers[0].points) + len(barriers[1].points)).toBeCloseTo(40 - WALL_GATE_WIDTH, 5);
    expect(fixtures).toEqual([{ kind: 'gate', p: [0, 30], rot: 0, span: WALL_GATE_WIDTH }]);
  });

  it('turns booms and gates across their road', () => {
    const { fixtures, stats } = placeExtras(
      raw({ fixtures: [{ kind: 'boom', p: [10, 0] }, { kind: 'gate', p: [20, 0] }, { kind: 'boom', p: [0, 50] }, { kind: 'gate', p: [0, 60] }] }),
      map([road]),
    );
    expect(fixtures).toEqual([
      { kind: 'boom', p: [10, 0], rot: 1.57, span: 10 },
      { kind: 'gate', p: [20, 0], rot: 1.57, span: 10.6 },
    ]);
    expect(stats.dropped).toEqual({ 'boom-off-road': 1, 'gate-alone': 1 });
  });

  it('moves curbside trees off the road and drops the rest that stand on roads or in buildings', () => {
    const house: Building = { id: 'b', type: 'house', h: 6, hSrc: 'estimate', rings: [[[30, 20], [40, 20], [40, 30], [30, 30]]] };
    const { trees, stats } = placeExtras(
      raw({
        trees: [
          { p: [0, 4.5], shape: 'broad', s: 1 }, // 1.1 m into the road (with clearance): moved to the curb
          { p: [10, 1], shape: 'broad', s: 1 }, // in the middle of the road: dropped
          { p: [35, 25], shape: 'palm', s: 1 }, // in a house: dropped
          { p: [50, 20], shape: 'broad', s: 1 },
          { p: [50.5, 20], shape: 'broad', s: 1 }, // on top of the one before: dropped
        ],
      }),
      map([road], [house]),
    );
    expect(trees.map((t) => t.p)).toEqual([[0, 5.61], [50, 20]]);
    expect(stats.treesMoved).toBe(1);
    expect(stats.dropped).toEqual({ 'tree-on-road': 1, 'tree-in-building': 1, 'tree-duplicate': 1 });
  });

  it("keeps tree crowns clear of flyovers: moves trees beside a deck away, drops ones it can't, keeps ones that fit under", () => {
    const flyover: Road = { id: 'f', highway: 'primary', cls: 'major', w: 8, points: [[-100, 50], [100, 50]], z: [7, 7] };
    const low: Road = { id: 'l', highway: 'footway', cls: 'path', w: 3, points: [[-100, -50], [100, -50]], z: [3, 3] };
    const { trees, stats } = placeExtras(
      raw({
        trees: [
          { p: [0, 57], shape: 'broad', s: 1 }, // crown into the deck's barrier: moved out
          { p: [20, 51], shape: 'palm', s: 1 }, // right under the deck, too tall: can't move far enough, dropped
          { p: [40, 51], shape: 'broad', s: 0.6 }, // small, fits under the 7 m deck: kept
          { p: [0, -45], shape: 'broad', s: 1 }, // next to a 3 m footbridge: moved out
          { p: [60, 70], shape: 'broad', s: 1 }, // well clear: kept
        ],
      }),
      map([road, flyover, low]),
    );
    expect(stats.dropped).toEqual({ 'tree-by-deck': 1 });
    expect(stats.treesClearedOfDecks).toBe(2);
    const moved = trees.find((t) => t.p[0] === 0 && t.p[1] > 0)!;
    expect(moved.p[1]).toBeGreaterThanOrEqual(50 + 4 + 1 + TREE_ROOM.broad.radius + TREE_ROOM.clearance);
    expect(trees.find((t) => t.p[0] === 40)).toBeDefined();
    expect(trees.find((t) => t.p[0] === 0 && t.p[1] < 0)!.p[1]).toBeGreaterThanOrEqual(-50 + 1.5 + 1 + TREE_ROOM.broad.radius + TREE_ROOM.clearance - 0.01);
  });

  it('drops what is outside the playable area and its scenery ring', () => {
    const playable: Point[] = [[-50, -50], [50, -50], [50, 50], [-50, 50]];
    const { trees, barriers } = placeExtras(
      raw({ trees: [{ p: [0, 30], shape: 'broad', s: 1 }, { p: [0, 500], shape: 'broad', s: 1 }], barriers: [wall([[0, 80], [0, 90]])] }),
      { ...map([]), playable },
      40,
    );
    expect(trees).toHaveLength(1);
    expect(barriers).toEqual([{ id: 'w', kind: 'wall', h: 2.4, scenery: true, points: [[0, 80], [0, 90]] }]);
  });
});
