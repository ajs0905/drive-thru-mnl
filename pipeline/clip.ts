/**
 * Crops the map to the playable area plus a scenery ring around it.
 *
 *   inside the polygon          -> playable (drivable, collidable later)
 *   within `margin` m outside   -> scenery (rendered as backdrop only)
 *   farther out                 -> dropped
 *
 * Overpass returns whole ways and relations that touch the export box, so the raw
 * BGC export reaches about 11 km wide. This step brings it back to what we draw.
 */
import {
  clipPolylineToRect,
  clipRingToRect,
  distanceToRing,
  pointInRing,
  ringArea,
  segmentDistanceToRing,
  ringBounds,
  vertexCentroid,
  type Rect,
} from '../src/geometry/polygon';
import type { Area, Building, MapData, Point, Ring, Road } from '../src/map/types';
import { computeBounds } from './extract';

export type Zone = 'inside' | 'ring' | 'out';

export function zoneOf(p: Point, playable: Ring, margin: number): Zone {
  if (pointInRing(p, playable)) return 'inside';
  return distanceToRing(p, playable) <= margin ? 'ring' : 'out';
}

/**
 * Splits a polyline into runs of consecutive segments that pass `keepSegment`.
 * Working per segment (not per point) matters: a long straight segment can pass
 * right through the area with both of its end points far outside it.
 */
export function trimPolyline(points: Point[], keepSegment: (a: Point, b: Point) => boolean): Point[][] {
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    if (keepSegment(points[i], points[i + 1])) {
      if (run.length === 0) run.push(points[i]);
      run.push(points[i + 1]);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}

/** True if any part of segment ab is inside the polygon or within `margin` of it. */
export function segmentNear(a: Point, b: Point, playable: Ring, margin: number): boolean {
  return pointInRing(a, playable) || pointInRing(b, playable) || segmentDistanceToRing(a, b, playable) <= margin;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const roundRing = (ring: Ring): Ring => ring.map(([x, y]) => [round2(x), round2(y)]);

const expand = (r: Rect, m: number): Rect => ({
  minX: r.minX - m,
  minY: r.minY - m,
  maxX: r.maxX + m,
  maxY: r.maxY + m,
});

export function clipToPlayable(map: MapData, playable: Ring, margin = 300): MapData {
  if (playable.length < 3) throw new RangeError('Playable area needs at least 3 points');

  const zone = (p: Point) => zoneOf(p, playable, margin);

  // Buildings: decided by their center.
  const buildings: Building[] = [];
  let droppedBuildings = 0;
  for (const b of map.buildings) {
    const z = zone(vertexCentroid(b.rings[0]));
    if (z === 'out') {
      droppedBuildings++;
      continue;
    }
    const { scenery: _drop, ...rest } = b;
    buildings.push(z === 'ring' ? { ...rest, scenery: true } : rest);
  }

  const box = expand(ringBounds(playable), margin);

  // Roads: keep the parts that are inside or in the ring, then trim the ends to the box.
  const roads: Road[] = [];
  let droppedRoads = 0;
  for (const r of map.roads) {
    const runs = trimPolyline(r.points, (a, b) => segmentNear(a, b, playable, margin))
      .flatMap((run) => clipPolylineToRect(run, box))
      .map((run) => run.map(([x, y]): Point => [round2(x), round2(y)]));
    if (runs.length === 0) {
      droppedRoads++;
      continue;
    }
    runs.forEach((points, k) => {
      const { scenery: _drop, ...rest } = r;
      const playableRun = points.some((p, k) => k > 0 && segmentNear(points[k - 1], p, playable, 0));
      roads.push({
        ...rest,
        id: runs.length > 1 ? `${r.id}~${k}` : r.id,
        ...(!playableRun && { scenery: true as const }),
        points,
      });
    });
  }

  // Areas: clip to the same box. Land-use relations can be km wide.
  const areas: Area[] = [];
  let droppedAreas = 0;
  for (const a of map.areas) {
    const outer = roundRing(clipRingToRect(a.rings[0], box));
    if (outer.length < 3 || ringArea(outer) < 1) {
      droppedAreas++;
      continue;
    }
    const holes = a.rings
      .slice(1)
      .map((h) => roundRing(clipRingToRect(h, box)))
      .filter((h) => h.length >= 3 && ringArea(h) >= 1);
    areas.push({ ...a, rings: [outer, ...holes] });
  }

  const sceneryBuildings = buildings.filter((b) => b.scenery).length;
  return {
    ...map,
    playable,
    bounds: computeBounds(roads, buildings, areas),
    roads,
    buildings,
    areas,
    stats: {
      ...map.stats,
      roads: roads.length,
      buildings: buildings.length,
      areas: areas.length,
      clip: {
        marginMeters: margin,
        playableBuildings: buildings.length - sceneryBuildings,
        sceneryBuildings,
        droppedBuildings,
        droppedRoads,
        droppedAreas,
      },
    },
  };
}
