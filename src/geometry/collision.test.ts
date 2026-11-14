import { describe, expect, it } from 'vitest';
import type { Building, MapData } from '../map/types';
import { buildCollision, COLLISION, propFootprint } from './collision';
import type { Prop } from './props';

const square = (x: number, y: number, s: number): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];
const building = (id: string, extra: Partial<Building> = {}): Building => ({ id, type: 'yes', h: 12, hSrc: 'estimate', rings: [square(0, 0, 10)], ...extra });
const empty: Pick<MapData, 'buildings' | 'roads'> = { buildings: [], roads: [] };

/** Heights (three.js y) of every vertex. */
const heights = (v: Float32Array) => Array.from(v).filter((_, i) => i % 3 === 1);

describe('buildCollision', () => {
  it('walls in a building from the ground to its roof, one quad per outline edge', () => {
    const m = buildCollision({ ...empty, buildings: [building('a')] });
    expect(m.counts).toMatchObject({ buildings: 1, triangles: 8 });
    expect(Math.min(...heights(m.vertices))).toBe(0);
    expect(Math.max(...heights(m.vertices))).toBe(12);
  });

  it('walls in courtyards too', () => {
    const m = buildCollision({ ...empty, buildings: [building('a', { rings: [square(0, 0, 30), square(10, 10, 10)] })] });
    expect(m.counts.triangles).toBe(16);
  });

  it('skips scenery, and buildings high enough to drive under', () => {
    const m = buildCollision({
      ...empty,
      buildings: [building('scenery', { scenery: true }), building('skybridge', { minH: 6 }), building('canopy-low', { minH: COLLISION.clearance - 1 })],
    });
    expect(m.counts.buildings).toBe(1); // only the low one
  });

  it('uses map coordinates as three.js space (y north becomes -z)', () => {
    const m = buildCollision({ ...empty, buildings: [building('a', { rings: [[[5, 7], [6, 7], [6, 8]]] })] });
    expect(Array.from(m.vertices.slice(0, 3))).toEqual([5, 0, -7]);
  });

  it('stands walls and fences up along their line, without closing them', () => {
    const m = buildCollision({ ...empty, barriers: [{ id: 'w', kind: 'fence', h: 1.8, points: [[0, 0], [10, 0], [10, 10]] }] });
    expect(m.counts).toMatchObject({ barriers: 1, triangles: 4 });
    expect(Math.max(...heights(m.vertices))).toBeCloseTo(1.8);
    expect(buildCollision({ ...empty, barriers: [{ id: 's', kind: 'wall', h: 2, points: [[0, 0], [1, 0]], scenery: true }] }).counts.barriers).toBe(0);
  });

  it('closes the playable area with a tall wall', () => {
    const m = buildCollision({ ...empty, playable: square(-100, -100, 200) });
    expect(m.counts).toMatchObject({ edge: 4, triangles: 8 });
    expect(Math.max(...heights(m.vertices))).toBe(COLLISION.edgeHeight);
  });

  it('adds trunks, bollards, blocks and gate pillars, but not crowns or boom arms', () => {
    const m = buildCollision({
      ...empty,
      trees: [{ p: [0, 0], shape: 'broad', s: 1 }],
      fixtures: [
        { kind: 'bollard', p: [10, 0], rot: 0 },
        { kind: 'block', p: [20, 0], rot: 0 },
        { kind: 'boom', p: [30, 0], rot: 0, span: 6 },
        { kind: 'gate', p: [40, 0], rot: 0, span: 6 },
      ],
    });
    // Trunk + bollard (6 sides each), block (4), boom post (4), two gate pillars (4 each).
    expect(m.counts.posts).toBe(6);
    expect(m.counts.triangles).toBe((6 + 6 + 4 + 4 + 4 + 4) * 2);
    // Nothing reaches up to a crown or a boom arm across the road: the boom post is short.
    const nearBoom = [];
    for (let i = 0; i < m.vertices.length; i += 3) if (Math.abs(m.vertices[i] - 30) < 4) nearBoom.push(m.vertices[i]);
    expect(Math.max(...nearBoom) - Math.min(...nearBoom)).toBeLessThan(1); // just the post, not a 6 m arm
  });

  it('puts pillars under flyovers, none under ground-level roads', () => {
    const flyover = { id: 'f', highway: 'primary', cls: 'major' as const, w: 8, points: [[0, 0], [100, 0]] as [number, number][], z: [7, 7] };
    expect(buildCollision({ ...empty, roads: [flyover] }).counts.posts).toBe(3); // every 30 m from 15 m in
    expect(buildCollision({ ...empty, roads: [{ ...flyover, z: undefined }] }).counts.posts).toBe(0);
    expect(buildCollision({ ...empty, roads: [{ ...flyover, scenery: true }] }).counts.posts).toBe(0);
  });
});

describe('propFootprint', () => {
  const prop = (o: Partial<Prop>): Prop => ({ kind: 'block', x: 10, y: 20, base: 0, size: [4, 1, 2], rot: 0, tone: 0, ...o });

  it('lays a box out along x when not turned', () => {
    const f = propFootprint(prop({}));
    const xs = f.map((p) => p[0]);
    const ys = f.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2);
  });

  it('turns counter-clockwise (seen from above) with rot, as the renderer does', () => {
    const f = propFootprint(prop({ rot: Math.PI / 2 }));
    const xs = f.map((p) => p[0]);
    const ys = f.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4);
  });

  it('makes round posts into hexagons of the right radius', () => {
    const f = propFootprint(prop({ kind: 'bollard', size: [0.4, 1, 0.4] }));
    expect(f).toHaveLength(COLLISION.roundSides);
    for (const [x, y] of f) expect(Math.hypot(x - 10, y - 20)).toBeCloseTo(0.2);
  });
});
