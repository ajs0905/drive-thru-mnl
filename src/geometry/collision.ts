/**
 * What the car can hit, as one static triangle mesh in three.js space (x east, y up,
 * z south), built once when driving starts and handed to the physics engine.
 *
 * Only vertical walls are needed, since the car stays on the ground (flyover decks come
 * later), so every solid is a ring of upright quads:
 *
 * - Playable buildings: every outline edge, holes included, from the ground to the roof.
 *   Buildings that start above the ground (canopies, skybridges, all well above a car's
 *   roof in this map) and scenery outside the playable area are skipped.
 * - Walls, fences, hedges and guard rails, as thin upright strips. They were already cut
 *   open wherever a road or path passes (pipeline/barriers.ts), so streets stay open.
 * - The playable edge: a tall wall along its outline.
 * - Posts: flyover and footbridge pillars, tree trunks, bollards, concrete blocks and gate
 *   pillars, as small prisms matching what's drawn. Parking booms are left open (they
 *   don't lift yet), and so are gate openings.
 *
 * Triangles go both ways round where it matters: Rapier's triangle meshes collide from
 * either side, which the physics tests check, so thin walls need only one quad.
 */
import type { MapData, Point } from '../map/types';
import { PROP_SHAPE, type Prop, type PropKind } from './props';
import { DECKS, deckPillars } from './road';
import { fixtureProps, treeProps } from './streetProps';

export const COLLISION = {
  /** Height of the invisible wall along the playable edge (m). */
  edgeHeight: 30,
  /** Sides of the prisms standing in for round posts and trunks. */
  roundSides: 6,
  /** Buildings starting higher than this above the ground leave room to drive under. */
  clearance: 2.5,
};

/** Props from trees and fixtures that are solid (the rest, like crowns and boom arms, aren't). */
const SOLID_PROPS = new Set<PropKind>(['trunk', 'palmTrunk', 'pillar', 'post', 'bollard', 'block']);

export interface CollisionMesh {
  /** xyz per vertex, three.js space. */
  vertices: Float32Array;
  indices: Uint32Array;
  /** What went in, for logging and tests. */
  counts: { buildings: number; barriers: number; edge: number; posts: number; triangles: number };
}

class Builder {
  v: number[] = [];
  i: number[] = [];

  /** Upright quad from map point a to b, between two heights. */
  quad(a: Point, b: Point, bottom: number, top: number) {
    const n = this.v.length / 3;
    this.v.push(a[0], bottom, -a[1], b[0], bottom, -b[1], b[0], top, -b[1], a[0], top, -a[1]);
    this.i.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }

  /** Upright quads along a closed ring (or an open line). */
  walls(points: Point[], bottom: number, top: number, closed: boolean) {
    const last = closed ? points.length : points.length - 1;
    for (let k = 0; k < last; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      if (a[0] !== b[0] || a[1] !== b[1]) this.quad(a, b, bottom, top);
    }
  }

  /** A prism standing on its footprint corners (map points). */
  prism(corners: Point[], bottom: number, top: number) {
    this.walls(corners, bottom, top, true);
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

export function buildCollision(map: Pick<MapData, 'buildings' | 'roads' | 'playable' | 'barriers' | 'trees' | 'fixtures'>): CollisionMesh {
  const b = new Builder();
  const counts = { buildings: 0, barriers: 0, edge: 0, posts: 0, triangles: 0 };

  for (const bld of map.buildings) {
    if (bld.scenery || (bld.minH ?? 0) > COLLISION.clearance) continue;
    for (const ring of bld.rings) b.walls(ring, 0, bld.h, true);
    counts.buildings++;
  }

  for (const bar of map.barriers ?? []) {
    if (bar.scenery || bar.points.length < 2) continue;
    b.walls(bar.points, 0, bar.h, false);
    counts.barriers++;
  }

  if (map.playable && map.playable.length >= 3) {
    b.walls(map.playable, 0, COLLISION.edgeHeight, true);
    counts.edge = map.playable.length;
  }

  for (const road of map.roads) {
    if (!road.z || road.scenery) continue;
    for (const p of deckPillars(road.points, road.z, road.cls === 'path' ? DECKS.walk : DECKS.drive)) {
      const s = p.size / 2;
      b.prism([[p.x - s, p.y - s], [p.x + s, p.y - s], [p.x + s, p.y + s], [p.x - s, p.y + s]], 0, p.top);
      counts.posts++;
    }
  }

  const props = [...(map.trees ?? []).flatMap(treeProps), ...(map.fixtures ?? []).flatMap(fixtureProps)];
  for (const p of props) {
    if (!SOLID_PROPS.has(p.kind)) continue;
    b.prism(propFootprint(p), p.base, p.base + p.size[1]);
    counts.posts++;
  }

  counts.triangles = b.i.length / 3;
  return { vertices: new Float32Array(b.v), indices: new Uint32Array(b.i), counts };
}
