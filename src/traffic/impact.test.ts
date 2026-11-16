import { describe, expect, it } from 'vitest';
import { closestOnBox, faceNormal, impactOf, yawOf, type Hit, type Vec2 } from './impact';

/** A traffic car at the origin heading +x (three.js ground plane: x, z), 4.4 m by 1.9 m, rolling at 8 m/s. */
const car = (point: Vec2, hitterVel: Vec2): Hit => ({ center: [0, 0], forward: [1, 0], half: [2.2, 0.95], point, hitterVel, targetVel: [8, 0], hitterMass: 1200, targetMass: 1200 });

describe('a bump on a traffic car', () => {
  it('finds the struck face', () => {
    const back = faceNormal([0, 0], [1, 0], [2.2, 0.95], [-2.2, 0.2]);
    expect(back[0]).toBe(-1);
    expect(back[1]).toBeCloseTo(0);
    const right = faceNormal([0, 0], [1, 0], [2.2, 0.95], [1.5, 0.95]);
    expect(right[0]).toBeCloseTo(0);
    expect(right[1]).toBeCloseTo(1);
    const side = faceNormal([0, 0], [1, 0], [2.2, 0.95], [0.5, -0.95]);
    expect(Math.abs(side[0])).toBe(0);
    expect(Math.abs(side[1])).toBe(1);
  });

  it('shoves a car hit square from behind straight ahead, without turning it', () => {
    const hit = car([-2.2, 0], [14, 0]);
    const r = impactOf(hit);
    expect(r.closing).toBeCloseTo(6);
    expect(r.impulse[0]).toBeGreaterThan(0);
    expect(Math.abs(r.impulse[1])).toBeLessThan(1e-9);
    expect(Math.abs(yawOf(hit.center, hit.point, r.impulse))).toBeLessThan(1e-9);
    // Equal masses, a little bounce: about 0.6 of the closing speed handed over.
    expect(r.impulse[0] / 1200).toBeCloseTo(0.6 * 6 * 0.5 * 2, 1);
  });

  it('spins a car tapped on a rear corner from the side, its nose kicking away from the hit side', () => {
    // The player comes in from +z (the car's right in three.js terms here) at the rear corner, moving toward -z.
    const rear = car([-1.8, 0.95], [8, -5]);
    const front = car([1.8, 0.95], [8, -5]);
    const [r, f] = [impactOf(rear), impactOf(front)];
    expect(r.impulse[1]).toBeLessThan(0);
    const [yr, yf] = [yawOf(rear.center, rear.point, r.impulse), yawOf(front.center, front.point, f.impulse)];
    // A rear hit and a front hit from the same side turn it opposite ways, and both turn it.
    expect(Math.sign(yr)).toBe(-Math.sign(yf));
    expect(Math.abs(yr)).toBeGreaterThan(1000);
  });

  it('drags a car along in a sideswipe, but only as much as the contact can carry', () => {
    // Sliding past along the right side, barely closing.
    const r = impactOf(car([0, 0.95], [20, -0.5]));
    expect(r.closing).toBeCloseTo(0.5);
    expect(r.impulse[0]).toBeGreaterThan(0);
    expect(r.impulse[0]).toBeLessThanOrEqual(0.6 * Math.abs(r.impulse[1]) + 600 + 1e-6);
  });

  it('does nothing to a car the other one was moving away from', () => {
    const r = impactOf(car([-2.2, 0], [3, 0]));
    expect(r.closing).toBe(0);
    expect(Math.hypot(...r.impulse)).toBe(0);
  });

  it('finds the point of the box nearest a point outside it', () => {
    expect(closestOnBox([0, 0], [1, 0], [2.2, 0.95], [5, 3])).toEqual([2.2, 0.95]);
    const p = closestOnBox([0, 0], [1, 0], [2.2, 0.95], [0, -4]);
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(-0.95);
  });
});
