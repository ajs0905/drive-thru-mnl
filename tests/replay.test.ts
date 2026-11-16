/**
 * Replays (src/sim): the format, determinism, and the golden replays in tests/replays
 * played back in the real physics on the real map. A golden replay that now ends
 * somewhere else means the car's tuning, the physics setup, the collision meshes or the
 * map changed what the same keys do; if that's meant, record them again with
 * `npm run replay`.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/session';
import { newRun, startCountdown, stepRun, type CarSignals, type RunState } from '../src/game/run';
import type { MapData } from '../src/map/types';
import { playReplay } from '../src/sim/headless';
import { decodeKeys, encodeKeys, keysOf, mapId, maskOf, type Replay } from '../src/sim/replay';

const map = JSON.parse(readFileSync('public/data/bgc.json', 'utf8')) as MapData;
const replays = readdirSync('tests/replays')
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ id: f.replace('.json', ''), replay: JSON.parse(readFileSync(`tests/replays/${f}`, 'utf8')) as Replay }));

beforeAll(async () => {
  await RAPIER.init();
});

describe('the replay format', () => {
  it('round-trips keys through masks and run-length encoding', () => {
    const k = { up: true, down: false, left: true, right: false, handbrake: true };
    expect(keysOf(maskOf(k))).toEqual(k);
    const masks = [0, 0, 0, 1, 1, 5, 0, 31, 31];
    expect(encodeKeys(masks)).toBe('3*0,2*1,1*5,1*0,2*31');
    expect([...decodeKeys(encodeKeys(masks))]).toEqual(masks);
    expect([...decodeKeys('')]).toEqual([]);
    expect(() => decodeKeys('3*0,x')).toThrow();
    expect(() => decodeKeys('1*99')).toThrow();
  });
});

describe('golden replays', () => {
  it('has some to play', () => {
    expect(replays.length).toBeGreaterThan(0);
  });

  for (const { id, replay } of replays) {
    it(`${id}: recorded on this map, ends where it ended, the same every time`, () => {
      expect(replay.map, 'the map changed since this replay was recorded: npm run replay').toBe(mapId(map));
      const a = playReplay(RAPIER, map, replay).body.translation();
      const b = playReplay(RAPIER, map, replay).body.translation();
      // Deterministic: two playbacks agree exactly.
      expect([b.x, b.y, b.z]).toEqual([a.x, a.y, a.z]);
      const end = replay.end!;
      expect(Math.hypot(a.x - end.x, a.y - end.y, a.z - end.z), 'the same keys now end elsewhere: npm run replay if that is meant').toBeLessThan(0.05);
    });
  }

  it('delivers a cargo run in the real physics, cargo intact', () => {
    const golden = replays.find((r) => r.id === 'morning-parcels');
    expect(golden).toBeDefined();
    const game = new GameSession(null);
    game.setMap(map);
    const def = game.runs.find((r) => r.id === 'morning-parcels')!;
    const plan = game.plan(def.id)!;
    let run: RunState = newRun(def, { pickup: game.place(def.from)!.p, dropoff: game.place(def.to)!.p, meters: plan.route.length, target: plan.target, checkpoints: [], atPickup: true });
    run = startCountdown(run, { impacts: 0 });
    run = stepRun(run, { p: game.place(def.from)!.p, speed: 0, accel: 0, drifting: false, impacts: 0, impact: 0, crashing: false }, 3.1).state;
    expect(run.phase).toBe('running');
    const sig: CarSignals = { p: [0, 0], speed: 0, accel: 0, drifting: false, impacts: 0, impact: 0, crashing: false };
    playReplay(RAPIER, map, golden!.replay, (car) => {
      Object.assign(sig, { p: [car.x, car.y], speed: car.speed, accel: car.state.accel.forward, drifting: car.state.drifting, impacts: car.state.impacts, impact: car.state.impact, crashing: car.state.crashing });
      run = stepRun(run, sig, 1 / 60).state;
    });
    expect(run.phase).toBe('done');
    expect(run.time).toBeLessThan(run.target);
    expect(run.integrity).toBeGreaterThan(90);
    expect(run.result?.receipt?.net).toBeGreaterThan(0);
  });
});
