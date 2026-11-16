import { describe, expect, it } from 'vitest';
import { SUN_SHADOW, sunShadowPose } from './sunShadow';

describe('sunShadowPose', () => {
  const k = (h: number) => (SUN_SHADOW.height / h) * SUN_SHADOW.reach;

  it('throws the shadow away from the sun, half way to the far end', () => {
    // Sun in the east (+x), 45 degrees up: the shadow goes west.
    const sun = { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 };
    const s = sunShadowPose(sun, 0, 2, 4.5);
    expect(s.dx).toBeCloseTo((-Math.SQRT1_2 * k(Math.SQRT1_2)) / 2);
    expect(s.dz).toBeCloseTo(0);
    // Facing +z (north in three.js is -z, it doesn't matter here): the throw is across the car.
    expect(s.width).toBeCloseTo(2 + Math.SQRT1_2 * k(Math.SQRT1_2));
    expect(s.length).toBeCloseTo(4.5);
  });

  it('turns with the car: the same throw lengthens it when it faces the sun', () => {
    const sun = { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 };
    const s = sunShadowPose(sun, Math.PI / 2, 2, 4.5);
    expect(s.width).toBeCloseTo(2);
    expect(s.length).toBeCloseTo(4.5 + Math.SQRT1_2 * k(Math.SQRT1_2));
  });

  it('shrinks under a high sun', () => {
    const noon = sunShadowPose({ x: 0, y: 1, z: 0 }, 0, 2, 4.5);
    expect([noon.dx, noon.dz, noon.width, noon.length]).toEqual([-0, -0, 2, 4.5]);
  });
});
