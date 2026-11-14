import { describe, expect, it } from 'vitest';
import { CHASE, cameraPull, chaseView, clipDistance, damp, speedFov, turnToward } from './chaseCamera';

describe('chaseView', () => {
  it('sits behind and above the car, looking ahead of it', () => {
    const v = chaseView([10, 0, 20], 0, 1, 0); // car facing +z
    expect(v.position[0]).toBeCloseTo(10);
    expect(v.position[2]).toBeCloseTo(20 - CHASE.distance);
    expect(v.position[1]).toBeCloseTo(CHASE.height);
    expect(v.lookAt[2]).toBeCloseTo(20 + CHASE.lookAhead);
    expect(v.lookAt[1]).toBeLessThan(v.position[1]);
  });
  it('follows the direction it is given, normalized', () => {
    const v = chaseView([0, 5, 0], 10, 0, 0); // facing +x, not a unit vector
    expect(v.position[0]).toBeCloseTo(-CHASE.distance);
    expect(v.position[2]).toBeCloseTo(0);
    expect(v.position[1]).toBeCloseTo(5 + CHASE.height);
  });
  it('pulls back with speed, up to a limit', () => {
    const still = chaseView([0, 0, 0], 0, 1, 0).position[2];
    const fast = chaseView([0, 0, 0], 0, 1, 30).position[2];
    expect(fast).toBeLessThan(still);
    expect(chaseView([0, 0, 0], 0, 1, 500).position[2]).toBe(chaseView([0, 0, 0], 0, 1, CHASE.maxSpeed).position[2]);
    expect(chaseView([0, 0, 0], 0, 1, -30).position[2]).toBe(fast); // reversing counts the same
  });
});

describe('damp', () => {
  it('is frame rate independent', () => {
    const once = damp(4, 1 / 30);
    const twice = 1 - (1 - damp(4, 1 / 60)) ** 2;
    expect(twice).toBeCloseTo(once, 10);
    expect(damp(4, 0)).toBe(0);
    expect(damp(4, 100)).toBeCloseTo(1);
  });
});

describe('turnToward', () => {
  it('turns the short way round and returns a unit vector', () => {
    const half = turnToward([1, 0], [0, 1], 0.5);
    expect(Math.hypot(...half)).toBeCloseTo(1);
    expect(Math.atan2(half[1], half[0])).toBeCloseTo(Math.PI / 4);
    // From just above -x to just below it: a small step across the back, not the long way.
    const across = turnToward([Math.cos(3), Math.sin(3)], [Math.cos(-3), Math.sin(-3)], 0.5);
    expect(across[0]).toBeCloseTo(-1, 2);
  });
  it('keeps the old direction when the goal has no ground direction', () => {
    expect(turnToward([0, 1], [0, 0], 0.5)).toEqual([0, 1]);
  });
});

describe('camera reaction to acceleration and speed', () => {
  it('hangs back when speeding up and eases in when braking, by about a meter at most', () => {
    expect(cameraPull(0)).toBe(0);
    expect(cameraPull(4)).toBeGreaterThan(0);
    expect(cameraPull(-4)).toBeLessThan(0);
    expect(cameraPull(100)).toBe(CHASE.maxPullBack);
    expect(cameraPull(-100)).toBe(-CHASE.maxPullIn);
    expect(CHASE.maxPullIn).toBeLessThanOrEqual(1);
  });
  it('moves the camera along the car by the pull', () => {
    const base = chaseView([0, 0, 0], 0, 1, 10);
    const pulled = chaseView([0, 0, 0], 0, 1, 10, 0.8);
    expect(pulled.position[2]).toBeCloseTo(base.position[2] - 0.8);
    expect(pulled.lookAt).toEqual(base.lookAt);
  });
  it('widens the view a few degrees with speed', () => {
    expect(speedFov(0)).toBe(CHASE.fov);
    expect(speedFov(30)).toBeGreaterThan(CHASE.fov);
    expect(speedFov(1000) - CHASE.fov).toBeLessThanOrEqual(7);
    expect(speedFov(-20)).toBe(speedFov(20));
  });
});

describe('clipDistance', () => {
  it('stays at full distance when nothing is in the way', () => {
    expect(clipDistance(7, null, 7, 1 / 60)).toBe(7);
  });
  it('jumps in front of a wall at once, keeping a margin', () => {
    expect(clipDistance(7, 4, 7, 1 / 60)).toBeCloseTo(4 - CHASE.clipMargin);
  });
  it('never comes closer than the minimum, even with a wall right behind the car', () => {
    expect(clipDistance(7, 0.3, 7, 1 / 60)).toBe(CHASE.minDistance);
  });
  it('eases back out once the wall is gone', () => {
    const next = clipDistance(3, null, 7, 1 / 60);
    expect(next).toBeGreaterThan(3);
    expect(next).toBeLessThan(3.3);
    let d = 3;
    for (let i = 0; i < 180; i++) d = clipDistance(d, null, 7, 1 / 60);
    expect(d).toBeCloseTo(7, 1);
  });
});
