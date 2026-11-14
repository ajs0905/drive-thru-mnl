/**
 * Map QA for road surfaces: problems found by looking at junctions and crossings.
 *
 *  paving-hole      a small patch of ground or sidewalk completely surrounded by
 *                   road at a junction (gaps between pieces of asphalt). Found by
 *                   rasterizing what the renderer paves (ribbons, junction polygons,
 *                   gap discs) at 0.5 m around every junction and flood-filling
 *                   from the edge: whatever unpaved area the fill can't reach is a hole.
 *  junction-spike   a junction polygon corner far outside the roads meeting there
 *  zebra-overlap    two zebras overlapping, or a zebra inside a junction
 */
import { pointInRing, ringBounds } from '../src/geometry/polygon';
import { convexOverlap, zebraCorners } from '../src/geometry/zebra';
import type { Junction, MapData, Point } from '../src/map/types';
import { findHoles } from './paving';
import type { Issue } from './qa';

const key = (p: Point) => `${p[0]},${p[1]}`;

/** Rings whose bounding box contains the point (cheap index over junctions). */
function junctionIndex(junctions: Junction[], cell = 50) {
  const cells = new Map<string, number[]>();
  junctions.forEach((j, i) => {
    const b = ringBounds(j.ring);
    for (let x = Math.floor(b.minX / cell); x <= Math.floor(b.maxX / cell); x++) {
      for (let y = Math.floor(b.minY / cell); y <= Math.floor(b.maxY / cell); y++) {
        const k = `${x},${y}`;
        cells.set(k, [...(cells.get(k) ?? []), i]);
      }
    }
  });
  return (p: Point) => (cells.get(`${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`) ?? []).map((i) => junctions[i]);
}

export function roadIssues(map: MapData): Issue[] {
  const issues: Issue[] = [];
  const junctions = map.junctions ?? [];
  const near = junctionIndex(junctions);
  const covered = (p: Point) => near(p).some((j) => pointInRing(p, j.ring));

  // Widest road ending at each node, for the spike check.
  const widest = new Map<string, number>();
  for (const r of map.roads) {
    if (r.cls === 'path') continue;
    for (const p of [r.points[0], r.points[r.points.length - 1]]) widest.set(key(p), Math.max(widest.get(key(p)) ?? 0, r.w / 2));
  }

  for (const hole of findHoles(map)) {
    issues.push({ kind: 'paving-hole', at: hole.at, detail: `${hole.area.toFixed(1)} m²`, severity: hole.area });
  }

  // junction-spike: polygon corners far from every road end inside it.
  const endsIn = new Map<Junction, { p: Point; h: number }[]>();
  for (const [k, h] of widest) {
    const p = k.split(',').map(Number) as Point;
    for (const j of near(p)) if (!j.patch && pointInRing(p, j.ring)) endsIn.set(j, [...(endsIn.get(j) ?? []), { p, h }]);
  }
  for (const [j, list] of endsIn) {
    let worst = 0;
    let at = list[0].p;
    for (const v of j.ring) {
      const excess = Math.min(...list.map(({ p, h }) => Math.hypot(v[0] - p[0], v[1] - p[1]) - (3.5 * h + 2)));
      if (excess > worst) [worst, at] = [excess, v];
    }
    if (worst > 0) issues.push({ kind: 'junction-spike', at, detail: `${j.id} ${worst.toFixed(1)} m too far`, severity: worst });
  }

  // zebra-overlap: zebras on top of each other or inside a junction.
  const zebras = map.crossings ?? [];
  const corners = zebras.map((z) => zebraCorners(z));
  zebras.forEach((z, i) => {
    const overlapsZebra = zebras.some((o, k) => k < i && Math.hypot(o.c[0] - z.c[0], o.c[1] - z.c[1]) < 40 && convexOverlap(corners[i], corners[k]));
    const inJunction = covered(z.c);
    if (overlapsZebra || inJunction) {
      issues.push({ kind: 'zebra-overlap', at: z.c, detail: inJunction ? 'inside a junction' : 'overlaps another zebra', severity: 1 });
    }
  });

  return issues;
}

