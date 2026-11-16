import { describe, expect, it } from 'vitest';
import type { Ring, Road } from '../map/types';
import { EDGE_FENCE } from './edgeFence';
import type { Building } from '../map/types';
import { barricadeRow, CONCRETE_SIZE, ROADBLOCK, roadblockLayout, roadblockCorners } from './roadblocks';
import { pointInRing } from './polygon';

const square: Ring = [[0, 0], [100, 0], [100, 100], [0, 100]];
// A 10 m road crossing the bottom edge at x = 50.
const road: Road = { id: 'r', highway: 'residential', cls: 'minor', w: 10, points: [[50, -40], [50, 40]] };
const k = ROADBLOCK.scale;

describe('roadblockLayout', () => {
  const props = roadblockLayout(square, [road]);
  const of = (kind: string) => props.filter((p) => p.kind === kind);

  it('closes the road plus a sidewalk either side with concrete barriers on the edge', () => {
    const concrete = of('concrete');
    expect(concrete.length).toBeGreaterThan(0);
    const xs = concrete.map((c) => c.p[0]);
    const reach = Math.max(...xs) - Math.min(...xs) + CONCRETE_SIZE[0];
    expect(reach).toBeGreaterThan(10 + 2 * EDGE_FENCE.roadMargin - 2);
    for (const c of concrete) expect(c.p[1]).toBeCloseTo(ROADBLOCK.concrete.row, 1);
  });

  it('puts the sign, a row of barricades and a row of cones up the road, centered on it, in that order', () => {
    const sign = of('sign');
    expect(sign).toHaveLength(1);
    expect(sign[0].p[0]).toBeCloseTo(50, 1);
    const row = props.filter((p) => p.kind === 'barricade' || p.kind === 'drum');
    expect(of('barricade').length).toBeGreaterThanOrEqual(2);
    const ys = new Set(row.map((p) => p.p[1]));
    expect(ys.size).toBe(1);
    const cones = of('cone');
    expect(cones.length).toBeGreaterThanOrEqual(3);
    const [signY, rowY, coneY] = [sign[0].p[1], [...ys][0], Math.min(...cones.map((c) => c.p[1]))];
    for (const c of cones) {
      expect(c.p[1]).toBeGreaterThanOrEqual(ROADBLOCK.cones.band[0] - 1e-6);
      expect(c.p[1]).toBeLessThanOrEqual(ROADBLOCK.cones.band[1] + 1e-6);
    }
    expect(ROADBLOCK.concrete.row).toBeLessThan(signY);
    expect(signY).toBeLessThan(rowY);
    expect(rowY).toBeLessThan(coneY);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean(cones.map((c) => c.p[0])) - 50)).toBeLessThan(2);
    // The barricade row spans the road and its sidewalks, no farther.
    const ends = row.map((p) => [p.p[0] - (ROADBLOCK.loose[p.kind as 'drum'].width * k) / 2, p.p[0] + (ROADBLOCK.loose[p.kind as 'drum'].width * k) / 2]);
    expect(Math.min(...ends.map((e) => e[0]))).toBeGreaterThanOrEqual(45 - ROADBLOCK.sidewalk - 1e-6);
    expect(Math.max(...ends.map((e) => e[1]))).toBeLessThanOrEqual(55 + ROADBLOCK.sidewalk + 1e-6);
    for (const c of cones) expect(Math.abs(c.p[0] - 50)).toBeLessThan(5);
    expect((Math.min(...ends.map((e) => e[0])) + Math.max(...ends.map((e) => e[1]))) / 2).toBeCloseTo(50, 1);
  });

  it('faces everything up the road, into the playable area (cones turned a little each), whichever way the edge is wound', () => {
    for (const p of props) expect(Math.sin(p.rot)).toBeGreaterThan(p.kind === 'cone' ? 0.8 : 0.9999);
    const cw = roadblockLayout([...square].reverse(), [road]);
    expect(cw.map((p) => p.kind)).toEqual(props.map((p) => p.kind));
    for (const p of cw) expect(Math.sin(p.rot)).toBeGreaterThan(0.8);
  });

  it('squares the loose rows to a road crossing the edge on a slant, and keeps them inside', () => {
    const slanted: Road = { ...road, id: 's', points: [[30, -30], [70, 30]] };
    const out = roadblockLayout(square, [slanted]);
    const dir = Math.atan2(60, 40);
    for (const p of out.filter((q) => q.kind !== 'concrete')) {
      expect(Math.cos(p.rot - dir)).toBeGreaterThan(p.kind === 'cone' ? 0.8 : 0.9999);
      expect(p.p[1]).toBeGreaterThan(ROADBLOCK.minRoom - 0.01);
    }
    for (const p of out.filter((q) => q.kind === 'concrete')) expect(Math.sin(p.rot)).toBeCloseTo(1); // concrete stays along the edge
  });

  it('makes the barricade row symmetric, with drums at the ends', () => {
    for (const w of [3, 6, 9, 12, 15, 20]) {
      const row = barricadeRow(w, 2.5, 0.78, 0.44);
      expect(row, `${w} m`).toEqual([...row].reverse());
      if (row.length > 2 && row.includes('barricade')) expect([row[0], row[row.length - 1]]).toEqual(['drum', 'drum']);
    }
    expect(barricadeRow(2, 2.5, 0.78, 0.44).every((k) => k === 'drum')).toBe(true);
  });

  it('never puts a piece where it would touch a building, and the hoarding stops at one too', () => {
    // A house right beside the road, inside the area, where the sidewalk end of the barricade row would go.
    const house: Building = { id: 'h', type: 'house', h: 6, hSrc: 'estimate', rings: [[[41, 3], [44, 3], [44, 14], [41, 14]]] };
    const out = roadblockLayout(square, [road], [house]);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(props.length);
    for (const p of out) {
      const size: Record<string, [number, number]> = { concrete: [CONCRETE_SIZE[0], CONCRETE_SIZE[1]], barricade: [2.5, 0.875], drum: [0.775, 0.775], cone: [0.525, 0.525], sign: [1.5, 0.875] };
      const foot = roadblockCorners(p.p, p.rot, ...size[p.kind]);
      expect(foot.some((q) => pointInRing(q, house.rings[0]))).toBe(false);
    }
  });

  it('gives the two halves of a divided road one roadblock across both', () => {
    const half = (id: string, x: number): Road => ({ ...road, id, w: 7, oneway: true, points: [[x, -40], [x, 40]] });
    const out = roadblockLayout(square, [half('a', 45), half('b', 55)]);
    expect(out.filter((p) => p.kind === 'sign')).toHaveLength(1);
    const row = out.filter((p) => p.kind === 'barricade' || p.kind === 'drum');
    expect(new Set(row.map((p) => p.p[1])).size).toBe(1);
    const xs = row.map((p) => p.p[0]);
    expect(Math.min(...xs)).toBeLessThan(42);
    expect(Math.max(...xs)).toBeGreaterThan(58);
  });

  it('lays out one roadblock where a road crosses the edge at one of its corners', () => {
    const cornered: Ring = [[0, 0], [50, 0], [100, 0], [100, 100], [0, 100]];
    const out = roadblockLayout(cornered, [road]);
    expect(out.filter((p) => p.kind === 'sign')).toHaveLength(1);
    expect(out.filter((p) => p.kind !== 'concrete').map((p) => p.kind)).toEqual(props.filter((p) => p.kind !== 'concrete').map((p) => p.kind));
  });

  it('closes a fork just inside the edge with one row straight across, and no two loose pieces overlap', () => {
    const left: Road = { ...road, id: 'l', w: 6, points: [[49, -20], [47, 0], [30, 40]] };
    const right: Road = { ...road, id: 'r2', w: 6, points: [[51, -20], [53, 0], [70, 40]] };
    const out = roadblockLayout(square, [left, right]);
    expect(out.filter((p) => p.kind === 'sign')).toHaveLength(1);
    const loose = out.filter((p) => p.kind !== 'concrete');
    for (const p of loose.filter((q) => q.kind !== 'cone')) expect(Math.sin(p.rot)).toBeCloseTo(1);
    const size: Record<string, [number, number]> = { barricade: [2.5, 0.875], drum: [0.775, 0.775], cone: [0.525, 0.525], sign: [1.5, 0.875] };
    const feet = loose.map((p) => roadblockCorners(p.p, p.rot, ...size[p.kind]));
    feet.forEach((a, i) => feet.slice(i + 1).forEach((b) => expect(a.some((q) => pointInRing(q, b)) || b.some((q) => pointInRing(q, a))).toBe(false)));
  });

  it('has only the concrete line where the edge runs along a road', () => {
    const along: Road = { ...road, id: 'along', points: [[10, 2], [90, 2]] };
    const out = roadblockLayout(square, [along]);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((p) => p.kind === 'concrete')).toBe(true);
  });

  it('is the same every time, and has nothing where no road crosses the edge', () => {
    expect(roadblockLayout(square, [road])).toEqual(props);
    expect(roadblockLayout(square, [])).toEqual([]);
  });
});

