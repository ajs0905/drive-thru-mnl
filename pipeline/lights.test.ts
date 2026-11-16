import { describe, expect, it } from 'vitest';
import { distanceToSegment } from '../src/geometry/polygon';
import type { Crossing, Junction, MapData, Point, Road } from '../src/map/types';
import { LIGHTS, placeLights } from './lights';

const map = (roads: Road[], extra: Partial<MapData> = {}): MapData => ({
  version: 7,
  origin: { lat: 14.55, lon: 121.05 },
  bounds: { minX: -500, minY: -500, maxX: 500, maxY: 500 },
  roads,
  junctions: [],
  crossings: [],
  buildings: [],
  areas: [],
  stats: { features: 0, roads: 0, buildings: 0, areas: 0, skipped: {} },
  ...extra,
});
const road = (id: string, points: Point[], extra: Partial<Road> = {}): Road => ({ id, highway: 'primary', cls: 'major', w: 12, points, ...extra });
const square = (c: Point, h: number): Point[] => [[c[0] - h, c[1] - h], [c[0] + h, c[1] - h], [c[0] + h, c[1] + h], [c[0] - h, c[1] + h]];

/** A crossroads at the origin: four 12 m avenue arms split at the junction, trimmed back 7 m. */
function crossroads(): { roads: Road[]; junctions: Junction[] } {
  const arms: Point[] = [[200, 0], [-200, 0], [0, 200], [0, -200]];
  const roads = arms.map((a, i) => road(`arm${i}`, [a, [0, 0]], { trim: [-1, 7] }));
  return { roads, junctions: [{ id: 'j', ring: square([0, 0], 7), z: 0, cls: 'major' }] };
}

