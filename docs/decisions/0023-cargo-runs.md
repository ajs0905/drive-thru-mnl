# 0023. Cargo runs: a pure game session, integrity from measured physics, a parody receipt

**Status:** Accepted, 2026-11-16 (revised the same day: curbside bays, gentler cargo rules)

## Context

The first game mode needs a loop on top of free roam: pick a job, drive it, get paid, spend the pay on cars. The v1 plan had ride-hailing with passengers; cargo runs keep the same loop without pedestrian models (none are in the game). The mode has to work on a phone held sideways, be testable without a browser, and leave room for Kamote Mode next.

## Decision

- **Runs are data** (`src/game/events.json`): places anchored to a real road id and a distance along it, runs between two places. Names are made up for the game; the streets are real. A place resolves to a curb spot on that road (the same search as the free-roam start, `car/curbSpot.ts`) and an anchor on the road graph. A test checks every place and run resolves on the real map, so a rebuilt map that loses a road fails CI.
- **The game is plain TypeScript** (`src/game/session.ts`): wallet and save, the run in play, the GPS route. The UI subscribes to it; the scene steps it once per frame with what the car reported; it moves the car through a callback. A whole delivery is played headless in a test, driving the route polyline.
- **A run is a state machine** (`src/game/run.ts`): to the pickup (optional), intro, countdown, running, then done or failed. Arriving means stopping inside the stop's bay (7 by 3 m along the curb, with 0.9 m to spare each way) below 1.5 m/s for 0.8 s. The bay is drawn as a glowing outline with a light curtain over it (it was a 9 m circle and a column at first: a bay says where to park). A curb spot keeps 7 m clear ahead and 8 m behind of parked cars and furniture, so no run starts boxed in and no drop-off has a car in the way. Checkpoints every 400 m along the planned route; "back to the last checkpoint" from the pause menu. A run fails when the cargo is destroyed or it takes twice the target time.
- **Integrity from measured physics** (`src/game/cargo.ts`): crashes cost by their total speed change (once the crash is over, bumps under 3 m/s free, at most 32 per crash), and drifting and hard braking cost a little, only at speed: keyboard brakes are all or nothing, and the physics tests measure a full stop at 8 to 9.5 m/s², so only a full stop from above about 65 km/h counts (1.5 a second), and only a drift above about 43 km/h (2 a second). Normal cornering, light drifts and firm braking are free. Vault cargo minds everything 1.5 times and pays more. (The first numbers, 2 m/s free, 40 per crash, braking from 54 km/h at 4 a second, drifting from 29 km/h at 6, punished normal driving.)
- **The target time** is the route's free-flow time (50 km/h on avenues, 40 on streets, 25 on service roads) times 1.35 plus 15 s, in 5 s steps.
- **The receipt** is a parody of a Philippine delivery receipt: gross fee (base plus per km of the planned route), less a late cut (up to half), plus an integrity bonus (squared, so dents hurt), less 12% VAT and 5% withholding. Damage only shrinks the bonus: there's no separate damage charge.
- **Saves are parsed, not trusted**: one localStorage key read through a parser that keeps only valid fields and clamps the wallet. It isn't anti-cheat (there's no server); it keeps a broken save from breaking the game.

## Consequences

- Runs pay about ₱450 to ₱1,300 each on time; the van, muscle car and coupe cost ₱6,000, ₱15,000 and ₱30,000 (listed, locked until their models are in).
- Keyboard players can only avoid the braking cost by braking earlier or tapping; touch pedals are the same. Analog input (a gamepad) would make it fairer.
- The intro holds the car with the handbrake rather than pausing the physics, so a teleport to the pickup has settled by the time the card closes.
- Kamote Mode can reuse the session, the routing, the markers and the cards.
