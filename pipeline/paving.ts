/**
 * Paving holes: small patches of ground or sidewalk completely surrounded by road at
 * a junction (gaps between pieces of asphalt, slivers between carriageways that almost
 * touch, tiny triangles between junctions a few meters apart).
 *
 * Found by rasterizing what the renderer paves (ribbons with their cut-back ends,
 * junction polygons, gap discs) on a 0.5 m grid around every junction and
 * flood-filling the unpaved cells from the grid's edge: unpaved cells the fill can't
 * reach are enclosed. `patchHoles` paves the ones that are clearly defects; the rest
 * (larger islands that may be real) are left for map QA to count.
 */
import { convexHull, pointInRing, ringBounds } from '../src/geometry/polygon';
import { dedupe, offsetPolyline } from '../src/geometry/road';
import { RANK } from '../src/map/roads';
import type { Junction, MapData, Point, Road, RoadClass } from '../src/map/types';

const key = (p: Point) => `${p[0]},${p[1]}`;
const CELL = 0.5; // meters per raster cell
const MARGIN = 12; // meters around each junction
const MAX_HOLE = 60; // m²; bigger enclosed areas are real islands (medians, slip-lane islands)

/** Fills cells whose centers are inside triangle abc. */
function fillTriangle(grid: Uint8Array, w: number, h: number, ox: number, oy: number, a: Point, b: Point, c: Point) {
  const minX = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - ox) / CELL));
  const maxX = Math.min(w - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - ox) / CELL));
  const minY = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - oy) / CELL));
  const maxY = Math.min(h - 1, Math.ceil((Math.max(a[1], b[1], c[1]) - oy) / CELL));
  const edge = (p: Point, q: Point, x: number, y: number) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  const area = edge(a, b, c[0], c[1]);
  if (area === 0) return;
  for (let gy = minY; gy <= maxY; gy++) {
    const y = oy + (gy + 0.5) * CELL;
    for (let gx = minX; gx <= maxX; gx++) {
      const x = ox + (gx + 0.5) * CELL;
      const e0 = edge(a, b, x, y) * area;
      const e1 = edge(b, c, x, y) * area;
      const e2 = edge(c, a, x, y) * area;
      if (e0 >= 0 && e1 >= 0 && e2 >= 0) grid[gy * w + gx] = 1;
    }
  }
}

export interface Hole {
  /** Centers of the raster cells in the hole. */
  cells: Point[];
  area: number;
  at: Point;
}

/** Enclosed unpaved patches around junctions (ground or sidewalk surrounded by road). */
export function findHoles(map: MapData): Hole[] {
  const drive = map.roads.filter((r) => r.cls !== 'path' && !(r.z && r.z.some((v) => v > 0.5)));
  // Index roads by cell of their points, to find the ones near a junction quickly.
  const roadCells = new Map<string, Set<Road>>();
  const ck = (x: number, y: number) => `${Math.floor(x / 50)},${Math.floor(y / 50)}`;
  for (const r of drive) for (const p of r.points) roadCells.set(ck(p[0], p[1]), (roadCells.get(ck(p[0], p[1])) ?? new Set()).add(r));
  // Shared drive ends get a gap disc when no junction polygon trims them (as in the renderer).
  const uses = new Map<string, number>();
  for (const r of drive) for (const p of r.points) uses.set(key(p), (uses.get(key(p)) ?? 0) + 1);

  const holes: Hole[] = [];
  for (const j of map.junctions ?? []) {
    if (j.z > 0.5 || j.patch) continue;
    const jb = ringBounds(j.ring);
    const ox = jb.minX - MARGIN;
    const oy = jb.minY - MARGIN;
    const w = Math.ceil((jb.maxX - jb.minX + 2 * MARGIN) / CELL);
    const h = Math.ceil((jb.maxY - jb.minY + 2 * MARGIN) / CELL);
    const grid = new Uint8Array(w * h);

    const near = new Set<Road>();
    for (let x = ox - 50; x <= ox + w * CELL + 50; x += 50) {
      for (let y = oy - 50; y <= oy + h * CELL + 50; y += 50) for (const r of roadCells.get(ck(x, y)) ?? []) near.add(r);
    }
    for (const r of near) {
      // Ribbon plus its cut-back ends = the full width along the whole centerline.
      const pts = dedupe(r.points);
      const { left, right } = offsetPolyline(pts, r.w / 2);
      for (let i = 0; i < left.length - 1; i++) {
        fillTriangle(grid, w, h, ox, oy, right[i], right[i + 1], left[i + 1]);
        fillTriangle(grid, w, h, ox, oy, right[i], left[i + 1], left[i]);
      }
      for (const [end, p] of [[0, r.points[0]], [1, r.points[r.points.length - 1]]] as const) {
        if ((r.trim?.[end] ?? -1) >= 0 || (uses.get(key(p)) ?? 0) < 2) continue;
        const sides = 8;
        for (let k = 0; k < sides; k++) {
          const a0 = (k / sides) * Math.PI * 2;
          const a1 = ((k + 1) / sides) * Math.PI * 2;
          const rad = r.w / 2;
          fillTriangle(grid, w, h, ox, oy, p, [p[0] + Math.cos(a0) * rad, p[1] + Math.sin(a0) * rad], [p[0] + Math.cos(a1) * rad, p[1] + Math.sin(a1) * rad]);
        }
      }
    }
    for (const o of map.junctions) {
      const b = ringBounds(o.ring);
      if (b.maxX < ox || b.minX > ox + w * CELL || b.maxY < oy || b.minY > oy + h * CELL || o.z > 0.5) continue;
      for (let gy = 0; gy < h; gy++) {
        const y = oy + (gy + 0.5) * CELL;
        if (y < b.minY || y > b.maxY) continue;
        for (let gx = 0; gx < w; gx++) {
          const x = ox + (gx + 0.5) * CELL;
          if (x >= b.minX && x <= b.maxX && pointInRing([x, y], o.ring)) grid[gy * w + gx] = 1;
        }
      }
    }

    // Flood the unpaved area reachable from the border; the rest of the unpaved cells are holes.
    const reach = new Uint8Array(w * h);
    const stack: number[] = [];
    const push = (i: number) => {
      if (!grid[i] && !reach[i]) {
        reach[i] = 1;
        stack.push(i);
      }
    };
    for (let x = 0; x < w; x++) {
      push(x);
      push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      push(y * w);
      push(y * w + w - 1);
    }
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < w * (h - 1)) push(i + w);
    }
    const done = new Uint8Array(w * h);
    for (let start = 0; start < w * h; start++) {
      if (grid[start] || reach[start] || done[start]) continue;
      const cells = [start];
      done[start] = 1;
      let sx = 0;
      let sy = 0;
      for (let n = 0; n < cells.length; n++) {
        const i = cells[n];
        sx += i % w;
        sy += Math.floor(i / w);
        const x = i % w;
        for (const k of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (k >= 0 && k < w * h && !grid[k] && !done[k]) {
            done[k] = 1;
            cells.push(k);
          }
        }
      }
      const area = cells.length * CELL * CELL;
      if (area < 0.5 || area > MAX_HOLE) continue;
      const at: Point = [ox + (sx / cells.length + 0.5) * CELL, oy + (sy / cells.length + 0.5) * CELL];
      // The same hole found from a neighbouring junction's grid.
      if (holes.some((o) => Math.hypot(o.at[0] - at[0], o.at[1] - at[1]) < 3)) continue;
      const pts = cells.map((i): Point => [ox + ((i % w) + 0.5) * CELL, oy + (Math.floor(i / w) + 0.5) * CELL]);
      holes.push({ cells: pts, area, at });
    }
  }
  return holes;
}

