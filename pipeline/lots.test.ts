import { describe, expect, it } from 'vitest';
import { DRESSING } from '../src/geometry/dressing';
import { distanceToSegment, pointInRing, ringArea } from '../src/geometry/polygon';
import type { Area, MapData, Point, Road } from '../src/map/types';
import { cutAt, LOTS, placeLots, standsOn, traceOutline, wallPieces } from './lots';

const map = (roads: Road[], areas: Area[], extra: Partial<MapData> = {}): MapData => ({
  version: 7,
  origin: { lat: 14.55, lon: 121.05 },
  bounds: { minX: -500, minY: -500, maxX: 500, maxY: 500 },
  roads,
  junctions: [],
  crossings: [],
  buildings: [],
  areas,
  stats: { features: 0, roads: 0, buildings: 0, areas: 0, skipped: {} },
  ...extra,
});
const square = (x0: number, y0: number, size: number): Point[] => [[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size]];
const street = (id: string, points: Point[], extra: Partial<Road> = {}): Road => ({ id, highway: 'residential', cls: 'minor', w: 7, points, ...extra });
/** A 120 m block with a street along each side, 4 m outside the lot outline (OSM's land use often runs onto the street). */
const block = (): Road[] => [
  street('s', [[-20, -4], [140, -4]]),
  street('n', [[-20, 124], [140, 124]]),
  street('w', [[-4, -20], [-4, 140]]),
  street('e', [[124, -20], [124, 140]]),
];
const lengthOf = (pts: Point[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

describe('traceOutline', () => {
  it('traces a block of cells, with its corners cut a little', () => {
    const mask = new Uint8Array(10 * 6).fill(1);
    const rings = traceOutline({ x0: 10, y0: 20, w: 10, h: 6, mask }, 1);
    expect(rings).toHaveLength(1);
    // Through the midpoints of the cell sides, then simplified: the corners are cut, by no
    // more than the simplification allows.
    expect(ringArea(rings[0])).toBeGreaterThan(60 - 4 * LOTS.simplify * LOTS.simplify * 4);
    expect(ringArea(rings[0])).toBeLessThan(60);
    for (const p of rings[0]) expect(p[0] >= 10 && p[0] <= 20 && p[1] >= 20 && p[1] <= 26).toBe(true);
  });

  it('turns a staircase into a straight diagonal instead of a sawtooth', () => {
    const n = 40;
    const mask = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (x <= y * 3) mask[y * n + x] = 1;
    const [ring] = traceOutline({ x0: 0, y0: 0, w: n, h: n, mask }, 1);
    // Three straight sides (plus a few points where they meet), not one corner per step.
    expect(ring.length).toBeLessThan(10);
  });
});

describe('wallPieces', () => {
  const loop: Point[] = square(0, 0, 10);
  it('walls the whole loop when nothing is skipped', () => {
    const pieces = wallPieces(loop, () => false);
    expect(pieces).toHaveLength(1);
    expect(lengthOf(pieces[0])).toBeCloseTo(40);
  });

  it('leaves out the edges backing onto something, starting right after one', () => {
    // Skip the south edge (just outside it is y < 0).
    const pieces = wallPieces(loop, (p) => p[1] < 0);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toEqual([[10, 0], [10, 10], [0, 10], [0, 0]]);
  });
});

describe('standsOn and cutAt', () => {
  const line: Point[] = [[0, 0], [20, 0]];
  it('finds the stretch over a road and cuts the line around it', () => {
    const on = standsOn(line, (p) => (p[0] > 8 && p[0] < 12 ? 'road' : undefined));
    expect(on).toHaveLength(1);
    expect(on[0].from).toBeCloseTo(8, 0);
    expect(on[0].to).toBeCloseTo(12, 0);
    const runs = cutAt(line, on);
    expect(runs.map((r) => r.on)).toEqual([undefined, 'road', undefined]);
    expect(runs.reduce((s, r) => s + lengthOf(r.points), 0)).toBeCloseTo(20);
  });

  it('lets a road win where it overlaps a path', () => {
    const runs = cutAt(line, [
      { from: 5, to: 10, on: 'path' },
      { from: 8, to: 12, on: 'road' },
    ]);
    expect(runs.map((r) => r.on)).toEqual([undefined, 'road', undefined]);
  });
});

describe('placeLots', () => {
  const site: Area = { id: 'site', kind: 'landuse', landuse: 'construction', rings: [square(0, 0, 120)] };

  it('closes a construction lot with hoarding at the back of the sidewalk, and fills it', () => {
    const roads = block();
    const { barriers, dressing, stats } = placeLots(map(roads, [site]));
    expect(stats.byKind).toEqual({ construction: 1 });
    expect(barriers.length).toBeGreaterThan(0);
    for (const b of barriers) {
      expect(b.kind).toBe('hoarding');
      expect(b.h).toBe(2.4);
      // Never on a street or its sidewalk.
      for (const p of b.points) for (const r of roads) expect(distanceToSegment(p, r.points[0], r.points[1])).toBeGreaterThan(r.w / 2 + LOTS.sidewalk.minor - 0.01);
    }
    expect(stats.wallMeters.hoarding).toBeGreaterThan(300);
    expect(dressing.some((d) => d.k === 'container')).toBe(true);
    // Everything inside, and nothing in the yard the car could hit (it can't get in anyway).
    for (const d of dressing) {
      expect(pointInRing(d.p, site.rings[0])).toBe(true);
      expect(DRESSING[d.k].solid).toBe(false);
    }
  });

  it('is the same every time (seeded by the lot)', () => {
    expect(placeLots(map(block(), [site]))).toEqual(placeLots(map(block(), [site])));
  });

  it('walls vacant land with a lot wall and gardens with a hedge', () => {
    const vacant = placeLots(map(block(), [{ ...site, landuse: 'brownfield' }]));
    expect(new Set(vacant.barriers.map((b) => b.kind))).toEqual(new Set(['lotwall']));
    const garden = placeLots(map(block(), [{ id: 'g', kind: 'park', rings: [square(0, 0, 120)] }]));
    expect(new Set(garden.barriers.map((b) => b.kind))).toEqual(new Set(['hedge']));
  });

  it('opens the chosen park with lamps and no walls, and leaves the other open parks as they are', () => {
    const id = Object.keys(LOTS.open).find((k) => LOTS.open[k] === 'park')!;
    const opened = placeLots(map(block(), [{ id, kind: 'park', rings: [square(0, 0, 120)] }]));
    expect(opened.barriers).toHaveLength(0);
    expect(opened.dressing.filter((d) => d.k === 'lamp').length).toBeGreaterThan(4);
    expect(opened.stats.openArea).toBeGreaterThan(10000);
    const kept = placeLots(map(block(), [{ id: LOTS.openParks[0], kind: 'park', rings: [square(0, 0, 120)] }]));
    expect(kept.barriers).toHaveLength(0);
    expect(kept.dressing).toHaveLength(0);
  });

  // A driveway mostly inside the lot belongs to it: the wall closes across it.
  it('puts bollards where a footpath runs into the lot, and a gate where a driveway does', () => {
    const roads = [...block(), street('path', [[60, -4], [60, 60]], { cls: 'path', highway: 'footway', w: 2 }), street('drive', [[-4, 60], [30, 60], [50, 60]], { cls: 'service', highway: 'service', w: 4 })];
    const { barriers, fixtures, stats } = placeLots(map(roads, [site]));
    expect(fixtures.some((f) => f.kind === 'bollard' && Math.abs(f.p[0] - 60) < 2)).toBe(true);
    expect(stats.openings).toBeGreaterThan(0);
    expect(barriers.some((b) => b.id.endsWith('/gate'))).toBe(true);
    // No ordinary wall stands on the path.
    for (const b of barriers) if (!b.id.endsWith('/gate')) for (const p of b.points) expect(Math.abs(p[0] - 60) < 1 && p[1] > 0 && p[1] < 60).toBe(false);
  });

  it('skips small lots and land outside the playable area', () => {
    expect(placeLots(map(block(), [{ ...site, rings: [square(0, 0, 30)] }])).barriers).toHaveLength(0);
    expect(placeLots(map(block(), [site], { playable: square(300, 300, 50) })).barriers).toHaveLength(0);
  });
});
