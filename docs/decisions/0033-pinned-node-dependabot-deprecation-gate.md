# 0033. Pinned Node, Dependabot and a deprecation gate in CI

**Status:** Accepted, 2026-11-17.

## Context

The game is live and Vercel deploys every push to `main`. Three things could still change it without anyone deciding to:

- CI ran on `lts/*`, so a new Node LTS would have switched CI to it the day it came out, while Vercel and the development laptop stayed where they were.
- Package updates only happened when someone remembered, and every package is pinned exact, so nothing ever moved on its own, security fixes included.
- ADR 0031 removed every deprecation warning, but nothing kept it that way: a library update could bring one back and it would only show up in a console later.

## Decision

- **One Node version everywhere:** `.nvmrc` says 26, CI reads it (`node-version-file`), and `package.json` `engines` says `26.x`, which Vercel uses over its project setting. Moving to a new Node is a change to those two lines, made on purpose. The Node type definitions follow the same major (Dependabot doesn't offer `@types/node` majors).
- **Dependabot** (`.github/dependabot.yml`): weekly npm updates (Saturday morning, Manila time), minor and patch updates grouped into one pull request and each major on its own, and monthly GitHub Actions updates. Each one runs through CI. Rapier's compat package is left out: it stays at 0.19.2 on purpose (ADR 0031).
- **A deprecation gate in three places:**
  - `npm ci` in CI fails on `npm warn deprecated`.
  - `npm test`: a setup file (`tests/setup/noDeprecations.ts`) fails any test file during which a deprecation warning is printed (any console level, or a Node `DeprecationWarning`).
  - `npm run size` runs the production build through `tools/deprecations.ts`, which fails the build on any deprecation line in its output.

  What counts as one is in `tools/deprecations.ts` (`deprecat...` or a Node `DEPxxxx` code), tested against what three.js, wasm-bindgen, Node, npm and Vite print. Both gates were checked by turning the Rapier fix off: the physics tests and the gate's own runner fail.
- **Deploys wait for CI:** Vercel's Deployment Checks are set to wait for the CI job before a production build goes live (a project setting, not in the repo).

## Consequences

- A package an author deprecates upstream fails CI until it's replaced or updated, even with no change in this repo. That is the rule working; the fix is the update, not a way around the check.
- A contributor on another Node major gets npm's engine warning on install; the project still runs on 22.15 or newer.
- Dependabot's commit bodies are its own wording; its subject lines start with a lowercase prefix (`deps:`, `ci:`).
- What the browser prints while playing isn't covered by CI yet: a browser smoke test (play the build headless, fail on console errors and CSP violations) is the next step.
