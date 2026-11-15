import { describe, expect, it } from 'vitest';
import { KENNEY_BARRIER, KENNEY_CONE } from './kenneyShapes';
import { triangleNormal, type Vec3 } from './meshBuilder';
import { barricadeShape, drumShape, signShape, type ShapeArrays } from './roadblockShapes';

const tris = (s: ShapeArrays) =>
  Array.from({ length: s.position.length / 9 }, (_, i) => ({
    v: [0, 1, 2].map((k) => Array.from(s.position.slice((i * 3 + k) * 3, (i * 3 + k) * 3 + 3)) as Vec3),
    n: Array.from(s.normal.slice(i * 9, i * 9 + 3)),
  }));
const bounds = (s: ShapeArrays) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  s.position.forEach((v, i) => {
    lo[i % 3] = Math.min(lo[i % 3], v);
    hi[i % 3] = Math.max(hi[i % 3], v);
  });
  return { lo, hi };
};

describe('roadblock shapes', () => {
  const shapes = { drum: drumShape(), barricade: barricadeShape(), sign: signShape(), cone: KENNEY_CONE, barrier: KENNEY_BARRIER };

  it('stand on the ground, centered, at about their real size', () => {
    const size = (s: ShapeArrays) => {
      const { lo, hi } = bounds(s);
      return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    };
    for (const s of Object.values(shapes)) expect(bounds(s).lo[1]).toBeCloseTo(0, 3);
    expect(size(shapes.cone)[1]).toBeCloseTo(0.7, 2);
    expect(size(shapes.barrier)).toEqual([expect.closeTo(2, 2), expect.closeTo(0.8, 2), expect.closeTo(0.6, 2)]);
    expect(size(shapes.drum)[1]).toBeCloseTo(0.95, 2);
    expect(size(shapes.barricade)[0]).toBeCloseTo(2, 2);
    expect(size(shapes.sign)[1]).toBeCloseTo(1.9, 2);
  });

  it('have every face wound to match its normal (they are drawn one-sided)', () => {
    for (const [name, s] of Object.entries(shapes)) {
      for (const t of tris(s)) {
        const n = triangleNormal(t.v[0], t.v[1], t.v[2]);
        if (Math.hypot(...n) < 0.5) continue; // degenerate in the source model
        expect(n[0] * t.n[0] + n[1] * t.n[1] + n[2] * t.n[2], name).toBeGreaterThan(0.9);
      }
    }
  });

  it('face outward: drum sides away from its axis, the barricade boards to the front and back', () => {
    for (const t of tris(shapes.drum)) {
      const c = [0, 1, 2].map((k) => (t.v[0][k] + t.v[1][k] + t.v[2][k]) / 3);
      if (Math.abs(t.n[1]) < 0.5) expect(c[0] * t.n[0] + c[2] * t.n[2]).toBeGreaterThan(0);
      else expect(t.n[1]).toBeGreaterThan(0);
    }
    for (const t of tris(shapes.barricade)) {
      const z = (t.v[0][2] + t.v[1][2] + t.v[2][2]) / 3;
      if (Math.abs(Math.abs(z) - 0.03) < 0.001 && Math.abs(t.n[2]) > 0.9) expect(Math.sign(t.n[2])).toBe(Math.sign(z)); // the boards' faces
    }
  });

  it('gives the sign texture coordinates, the full texture on its face', () => {
    const s = shapes.sign;
    expect(s.uv?.length).toBe((s.position.length / 3) * 2);
    expect(Math.max(...Array.from(s.uv!))).toBe(1);
  });
});
