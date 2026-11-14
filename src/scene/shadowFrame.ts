/** Where the sun's shadow map goes: a square around the camera's focus, in whole texels. */

/** Half-size of the shadowed square for a camera this far from what it looks at. */
export function shadowHalfSize(distance: number): number {
  return Math.min(1400, Math.max(120, distance * 0.8));
}

/** Snaps a coordinate to the shadow map's texel grid. */
export function snapToTexel(v: number, half: number, mapSize: number): number {
  const texel = (2 * half) / mapSize;
  return Math.round(v / texel) * texel;
}
