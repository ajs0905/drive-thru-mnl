/**
 * What the car can hit and drive on, besides the flat ground, as static triangle meshes
 * in three.js space (x east, y up, z south), built once when driving starts and handed
 * to the physics engine. Two meshes, because the chase camera treats them differently:
 *
 * **Walls** (the camera stays in front of these):
 * - Playable buildings: every outline edge, holes included, from the ground to the roof.
 *   Buildings that start above the ground (canopies, skybridges, all well above a car's
 *   roof in this map) and scenery outside the playable area are skipped.
 * - Walls, fences, hedges and guard rails, as thin upright strips. They were already cut
 *   open wherever a road or path passes (pipeline/barriers.ts), so streets stay open.
 * - The playable edge: a tall wall along its outline.
 *
 * **Structures** (the camera may pass these: thin, or overhead):
 * - Flyover decks and ramps, drivable: the road surface at the height it's drawn
 *   (road class height plus the road's `z`), with shallow cones at the joints and the
 *   raised junction polygons, so the wheels find no cracks. Their sides are exactly what
 *   the renderer draws: the deck's edge band (reaching the ground where the deck is low,
 *   open underneath where it's high) and the side barriers. Nothing invisible: a wall
 *   down to the ground under a high deck edge would stop a car in what looks like open
 *   space. So the car gets onto a flyover by its ramps, the barriers keep it on, and it
 *   drives underneath where there's room.
 * - Footbridges and skywalks aren't drivable: only their sides, the same way.
 * - Posts: the pillars and posts the pipeline placed (under decks and raised buildings,
 *   `pillars` in the data), tree trunks, bollards, concrete blocks and gate pillars, as
 *   small prisms matching what's drawn. Parking booms are left open (they
 *   don't lift yet), and so are gate openings.
 *
 * Rapier's triangle meshes collide from either side (checked by the physics tests), so
 * thin walls need only one quad.
 */
import { CONCRETE_SIZE, roadblockCorners, roadblockLayout } from './roadblocks';
import earcut from 'earcut';
import type { MapData, Point, Road, RoadClass } from '../map/types';
import { PROP_SHAPE, type Prop, type PropKind } from './props';
import { DECK_SIDES_FROM, DECKS, deckEdges, deckJoins, dedupeWithZ, pillarCorners, railHeight, type DeckJoin } from './road';
import { fixtureProps, treeProps } from './streetProps';

export const COLLISION = {
  /** Height of the invisible wall along the playable edge (m). */
  edgeHeight: 30,
  /** Sides of the prisms standing in for round posts and trunks, and of the deck joint discs. */
  roundSides: 6,
  jointSides: 8,
  /** Room a car needs under a building or deck to drive beneath it (m). */
  clearance: 2.5,
  /** Below this height a ramp is just road on the ground: no side walls. */
  rampLift: DECK_SIDES_FROM,
  /**
   * How far a deck joint's rim sits below its middle, per meter out (a slope). Joints are
   * shallow cones, not flat discs, so they stay under the road even where a ramp meets
   * the deck: a flat disc at the top of a ramp stuck out of it like a ledge.
   */
  jointDrop: 0.25,
};

/** Props from trees and fixtures that are solid (the rest, like crowns and boom arms, aren't). */
const SOLID_PROPS = new Set<PropKind>(['trunk', 'palmTrunk', 'pillar', 'post', 'bollard', 'block']);

export interface TriMesh {
  /** xyz per vertex, three.js space. */
  vertices: Float32Array;
  indices: Uint32Array;
}

export interface CollisionWorld {
  /** What the chase camera keeps in front of: buildings, walls and fences, the playable edge. */
  walls: TriMesh;
  /** Decks, their sides and barriers, footbridge sides, posts. */
  structures: TriMesh;
  /** What went in, for logging and tests. */
  counts: { buildings: number; barriers: number; edge: number; posts: number; decks: number; footbridges: number; triangles: number };
}

export interface CollisionOptions {
  /** Height a road of each class is drawn at above its `z` (the renderer's road layering). */
  surfaceY: Record<RoadClass, number>;
}

/** Map point and height -> three.js position. */
const at = (p: Point, y: number): [number, number, number] => [p[0], y, -p[1]];

