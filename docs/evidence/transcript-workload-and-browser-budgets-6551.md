# Transcript workload, browser matrix, and Option B budgets — task #6551

Captured 2026-08-02. This evidence supplies the product facts required by the
transcript-scroll architecture ADR before choosing a replacement renderer.

## Reproduction and privacy

Real deployed distributions were collected without emitting session ids or
transcript content:

```text
pnpm exec nx build chat-domain
node scripts/measure-transcript-depth.mjs \
  --source view-production=http://127.0.0.1:9347 \
  --source roleplay-isolated=http://127.0.0.1:9350
```

The script reads deployed events/threads in memory through the production
projection functions and emits only counts, percentiles, complexity flags, and
typed error totals. Four of 274 View external-thread reads were unavailable and
are excluded rather than inferred.

Synthetic browser measurements used the deployed View frontend, isolated
browser contexts, deterministic route fixtures, three runs per band, and median
values:

```text
BASE_URL=http://127.0.0.1:9347 node scripts/measure-transcript-browser.mjs
```

Synthetic scale complements the real distribution; it does not replace it.

## Real projected depth

| Deployment / surface | Samples (live / archived) | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|
| View/Crew native profiles | 15 (15 / 0) | 1 | 3 | 3 | 3 |
| View Codex/external threads | 270 (169 / 101) | 10 | 169 | 432 | **882** |
| View live Codex/external only | 169 (169 / 0) | 16 | 257 | 632 | **882** |
| Rusty Roleplay isolated native | 16 (15 / 1) | 2 | 71 | 71 | **71** |

The observed production certification band is therefore 1,000 projected
messages. Five thousand and ten thousand remain deliberate stretch/falsifier
bands, not an observed product requirement.

Complexity was present in the real sample:

| Surface | Reasoning | Code | Tables | Tool detail | Images | Revisions | RP decoration |
|---|---:|---:|---:|---:|---:|---:|---:|
| View native (15) | 1 | 0 | 0 | 2 | 0 | 0 | unavailable |
| View external (270) | 149 | 86 | 18 | 0* | 0 | 0 | unavailable |
| Roleplay native (16) | 8 | 0 | 2 | 9 | 0 | 0 | unavailable |

`*` External Codex activity projected primarily as 25,355 `file_change` blocks,
not the native `tool_call`/`command` kinds used by this detector. Zero image,
revision, or RP-decoration detections are not proof of absence: Crew projection
metadata cannot observe downstream frontend extension decoration. The
deterministic #6550 contract covers image decode, expanded reasoning,
Markdown/table/code reflow, and tools; revision/RP decoration require direct
consumer certification in #6555.

## Current-renderer synthetic baseline

Chromium 149.0.7827.55, 1440×1000 viewport, three isolated runs per band:

| Messages | Switch median | Search median | Input→next frame | Document / transcript nodes | Rendered rows | JS heap | Max long task | Cold extent revision/frame |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 250 | 136.4ms | 58.0ms | 2.0ms | 1,356 / 232 | 11 | 7.8MiB | 104ms | 72px |
| 1,000 | 121.3ms | 252.0ms | 1.4ms | 4,331 / 207 | 10 | 9.7MiB | 85ms | 638px |
| 5,000 | 207.2ms | 299.2ms | 13.4ms | 20,372 / 248 | 12 | 16.7MiB | 277ms | 581px |
| 10,000 | 821.1ms | 519.9ms | 14.4ms | 40,372 / 248 | 12 | 25.5MiB | 770ms | 2,059px |

The document-node figure includes application surfaces outside the semantic
transcript subtree; both figures are retained so Option B cannot hide cost in a
sibling projection. The current virtualizer kept only 10–12 semantic rows
rendered, but cold-range materialization failed to retain the same first fully
visible key in all three runs at every band. Median maximum thumb-ratio movement
was small (about 2.4–13.3 basis points per frame), while the underlying estimated
extent still revised by tens to thousands of pixels.

Initial page-load timing ranged from 0.35s to 7.7s and was non-monotonic because
it includes application bootstrap and background endpoint retry timing; it is
retained in raw tool output but excluded from renderer scoring. Session-switch,
search, input-frame, residency, long-task, and cold-history measurements are the
decision inputs.

