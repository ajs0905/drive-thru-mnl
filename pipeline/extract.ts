/**
 * Turns an overpass-turbo GeoJSON export into the game's MapData.
 *
 * Real OSM data is messy, so this is defensive: anything it can't use is
 * counted in stats.skipped with a reason instead of crashing the build.
 */
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { createProjection, type LatLon, type Projection } from '../src/geo/projection';
import { polygonArea } from '../src/geometry/polygon';
import type { Area, AreaKind, Building, MapData, Point, Ring, Road, RoadClass } from '../src/map/types';
import { estimateHeight, LEVEL_HEIGHT } from './heights';
import { roadWidth } from './roadWidth';

const ROAD_CLASSES: Record<string, RoadClass> = {
  motorway: 'major', motorway_link: 'major',
  trunk: 'major', trunk_link: 'major',
  primary: 'major', primary_link: 'major',
  secondary: 'major', secondary_link: 'major',
  tertiary: 'minor', tertiary_link: 'minor',
  residential: 'minor', unclassified: 'minor', living_street: 'minor', road: 'minor',
  service: 'service',
  footway: 'path', path: 'path', steps: 'path', cycleway: 'path',
  pedestrian: 'path', track: 'path', corridor: 'path', bridleway: 'path',
};

type Tags = Record<string, unknown>;

/** overpass-turbo puts tags directly on properties; older exports nest them under `tags`. */
function getTags(f: Feature): Tags {
  const props = (f.properties ?? {}) as Tags;
  const nested = props.tags;
  return nested && typeof nested === 'object' ? (nested as Tags) : props;
}

