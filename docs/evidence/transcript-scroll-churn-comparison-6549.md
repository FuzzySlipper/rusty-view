# Transcript projection/search churn comparison — task #6549

The deterministic Chromium fixture from task #6548 was rerun unchanged after
guarding identical projections, retaining stable virtual-row identities, and
keying search seeks on the result's stable id.

Command:

```text
pnpm exec playwright test --config apps/rusty-view-e2e/playwright.config.mts apps/rusty-view-e2e/src/transcript-scroll-diagnostics.spec.ts --project=chromium --reporter=line
```

| Scenario | #6548 baseline | #6549 result | Interpretation |
|---|---:|---:|---|
| Following during deterministic streamed tail growth | 14 writes | 14 writes | Estimator/observer fan-out is unchanged, as intended for this option-independent task. |
| Paused tail growth/reload | 0 writes | 0 writes | Application ownership remains quiet while paused. |
| Byte-identical idle refresh | 0 writes | 0 writes | No application write; the new guard additionally prevents a CDK data-source replacement and avoids the paused synchronous layout read. |
| Active search seek | 50 writes | 1 write | Fresh search-result objects no longer restart the 12-attempt seek chain on each projection tick. |
| Session replacement | 14 writes | 14 writes | Existing estimator/observer behavior is unchanged and remains measurable for the architecture replacement. |
| Browser console errors during the fixture | 5 `NG0103` errors | 0 errors | Removing repeated projection/search invalidation eliminates the observed infinite-change-detection churn. |

The semantic viewport measurements added during #6548 also remained stable:
paused growth measured `scrollTop 0 -> 0` and byte-identical idle refresh
measured `scrollTop 0 -> 0`, with zero application writes in both cases. The
same browser run broadened the query after the recorded comparison, advanced
to the next result, and asserted exactly one new seek write for that genuinely
changed target.

Unit coverage also proves:

- a fresh but byte-identical message projection retains the exact row-array and
  row-object identities;
- one changed message replaces only its own row;
- message metadata changes are not silently discarded by the presentation
  guard;
- freshly allocated copies of one search result produce the same primitive
  seek key, while a different result produces a different key;
- clearing search cancels the pending seek chain, and the browser probe proves
  the next selected result still starts exactly one seek.

This result partitions the symptom as intended: search/data-identity churn was
responsible for the 50-write seek storm and the fixture's Angular errors, while
the 14-write streaming and replacement fan-out remains attributable to the
CDK estimator plus observer/control-loop architecture addressed by later
campaign tasks.
