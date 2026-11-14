import { describe, expect, it } from 'vitest';
import {
  antiSpin,
  countersteer,
  DRIFT_START_SPEED,
  driftPush,
  driftTurn,
  nextDrifting,
  nextRearGrip,
  rearSideFriction,
  slipAngle,
  toLocal,
} from './drift';
import { SEDAN } from './spec';

const t = SEDAN.tuning;
const yaw = (a: number) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }); // rotation around +y

describe('toLocal', () => {
  it('leaves vectors alone for an unrotated body', () => {
    expect(toLocal({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0, w: 1 })).toEqual({ x: 1, y: 2, z: 3 });
  });
  it('sees world +x as forward for a car turned 90 degrees left', () => {
    // The car faces +z; turned +90 degrees around +y it faces world +x.
    const v = toLocal({ x: 5, y: 0, z: 0 }, yaw(Math.PI / 2));
    expect(v.z).toBeCloseTo(5);
    expect(v.x).toBeCloseTo(0);
  });
});

describe('slipAngle', () => {
  it('is zero when going straight, slow or backward', () => {
    expect(slipAngle(0, 20)).toBe(0);
    expect(slipAngle(2, 1)).toBe(0);
    expect(slipAngle(2, -10)).toBe(0);
  });
  it('is positive when the car moves toward its left', () => {
    expect(slipAngle(10, 10)).toBeCloseTo(Math.PI / 4);
    expect(slipAngle(-10, 10)).toBeCloseTo(-Math.PI / 4);
  });
});

describe('nextDrifting', () => {
  it('starts with the handbrake while steering at speed', () => {
    expect(nextDrifting(false, true, 1, 15, 0)).toBe(true);
    expect(nextDrifting(false, true, 0, 15, 0)).toBe(false); // no steering: just a brake
    expect(nextDrifting(false, true, 1, DRIFT_START_SPEED - 1, 0)).toBe(false); // too slow
    expect(nextDrifting(false, false, 1, 15, 0.5)).toBe(false); // a slide alone doesn't start one
  });
  it('lasts while the handbrake is held or the car is still sideways', () => {
    expect(nextDrifting(true, false, 1, 15, 0.3)).toBe(true);
    expect(nextDrifting(true, true, 0, 15, 0)).toBe(true);
    expect(nextDrifting(true, false, 1, 15, 0.02)).toBe(false); // straightened out
    expect(nextDrifting(true, true, 1, 2, 0.5)).toBe(false); // nearly stopped
  });
});

describe('rear grip', () => {
  it('drops with the handbrake and comes back over about half a second', () => {
    expect(nextRearGrip(1, true, 0, false, 1 / 60, t)).toBe(0);
    let g = 0;
    let steps = 0;
    while (g < 1 && steps < 600) {
      g = nextRearGrip(g, false, 0, true, 1 / 60, t);
      steps++;
    }
    expect(steps / 60).toBeCloseTo(1 / t.gripRecover, 1);
  });
  it('stays loose in a power slide, but is never taken away by it', () => {
    let g = 0;
    for (let i = 0; i < 120; i++) g = nextRearGrip(g, false, 1, true, 1 / 60, t);
    expect(g).toBeCloseTo(t.sustainGrip);
    expect(nextRearGrip(1, false, 1, true, 1 / 60, t)).toBe(1);
  });
  it('gives full sideways stiffness at full grip and little when loose', () => {
    expect(rearSideFriction(1, t)).toBeCloseTo(t.sideFriction);
    expect(rearSideFriction(0, t)).toBeCloseTo(t.driftSideFriction);
    // Comes back slowly at first: half grip is well under halfway.
    expect(rearSideFriction(0.5, t)).toBeLessThan((t.sideFriction + t.driftSideFriction) / 2);
  });
});

describe('drift helpers', () => {
  it('turns the car with the steering only while drifting', () => {
    expect(driftTurn(1, true, t)).toBe(t.driftYaw);
    expect(driftTurn(-0.5, true, t)).toBe(-t.driftYaw / 2);
    expect(driftTurn(1, false, t)).toBe(0);
  });
  it('steers into a slide, within the steering lock', () => {
    expect(countersteer(0.4, t)).toBeCloseTo(0.4 * t.countersteer);
    expect(countersteer(-0.4, t)).toBeLessThan(0);
    expect(countersteer(10, t)).toBe(t.maxSteer);
  });
  it('damps a spin only past the limit and only when it is getting worse', () => {
    expect(antiSpin(t.maxDrift - 0.1, -2, t)).toBe(0); // within the limit
    expect(antiSpin(t.maxDrift + 0.3, 2, t)).toBe(0); // already turning back
    const damp = antiSpin(t.maxDrift + 0.3, -2, t); // past the limit, rotating further
    expect(damp).toBeGreaterThan(0);
    expect(damp).toBeCloseTo(2 * t.antiSpin);
    expect(antiSpin(-(t.maxDrift + 0.3), 2, t)).toBeLessThan(0); // mirrored
  });
  it('pushes along the slide on throttle, fading toward top speed', () => {
    expect(driftPush(false, 1, 10, t)).toBe(0);
    expect(driftPush(true, 0, 10, t)).toBe(0);
    expect(driftPush(true, 1, 0, t)).toBe(t.driftPush);
    expect(driftPush(true, 1, t.topSpeed, t)).toBe(0);
  });
});
