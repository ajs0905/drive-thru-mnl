/**
 * Turns MapData into a handful of merged meshes (one per layer). The whole city
 * renders in about 5 draw calls instead of one per building or road.
 */
import { addFlatPolygon, addWalls, extrudeBuilding } from '../geometry/extrude';
import { hexToRgb, MeshBuilder, shade, srgbToLinear, type RGB } from '../geometry/meshBuilder';
import type { Area, Building, MapData, Point, Road, RoadClass } from '../map/types';
import { addDeckStructure, addDisc, addRoadRibbon, addSidewalk, addZebra, cutBackPieces, MARK, markCode, type DeckStyle } from '../geometry/road';
import { laneCount, RANK, sidewalkBands } from '../map/roads';
import type { Vec4 } from '../geometry/meshBuilder';
import { idUnit } from '../map/hash';
import { polygonArea, withWinding } from '../geometry/polygon';

export const EDGE_HEIGHT = 6;

export const PALETTE = {
  baseGround: '#aeb09c',
  residential: '#e8cfa3',
  commercial: '#a9c1db',
  civic: '#e0b49a',
  utility: '#bdb7ad',
  lowGeneric: '#ddd3c2',
  scenery: '#a7adb6',
  park: '#6fa75a',
  plaza: '#d9cfbd',
  concrete: '#c4c0b6',
  concreteUnder: '#8f8c85',
  water: '#4f8fcf',
  playableEdge: '#f5b83d',
  landuse: {
    residential: '#d9d0bd',
    commercial: '#cdc7c1',
    retail: '#cdc7c1',
    construction: '#c4b48f',
    military: '#a9b18f',
    cemetery: '#8fb87a',
    religious: '#d5c8b2',
    industrial: '#c2bdb4',
    default: '#c9c6b9',
  } as Record<string, string>,
  road: {
    major: '#5c6068',
    minor: '#666a71',
    service: '#73767c',
    path: '#c9c1b1',
  } satisfies Record<RoadClass, string>,
  sidewalk: '#cdc6b8',
  marking: '#ecebe4',
  markingYellow: '#f4c02a',
};

// Small steps up so overlapping layers don't flicker. Major roads sit on top where
// pieces still overlap; sidewalks sit under everything so road corners cover them.
export const ROAD_Y: Record<RoadClass, number> = { path: 0.12, service: 0.16, minor: 0.2, major: 0.24 };
export const SIDEWALK_Y = 0.1;
/** Patches filling small gaps between roads: under every road surface, over sidewalks and paths. */
export const PATCH_Y = 0.14;
export const CROSSING_Y = 0.28;
const SIDEWALK_WIDTH: Record<RoadClass, number> = { major: 3, minor: 2, service: 1.5, path: 0 };

const RESIDENTIAL = new Set(['house', 'detached', 'residential', 'apartments', 'terrace', 'semidetached_house', 'bungalow', 'dormitory']);
const COMMERCIAL = new Set(['office', 'commercial', 'hotel', 'retail', 'supermarket']);
const CIVIC = new Set(['school', 'university', 'college', 'hospital', 'government', 'public', 'civic', 'church', 'chapel', 'cathedral', 'kindergarten']);
const UTILITY = new Set(['industrial', 'warehouse', 'garage', 'garages', 'roof', 'parking', 'shed', 'service', 'construction']);

export function buildingColor(b: Building): string {
  if (RESIDENTIAL.has(b.type)) return PALETTE.residential;
  if (COMMERCIAL.has(b.type)) return PALETTE.commercial;
  if (CIVIC.has(b.type)) return PALETTE.civic;
  if (UTILITY.has(b.type)) return PALETTE.utility;
  return b.h >= 25 ? PALETTE.commercial : PALETTE.lowGeneric; // untyped: towers read as glass, low ones as concrete
}

function areaColor(a: Area): string {
  if (a.kind === 'park') return PALETTE.park;
  if (a.kind === 'plaza') return PALETTE.plaza;
  if (a.kind === 'water') return PALETTE.water;
  return PALETTE.landuse[a.landuse ?? ''] ?? PALETTE.landuse.default;
}

