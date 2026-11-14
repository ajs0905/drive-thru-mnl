# Models

| File | Source | License |
| --- | --- | --- |
| `sedan.glb` | Sedan from the [Free Low Poly Vehicles Pack](https://rgsdev.itch.io/free-low-poly-vehicles-pack) by Rgsdev (Raphael Gonçalves) | CC0 1.0 (public domain, credit not required) |
| `parked-cars.glb` | Sedan, Hatchback, SUV, Pickup, Van and Taxi from the same pack | CC0 1.0 |

`sedan.glb` was converted from the pack's FBX with `tools/car-to-glb.ts`: scaled to a real sedan's size, materials baked into vertex colors, lamps split out so they can glow. `parked-cars.glb` with `tools/parked-cars-to-glb.ts`: same scale and colors, each car merged into one mesh (wheels and lamps included), with a mask of the painted parts so each parked car can get its own paint.
