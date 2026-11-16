/**
 * Steps the game session (game/session.ts) once per frame while driving, with what the
 * car reported to the drive session, and holds the car still during a run's countdown.
 * Paused (menus, the big map, a run's intro or result), the game's clock stops too.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import type { CarState, GameSession } from '../game/session';
import type { DriveSession } from './driveSession';

/** The car's reported height is its body's (three.js y); the road under it is about this much lower (m). */
const BODY_ABOVE_ROAD = 0.6;

export function RunDriver({ game, session, paused }: { game: GameSession; session: DriveSession; paused: boolean }) {
  const car = useMemo<CarState>(() => ({ p: [0, 0], heading: 0, height: 0, speed: 0, accel: 0, drifting: false, impacts: 0, impact: 0, crashing: false }), []);
  useFrame((_, dt) => step(game, session, car, paused, dt));
  return null;
}

/** One frame: the car's report into the game's terms, the game stepped, the hold set. */
function step(game: GameSession, session: DriveSession, car: CarState, paused: boolean, dt: number) {
  session.setHold(game.holding);
  const c = session.car;
  if (paused || !c.placed) return;
  car.p[0] = c.x;
  car.p[1] = c.y;
  car.heading = c.heading;
  car.height = Math.max(0, c.height - BODY_ABOVE_ROAD);
  car.speed = c.speed;
  car.accel = c.accel;
  car.drifting = c.drifting;
  car.impacts = c.impacts;
  car.impact = c.impact;
  car.crashing = c.crashing;
  // A long gap (a slow frame) isn't time to count against the run.
  game.tick(car, Math.min(dt, 0.1));
  session.setHold(game.holding);
}