class Builder {
  v: number[] = [];
  i: number[] = [];

  tri(a: [number, number, number], b: [number, number, number], c: [number, number, number]) {
    const n = this.v.length / 3;
    this.v.push(...a, ...b, ...c);
    this.i.push(n, n + 1, n + 2);
  }

  /** Upright quad from map point a to b, with its own bottom and top at each end. */
  quad(a: Point, b: Point, bottomA: number, bottomB: number, topA: number, topB: number) {
    if (topA <= bottomA && topB <= bottomB) return;
    const n = this.v.length / 3;
    this.v.push(...at(a, bottomA), ...at(b, bottomB), ...at(b, topB), ...at(a, topA));
    this.i.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }

  /** Upright quads along a closed ring (or an open line), between two heights. */
  walls(points: Point[], bottom: number, top: number, closed: boolean) {
    const last = closed ? points.length : points.length - 1;
    for (let k = 0; k < last; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      if (a[0] !== b[0] || a[1] !== b[1]) this.quad(a, b, bottom, bottom, top, top);
    }
  }

  /** A flat polygon (outer ring, map points) at a height, triangulated. */
  flat(ring: Point[], y: number) {
    const idx = earcut(ring.flat(), undefined, 2);
    for (let k = 0; k < idx.length; k += 3) this.tri(at(ring[idx[k]], y), at(ring[idx[k + 1]], y), at(ring[idx[k + 2]], y));
  }

  mesh(): TriMesh {
    return { vertices: new Float32Array(this.v), indices: new Uint32Array(this.i) };
  }
}

/** Footprint corners (map points) of a prop drawn as a box or a round post. */
export function propFootprint(p: Prop): Point[] {
  const round = PROP_SHAPE[p.kind] === 'cylinder';
  // Props turn by `rot` around three.js +y, which is counter-clockwise seen from above in map space too.
  const [c, s] = [Math.cos(p.rot), Math.sin(p.rot)];
  const local: Point[] = round
    ? Array.from({ length: COLLISION.roundSides }, (_, k): Point => {
        const a = (k / COLLISION.roundSides) * Math.PI * 2;
        return [(Math.cos(a) * p.size[0]) / 2, (Math.sin(a) * p.size[2]) / 2];
      })
    : [
        [-p.size[0] / 2, -p.size[2] / 2],
        [p.size[0] / 2, -p.size[2] / 2],
        [p.size[0] / 2, p.size[2] / 2],
        [-p.size[0] / 2, p.size[2] / 2],
      ];
  // A prop's local z (its depth) is three.js +z, which is map -y.
  return local.map(([lx, lz]): Point => [p.x + lx * c + lz * s, p.y - (-lx * s + lz * c)]);
}

/**
 * A raised road: its sides (to the ground where it's too low to drive under, else just
 * the deck edge), its side barriers where the renderer draws them, and for drivable
 * roads its surface and joint discs. `surface` is the drawn road height above `z`.
 */
function addDeck(structures: Builder, road: Road, surface: number, drivable: boolean, join?: DeckJoin) {
  const shape = road.cls === 'path' ? DECKS.walk : DECKS.drive;
  const { pts, zs } = dedupeWithZ(road.points, road.z);
  if (pts.length < 2) return;
  const { left, right } = deckEdges(pts, road.w / 2, join);
  const ys = zs.map((z) => z + surface);

  for (let k = 0; k < pts.length - 1; k++) {
    const [za, zb] = [zs[k], zs[k + 1]];
    if (Math.max(za, zb) < COLLISION.rampLift) continue; // still road on the ground
    // Sides exactly as drawn: the deck's edge band, open underneath once the deck is high
    // enough (a wall down to the ground there would be invisible), plus the barrier.
    if (Math.max(za, zb) >= DECK_SIDES_FROM) {
      const [ba, bb] = [Math.max(0, za - shape.depth), Math.max(0, zb - shape.depth)];
      const [ra, rb] = [railHeight(za, shape.barrier), railHeight(zb, shape.barrier)];
      structures.quad(left[k], left[k + 1], ba, bb, ys[k] + ra, ys[k + 1] + rb);
      structures.quad(right[k], right[k + 1], ba, bb, ys[k] + ra, ys[k + 1] + rb);
    }
    if (drivable) {
      structures.tri(at(left[k], ys[k]), at(right[k], ys[k]), at(right[k + 1], ys[k + 1]));
      structures.tri(at(left[k], ys[k]), at(right[k + 1], ys[k + 1]), at(left[k + 1], ys[k + 1]));
    }
  }
  if (!drivable) return;
  // Joints: cover the wedge-shaped cracks where the road bends or meets the next piece.
  const r = road.w / 2;
  const rim = r * COLLISION.jointDrop;
  pts.forEach((p, k) => {
    if (zs[k] < COLLISION.rampLift) return;
    const mid = at(p, ys[k] - 0.01);
    const ring = Array.from({ length: COLLISION.jointSides }, (_, n) => {
      const a = (n / COLLISION.jointSides) * Math.PI * 2;
      return at([p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r], ys[k] - 0.01 - rim);
    });
    ring.forEach((q, n) => structures.tri(mid, q, ring[(n + 1) % ring.length]));
  });
}

