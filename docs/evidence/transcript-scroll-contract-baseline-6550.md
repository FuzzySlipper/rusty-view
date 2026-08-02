# Transcript scroll semantic contract baseline — task #6550

Captured on 2026-08-02 from the post-churn-fix implementation at the start of
task #6550. The deterministic browser replay is implemented in
`apps/rusty-view-e2e/src/transcript-scroll-contract.spec.ts`; it uses stable
message ids, semantic transcript elements, browser viewport geometry, and the
application-write trace. It does not query CDK wrapper, spacer, range, or
strategy internals.

Command:

```text
pnpm exec playwright test --config apps/rusty-view-e2e/playwright.config.mts apps/rusty-view-e2e/src/transcript-scroll-contract.spec.ts --project=chromium --reporter=line --workers=1
```

Result: 2 passed. Passing means the harness completed and emitted comparable
machine-readable scorecards; individual contract checks retain their strict
pass/fail result instead of being weakened to make the current renderer green.

| Contract check | Current result | Baseline evidence |
|---|---|---|
| Following once per frame | Pass | 72 frames; maximum real bottom error 0px; no reverse-motion frame |
| Idle identical projection | Pass | zero application writes; semantic `scrollTop` was byte-identical before/after (8648px in the final recorded run) |
| First/middle/last navigation and search | Pass | targets reached in 2, 7, and 2 frames in the final run (7–10 frames for the middle target across repeats); at most 13 semantic messages rendered; search reached the streamed completion |
| Session replacement | Pass | first new-session row at frame 4, tail at frame 5, no empty frame, no inherited old-session row; budget 18 frames |
| Paused keyed anchor | **Fail** | the first fully visible keyed message changed during tail growth, new-message arrival, prepend, reasoning expansion, font/code reflow, and delayed image decode |
| Paused application-write ownership | **Fail** | three to four writes after user pause across repeated runs: `seek-estimated-row`, `prepend-anchor-restore`, `seek-rendered-message`, and occasionally `paused-offset-hold` |
| Input modes | **Fail** | wheel/trackpad-style inertia, touch plus post-touch momentum, scrollbar drag, and Latest behaved; PageUp/Home/End did not move the semantic viewport because it is not keyboard-focusable; pre-resume input generated zero application writes |

The two JSON attachments are named
`transcript-scroll-contract-following.json` and
`transcript-scroll-contract-paused.json`. Each uses schema version 1, identifies
the scored implementation, and retains per-check measurements including frame
numbers, bottom error, rendered semantic ids/counts, anchor drift, and
application-write reasons. Alternative renderers can run the same file and
compare the same fields without preserving any CDK implementation detail.

The replay covers:

- streamed reasoning, tool start/completion, Markdown table and highlighted
  code reflow, and terminal completion;
- paused tail growth, new-message arrival, prepend, details expansion, font and
  code reflow, and a delayed 720x480 image decode;
- wheel/trackpad-style inertia, synthetic touch plus post-touch momentum,
  scrollbar drag, PageUp/Home/End, and the actual Latest button;
- byte-identical idle refresh, first/middle/last keyed jump/search, and a
  bounded whole-session replacement.

Exact geometry can vary slightly with browser font rasterization. Contract
thresholds and semantic pass/fail outcomes are stable; the attached JSON is the
authoritative per-run measurement artifact.
