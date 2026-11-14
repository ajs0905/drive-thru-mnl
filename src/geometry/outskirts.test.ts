import { describe, expect, it } from 'vitest';
import type { MapData } from '../map/types';
import { outskirts, RIDGES, ridgeHeights, SKYLINES } from './outskirts';
import { distanceToRing, pointInRing } from './polygon';

const playable: [number, number][] = [[-500, -500], [500, -500], [500, 500], [-500, 500]];
const map = {
  version: 5,
  origin: { lat: 14.5509, lon: 121.0503 },
  bounds: { minX: -800, minY: -800, maxX: 800, maxY: 800 },
  playable,
  roads: [],
  buildings: [],
  areas: [],
  junctions: [],
  crossings: [],
  stats: { features: 0, roads: 0, buildings: 0, areas: 0, skipped: {}, clip: { marginMeters: 300 } },
} as unknown as MapData;

describe('outskirts', () => {
  const boxes = outskirts(map, { radius: 4000 });

  it('never puts filler in the playable area or its scenery ring', () => {
    expect(boxes.length).toBeGreaterThan(100);
    for (const b of boxes) {
      const inside = pointInRing([b.x, b.y], playable);
      // the cell center is at least margin + gap away; a box can sit up to 0.31 cells off it
      expect(inside || distanceToRing([b.x, b.y], playable) < 300).toBe(false);
    }
  });

  it('stays within the radius (plus a cell) and is the same on every load', () => {
    for (const b of boxes) expect(Math.hypot(b.x, b.y)).toBeLessThan(4000 + 140);
    expect(outskirts(map, { radius: 4000 })).toEqual(boxes);
  });

  it('puts towers in the real skylines and nowhere else', () => {
    const makati = SKYLINES.find((s) => s.name === 'Makati CBD')!;
    const towers = boxes.filter((b) => b.tower);
    expect(towers.length).toBeGreaterThan(0);
    for (const t of towers) {
      expect(SKYLINES.some((s) => Math.hypot(t.x - s.at[0], t.y - s.at[1]) < s.radius + 100)).toBe(true);
    }
    const nearMakati = towers.filter((t) => Math.hypot(t.x - makati.at[0], t.y - makati.at[1]) < makati.radius);
    expect(Math.max(...nearMakati.map((t) => t.h))).toBeGreaterThan(100);
  });

  it('fills less at lower density', () => {
    expect(outskirts(map, { radius: 4000, density: 0.4 }).length).toBeLessThan(boxes.length * 0.6);
  });
});

describe('ridgeHeights', () => {
  it('tapers to nothing at both ends and stays within the ridge heights', () => {
    for (const r of RIDGES) {
      const line = ridgeHeights(r);
      expect(line[0].h).toBeCloseTo(0);
      expect(line[line.length - 1].h).toBeCloseTo(0, 5);
      for (const p of line) {
        expect(p.h).toBeGreaterThanOrEqual(0);
        expect(p.h).toBeLessThanOrEqual(r.maxH);
      }
      expect(Math.max(...line.map((p) => p.h))).toBeGreaterThan(r.minH);
    }
  });
});
