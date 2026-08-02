# Transcript owned-pin window scorecard and architecture decision — task #6553

Captured 2026-08-02 against the debug/test-only
`?__rvTranscriptRenderer=owned-window` candidate. This spike exists only to
compare the dimension that rejected Option B; production still selects the
current CDK renderer until task #6554 replaces it and removes both bake-off
paths.

## Decision

Select **chronological owned-pin keyed windowing** (Option B's single-writer
pin model plus bounded DOM residency) for the production replacement.

The selected shape is not reverse flow and is not a new virtualizer:

- all projected messages remain searchable in chronological data order;
- at most 64 consecutive keyed rows are resident, in chronological DOM order;
- conservative top/bottom spacers provide progressive extent but never own
  the pinned bottom;
- following has one rAF-coalesced application writer;
- paused growth has zero application writes and native anchoring owns the
  visible key;
- search/jump moves the keyed window directly around first, middle, or last
  targets without rendering intermediate history;
- explicit End places the tail window before one user-authority semantic tail
  scroll;
- resident rows do not use `content-visibility`, removing Option B's cold
  materialization failure inside the bounded window.

This is the least-complex candidate that passes the measured ship gate. The
fixed 120px off-window estimate affects progressive thumb position only; a
perfectly proportional full-history thumb is explicitly not a product
requirement under task #6551.

## Same-contract result

Commands:

```text
RV_TRANSCRIPT_RENDERER=owned-window RV_TRANSCRIPT_REQUIRE_PASS=1 \
  pnpm exec playwright test \
  --config apps/rusty-view-e2e/playwright.config.mts \
  apps/rusty-view-e2e/src/transcript-scroll-contract.spec.ts \
  --project=chromium --workers=1

RV_TRANSCRIPT_RENDERER=owned-window RV_TRANSCRIPT_REQUIRE_PASS=1 \
  pnpm exec playwright test \
  --config apps/rusty-view-e2e/playwright.config.mts \
  apps/rusty-view-e2e/src/transcript-scroll-contract.spec.ts \
  --project=firefox --workers=1
```

Both engines passed all three tests and every fail-closed report cell. The
92-row deterministic fixture crossed the 64-row boundary:

| Invariant | Chromium | Firefox |
|---|---:|---:|
| Following, 72 frames | Pass, max bottom error 0px | Pass, max 0.5px |
| Identical idle projection | Pass, zero writes and unchanged offset | Pass |
| First/middle/last jump + search | Pass, each visible in one frame, max 64 resident | Pass, same |
| Session replacement | Pass, new tail frame 4, no empty/inherited frame | Pass, frame 4 |
| Six paused late-layout mutations | Pass, 0px across every sample | Pass, 0px |
| Paused application ownership | Pass, zero writes | Pass, zero writes |
| Wheel/touch/drag/PageUp/Home/End/Latest | Pass | Pass; synthetic TouchEvent unavailable |

The window retains the current first resident key across paused projection
updates and prepends. Search and explicit target navigation reposition the
window before the one semantic seek, so the contract's first/middle/last proof
does not depend on overscan or an unbounded render.

## Scale scorecard

Reproduction:

```text
RV_TRANSCRIPT_RENDERER=owned-window \
  RV_TRANSCRIPT_DEPTHS=250,1000 RV_TRANSCRIPT_REPEATS=3 \
  node scripts/measure-transcript-browser.mjs

RV_TRANSCRIPT_RENDERER=owned-window \
  RV_TRANSCRIPT_DEPTHS=5000,10000 RV_TRANSCRIPT_REPEATS=1 \
  node scripts/measure-transcript-browser.mjs
```

Chromium 149 at 1440×1000. The 250/1k values are three-run medians; 5k/10k
are single diagnostic runs and cannot override the real 1k ship gate.

| Messages | Switch | Search | Input frame | Transcript nodes / resident messages | Heap | Phase max long task | Cold key drift |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 250 | 144.2ms | 69.7ms | 1.3ms | 1,316 / 64 | 8.4MiB | load 89ms; others 0ms | 0px in 3/3 |
| 1,000 | 168.9ms | 103.0ms | 2.3ms | 1,316 / 64 | 9.6MiB | load 86ms; search 55ms; switch 64ms | **0px in 3/3** |
| 5,000 diagnostic | 275.7ms | 196.3ms | 6.4ms | 1,316 / 64 | 16.5MiB | switch 173ms | 0px |
| 10,000 diagnostic | 947.8ms | 359.1ms | 9.1ms | 1,316 / 64 | 25.1MiB | switch 838ms | 0px |

At 1k, all frozen task #6551 budgets pass: switch under 250ms, search under
300ms, input frame under 50ms, no input long task, switch/search tasks under
150ms, heap under 256MiB, document nodes under 150k, and the same cold key at
0px drift on every sampled frame. Unlike full DOM, cold history recorded zero
per-frame extent, offset, and thumb-fraction change after window placement.

The synthetic initial-load wall clock includes service/browser startup and was
noisy across repetitions; phase-attributed long tasks are retained as the
actionable measurement. At 5k/10k the candidate completes the diagnostic
search and switch paths that full DOM could not make actionable, but the 10k
switch remains outside stretch budgets and is not a demonstrated product
requirement.

## Rejected alternatives

- **Plain full DOM (Option B): rejected.** It is the semantic simplification
  baseline, but its 1k cold key moved 51px and Firefox End can intermittently
  land above the eventual bottom as skipped rows materialize. Adding a
  settlement loop would restore competing scroll authority.
- **Reverse-flow two-ended window (Option A): not selected.** Bounded DOM was
  achievable without reversing DOM/log order, so accepting newest-first screen
  reader traversal, reversed find/selection semantics, and mobile
  column-reverse risk has no measured justification. No architecture-theater
  A spike is needed.
- **Index virtualizer (Option C): not selected.** The simpler keyed window
  passes the real 1k gate and retains exact pinned/paused semantics. A measured
  future distribution materially beyond 1k plus a failure of this window is
  required before reconsidering a virtualizer.
- **Current CDK autosize control system: rejected as the end state.** It remains
  production only until #6554; it cannot be retained as a hidden second mode.

## Production migration and deletion list

Task #6554 must turn the selected debug candidate into the sole path and:

1. replace the URL switch and prototype names with explicit production state;
2. preserve the public `TranscriptViewportComponent` inputs/outputs and RP
   extension surface;
3. harden progressive window shifts, keyed prepend retention, focus, selection,
   and touch/scrollbar interaction at window boundaries;
4. retain one application writer and zero paused writes;
5. delete `CdkAutoSizeVirtualScroll`, its viewport wrapper, private
   `_scrollStrategy` access/reattach, estimator size reconciliation,
   `MAX_SAFE_INTEGER` seeks, 50ms/rAF settlement and paused-offset loops, and
   Resize/Mutation observers used as scroll clocks;
6. delete the full-DOM and current-renderer bake-off branches and all CDK
   selector acceptance tests;
7. make the semantic harness fail closed for the sole production renderer;
8. update architecture comments that still promise 10k CDK virtualization.

## Certification limitation and expiry

Local WebKit cannot launch because required host libraries are absent, and no
physical Android Chrome/iOS Safari or screen-reader device was available.
Rusty Roleplay was not run against a published exact candidate package. These
are active certification limitations, not inferred passes.

They expire only when #6554's sole production path and #6555's cross-consumer
certification pass Chromium, Firefox, WebKit, physical Android/iOS momentum and
installed-shell smoke, keyboard focus/selection across window boundaries, and
the Rusty Roleplay decorated transcript. A failure may revise this decision
before release; it must not revive a long-lived dual production mode.
