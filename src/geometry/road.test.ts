import { describe, expect, it } from 'vitest';
import type { Point } from '../map/types';
import { MeshBuilder, triangleNormal } from './meshBuilder';
import { addDeckStructure, addDisc, addRoadRibbon, addSidewalk, addZebra, decodeMark, dedupe, MARK, markCode, offsetPolyline, trimPolyline } from './road';

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('offsetPolyline', () => {
  it('offsets a straight road by half the width on each side', () => {
    const { left, right } = offsetPolyline([[0, 0], [10, 0], [20, 0]], 4);
    expect(left).toEqual([[0, 4], [10, 4], [20, 4]]);
    expect(right).toEqual([[0, -4], [10, -4], [20, -4]]);
  });

  it('uses a miter at a right-angle turn (corner at halfWidth x sqrt 2)', () => {
    const { left, right } = offsetPolyline([[0, 0], [10, 0], [10, 10]], 2);
    expect(dist(left[1], [10, 0])).toBeCloseTo(2 * Math.SQRT2, 9);
    expect(left[1][0]).toBeCloseTo(8, 9); // inside of the turn
    expect(left[1][1]).toBeCloseTo(2, 9);
    expect(right[1][0]).toBeCloseTo(12, 9); // outside of the turn
    expect(right[1][1]).toBeCloseTo(-2, 9);
  });

  it('clamps the miter on very sharp turns', () => {
    const { left } = offsetPolyline([[0, 0], [10, 0], [0, 0.5]], 2, 2);
    expect(dist(left[1], [10, 0])).toBeLessThanOrEqual(4 + 1e-9);
  });

  it('survives a road that turns straight back on itself', () => {
    const { left, right } = offsetPolyline([[0, 0], [10, 0], [0, 0]], 2);
    for (const p of [...left, ...right]) {
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
    }
  });

  it('ignores duplicate points instead of producing NaN', () => {
    const { left } = offsetPolyline([[0, 0], [0, 0], [10, 0], [10, 0.01], [20, 0]], 3);
    expect(left).toHaveLength(3);
    for (const p of left) expect(Number.isNaN(p[0])).toBe(false);
  });

  it('returns nothing for unusable input', () => {
    expect(offsetPolyline([[0, 0]], 2).left).toEqual([]);
    expect(offsetPolyline([[0, 0], [0, 0]], 2).left).toEqual([]);
    expect(offsetPolyline([[0, 0], [5, 0]], 0).left).toEqual([]);
  });
});

describe('dedupe', () => {
  it('drops points closer than 5 cm', () => {
    expect(dedupe([[0, 0], [0.01, 0], [1, 0]])).toEqual([[0, 0], [1, 0]]);
  });
});

describe('addRoadRibbon', () => {
  it('adds 2 upward-facing triangles per segment', () => {
    const mb = new MeshBuilder();
    expect(addRoadRibbon(mb, [[0, 0], [10, 0], [10, 10], [20, 15]], 6, 0.1, [0.2, 0.2, 0.2])).toBe(6);
    const { position } = mb.build();
    for (let i = 0; i < position.length; i += 9) {
      const n = triangleNormal(
        [position[i], position[i + 1], position[i + 2]],
        [position[i + 3], position[i + 4], position[i + 5]],
        [position[i + 6], position[i + 7], position[i + 8]],
      );
      expect(n[1]).toBeGreaterThan(0.99);
      expect(position[i + 1]).toBeCloseTo(0.1, 6);
    }
  });
});

const expectFacing = (mb: MeshBuilder) => {
  const { position, normal } = mb.build();
  for (let i = 0; i < position.length; i += 9) {
    const g = triangleNormal(
      [position[i], position[i + 1], position[i + 2]],
      [position[i + 3], position[i + 4], position[i + 5]],
      [position[i + 6], position[i + 7], position[i + 8]],
    );
    expect(g[0] * normal[i] + g[1] * normal[i + 1] + g[2] * normal[i + 2]).toBeGreaterThan(0.99);
  }
};

