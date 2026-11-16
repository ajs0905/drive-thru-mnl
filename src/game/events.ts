/**
 * The game modes' places and runs (events.json): loading bays and landmarks anchored to a
 * road id and a distance along it, and the runs between them. The names are made up for
 * the game; the streets they sit on are real.
 *
 * A place resolves to a curb spot (car/curbSpot.ts: parked parallel on the right-hand
 * side of the road's direction, sliding along the curb to the nearest clear spot) and to
 * the anchor on the road graph the routes start or end at.
 */
import { curbFinder, type CurbFinder } from '../car/curbSpot';
import type { MapData, Point } from '../map/types';
import { snap, type Anchor, type RoadGraph } from '../routing/graph';
import raw from './events.json';

export type PlaceKind = 'bay' | 'landmark';
export type RunKind = 'courier' | 'vault';

export interface PlaceDef {
  id: string;
  name: string;
  kind: PlaceKind;
  /** Map road id, and meters along its points. */
  road: string;
  s: number;
}

export interface RunDef {
  id: string;
  name: string;
  kind: RunKind;
  cargo: string;
  from: string;
  to: string;
}

export interface Events {
  version: 1;
  places: PlaceDef[];
  runs: RunDef[];
}

/** Checks the events file's shape and references; throws with what's wrong. */
export function parseEvents(data: unknown): Events {
  const o = data as Partial<Events> | null;
  if (!o || o.version !== 1 || !Array.isArray(o.places) || !Array.isArray(o.runs)) throw new Error('events: expected { version: 1, places: [], runs: [] }');
  const ids = new Set<string>();
  for (const p of o.places) {
    if (typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.road !== 'string' || typeof p.s !== 'number' || !(p.kind === 'bay' || p.kind === 'landmark')) throw new Error(`events: bad place ${JSON.stringify(p)}`);
    if (ids.has(p.id)) throw new Error(`events: place ${p.id} twice`);
    ids.add(p.id);
  }
  const runs = new Set<string>();
  for (const r of o.runs) {
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.cargo !== 'string' || !(r.kind === 'courier' || r.kind === 'vault')) throw new Error(`events: bad run ${JSON.stringify(r)}`);
    if (!ids.has(r.from) || !ids.has(r.to) || r.from === r.to) throw new Error(`events: run ${r.id} needs two different known places`);
    if (runs.has(r.id)) throw new Error(`events: run ${r.id} twice`);
    runs.add(r.id);
  }
  return o as Events;
}

export const EVENTS: Events = parseEvents(raw);

export interface Place extends PlaceDef {
  /** The curb spot: where the car stops (map space), and the way it faces. */
  p: Point;
  heading: number;
  /** Where on the road graph it is. */
  anchor: Anchor;
}

/**
 * Places resolved on a map: curb spot and graph anchor. A place whose road is gone (the
 * map was rebuilt without it) or has no clear curb is left out, and so are its runs.
 */
export function resolvePlaces(map: Pick<MapData, 'roads'> & Partial<MapData>, graph: RoadGraph, events = EVENTS, finder: CurbFinder = curbFinder(map)): Map<string, Place> {
  const out = new Map<string, Place>();
  const byId = new Map(map.roads.map((r) => [r.id, r]));
  for (const def of events.places) {
    const road = byId.get(def.road);
    if (!road) continue;
    const spot = finder.along(road, def.s, true);
    if (!spot) continue;
    const anchor = snap(graph, spot.p, { heading: spot.heading, z: 0, reach: 20 });
    if (!anchor) continue;
    out.set(def.id, { ...def, p: spot.p, heading: spot.heading, anchor: { edge: anchor.edge, s: anchor.s } });
  }
  return out;
}

/** The runs whose places both resolved. */
export function playableRuns(places: Map<string, Place>, events = EVENTS): RunDef[] {
  return events.runs.filter((r) => places.has(r.from) && places.has(r.to));
}
