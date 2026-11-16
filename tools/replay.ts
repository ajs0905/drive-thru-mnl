/**
 * Golden replays: `npm run replay` records them, the tests play them back.
 *
 * Each one is a cargo run driven headless by the autopilot (sim/autopilot.ts) in the real
 * physics with the map's collision, from the pickup's curb spot to the drop-off, recorded
 * as the keys held at each step plus where the car ended. tests/replay.test.ts plays them
 * again and fails if the car ends anywhere else: a change to the car's tuning, the physics
 * setup, the collision meshes or the map shows up there. When the change is meant, record
 * them again (and say why in the commit).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NO_KEYS } from '../src/car/controls';
import { GameSession } from '../src/game/session';
import type { MapData } from '../src/map/types';
import { drive, newPilot } from '../src/sim/autopilot';
import { createSim, startAt, stepSim } from '../src/sim/headless';
import { mapId, Recorder } from '../src/sim/replay';

/** The runs recorded: short ones the autopilot drives clean (it doesn't steer around things). */
const GOLDEN_RUNS = ['morning-parcels', 'fresh-produce', 'gallery-pieces'];

await RAPIER.init();
const map = JSON.parse(readFileSync('public/data/bgc.json', 'utf8')) as MapData;
const game = new GameSession(null);
game.setMap(map);
mkdirSync('tests/replays', { recursive: true });
for (const id of GOLDEN_RUNS) {
  const def = game.runs.find((r) => r.id === id);
  const plan = def && game.plan(id);
  const from = def && game.place(def.from);
  if (!def || !plan || !from) throw new Error(`no run ${id}`);
  const start = startAt(from.p, from.heading);
  const car = createSim(RAPIER, map, start);
  const rec = new Recorder(mapId(map), start);
  const to = game.place(def.to)!;
  const pilot = newPilot(plan.route, to);
  const keys = { ...NO_KEYS };
  // Up to three times the target, then a few seconds standing still at the end.
  for (let i = 0; i < plan.target * 3 * 60 && !pilot.done; i++) {
    drive(pilot, [car.x, car.y], car.heading, car.speed, keys);
    rec.step(keys);
    stepSim(RAPIER, car, keys);
  }
  if (!pilot.done) throw new Error(`${id}: the autopilot didn't finish`);
  // Standing at the drop-off a moment, so a playback can deliver (the run wants 0.8 s stopped).
  for (let i = 0; i < 90; i++) {
    drive(pilot, [car.x, car.y], car.heading, car.speed, keys);
    rec.step(keys);
    stepSim(RAPIER, car, keys);
  }
  const p = car.body.translation();
  const replay = rec.finish({ x: p.x, y: p.y, z: p.z, speed: car.speed });
  writeFileSync(`tests/replays/${id}.json`, JSON.stringify(replay) + '\n');
  console.log(`${id}: ${rec.steps} steps (${(rec.steps / 60).toFixed(1)} s), ${replay.keys.split(',').length} key runs, ended ${Math.hypot(car.x - game.place(def.to)!.p[0], car.y - game.place(def.to)!.p[1]).toFixed(1)} m from the drop-off`);
}
