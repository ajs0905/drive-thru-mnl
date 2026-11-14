import { describe, expect, it } from 'vitest';
import { BODY, kick, leanFor, STILL, stepBody, type BodyMotion } from './bodyMotion';

const settle = (forward: number, left: number, seconds = 2) => {
  let b: BodyMotion = STILL;
  for (let i = 0; i < seconds * 60; i++) b = stepBody(b, forward, left, 1 / 60);
  return b;
};

describe('leanFor', () => {
  it('squats on throttle (nose up), dips under braking (nose down)', () => {
    expect(leanFor(5, 0).pitch).toBeLessThan(0);
    expect(leanFor(-5, 0).pitch).toBeGreaterThan(0);
  });
  it('leans out of a corner: turning left lowers the right side', () => {
    expect(leanFor(0, 8).roll).toBeGreaterThan(0);
    expect(leanFor(0, -8).roll).toBeLessThan(0);
  });
  it('never leans more than a few degrees', () => {
    expect(Math.abs(leanFor(100, 0).pitch)).toBe(BODY.maxPitch);
    expect(Math.abs(leanFor(0, -100).roll)).toBe(BODY.maxRoll);
    expect(BODY.maxPitch).toBeLessThan(0.06); // under 3.5 degrees
  });
});

describe('stepBody', () => {
  it('settles at the lean for a steady acceleration', () => {
    const b = settle(6, -4);
    const goal = leanFor(6, -4);
    expect(b.pitch).toBeCloseTo(goal.pitch, 4);
    expect(b.roll).toBeCloseTo(goal.roll, 4);
  });
  it('overshoots a little before settling (a bit of bounce)', () => {
    let b: BodyMotion = STILL;
    let most = 0;
    for (let i = 0; i < 120; i++) {
      b = stepBody(b, -8, 0, 1 / 60);
      most = Math.max(most, b.pitch);
    }
    const goal = leanFor(-8, 0).pitch;
    expect(most).toBeGreaterThan(goal * 1.02);
    expect(most).toBeLessThan(goal * 1.4);
  });
  it('stays stable through slow frames', () => {
    let b: BodyMotion = STILL;
    for (let i = 0; i < 30; i++) b = stepBody(b, 8, 8, 0.5);
    expect(Math.abs(b.pitch)).toBeLessThanOrEqual(BODY.maxPitch * 1.5);
    expect(Number.isFinite(b.rollVel)).toBe(true);
  });
  it('dips the nose briefly after an upshift kick, then comes back', () => {
    let b = kick(STILL);
    let most = 0;
    for (let i = 0; i < 60; i++) {
      b = stepBody(b, 0, 0, 1 / 60);
      most = Math.max(most, b.pitch);
    }
    expect(most).toBeGreaterThan(0.005); // visible: about half a degree
    expect(Math.abs(b.pitch)).toBeLessThan(0.002);
  });
});
