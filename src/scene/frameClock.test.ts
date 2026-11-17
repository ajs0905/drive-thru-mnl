import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameClock } from './frameClock';

/** A performance.now() the test moves by hand (ms). */
function fakeNow(start = 1000) {
  let now = start;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  return (ms: number) => {
    now += ms;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FrameClock', () => {
  it('starts on the first getDelta (returning 0), then gives the seconds between calls', () => {
    const tick = fakeNow();
    const clock = new FrameClock();
    tick(500);
    expect(clock.running).toBe(false);
    expect(clock.getDelta()).toBe(0);
    expect(clock.running).toBe(true);
    tick(16);
    expect(clock.getDelta()).toBeCloseTo(0.016, 9);
    tick(34);
    expect(clock.getDelta()).toBeCloseTo(0.034, 9);
    expect(clock.elapsedTime).toBeCloseTo(0.05, 9);
  });

  it('counts nothing while stopped and does not restart on its own', () => {
    const tick = fakeNow();
    const clock = new FrameClock();
    clock.start();
    tick(100);
    clock.stop();
    expect(clock.elapsedTime).toBeCloseTo(0.1, 9);
    tick(5000);
    expect(clock.getDelta()).toBe(0);
    expect(clock.getElapsedTime()).toBeCloseTo(0.1, 9);
    expect(clock.running).toBe(false);
  });

  it('start() resets the elapsed time and counts from then, not from the last call', () => {
    const tick = fakeNow();
    const clock = new FrameClock();
    clock.getDelta();
    tick(2000);
    clock.start();
    expect(clock.elapsedTime).toBe(0);
    tick(20);
    expect(clock.getDelta()).toBeCloseTo(0.02, 9);
    expect(clock.getElapsedTime()).toBeCloseTo(0.02, 9);
  });

  it('with autoStart off, waits for start()', () => {
    const tick = fakeNow();
    const clock = new FrameClock(false);
    tick(100);
    expect(clock.getDelta()).toBe(0);
    expect(clock.running).toBe(false);
    clock.start();
    tick(10);
    expect(clock.getDelta()).toBeCloseTo(0.01, 9);
  });

  it('getDelta after a long pause gives the whole gap (the game drops it itself on resume)', () => {
    const tick = fakeNow();
    const clock = new FrameClock();
    clock.getDelta();
    tick(3000);
    expect(clock.getDelta()).toBeCloseTo(3, 9);
  });
});
