/**
 * Turns MapData into a handful of merged meshes (one per layer). The whole city
 * renders in about 5 draw calls instead of one per building or road.
 */
import { addFlatPolygon, addWalls, extrudeBuilding, FLOOR_HEIGHT, windowCode, WINDOWS } from '../geometry/extrude';
import { hexToRgb, MeshBuilder, shade, srgbToLinear, type RGB } from '../geometry/meshBuilder';
import type { Area, BarrierKind, Building, MapData, Point, Road, RoadClass } from '../map/types';
import { addDeckStructure, addDisc, addPillar, addRoadRibbon, addSidewalk, addZebra, cutBackPieces, deckJoins, DECKS, MARK, markCode, type DeckStyle } from '../geometry/road';
import { laneCount, RANK, sidewalkBands } from '../map/roads';
import type { Vec4 } from '../geometry/meshBuilder';
import { ChunkedBuilder, chunkKey, type Chunk } from '../geometry/chunks';
import { idUnit } from '../map/hash';
import { roofProps } from '../geometry/roofProps';
import type { Prop, PropKind } from '../geometry/props';
import { fixtureProps, treeModelProps, treeProps } from '../geometry/streetProps';
import { treeTint, type TreeModel } from '../geometry/treeShapes';
import { addBarrier, BARRIER_THICKNESS } from '../geometry/barrier';
import { polygonArea, vertexCentroid, withWinding } from '../geometry/polygon';

export const EDGE_HEIGHT = 6;

