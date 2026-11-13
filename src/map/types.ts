/**
 * Shape of the processed map file the pipeline writes and the game reads.
 * Coordinates are local meters: [x east, y north], rounded to centimeters.
 */

export type Point = [x: number, y: number];
/** A closed ring. The pipeline does not repeat the first point at the end. */
export type Ring = Point[];

export type RoadClass = 'major' | 'minor' | 'service' | 'path';

export interface Road {
  id: string;
  highway: string;
  cls: RoadClass;
  name?: string;
  /** Surface width in meters (from width / lanes / oneway tags, see pipeline/roadWidth.ts). */
  w: number;
  /** OSM layer: 1 = one level up (flyovers, footbridges), -1 = below (underpasses). */
  layer?: number;
  /** Bridge, viaduct, or other raised structure. */
  bridge?: true;
  /** Underpass or covered section. Drawn at ground level for now. */
  tunnel?: true;
  /** Outside the playable area: rendered, but not drivable. */
  scenery?: true;
  points: Point[];
  /** Height of each point above the ground, in meters. Missing = all at ground level. */
  z?: number[];
}

/** Where a building's render height came from. */
export type HeightSource = 'tag' | 'levels' | 'estimate';

export interface Building {
  id: string;
  name?: string;
  /** Value of the OSM `building` tag ("yes", "house", "office", ...). */
  type: string;
  /** Meters, from the `height` tag if present. */
  height?: number;
  /** From `building:levels` if present. */
  levels?: number;
  /** Top of the building above the ground, in meters. */
  h: number;
  /** Bottom of the building above the ground (canopies, skybridges). Missing = 0. */
  minH?: number;
  hSrc: HeightSource;
  /** Outside the playable area: rendered as backdrop only. */
  scenery?: true;
  /** rings[0] is the outer outline, the rest are holes. */
  rings: Ring[];
}

export type AreaKind = 'park' | 'water' | 'landuse' | 'plaza';

export interface Area {
  id: string;
  kind: AreaKind;
  landuse?: string;
  rings: Ring[];
}

export interface MapStats {
  features: number;
  roads: number;
  buildings: number;
  areas: number;
  skipped: Record<string, number>;
  /** Filled in when the map is clipped to a playable area. */
  clip?: {
    marginMeters: number;
    playableBuildings: number;
    sceneryBuildings: number;
    droppedBuildings: number;
    droppedRoads: number;
    droppedAreas: number;
  };
}

export interface MapData {
  version: 3;
  origin: { lat: number; lon: number };
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Outline of the drivable area, if one was given to the pipeline. */
  playable?: Ring;
  roads: Road[];
  buildings: Building[];
  areas: Area[];
  stats: MapStats;
}
