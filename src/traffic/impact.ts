/**
 * What a bump does to a traffic car. Traffic cars in the flow are kinematic bodies (they
 * follow the simulation exactly, so the physics can't push them), which means the bump
 * itself only bounces the car that did the hitting. So when a contact shows up, the hit
 * car is handed to the physics as a dynamic body and given the impulse a collision
 * between two cars of these masses would have given it, at the point they touched:
 *
 * - along the contact normal (the face of the hit car's box that was struck), enough to
 *   share the closing speed by the masses with a little bounce (`restitution`);
 * - plus some drag along the face (`drag`), so a sideswipe pulls the car along;
 * - applied at the contact point, so a hit off the middle also turns it: a tap on a rear
 *   corner kicks the nose the other way, a hit square on the back just shoves it.
 *
 * The car doing the hitting gets the opposite impulse (its own bounce off a kinematic
 * body was a wall's). Plain math on the ground plane (three.js x and z), no physics
 * engine: the scene applies the result.
 */

export type Vec2 = [number, number];

export const IMPACT = {
  /** How bouncy a car-to-car hit is (0 to 1). */
  restitution: 0.2,
  /** Share of the sliding speed along the struck face passed on as drag, at most this share of the push plus `dragFloor` N·s. */
  drag: 0.25,
  dragCap: 0.6,
  dragFloor: 600,
};

export interface Hit {
  /** The struck car's center and its forward direction (unit) on the ground plane, and its half length and half width (m). */
  center: Vec2;
  forward: Vec2;
  half: Vec2;
  /** Where they touched (ground plane). */
  point: Vec2;
  /** Velocities just before (m/s) and masses (kg): the car doing the hitting, and the struck one. */
  hitterVel: Vec2;
  targetVel: Vec2;
  hitterMass: number;
  targetMass: number;
}

export interface HitResult {
  /** Outward normal of the struck face (toward the hitter). */
  normal: Vec2;
  /** Impulse on the struck car (N·s); the hitter gets the opposite. */
  impulse: Vec2;
  /** Closing speed along the normal (m/s, positive when they were coming together). */
  closing: number;
}

/** The struck face's outward normal at a point: whichever face of the box the point is closest to, relative to the box's size. */
export function faceNormal(center: Vec2, forward: Vec2, half: Vec2, point: Vec2): Vec2 {
  const [dx, dz] = [point[0] - center[0], point[1] - center[1]];
  // Side direction: forward turned a quarter (either way: only the sign of the projection matters).
  const side: Vec2 = [forward[1], -forward[0]];
  const along = dx * forward[0] + dz * forward[1];
  const across = dx * side[0] + dz * side[1];
  if (Math.abs(along) / half[0] >= Math.abs(across) / half[1]) {
    const s = Math.sign(along) || 1;
    return [forward[0] * s, forward[1] * s];
  }
  const s = Math.sign(across) || 1;
  return [side[0] * s, side[1] * s];
}

export function impactOf(h: Hit): HitResult {
  const normal = faceNormal(h.center, h.forward, h.half, h.point);
  const rel: Vec2 = [h.hitterVel[0] - h.targetVel[0], h.hitterVel[1] - h.targetVel[1]];
  // The hitter comes in against the normal.
  const closing = Math.max(0, -(rel[0] * normal[0] + rel[1] * normal[1]));
  const mass = (h.hitterMass * h.targetMass) / (h.hitterMass + h.targetMass);
  const push = (1 + IMPACT.restitution) * mass * closing;
  // Sliding along the face: drag in the hitter's direction of travel along it.
  const n = rel[0] * normal[0] + rel[1] * normal[1];
  const slide: Vec2 = [rel[0] - n * normal[0], rel[1] - n * normal[1]];
  const slideSpeed = Math.hypot(...slide);
  const drag = slideSpeed > 1e-6 ? Math.min(IMPACT.drag * mass * slideSpeed, IMPACT.dragCap * push + IMPACT.dragFloor) : 0;
  const impulse: Vec2 = [-normal[0] * push + (slideSpeed > 1e-6 ? (slide[0] / slideSpeed) * drag : 0), -normal[1] * push + (slideSpeed > 1e-6 ? (slide[1] / slideSpeed) * drag : 0)];
  return { normal, impulse, closing };
}

/** The turn an impulse at a point gives a body (the vertical part of r x J, three.js axes: positive turns from +x toward -z, i.e. counterclockwise seen from above). */
export function yawOf(center: Vec2, point: Vec2, impulse: Vec2): number {
  const [rx, rz] = [point[0] - center[0], point[1] - center[1]];
  return rz * impulse[0] - rx * impulse[1];
}

/** The closest point of a car's box (ground plane) to a point: where it was touched when the contact gives no point of its own. */
export function closestOnBox(center: Vec2, forward: Vec2, half: Vec2, p: Vec2): Vec2 {
  const side: Vec2 = [forward[1], -forward[0]];
  const [dx, dz] = [p[0] - center[0], p[1] - center[1]];
  const along = Math.max(-half[0], Math.min(half[0], dx * forward[0] + dz * forward[1]));
  const across = Math.max(-half[1], Math.min(half[1], dx * side[0] + dz * side[1]));
  return [center[0] + forward[0] * along + side[0] * across, center[1] + forward[1] * along + side[1] * across];
}