/**
 * Land-use areas overlap (a cemetery inside a big military zone, say). Smaller areas
 * are more specific, so they go on top: rank by size, biggest lowest.
 */
export function landuseHeights(areas: Area[]): Map<Area, number> {
  const ranked = areas
    .filter((a) => a.kind === 'landuse')
    .map((a) => ({ a, size: polygonArea(a.rings) }))
    .sort((x, y) => y.size - x.size);
  const out = new Map<Area, number>();
  ranked.forEach(({ a }, i) => out.set(a, 0.02 + (0.04 * i) / Math.max(1, ranked.length)));
  return out;
}

function areaY(a: Area, landuseY: Map<Area, number>): number {
  if (a.kind === 'water') return 0.09;
  if (a.kind === 'plaza') return 0.08;
  if (a.kind === 'park') return 0.07;
  return landuseY.get(a) ?? 0.02;
}

/** Palette hex -> linear RGB for vertex colors. */
const col = (hex: string): RGB => srgbToLinear(hexToRgb(hex));

export interface LayerArrays {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** Road layer only: per-vertex marking data for the road shader. */
  aux?: Float32Array;
}

export interface CityMeshes {
  buildings: LayerArrays;
  scenery: LayerArrays;
  roads: LayerArrays;
  ground: LayerArrays;
  /** Concrete for flyovers and footbridges: deck edges, barriers, pillars. */
  structures: LayerArrays;
  /** See-through fence along the playable edge (becomes the invisible wall for the car). */
  edge: LayerArrays;
  triangles: number;
  ms: number;
}

export function buildCity(map: MapData): CityMeshes {
  const t0 = performance.now();
  const buildings = new MeshBuilder();
  const scenery = new MeshBuilder();
  const roads = new MeshBuilder({ aux: true });
  const ground = new MeshBuilder();
  const edge = new MeshBuilder();
  const structures = new MeshBuilder();

  for (const b of map.buildings) {
    const jitter = 0.92 + idUnit(b.id) * 0.14;
    const wall: RGB = b.scenery ? col(PALETTE.scenery) : shade(col(buildingColor(b)), jitter);
    const base = b.minH ?? 0;
    extrudeBuilding(b.scenery ? scenery : buildings, b.rings, b.h - base, { wall, roof: shade(wall, 0.8) }, base);
  }

  const drive: DeckStyle = {
    depth: 1.2, barrier: 1, pillarEvery: 30, pillarSize: 1.8,
    color: col(PALETTE.concrete), underside: col(PALETTE.concreteUnder),
  };
  const walk: DeckStyle = { ...drive, depth: 0.5, barrier: 1.1, pillarEvery: 14, pillarSize: 0.6 };
  addRoads(roads, structures, map, drive, walk);

  const landuseY = landuseHeights(map.areas);
  for (const a of map.areas) addFlatPolygon(ground, a.rings, areaY(a, landuseY), col(areaColor(a)));

  if (map.playable && map.playable.length >= 3) {
    addWalls(edge, withWinding(map.playable, true), 0, EDGE_HEIGHT, col(PALETTE.playableEdge));
  }

  const out = {
    buildings: buildings.build(),
    scenery: scenery.build(),
    roads: roads.build(),
    ground: ground.build(),
    structures: structures.build(),
    edge: edge.build(),
  };
  return {
    ...out,
    triangles:
      buildings.triangleCount + scenery.triangleCount + roads.triangleCount + ground.triangleCount +
      structures.triangleCount + edge.triangleCount,
    ms: performance.now() - t0,
  };
}

