import { describe, expect, it } from 'vitest';
import { isMoved, PARKED, PARKED_MODELS, PARKED_PAINTS, pickWeighted, poolFor, shouldReturn } from './parked';

describe('parked car rules', () => {
  it('picks by weight, covering every index', () => {
    expect(pickWeighted([1, 1], 0)).toBe(0);
    expect(pickWeighted([1, 1], 0.6)).toBe(1);
    expect(pickWeighted([3, 1], 0.7)).toBe(0);
    expect(pickWeighted([1, 2, 1], 0.999)).toBe(2);
    expect(PARKED_MODELS.every((m) => m.weight > 0) && PARKED_PAINTS.every((p) => p.weight > 0)).toBe(true);
  });

  it('counts a car as moved only past a small offset or turn', () => {
    expect(isMoved(0.1, 0.01)).toBe(false);
    expect(isMoved(PARKED.movedBy + 0.01, 0)).toBe(true);
    expect(isMoved(0, PARKED.turnedBy + 0.01)).toBe(true);
  });

  it('sends a moved car home only once it has been out of sight a moment and is nearly still', () => {
    expect(shouldReturn(0.2, 0)).toBe(false);
    expect(shouldReturn(PARKED.hiddenFor, 3)).toBe(false);
    expect(shouldReturn(PARKED.hiddenFor, 0.1)).toBe(true);
  });

  describe('poolFor', () => {
    const cars = [{ p: [0, 0] as [number, number] }, { p: [PARKED.physicsRadius + 5, 0] as [number, number] }, { p: [500, 0] as [number, number] }];
    const all = () => [0, 1, 2];
    it('takes the cars within the physics radius', () => {
      expect([...poolFor(cars, [0, 0], new Set(), () => false, all)]).toEqual([0]);
    });
    it('keeps a car already in the pool until it is past the margin too (no flicker at the edge)', () => {
      expect([...poolFor(cars, [0, 0], new Set([1]), () => false, all)].sort()).toEqual([0, 1]);
    });
    it('keeps a far car that has to stay (moved and still on screen)', () => {
      expect([...poolFor(cars, [0, 0], new Set([2]), (i) => i === 2, all)].sort()).toEqual([0, 2]);
    });
  });
});
