import { describe, expect, it } from 'vitest';
import { hexToRgb, srgbToLinear } from './meshBuilder';
import { LEAF_REFERENCE, TREE_MODELS, treeMesh, treeTint } from './treeShapes';

const stats = (model: (typeof TREE_MODELS)[number]) => {
  const m = treeMesh(model);
  const ys = m.position.filter((_, i) => i % 3 === 1);
  const xs = m.position.filter((_, i) => i % 3 === 0);
  const zs = m.position.filter((_, i) => i % 3 === 2);
  return {
    mesh: m,
    tris: m.position.length / 9,
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    width: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)),
  };
};

describe('treeMesh', () => {
  it('keeps every model small', () => {
    expect(Object.fromEntries(TREE_MODELS.map((m) => [m, stats(m).tris]))).toEqual({ treeRound: 70, treeWide: 82, treeTall: 50, palm: 68 });
  });
  it('stands on the ground at real tree sizes', () => {
    for (const m of TREE_MODELS) {
      const s = stats(m);
      expect(s.minY).toBe(0);
      expect(s.maxY).toBeGreaterThan(5);
      expect(s.maxY).toBeLessThan(10.5);
      expect(s.width).toBeGreaterThan(3);
      expect(s.width).toBeLessThan(10);
    }
    expect(stats('treeWide').width).toBeGreaterThan(stats('treeTall').width * 1.5); // the umbrella tree is wide
    expect(stats('palm').maxY).toBeGreaterThan(stats('treeRound').maxY); // palms stand tallest
  });
  it('has unit normals, and closed shapes facing outward', () => {
    for (const m of TREE_MODELS) {
      const { position, normal } = treeMesh(m);
      for (let i = 0; i < normal.length; i += 3) expect(Math.hypot(normal[i], normal[i + 1], normal[i + 2])).toBeCloseTo(1, 4);
      expect(position.every(Number.isFinite)).toBe(true);
    }
    // Crown faces on the top of a round tree point up, on its underside down.
    const { position, normal } = treeMesh('treeRound');
    let up = 0;
    let down = 0;
    for (let i = 0; i < position.length; i += 9) {
      const y = (position[i + 1] + position[i + 4] + position[i + 7]) / 3;
      if (y > 6) up += normal[i + 1] > 0 ? 1 : 0;
      if (y > 6) down += normal[i + 1] < 0 ? 1 : 0;
    }
    expect(up).toBeGreaterThan(down * 3);
  });
  it('is the same every build', () => {
    expect(treeMesh('palm')).toEqual(treeMesh('palm'));
  });
  it('shades leaves darker underneath', () => {
    const { position, color } = treeMesh('treeTall');
    const green = (i: number) => color[i + 1];
    const crown: { y: number; g: number }[] = [];
    for (let i = 0; i < position.length; i += 9) {
      if (color[i + 1] > color[i]) crown.push({ y: (position[i + 1] + position[i + 4] + position[i + 7]) / 3, g: green(i) });
    }
    const low = crown.filter((c) => c.y < 4.2);
    const high = crown.filter((c) => c.y > 5.5 && c.y < 6.3);
    const avg = (l: typeof crown) => l.reduce((n, c) => n + c.g, 0) / l.length;
    expect(avg(low)).toBeLessThan(avg(high));
  });
});

describe('treeTint', () => {
  it('turns the reference leaf color into the wanted one', () => {
    const ref = srgbToLinear(hexToRgb(LEAF_REFERENCE.treeRound));
    const want = srgbToLinear(hexToRgb('#4f7d36'));
    const tint = treeTint('treeRound', '#4f7d36');
    for (let c = 0; c < 3; c++) expect(ref[c] * tint[c]).toBeCloseTo(want[c], 6);
  });
  it('is neutral for the reference itself', () => {
    expect(treeTint('palm', LEAF_REFERENCE.palm)).toEqual([1, 1, 1]);
  });
});