const length = (pts: Point[]) => pts.slice(1).reduce((d, p, i) => d + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

/**
 * Marking data for a point near one end of a road, as if the road ran straight on
 * past its end. Lets a gap-filling disc carry the road's lines across.
 */
function endAux(r: Road, atStart: boolean, total: number, mark: number): (q: Point) => Vec4 {
  const pts = r.points;
  const [a, b] = atStart ? [pts[0], pts[1]] : [pts[pts.length - 2], pts[pts.length - 1]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const d: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const p = atStart ? pts[0] : pts[pts.length - 1];
  const u = atStart ? 0 : total;
  return ([x, y]) => [u + (x - p[0]) * d[0] + (y - p[1]) * d[1], (x - p[0]) * -d[1] + (y - p[1]) * d[0], r.w / 2, mark];
}

/**
 * Roads, junction polygons, sidewalks and crossings into the road layer; flyover
 * structure into its own layer.
 */
function addRoads(roads: MeshBuilder, structures: MeshBuilder, map: MapData, drive: DeckStyle, walk: DeckStyle) {
  // Road ends that meet other roads but have no junction polygon get a disc to fill
  // the wedge-shaped gap. Counted per network so footways don't trigger road discs.
  const shared = new Map<string, number>();
  for (const r of map.roads) {
    const net = r.cls === 'path' ? 'w' : 'd';
    for (const p of r.points) {
      const k = `${net}${p[0]},${p[1]}`;
      shared.set(k, (shared.get(k) ?? 0) + 1);
    }
  }

  // Sidewalks first: they sit under the roads, so road corners and junctions cover them.
  const sidewalk = col(PALETTE.sidewalk);
  for (const r of map.roads) {
    if (r.cls === 'path' || r.z) continue;
    const sides = sidewalkBands(r);
    const w = SIDEWALK_WIDTH[r.cls];
    if (sides.left) addSidewalk(roads, r.points, r.w, w, 'left', SIDEWALK_Y, sidewalk);
    if (sides.right) addSidewalk(roads, r.points, r.w, w, 'right', SIDEWALK_Y, sidewalk);
  }

  // Paths first so higher classes land on top in the merged buffer too.
  const order: RoadClass[] = ['path', 'service', 'minor', 'major'];
  for (const cls of order) {
    const color = col(PALETTE.road[cls]);
    for (const r of map.roads) {
      if (r.cls !== cls) continue;
      const mark = cls === 'path' ? 0 : markCode(MARK.lanes, { lanes: laneCount(r), oneway: r.oneway, rank: RANK[cls] });
      addRoadRibbon(roads, r.points, r.w, ROAD_Y[cls], color, { z: r.z, trim: r.trim, mark });
      // The cut-back ends as plain asphalt, so curves and merges never leave a gap.
      for (const piece of cutBackPieces(r.points, r.z, r.trim)) addRoadRibbon(roads, piece.pts, r.w, ROAD_Y[cls], color, { z: piece.zs });
      const net = cls === 'path' ? 'w' : 'd';
      const total = length(r.points);
      for (const atStart of [true, false]) {
        if ((r.trim?.[atStart ? 0 : 1] ?? -1) >= 0) continue; // a junction polygon covers this end
        const i = atStart ? 0 : r.points.length - 1;
        const p = r.points[i];
        if ((shared.get(`${net}${p[0]},${p[1]}`) ?? 0) < 2) continue;
        // A hair below the ribbons, so only the wedge gaps show.
        addDisc(roads, p, r.w / 2, ROAD_Y[cls] - 0.015 + (r.z?.[i] ?? 0), color, 8, endAux(r, atStart, total, mark));
      }
      if (r.z) addDeckStructure(structures, r.points, r.w, r.z, cls === 'path' ? walk : drive);
    }
  }

  for (const j of map.junctions ?? []) {
    addFlatPolygon(roads, [j.ring], (j.patch ? PATCH_Y : ROAD_Y[j.cls]) + j.z, col(PALETTE.road[j.cls]));
  }

  // Zebras: white bars over the road's own asphalt color, so lane lines don't show through.
  for (const c of map.crossings ?? []) addZebra(roads, c.c, c.dir, c.half, c.w, CROSSING_Y + c.z, col(PALETTE.road[c.cls]));
}
