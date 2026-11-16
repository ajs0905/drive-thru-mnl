import { describe, expect, it } from 'vitest';
import { tipFor } from './drive';

describe('tipFor', () => {
  it('shows the next tip each drive and wraps around', () => {
    const tips = Array.from({ length: 20 }, (_, n) => tipFor(false, n));
    const count = new Set(tips).size;
    expect(count).toBeGreaterThan(4);
    expect(new Set(tips.slice(0, count)).size).toBe(count);
    expect(tips[count]).toBe(tips[0]);
    expect(tipFor(false, -1)).toBe(tips[count - 1]);
  });
  it('talks about buttons on touch screens and keys otherwise', () => {
    const touch = Array.from({ length: 5 }, (_, n) => tipFor(true, n)).join(' ');
    const keys = Array.from({ length: 5 }, (_, n) => tipFor(false, n)).join(' ');
    expect(touch).toMatch(/Tap/);
    expect(touch).not.toMatch(/Press/);
    expect(keys).toMatch(/Press/);
  });
});
