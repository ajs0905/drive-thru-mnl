import { describe, expect, it } from 'vitest';
import { distanceToSegment } from '../src/geometry/polygon';
import { DECKS } from '../src/geometry/road';
import type { Building, Point, Road } from '../src/map/types';
import { placeStructures, SUPPORTS } from './structures';

let n = 0;
const road = (points: Point[], extra: Partial<Road> = {}): Road => ({ id: `r${n++}`, highway: 'primary', cls: 'major', w: 8, points, ...extra });
const deck = (points: Point[], z = 7, extra: Partial<Road> = {}) => road(points, { z: points.map(() => z), oneway: true, ...extra });
const box = (x0: number, y0: number, x1: number, y1: number, extra: Partial<Building> = {}): Building => ({
  id: `b${n++}`,
  type: 'roof',
  h: 4.2,
  minH: 3.6,
  hSrc: 'tag',
  rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  ...extra,
});
/** Is any pillar standing in the lanes of `r`? */
const inLanes = (pillars: { p: Point; size: number }[], r: Road) =>
  pillars.some((p) => r.points.slice(1).some((b, i) => distanceToSegment(p.p, r.points[i], b) < r.w / 2 + p.size / 2));

describe('deck pillars', () => {
  it('puts one every 30 m from 15 m in, under the centerline, turned along the deck', () => {
    const { pillars } = placeStructures([deck([[0, 0], [100, 0]])], []);
    expect(pillars.map((p) => p.p)).toEqual([[15, 0], [45, 0], [75, 0]]);
    expect(pillars.every((p) => p.top === 7 - DECKS.drive.depth && p.rot === 0 && !p.cap)).toBe(true);
  });

  it('leaves them out where the deck is too low to need them', () => {
    expect(placeStructures([deck([[0, 0], [100, 0]], 2.5)], []).pillars).toHaveLength(0);
  });

  it('slides a pillar along the deck off a road passing underneath', () => {
    const below = road([[45, -50], [45, 50]], { w: 10 });
    const { pillars, stats } = placeStructures([deck([[0, 0], [100, 0]]), below], []);
    expect(pillars).toHaveLength(3);
    expect(inLanes(pillars, below)).toBe(false);
    expect(stats.moved).toBe(1);
  });

  it('may stand in the median of a wide two-way avenue under a viaduct', () => {
    // Viaduct 2.7 m off the avenue's centerline (as Lawton's two one-way decks are).
    const avenue = road([[-10, 0], [110, 0]], { w: 13.4 });
    const { pillars } = placeStructures([deck([[0, 2.7], [100, 2.7]], 7, { w: 4.9 }), avenue], []);
    expect(pillars.length).toBe(3);
    for (const p of pillars) expect(Math.abs(p.p[1])).toBeLessThanOrEqual(0.5);
  });

  it('stands beside the deck with a cap beam when the deck runs right over a road', () => {
    const under = road([[-10, 0], [110, 0]], { w: 7, oneway: true });
    const { pillars, stats } = placeStructures([deck([[0, 0], [100, 0]], 7, { w: 7 }), under], []);
    expect(pillars.length).toBe(3);
    expect(inLanes(pillars, under)).toBe(false);
    for (const p of pillars) expect(p.cap?.[1]).toBe(0); // the beam reaches back under the deck
    expect(stats.outriggers).toBe(3);
  });

  it("doesn't count the deck itself or roads up at its height as underneath", () => {
    const next = deck([[100, 0], [200, 0]]);
    const { pillars } = placeStructures([deck([[0, 0], [100, 0]]), next], []);
    expect(pillars).toHaveLength(6);
  });
});

describe('posts under raised buildings', () => {
  it('holds up a free-standing canopy with slim posts along its outline, every 10 m at most', () => {
    const { pillars, stats } = placeStructures([], [box(0, 0, 20, 10)]);
    expect(stats.raisedBuildings).toBe(1);
    expect(pillars.every((p) => p.size === SUPPORTS.canopy && p.top === 3.6)).toBe(true);
    expect(pillars.length).toBe(6); // two per long side, one per short side
    // All inside the outline.
    for (const p of pillars) expect(p.p[0] > 0 && p.p[0] < 20 && p.p[1] > 0 && p.p[1] < 10).toBe(true);
  });

  it('uses thicker posts for a whole building on stilts', () => {
    const { pillars } = placeStructures([], [box(0, 0, 10, 10, { type: 'yes', h: 26, minH: 5.2 })]);
    expect(pillars.every((p) => p.size === SUPPORTS.building)).toBe(true);
  });

  it('puts no posts along a wall that leans on another building (a skybridge)', () => {
    const bridge = box(10, 0, 30, 4, { type: 'yes', h: 12, minH: 6 });
    const left = box(0, -5, 10, 10, { type: 'yes', h: 20, minH: undefined });
    const right = box(30, -5, 40, 10, { type: 'yes', h: 20, minH: undefined });
    const { pillars } = placeStructures([], [bridge, left, right]);
    for (const p of pillars) expect(p.p[0] > 10 + SUPPORTS.leans && p.p[0] < 30 - SUPPORTS.leans).toBe(true);
  });

  it('keeps posts out of a road passing under the building', () => {
    const street = road([[10, -20], [10, 30]], { w: 7 });
    const { pillars } = placeStructures([street], [box(0, 0, 20, 10)]);
    expect(pillars.length).toBeGreaterThan(0);
    expect(inLanes(pillars, street)).toBe(false);
  });

  it('leaves buildings on the ground and low canopies alone', () => {
    expect(placeStructures([], [box(0, 0, 20, 10, { minH: undefined }), box(30, 0, 50, 10, { minH: 2 })]).pillars).toHaveLength(0);
  });
});