## Supported and certification browser/device matrix

| Consumer | Surface | Current evidence | Replacement certification gate |
|---|---|---|---|
| Installed Rusty View | Desktop Chromium/Chrome | Chromium contract and scale measurements run locally | Required automated semantic contract and budgets |
| Rusty View web | Desktop Firefox | Contract ran; following/idle/navigation passed, but current CDK replacement exposed one empty frame | Required automated semantic contract and budgets |
| Rusty View web/installed | Desktop Safari/WebKit | Local Playwright WebKit blocked by missing host `libicu74`, `libxml2`, and `libflite1` | Required WebKit automation before selection ships |
| Rusty View mobile | Android Chrome-class | Secondary supported surface; no physical-device result in this environment | Required physical-device touch/momentum/input smoke |
| Rusty View mobile/installed | iOS Safari | No physical-device result in this environment | Required physical-device touch/momentum/installed-PWA smoke |
| Rusty Roleplay direct consumer | Desktop Chromium/Firefox/WebKit | Real isolated data sampled; no direct-browser measurement in this task | Required downstream build plus live semantic contract/smoke |
| Rusty Roleplay mobile | Android Chrome/iOS Safari | No physical-device result in this environment | Required direct-consumer mobile smoke where supported |

Safari 27 scroll-anchoring behavior is forward-looking information only. It is
not evidence for the Safari/WebKit versions currently deployed by users and
cannot close the WebKit or iOS gates above.

## Reviewed pass/fail budgets for Option B

The scorecard is intentionally anchored to the real maximum of 882 and uses the
1,000-message band as the production gate. All timing budgets are medians across
at least three isolated runs unless a p95 is explicitly available.

| Metric | Required at ≤1,000 (ship gate) | 5,000 stretch | 10,000 falsifier |
|---|---:|---:|---:|
| #6550 semantic scroll contract | Every invariant passes | Every invariant passes | No crash; following/input still pass |
| Session switch | ≤250ms median; ≤500ms p95 | ≤500ms | ≤2s |
| Search/jump | ≤300ms median; ≤600ms p95 | ≤750ms | ≤1.5s |
| Input to next frame | ≤50ms p95 | ≤50ms p95 | ≤100ms p95 |
| Input-correlated long task | none >100ms | none >150ms | none >250ms |
| Max switch/search long task | ≤150ms | ≤300ms | ≤1s |
| JS heap after load | ≤256MiB | ≤512MiB | ≤1GiB |
| Total document nodes | ≤150,000 | ≤500,000 | ≤1,000,000 |
| Cold keyed-anchor drift | same key, ≤1px every frame | same key, ≤1px | same key, ≤1px |
| Browser coverage | Chromium + Firefox + WebKit; Android Chrome and iOS Safari physical smoke | informational | informational |

Five/ten-thousand results cannot veto Option B when the real 1,000-message gate
passes; they identify the point at which additive windowing may become useful.
Conversely, a 1,000-message contract, responsiveness, memory, or browser failure
rejects Option B even if an average benchmark looks fast.

**Scrollbar-thumb decision:** a thumb whose size remains exactly proportional
to all retained history at every frame is **not a product requirement**.
Progressive extent/thumb refinement is acceptable, as in other long-running chat
clients, provided it never violates the keyed-anchor ≤1px invariant, causes a
visible jump while dragging, or makes first/middle/last navigation unbounded.

## Limitations and follow-up ownership

- The browser performance probe currently measures Chromium only; Firefox and
  WebKit scorecard runs belong to the prototypes and #6555 certification.
- Physical Android/iOS, NVDA, and VoiceOver were unavailable here and remain
  explicit selection gates, not inferred passes.
- Roleplay extension-only decoration is not visible in Crew events. #6555 must
  certify the direct Rusty Roleplay consumer with its extensions active.
- The real distribution is a 2026-08-02 snapshot, not a permanent ceiling. The
  privacy-safe depth script should be rerun when the projected maximum changes
  materially or before revisiting windowing.
