import { describe, expect, it } from 'vitest';
import type { Building, Road } from '../map/types';
import { buildCollision as build, COLLISION, propFootprint, type CollisionInput } from './collision';
import type { Prop } from './props';

const square = (x: number, y: number, s: number): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];
const building = (id: string, extra: Partial<Building> = {}): Building => ({ id, type: 'yes', h: 12, hSrc: 'estimate', rings: [square(0, 0, 10)], ...extra });
const empty: CollisionInput = { buildings: [], roads: [] };
const SURFACE = { path: 0.12, service: 0.16, minor: 0.2, major: 0.24 };
/** Both meshes merged, for tests that don't care which one a triangle is in. */
const buildCollision = (map: CollisionInput) => {
  const w = build(map, { surfaceY: SURFACE });
  const vertices = new Float32Array([...w.walls.vertices, ...w.structures.vertices]);
  return { ...w, vertices };
};

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

  it("makes the pipeline's pillars and posts solid, from the ground to their tops", () => {
    const w = build({ ...empty, pillars: [{ p: [0, 0], top: 5.8, size: 1.8, rot: 0.3, cap: [0, 4] }, { p: [20, 0], top: 3.6, size: 0.35, rot: 0 }] }, { surfaceY: SURFACE });
    expect(w.counts.posts).toBe(2);
    expect(w.structures.indices.length / 3).toBe(16); // four sides each; cap beams are overhead and left out
    const ys = Array.from(w.structures.vertices).filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(5.8);
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

describe('camera walls vs structures', () => {
  it('puts buildings, walls and the edge where the camera avoids them, posts where it does not', () => {
    const w = build(
      { ...empty, buildings: [building('a')], barriers: [{ id: 'w', kind: 'wall', h: 2, points: [[0, 0], [5, 0]] }], playable: square(-50, -50, 100), trees: [{ p: [20, 20], shape: 'broad', s: 1 }] },
      { surfaceY: SURFACE },
    );
    expect(w.walls.indices.length / 3).toBe(8 + 2 + 8);
    expect(w.structures.indices.length / 3).toBe(12); // the trunk
  });
});

describe('flyover decks', () => {
  const flyover = (z: number[], extra: Partial<Road> = {}): Road => ({
    id: 'f',
    highway: 'primary',
    cls: 'major',
    w: 8,
    points: z.map((_, i): [number, number] => [i * 50, 0]),
    z,
    ...extra,
  });
  const ys = (v: Float32Array) => Array.from(v).filter((_, i) => i % 3 === 1);

  it('makes a drivable surface at the drawn road height', () => {
    const w = build({ ...empty, roads: [flyover([7, 7])] }, { surfaceY: SURFACE });
    expect(w.counts.decks).toBe(1);
    expect(Math.max(...ys(w.structures.vertices))).toBeCloseTo(7 + 0.24 + 1); // barrier on top of the deck surface
    expect(ys(w.structures.vertices).some((y) => Math.abs(y - 7.24) < 1e-5)).toBe(true);
  });

  it('closes the sides of a low ramp down to the ground, but leaves room under a high deck', () => {
    const low = build({ ...empty, roads: [flyover([0.5, 2])] }, { surfaceY: SURFACE });
    expect(Math.min(...ys(low.structures.vertices))).toBeLessThanOrEqual(0); // the sides reach the ground (joint rims may dip under it)
    const high = build({ ...empty, roads: [flyover([8, 8], { points: [[0, 0], [10, 0]] })] }, { surfaceY: SURFACE }); // short: no pillar
    expect(Math.min(...ys(high.structures.vertices))).toBeCloseTo(8 - 1.2); // only the deck edge, under it is open
  });

  it('leaves a ramp alone where it is still on the ground', () => {
    expect(build({ ...empty, roads: [flyover([0, 0.1])] }, { surfaceY: SURFACE }).structures.indices.length).toBe(0);
  });

  it("doesn't make footbridges drivable, only their sides", () => {
    const w = build({ ...empty, roads: [flyover([6, 6], { cls: 'path', highway: 'footway', w: 3, points: [[0, 0], [6, 0]] })] }, { surfaceY: SURFACE }); // short: no pillar
    expect(w.counts).toMatchObject({ decks: 0, footbridges: 1 });
    expect(Math.min(...ys(w.structures.vertices))).toBeGreaterThan(5); // overhead only
    expect(w.structures.indices.length / 3).toBe(4); // two side quads, no walking surface
  });

  it('adds raised junctions as drivable surfaces', () => {
    const w = build({ ...empty, junctions: [{ id: 'j', ring: square(0, 0, 10), z: 7, cls: 'major' }, { id: 'g', ring: square(20, 0, 10), z: 0, cls: 'major' }] }, { surfaceY: SURFACE });
    expect(w.structures.indices.length / 3).toBe(2); // only the raised one
    expect(ys(w.structures.vertices)[0]).toBeCloseTo(7.24);
  });

  it('skips scenery flyovers outside the playable area', () => {
    expect(build({ ...empty, roads: [flyover([7, 7], { scenery: true })] }, { surfaceY: SURFACE }).counts.decks).toBe(0);
  });
});

describe('deck joints', () => {
  it('stay under the road where a ramp meets the deck, so the top of a ramp has no ledge', () => {
    // Ramp up 7 m over 70 m, then flat: check the joint at the top against the ramp surface.
    const w = build({ ...empty, roads: [{ id: 'r', highway: 'primary', cls: 'major', w: 9, points: [[0, 0], [0, -70], [0, -200]], z: [0, 7, 7] }] }, { surfaceY: SURFACE });
    const v = w.structures.vertices;
    for (let i = 0; i < v.length; i += 3) {
      const [x, y, z] = [v[i], v[i + 1], v[i + 2]];
      if (Math.abs(x) > 4.4 || z > 70 || z < 60) continue; // on the ramp, just before the top
      expect(y).toBeLessThanOrEqual(0.24 + (7 * z) / 70 + 1e-4);
    }
  });
});
