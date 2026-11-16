import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import bgcRaw from '../../public/data/bgc.json?raw';
import { PARKED_MODELS, PARKED_PAINTS } from '../car/parked';
import { yawForHeading } from '../car/spawn';
import type { MapData } from '../map/types';
import { buildRoadGraph } from '../routing/graph';
import { parkingRoom, TrafficSim, type Agent } from '../traffic/sim';
import { stepTraffic, trafficBodies } from './trafficBodies';

beforeAll(async () => {
  await RAPIER.init();
});

const map = JSON.parse(bgcRaw) as MapData;
const graph = buildRoadGraph(map);
const room = parkingRoom(map.roads, map.parked ?? []);
const GROUND = 0.2;

/**
 * A world with flat ground, the traffic around a spot on the map, and a box for the
 * player's car (the sedan's size and mass). Returns a traffic car on a long straight
 * stretch, moving, with the player parked well off to the side.
 */
function setup(seed: string) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(3000, 0.5, 3000).setTranslation(0, GROUND - 0.5, 0).setFriction(0.8));
  const player = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, GROUND + 0.1, 0).setCanSleep(false));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.95, 0.6, 2.2).setTranslation(0, 0.6, 0).setMass(1200).setFriction(0.5), player);
  const sim = new TrafficSim(graph, { count: 12, models: PARKED_MODELS.map((m) => ({ size: [m.size[0], m.size[1]], weight: m.weight })), paints: PARKED_PAINTS.map((p) => p.weight), room, seed });
  const bodies = trafficBodies();
  const step = () => {
    stepTraffic(sim, bodies, world, RAPIER, player);
    world.step();
  };
  // Let traffic fill in around a spot in the middle of BGC, the player out of the way.
  const spot: [number, number] = [0, 0];
  player.setTranslation({ x: spot[0], y: GROUND + 0.1, z: -spot[1] }, true);
  for (let i = 0; i < 240; i++) step();
  const target = sim.agents.find((a) => {
    const e = graph.edges[a.edge];
    return !a.knocked && a.v > 4 && !e.roundabout && a.s > 25 && e.length - a.s > 50 && Math.abs(a.steer) < 0.03 && a.z < 0.1;
  });
  return { world, player, sim, bodies, step, target };
}

/** Puts the player's box beside or behind a traffic car (`along` m ahead of its center, `right` m to its right) moving with it, plus a push (m/s, forward and to the left). */
function aim(player: RAPIER.RigidBody, a: Agent, along: number, right: number, forward: number, left: number) {
  const [c, s] = [Math.cos(a.heading), Math.sin(a.heading)];
  // Map: forward (c, s), right (s, -c). Three.js: x = map x, z = -map y.
  const [mx, my] = [a.x + c * along + s * right, a.y + s * along - c * right];
  const yaw = yawForHeading(a.heading);
  player.setTranslation({ x: mx, y: GROUND + 0.02, z: -my }, true);
  player.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
  const [vx, vy] = [c * (a.v + forward) - s * left, s * (a.v + forward) + c * left];
  player.setLinvel({ x: vx, y: 0, z: -vy }, true);
  player.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

const turned = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('bumping traffic', () => {
  it('spins a car tapped on its rear quarter, the nose swinging away from the side it was hit', () => {
    const { player, bodies, step, target } = setup('pit');
    expect(target).toBeDefined();
    const a = target!;
    const heading = a.heading;
    // From its right, at the rear quarter, closing at 5 m/s sideways.
    aim(player, a, -1.6, 2.4, 0, 5);
    let spin = 0;
    for (let i = 0; i < 60 * 1.5; i++) {
      step();
      const b = bodies.map.get(a.id);
      if (a.knocked && b) spin = Math.max(spin, Math.abs(b.angvel().y));
    }
    expect(a.knocked).toBe(true);
    expect(spin).toBeGreaterThan(0.5);
    // Hit on the right at the back: the tail goes left, the nose turns right (clockwise on the map: heading goes down).
    const d = Math.atan2(Math.sin(a.heading - heading), Math.cos(a.heading - heading));
    expect(d).toBeLessThan(-0.3);
  });

  it('shoves a car hit square from behind along the road, hardly turning it, and puts it back in the flow once it settles', () => {
    const { player, bodies, step, target } = setup('rear');
    const a = target!;
    const heading = a.heading;
    const speed = a.v;
    // Right behind it, 6 m/s faster.
    aim(player, a, -(a.len / 2 + 2.3), 0, 6, 0);
    let fastest = 0;
    for (let i = 0; i < 60; i++) {
      step();
      const b = bodies.map.get(a.id);
      if (a.knocked && b) fastest = Math.max(fastest, Math.hypot(b.linvel().x, b.linvel().z));
    }
    expect(a.knocked).toBe(true);
    expect(fastest).toBeGreaterThan(speed + 1.5);
    expect(turned(a.heading, heading)).toBeLessThan(0.12);
    // The player's car didn't bounce back off it as off a wall: still going forward.
    const pv = player.linvel();
    expect(pv.x * Math.cos(heading) - pv.z * Math.sin(heading)).toBeGreaterThan(0);
    // The player stops and backs off; the car rolls to a rest and drives on.
    player.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const pt = player.translation();
    player.setTranslation({ x: pt.x - Math.cos(heading) * 15, y: pt.y, z: pt.z + Math.sin(heading) * 15 }, true);
    for (let i = 0; i < 60 * 12 && a.knocked; i++) {
      player.setLinvel({ x: 0, y: 0, z: 0 }, true);
      step();
    }
    expect(a.knocked).toBe(false);
    expect(bodies.map.get(a.id)?.isKinematic()).toBe(true);
    expect(bodies.loose.has(a.id)).toBe(false);
  });
});
