import { describe, expect, it } from 'vitest';
import { DRESSING, dressingCorners } from './dressing';

describe('dressingCorners', () => {
  it('lays a footprint out along rot, grown by the margin', () => {
    const [l, w] = DRESSING.shed.size;
    const flat = dressingCorners('shed', [10, 20], 0, 0.5);
    expect(Math.max(...flat.map((p) => p[0])) - Math.min(...flat.map((p) => p[0]))).toBeCloseTo(l + 1);
    expect(Math.max(...flat.map((p) => p[1])) - Math.min(...flat.map((p) => p[1]))).toBeCloseTo(w + 1);
    const turned = dressingCorners('shed', [10, 20], Math.PI / 2);
    expect(Math.max(...turned.map((p) => p[1])) - Math.min(...turned.map((p) => p[1]))).toBeCloseTo(l);
  });
});