export const PALETTE = {
  baseGround: '#aaa79d',
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

/** Prop colors (sRGB hex; three.js converts instance colors). Each prop picks one by its tone. */
export const PROP_COLORS: Record<PropKind, string[]> = {
  housing: ['#bdb8ad'],
  ac: ['#dcdad4'],
  /** Blue plastic, black plastic, steel, beige. */
  tank: ['#3f6fa8', '#2f3234', '#b9bdc1', '#cdbf9e'],
  pillar: ['#d8d2c4', '#c2b8a6', '#e6e1d6'],
  post: ['#5a5e63'],
  boom: ['#f2c230', '#e9e6dc'],
  bollard: ['#3d4145', '#e3b52c', '#b9bdc1'],
  block: ['#c9c4b8'],
  trunk: ['#6b5038', '#5e4632'],
  palmTrunk: ['#8f8270', '#9a8d79'],
  canopy: ['#5f8f3f', '#4f7d36', '#6e9b46', '#577f3b', '#66923f'],
  crown: ['#6d9a3a', '#5f8c34', '#78a144'],
  // Tree models: the leaf color (the bark is part of the model).
  treeRound: ['#5f8f3f', '#4f7d36', '#6e9b46', '#577f3b', '#66923f'],
  treeWide: ['#5f8f3f', '#4f7d36', '#6e9b46', '#577f3b', '#66923f'],
  treeTall: ['#5f8f3f', '#4f7d36', '#6e9b46', '#577f3b', '#66923f'],
  palm: ['#6d9a3a', '#5f8c34', '#78a144'],
};

export const propColor = (p: Prop): string => {
  const list = PROP_COLORS[p.kind];
  return list[Math.min(list.length - 1, Math.floor(p.tone * list.length))];
};

const TREE_MODEL_KINDS = new Set<string>(['treeRound', 'treeWide', 'treeTall', 'palm'] satisfies TreeModel[]);

/**
 * Instance color for a prop, linear RGB. Plain shapes get their color; tree models,
 * whose vertex colors already hold bark and a reference green, get the tint that turns
 * that green into their own.
 */
export function propInstanceColor(p: Prop): RGB {
  const hex = propColor(p);
  return TREE_MODEL_KINDS.has(p.kind) ? treeTint(p.kind as TreeModel, hex) : srgbToLinear(hexToRgb(hex));
}

/** Barrier colors: painted concrete walls, dark metal fences, hedges, steel rails. */
export const BARRIER_COLORS: Record<BarrierKind, { side: string; top: string }> = {
  wall: { side: '#d8d2c4', top: '#c9c2b2' },
  fence: { side: '#4a4f52', top: '#4a4f52' },
  hedge: { side: '#4c7a34', top: '#5d8e3e' },
  rail: { side: '#b9bcbf', top: '#cfd2d4' },
};

// Small steps up so overlapping layers don't flicker. Major roads sit on top where
// pieces still overlap; sidewalks sit under everything so road corners cover them.
export const ROAD_Y: Record<RoadClass, number> = { path: 0.12, service: 0.16, minor: 0.2, major: 0.24 };
export const SIDEWALK_Y = 0.1;
/** Patches filling small gaps between roads: under every road surface, over sidewalks and paths. */
export const PATCH_Y = 0.14;
export const CROSSING_Y = 0.28;
/** How much higher each drawing layer of overlapping same-class roads is (m); 8 layers stay under crossings. */
export const ROAD_LIFT = 0.004;
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

const HOUSES = new Set(['house', 'detached', 'terrace', 'semidetached_house', 'bungalow']);
const PARKING = new Set(['parking', 'garage', 'garages']);

/** Window style for a building's walls (windowCode), from its type and height. */
export function windowStyle(b: Building): number {
  const base = b.minH ?? 0;
  const tall = b.h - base;
  if (base >= 2.5 || tall < 2.5) return 0; // canopies, skybridges, sheds
  const floors = Math.floor(tall / FLOOR_HEIGHT);
  const variant = Math.floor(idUnit(`${b.id}#windows`) * 16);
  const style = (kind: (typeof WINDOWS)[keyof typeof WINDOWS]) => windowCode(kind, variant, floors);
  if (PARKING.has(b.type)) return tall >= 5 ? style(WINDOWS.parking) : 0;
  if (UTILITY.has(b.type)) return 0; // warehouses, factories, roofs: blank walls
  if (HOUSES.has(b.type)) return style(WINDOWS.house);
  if (RESIDENTIAL.has(b.type)) return style(tall >= 10 ? WINDOWS.apartment : WINDOWS.house);
  if (COMMERCIAL.has(b.type) || CIVIC.has(b.type)) return style(tall >= 25 ? WINDOWS.glass : tall >= 9 ? WINDOWS.office : WINDOWS.house);
  // Untyped: towers read as glass, mid-rises as apartments, low ones as houses and shops.
  return style(tall >= 25 ? WINDOWS.glass : tall >= 10 ? WINDOWS.apartment : WINDOWS.house);
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
  /** Road and building layers: per-vertex data for their shaders (markings, windows). */
  aux?: Float32Array;
}

export type LayerChunk = Chunk<LayerArrays>;

export interface CityMeshes {
  /** Each layer is split into grid cells (src/geometry/chunks.ts) so cells off screen are skipped. */
  buildings: LayerChunk[];
  scenery: LayerChunk[];
  roads: LayerChunk[];
  ground: LayerChunk[];
  /** Concrete for flyovers and footbridges (deck edges, barriers, pillars), plus walls, fences and hedges. */
  structures: LayerChunk[];
  /** See-through fence along the playable edge (becomes the invisible wall for the car). */
  edge: LayerArrays;
  /** Rooftop details and street fixtures, drawn as instances, grouped by the same grid cells. */
  props: Chunk<Prop[]>[];
  /** Trees as tree models (Medium and High), drawn as instances like props but kept visible farther away. */
  trees: Chunk<Prop[]>[];
  /** The same trees as a trunk plus one crown each (Low). */
  simpleTrees: Chunk<Prop[]>[];
  triangles: number;
  ms: number;
}

export function buildCity(map: MapData): CityMeshes {
  const t0 = performance.now();
  const buildings = new ChunkedBuilder({ aux: true });
  const scenery = new ChunkedBuilder({ aux: true });
  const roads = new ChunkedBuilder({ aux: true });
  const ground = new ChunkedBuilder();
  const edge = new MeshBuilder();
  const structures = new ChunkedBuilder();

  for (const b of map.buildings) {
    const jitter = 0.92 + idUnit(b.id) * 0.14;
    const wall: RGB = b.scenery ? col(PALETTE.scenery) : shade(col(buildingColor(b)), jitter);
    const base = b.minH ?? 0;
    const colors = { wall, roof: shade(wall, 0.8), windows: windowStyle(b) };
    if (b.rings[0]?.length) extrudeBuilding((b.scenery ? scenery : buildings).at(b.rings[0][0]), b.rings, b.h - base, colors, base);
  }

  const concrete = { color: col(PALETTE.concrete), underside: col(PALETTE.concreteUnder) };
  const drive: DeckStyle = { ...DECKS.drive, ...concrete };
  const walk: DeckStyle = { ...DECKS.walk, ...concrete };
  addRoads(roads, structures, map, drive, walk);

  const landuseY = landuseHeights(map.areas);
  for (const a of map.areas) {
    if (a.rings[0]?.length) addFlatPolygon(ground.at(vertexCentroid(a.rings[0])), a.rings, areaY(a, landuseY), col(areaColor(a)));
  }

  if (map.playable && map.playable.length >= 3) {
    addWalls(edge, withWinding(map.playable, true), 0, EDGE_HEIGHT, col(PALETTE.playableEdge));
  }

  for (const b of map.barriers ?? []) {
    const c = BARRIER_COLORS[b.kind];
    addBarrier(structures.at(b.points[Math.floor(b.points.length / 2)]), b.points, BARRIER_THICKNESS[b.kind], b.h, col(c.side), col(c.top));
  }

  const out = {
    props: propCells([...map.buildings.flatMap(roofProps), ...(map.fixtures ?? []).flatMap(fixtureProps)]),
    /** Tree models (Medium and High). */
    trees: propCells((map.trees ?? []).flatMap(treeModelProps)),
    /** Trunk plus one crown per tree (Low). */
    simpleTrees: propCells((map.trees ?? []).flatMap(treeProps)),
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

/** Groups props by grid cell (the cell of each prop's own position), in a stable order. */
export function propCells(props: Prop[]): Chunk<Prop[]>[] {
  const cells = new Map<string, Prop[]>();
  for (const p of props) {
    const key = chunkKey([p.x, p.y]);
    const list = cells.get(key);
    if (list) list.push(p);
    else cells.set(key, [p]);
  }
  return [...cells].sort(([a], [b]) => a.localeCompare(b)).map(([key, arrays]) => ({ key, arrays }));
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
function addRoads(roadCells: ChunkedBuilder, structureCells: ChunkedBuilder, map: MapData, drive: DeckStyle, walk: DeckStyle) {
  /** Everything for one road goes into the cell of its middle point. */
  const mid = (r: Road) => r.points[Math.floor(r.points.length / 2)];
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
    const roads = roadCells.at(mid(r));
    if (sides.left) addSidewalk(roads, r.points, r.w, w, 'left', SIDEWALK_Y, sidewalk);
    if (sides.right) addSidewalk(roads, r.points, r.w, w, 'right', SIDEWALK_Y, sidewalk);
  }

  const joins = deckJoins(map.roads);
  // Paths first so higher classes land on top in the merged buffer too.
  const order: RoadClass[] = ['path', 'service', 'minor', 'major'];
  for (const cls of order) {
    const color = col(PALETTE.road[cls]);
    for (const r of map.roads) {
      if (r.cls !== cls) continue;
      const roads = roadCells.at(mid(r));
      const mark = cls === 'path' ? 0 : markCode(MARK.lanes, { lanes: laneCount(r), oneway: r.oneway, rank: RANK[cls] });
      const y = ROAD_Y[cls] + (r.lift ?? 0) * ROAD_LIFT;
      addRoadRibbon(roads, r.points, r.w, y, color, { z: r.z, trim: r.trim, mark });
      // The cut-back ends as plain asphalt, so curves and merges never leave a gap.
      for (const piece of cutBackPieces(r.points, r.z, r.trim)) addRoadRibbon(roads, piece.pts, r.w, y, color, { z: piece.zs });
      const net = cls === 'path' ? 'w' : 'd';
      const total = length(r.points);
      for (const atStart of [true, false]) {
        if ((r.trim?.[atStart ? 0 : 1] ?? -1) >= 0) continue; // a junction polygon covers this end
        const i = atStart ? 0 : r.points.length - 1;
        const p = r.points[i];
        if ((shared.get(`${net}${p[0]},${p[1]}`) ?? 0) < 2) continue;
        // A hair below the ribbons, so only the wedge gaps show.
        addDisc(roads, p, r.w / 2, y - 0.015 + (r.z?.[i] ?? 0), color, 8, endAux(r, atStart, total, mark));
      }
      if (r.z) addDeckStructure(structureCells.at(mid(r)), r.points, r.w, r.z, cls === 'path' ? walk : drive, joins.get(r.id));
    }
  }

  // Pillars under decks and posts under raised buildings (placed by pipeline/structures.ts).
  for (const p of map.pillars ?? []) addPillar(structureCells.at(p.p), p, drive.color, drive.underside);

  for (const j of map.junctions ?? []) {
    addFlatPolygon(roadCells.at(j.ring[0]), [j.ring], (j.patch ? PATCH_Y : ROAD_Y[j.cls]) + j.z, col(PALETTE.road[j.cls]));
  }

  // Zebras: white bars over the road's own asphalt color, so lane lines don't show through.
  for (const c of map.crossings ?? []) addZebra(roadCells.at(c.c), c.c, c.dir, c.half, c.w, CROSSING_Y + c.z, col(PALETTE.road[c.cls]));
}
