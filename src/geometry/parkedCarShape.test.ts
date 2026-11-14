import { describe, expect, it } from 'vitest';
import { triangleNormal, type Vec3 } from './meshBuilder';
import { parkedCarShape } from './parkedCarShape';

describe('parkedCarShape', () => {
  const s = parkedCarShape();
  const tri = (i: number) => [0, 1, 2].map((k) => Array.from(s.position.slice((i * 3 + k) * 3, (i * 3 + k) * 3 + 3)) as Vec3);

  it('is a 30-odd triangle box car standing on the ground, unit sized', () => {
    expect(s.position.length / 9).toBe(30);
    const ys = Array.from(s.position).filter((_, i) => i % 3 === 1);
    const xs = Array.from(s.position).filter((_, i) => i % 3 === 0);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1);
  });

  it('has every face wound to face out (it is drawn one-sided)', () => {
    for (let i = 0; i < s.position.length / 9; i++) {
      const n = triangleNormal(...(tri(i) as [Vec3, Vec3, Vec3]));
      const given = Array.from(s.normal.slice(i * 9, i * 9 + 3));
      expect(n[0] * given[0] + n[1] * given[1] + n[2] * given[2]).toBeGreaterThan(0.99);
    }
  });

  it('marks the body and roof as paint, the windows and wheels not', () => {
    const painted = Array.from(s.paint).filter((v) => v === 1).length;
    expect(painted).toBeGreaterThan(0);
    expect(painted).toBeLessThan(s.paint.length);
  });
});
