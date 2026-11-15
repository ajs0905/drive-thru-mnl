import { describe, expect, it } from 'vitest';
import { sidewaysStyle } from './sideways';

describe('sidewaysStyle', () => {
  it('swaps the size and turns a quarter clockwise around the top left, shifted back onto the screen', () => {
    const s = sidewaysStyle(390, 844);
    expect(s.width).toBe('844px');
    expect(s.height).toBe('390px');
    expect(s.transform).toBe('translateX(390px) rotate(90deg)');
    expect(s.transformOrigin).toBe('0 0');
  });
});
