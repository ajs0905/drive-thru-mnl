import { describe, expect, it } from 'vitest';
import type { MapData, Point, Road } from '../src/map/types';
import { findHoles, patchHoles } from './paving';

const road = (id: string, points: Point[], w = 10): Road => ({ id, highway: 'residential', cls: 'minor', w, points });

/** Four roads around a square; `inner` meters of ground are left in the middle. */
function ring(inner: number): MapData {
  const s = inner / 2 + 5; // centerline offset so road edges stop `inner / 2` from the middle
  const e = s + 5;
  return {
    version: 5,
    origin: { lat: 0, lon: 0 },
    bounds: { minX: -50, minY: -50, maxX: 50, maxY: 50 },
    roads: [
      road('s', [[-e, -s], [e, -s]]),
      road('n', [[-e, s], [e, s]]),
      road('w', [[-s, -e], [-s, e]]),
      road('e', [[s, -e], [s, e]]),
    ],
    junctions: [{ id: 'j0', ring: [[-s - 5, -s - 5], [-s + 5, -s - 5], [-s + 5, -s + 5], [-s - 5, -s + 5]], z: 0, cls: 'minor' }],
    crossings: [],
    buildings: [],
    areas: [],
    stats: { features: 0, roads: 4, buildings: 0, areas: 0, skipped: {} },
  };
}

describe('findHoles', () => {
  it('finds a small patch of ground surrounded by road', () => {
    const holes = findHoles(ring(2));
    expect(holes).toHaveLength(1);
    expect(holes[0].area).toBeGreaterThan(2);
    expect(holes[0].area).toBeLessThan(6);
    expect(Math.hypot(...holes[0].at)).toBeLessThan(1);
  });

  it('leaves bigger enclosed areas (real islands) alone', () => {
    expect(findHoles(ring(12))).toHaveLength(0);
  });

  it('finds nothing where the roads leave no gap', () => {
    expect(findHoles(ring(0))).toHaveLength(0);
  });
});

describe('patchHoles', () => {
  it('paves a small hole with patch polygons, after which none is left', () => {
    const map = ring(2);
    const { junctions, stats } = patchHoles(map);
    expect(stats.paved).toBe(1);
    const patches = junctions.filter((j) => j.patch);
    expect(patches.length).toBeGreaterThan(0);
    expect(findHoles({ ...map, junctions })).toHaveLength(0);
  });
});
