import { describe, expect, it } from 'vitest';
import type { MapData, Road } from '../map/types';
import { inView, mapViewData, streetNameLookup } from './mapView';

const road = (id: string, extra: Partial<Road>): Road => ({ id, highway: 'residential', cls: 'minor', w: 8, points: [[0, 0], [300, 0]], ...extra });
const map = (roads: Road[]): Pick<MapData, 'roads' | 'buildings' | 'playable' | 'bounds'> => ({
  roads,
  buildings: [{ id: 'b', type: 'yes', h: 10, hSrc: 'estimate', rings: [[[10, 10], [20, 10], [20, 20], [10, 20]]] }],
  playable: [[-50, -50], [350, -50], [350, 350], [-50, 350]],
  bounds: { minX: -50, minY: -50, maxX: 350, maxY: 350 },
});

describe('mapViewData', () => {
  const data = mapViewData(
    map([
      road('a', { name: '5th Avenue', cls: 'major', highway: 'secondary', w: 12 }),
      road('b', { name: 'Lane', points: [[0, 200], [100, 200]] }),
      road('c', { cls: 'path', highway: 'footway', name: 'Walk' }),
    ]),
  );

  it('keeps drivable roads, widest kinds last, and leaves paths out', () => {
    expect(data.roads.map((r) => r.kind)).toEqual(['minor', 'major']);
  });

  it('finds what a view box needs from the grid', () => {
    const near = inView(data, 0, 150, 120, 250);
    expect(near.roads.map((i) => data.roads[i].points[0][1])).toContain(200);
    expect(near.buildings).toHaveLength(0);
    expect(inView(data, 0, 0, 30, 30).buildings).toHaveLength(1);
  });

  it('labels each named street once, major ones first, at its middle and never upside down', () => {
    expect(data.labels.map((l) => l.name)).toEqual(['5th Avenue', 'Lane']);
    expect(data.labels[0].p).toEqual([150, 0]);
    const flipped = mapViewData(map([road('x', { name: 'Back', points: [[300, 0], [0, 0]] })]));
    expect(Math.abs(flipped.labels[0].angle)).toBeLessThanOrEqual(Math.PI / 2);
  });
});

describe('streetNameLookup', () => {
  const lookup = streetNameLookup(
    map([
      road('a', { name: '5th Avenue', w: 12 }),
      road('deck', { name: 'Kalayaan Overpass', points: [[0, 2], [300, 2]], z: [7, 7] }),
      road('c', { name: 'Hidden Walk', cls: 'path', highway: 'footway', points: [[0, 100], [300, 100]] }),
    ]),
  );

  it('names the street a point is on, and nothing between streets', () => {
    expect(lookup([100, -3])).toBe('5th Avenue');
    expect(lookup([100, 50])).toBeUndefined();
    expect(lookup([100, 100])).toBeUndefined(); // footpaths don't count
  });

  it('prefers the flyover when the car is up on it', () => {
    expect(lookup([100, 2], true)).toBe('Kalayaan Overpass');
    expect(lookup([100, 2], false)).toBe('5th Avenue');
  });

  it('names the street the car is driving along at a junction, not the cross street', () => {
    const junction = streetNameLookup(map([road('a', { name: '5th Avenue', w: 12 }), road('b', { name: '26th Street', w: 12, points: [[100, -100], [100, 100]] })]));
    expect(junction([100, 0], false, 0)).toBe('5th Avenue');
    expect(junction([100, 0], false, Math.PI)).toBe('5th Avenue');
    expect(junction([100, 0], false, Math.PI / 2)).toBe('26th Street');
    // Away from the junction, the street you're on, whichever way you face.
    expect(junction([50, 0], false, Math.PI / 2)).toBe('5th Avenue');
  });
});
