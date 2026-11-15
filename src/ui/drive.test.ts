import { describe, expect, it } from 'vitest';
import { tipFor } from './drive';

describe('tipFor', () => {
  it('shows the next tip each drive and wraps around', () => {
    const tips = Array.from({ length: 12 }, (_, n) => tipFor(false, n));
    expect(new Set(tips.slice(0, 5)).size).toBe(5);
    expect(tips[5]).toBe(tips[0]);
    expect(tipFor(false, -1)).toBe(tips[4]);
  });
  it('talks about buttons on touch screens and keys otherwise', () => {
    const touch = Array.from({ length: 5 }, (_, n) => tipFor(true, n)).join(' ');
    const keys = Array.from({ length: 5 }, (_, n) => tipFor(false, n)).join(' ');
    expect(touch).toMatch(/Tap/);
    expect(touch).not.toMatch(/Press/);
    expect(keys).toMatch(/Press/);
  });
});
