# 0031. No deprecated APIs, including the ones dependencies call

**Status:** Accepted, 2026-11-17.

## Context

The live site logged two deprecation warnings on every drive, and the tests printed the second one in six suites:

- `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.` three.js deprecated Clock in r183. The game's own code never creates one: React Three Fiber does, for every canvas (`state.clock`), and 9.8.2, its latest release, still does.
- `using deprecated parameters for the initialization function; pass a single object instead.` Rapier's compat package (0.19.2, pinned in ADR 0008) starts its WebAssembly by passing the module to the generated init function as a bare argument. Rapier 0.20 changed that call to the current form, `{ module_or_path }`.

The rule for the project is no deprecated APIs at all, so both had to go, without waiting for the libraries.

Upgrading Rapier was tried first. 0.21.0 works with `@react-three/rapier` 2.2.0 (one type change, `solverContactPoint` may return null), every physics test passed, and the golden replays drove the same: each cargo run finished within 0.2 s of before and ended 7 to 22 cm away. But its physics code is twice the size in every build: the compat package is 1.65 MB gzipped against 0.86 MB (0.20.0: 1.08 MB), and the separate `.wasm` build 1.17 MB against 0.58 MB. That's about 0.8 MB more for every phone to download before its first drive, to remove one console line.

## Decision

- **Rapier stays at 0.19.2**, and the build makes the one-call change 0.20 made upstream (`tools/rapierInit.ts`): `init(bytes)` becomes `init({ module_or_path: bytes })` in Rapier's compat module. Same engine, same size, same physics.
- **Fiber's clock becomes a Timer.** The build swaps Fiber's `new THREE.Clock()` for the game's `FrameClock` (`src/scene/frameClock.ts`), built on `THREE.Timer` with Clock's fields and behavior (what Fiber and the game read: `getDelta`, `elapsedTime`, `start`, `stop`, `oldTime`), in `tools/fiberClock.ts`.
- **Everywhere the code runs**: both are Vite plugins in `vite.config.ts`, applied to the production build, to the dependencies the dev server pre-bundles (`optimizeDeps.rolldownOptions.plugins`), and to the tests (Rapier is inlined with `test.server.deps.inline`, so the tests start physics through the same fix).
- **Fail loudly, go away quietly.** Each fix does nothing once its library no longer needs it (Fiber without Clock, a Rapier that already calls init the current way). If a library update changes the code in a way a fix doesn't recognize, the build fails instead of keeping the deprecated call.
- **The permissions policy lists only features browsers know.** Chrome logged `Unrecognized feature: 'bluetooth'` on every page of the live site; `bluetooth` is gone from the policy, and a test keeps the list to known names.

## Measured

Before (the live build, played headless under the production headers): three console warnings (the bluetooth policy, the Clock, Rapier's init). After: none from the game, in the production build and in the dev server. Bundle sizes unchanged (Drive 862.1 kB gzipped, main 407.4 kB). The deprecation warning test (`tools/rapierInit.test.ts`) failed before the fix and passes after.

## Consequences

- Two small build steps to keep until the libraries catch up: drop `fiberClock` when Fiber stops creating a Clock (its test notices: no file left to swap), and `rapierInit` when Rapier moves to 0.20 or later (it does nothing then).
- `three` still bundles the Clock class (Fiber keeps the whole three.js namespace for its JSX elements), but nothing constructs it, so it never warns.
- Upgrading Rapier stays possible: it's a size decision, not a compatibility one. If a later version comes back down in size, or the game moves to the separate `.wasm` build, the upgrade is a package bump and `npm run replay`.
