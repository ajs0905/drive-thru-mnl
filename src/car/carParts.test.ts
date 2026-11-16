import { describe, expect, it } from 'vitest';
import { carParts, LAMP, LENS, steerFor, type Vec3 } from './carParts';

/** A model of triangles: each a center, a color and a shine (a small triangle around the center). */
function model(tris: { at: Vec3; color: Vec3; shine: number }[]) {
  const [position, color, shine] = [[] as number[], [] as number[], [] as number[]];
  for (const t of tris)
    for (const [dx, dy] of [
      [0, 0.1],
      [0.1, -0.1],
      [-0.1, -0.1],
    ]) {
      position.push(t.at[0] + dx, t.at[1] + dy, t.at[2]);
      color.push(...t.color);
      shine.push(t.shine);
    }
  return carParts(position, color, shine);
}

describe('carParts', () => {
  const grey: Vec3 = [0.5, 0.5, 0.5];
  const parts = model([
    { at: [0, 1, 0], color: grey, shine: 1 },
    { at: [0.9, 0.35, 1.4], color: grey, shine: 3 },
    { at: [-0.9, 0.35, 1.4], color: grey, shine: 3 },
    { at: [0.9, 0.35, -1.4], color: grey, shine: 3 },
    { at: [-0.9, 0.35, -1.4], color: grey, shine: 3 },
    { at: [0.7, 0.8, 2.1], color: LENS.head, shine: 0 },
    { at: [-0.7, 0.8, 2.1], color: LENS.head, shine: 0 },
    { at: [0.7, 0.9, -2.1], color: LENS.tail, shine: 0 },
    { at: [-0.7, 0.9, -2.1], color: LENS.tail, shine: 0 },
    // The tail lights' dark red on the front (a grille trim) isn't a tail light.
    { at: [0, 0.5, 2.2], color: LENS.tail, shine: 0 },
  ]);

  it('sorts the wheels into front left, front right, rear left, rear right', () => {
    expect([...parts.triangle]).toEqual([-1, 0, 1, 2, 3, -1, -1, -1, -1, -1]);
    const want = [
      [0.9, 0.35, 1.4],
      [-0.9, 0.35, 1.4],
      [0.9, 0.35, -1.4],
      [-0.9, 0.35, -1.4],
    ];
    parts.wheels.forEach((w, i) => w.forEach((v, d) => expect(v).toBeCloseTo(want[i][d])));
    expect(parts.wheelRadius).toBeCloseTo(0.1);
  });

  it('finds the lamps, left then right, and marks their vertices', () => {
    expect(parts.head.map((p) => Math.round(p[0] * 10) / 10)).toEqual([0.7, -0.7]);
    expect(parts.tail.map((p) => Math.round(p[2] * 10) / 10)).toEqual([-2.1, -2.1]);
    expect(parts.lamp[15]).toBe(LAMP.head);
    expect(parts.lamp[21]).toBe(LAMP.tail);
    expect(parts.lamp[27]).toBe(LAMP.none);
  });

  it('steers the front wheels by the bicycle model, within the lock', () => {
    expect(steerFor(0, 2.7)).toBe(0);
    expect(steerFor(0.1, 2.7)).toBeCloseTo(Math.atan(0.27));
    expect(steerFor(-1, 2.7)).toBe(-0.6);
  });
});
