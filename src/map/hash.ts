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

/** Small seeded generator (mulberry32) from a string id: the same id always gives the same sequence. */
export function seeded(id: string): () => number {
  let a = Math.floor(idUnit(id) * 4294967296);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
