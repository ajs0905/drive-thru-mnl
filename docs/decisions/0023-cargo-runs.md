# 0023. Cargo runs: a pure game session, integrity from measured physics, a parody receipt

**Status:** Accepted, 2026-11-16

## Context

The first game mode needs a loop on top of free roam: pick a job, drive it, get paid, spend the pay on cars. The v1 plan had ride-hailing with passengers; cargo runs keep the same loop without pedestrian models (none are in the game). The mode has to work on a phone held sideways, be testable without a browser, and leave room for Kamote Mode next.

## Decision

- **Runs are data** (`src/game/events.json`): places anchored to a real road id and a distance along it, runs between two places. Names are made up for the game; the streets are real. A place resolves to a curb spot on that road (the same search as the free-roam start, `car/curbSpot.ts`) and an anchor on the road graph. A test checks every place and run resolves on the real map, so a rebuilt map that loses a road fails CI.
- **The game is plain TypeScript** (`src/game/session.ts`): wallet and save, the run in play, the GPS route. The UI subscribes to it; the scene steps it once per frame with what the car reported; it moves the car through a callback. A whole delivery is played headless in a test, driving the route polyline.
- **A run is a state machine** (`src/game/run.ts`): to the pickup (optional), intro, countdown, running, then done or failed. Arriving means stopping within 9 m below 1.5 m/s for 0.8 s. Checkpoints every 400 m along the planned route; "back to the last checkpoint" from the pause menu. A run fails when the cargo is destroyed or it takes twice the target time.
- **Integrity from measured physics** (`src/game/cargo.ts`): crashes cost by their total speed change (once the crash is over, scrapes under 2 m/s free), drifting costs over time, and so does hard braking, but only from speed: keyboard brakes are all or nothing, and the physics tests measure a full stop at 8 to 9.5 m/s², so only a hard stop from above about 54 km/h counts. Vault cargo minds everything 1.8 times and pays more.
- **The target time** is the route's free-flow time (50 km/h on avenues, 40 on streets, 25 on service roads) times 1.35 plus 15 s, in 5 s steps.
- **The receipt** is a parody of a Philippine delivery receipt: gross fee (base plus per km of the planned route), less a late cut (up to half), plus an integrity bonus (squared, so dents hurt), less 12% VAT and 5% withholding.
- **Saves are parsed, not trusted**: one localStorage key read through a parser that keeps only valid fields and clamps the wallet. It isn't anti-cheat (there's no server); it keeps a broken save from breaking the game.

## Consequences

- Runs pay about ₱450 to ₱1,300 each on time; the van, muscle car and coupe cost ₱6,000, ₱15,000 and ₱30,000 (listed, locked until their models are in).
- Keyboard players can only avoid the braking cost by braking earlier or tapping; touch pedals are the same. Analog input (a gamepad) would make it fairer.
- The intro holds the car with the handbrake rather than pausing the physics, so a teleport to the pickup has settled by the time the card closes.
- Kamote Mode can reuse the session, the routing, the markers and the cards.
