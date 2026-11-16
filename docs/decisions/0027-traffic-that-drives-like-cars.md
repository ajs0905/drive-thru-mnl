# 0027. Traffic that steers, changes lanes and takes a bump like a car

**Status:** Accepted, 2026-11-16. Builds on ADR 0025 (light traffic) and changes four of its parts: how a car's pose follows its path, lane changes, roundabouts, and what a bump does.

## Context

The light traffic of ADR 0025 kept its cars on smooth paths, but they still looked like markers sliding along lines: the body turned about its middle, going round something was a straight slant in and out, U-turns were hairpins, and a car hit by the player slid off sideways still facing the way it was going. Cars also went round BGC's traffic circles (Gomez, Burgos and Zamora Circle, De Jesus Oval) for good: at each node on the ring, carrying on round is "straight on", which the route choice favors three to one. And the city felt empty for Metro Manila. Phone tests showed traffic cost no frames on either phone, so there was room for more.

## Decision

- **A bicycle model on the path.** The simulation keeps a car's place along its path as before (the driver model, junctions and lanes work on that), but the pose comes from two axles a wheelbase apart (60% of the car's length): the front axle on the path half a wheelbase ahead, the rear axle dragged after it (a tractrix: it moves straight toward the front axle, keeping the wheelbase). The body points from rear to front, so it turns with the turning radius and the rear cuts inside a bend, and the front wheels' angle is the path's direction at the front axle against the body's. It's the kinematic bicycle with the front axle tracking the path exactly, so the car never wanders off its lane and there is nothing to tune or to go unstable.
- **Body lean**: the drawn body pitches with braking and acceleration and rolls with sideways acceleration (speed times how fast it's turning), on the same slightly bouncy spring as the player's car (`car/bodyMotion.ts`). Looks only; the wheels and the physics body stay flat.
- **Sideways moves as S-curves**: going round something stopped, changing lanes and easing back onto a lane after a knock all move the car across with a quintic smoothstep (no sideways speed or acceleration at either end) over 12 to 20 m of road, by speed. Going round something it's stopped behind may also progress by time (no slower than 2 s), so a car never waits forever for room it would make by creeping.
- **Lane changes** (a light take on MOBIL): on roads with two or more lanes one way, on the clear part between junctions, at most once per 6 s per car, when the next lane lets it accelerate 0.35 to 0.7 m/s² harder (each car its own threshold) and the car behind there wouldn't have to brake harder than 3 m/s². Nothing from the player's car or a knocked car may be alongside or just ahead in that lane. The car signals through the move.
- **Wider U-turns**: a U-turn's curve is a half circle plus 2 m (it was pinched to 38% of one), taken at 3.5 m/s.
- **Roundabouts**: the pipeline keeps OSM's `junction=roundabout` and `junction=circular` as `roundabout` on the roads (49 road pieces, 36 of them one-way). A car picks its exit as it gets onto the ring (any road out but the one it came in on, the ones carrying on in its direction more often), keeps to the ring until there, moves to the outer lane of a two-lane ring before the exit and signals. Half a lap past its planned exit it takes the next one, whatever it was. Ring speed is capped at 7 m/s.
- **Turn signals** before turns (35 m) and through them, and through lane changes, drawn as blinking amber halos on that side.
- **A bump is a collision between two cars.** Traffic in the flow stays kinematic (it follows the simulation exactly; the alternative, dynamic bodies driven by velocity every step, would push each other around in tight junction curves and slide on the ground). So the contact itself only bounces the car that hit, as off a wall. When the physics reports a contact between the player's car (or a car already knocked loose) and one in the flow, that car turns dynamic and gets the impulse two cars of these masses would have exchanged (`traffic/impact.ts`): along the struck face's normal, enough to share the closing speed by the masses with a little bounce, plus some drag along the face for a sideswipe, applied at the middle of the contact points. A hit off the car's middle turns it: a tap on a rear corner kicks the nose away. The car that hit gets the opposite impulse on its velocity from before the bump instead of its bounce. Knocked cars stay upright (only the yaw is free), slide sideways on 7 m/s² of tire grip, roll on along their length losing 1.2 m/s², and the box's own friction is low (the lower of the two in a contact counts) so the tires decide it.
- **Back into the flow**: once a knocked car has settled (turning slower than 0.35 rad/s and sliding slower than 0.8 m/s for 0.6 s, at least 1.5 s after the knock) with the player at least 7 m away, it rejoins the lane it's sitting in if it faces along it within 40 degrees, on the clear part of a road, with nobody close. It starts exactly where it is (the sideways offset from the lane's center becomes the start of an S-curve back to it, taken only as it drives off) and its rolling speed carries on. Spun round further than that, it stays knocked and goes once it's far behind, as before.
- **Oncoming carriageways**: a one-way carriageway mapped wider than the gap to the opposite one beside it (38th Street at 10th Avenue) has its room on that side cut to its share of the gap, by width, so cars going opposite ways don't drive through each other. Never below what keeps its lanes 2.4 m wide; the network is the same 68 km.
- **More traffic**: 24, 32 or 40 cars by tier (was 10, 14, 18), appearing 140 to 280 m away and going past 330 m (was 320 and 380), with a slightly shorter IDM headway (1.2 s, 2.2 m standing; was 1.4 s and 2.5 m). Past 60, 90 or 120 m from the camera by tier, a car is drawn as the parked cars' 32-triangle box car (no wheels, halos or sun shadow), one more instanced mesh.

## Measured

Headless (`npm run bench`, a player crossing BGC for five minutes):

| Cars | µs per step | Moving | Overlapping footprints | Touching a parked car | Lane changes |
| --- | --- | --- | --- | --- | --- |
| 10 | 37 | 96% | 0 of 600 | 0 | 4 |
| 24 (Low) | 62 | 91% | 0 of 600 | 0 | 26 |
| 32 (Medium) | 94 | 88% | 0 of 600 | 0 | 36 |
| 40 (High) | 118 | 87% | 0 of 600 | 0 | 63 |

Roundabouts, five minutes with the player parked next to each circle (18 cars before, 32 after): the longest a car stayed on a ring went from 850 m to 199 m on Burgos Circle (262 m round), 1,264 m to 130 m on Gomez Circle (129 m), 787 m to 98 m on Zamora Circle (98 m) and 1,169 m to 197 m on De Jesus Oval (292 m). A test holds every stay under two laps.

In Rapier (`scene/trafficBodies.test.ts`): a 5 m/s tap on a rear quarter turns the car about 27 degrees in 1.5 s, the nose away from the side it was hit; a hit square from behind at 6 m/s shoves it on with under 7 degrees of turn, the player's car keeps going forward, and the car is back in the flow once it has rolled to a rest.

In a headless browser on Low at the start spot (same camera): 67 to 73 draw calls and 246k to 251k triangles with 24 cars, against 74 to 75 and 261k to 262k with the old 10, since most cars are far enough to be box cars.

## Consequences

- The step costs more with more cars (the in-front check looks at every car), about 0.12 ms at 40 on the development laptop: still small next to the frame. To measure on the phones.
- Waits at junctions grow with the count (one movement per junction at a time): cars are moving 87% of the time at 40. Signal phases on the 49 signalized intersections are still the way to more throughput.
- A car spun more than 40 degrees off its lane doesn't rejoin; it waits until it's far behind and goes.
- No police or buses yet; the box car past the near distance can pop to the full model as you close in, like the parked cars.
