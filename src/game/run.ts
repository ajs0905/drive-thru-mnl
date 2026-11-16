/**
 * One cargo run as a state machine, stepped once per frame with what the car is doing.
 * Pure: no rendering, no timers of its own, so it's tested by feeding it frames.
 *
 *   to-pickup --(stopped at the bay)--> intro --(start)--> countdown --(3 s)--> running
 *   running --(stopped at the drop-off)--> done
 *   running --(cargo destroyed, or twice the target time)--> failed
 *
 * "to-pickup" is optional: a run started with a teleport begins at the intro.
 */
import type { Point } from '../map/types';
import { crashLoss, drivingLoss, LATE_FAIL, receipt, type CareLoss, type Receipt } from './cargo';
import type { RunDef } from './events';

export type RunPhase = 'to-pickup' | 'intro' | 'countdown' | 'running' | 'done' | 'failed';

export const ARRIVE = {
  /**
   * The bay at a stop (m): a curbside rectangle along the curb, a car's length and a bit
   * (drawn by scene/RunMarkers.tsx). Arrived: the car's center inside it, with `slack`
   * meters to spare each way, below `speed` (m/s), for `hold` seconds.
   */
  bay: { length: 7, width: 3 },
  slack: 0.9,
  speed: 1.5,
  hold: 0.8,
  /** Seconds of countdown. */
  countdown: 3,
  /** A checkpoint counts once the car passes within this far (m). */
  checkpoint: 20,
};

export interface Checkpoint {
  p: Point;
  heading: number;
}

export interface RunState {
  def: RunDef;
  phase: RunPhase;
  /** Where the run picks up and drops off (curb spots, map space), and the way each bay faces. */
  pickup: Point;
  dropoff: Point;
  pickupHeading: number;
  dropoffHeading: number;
  /** The planned route's length (m) and the target time (s). */
  meters: number;
  target: number;
  /** Seconds since the start, seconds of countdown left, seconds held at the stop. */
  time: number;
  countdown: number;
  held: number;
  integrity: number;
  lost: CareLoss;
  /** Along the planned route, in order; `passed` of them so far. */
  checkpoints: Checkpoint[];
  passed: number;
  /** The crash counter last seen (the car's), and the crash going on (its speed change so far). */
  impacts: number;
  crash: number;
  result?: { receipt: Receipt; reason?: undefined } | { receipt?: undefined; reason: 'destroyed' | 'late' };
}

export interface CarSignals {
  p: Point;
  /** Forward speed (m/s), smoothed forward acceleration (m/s^2). */
  speed: number;
  accel: number;
  drifting: boolean;
  /** The car's crash counter, the last crash's speed change so far (m/s), and whether it's still going on. */
  impacts: number;
  impact: number;
  crashing: boolean;
}

export function newRun(def: RunDef, opts: { pickup: Point; dropoff: Point; pickupHeading: number; dropoffHeading: number; meters: number; target: number; checkpoints: Checkpoint[]; atPickup: boolean }): RunState {
  return {
    def,
    phase: opts.atPickup ? 'intro' : 'to-pickup',
    pickup: opts.pickup,
    dropoff: opts.dropoff,
    pickupHeading: opts.pickupHeading,
    dropoffHeading: opts.dropoffHeading,
    meters: opts.meters,
    target: opts.target,
    time: 0,
    countdown: ARRIVE.countdown,
    held: 0,
    integrity: 100,
    lost: { crashes: 0, braking: 0, drifting: 0 },
    checkpoints: opts.checkpoints,
    passed: 0,
    impacts: 0,
    crash: 0,
  };
}

/** From the intro: count down (the car held), then go. */
export function startCountdown(s: RunState, car: Pick<CarSignals, 'impacts'>): RunState {
  return s.phase === 'intro' ? { ...s, phase: 'countdown', countdown: ARRIVE.countdown, impacts: car.impacts } : s;
}