/** Holes up to this size are always paved. */
const PAVE_SMALL = 10; // m²
/** Thinner than this on average, a hole is a sliver between roads and gets paved. */
const PAVE_THIN = 1.2; // m
/** Long slivers are paved in chunks this long, so each chunk's hull follows curves. */
const CHUNK = 8; // m

export interface PatchStats {
  holes: number;
  paved: number;
  patches: number;
}

/** Average thickness: area over length along its longest direction. */
function thickness(cells: Point[], area: number): { thick: number; axis: Point } {
  let best = { len: 0, axis: [1, 0] as Point };
  for (let a = 0; a < 180; a += 15) {
    const axis: Point = [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)];
    const proj = cells.map((p) => p[0] * axis[0] + p[1] * axis[1]);
    const len = Math.max(...proj) - Math.min(...proj) + CELL;
    if (len > best.len) best = { len, axis };
  }
  return { thick: area / best.len, axis: best.axis };
}

/** The highest class of road with a point within 40 m, for the patch color. */
function classNear(map: MapData, at: Point): RoadClass {
  let cls: RoadClass = 'service';
  for (const r of map.roads) {
    if (RANK[r.cls] <= RANK[cls]) continue;
    if (r.points.some((p) => Math.hypot(p[0] - at[0], p[1] - at[1]) < 40)) cls = r.cls;
  }
  return cls;
}

/**
 * Paves small holes and thin slivers with patch polygons (drawn under the roads).
 * A second pass catches crumbs left at the edges of the first pass's patches.
 */
export function patchHoles(map: MapData): { junctions: Junction[]; stats: PatchStats } {
  const first = patchOnce(map);
  const second = patchOnce({ ...map, junctions: first.junctions });
  return {
    junctions: second.junctions,
    stats: { holes: first.stats.holes, paved: first.stats.paved, patches: first.stats.patches + second.stats.patches },
  };
}

function patchOnce(map: MapData): { junctions: Junction[]; stats: PatchStats } {
  const holes = findHoles(map);
  const stats: PatchStats = { holes: holes.length, paved: 0, patches: 0 };
  const patches: Junction[] = [];
  const offset = (map.junctions ?? []).filter((j) => j.patch).length;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  for (const hole of holes) {
    const { thick, axis } = thickness(hole.cells, hole.area);
    if (hole.area > PAVE_SMALL && thick > PAVE_THIN) continue;
    stats.paved++;
    // Chunk along the long axis; each chunk's hull (with cell corners) becomes a patch.
    const proj = hole.cells.map((p) => p[0] * axis[0] + p[1] * axis[1]);
    const min = Math.min(...proj);
    const chunks = new Map<number, Point[]>();
    hole.cells.forEach((p, i) => {
      const k = Math.floor((proj[i] - min) / CHUNK);
      // a cell on a chunk boundary goes into both chunks, so the chunks overlap a little
      for (const c of new Set([k, Math.floor((proj[i] - min - CELL) / CHUNK)])) if (c >= 0) chunks.set(c, [...(chunks.get(c) ?? []), p]);
    });
    const cls = classNear(map, hole.at);
    for (const cells of chunks.values()) {
      const corners = cells.flatMap(([x, y]): Point[] => [
        [x - CELL, y - CELL], [x + CELL, y - CELL], [x + CELL, y + CELL], [x - CELL, y + CELL],
      ]);
      const ring = convexHull(corners).map(([x, y]): Point => [round2(x), round2(y)]);
      if (ring.length < 3) continue;
      patches.push({ id: `p${offset + patches.length}`, ring, z: 0, cls, patch: true });
      stats.patches++;
    }
  }
  return { junctions: [...(map.junctions ?? []), ...patches], stats };
}
