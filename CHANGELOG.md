# Changelog

What changed in each release of Drive Thru MNL: No Traffic Edition?, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/): below 1.0, a new mode or big feature raises the middle number and fixes raise the last one.

## [Unreleased]

Nothing yet. Next up: Kamote Mode (police pursuit), see [Planned](README.md#planned).

## [0.1.0] - 2026-11-17

The first public release, live at https://drive-thru-mnl.vercel.app/.

### The city

- Bonifacio Global City (BGC), Taguig, built from real OpenStreetMap data as a drivable low-poly 3D city: 11,685 buildings and 3,536 roads, with filler city and real skylines past the edge.
- An 18-step build-time pipeline that turns the raw OpenStreetMap export into one compact, deterministic map file: building heights and forms (hip roofs, podium towers, shopfronts), flyovers and ramps with pillars, junction polygons, zebra crossings, walled-off empty lots, parked cars, street and traffic lights, stop, one-way and speed limit signs, and street furniture, all placed by rule.
- 33 automated map QA checks, run in CI as a gate that can only go down.

### Driving

- Arcade handling on Rapier physics at a fixed 60 Hz: drift assist, a hidden automatic gearbox, body lean and a chase camera that stays out of walls.
- Solid buildings and walls, drivable flyovers, and things to hit: street lights, traffic lights, signs and street furniture to knock over, waiting sheds and kiosks to smash through, parked cars and roadblocks to push around.
- Reset to the nearest open road (R, or automatically when stuck upside down).

### Modes and traffic

- Free roam, and seven cargo runs (five courier, two vault) between curbside loading bays and landmarks, with A\* routing, a GPS route on the minimap and the full map, checkpoints, a cargo integrity rating and an itemized delivery receipt paid into a peso wallet. Best times are kept per run.
- A CARS tab with pictures drawn from the models and prices to save up for (the Sedan is drivable; the others arrive in later releases).
- Traffic: 24 to 40 cars by quality tier that follow the road graph, change lanes with their signals on, queue at cycling traffic lights, find their way off roundabouts, dodge you when you come at them fast, and spin when bumped before getting back in line.

### Phones and quality

- Touch controls for a phone held sideways; on an upright phone the drive turns sideways and the menus stay upright.
- Low, Medium and High quality tiers, picked automatically on the first visit, with adaptive resolution and render on demand. Measured at 60+ FPS on Low and Medium on a low-mid range Android phone.
- Menus styled as Philippine road signs, a heading-up minimap, a full map, and a How to play card for keys or touch.

### Hosting

- Static files on Vercel with no backend: a strict content security policy and security headers, caching that never strands players on old files, saves that can't break the game when edited or damaged, recovery when the graphics are lost.
- Link previews for chat apps and social sites, and visitor counts with Vercel Web Analytics (cookieless, production only).

### Engineering

- 799 unit and physics tests, golden replays of cargo runs driven by an autopilot in the real physics, enforced module boundaries, and size budgets per build chunk.
- No deprecated APIs, including inside dependencies; deprecation warnings fail CI. One pinned Node version (26) for CI and Vercel, and Dependabot update pull requests.
- 33 decision records in [docs/decisions](docs/decisions/).
- Bug report and feature request forms for [GitHub Issues](https://github.com/ajs0905/drive-thru-mnl/issues/new/choose).

[Unreleased]: https://github.com/ajs0905/drive-thru-mnl/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ajs0905/drive-thru-mnl/releases/tag/v0.1.0
