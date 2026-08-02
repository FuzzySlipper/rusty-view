# Transcript Option B full-DOM prototype scorecard — task #6552

Captured 2026-08-02 against the debug/test-only full-DOM prototype. The
prototype preserves the existing `TranscriptViewportComponent` inputs/outputs
and chronological DOM order. It is selected only with
`?__rvTranscriptRenderer=full-dom`; there is no user-facing compatibility
option and the production default remains the current renderer.

## Prototype mechanics

- CDK virtualization is absent from the selected prototype DOM path.
- Every stable projected row is rendered chronologically with
  `content-visibility: auto` and `contain-intrinsic-size: auto 120px`.
- The scroller uses `contain: layout paint`, not inherited `contain: strict`.
- Projection changes coalesce one post-render tail placement; late content
  resize requests coalesce through one animation-frame writer.
- Paused scrolling performs zero application-authority writes. Native browser
  anchoring owns tail growth, new rows, prepend, details/font/code reflow, and
  delayed image decode.
- Jump/search performs one idempotent direct `scrollIntoView` against the
  resident keyed row.
- Keyboard scrolling is recorded as user-input authority and remains excluded
  from the zero-application-writes invariant.
- Session replacement retains the prior rows behind the transition overlay
  until the first non-empty replacement projection, then swaps atomically.

## Semantic contract

Commands:

```text
RV_TRANSCRIPT_RENDERER=full-dom pnpm exec playwright test \
  --config apps/rusty-view-e2e/playwright.config.mts \
  apps/rusty-view-e2e/src/transcript-scroll-contract.spec.ts \
  --project=chromium --reporter=line --workers=1

RV_TRANSCRIPT_RENDERER=full-dom pnpm exec playwright test \
  --config apps/rusty-view-e2e/playwright.config.mts \
  apps/rusty-view-e2e/src/transcript-scroll-contract.spec.ts \
  --project=firefox --reporter=line --workers=1
```

Both engines completed all three harness tests. Every machine scorecard check
passed in Chromium. Firefox's report is intentionally retained even when a
cell fails; set `RV_TRANSCRIPT_REQUIRE_PASS=1` to make any failed report cell
fail the Playwright process. An independent review rerun and local repeated
runs exposed an intermittent Firefox End-key failure that the original
shape-only report assertion had hidden.

| Invariant | Chromium | Firefox |
|---|---:|---:|
| Following, 72 frames, ≤1px and no reverse motion | Pass, max 0px | Pass, max 0px |
| Byte-identical idle refresh | Pass, zero writes and unchanged `scrollTop` | Pass |
| First/middle/last jump + search | Pass, visible in one frame each | Pass, one frame each |
| Session replacement | Pass, new row/tail frame 4, no empty/inherited frame | Pass, frame 4 after retaining old rows until replacement |
| Paused keyed anchor: image/tail/new/prepend/reasoning/font-code | Pass, 0px across every one of 144 samples | Pass, 0px |
| Paused application-write ownership | Pass, zero writes | Pass, zero writes |
| Wheel/touch/drag/PageUp/Home/End/Latest | Pass | **Fail/intermittent:** End can land at Firefox's provisional cold extent and cease being at the semantic bottom after skipped rows materialize; synthetic touch API is also unavailable |

The harness now supports an opt-in fail-closed score mode:

```text
RV_TRANSCRIPT_RENDERER=full-dom RV_TRANSCRIPT_REQUIRE_PASS=1 \
  pnpm exec playwright test \
  --config apps/rusty-view-e2e/playwright.config.mts \
  apps/rusty-view-e2e/src/transcript-scroll-contract.spec.ts \
  --project=firefox --workers=1
```

This command is expected to return nonzero when the Firefox End-key cell
reproduces. The prototype deliberately does not add a retry/settlement loop to
hide that result.

Local WebKit remains blocked by the host-library limitation recorded in #6551;
this prototype does not infer a WebKit pass.

## Scale scorecard

Reproduction:

```text
RV_TRANSCRIPT_RENDERER=full-dom \
  RV_TRANSCRIPT_DEPTHS=250,1000 RV_TRANSCRIPT_REPEATS=3 \
  node scripts/measure-transcript-browser.mjs

RV_TRANSCRIPT_RENDERER=full-dom \
  RV_TRANSCRIPT_DEPTHS=5000,10000 RV_TRANSCRIPT_REPEATS=1 \
  node scripts/measure-transcript-browser.mjs
```

Chromium 149, 1440×1000. Values below are three-run medians for the observed
bands:

| Messages | Switch | Search | Input frame | Document / transcript nodes | Heap | Switch max long task | Cold keyed drift |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 250 | 91.2ms | 65.5ms | 1.1ms | 6,250 / 5,127 | 12.9MiB | 0ms | **25px** |
| 1,000 | 183.1ms | 157.0ms | 12.0ms | 24,625 / 20,502 | 31.7MiB | 85ms | **51px** |

Input and search produced no long tasks in either band. At 1,000, initial load
contained a 303ms median maximum long task, but initial bootstrap is not one of
the frozen switch/search budgets. The cold-history probe retained the same
keyed message in all three runs, yet its viewport-relative top moved 51px while
previously skipped rows acquired real layout. This is the Option B-specific
falsifier anticipated by the ADR.

At both 5,000 and 10,000, the single diagnostic run failed to make the Search
control actionable within 30 seconds, so no complete metric set is reported.
The collector records these as typed `TimeoutError` failures rather than
inventing values. The stretch failures do not independently veto B under the
#6551 rules, but they confirm that additive windowing would be needed if the
real distribution grows far past 1,000.

## Frozen-budget verdict

| ≤1,000 ship gate | Budget | Result |
|---|---:|---:|
| #6550 semantic contract | all pass | Pass in Chromium; **Fail/intermittent in Firefox input modes (End)** |
| Session switch | ≤250ms | Pass, 183.1ms |
| Search | ≤300ms | Pass, 157.0ms |
| Input next frame | ≤50ms | Pass, 12.0ms |
| Input-correlated long task | none >100ms | Pass, none |
| Switch/search long task | ≤150ms | Pass, switch 85ms; search 0ms |
| Heap | ≤256MiB | Pass, 31.7MiB |
| Document nodes | ≤150,000 | Pass, 24,625 |
| Cold keyed anchor | same key, ≤1px every frame | **Fail, 51px** |
| Required browser/device coverage | Chromium + Firefox + WebKit + mobile smoke | Incomplete by #6551 limitation |

Option B is therefore a technically successful semantic simplification but
**does not pass the frozen production scorecard**. Its failures share one
measured cause: cold `content-visibility` materialization violates the keyed-
anchor budget at the real 1,000-message band and can leave Firefox's explicit
End navigation above the eventual semantic bottom. A corrective settlement
loop was not added, because it would recreate the competing-authority
architecture this campaign is removing. Final selection remains owned by #6553
after additive owned-pin windowing is scored.

## Direct consumer check

Rusty View's transcript-renderer tests passed 156/156 and the production View
build passed. In `/home/dev/rusty-roleplay/roleplay-frontend`, `rp-layout`
typecheck passed, `roleplay-web` tests passed 89/89, and the production build
passed with pre-existing bundle/CommonJS warnings. That downstream workspace
consumes the current coordinated `0.0.x` package, so this proves the unchanged
public API surface; exact prototype runtime behavior in Roleplay remains a
#6555 live certification requirement after a renderer is selected and
published.
