/**
 * FNV-1a hash of a string mapped to [0, 1). Deterministic across runs and machines,
 * used for per-building variation (height, color) that stays the same every build.
 */
export function idUnit(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}
