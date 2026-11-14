import { describe, expect, it } from 'vitest';
import type { Point, Road } from '../src/map/types';
import { placeCrossings } from './crossings';

let n = 0;
const road = (points: Point[], extra: Partial<Road> = {}): Road => ({
  id: `r${n++}`, highway: 'residential', cls: 'minor', w: 8, points, ...extra,
});
const crossing = (points: Point[], extra: Partial<Road> = {}) =>
  road(points, { highway: 'footway', cls: 'path', w: 2, crossing: true, ...extra });

describe('placeCrossings', () => {
  it('puts one straight zebra across the road where the crossing way cuts it', () => {
    const street = road([[-50, 0], [50, 0]]);
    // runs from sidewalk to sidewalk and bends at both ends, as mapped ones often do
    const way = crossing([[-6, -9], [3, -6], [3, 6], [8, 9]]);
    const { roads, crossings } = placeCrossings([street, way]);
    expect(roads).toEqual([street]); // the way itself is dropped
    expect(crossings).toEqual([{ c: [3, 0], dir: [1, 0], half: 4, w: 3, z: 0, cls: 'minor' }]);
  });

  it('counts a crossing that shares a node with the road once', () => {
    const street = road([[-50, 0], [0, 0], [50, 0]]);
    const { crossings } = placeCrossings([street, crossing([[0, -6], [0, 0], [0, 6]])]);
    expect(crossings).toHaveLength(1);
  });

  it('gives each carriageway of a divided road its own zebra', () => {
    const north = road([[-50, 6], [50, 6]], { w: 7, oneway: true });
    const south = road([[50, -6], [-50, -6]], { w: 7, oneway: true });
    const { crossings } = placeCrossings([north, south, crossing([[0, -12], [0, 12]])]);
    expect(crossings.map((c) => c.c[1]).sort((a, b) => a - b)).toEqual([-6, 6]);
  });

  it('ignores crossing ways mapped along the road and ones that cross nothing', () => {
    const street = road([[-50, 0], [50, 0]]);
    const along = crossing([[-40, 0.5], [40, -0.5]]);
    const nowhere = crossing([[0, 20], [0, 30]]);
    const { crossings, stats } = placeCrossings([street, along, nowhere]);
    expect(crossings).toHaveLength(0);
    expect(stats.waysWithoutRoad).toBe(2);
  });

  it('does not paint a zebra on a flyover passing over the crossing', () => {
    const flyover = road([[-50, 0], [50, 0]], { cls: 'major', z: [7, 7] });
    const ground = road([[-50, 20], [50, 20]]);
    const { crossings, stats } = placeCrossings([flyover, ground, crossing([[0, -5], [0, 25]])]);
    expect(crossings.map((c) => c.c)).toEqual([[0, 20]]);
    expect(stats.skippedRaised).toBe(1);
  });

  it('moves a zebra that lands inside a junction back to just outside it', () => {
    // road piece cut back 6 m at its start for a junction; crossing mapped 2 m from the node
    const street = road([[0, 0], [50, 0]], { trim: [6, -1] });
    const { crossings, stats } = placeCrossings([street, crossing([[2, -6], [2, 6]])]);
    expect(crossings[0].c).toEqual([7.8, 0]); // 6 + 1.5 + 0.3
    expect(stats.moved).toBe(1);
  });

  it('drops a zebra on a connector that a merged junction covers, or one overlapping another', () => {
    const connector = road([[0, 0], [8, 0]], { trim: [8, 0] });
    const street = road([[0, 20], [50, 20]]);
    const { crossings, stats } = placeCrossings([
      connector,
      street,
      crossing([[4, -5], [4, 5]]),
      crossing([[20, 15], [20, 25]]),
      crossing([[21, 15], [21, 25]]), // 1 m away: overlaps the one before
    ]);
    expect(crossings.map((c) => c.c)).toEqual([[20, 20]]);
    expect(stats.droppedNoRoom).toBe(1);
    expect(stats.droppedOverlap).toBe(1);
  });

  it('skips footpaths and footbridges', () => {
    const footway = road([[-50, 0], [50, 0]], { cls: 'path', w: 2 });
    const street = road([[-50, 20], [50, 20]]);
    const bridge = crossing([[0, 15], [0, 25]], { z: [6, 6] });
    const { crossings } = placeCrossings([footway, street, crossing([[0, -5], [0, 5]]), bridge]);
    expect(crossings).toHaveLength(0);
  });
});
