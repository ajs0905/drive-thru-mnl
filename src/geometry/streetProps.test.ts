import { describe, expect, it } from 'vitest';
import { addBarrier } from './barrier';
import { MeshBuilder } from './meshBuilder';
import { fixtureProps, treeModelProps, treeProps } from './streetProps';

describe('treeProps', () => {
  it('builds a trunk with a crown on top, scaled by the tree size', () => {
    const [trunk, crown] = treeProps({ p: [5, 6], shape: 'broad', s: 1.2 });
    expect(trunk).toMatchObject({ kind: 'trunk', x: 5, y: 6, base: 0 });
    expect(crown.kind).toBe('canopy');
    expect(crown.base).toBeLessThan(trunk.size[1]); // the crown hides the trunk's top
    expect(crown.size[0]).toBeCloseTo(5.2 * 1.2);
  });
  it('gives palms a tall trunk and a flat crown', () => {
    const [trunk, crown] = treeProps({ p: [0, 0], shape: 'palm', s: 1 });
    expect(trunk.kind).toBe('palmTrunk');
    expect(trunk.size[1]).toBeGreaterThan(7);
    expect(crown.size[1]).toBeLessThan(crown.size[0] / 2);
  });
  it('varies with position only', () => {
    expect(treeProps({ p: [1, 2], shape: 'broad', s: 1 })).toEqual(treeProps({ p: [1, 2], shape: 'broad', s: 1 }));
    expect(treeProps({ p: [1, 2], shape: 'broad', s: 1 })[0].tone).not.toBe(treeProps({ p: [2, 1], shape: 'broad', s: 1 })[0].tone);
  });
});

describe('treeModelProps', () => {
  const grid = Array.from({ length: 400 }, (_, i) => ({ p: [(i % 20) * 7.3, Math.floor(i / 20) * 9.1] as [number, number], s: 1 }));

  it('gives every tree one model, scaled by its size, at its position', () => {
    const [prop] = treeModelProps({ p: [5, 6], shape: 'broad', s: 1.2 });
    expect(prop).toMatchObject({ x: 5, y: 6, base: 0 });
    expect(['treeRound', 'treeWide', 'treeTall']).toContain(prop.kind);
    expect(prop.size[1]).toBeCloseTo(1.2);
    expect(prop.size[0]).toBeGreaterThanOrEqual(1.2 * 0.9);
    expect(prop.size[0]).toBeLessThanOrEqual(1.2 * 1.1);
    expect(prop.size[2]).toBe(prop.size[0]);
  });
  it('uses all three broadleaf models, in similar numbers', () => {
    const kinds = grid.map((t) => treeModelProps({ ...t, shape: 'broad' })[0].kind);
    for (const k of ['treeRound', 'treeWide', 'treeTall']) {
      const n = kinds.filter((x) => x === k).length;
      expect(n).toBeGreaterThan(400 / 3 * 0.7);
      expect(n).toBeLessThan(400 / 3 * 1.3);
    }
  });
  it("doesn't tie the model to the leaf color", () => {
    // Colors pick by floor(tone * 5); every color bucket should still see more than one model.
    const props = grid.map((t) => treeModelProps({ ...t, shape: 'broad' })[0]);
    for (let bucket = 0; bucket < 5; bucket++) {
      const models = new Set(props.filter((p) => Math.floor(p.tone * 5) === bucket).map((p) => p.kind));
      expect(models.size).toBeGreaterThan(1);
    }
  });
  it('leans palms a little, never broadleaf trees', () => {
    const palms = grid.map((t) => treeModelProps({ ...t, shape: 'palm' })[0]);
    expect(palms.every((p) => p.kind === 'palm')).toBe(true);
    const leans = palms.map((p) => p.lean ?? 0);
    expect(Math.max(...leans)).toBeLessThanOrEqual(0.12);
    expect(Math.max(...leans)).toBeGreaterThan(0.08);
    expect(grid.every((t) => treeModelProps({ ...t, shape: 'broad' })[0].lean === undefined)).toBe(true);
  });
  it('matches the simple tree in color and turn, so switching tiers keeps each tree the same', () => {
    const t = { p: [12, -40] as [number, number], shape: 'broad' as const, s: 1 };
    expect(treeModelProps(t)[0].tone).toBe(treeProps(t)[0].tone);
    expect(treeModelProps(t)[0].rot).toBe(treeProps(t)[0].rot);
  });
});

describe('fixtureProps', () => {
  it('puts gate pillars on both sides of the opening', () => {
    const [a, b] = fixtureProps({ kind: 'gate', p: [10, 0], rot: Math.PI / 2, span: 8 });
    expect(a.x).toBeCloseTo(10);
    expect(b.x).toBeCloseTo(10);
    expect([a.y, b.y].sort((m, n) => m - n)).toEqual([-4.25, 4.25].map((v) => expect.closeTo(v, 5)));
  });
  it('gives a boom a post at the side and an arm across the lane', () => {
    const [post, arm] = fixtureProps({ kind: 'boom', p: [0, 0], rot: 0, span: 4 });
    expect(post.x).toBeCloseTo(-2.3);
    expect(arm.size[0]).toBeCloseTo(4.3);
    expect(arm.rot).toBe(0);
  });
});

describe('addBarrier', () => {
  it('extrudes a strip around the line: walls all round plus a top', () => {
    const mb = new MeshBuilder();
    const tris = addBarrier(mb, [[0, 0], [10, 0], [10, 10]], 0.3, 2, [1, 1, 1]);
    // 6 outline edges x 2 wall triangles, plus 4 for the top.
    expect(tris).toBe(6 * 2 + 4);
    const ys = mb.build().position.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBe(2);
    expect(Math.min(...ys)).toBe(0);
  });
  it('skips degenerate lines', () => {
    expect(addBarrier(new MeshBuilder(), [[0, 0], [0, 0]], 0.3, 2, [1, 1, 1])).toBe(0);
  });
});
