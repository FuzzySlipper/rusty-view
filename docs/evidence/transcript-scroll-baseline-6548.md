# Transcript scroll writer baseline — task #6548

Captured on 2026-08-02 with Chromium using the deterministic routed fixture in
`apps/rusty-view-e2e/src/transcript-scroll-diagnostics.spec.ts`.

Command:

```text
pnpm exec playwright test --config apps/rusty-view-e2e/playwright.config.mts apps/rusty-view-e2e/src/transcript-scroll-diagnostics.spec.ts --project=chromium --reporter=line
```

Result: 1 passed. The trace was enabled only through the existing Rusty View
test API. Every retained entry identified `authority: application`, a reason,
frame, timestamp, transcript key, requested/actual offset, and viewport
geometry. The component retains at most 500 entries.

| Scenario | Application writes | Distinct reasons |
|---|---:|---|
| Following during deterministic streamed tail growth | 14 | `seek-rendered-message`, `explicit-latest`, `tail-follow-render`, `tail-geometry-mutation`, `tail-geometry-rendered-resize`, `tail-geometry-estimated-resize`, `tail-geometry-frame` |
| Paused tail growth/reload | 0 | none; any movement here is browser/CDK-owned rather than an application offset write |
| Byte-identical idle refresh | 0 | none; CDK data-source/extent churn is deliberately outside the application-writer trace |
| Active search seek | 50 | `seek-estimated-row`, `seek-rendered-message` |
| Session replacement | 14 | `estimator-reset`, `tail-geometry-rendered-resize`, `tail-geometry-estimated-resize`, `tail-follow-render`, `tail-geometry-frame`, `geometry-reconcile-settled` |

The same probe samples the semantic viewport independently of the application
write trace. Both no-write scenarios assert exact `scrollTop` stability and
retain their measurements in the attached JSON artifact:

| Scenario | `scrollTop` before | `scrollTop` after | Delta | Application writes |
|---|---:|---:|---:|---:|
| Paused growth refresh | 0 | 0 | 0 | 0 |
| Byte-identical idle refresh | 0 | 0 | 0 | 0 |

This separates "the application did not request a scroll" from "the semantic
viewport did not move." A future CDK- or browser-owned movement can therefore
fail the geometry assertion even while the application trace remains empty.

The fixture also recorded five Angular `NG0103` infinite-change-detection errors
during the repeated identical/grown refresh sequence. This baseline does not
claim those errors are caused by the diagnostic wrapper: tracing is a passive
branch around the pre-existing writes, and the next task compares the same
fixture after stabilizing projection and search identities.

The high-information results are:

- one streamed tail update fans out across mutation, two resize, render, and
  frame clocks;
- one active search target produces 50 application seek writes;
- one session replacement produces 14 application writes across six reasons;
- idle and paused scenarios may still move through CDK/browser authority even
  when the application write count is zero, so those layers must not be
  conflated in later attribution.
