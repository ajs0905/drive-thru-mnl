/**
 * Junctions as the traffic sees them: graph nodes joined by roads too short to wait on are
 * one junction (a divided avenue's crossing is two or more nodes a few meters apart). The
 * sim reserves them and the signals cycle them. Kept apart from the sim so the signals
 * (built by the game session, in the main bundle) don't pull the sim in with them.
 */
import type { GraphEdge, RoadGraph } from '../routing/graph';

/** Nodes joined by a road with less than this (m) between the junction polygons at its ends are one junction (the links across a divided avenue's median). */
export const JUNCTION_CLUSTER = 15;

/** Is this road part of a junction: too little of it between the junction polygons at its ends to wait on? */
export function internalEdge(e: GraphEdge): boolean {
  return e.length - e.trimStart - e.trimEnd < JUNCTION_CLUSTER;
}

/**
 * The junction each graph node belongs to: nodes joined by roads too short to wait on
 * (`internalEdge`) are one junction, so a divided avenue's crossing is reserved, and
 * signalled, as one. Union-find; the value is a node id standing for its group.
 */
export function junctionGroups(graph: RoadGraph): Int32Array {
  const parent = Int32Array.from(graph.nodes.keys());
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const e of graph.edges) if (internalEdge(e)) parent[find(e.from)] = find(e.to);
  return Int32Array.from(graph.nodes.keys(), (v) => find(v));
}
