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
  points: Point[];
}

export interface Building {
  id: string;
  name?: string;
  /** Meters, from the `height` tag if present. */
  height?: number;
  /** From `building:levels` if present. */
  levels?: number;
  /** rings[0] is the outer outline, the rest are holes. */
  rings: Ring[];
}

export type AreaKind = 'park' | 'water' | 'landuse';

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
}

export interface MapData {
  version: 1;
  origin: { lat: number; lon: number };
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  roads: Road[];
  buildings: Building[];
  areas: Area[];
  stats: MapStats;
}
