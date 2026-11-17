# 0030. Static hosting on Vercel: security headers, caching, guards against bad saves and lost graphics

**Status:** Accepted, 2026-11-17.

## Context

The game is going live on Vercel's free (Hobby) plan: 100 GB of transfer and a million requests a month, for a personal, non-commercial project. It's only static files: no server code, no accounts, no API. What the browser runs is still exposed: anything can be put in its saved data, in the URL, or around it in a frame, and a phone can drop the page's graphics at any time. A security checklist asked for long-term caching of everything, a set of security headers, hardened saves, recovery from lost graphics, and dependency and secret checks.

## Decision

- **Headers in `vercel.json`, on every file**: a content security policy that allows only the site's own files (scripts, styles, images, fonts, fetches), plus `'wasm-unsafe-eval'`, which Rapier's WebAssembly needs to compile and which allows no other eval; inline styles (React's `style` props); `data:` and `blob:` for images and fetches (the 3D models' textures and the sign canvas). No objects, no frames around it (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), no forms, no `<base>` changes. Also `nosniff`, `strict-origin-when-cross-origin`, a permissions policy that turns off camera, microphone, location, payment and USB-type devices, `Cross-Origin-Opener-Policy: same-origin`, and HTTPS only for two years. Checked by `tests/vercel.test.ts`, and the whole game was played through under these headers in a headless browser with no violations reported.
- **Caching that can't strand anyone.** Only Vite's hashed files (`/assets/*`, a new name whenever the content changes) are cached for a year as immutable. The page itself is `no-cache`. The map file, the models and the pictures keep their names between releases, so they're re-checked with the server on every visit (an unchanged file costs a tiny "not modified" answer, not a download). Caching those for a year, as the checklist suggested, would have left returning players on an old map with new code after the next update.
- **HSTS without `preload` and `includeSubDomains`**: those two commit a whole domain and its subdomains to HTTPS in browsers' built-in lists, which only makes sense for a custom domain you own and choose to submit; on a `vercel.app` address they add nothing.
- **Saves**: the parser already built a fresh save from known fields; it now also drops best-time ids that don't look like the game's run ids, which keeps `__proto__` and `constructor` out (a `"__proto__"` key in the saved JSON used to replace the best-times object's prototype; nothing reached the global one). Tested with hostile saves.
- **Lost graphics**: when the browser drops the WebGL context, a card says so over everything and the drive pauses; three.js restores it when the browser allows, with a reload button if it doesn't. Leaving the tab while driving pauses the game.
- **A lost car**: a player car whose position or rotation isn't a number, or that's over 10 km out, goes back to where it last was fine; a traffic car with bad numbers is dropped. The physics already runs at a fixed 60 Hz with the frame time capped at half a second, so a long frame can't make it tunnel.
- **Supply chain**: `npm audit` finds no vulnerabilities (2026-11-17), `package-lock.json` is committed and CI installs with `npm ci`, fonts and the physics engine are bundled (no third-party CDN at run time), no secrets or environment variables are used, and source maps stay off.

## Measured

The whole build is 2.6 MB compressed; a first visit downloads about 2.4 MB (the scripts, the map, the models and the menu picture). At that size 100 GB is about 40,000 first visits a month, and return visits mostly get "not modified" answers.

## Consequences

- The game can't be embedded in another site (an itch.io page, a portfolio iframe). Linking to it works; allowing a specific site to frame it means adding it to `frame-ancestors`.
- Anything new from another origin (analytics, a font service, a model host) has to be added to the policy, on purpose.
- Vercel's toolbar on preview deployments loads from another origin and is blocked by the policy; the production site doesn't use it.
- Giving the map file a hashed name would let it be cached for good too; it would mean changing how the pipeline's output reaches the build.
