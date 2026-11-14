import { describe, expect, it } from 'vitest';
import type { Point, Road } from '../src/map/types';
import { SMOOTH, smoothRaisedCurves } from './smoothRaised';

const turns = (pts: Point[]) =>
  pts.slice(1, -1).map((b, i) => {
    const [a, c] = [pts[i], pts[i + 2]];
    const t = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
    return Math.abs((Math.atan2(Math.sin(t), Math.cos(t)) * 180) / Math.PI);
  });
// A U-turn loop drawn the way OSM does: a few points, 30 degrees apart.
const loop: Point[] = Array.from({ length: 7 }, (_, i) => [Math.round(20 * Math.sin((i * Math.PI) / 6) * 100) / 100, Math.round(-20 * Math.cos((i * Math.PI) / 6) * 100) / 100]);
const road = (extra: Partial<Road> = {}): Road => ({ id: 'r', highway: 'primary_link', cls: 'major', w: 7, points: loop, z: loop.map((_, i) => i), ...extra });

describe('smoothRaisedCurves', () => {
  it('rounds a faceted flyover curve so no corner turns more than a few degrees', () => {
    expect(Math.max(...turns(loop))).toBeCloseTo(30, 0);
    const { roads, smoothed } = smoothRaisedCurves([road()]);
    expect(smoothed).toBe(1);
    expect(Math.max(...turns(roads[0].points))).toBeLessThanOrEqual(SMOOTH.maxTurn + 1);
  });

  it('keeps every original point (so joints with other roads stay put) and interpolates heights', () => {
    const r = smoothRaisedCurves([road()]).roads[0];
    for (const [i, p] of loop.entries()) {
      const k = r.points.findIndex((q) => q[0] === p[0] && q[1] === p[1]);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(r.z![k]).toBe(i);
    }
    expect(r.z!.every((z, i) => i === 0 || z >= r.z![i - 1])).toBe(true);
  });

  it('leaves footbridges, ground roads and straight decks alone', () => {
    const straight: Point[] = [[0, 0], [50, 0], [100, 0]];
    const { roads, smoothed } = smoothRaisedCurves([
      road({ cls: 'path', highway: 'footway' }),
      road({ z: undefined }),
      road({ points: straight, z: [7, 7, 7] }),
    ]);
    expect(smoothed).toBe(0);
    expect(roads[0].points).toBe(loop);
    expect(roads[2].points).toEqual(straight);
  });
});
