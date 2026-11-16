/**
 * A moving car's shadow from the sun, drawn every frame as a soft patch on the ground
 * (scene/carModel.ts, scene/Traffic.tsx) rather than in the sun's shadow map: that map is
 * only re-rendered every few frames while the camera moves (scene/Sun.tsx), so a car
 * moving through it would leave its shadow behind.
 *
 * The patch is the car's footprint swept along the ground away from the sun, as far as the
 * car's height throws it, as a box in the car's own frame (close enough for a car's shape):
 * its center moves half the throw, and it grows by the throw along each axis. Three.js
 * axes: +y up; the car's +z is forward and +x its left, turned by `yaw` about +y.
 */

export const SUN_SHADOW = {
  /** Height (m) whose shadow the patch reaches: a little under the roof (the cabin is narrower than the body). */
  height: 1.25,
  /** How much of the throw it covers: the far end of the shadow is the thin cabin, so it doesn't need all of it. */
  reach: 0.85,
};

export interface SunShadowPose {
  /** Offset of the patch's center from the car's (world x and z, m), and its size in the car's frame (m). */
  dx: number;
  dz: number;
  width: number;
  length: number;
}

/** `sun`: unit vector toward the sun (three.js space). */
export function sunShadowPose(sun: { x: number; y: number; z: number }, yaw: number, width: number, length: number, out: SunShadowPose = { dx: 0, dz: 0, width: 0, length: 0 }): SunShadowPose {
  const k = (SUN_SHADOW.height / Math.max(0.15, sun.y)) * SUN_SHADOW.reach;
  // The throw, along the ground, away from the sun.
  const [tx, tz] = [-sun.x * k, -sun.z * k];
  // In the car's frame: its left (+x) is (cos yaw, -sin yaw), forward (+z) is (sin yaw, cos yaw).
  const across = tx * Math.cos(yaw) - tz * Math.sin(yaw);
  const along = tx * Math.sin(yaw) + tz * Math.cos(yaw);
  out.dx = tx / 2;
  out.dz = tz / 2;
  out.width = width + Math.abs(across);
  out.length = length + Math.abs(along);
  return out;
}
