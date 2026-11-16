# 0022. Road graph built at load time, routes by ALT

**Status:** Accepted, 2026-11-16

## Context

The game modes need routes: the minimap's GPS line to a loading bay, expected times for the cargo runs, and later the traffic and the police finding their way. The map data has roads but no graph: roads are split where they meet, so meeting roads share an end point, but nothing says which roads connect or which way one-way roads can be driven.

Two questions: where to build the graph (in the pipeline, stored in the map file, or in the browser when the map loads), and which search to run on it.

## Decision

- **Built at load time** (`src/routing/graph.ts`), not stored. Nodes are road ends (keyed by position and height, so a ramp's foot and the deck above it stay apart), each drivable road is one edge or two (one per direction). On BGC that's 1,870 nodes and 3,376 directed edges in about 50 ms. The map file stays the same, and nothing can drift between a stored graph and the roads it was built from.
- **The main network** is the largest strongly connected component (Tarjan's algorithm, iterative). Routes and traffic stay in it; one-way stubs cut off by the playable edge fall outside.
- **Edge-based search** (`src/routing/search.ts`): a state is "just drove edge e", so turns can cost something. A U-turn onto the same road's other direction costs 30 s: allowed (dead ends, a car facing the wrong way), never chosen when another way is close. Start and goal are points part way along edges.
- **ALT** (`src/routing/landmarks.ts`): A* with lower bounds from 8 landmarks and the triangle inequality, picked far apart by travel time. Precompute is two Dijkstras per landmark (about 20 ms, 117 KB as Float32). The bound is never below the straight-line one, and both never overestimate, so routes stay optimal.
- **Measured** (`npm run bench`, 1,000 seeded random routes; all three methods return the same costs):

| Method | States expanded (mean / p95) | Time per route (mean / p95) |
| --- | --- | --- |
| Dijkstra | 1,580 / 3,061 | 0.29 / 0.56 ms |
| A* (straight line) | 677 / 1,820 | 0.18 / 0.50 ms |
| ALT (8 landmarks) | 210 / 672 | 0.09 / 0.26 ms |

- A map QA check, `road-island`, counts roads in pieces of the network that join no other road (away from the playable edge): 24 roads, about 1 km, mostly crossings drawn without a shared node. Its baseline can only go down.

## Consequences

- Routing is cheap enough to re-plan whenever the car leaves the route, and for many agents at once later on.
- At BGC's size even Dijkstra is fast; ALT is chosen because it scales: on a metro-sized graph (hundreds of thousands of nodes) the gap in states expanded grows, and Contraction Hierarchies would be the next step there, not here.
- The graph knows no turn restrictions or lane connections: OSM's turn restriction relations aren't in the export. Every turn at a node is allowed except that U-turns cost extra.
- The load-time build adds about 70 ms (graph and landmarks) when driving starts; it could move to the Web Worker planned for the city build.