export type RunEvent = 'arrived' | 'go' | 'checkpoint' | 'done' | 'failed';

const near = (a: Point, b: Point, r: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) < r;

/** Is `p` inside the bay at `at` facing `heading` (with `ARRIVE.slack` to spare)? */
export function inBay(p: Point, at: Point, heading: number): boolean {
  const [dx, dy] = [p[0] - at[0], p[1] - at[1]];
  const along = dx * Math.cos(heading) + dy * Math.sin(heading);
  const across = -dx * Math.sin(heading) + dy * Math.cos(heading);
  return Math.abs(along) <= ARRIVE.bay.length / 2 + ARRIVE.slack && Math.abs(across) <= ARRIVE.bay.width / 2 + ARRIVE.slack;
}

/** One frame. Returns the new state and what happened (for the HUD's banners). */
export function stepRun(s: RunState, car: CarSignals, dt: number): { state: RunState; events: RunEvent[] } {
  const events: RunEvent[] = [];
  const slowAt = (p: Point, heading: number) => inBay(car.p, p, heading) && Math.abs(car.speed) < ARRIVE.speed;
  switch (s.phase) {
    case 'to-pickup': {
      const held = slowAt(s.pickup, s.pickupHeading) ? s.held + dt : 0;
      if (held >= ARRIVE.hold) {
        events.push('arrived');
        return { state: { ...s, phase: 'intro', held: 0 }, events };
      }
      return { state: { ...s, held }, events };
    }
    case 'countdown': {
      const countdown = s.countdown - dt;
      if (countdown <= 0) {
        events.push('go');
        return { state: { ...s, phase: 'running', countdown: 0, time: 0, impacts: car.impacts, crash: 0 }, events };
      }
      return { state: { ...s, countdown, impacts: car.impacts }, events };
    }
    case 'running': {
      const kind = s.def.kind;
      const lost = { ...s.lost };
      let { impacts, crash } = s;
      // A crash is counted once it's over, by its whole speed change (it spreads over a few steps).
      if (car.impacts !== impacts) {
        if (crash > 0) lost.crashes += crashLoss(crash, kind);
        impacts = car.impacts;
        crash = car.impact;
      } else if (crash > 0) {
        crash = Math.max(crash, car.impact);
        if (!car.crashing) {
          lost.crashes += crashLoss(crash, kind);
          crash = 0;
        }
      }
      const d = drivingLoss({ speed: car.speed, accel: car.accel, drifting: car.drifting }, dt, kind);
      lost.braking += d.braking;
      lost.drifting += d.drifting;
      const integrity = Math.max(0, 100 - lost.crashes - lost.braking - lost.drifting);
      const time = s.time + dt;
      let passed = s.passed;
      while (passed < s.checkpoints.length && near(car.p, s.checkpoints[passed].p, ARRIVE.checkpoint)) {
        passed++;
        events.push('checkpoint');
      }
      const base = { ...s, time, integrity, lost, impacts, crash, passed };
      if (integrity <= 0) {
        events.push('failed');
        return { state: { ...base, phase: 'failed', result: { reason: 'destroyed' } }, events };
      }
      if (time > s.target * LATE_FAIL) {
        events.push('failed');
        return { state: { ...base, phase: 'failed', result: { reason: 'late' } }, events };
      }
      const held = slowAt(s.dropoff, s.dropoffHeading) ? s.held + dt : 0;
      if (held >= ARRIVE.hold) {
        events.push('done');
        return { state: { ...base, held, phase: 'done', result: { receipt: receipt(kind, s.meters, time, s.target, integrity) } }, events };
      }
      return { state: { ...base, held }, events };
    }
    default:
      return { state: s, events };
  }
}

/** Where "back to the last checkpoint" puts the car: the last one passed, else the pickup. */
export function lastCheckpoint(s: RunState): Checkpoint | null {
  return s.passed > 0 ? s.checkpoints[s.passed - 1] : null;
}
