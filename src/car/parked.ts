/**
 * Parked cars: the models, how often each shows up, their paint, and the rules for
 * which ones get physics and when a moved one goes back to its spot. Shared by the
 * pipeline (which places them), the renderer and the physics. No three.js here.
 *
 * Only the cars near the player are physics bodies (a pool, `PARKED.physicsRadius`);
 * the rest are drawn where they were parked. A car that gets hit and moved returns to
 * its spot once the player can't see it (an off-screen reset), so the street fills back
 * up without anything visibly teleporting.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import { yawForHeading } from './spawn';

export interface ParkedModel {
  /** Model name in public/models/parked-cars.glb. */
  name: string;
  /** Length, width (body, without mirrors) and height in meters. */
  size: [number, number, number];
  /** How often it's picked, relative to the others. */
  weight: number;
  /** False for cars that keep their own paint (taxis). */
  repaint: boolean;
}

/** Index in this list is what the map data stores (`ParkedCar.v`); only ever append. */
export const PARKED_MODELS: ParkedModel[] = [
  { name: 'sedan', size: [4.45, 1.9, 1.71], weight: 30, repaint: true },
  { name: 'hatchback', size: [4.34, 1.9, 1.71], weight: 22, repaint: true },
  { name: 'suv', size: [4.28, 1.9, 1.95], weight: 20, repaint: true },
  { name: 'pickup', size: [4.28, 1.9, 1.88], weight: 10, repaint: true },
  { name: 'van', size: [5.02, 1.9, 2.3], weight: 10, repaint: true },
  { name: 'taxi', size: [4.45, 1.9, 1.97], weight: 8, repaint: false },
];

/**
 * Paint colors (sRGB hex) and how common each is: Metro Manila's streets are mostly white,
 * silver, grey and black cars, with some reds and blues. Index is stored per car.
 */
export const PARKED_PAINTS: { hex: string; weight: number }[] = [
  { hex: '#e8e8e4', weight: 28 }, // white
  { hex: '#b9bcc0', weight: 18 }, // silver
  { hex: '#6b6f74', weight: 14 }, // grey
  { hex: '#1f2124', weight: 16 }, // black
  { hex: '#8a1c1c', weight: 7 }, // dark red
  { hex: '#23406e', weight: 7 }, // blue
  { hex: '#5a4636', weight: 4 }, // brown
  { hex: '#c9b48a', weight: 3 }, // beige
  { hex: '#2f5a3c', weight: 3 }, // green
];

export const PARKED = {
  /** Cars within this distance (m) of the player are physics bodies. */
  physicsRadius: 70,
  /** ...and leave the pool this much farther out, so cars at the edge don't flicker in and out. */
  physicsMargin: 15,
  /** A car counts as moved once it's this far (m) or this much turned (rad) from its spot. */
  movedBy: 0.25,
  turnedBy: 0.06,
  /** A moved car goes home after being out of sight this long (s) and nearly still (m/s). */
  hiddenFor: 1,
  stillBelow: 0.5,
  /** Mass (kg): a bit lighter than the player's car, so a hit shoves it. */
  mass: 1000,
  friction: 0.7,
} as const;

/** Picks an index by weight from a number in 0..1. */
export function pickWeighted(weights: number[], u: number): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let x = u * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

/** Has a car moved off its spot (position difference in m, turn in rad)? */
export function isMoved(offset: number, turn: number): boolean {
  return offset > PARKED.movedBy || Math.abs(turn) > PARKED.turnedBy;
}

/**
 * Should a moved car go back to its spot now? Only when neither where it is nor where it
 * goes back to is on screen, it's been that way for a moment, and it's nearly still.
 */
export function shouldReturn(hiddenSeconds: number, speed: number): boolean {
  return hiddenSeconds >= PARKED.hiddenFor && speed < PARKED.stillBelow;
}

/**
 * Which cars should be in the physics pool: those within the radius of the player, plus
 * those already in it that are still within the radius and margin (hysteresis), plus moved
 * ones still on screen (they can't vanish in view). Indices into `cars`.
 */
export function poolFor(
  cars: { p: [number, number] }[],
  player: [number, number],
  inPool: Set<number>,
  keep: (i: number) => boolean,
  near: (x: number, y: number, r: number) => Iterable<number>,
): Set<number> {
  const out = new Set<number>();
  const r = PARKED.physicsRadius;
  for (const i of near(player[0], player[1], r + PARKED.physicsMargin)) {
    const d = Math.hypot(cars[i].p[0] - player[0], cars[i].p[1] - player[1]);
    if (d <= r || (inPool.has(i) && d <= r + PARKED.physicsMargin)) out.add(i);
  }
  for (const i of inPool) if (!out.has(i) && keep(i)) out.add(i);
  return out;
}

/**
 * A parked car as a physics body, on its spot and asleep: origin on the ground (`groundY`,
 * three.js space) like the model, a box collider from just above the ground to about the
 * roofline. It wakes when something hits it.
 */
export function createParkedBody(
  rapier: typeof RAPIER,
  world: RAPIER.World,
  car: { p: [number, number]; rot: number; v: number },
  groundY: number,
) {
  const [l, w, h] = PARKED_MODELS[car.v].size;
  const yaw = yawForHeading(car.rot);
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.dynamic()
      .setTranslation(car.p[0], groundY, -car.p[1])
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setLinearDamping(0.3)
      .setAngularDamping(0.8)
      .setCanSleep(true),
  );
  const hy = (h * 0.85) / 2;
  world.createCollider(
    rapier.ColliderDesc.cuboid(w / 2, hy, l / 2)
      .setTranslation(0, hy + 0.01, 0)
      .setMass(PARKED.mass)
      .setFriction(PARKED.friction)
      .setRestitution(0.1),
    body,
  );
  body.sleep();
  return body;
}
