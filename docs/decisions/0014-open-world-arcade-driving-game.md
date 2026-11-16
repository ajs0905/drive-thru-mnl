# 0014. An open-world arcade driving game

**Status:** Accepted, 2026-11-14

## Context

Up to the drivable car milestone the project was "a driving game" without a genre, and the choice decides a lot: how real the handling should be, what crashes look like, what the map is for, and what comes after free driving. Three directions fit what the pipeline builds:

| Type | Physics | Fit |
| --- | --- | --- |
| Open-world cruiser: free driving, no goals | Arcade | Good, but little to do once you've seen the map |
| Arcade racer: races and chases through a city | Arcade, with showy crashes | Good, needs routes and events |
| Driving simulator | Realistic, soft-body or detailed tires | Too heavy for phones, and not what a real-map city is best at |

## Decision

**Open-world arcade driving: free roam through real Manila, with events started from spots on the map.**

- Free roam comes first: the real city is the main attraction.
- Events build on it: checkpoint time trials and races through real streets first, chases later.
- Handling is arcade (forgiving, drift-friendly, readable crashes) on real physics ([ADR 0008](0008-car-physics.md)).
- "No Traffic Edition" stays true for now; traffic and police are possible later, and the physics choice leaves room for them.

## Consequences

- Build order: a car that drives well, then collisions and respawn (an unfair wall hit ruins a timed run), then the first time trial.
- Map work is judged by how it drives, not only how it looks: solid buildings, drivable flyovers, readable streets.
- Simulator features (manual clutch, realistic damage, traffic rules) are out of scope.
