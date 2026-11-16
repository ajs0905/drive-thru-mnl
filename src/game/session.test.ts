/**
 * The game session on the real map, headless: every place and run resolves and routes,
 * and a whole delivery played by a fake car driving the route polyline pays into the
 * wallet.
 */
import { describe, expect, it } from 'vitest';
import bgcRaw from '../../public/data/bgc.json?raw';
import type { MapData } from '../map/types';
import { pointOnRoute } from '../routing/route';
import { EVENTS, parseEvents } from './events';
import { ARRIVE } from './run';
import { GameSession, type CarState, type Pose } from './session';
import type { SaveStorage } from './save';

const map = JSON.parse(bgcRaw) as MapData;
const memory = (): SaveStorage => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const car = (p: [number, number], heading: number, speed = 0): CarState => ({ p, heading, height: 0, speed, accel: 0, drifting: false, impacts: 0, impact: 0, crashing: false });

describe('events', () => {
  it('rejects broken files', () => {
    expect(() => parseEvents(null)).toThrow();
    expect(() => parseEvents({ version: 1, places: [], runs: [{ id: 'x', name: 'X', kind: 'courier', cargo: 'c', from: 'a', to: 'b' }] })).toThrow();
    expect(() => parseEvents({ ...EVENTS, places: [...EVENTS.places, EVENTS.places[0]] })).toThrow();
  });

  it('puts every place at a clear curb and gives every run a route of a sensible length', () => {
    const game = new GameSession(memory());
    game.setMap(map);
    expect(game.runs.map((r) => r.id)).toEqual(EVENTS.runs.map((r) => r.id));
    for (const def of EVENTS.places) expect(game.place(def.id), def.id).toBeDefined();
    for (const r of game.runs) {
      const plan = game.plan(r.id)!;
      expect(plan, r.id).not.toBeNull();
      expect(plan.route.length, r.id).toBeGreaterThan(500);
      expect(plan.route.length, r.id).toBeLessThan(4000);
      expect(plan.target).toBeGreaterThan(plan.route.time);
    }
  });
});

describe('a delivery, start to finish', () => {
  it('teleports to the pickup, counts down, follows the route and pays out', () => {
    const game = new GameSession(memory());
    game.setMap(map);
    const teleports: Pose[] = [];
    game.teleport = (pose) => teleports.push(pose);
    const run = game.runs[0];
    game.teleportStart(run.id);
    expect(teleports).toHaveLength(1);
    expect(game.run?.phase).toBe('intro');
    expect(game.holding).toBe(true);
    expect(game.blocking).toBe(false);
    const start = teleports[0];
    game.tick(car(start.p, start.heading), 1 / 60);
    game.begin();
    expect(game.holding).toBe(true);
    for (let t = 0; t <= ARRIVE.countdown + 0.1; t += 0.1) game.tick(car(start.p, start.heading), 0.1);
    expect(game.run?.phase).toBe('running');
    expect(game.gps?.kind).toBe('dropoff');
    // Drive the planned route at 15 m/s.
    const route = game.plan(run.id)!.route;
    for (let s = 0; s < route.length; s += 15 / 10) {
      const at = pointOnRoute(route, s);
      game.tick(car(at.p, at.heading, 15), 0.1);
    }
    const end = game.place(run.to)!;
    for (let t = 0; t < 1; t += 0.1) game.tick(car(end.p, end.heading), 0.1);
    expect(game.run?.phase).toBe('done');
    const net = game.run!.result!.receipt!.net;
    expect(net).toBeGreaterThan(0);
    expect(game.save.pesos).toBe(net);
    expect(game.save.best[run.id].time).toBeCloseTo(game.run!.time);
    expect(game.run!.passed).toBe(game.run!.checkpoints.length);
    game.closeResult();
    expect(game.run).toBeNull();
  });

  it('routes to the pickup with DRIVE THERE, re-plans when the car strays, and abandons cleanly', () => {
    const game = new GameSession(memory());
    game.setMap(map);
    const run = game.runs[1];
    const away = game.place(game.runs[0].to)!;
    game.tick(car(away.p, away.heading), 1 / 60);
    game.driveThere(run.id);
    expect(game.run?.phase).toBe('to-pickup');
    expect(game.gps?.kind).toBe('pickup');
    const first = game.gps!.route;
    // Off the route for a while: a new one from where the car is.
    const stray = game.place(game.runs[2].to)!;
    for (let t = 0; t < 2; t += 0.1) game.tick(car(stray.p, stray.heading, 10), 0.1);
    expect(game.gps!.route).not.toBe(first);
    game.abandon();
    expect(game.run).toBeNull();
    expect(game.gps).toBeNull();
  });
});
