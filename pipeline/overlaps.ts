/**
 * Buildings inside other buildings. OSM sometimes has the same building twice (an old
 * outline and a new one), a construction site outline still drawn around the finished
 * tower, or a building mapped inside a bigger one around it. Drawn as is, the inner one
 * is either hidden (wasted triangles, and walls that flicker where they touch the outer
 * walls) or pokes out of a box that isn't really there.
 *
 * For every pair where most of one footprint (`OVERLAP.inside`) lies inside the other:
 * - the inner one goes if it's hidden: it starts no lower and ends no higher than the
 *   outer one (duplicates, and smaller buildings inside a taller block);
 * - a construction site outline goes if the building inside it stands taller (it's built).
 * Anything else stays: a tower rising out of its podium, a spire on a roof, a shop under a
 * raised building.
 */
import { pointInRing, polygonArea, ringBounds } from '../src/geometry/polygon';
import type { Building, Point, Ring } from '../src/map/types';

export const OVERLAP = {
  /** Share of the smaller footprint inside the bigger one that counts as "inside". */
  inside: 0.9,
  /** About this many sample points per footprint when measuring the share. */
  samples: 1600,
  /** Height slack (m) when comparing tops and bottoms. */
  slack: 0.3,
};

const insideBuilding = (p: Point, rings: Ring[]) => pointInRing(p, rings[0]) && !rings.slice(1).some((h) => pointInRing(p, h));

/** Share of `inner`'s footprint that lies inside `outer` (sampled on a grid, 0..1). */
export function insideShare(inner: Ring[], outer: Ring[]): number {
  const b = ringBounds(inner[0]);
  const step = Math.max(0.25, Math.sqrt(((b.maxX - b.minX) * (b.maxY - b.minY)) / OVERLAP.samples));
  let [total, hit] = [0, 0];
  for (let x = b.minX + step / 2; x < b.maxX; x += step) {
    for (let y = b.minY + step / 2; y < b.maxY; y += step) {
      if (!insideBuilding([x, y], inner)) continue;
      total++;
      if (insideBuilding([x, y], outer)) hit++;
    }
  }
  return total ? hit / total : 0;
}

export type OverlapReason = 'hidden' | 'construction-outline';

/** Pairs (inner, outer index) where `inner` sits inside `outer`, and why one of them should go (if any). */
export function nestedBuildings(buildings: Building[]): { inner: number; outer: number; drop?: { index: number; reason: OverlapReason } }[] {
  const boxes = buildings.map((b) => ringBounds(b.rings[0]));
  const areas = buildings.map((b) => polygonArea(b.rings));
  const cell = 50;
  const grid = new Map<string, number[]>();
  boxes.forEach((bb, i) => {
    for (let gx = Math.floor(bb.minX / cell); gx <= Math.floor(bb.maxX / cell); gx++)
      for (let gy = Math.floor(bb.minY / cell); gy <= Math.floor(bb.maxY / cell); gy++) {
        const k = `${gx},${gy}`;
        const list = grid.get(k) ?? [];
        list.push(i);
        grid.set(k, list);
      }
  });
  const out: ReturnType<typeof nestedBuildings> = [];
  boxes.forEach((bb, i) => {
    const near = new Set<number>();
    for (let gx = Math.floor(bb.minX / cell); gx <= Math.floor(bb.maxX / cell); gx++)
      for (let gy = Math.floor(bb.minY / cell); gy <= Math.floor(bb.maxY / cell); gy++) for (const j of grid.get(`${gx},${gy}`) ?? []) if (j > i) near.add(j);
    for (const j of near) {
      const o = boxes[j];
      if (bb.minX >= o.maxX || o.minX >= bb.maxX || bb.minY >= o.maxY || o.minY >= bb.maxY) continue;
      // The smaller one is the inner one (equal footprints: either way round).
      const [inner, outer] = areas[i] <= areas[j] ? [i, j] : [j, i];
      if (insideShare(buildings[inner].rings, buildings[outer].rings) < OVERLAP.inside) continue;
      const [a, b] = [buildings[inner], buildings[outer]];
      const [aLow, bLow] = [a.minH ?? 0, b.minH ?? 0];
      let drop: { index: number; reason: OverlapReason } | undefined;
      if (aLow >= bLow - OVERLAP.slack && a.h <= b.h + OVERLAP.slack) drop = { index: inner, reason: 'hidden' };
      else if (b.type === 'construction' && a.h > b.h) drop = { index: outer, reason: 'construction-outline' };
      out.push({ inner, outer, ...(drop && { drop }) });
    }
  });
  return out;
}

/** The buildings without the hidden and leftover ones (see the top of this file). */
export function dropNestedBuildings(buildings: Building[]): { buildings: Building[]; hidden: number; outlines: number } {
  const gone = new Map<number, OverlapReason>();
  for (const n of nestedBuildings(buildings)) if (n.drop && !gone.has(n.drop.index)) gone.set(n.drop.index, n.drop.reason);
  const count = (r: OverlapReason) => [...gone.values()].filter((v) => v === r).length;
  return { buildings: buildings.filter((_, i) => !gone.has(i)), hidden: count('hidden'), outlines: count('construction-outline') };
}
