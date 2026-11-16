import { describe, expect, it } from 'vitest';
import type { Fixture, Road } from '../src/map/types';
import { fixturesInLanes, FIXTURE_LANES, moveOutOfLanes } from './fixtureLanes';

const road = (extra: Partial<Road> = {}): Road => ({ id: 'r', highway: 'residential', cls: 'minor', w: 8, points: [[0, 0], [100, 0]], ...extra });

describe('fixtures in the lanes', () => {
  // A concrete block on the centerline of an open road, one by the curb, and a row of bollards closing another road.
  const roads = [road(), road({ id: 'closed', points: [[0, 50], [100, 50]] })];
  const fixtures: Fixture[] = [
    { kind: 'block', p: [40, 0], rot: 0 },
    { kind: 'bollard', p: [60, 3.8], rot: 0 },
    ...[-3, -1.5, 0, 1.5, 3].map((y): Fixture => ({ kind: 'bollard', p: [50, 50 + y], rot: 0 })),
  ];

  it('finds the block in the lanes of a road it leaves open, not the closing row or the one at the curb', () => {
    const found = fixturesInLanes(roads, fixtures);
    expect(found.map((f) => f.fixture.p)).toEqual([[40, 0]]);
  });

  it('moves it just past the curb on the right of the road (it was on the centerline), turned as it was', () => {
    const { fixtures: out, moved, dropped } = moveOutOfLanes(roads, fixtures);
    expect([moved, dropped]).toEqual([1, 0]);
    const block = out.find((f) => f.kind === 'block')!;
    // Right of a road drawn toward +x is -y: half the width, the block's half width across (0.3) and the margin.
    expect(block.p[0]).toBeCloseTo(40);
    expect(block.p[1]).toBeCloseTo(-(4 + 0.3 + FIXTURE_LANES.past));
    expect(block.rot).toBe(0);
    expect(fixturesInLanes(roads, out)).toEqual([]);
    // The rest stay where they were.
    expect(out.filter((f) => f.kind === 'bollard')).toEqual(fixtures.filter((f) => f.kind === 'bollard'));
  });

  it('leaves one that closes a road where it is, even reaching into an open road beside', () => {
    const beside = [...roads, road({ id: 'beside', points: [[40, 54], [40, 90]] })];
    expect(fixturesInLanes(beside, fixtures).map((f) => f.fixture.p)).toEqual([[40, 0]]);
    expect(moveOutOfLanes(beside, fixtures).moved).toBe(1);
  });

  it('goes to the other side if its own is blocked, and drops it if both are', () => {
    const right = (p: [number, number]) => p[1] < 0;
    expect(moveOutOfLanes(roads, fixtures, right).fixtures.find((f) => f.kind === 'block')!.p[1]).toBeGreaterThan(4);
    const { fixtures: out, dropped } = moveOutOfLanes(roads, fixtures, () => true);
    expect(dropped).toBe(1);
    expect(out.some((f) => f.kind === 'block')).toBe(false);
  });
});
