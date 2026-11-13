import { describe, expect, it } from 'vitest';
import type { Building, Point, Ring, Road } from '../src/map/types';
import { dropBuildingsOnRoads, fitRoadWidths, MIN_WIDTH } from './fitWidths';

const box = (x0: number, y0: number, x1: number, y1: number): Ring => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const house = (id: string, ring: Ring, extra: Partial<Building> = {}): Building => ({
  id, type: 'house', h: 6, hSrc: 'estimate', rings: [ring], ...extra,
});
const street = (points: Point[], w = 7.4, extra: Partial<Road> = {}): Road => ({
  id: 's', highway: 'residential', cls: 'minor', w, points, ...extra,
});

// A street along y = 0 with houses 3 m away on both sides (a 6 m gap between walls).
const houses = [house('n', box(0, 3, 50, 13)), house('s', box(0, -13, 50, -3))];

describe('fitRoadWidths', () => {
  it('narrows a street to fit between houses, leaving a small gap', () => {
    const { roads, stats } = fitRoadWidths([street([[0, 0], [50, 0]])], houses);
    expect(roads[0].w).toBeCloseTo(2 * (3 - 0.3), 1);
    expect(stats.narrowed).toBe(1);
  });

  it('never widens a road', () => {
    const { roads } = fitRoadWidths([street([[0, 0], [50, 0]], 4)], houses);
    expect(roads[0].w).toBe(4);
  });

  it('leaves roads with nothing around them alone', () => {
    const { roads, stats } = fitRoadWidths([street([[0, 0], [50, 0]])], []);
    expect(roads[0].w).toBe(7.4);
    expect(stats.narrowed).toBe(0);
  });

  it('does not go below the minimum width', () => {
    const tight = [house('n', box(0, 1, 50, 10)), house('s', box(0, -10, 50, -1))];
    const { roads } = fitRoadWidths([street([[0, 0], [50, 0]])], tight);
    expect(roads[0].w).toBe(MIN_WIDTH.minor);
  });

  it('ignores the part of a road that runs through a building (passages, mapping errors)', () => {
    const over = house('over', box(20, -5, 30, 5));
    const { roads } = fitRoadWidths([street([[0, 0], [50, 0]])], [over]);
    // Samples inside the building are skipped; the ones outside are ~0 to 5 m from its walls.
    expect(roads[0].w).toBeGreaterThanOrEqual(MIN_WIDTH.minor);
  });

  it('finds a house that juts out partway along the street', () => {
    const jut = house('jut', box(24, 2.5, 26, 10));
    const { roads } = fitRoadWidths([street([[0, 0], [50, 0]])], [jut]);
    expect(roads[0].w).toBeLessThanOrEqual(2 * (2.5 - 0.3) + 0.05);
  });

  it('fits major roads too, but never below 6 m', () => {
    const major: Road = { ...street([[0, 0], [50, 0]]), cls: 'major', highway: 'primary', w: 10 };
    const { roads } = fitRoadWidths([major], houses);
    expect(roads[0].w).toBe(MIN_WIDTH.major);
  });

  it('leaves raised roads and paths alone', () => {
    const raised = street([[0, 0], [50, 0]], 7.4, { z: [7, 7] });
    const path: Road = { ...street([[0, 0], [50, 0]], 2), cls: 'path', highway: 'footway' };
    const { roads } = fitRoadWidths([raised, path], houses);
    expect(roads[0].w).toBe(7.4);
    expect(roads[1].w).toBe(2);
  });

  it('ignores raised canopies', () => {
    const canopy = house('c', box(0, 1, 50, 10), { type: 'roof', minH: 3.6, h: 4.2 });
    const { roads } = fitRoadWidths([street([[0, 0], [50, 0]])], [canopy]);
    expect(roads[0].w).toBe(7.4);
  });
});

describe('dropBuildingsOnRoads', () => {
  const road = street([[0, 0], [100, 0]], 8);

  it('drops a building standing in the middle of a road', () => {
    const onRoad = house('on', box(40, -2, 44, 2));
    const beside = house('beside', box(40, 6, 44, 10));
    const { buildings, dropped } = dropBuildingsOnRoads([onRoad, beside], [road]);
    expect(buildings.map((b) => b.id)).toEqual(['beside']);
    expect(dropped).toBe(1);
  });

  it('keeps buildings over tunnels, under flyovers, and canopies', () => {
    const over = house('over', box(40, -2, 44, 2));
    const canopy = house('canopy', box(40, -2, 44, 2), { minH: 3.6, h: 4.2 });
    const tunnel = { ...road, tunnel: true as const };
    const flyover = { ...road, z: [7, 7] };
    expect(dropBuildingsOnRoads([over], [tunnel]).dropped).toBe(0);
    expect(dropBuildingsOnRoads([over], [flyover]).dropped).toBe(0);
    expect(dropBuildingsOnRoads([canopy], [road]).dropped).toBe(0);
  });
});