describe('flyovers and stubs at the edge', () => {
  const surface = { path: 0.12, service: 0.16, minor: 0.2, major: 0.24 };
  it('closes a flyover deck crossing the edge with concrete and a roadblock on the deck, at its height', () => {
    const deck: Road = { id: 'd', highway: 'primary', cls: 'major', w: 10, points: [[50, -40], [50, 60]], z: [7, 7] };
    const props = roadblockLayout(square, [deck], [], surface);
    const onDeck = props.filter((p) => p.y !== undefined);
    expect(onDeck.filter((p) => p.kind === 'concrete').length).toBeGreaterThan(0);
    expect(onDeck.filter((p) => p.kind === 'barricade').length).toBeGreaterThan(0);
    for (const p of onDeck) {
      expect(p.y).toBeCloseTo(7.24);
      // Between the deck's sides.
      expect(Math.abs(p.p[0] - 50)).toBeLessThan(5);
    }
    // Nothing for it on the ground (it passes over the edge's own row).
    expect(props.filter((p) => p.y === undefined)).toHaveLength(0);
  });

  it('closes a short alley at its junction with concrete instead of a roadblock halfway down it', () => {
    // The main street is split at the junction, as the pipeline splits roads.
    const west: Road = { id: 'w', highway: 'residential', cls: 'minor', w: 8, points: [[10, 10], [50, 10]] };
    const east: Road = { id: 'e', highway: 'residential', cls: 'minor', w: 8, points: [[50, 10], [90, 10]] };
    const alley: Road = { id: 'alley', highway: 'service', cls: 'service', w: 4, points: [[50, -20], [50, 10]] };
    const props = roadblockLayout(square, [west, east, alley], [], surface);
    expect(props.filter((p) => p.kind !== 'concrete')).toHaveLength(0);
    // A row across the alley's mouth, just short of the junction.
    const mouth = props.filter((p) => p.kind === 'concrete' && p.p[1] > 5);
    expect(mouth.length).toBeGreaterThan(0);
    for (const m of mouth) expect(Math.abs(m.p[0] - 50)).toBeLessThan(4);
  });

  it('keeps the full roadblock on a road that runs on past the stub length', () => {
    const long: Road = { id: 'long', highway: 'residential', cls: 'minor', w: 8, points: [[50, -20], [50, 60]] };
    expect(roadblockLayout(square, [long], [], surface).some((p) => p.kind === 'sign')).toBe(true);
  });
});
