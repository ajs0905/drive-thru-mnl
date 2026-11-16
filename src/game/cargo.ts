/**
 * Cargo runs: how the cargo's condition (integrity, 100 to 0) suffers from the driving,
 * how long a run should take, and the delivery receipt the run pays out.
 *
 * Integrity drops mostly for crashes (by the crash's speed change; scrapes and bumps under
 * 3 m/s are free). Hard braking and drifting cost a little, and only at speed: keyboard
 * brakes are all or nothing, so only a full stop from above about 65 km/h counts, and only
 * a drift above about 43 km/h. Normal cornering, light drifts and firm braking are free.
 * Vault runs (cash, paintings) count all of it 1.5 times and pay more. Measured on the
 * Sedan in the physics tests: a full stop pulls about 8 to 9.5 m/s^2.
 */
import type { RunKind } from './events';

export const CARE = {
  /** Crash: integrity lost per m/s of speed change above `crashFree`, at most `crashMax` per crash. */
  crashFree: 3,
  crashPerMs: 3.2,
  crashMax: 32,
  /** Hard braking: deceleration (m/s^2) above this, while faster than `brakeFrom` (m/s), loses `brakeRate` per second. */
  brakeDecel: 7.5,
  brakeFrom: 18,
  brakeRate: 1.5,
  /** Drifting faster than `driftFrom` (m/s) loses `driftRate` per second. */
  driftFrom: 12,
  driftRate: 2,
};

/** Per kind: base fee and per km (PHP), the integrity bonus at 100% (a share of the fee), and how much more the cargo minds. */
export const PAY: Record<RunKind, { base: number; perKm: number; bonus: number; care: number }> = {
  courier: { base: 250, perKm: 180, bonus: 0.4, care: 1 },
  vault: { base: 600, perKm: 320, bonus: 0.6, care: 1.5 },
};

/** Taxes on the receipt (parody, but the rates are the real Philippine VAT and a common withholding rate). */
export const TAX = { vat: 0.12, withholding: 0.05 };

/** The run's target time from the route's free-flow time (s): some slack, rounded up to 5 s. */
export function targetTime(routeTime: number): number {
  return Math.ceil((routeTime * 1.35 + 15) / 5) * 5;
}

/** A run fails once it has taken this many times its target. */
export const LATE_FAIL = 2;

export interface CareSignals {
  /** Forward speed (m/s, any sign), smoothed forward acceleration (m/s^2), drifting. */
  speed: number;
  accel: number;
  drifting: boolean;
}

export interface CareLoss {
  crashes: number;
  braking: number;
  drifting: number;
}

/** Integrity lost to one crash with this total speed change (m/s). */
export function crashLoss(dv: number, kind: RunKind): number {
  return Math.min(CARE.crashMax, Math.max(0, (dv - CARE.crashFree) * CARE.crashPerMs)) * PAY[kind].care;
}

/** Integrity lost over a step of driving (s), crashes aside. */
export function drivingLoss(s: CareSignals, dt: number, kind: RunKind): { braking: number; drifting: number } {
  const v = Math.abs(s.speed);
  const braking = v > CARE.brakeFrom && -s.accel > CARE.brakeDecel ? CARE.brakeRate * dt : 0;
  const drifting = s.drifting && v > CARE.driftFrom ? CARE.driftRate * dt : 0;
  return { braking: braking * PAY[kind].care, drifting: drifting * PAY[kind].care };
}

export interface ReceiptLine {
  label: string;
  amount: number;
}

export interface Receipt {
  lines: ReceiptLine[];
  net: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * The delivery receipt: gross fee (base plus distance), less a late delivery cut (half
 * the fee at most), plus the integrity bonus (squared, so a dented cargo earns much
 * less), less VAT and withholding. Damage only shows in a smaller bonus: there's no
 * separate damage charge.
 */
export function receipt(kind: RunKind, meters: number, time: number, target: number, integrity: number): Receipt {
  const p = PAY[kind];
  const gross = cents(p.base + (p.perKm * meters) / 1000);
  const late = time > target ? cents(gross * Math.min(0.5, (time - target) / target)) : 0;
  const bonus = cents(gross * p.bonus * Math.max(0, Math.min(1, integrity / 100)) ** 2);
  const taxable = cents(gross - late + bonus);
  const vat = cents(taxable * TAX.vat);
  const withholding = cents(taxable * TAX.withholding);
  const lines: ReceiptLine[] = [{ label: 'Gross delivery fee (base + distance)', amount: gross }];
  if (late) lines.push({ label: 'Less late delivery', amount: -late });
  lines.push({ label: 'Cargo integrity bonus', amount: bonus });
  lines.push({ label: 'Less 12% VAT', amount: -vat });
  lines.push({ label: 'Less 5% withholding tax', amount: -withholding });
  return { lines, net: cents(taxable - vat - withholding) };
}
