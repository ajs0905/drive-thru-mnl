# 0032. Visitor analytics and link previews

**Status:** Accepted, 2026-11-17.

## Context

The game is live at https://drive-thru-mnl.vercel.app/ and its link goes out with internship applications. Two things were missing: knowing whether anyone opens it (and from what kind of device), and a proper preview card when the link is pasted into a chat app or a social site (the page had no description and no picture for them).

The constraints from ADR 0030 stay: no third-party scripts or origins at run time, a strict content security policy, nothing that can strand a player on old files.

## Decision

- **Vercel Web Analytics**, through `@vercel/analytics` 2.0.1 (pinned exact), started in `src/analytics.ts`. It counts page views without cookies. On the free plan that's 50,000 events a month with a month of history; past that, collection pauses and the site keeps running.
- **Only on the deployed production build.** `shouldTrack` skips the dev server (not a production build), `npm run preview`, and any address on this machine or the local network (localhost, loopback, the private IPv4 ranges, `.local` names), so testing never loads the script or counts a visit. In production the script and its reports go to the site itself (`/_vercel/insights/...`), so the content security policy needs no outside address. Checked in a headless browser under the production headers with a stand-in script: both the script and its reports went through with no violations.
- **Pages without their query string.** `?debug`, `?cam=...` and the like are testing options, not pages, so the URL is cut at `?` or `#` before it's reported.
- **Link previews in `index.html`**: a description, a canonical address, Open Graph tags and a large-image card, with a 1200 x 630 picture (`public/og.jpg`, cropped from the README's hero shot with the title in the game's font and colors). Checked by `tests/pageMeta.test.ts` (the tags, the full address of the picture, that it ships with the site and its size).

## Consequences

- About 1 KB more in the main chunk (gzipped).
- Web Analytics has to be turned on in the Vercel project (Analytics tab) for the script to exist; without it, the browser logs that `/_vercel/insights/script.js` failed to load and nothing else changes.
- Speed Insights is left off: a small free allowance, and scores made for ordinary pages, not a 3D game. Frame rate, draw calls and triangles (`?debug`) say more here.
- Counting what players do (drives started, runs finished) would need custom events; not done.
- The preview picture keeps its name between releases, so it's re-checked on each visit like the other unhashed files (ADR 0030). Chat apps cache previews on their side; a new picture can take a while to show there.
