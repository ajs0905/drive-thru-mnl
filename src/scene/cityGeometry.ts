/**
 * Turns MapData into a handful of merged meshes (one per layer). The whole city
 * renders in about 5 draw calls instead of one per building or road.
 */
import { addFlatPolygon, addWalls, extrudeBuilding } from '../geometry/extrude';
import { hexToRgb, MeshBuilder, shade, srgbToLinear, type RGB } from '../geometry/meshBuilder';
import type { Area, Building, MapData, RoadClass } from '../map/types';
import { addDeckStructure, addDisc, addRoadRibbon, type DeckStyle } from '../geometry/road';
import { idUnit } from '../map/hash';
import { polygonArea, withWinding } from '../geometry/polygon';

export const EDGE_HEIGHT = 6;

export const PALETTE = {
  sky: '#cfe2ee',
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
    major: '#474b52',
    minor: '#53575e',
    service: '#62666c',
    path: '#c9c1b1',
  } satisfies Record<RoadClass, string>,
};

// Small steps up so overlapping layers don't flicker. Major roads sit on top at junctions.
export const ROAD_Y: Record<RoadClass, number> = { path: 0.12, service: 0.16, minor: 0.2, major: 0.24 };

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
  const roads = new MeshBuilder();
  const ground = new MeshBuilder();
  const edge = new MeshBuilder();
  const structures = new MeshBuilder();

  for (const b of map.buildings) {
    const jitter = 0.92 + idUnit(b.id) * 0.14;
    const wall: RGB = b.scenery ? col(PALETTE.scenery) : shade(col(buildingColor(b)), jitter);
    const base = b.minH ?? 0;
    extrudeBuilding(b.scenery ? scenery : buildings, b.rings, b.h - base, { wall, roof: shade(wall, 0.8) }, base);
  }

  // Where road pieces meet (shared points), a disc fills the wedge-shaped gap
  // between their flat ends. Counted per network so sidewalks don't trigger road discs.
  const shared = new Map<string, number>();
  for (const r of map.roads) {
    const net = r.cls === 'path' ? 'w' : 'd';
    for (const p of r.points) {
      const k = `${net}${p[0]},${p[1]}`;
      shared.set(k, (shared.get(k) ?? 0) + 1);
    }
  }

  const drive: DeckStyle = {
    depth: 1.2, barrier: 1, pillarEvery: 30, pillarSize: 1.8,
    color: col(PALETTE.concrete), underside: col(PALETTE.concreteUnder),
  };
  const walk: DeckStyle = { ...drive, depth: 0.5, barrier: 1.1, pillarEvery: 14, pillarSize: 0.6 };

  // Paths first so higher classes land on top in the merged buffer too.
  const order: RoadClass[] = ['path', 'service', 'minor', 'major'];
  for (const cls of order) {
    const color = col(PALETTE.road[cls]);
    for (const r of map.roads) {
      if (r.cls !== cls) continue;
      addRoadRibbon(roads, r.points, r.w, ROAD_Y[cls], color, r.z);
      const net = cls === 'path' ? 'w' : 'd';
      const ends: [number, number][] = [[0, 0], [r.points.length - 1, 0]];
      for (const [i] of ends) {
        const p = r.points[i];
        if ((shared.get(`${net}${p[0]},${p[1]}`) ?? 0) > 1) addDisc(roads, p, r.w / 2, ROAD_Y[cls] + (r.z?.[i] ?? 0), color);
      }
      if (r.z) addDeckStructure(structures, r.points, r.w, r.z, cls === 'path' ? walk : drive);
    }
  }

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
