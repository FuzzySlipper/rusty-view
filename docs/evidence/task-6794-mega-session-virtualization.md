# Task 6794 mega-session virtualization evidence

Captured 2026-08-12 against deployed Rusty View revision
`8e433b4f10303b8fd60d5b8f6f4d6581afec707f` at the debug service on port
9348. The fixture uses deterministic synthetic transcript content and records
aggregate browser measurements only.

## 10,000-message scale run

Command:

```text
RV_TRANSCRIPT_DEPTHS=10000 RV_TRANSCRIPT_REPEATS=1 \
  BASE_URL=http://127.0.0.1:9348 \
  node scripts/measure-transcript-browser.mjs
```

Chromium 149.0.7827.55 completed one of one runs.

| Measurement | Result |
|---|---:|
| Projected messages | 10,000 |
| Resident transcript messages | 64 |
| Transcript DOM nodes | 1,396 |
| Total document nodes | 41,521 |
| Used JavaScript heap | 27,145,767 bytes |
| Input next frame | 13.0 ms |
| Initial load | 2,882.2 ms |
| Search to middle target | 3,016.2 ms |
| Session replacement | 2,004.4 ms |
| Maximum long task | 1,060 ms |

The resident transcript window stayed at the implementation's deliberate
64-row bound. The 10,000-message path remained searchable and interactive, but
the cold switch and search costs are diagnostic limitations worth retaining;
bounded DOM does not make projection and search over the full in-memory array
constant time.

The scale script's cold-history sample reported no scroll offset movement but
could not retain one stable semantic key (`anchorIdStable=false`). That probe
sets an estimated scroll fraction and may land while the owned window is
changing; it is not used alone to certify semantic anchoring.

## Keyed browser scroll contract

Command:

```text
BASE_URL=http://127.0.0.1:9348 npx playwright test \
  --config apps/rusty-view-e2e/playwright.config.mts \
  apps/rusty-view-e2e/src/transcript-scroll-contract.spec.ts \
  --project=chromium --workers=1
```

All three browser tests passed in 10.7 seconds. The contract established a
rendered semantic key before mutation and recorded:

- 64 or fewer resident messages for first, middle, last, and search targets;
- zero-pixel keyed-anchor drift across image decode, tail growth, a new
  message, prepend, reasoning expansion, and font/code reflow (24 animation
  frames per mutation);
- one paused scroll authority, with only coalesced
  `paused-anchor-compensation` writes and CSS native anchoring disabled;
- working wheel/trackpad, touch, scrollbar drag, Home, End, and resume-latest
  behavior;
- a bounded session replacement with no inherited rows or empty semantic
  frame.

This stricter contract distinguishes the scale probe's missing anchor from a
renderer regression: once a semantic row is deliberately established, prepend
and variable-height changes retain it without drift.

## Independent product-playtest lane

The configured product-playtest broker was unavailable in this Codex runtime:
none of the required `playtest_*` tools were exposed. That lane is classified
as `infrastructure_error`; it is not represented as visible human-style
acceptance and does not invalidate the deterministic Chromium results above.
