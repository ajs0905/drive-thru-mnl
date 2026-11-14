import { describe, expect, it } from 'vitest';
import { driveCommand, inputFromKeys, KEY_BINDINGS, maxSteer, NO_KEYS, nextSteer } from './controls';
import { SEDAN } from './spec';

const t = SEDAN.tuning;
const input = (o: Partial<ReturnType<typeof inputFromKeys>> = {}) => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, ...o });

describe('inputFromKeys', () => {
  it('maps WASD and the arrows, left steering positive', () => {
    expect(KEY_BINDINGS.KeyW).toBe('up');
    expect(KEY_BINDINGS.ArrowLeft).toBe('left');
    expect(KEY_BINDINGS.Space).toBe('handbrake');
    expect(inputFromKeys({ ...NO_KEYS, up: true, left: true })).toEqual({ throttle: 1, brake: 0, steer: 1, handbrake: false });
    expect(inputFromKeys({ ...NO_KEYS, right: true })).toMatchObject({ steer: -1 });
    expect(inputFromKeys({ ...NO_KEYS, left: true, right: true })).toMatchObject({ steer: 0 });
  });
});

describe('steering', () => {
  it('has full lock when slow and less at speed', () => {
    expect(maxSteer(0, t)).toBeCloseTo(t.maxSteer);
    expect(maxSteer(t.topSpeed, t)).toBeCloseTo(t.minSteer);
    expect(maxSteer(20, t)).toBeLessThan(maxSteer(10, t));
    expect(maxSteer(-10, t)).toBe(maxSteer(10, t)); // same in reverse
  });
  it('turns the wheels at a limited rate, and back to center faster', () => {
    const dt = 1 / 60;
    const first = nextSteer(0, 1, 0, dt, t);
    expect(first).toBeCloseTo(t.steerRate * dt);
    let a = 0;
    for (let i = 0; i < 120; i++) a = nextSteer(a, 1, 0, dt, t);
    expect(a).toBeCloseTo(t.maxSteer); // reaches full lock and stays there
    expect(a - nextSteer(a, 0, 0, dt, t)).toBeCloseTo(t.steerReturn * dt);
  });
});

describe('driveCommand', () => {
  it('drives the rear wheels, fading out toward top speed', () => {
    const slow = driveCommand(input({ throttle: 1 }), 0, 0, t);
    expect(slow.engine).toBeCloseTo(t.engineForce / 2);
    expect(slow.brakeFront).toBe(0);
    expect(driveCommand(input({ throttle: 1 }), t.topSpeed * 0.9, 0, t).engine).toBeLessThan(slow.engine * 0.25);
    expect(driveCommand(input({ throttle: 1 }), t.topSpeed, 0, t).engine).toBe(0);
  });
  it('brakes while moving forward, then reverses with the same key', () => {
    const braking = driveCommand(input({ brake: 1 }), 20, 0, t);
    expect(braking.engine).toBe(0);
    expect(braking.brakeFront).toBe(t.brake);
    const reversing = driveCommand(input({ brake: 1 }), 0, 0, t);
    expect(reversing.engine).toBeLessThan(0);
    expect(reversing.brakeFront).toBe(0);
    expect(driveCommand(input({ brake: 1 }), -t.reverseSpeed, 0, t).engine).toBeCloseTo(0);
  });
  it('brakes with the throttle while rolling backward', () => {
    const c = driveCommand(input({ throttle: 1 }), -5, 0, t);
    expect(c.engine).toBe(0);
    expect(c.brakeFront).toBe(t.brake);
  });
  it('coasts with a light drag', () => {
    expect(driveCommand(input(), 15, 0, t)).toMatchObject({ engine: 0, brakeFront: t.coastBrake, brakeRear: t.coastBrake });
  });
  it('locks the rear wheels and loosens their grip with the handbrake', () => {
    const c = driveCommand(input({ handbrake: true }), 15, 0.2, t);
    expect(c.brakeRear).toBe(t.handbrake);
    expect(c.brakeFront).toBe(t.coastBrake);
    expect(c.rearSideFriction).toBe(t.driftSideFriction);
    expect(c.steer).toBe(0.2);
    expect(driveCommand(input(), 15, 0, t).rearSideFriction).toBe(t.sideFriction);
  });
});