/** The parts of the map collisions are built from (the optional ones may be missing). */
export type CollisionInput = Pick<MapData, 'buildings' | 'roads'> & Partial<Pick<MapData, 'playable' | 'barriers' | 'trees' | 'fixtures' | 'junctions' | 'pillars'>>;

export function buildCollision(map: CollisionInput, opts: CollisionOptions): CollisionWorld {
  const walls = new Builder();
  const structures = new Builder();
  const counts = { buildings: 0, barriers: 0, edge: 0, posts: 0, decks: 0, footbridges: 0, triangles: 0 };

  for (const bld of map.buildings) {
    if (bld.scenery || (bld.minH ?? 0) > COLLISION.clearance) continue;
    for (const ring of bld.rings) walls.walls(ring, 0, bld.h, true);
    counts.buildings++;
  }

  for (const bar of map.barriers ?? []) {
    if (bar.scenery || bar.points.length < 2) continue;
    walls.walls(bar.points, 0, bar.h, false);
    counts.barriers++;
  }

  if (map.playable && map.playable.length >= 3) {
    walls.walls(map.playable, 0, COLLISION.edgeHeight, true);
    counts.edge = map.playable.length;
    // The concrete row of the roadblocks, so the car stops at something it can see (the loose pieces are physics bodies).
    for (const r of roadblockLayout(map.playable, map.roads, map.buildings)) {
      if (r.kind !== 'concrete') continue;
      walls.walls(roadblockCorners(r.p, r.rot, CONCRETE_SIZE[0], CONCRETE_SIZE[1]), 0, CONCRETE_SIZE[2], true);
      counts.edge++;
    }
  }

  const joins = deckJoins(map.roads);
  for (const road of map.roads) {
    if (!road.z || road.scenery || Math.max(...road.z) < COLLISION.rampLift) continue;
    const drivable = road.cls !== 'path';
    addDeck(structures, road, opts.surfaceY[road.cls], drivable, joins.get(road.id));
    if (drivable) counts.decks++;
    else counts.footbridges++;
  }
  // Pillars and posts, as placed by the pipeline (the renderer draws the same ones).
  // Cap beams on outrigger pillars are overhead, out of the car's way.
  for (const p of map.pillars ?? []) {
    structures.walls(pillarCorners(p), 0, p.top, true);
    counts.posts++;
  }
  for (const j of map.junctions ?? []) {
    if (j.z >= COLLISION.rampLift && j.cls !== 'path') structures.flat(j.ring, j.z + opts.surfaceY[j.cls]);
  }

  const props = [...(map.trees ?? []).flatMap(treeProps), ...(map.fixtures ?? []).flatMap(fixtureProps)];
  for (const p of props) {
    if (!SOLID_PROPS.has(p.kind)) continue;
    structures.walls(propFootprint(p), p.base, p.base + p.size[1], true);
    counts.posts++;
  }

  const out = { walls: walls.mesh(), structures: structures.mesh() };
  counts.triangles = (out.walls.indices.length + out.structures.indices.length) / 3;
  return { ...out, counts };
}
