# 0029. Layouts by the app's size, dodges that steer, no redraws for props at rest

**Status:** Accepted, 2026-11-17. Follows ADR 0028.

## Context

Three problems found on the phones and the desktop after ADR 0028:

- On a phone held upright the game is drawn turned sideways (`ui/sideways.ts`), but the sheets' media queries read the window, which is tall and narrow. So inside a wide, short drawing they picked the narrow, one-column layout meant for a tall window: Settings' tiers stacked into strips, the run intro's tiles overlapped its text, the receipt and its summary pushed each other off the screen. The main menu wasn't turned at all, so a phone switched between upright and sideways layouts.
- A dodging car always moved toward the curb, even when the player came down that side, and it moved by time, so a car at a standstill slid sideways about its middle. Its front wheels never turned for any sideways move: their angle came from the lane's direction, not from where the front axle was going.
- Frame drops on the desktop while driving.

## Decision

- **Layouts ask the app, not the window.** `.app` is a CSS size container, and the sheet, menu and loading screen rules are container queries (and `cqw` instead of `vw`). A turned app is as wide as the phone is tall, so it gets the same landscape layouts as a phone held sideways with auto-rotate on. The narrow, scrolling one-column layout stays for windows that really are tall and narrow, with headers that wrap and How to play's button at the bottom.
- **The whole game turns on an upright phone**, the main menu too, so phones are always landscape.
- **A dodge picks its side.** Where the player will be across the car's path when they meet (from where it is and how it moves across, up to 3 s ahead) decides: right if it'll pass down the middle or the car's left, left if down its right. The other side if that one has no room (0.4 m at least) or someone is in the way (alongside, or up to 25 m ahead on a two-way road's oncoming side). The side is kept for the whole dodge.
- **A dodge steers.** The move goes with the car's travel over at least 8 m (or a second of driving), and back the same way; a car slower than 2 m/s when the player comes at it only brakes. The front axle follows the shifted path, the body turns after it (the tractrix rear axle, ADR 0027), and the front wheels point where the front axle goes: the lane's direction turned by the sideways move (capped at 0.6 rad). That last part applies to every sideways move: lane changes and going round stopped cars too.
- **No redraws for props at rest.** `ParkedPoses.set` ignores a pose within 1 mm and 1e-4 (quaternion) of the one it has. Before, a bumped parked car or knocked prop resting in the physics pool rewrote its pose every frame, and the parked cars and all the street furniture were re-laid into their instanced meshes every frame.
- **The sim stays out of the main bundle.** The junction helpers the signals use moved to `traffic/junctions.ts`; an architecture test checks the game, UI and signals import only the sim's types.
- **Lamps only where they can be seen**: signal heads in view and within 260 m.

## Measured

- Phone layouts: every sheet at 760 x 340 (sideways), 412 x 760 turned (upright with the app turned), 412 x 760 not turned (narrow window) and 1280 x 720, in the headless browser with dark mode on: no overlaps or clipping.
- Dodges (`traffic.test.ts`): across six seeds, cars dodge right when the player comes down the middle and left when it comes down their right, never toward it; the front wheels turn toward the dodge on its first frame and the body has turned before the car has moved over 0.4 m; a stopped car doesn't move sideways. The bench still shows no overlapping footprints at 24, 32 and 40 cars (86, 99 and 124 µs per step).
- Desktop (Chrome CPU profile, 25 s on High with draw calls stubbed): the JavaScript per frame was the same before and after ADR 0028 (224 vs 229 ms per second busy). With a parked car shoved early in the drive, its rewrites kept the parked cars' refill at 232 ms per 25 s; after the fix 27 ms, main thread 241 to 211 ms per second. Main bundle 418 KB back to 410 KB gzipped.

## Consequences

- Any new layout rule has to be a container query; a media query would see the upright window again.
- The headless browser can't show a real GPU's frame rate, so the desktop fix is measured in JavaScript time, not FPS; the GPU side (shadow passes, MSAA, resolution) is unchanged by these changes.
- A dodge into the oncoming side of a two-way road is allowed when it's clear; oncoming traffic further than 25 m doesn't stop it.