function getId(f: Feature, i: number): string {
  const props = (f.properties ?? {}) as Tags;
  const raw = f.id ?? props['@id'] ?? props.id;
  return raw != null ? String(raw) : `feature/${i}`;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** "45", "45 m", "45m" -> 45. Anything else (feet, junk, negatives) -> undefined. */
export function parseHeight(v: unknown): number | undefined {
  if (typeof v === 'number') return v > 0 && Number.isFinite(v) ? v : undefined;
  const s = str(v);
  if (!s) return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*(m)?$/i.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n > 0 ? n : undefined;
}

/** "12" -> 12. Allows "12.5" (rounds down), rejects junk and zero. */
export function parseLevels(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(str(v));
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.floor(n);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function projectPositions(positions: Position[], proj: Projection): Point[] | null {
  const out: Point[] = [];
  for (const pos of positions) {
    const [lon, lat] = pos;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const { x, y } = proj.toLocal({ lat, lon } as LatLon);
    const p: Point = [round2(x), round2(y)];
    const prev = out[out.length - 1];
    // Drop consecutive duplicates (common in OSM, and created by rounding).
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out;
}

function projectLine(positions: Position[], proj: Projection): Point[] | null {
  const pts = projectPositions(positions, proj);
  return pts && pts.length >= 2 ? pts : null;
}

/** Projects a GeoJSON ring, drops the repeated closing point, and rejects degenerate rings. */
function projectRing(positions: Position[], proj: Projection): Ring | null {
  const pts = projectPositions(positions, proj);
  if (!pts) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length > 1 && first[0] === last[0] && first[1] === last[1]) pts.pop();
  return pts.length >= 3 ? pts : null;
}

/** Returns [outer, ...holes] or null if the outer ring is unusable. Bad holes are dropped. */
function projectPolygon(rings: Position[][], proj: Projection): Ring[] | null {
  if (rings.length === 0) return null;
  const outer = projectRing(rings[0], proj);
  if (!outer) return null;
  const holes = rings.slice(1).map((r) => projectRing(r, proj)).filter((r): r is Ring => r !== null);
  return [outer, ...holes];
}

function polygonsOf(g: Geometry): Position[][][] | null {
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return null;
}

function linesOf(g: Geometry): Position[][] | null {
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return null;
}

function areaKind(t: Tags): { kind: AreaKind; landuse?: string } | null {
  if (t.leisure === 'park' || t.leisure === 'garden') return { kind: 'park' };
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin') {
    return { kind: 'water' };
  }
  const landuse = str(t.landuse);
  if (landuse === 'grass' || landuse === 'recreation_ground' || landuse === 'village_green') {
    return { kind: 'park', landuse };
  }
  if (landuse) return { kind: 'landuse', landuse };
  return null;
}

/** OSM layer as an integer, or undefined. "1", "-1", "1;2" (takes the first). */
export function parseLayer(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n !== 0 && Math.abs(n) <= 5 ? n : undefined;
}

const BRIDGES = new Set(['yes', 'viaduct', 'cantilever', 'boardwalk', 'movable', 'covered', 'trestle', 'aqueduct']);
const CANOPIES = new Set(['roof', 'canopy', 'carport']);
export const CANOPY_HEIGHT = 3.6;

/** Ways inside malls and buildings: drawn as outdoor paths, they look like random lines. */
function isIndoor(highway: string, t: Tags): boolean {
  if (highway === 'corridor') return true;
  if (t.indoor && t.indoor !== 'no') return true;
  // `level` on a footway without a bridge usually means a mall floor.
  return t.level != null && t.bridge == null && t.layer == null;
}

export interface ExtractOptions {
  origin?: LatLon;
}

export function extractMap(fc: FeatureCollection, opts: ExtractOptions = {}): MapData {
  const proj = createProjection(opts.origin);
  const roads: Road[] = [];
  const buildings: Building[] = [];
  const areas: Area[] = [];
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new TypeError('Expected a GeoJSON FeatureCollection');
  }

  fc.features.forEach((f, i) => {
    if (!f || !f.geometry) return skip('no-geometry');
    const g = f.geometry;
    const t = getTags(f);
    const id = getId(f, i);
    const name = str(t.name);

    // Buildings first: a building that also has other tags is still a building.
    if (t.building != null && t.building !== 'no') {
      const polys = polygonsOf(g);
      if (!polys) return skip('building-not-polygon');
      const layer = parseLayer(t.layer);
      if ((layer !== undefined && layer < 0) || t.location === 'underground') return skip('underground-building');
      const height = parseHeight(t.height);
      const levels = parseLevels(t['building:levels']);
      const btype = str(t.building) ?? 'yes';
      const minLevel = parseLevels(t['building:min_level']);
      let minH = parseHeight(t.min_height) ?? (minLevel ? minLevel * LEVEL_HEIGHT : undefined);
      // Canopies (gas stations, covered walkways) float: a thin slab, not a solid block.
      if (CANOPIES.has(btype) && minH === undefined) minH = CANOPY_HEIGHT;
      polys.forEach((poly, j) => {
        const rings = projectPolygon(poly, proj);
        if (!rings) return skip('degenerate-polygon');
        const bid = polys.length > 1 ? `${id}#${j}` : id;
        const type = btype;
        const est = estimateHeight({ id: bid, type, height, levels, footprint: polygonArea(rings) });
        let h = est.h;
        if (minH !== undefined) {
          // Without a real height, a raised structure is a slab: canopies 0.6 m, others one level.
          if (est.hSrc === 'estimate' || h <= minH) h = minH + (CANOPIES.has(type) ? 0.6 : LEVEL_HEIGHT);
        }
        buildings.push({
          id: bid,
          ...(name && { name }),
          type,
          ...(height && { height }),
          ...(levels && { levels }),
          h: Math.round(h * 10) / 10,
          ...(minH !== undefined && { minH: Math.round(minH * 10) / 10 }),
          hSrc: est.hSrc,
          rings,
        });
      });
      return;
    }

    const highway = str(t.highway);
    if (highway) {
      const cls = ROAD_CLASSES[highway];
      if (!cls) return skip(`highway:${highway}`);
      const lines = linesOf(g);
      if (!lines) {
        // Pedestrian plazas (like High Street) are mapped as highway areas.
        const polys = polygonsOf(g);
        if (polys && (highway === 'pedestrian' || highway === 'footway')) {
          polys.forEach((poly, j) => {
            const rings = projectPolygon(poly, proj);
            if (!rings) return skip('degenerate-polygon');
            areas.push({ id: polys.length > 1 ? `${id}#${j}` : id, kind: 'plaza', rings });
          });
          return;
        }
        return skip('highway-area');
      }
      if (isIndoor(highway, t)) return skip('indoor');
      const layer = parseLayer(t.layer);
      const tunnel = t.tunnel != null && t.tunnel !== 'no' && t.tunnel !== 'culvert';
      // Underground walkways can't be seen and nobody drives on them.
      if (tunnel && cls === 'path' && t.tunnel !== 'building_passage') return skip('underground');
      const bridge = typeof t.bridge === 'string' && BRIDGES.has(t.bridge);
      const w = roadWidth(highway, cls, t);
      lines.forEach((line, j) => {
        const points = projectLine(line, proj);
        if (!points) return skip('degenerate-line');
        roads.push({
          id: lines.length > 1 ? `${id}#${j}` : id,
          highway,
          cls,
          ...(name && { name }),
          w,
          ...(layer !== undefined && { layer }),
          ...(bridge && { bridge: true as const }),
          ...(tunnel && { tunnel: true as const }),
          points,
        });
      });
      return;
    }

    const kind = areaKind(t);
    if (kind) {
      const polys = polygonsOf(g);
      if (!polys) return skip('area-not-polygon');
      polys.forEach((poly, j) => {
        const rings = projectPolygon(poly, proj);
        if (!rings) return skip('degenerate-polygon');
        areas.push({ id: polys.length > 1 ? `${id}#${j}` : id, ...kind, rings });
      });
      return;
    }

    skip(g.type === 'Point' ? 'point' : 'untagged');
  });

  return {
    version: 3,
    origin: proj.origin,
    bounds: computeBounds(roads, buildings, areas),
    roads,
    buildings,
    areas,
    stats: {
      features: fc.features.length,
      roads: roads.length,
      buildings: buildings.length,
      areas: areas.length,
      skipped,
    },
  };
}

export function computeBounds(roads: Road[], buildings: Building[], areas: Area[]): MapData['bounds'] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = ([x, y]: Point) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  roads.forEach((r) => r.points.forEach(add));
  buildings.forEach((b) => b.rings.forEach((ring) => ring.forEach(add)));
  areas.forEach((a) => a.rings.forEach((ring) => ring.forEach(add)));
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}
