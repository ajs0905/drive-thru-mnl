import { describe, expect, it } from 'vitest';
import { driveShare, NEW_GEARBOX, stepGearbox, type Gearbox } from './gearbox';
import { SEDAN } from './spec';

const t = SEDAN.tuning;
const DT = 1 / 60;

describe('stepGearbox', () => {
  it('shifts up past each gear speed, one gear at a time, with a drive drop', () => {
    let g: Gearbox = NEW_GEARBOX;
    g = stepGearbox(g, t.upshift[0] - 0.1, DT, t);
    expect(g.gear).toBe(1);
    g = stepGearbox(g, t.upshift[0] + 0.1, DT, t);
    expect(g).toEqual({ gear: 2, shifting: t.shiftTime, upshifts: 1 });
    g = stepGearbox(g, 100, DT, t); // way past every gear: still one at a time
    expect(g.gear).toBe(3);
  });
  it('tops out at the last gear', () => {
    let g: Gearbox = NEW_GEARBOX;
    for (let i = 0; i < 20; i++) g = stepGearbox(g, 100, DT, t);
    expect(g.gear).toBe(t.upshift.length + 1);
    expect(g.upshifts).toBe(t.upshift.length);
  });
  it("doesn't hunt between gears around a shift speed", () => {
    let g = stepGearbox(NEW_GEARBOX, t.upshift[0] + 0.5, DT, t);
    expect(g.gear).toBe(2);
    g = stepGearbox(g, t.upshift[0] - 0.5, DT, t); // just below: stays in 2
    expect(g.gear).toBe(2);
    g = stepGearbox(g, t.upshift[0] - t.downshiftGap - 0.1, DT, t);
    expect(g.gear).toBe(1);
    expect(g.upshifts).toBe(1); // downshifts don't count, and have no kick
    expect(g.shifting).toBeLessThan(t.shiftTime);
  });
  it('goes into reverse when rolling backward, and back to first after', () => {
    let g = stepGearbox(NEW_GEARBOX, -2, DT, t);
    expect(g.gear).toBe(-1);
    g = stepGearbox(g, 1, DT, t);
    expect(g.gear).toBe(1);
  });
});

describe('driveShare', () => {
  it('drops the drive only while an upshift is happening', () => {
    expect(driveShare(NEW_GEARBOX, t)).toBe(1);
    const shifting = stepGearbox(NEW_GEARBOX, t.upshift[0] + 1, DT, t);
    expect(driveShare(shifting, t)).toBe(t.shiftDrive);
    let g = shifting;
    for (let i = 0; i < Math.ceil(t.shiftTime / DT) + 1; i++) g = stepGearbox(g, t.upshift[0] + 1, DT, t);
    expect(driveShare(g, t)).toBe(1);
  });
});
