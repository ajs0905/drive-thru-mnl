import { describe, expect, it } from 'vitest';
import { CARE, crashLoss, PAY, receipt, targetTime } from './cargo';
import type { RunDef } from './events';
import { ARRIVE, inBay, newRun, startCountdown, stepRun, type CarSignals, type RunState } from './run';

const courier: RunDef = { id: 'r', name: 'R', kind: 'courier', cargo: 'Parcels', from: 'a', to: 'b' };
const vault: RunDef = { ...courier, kind: 'vault' };
const still = (p: [number, number], extra: Partial<CarSignals> = {}): CarSignals => ({ p, speed: 0, accel: 0, drifting: false, impacts: 0, impact: 0, crashing: false, ...extra });

function running(def = courier, checkpoints: RunState['checkpoints'] = []): RunState {
  let s = newRun(def, { pickup: [0, 0], dropoff: [1000, 0], pickupHeading: 0, dropoffHeading: 0, meters: 1000, target: 100, checkpoints, atPickup: true });
  s = startCountdown(s, { impacts: 0 });
  for (let t = 0; t < ARRIVE.countdown + 0.1; t += 0.1) s = stepRun(s, still([0, 0]), 0.1).state;
  expect(s.phase).toBe('running');
  return s;
}

describe('the receipt', () => {
  it('adds base and distance, the integrity bonus, and takes VAT and withholding', () => {
    const r = receipt('courier', 2000, 80, 100, 100);
    const gross = PAY.courier.base + PAY.courier.perKm * 2;
    const bonus = gross * PAY.courier.bonus;
    const taxable = gross + bonus;
    expect(r.lines.map((l) => l.label)).toEqual(['Gross delivery fee (base + distance)', 'Cargo integrity bonus', 'Less 12% VAT', 'Less 5% withholding tax']);
    expect(r.lines[0].amount).toBe(gross);
    expect(r.lines[1].amount).toBeCloseTo(bonus, 2);
    expect(r.net).toBeCloseTo(taxable * (1 - 0.12 - 0.05), 1);
    expect(r.lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(r.net, 1);
  });

  it('cuts late deliveries (half the fee at most) and dented cargo', () => {
    const late = receipt('courier', 1000, 150, 100, 100);
    expect(late.lines.find((l) => l.label === 'Less late delivery')!.amount).toBeCloseTo(-(PAY.courier.base + PAY.courier.perKm) * 0.5, 2);
    expect(receipt('courier', 1000, 80, 100, 50).net).toBeLessThan(receipt('courier', 1000, 80, 100, 100).net);
    expect(receipt('vault', 1000, 80, 100, 100).net).toBeGreaterThan(receipt('courier', 1000, 80, 100, 100).net);
  });

  it('sets targets with slack, in 5 s steps', () => {
    expect(targetTime(100)).toBe(150);
    expect(targetTime(101) % 5).toBe(0);
  });
});

describe('a run', () => {
  it('waits at the intro, counts down, then runs', () => {
    let s = newRun(courier, { pickup: [0, 0], dropoff: [100, 0], pickupHeading: 0, dropoffHeading: 0, meters: 100, target: 60, checkpoints: [], atPickup: true });
    expect(s.phase).toBe('intro');
    expect(stepRun(s, still([0, 0]), 1).state.phase).toBe('intro');
    s = startCountdown(s, { impacts: 0 });
    const r = stepRun(s, still([0, 0]), ARRIVE.countdown + 0.01);
    expect(r.state.phase).toBe('running');
    expect(r.events).toEqual(['go']);
  });

  it('opens the intro once the car stops at the pickup', () => {
    let s = newRun(courier, { pickup: [0, 0], dropoff: [100, 0], pickupHeading: 0, dropoffHeading: 0, meters: 100, target: 60, checkpoints: [], atPickup: false });
    expect(s.phase).toBe('to-pickup');
    s = stepRun(s, still([0, 0], { speed: 5 }), 1).state;
    expect(s.phase).toBe('to-pickup');
    s = stepRun(s, still([3, 0]), 1).state;
    expect(s.phase).toBe('intro');
  });

  it('counts a crash once, by its whole speed change, after it ends', () => {
    let s = running();
    s = stepRun(s, still([10, 0], { impacts: 1, impact: 4, crashing: true }), 1 / 60).state;
    s = stepRun(s, still([10, 0], { impacts: 1, impact: 7, crashing: true }), 1 / 60).state;
    expect(s.integrity).toBe(100);
    s = stepRun(s, still([10, 0], { impacts: 1, impact: 7, crashing: false }), 1 / 60).state;
    expect(s.integrity).toBeCloseTo(100 - crashLoss(7, 'courier'));
    s = stepRun(s, still([10, 0], { impacts: 1, impact: 7 }), 1).state;
    expect(s.integrity).toBeCloseTo(100 - crashLoss(7, 'courier'));
  });

  it('minds hard braking from speed and drifting, vault cargo more', () => {
    const brake = (def: RunDef) => stepRun(running(def), still([10, 0], { speed: 25, accel: -9 }), 1).state.integrity;
    expect(brake(courier)).toBeCloseTo(100 - CARE.brakeRate);
    expect(brake(vault)).toBeCloseTo(100 - CARE.brakeRate * PAY.vault.care);
    expect(stepRun(running(), still([10, 0], { speed: 10, accel: -9 }), 1).state.integrity).toBe(100);
    expect(stepRun(running(), still([10, 0], { speed: 15, drifting: true }), 1).state.integrity).toBeCloseTo(100 - CARE.driftRate);
  });

  it('lets normal driving off: firm braking, braking from city speeds, light drifts and bumps', () => {
    expect(stepRun(running(), still([10, 0], { speed: 25, accel: -7 }), 1).state.integrity).toBe(100);
    expect(stepRun(running(), still([10, 0], { speed: 16, accel: -9 }), 1).state.integrity).toBe(100);
    expect(stepRun(running(), still([10, 0], { speed: 10, drifting: true }), 1).state.integrity).toBe(100);
    expect(crashLoss(3, 'courier')).toBe(0);
    // A hard crash still costs about a third of the cargo, at most.
    expect(crashLoss(15, 'courier')).toBe(CARE.crashMax);
    expect(CARE.crashMax).toBeLessThanOrEqual(35);
  });

  it('has no damage charge on the receipt: dents only shrink the bonus', () => {
    const lines = receipt('courier', 2000, 100, 120, 50).lines.map((l) => l.label.toLowerCase());
    expect(lines.some((l) => l.includes('damage'))).toBe(false);
    expect(lines.filter((l) => l.startsWith('less'))).toEqual(['less 12% vat', 'less 5% withholding tax']);
  });

  it('passes checkpoints in order and delivers with a receipt', () => {
    let s = running(courier, [{ p: [400, 0], heading: 0 }, { p: [800, 0], heading: 0 }]);
    const events: string[] = [];
    for (let x = 0; x <= 1000; x += 10) {
      const r = stepRun(s, still([x, 0], { speed: 20 }), 0.5);
      s = r.state;
      events.push(...r.events);
    }
    expect(events.filter((e) => e === 'checkpoint')).toHaveLength(2);
    expect(s.phase).toBe('running');
    s = stepRun(s, still([1000, 2]), ARRIVE.hold).state;
    expect(s.phase).toBe('done');
    expect(s.result?.receipt?.net).toBeGreaterThan(0);
  });

  it('counts a stop only inside the bay along the curb', () => {
    // The bay faces east: 7 m along, 3 m across, with the slack either way.
    expect(inBay([4, 0], [0, 0], 0)).toBe(true);
    expect(inBay([0, 2.3], [0, 0], 0)).toBe(true);
    expect(inBay([0, 3], [0, 0], 0)).toBe(false);
    expect(inBay([5, 0], [0, 0], 0)).toBe(false);
    // Turned north: along is now y.
    expect(inBay([0, 4], [0, 0], Math.PI / 2)).toBe(true);
    expect(inBay([4, 0], [0, 0], Math.PI / 2)).toBe(false);
  });

  it('fails when the cargo is destroyed or the run takes twice its target', () => {
    let s = running();
    for (let i = 0; i < 5; i++) {
      s = stepRun(s, still([10, 0], { impacts: i + 1, impact: 30, crashing: true }), 0.1).state;
      s = stepRun(s, still([10, 0], { impacts: i + 1, impact: 30 }), 0.1).state;
    }
    expect(s.phase).toBe('failed');
    expect(s.result?.reason).toBe('destroyed');
    const slow = stepRun(running(), still([10, 0]), 201).state;
    expect(slow.result?.reason).toBe('late');
  });
});
