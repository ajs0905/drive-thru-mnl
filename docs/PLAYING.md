# Controls and modes

How to play Drive Thru MNL, what there is to do, and the options for testing. Play it at **https://drive-thru-mnl.vercel.app/**, on a desktop or a phone, nothing to install.

Related: [README](../README.md), [ARCHITECTURE.md](ARCHITECTURE.md) (how each part works), [all docs](README.md).

## Controls

| Action | Keyboard | Phone (held sideways) |
| --- | --- | --- |
| Drive | W A S D or the arrow keys | Steering arrows bottom left, brake and gas bottom right |
| Handbrake and drift | Space (tap it mid-turn, stay on the gas to hold the slide) | Handbrake button beside the pedals |
| Reset the car | R (also after two seconds stuck upside down) | Reset button top right |
| Map | M | Tap the minimap |
| Pause | Esc (also when you leave the tab) | Pause button top right |
| Modes and cars | MODES / CARS button top right, or the pause menu | Same |

On a phone held upright, the drive turns sideways to fill the screen; the menus stay upright. The How to play card opens on the first drive and any time from the pause menu.

## Free roam

Drive BGC's real streets as they're mapped in OpenStreetMap, with less traffic than the real thing (hence the name, and the question mark). Take the flyovers, drift the circles, find shortcuts.

- **Traffic:** 24 to 40 cars around you, by quality tier. They follow the cars ahead, change lanes with the signal on, work their way round the circles, stop at red lights (you don't have to), and steer out of your way when you come at them fast. Bump one and it spins; it gets back in line once it settles.
- **Things you can hit:** cones, drums and barricades at the edge of the map go flying; the concrete barriers don't move. Street lights, traffic lights, signs, planters, bins and hydrants can be knocked over, waiting sheds and kiosks smashed through. Parked cars can be shoved, and go back to their spots once you look away.
- **Edge of the map:** the playable area ends at construction hoarding and roadblocks; the city past it is scenery.

## Cargo runs

Seven runs between curbside loading bays and landmarks, picked from MODES / CARS (each shows its route on the map, distance and target time first).

- **Courier runs:** parcels, bread and pastries, store stock, fruit and vegetables, phones and laptops.
- **Vault runs:** sealed cash boxes and framed paintings. They pay more, and the cargo minds rough driving 1.5 times as much.
- **How a run goes:** drive to the pickup bay and stop inside it, watch the countdown, then follow the GPS route on the minimap and the full map to the drop-off and stop in its bay. Checkpoints every 400 m along the route; leave it for long and the route is planned again from where you are.
- **Cargo integrity:** starts at 100%. Crashes cost the most (by how hard you hit); hard braking from above about 65 km/h and drifting above about 43 km/h cost a little. Normal cornering and firm braking are free.
- **Pay:** a delivery receipt with the base and distance fee, a bonus for integrity, 12% VAT and 5% withholding tax, paid into your peso wallet. Over twice the target time, or cargo destroyed, and the run fails.
- **Best times** are kept per run, in your browser.

## Cars

The Sedan is yours from the start. The CARS tab shows the next ones with their prices to save up for: a Cargo Van (₱6,000), a Muscle Car (₱15,000) and a Sports Coupe (₱30,000). They arrive with the coming updates; see [Planned](../README.md#planned).

## Saves

Pesos, cars, best times and settings are saved in your browser (one local storage key), and read back through a validator: an old, damaged or hand-edited save can't break the game, it just falls back to defaults for what doesn't make sense. Nothing is sent to a server.

## Graphics quality

Settings (from the menu or the pause menu) has three tiers. The game picks one on the first visit: Low on touch screens, Medium on machines with 4 GB of memory or 4 CPU cores or fewer, High otherwise. Your choice is remembered.

| | Low (phones) | Medium (most) | High (fast GPU) |
| --- | --- | --- | --- |
| Shadows | Off | Soft | Sharp |
| Trees | Simple | Full | Full |
| Traffic | 24 cars | 32 cars | 40 cars |
| Speed blur | Off | On | On |
| Resolution | 60 to 100% | 75 to 125% | 100 to 125% |

The resolution moves within its range with the frame rate. Settings also has "Show FPS & render stats" (frame rate, draw calls and triangles while driving).

## Options for testing

Added to the address, for development and bug reports:

| Option | What it does |
| --- | --- |
| `?q=low`, `?q=medium`, `?q=high` | Force a quality tier |
| `?debug` | Frame rate, draw calls, triangles and build time, on the menu too |
| `?view=map` | Free camera map view, the one map QA's links open |
| `?cam=x,y,z,tx,ty,tz` | Put the camera at a spot looking at another (three.js coordinates); include it with bug screenshots |
| `?render=always` | Draw every frame, even when nothing changes |
