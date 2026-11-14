# 0007: Map QA counts as a CI regression gate

**Status:** Accepted

**Context.** Map problems were found by flying around and taking screenshots: skywalks on mall roofs, floating walkway ends, buildings cutting into roads. Fixing them one by one doesn't stop new pipeline changes from bringing them back.

**Decision.** Every kind of problem found by hand becomes a check in `pipeline/qa.ts` (with camera links to examples). CI compares the counts to `data/qa-baseline.json` and fails if any count goes up. When a fix lowers a count, the baseline is updated in the same commit.

**Consequences.**
- Regressions are caught automatically, and progress is measurable (for example walkways inside buildings 9 → 0).
- Some remaining counts are known and accepted (driveways that really go into buildings). The baseline documents them.
- Checks are heuristics; a passing QA run doesn't prove the map is perfect, so visual checks stay part of the process.
