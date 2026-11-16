/**
 * A driver for headless runs: follows a route polyline with the same on/off keys a player
 * has. Pure pursuit steering (aim at a point a speed-dependent distance ahead on the
 * route), a target speed that drops before bends (the heading change over the next 35 m),
 * and braking to a stop at the end. Used to record replays and to drive the cargo runs in
 * the real physics in tests; the traffic and the police will want something like it too.
 */
import type { DriveKeys } from '../car/controls';
import type { Point } from '../map/types';
import { pointOnRoute, progressOnRoute, type Route } from '../routing/route';

export const AUTOPILOT = {
  /** Top speed on straights (m/s), slowest through the sharpest bends. */
  top: 16,
  slowest: 6,
  /** Look-ahead (m): base plus seconds of speed, clamped. */
  look: 6,
  lookPerSpeed: 0.6,
  lookMax: 22,
  /** Steer only past this heading error (rad), so the keys don't chatter. */
  deadband: 0.05,
  /** Braking assumed when planning the stop (m/s^2), and the margin (m). */
  decel: 6,
  stopMargin: 3,
};

export interface Pilot {
  route: Route;
  s: number;
  done: boolean;
}

export const newPilot = (route: Route): Pilot => ({ route, s: 0, done: false });

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The keys for this step, given where the car is, where it points (map heading) and its speed (m/s). */
export function drive(pilot: Pilot, p: Point, heading: number, speed: number, keys: DriveKeys): DriveKeys {
  const A = AUTOPILOT;
  const route = pilot.route;
  pilot.s = progressOnRoute(route, p, pilot.s).s;
  const left = route.length - pilot.s;
  const look = Math.min(A.lookMax, A.look + A.lookPerSpeed * Math.max(0, speed));
  const aim = pointOnRoute(route, Math.min(route.length, pilot.s + look)).p;
  const err = wrap(Math.atan2(aim[1] - p[1], aim[0] - p[0]) - heading);
  // How much the road turns over the next stretch: slow down for it.
  const h0 = pointOnRoute(route, pilot.s).heading;
  let turn = 0;
  for (let d = 10; d <= 35; d += 5) turn = Math.max(turn, Math.abs(wrap(pointOnRoute(route, Math.min(route.length, pilot.s + d)).heading - h0)));
  let want = Math.max(A.slowest, A.top * (1 - turn / 1.4));
  // Brake for the end.
  const stopping = (speed * speed) / (2 * A.decel) + A.stopMargin;
  if (left < stopping) want = 0;
  if (left < 2 && Math.abs(speed) < 0.5) pilot.done = true;
  keys.left = err > A.deadband;
  keys.right = err < -A.deadband;
  keys.up = !pilot.done && speed < want - 0.5;
  keys.down = !pilot.done && speed > want + 1.5 && speed > 0.5;
  keys.handbrake = pilot.done;
  return keys;
}