describe('placeLights', () => {
  it('signalizes a junction with a mapped signal: a light on the far right-hand corner for every road arriving, arm over the lanes, heads back at the traffic', () => {
    const { roads, junctions } = crossroads();
    const { dressing, stats } = placeLights(map(roads, { junctions }), [[2, 3]]);
    const signals = dressing.filter((d) => d.k === 'signal');
    expect(stats.junctions).toBe(1);
    expect(signals).toHaveLength(4);
    for (const s of signals) {
      // On a curb: 6 m half width plus the curb offset from one of the arms' centerlines, past the junction.
      const d = Math.min(...roads.map((r) => distanceToSegment(s.p, r.points[0], r.points[1])));
      expect(d).toBeCloseTo(6 + LIGHTS.curb, 1);
      expect(Math.max(Math.abs(s.p[0]), Math.abs(s.p[1]))).toBeGreaterThanOrEqual(7 + LIGHTS.past - 1e-6);
      // Its arm (along rot) reaches toward the road's centerline: the pole's position plus the arm direction gets closer to the middle line.
      const reach: Point = [s.p[0] + Math.cos(s.rot) * 3, s.p[1] + Math.sin(s.rot) * 3];
      expect(Math.min(...roads.map((r) => distanceToSegment(reach, r.points[0], r.points[1])))).toBeLessThan(d);
      // Far side: the junction lies in front of the heads (they face the model's -z, (-sin, cos) of rot).
      expect(-Math.sin(s.rot) * -s.p[0] + Math.cos(s.rot) * -s.p[1]).toBeGreaterThan(0);
    }
    // The light for traffic arriving from the east (moving west, heads facing back east) stands across the junction on the west arm, on its right: the north curb.
    const fromEast = signals.find((s) => -Math.sin(s.rot) > 0.99)!;
    expect(fromEast.p[0]).toBeLessThan(-7);
    expect(fromEast.p[1]).toBeGreaterThan(0);
  });

  it('carries a far-side light on past a short piece of road just past the junction', () => {
    const { roads, junctions } = crossroads();
    // The east arm split 9 m out (a node for a crossing, say): the piece by the junction is too short for a pole.
    const split = [...roads.slice(1), road('east-far', [[200, 0], [9, 0]]), road('east-near', [[9, 0], [0, 0]], { trim: [-1, 7] })];
    const { dressing } = placeLights(map(split, { junctions }), [[0, 0]]);
    // Traffic from the west (moving east) still gets a mast arm on the east arm's south curb.
    const fromWest = dressing.find((d) => d.k === 'signal' && d.p[0] > 7 && d.p[1] < 0);
    expect(fromWest).toBeDefined();
    expect(fromWest!.p[0]).toBeGreaterThanOrEqual(7 + LIGHTS.past - 1e-6);
  });

  it('treats a divided avenue crossing a street as one intersection: the light stands past both carriageways', () => {
    // A two-way street (along y) crossing a divided avenue, westbound at y = 10 and eastbound at y = -10, as two junctions
    // joined by a 20 m link across the median.
    const roads = [
      road('n', [[0, 200], [0, 10]], { trim: [-1, 6] }),
      road('link', [[0, 10], [0, -10]], { trim: [6, 6] }),
      road('s', [[0, -10], [0, -200]], { trim: [6, -1] }),
      road('wb-e', [[200, 10], [0, 10]], { oneway: true, trim: [-1, 6] }),
      road('wb-w', [[0, 10], [-200, 10]], { oneway: true, trim: [6, -1] }),
      road('eb-w', [[-200, -10], [0, -10]], { oneway: true, trim: [-1, 6] }),
      road('eb-e', [[0, -10], [200, -10]], { oneway: true, trim: [6, -1] }),
    ];
    const junctions: Junction[] = [
      { id: 'jn', ring: square([0, 10], 6), z: 0, cls: 'major' },
      { id: 'js', ring: square([0, -10], 6), z: 0, cls: 'major' },
    ];
    const { dressing } = placeLights(map(roads, { junctions }), [[0, 10]]);
    // Northbound traffic from the south (heads facing back south) looks across both carriageways: its light is north of y = 16.
    const fromSouth = dressing.find((d) => (d.k === 'signal' || d.k === 'signalpole') && Math.cos(d.rot) < -0.99)!;
    expect(fromSouth.p[1]).toBeGreaterThan(16);
    expect(fromSouth.p[0]).toBeGreaterThan(0);
    // Nothing on the median link itself.
    expect(dressing.filter((d) => Math.abs(d.p[1]) < 4)).toHaveLength(0);
  });

  it('puts the light for the stem of a T on a post on the far curb across the junction', () => {
    const { roads, junctions } = crossroads();
    // No north arm: traffic coming up from the south has no road straight ahead.
    const t = roads.filter((r) => r.points[0][1] !== 200);
    const { dressing } = placeLights(map(t, { junctions }), [[0, 0]]);
    const fromSouth = dressing.find((d) => Math.cos(d.rot) < -0.99 && (d.k === 'signal' || d.k === 'signalpole'))!;
    expect(fromSouth.k).toBe('signalpole');
    // In line with the stem's right-hand curb, beyond the far curb of the cross road.
    expect(fromSouth.p[0]).toBeCloseTo(6 + LIGHTS.curb, 1);
    expect(fromSouth.p[1]).toBeGreaterThan(7);
    expect(fromSouth.p[1]).toBeLessThan(7 + LIGHTS.across);
  });

  it('gives one-way roads a light only where they flow in, and narrow streets a pole instead of an arm', () => {
    const { junctions } = crossroads();
    const roads = [road('in', [[200, 0], [0, 0]], { oneway: true, trim: [-1, 7] }), road('out', [[0, 0], [-200, 0]], { oneway: true, trim: [7, -1] }), road('side', [[0, 200], [0, 0]], { cls: 'minor', w: 7, trim: [-1, 7] })];
    const { dressing } = placeLights(map(roads, { junctions }), [[0, 0]]);
    expect(dressing.filter((d) => d.k === 'signal')).toHaveLength(1);
    expect(dressing.filter((d) => d.k === 'signalpole')).toHaveLength(1);
  });

  it('puts a light per direction just past a signal away from any junction', () => {
    const { dressing } = placeLights(map([road('r', [[-200, 0], [200, 0]])]), [[50, 1]]);
    const signals = dressing.filter((d) => d.k === 'signal');
    expect(signals).toHaveLength(2);
    // Eastbound traffic (heads facing back west) has its light east of the node on the south curb; westbound the other way round.
    for (const s of signals) {
      const east = -Math.sin(s.rot) < 0;
      expect(east ? s.p[0] > 50 && s.p[1] < 0 : s.p[0] < 50 && s.p[1] > 0).toBe(true);
    }
  });

  it('lines avenues with street lights on both curbs, staggered, arms over the road', () => {
    const { dressing, stats } = placeLights(map([road('ave', [[-300, 0], [300, 0]])]), []);
    const lights = dressing.filter((d) => d.k === 'streetlight');
    expect(stats.streetlights).toBe(lights.length);
    expect(lights.length).toBeGreaterThan(30);
    expect(new Set(lights.map((l) => Math.sign(l.p[1])))).toEqual(new Set([-1, 1]));
    for (const l of lights) {
      expect(Math.abs(l.p[1])).toBeCloseTo(6 + LIGHTS.curb, 1);
      expect(Math.sin(l.rot) * Math.sign(l.p[1])).toBeLessThan(-0.99);
    }
    const north = lights.filter((l) => l.p[1] > 0).map((l) => l.p[0]).sort((a, b) => a - b);
    expect(north[1] - north[0]).toBeCloseTo(LIGHTS.streetlight.major, 0);
  });

  it('keeps one-way carriageways to their outer curb and leaves narrow streets, paths and flyovers dark', () => {
    const oneway = placeLights(map([road('half', [[-300, 0], [300, 0]], { oneway: true })]), []).dressing;
    expect(oneway.length).toBeGreaterThan(0);
    expect(oneway.every((l) => l.p[1] < 0)).toBe(true);
    const none = [road('n', [[-300, 0], [300, 0]], { cls: 'minor', w: 5 }), road('p', [[-300, 20], [300, 20]], { cls: 'path', w: 3 }), road('f', [[-300, 40], [300, 40]], { z: [7, 7] })];
    expect(placeLights(map(none), []).dressing).toHaveLength(0);
  });

  it('puts a far-side pole past the zebra crossing on the far side of the junction', () => {
    const { roads, junctions } = crossroads();
    // A crossing on the east arm, 12 m out from the junction's middle, 4 m wide.
    const zebra: Crossing = { c: [12, 0], dir: [1, 0], half: 6, w: 4, z: 0, cls: 'major' };
    const { dressing } = placeLights(map(roads, { junctions, crossings: [zebra] }), [[0, 0]]);
    // Traffic from the west (moving east) looks across at the east arm's south curb.
    const fromWest = dressing.find((d) => d.k === 'signal' && d.p[0] > 6 && d.p[1] < 0)!;
    expect(fromWest.p[0]).toBeGreaterThanOrEqual(12 + 2 + LIGHTS.pastCrossing - 1e-6);
  });

  it('keeps one traffic light per corner, and none for a signal node just past a signalized junction', () => {
    const { roads, junctions } = crossroads();
    const { dressing } = placeLights(map(roads, { junctions }), [[0, 0], [25, 0]]);
    const signals = dressing.filter((d) => d.k === 'signal');
    expect(signals).toHaveLength(4);
    for (let i = 0; i < signals.length; i++) for (let j = i + 1; j < signals.length; j++) expect(Math.hypot(signals[i].p[0] - signals[j].p[0], signals[i].p[1] - signals[j].p[1])).toBeGreaterThan(LIGHTS.cluster);
  });

  it('keeps street lights clear of what is drawn (a kiosk awning), nudging along the curb, and out from under flyovers', () => {
    const ave = road('ave', [[-300, 0], [300, 0]], { oneway: true });
    const lights = placeLights(map([ave]), []).dressing;
    const first = lights[0];
    // A kiosk whose awning reaches over that light's spot.
    const kiosk = { k: 'kiosk' as const, p: [first.p[0], first.p[1] - 2] as Point, rot: Math.PI };
    const moved = placeLights(map([ave], { dressing: [kiosk] }), []).dressing;
    for (const l of moved.filter((d) => d.k === 'streetlight')) expect(Math.abs(l.p[0] - kiosk.p[0]) > 1.25 + LIGHTS.room || Math.abs(l.p[1] - kiosk.p[1]) > 1.7 + LIGHTS.room).toBe(true);
    // A flyover deck 6 m up along the avenue: no 8 m light under it.
    const deck = road('deck', [[-300, -7], [300, -7]], { z: [6, 6], w: 10 });
    expect(placeLights(map([ave, deck]), []).dressing.filter((d) => d.k === 'streetlight')).toHaveLength(0);
  });

  it('is the same every time', () => {
    const { roads, junctions } = crossroads();
    expect(placeLights(map(roads, { junctions }), [[0, 0]])).toEqual(placeLights(map(roads, { junctions }), [[0, 0]]));
  });
});
