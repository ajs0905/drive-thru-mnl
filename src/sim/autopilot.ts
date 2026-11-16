/**
 * A driver for headless runs: follows a route polyline with the same on/off keys a player
 * has. Pure pursuit steering (aim at a point a speed-dependent distance ahead on the
 * route), a target speed that drops before bends (the heading change over the next 35 m),
 * and braking to a stop at the end. Given a stop at the curb (a run's bay), the route's last
 * stretch bends gently into it. Used to record replays and to drive the cargo runs in the
 * real physics in tests; the police will want something like it too.
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
  /** Pulling in to a curb stop: from this far (m) before the route's end, and a stretch (m) past the stop, straight along the curb. */
  pullIn: 14,
  settle: 4,
};

export interface Pilot {
  route: Route;
  s: number;
  done: boolean;
}

/** A pilot for a route; with `stop`, the route's end swapped for a pull-in to that spot, facing `heading` (a run's bay). */
export function newPilot(route: Route, stop?: { p: Point; heading: number }): Pilot {
  return { route: stop ? pullInTo(route, stop) : route, s: 0, done: false };
}

/** The route cut `pullIn` meters before its end, then to the stop and a little along the curb past it, ending at the stop. */
function pullInTo(route: Route, stop: { p: Point; heading: number }): Route {
  const cut = Math.max(0, route.length - AUTOPILOT.pullIn);
  const points: Point[] = [];
  for (let i = 0; i < route.points.length && route.acc[i] < cut; i++) points.push(route.points[i]);
  points.push(pointOnRoute(route, cut).p);
  // Lined up along the curb a few meters before the stop, then the stop itself.
  const [c, sn] = [Math.cos(stop.heading), Math.sin(stop.heading)];
  points.push([stop.p[0] - c * AUTOPILOT.settle, stop.p[1] - sn * AUTOPILOT.settle], stop.p);
  const acc = [0];
  for (let i = 1; i < points.length; i++) acc.push(acc[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return { ...route, points, acc, length: acc[acc.length - 1] };
}

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
