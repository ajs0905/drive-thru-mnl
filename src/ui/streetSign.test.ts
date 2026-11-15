import { describe, expect, it } from 'vitest';
import { STREET_SIGN, StreetSign } from './streetSign';

/** Feeds `street` every quarter second from `from` to `to` (seconds). */
function drive(sign: StreetSign, street: string | undefined, from: number, to: number) {
  for (let t = from; t < to - 1e-9; t += 0.25) sign.update(street, t);
}

describe('StreetSign', () => {
  it('shows a street once the car has stayed on it, then fades it', () => {
    const sign = new StreetSign();
    drive(sign, 'High Street', 0, STREET_SIGN.settle);
    expect(sign.shown).toBe(false);
    drive(sign, 'High Street', STREET_SIGN.settle, STREET_SIGN.settle + 1);
    expect(sign).toMatchObject({ name: 'High Street', shown: true });
    drive(sign, 'High Street', STREET_SIGN.settle + 1, STREET_SIGN.settle + STREET_SIGN.shown + 1);
    expect(sign).toMatchObject({ name: 'High Street', shown: false });
  });

  it('ignores a street the car only passes through, like the cross street at a junction', () => {
    const sign = new StreetSign();
    drive(sign, '5th Avenue', 0, 6);
    drive(sign, '26th Street', 6, 6.5);
    drive(sign, '5th Avenue', 6.5, 8);
    expect(sign).toMatchObject({ name: '5th Avenue', shown: false });
  });

  it('keeps the last name on unnamed roads', () => {
    const sign = new StreetSign();
    drive(sign, '5th Avenue', 0, 3);
    drive(sign, undefined, 3, 10);
    expect(sign.name).toBe('5th Avenue');
  });

  it("switches back quietly to a street whose sign just showed, and shows it again later", () => {
    const sign = new StreetSign();
    drive(sign, '5th Avenue', 0, 3);
    drive(sign, '26th Street', 3, 6);
    expect(sign).toMatchObject({ name: '26th Street', shown: true });
    drive(sign, '5th Avenue', 6, 9);
    expect(sign).toMatchObject({ name: '5th Avenue', shown: false });
    drive(sign, '26th Street', 9, 12);
    drive(sign, '5th Avenue', 12 + STREET_SIGN.again, 15 + STREET_SIGN.again);
    expect(sign).toMatchObject({ name: '5th Avenue', shown: true });
  });
});