const style = {
  depth: 1.2,
  barrier: 1,
  pillarEvery: 30,
  pillarSize: 1.8,
  color: [0.7, 0.7, 0.7] as [number, number, number],
  underside: [0.4, 0.4, 0.4] as [number, number, number],
};

describe('addRoadRibbon with heights', () => {
  it('follows the height of each point', () => {
    const mb = new MeshBuilder();
    addRoadRibbon(mb, [[0, 0], [50, 0], [100, 0]], 8, 0.1, [0.2, 0.2, 0.2], { z: [0, 3.5, 7] });
    const ys = Array.from(mb.build().position).filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeCloseTo(0.1, 5);
    expect(Math.max(...ys)).toBeCloseTo(7.1, 5);
  });

  it('keeps heights lined up when duplicate points are dropped', () => {
    const mb = new MeshBuilder();
    addRoadRibbon(mb, [[0, 0], [0, 0], [100, 0]], 8, 0, [0.2, 0.2, 0.2], { z: [0, 0, 7] });
    expect(mb.triangleCount).toBe(2);
    const ys = Array.from(mb.build().position).filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(7, 5);
  });
});

describe('addDisc', () => {
  it('adds an upward-facing fan of the requested size', () => {
    const mb = new MeshBuilder();
    expect(addDisc(mb, [5, 5], 3, 0.2, [0.2, 0.2, 0.2])).toBe(8);
    const { position } = mb.build();
    for (let i = 0; i < position.length; i += 3) {
      const r = Math.hypot(position[i] - 5, position[i + 2] + 5);
      expect(r).toBeLessThanOrEqual(3 + 1e-5);
    }
    expectFacing(mb);
  });

  it('ignores a zero radius', () => {
    expect(addDisc(new MeshBuilder(), [0, 0], 0, 0, [0, 0, 0])).toBe(0);
  });
});

describe('addDeckStructure', () => {
  it('adds nothing for a road on the ground', () => {
    const mb = new MeshBuilder();
    expect(addDeckStructure(mb, [[0, 0], [100, 0]], 8, [0, 0], style)).toBe(0);
  });

  it('builds edges, underside, barriers and pillars for a raised deck, all facing the right way', () => {
    const mb = new MeshBuilder();
    addDeckStructure(mb, [[0, 0], [100, 0]], 8, [7, 7], style);
    // per segment: 2 edges x 2 + underside 2 + 4 barrier faces x 2 = 14; pillars at 15, 45, 75 m: 3 x 4 sides x 2 = 24
    expect(mb.triangleCount).toBe(14 + 24);
    expectFacing(mb);
  });

  it('puts pillars only where the deck is high enough', () => {
    const low = new MeshBuilder();
    addDeckStructure(low, [[0, 0], [100, 0]], 8, [2.5, 2.5], style);
    const high = new MeshBuilder();
    addDeckStructure(high, [[0, 0], [100, 0]], 8, [7, 7], style);
    // A 2.5 m deck still gets barriers, but the space under it is too low for pillars.
    expect(high.triangleCount - low.triangleCount).toBe(24);
  });

  it('never puts structure below the ground', () => {
    const mb = new MeshBuilder();
    addDeckStructure(mb, [[0, 0], [50, 0], [100, 0]], 8, [0.5, 3, 7], style);
    const ys = Array.from(mb.build().position).filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });
});

describe('trimPolyline', () => {
  const line: [number, number][] = [[0, 0], [10, 0], [10, 10]];

  it('cuts both ends by distance and interpolates heights', () => {
    const t = trimPolyline(line, [0, 4, 8], 2, 3)!;
    expect(t.pts).toEqual([[2, 0], [10, 0], [10, 7]]);
    expect(t.zs[0]).toBeCloseTo(0.8);
    expect(t.zs[2]).toBeCloseTo(6.8);
    expect(t.u0).toBe(2);
  });

  it('treats negative trims as no trim', () => {
    expect(trimPolyline(line, [0, 0, 0], -1, -1)!.pts).toEqual(line);
  });

  it('returns null when the trims eat the whole line', () => {
    expect(trimPolyline(line, [0, 0, 0], 12, 9)).toBeNull();
  });
});

