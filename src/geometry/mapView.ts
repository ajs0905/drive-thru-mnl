/**
 * The map as the HUD draws it in 2D (the minimap and the big map, ui/mapCanvas.ts):
 * roads and buildings bucketed into grid cells so a view only touches what's in it, street
 * names to label, and the name of the street at a point (the HUD's street sign).
 */
import type { MapData, Point, Road } from '../map/types';
import { distanceToSegment, pointInRing } from './polygon';
import { SegmentGrid } from './spatialGrid';

export type MapRoadKind = 'major' | 'minor' | 'service';

export interface MapViewData {
  /** Roads as polylines (map space), widest kinds last so they draw on top. */
  roads: { kind: MapRoadKind; w: number; points: Point[]; raised: boolean }[];
  buildings: Point[][];
  edge: Point[];
  /** Indices into `roads` and `buildings` per grid cell. */
  cells: Map<string, { roads: number[]; buildings: number[] }>;
  cellSize: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** One label per named street: where and at what angle (radians, map space) to write it. */
  labels: { name: string; p: Point; angle: number; length: number; kind: MapRoadKind }[];
}

const ORDER: Record<MapRoadKind, number> = { service: 0, minor: 1, major: 2 };
const CELL = 100;
const key = (cx: number, cy: number) => `${cx},${cy}`;

const length = (pts: Point[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

export function mapViewData(map: Pick<MapData, 'roads' | 'buildings' | 'playable' | 'bounds'>): MapViewData {
  const roads = map.roads
    .filter((r): r is Road & { cls: MapRoadKind } => r.cls !== 'path')
    .map((r) => ({ kind: r.cls, w: r.w, points: r.points, raised: !!r.z?.some((z) => z > 1) }))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || Number(a.raised) - Number(b.raised));
  const buildings = map.buildings.filter((b) => (b.minH ?? 0) < 2.5).map((b) => b.rings[0]);
  const cells = new Map<string, { roads: number[]; buildings: number[] }>();
  const add = (pts: Point[], i: number, what: 'roads' | 'buildings') => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of pts) [x0, y0, x1, y1] = [Math.min(x0, p[0]), Math.min(y0, p[1]), Math.max(x1, p[0]), Math.max(y1, p[1])];
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const k = key(cx, cy);
        const cell = cells.get(k) ?? { roads: [], buildings: [] };
        cell[what].push(i);
        cells.set(k, cell);
      }
  };
  roads.forEach((r, i) => add(r.points, i, 'roads'));
  buildings.forEach((b, i) => add(b, i, 'buildings'));

  // Labels: per street name, on its longest piece, at the middle, along the road.
  const byName = new Map<string, { total: number; best: Road; bestLength: number }>();
  for (const r of map.roads) {
    if (r.cls === 'path' || !r.name || r.scenery) continue;
    const l = length(r.points);
    const entry = byName.get(r.name) ?? { total: 0, best: r, bestLength: -1 };
    entry.total += l;
    if (l > entry.bestLength) [entry.best, entry.bestLength] = [r, l];
    byName.set(r.name, entry);
  }
  const labels: MapViewData['labels'] = [];
  for (const [name, { total, best }] of byName) {
    const pts = best.points;
    const half = length(pts) / 2;
    let walked = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      if (walked + seg >= half || i + 2 === pts.length) {
        const t = seg ? Math.min(1, (half - walked) / seg) : 0;
        const p: Point = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
        let angle = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
        // Never upside down.
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
        // Outside the drivable edge the maps show nothing, names included.
        if (!map.playable || map.playable.length < 3 || pointInRing(p, map.playable)) labels.push({ name, p, angle, length: total, kind: best.cls as MapRoadKind });
        break;
      }
      walked += seg;
    }
  }
  labels.sort((a, b) => ORDER[b.kind] - ORDER[a.kind] || b.length - a.length);
  return { roads, buildings, edge: map.playable ?? [], cells, cellSize: CELL, bounds: map.bounds, labels };
}

/** Indices of the roads and buildings in cells overlapping a box (map space). */
export function inView(data: MapViewData, minX: number, minY: number, maxX: number, maxY: number): { roads: number[]; buildings: number[] } {
  const roads = new Set<number>();
  const buildings = new Set<number>();
  for (let cx = Math.floor(minX / data.cellSize); cx <= Math.floor(maxX / data.cellSize); cx++)
    for (let cy = Math.floor(minY / data.cellSize); cy <= Math.floor(maxY / data.cellSize); cy++) {
      const cell = data.cells.get(key(cx, cy));
      if (!cell) continue;
      for (const i of cell.roads) roads.add(i);
      for (const i of cell.buildings) buildings.add(i);
    }
  // Keep the drawing order (widest kinds last).
  return { roads: [...roads].sort((a, b) => a - b), buildings: [...buildings] };
}

/**
 * The street at a point: the named drivable road whose surface (plus a little) the point
 * is on. `raised` (the car is up on a flyover) prefers raised roads. Given the car's
 * `heading` (map radians), a point on two streets at once (a junction) gets the one the
 * car is driving along, not the cross street; otherwise the nearest.
 */
export function streetNameLookup(map: Pick<MapData, 'roads'>): (p: Point, raised?: boolean, heading?: number) => string | undefined {
  const grid = new SegmentGrid<Road>(40);
  for (const r of map.roads) {
    if (r.cls === 'path' || !r.name) continue;
    for (let i = 0; i + 1 < r.points.length; i++) grid.insert(r.points[i], r.points[i + 1], r);
  }
  return (p, raised = false, heading) => {
    let best: { score: number; d: number; name: string } | undefined;
    for (const e of grid.query(p, p, 20)) {
      const isRaised = !!e.item.z?.some((z) => z > 1);
      const d = distanceToSegment(p, e.a, e.b) - e.item.w / 2;
      if (d >= 3) continue;
      let score = Math.max(0, d) + (isRaised === raised ? 0 : 6);
      if (heading !== undefined) {
        const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) || 1;
        // 0 along the road, either way; 1 straight across it.
        score += STREET_ACROSS * Math.abs(((e.b[0] - e.a[0]) * Math.sin(heading) - (e.b[1] - e.a[1]) * Math.cos(heading)) / len);
      }
      if (score >= 3 + (heading !== undefined ? STREET_ACROSS : 0)) continue;
      if (!best || score < best.score || (score === best.score && d < best.d)) best = { score, d, name: e.item.name! };
    }
    return best?.name;
  };
}

/** How much a road running across the car's heading counts against it (as meters off its surface). */
const STREET_ACROSS = 4;

/** Map heading (radians, counter-clockwise from east) to a heading-up view rotation: rotate the map by this so the heading points up the screen. */
export function headingUpRotation(heading: number): number {
  return heading - Math.PI / 2;
}