describe('road markings data', () => {
  it('packs and unpacks a marking style', () => {
    const code = markCode(MARK.lanes, { lanes: 3, oneway: true, rank: 2 });
    expect(decodeMark(code)).toEqual({ mode: MARK.lanes, oneway: true, rank: 2, lanes: 3 });
    expect(decodeMark(markCode(MARK.zebra))).toEqual({ mode: MARK.zebra, oneway: false, rank: 0, lanes: 1 });
  });

  it('gives ribbon vertices distance along and offset across the road', () => {
    const mb = new MeshBuilder({ aux: true });
    const mark = markCode(MARK.lanes, { lanes: 2, rank: 1 });
    addRoadRibbon(mb, [[0, 0], [10, 0], [20, 0]], 8, 0, [0, 0, 0], { mark, trim: [3, -1] });
    const aux = mb.build().aux!;
    const us = aux.filter((_, i) => i % 4 === 0);
    const vs = aux.filter((_, i) => i % 4 === 1);
    expect(Math.min(...us)).toBeCloseTo(3); // starts where the trim ends, keeping dashes in step
    expect(Math.max(...us)).toBeCloseTo(20);
    expect(new Set(vs)).toEqual(new Set([4, -4]));
    expect(aux.filter((_, i) => i % 4 === 3).every((m) => m === mark)).toBe(true);
  });

  it('draws nothing for a road fully covered by its junctions', () => {
    const mb = new MeshBuilder({ aux: true });
    expect(addRoadRibbon(mb, [[0, 0], [5, 0]], 8, 0, [0, 0, 0], { trim: [3, 3] })).toBe(0);
  });

  it('runs markings on across a disc', () => {
    const mb = new MeshBuilder({ aux: true });
    addDisc(mb, [0, 0], 4, 0, [0, 0, 0], 8, ([x, y]) => [10 + x, y, 4, 1]);
    const aux = mb.build().aux!;
    expect(Math.max(...aux.filter((_, i) => i % 4 === 0))).toBeCloseTo(14);
  });
});

describe('addSidewalk', () => {
  it('puts the band outside the road edge on the asked side, facing up', () => {
    for (const side of ['left', 'right'] as const) {
      const mb = new MeshBuilder({ aux: true });
      expect(addSidewalk(mb, [[0, 0], [10, 0]], 8, 2, side, 0.1, [0.5, 0.5, 0.5])).toBe(2);
      const { position, aux } = mb.build();
      const zs = position.filter((_, i) => i % 3 === 2).map((z) => -z); // back to map y
      if (side === 'left') expect([Math.min(...zs), Math.max(...zs)]).toEqual([4, 6]);
      else expect([Math.min(...zs), Math.max(...zs)]).toEqual([-6, -4]);
      expect(Math.max(...aux!.filter((_, i) => i % 4 === 1))).toBe(2);
      expectFacing(mb);
    }
  });
});

describe('addZebra', () => {
  it('spans the road short of its edges, faces up, and stripes across the road', () => {
    const mb = new MeshBuilder({ aux: true });
    expect(addZebra(mb, [0, 0], [1, 0], 5, 3, 0.28, [1, 1, 1])).toBe(2);
    const { position, aux } = mb.build();
    const xs = position.filter((_, i) => i % 3 === 0);
    const ys = position.filter((_, i) => i % 3 === 2).map((z) => -z);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([-1.5, 1.5]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([-4.5, 4.5]);
    expect(Math.max(...aux!.filter((_, i) => i % 4 === 0))).toBeCloseTo(4.5); // u runs across
    expect(decodeMark(aux![3]).mode).toBe(MARK.zebra);
    expectFacing(mb);
  });

  it('skips roads too narrow for one', () => {
    expect(addZebra(new MeshBuilder({ aux: true }), [0, 0], [1, 0], 0.8, 3, 0, [1, 1, 1])).toBe(0);
  });
});
