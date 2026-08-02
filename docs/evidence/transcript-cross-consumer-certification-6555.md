# Transcript cross-consumer certification — task #6555

Captured 2026-08-02 for the owned 64-row transcript window selected by the
architecture campaign rooted at task #6547.

## Exact sources and scope

- Rusty View implementation before this certification record:
  `1d84e9f61a584d380f3488072b590f31c6935c26`
- selected owned-window implementation:
  `667624fee028f11cbb2ae8b65905cb05f98db6c3`
- delayed Firefox replacement fix:
  `9720a5e94f81057d3fbd39638e457317526a281b`
- Rusty Roleplay compatibility head:
  `82019a8a743b028c85b7e20ffac254c991e7bc4a`
- Rusty Crew multi-request compatibility head:
  `2d655cbf1525d5517c99f6e39d10064fb69abdb7`
- exact Roleplay consumer package identity: `0.0.6555` for all nine public
  Rusty View packages packed from `9720a5e`

The reusable View renderer, deployed View shell, production/debug Crew roots,
Codex external-thread projection, and direct Roleplay consumer were exercised.
Roleplay/Crew defects found during certification were routed to tasks #6568,
#6569, #6570, and #6571 rather than patched across repository boundaries.

## Semantic browser contract

The fail-closed contract covers per-frame following, byte-identical idle
refresh, first/middle/last navigation, active search, atomic session
replacement, image decode, tail growth, new-message arrival, prepend, reasoning
expansion, font/code reflow, wheel/trackpad, touch/momentum, scrollbar drag,
Home/End, Latest, bounded residency, and scroll-write ownership.

| Engine | Result | Paused drift | Resident rows | Idle writes |
|---|---:|---:|---:|---:|
| Chromium 149 | 3/3 pass | 0px all mutations | 64 max | 0 |
| Firefox | 3/3 pass | 0px all mutations | 64 max | 0 |
| WebKit, Playwright 1.61 official image | 3/3 pass | 0px all mutations | 64 max | 0 |

WebKit ran fail-closed in `mcr.microsoft.com/playwright:v1.61.0-noble`
because the host lacks its `libicu74`, `libxml2`, and `libflite1` runtime
packages. That run found and closed task #6572's real 8–10px native-anchor gap;
it is not an inferred browser pass. See
`docs/evidence/transcript-webkit-anchor-6572.md` for the exact command and
authority trace.

## Synthetic scale against reviewed budgets

Chromium 149.0.7827.55 ran three isolated repetitions per band against the
locally deployed application. Every run retained exactly 64 rows and the same
key at 0px drift for all 60 cold-history frames.

| Messages | Switch median | Search median | Input frame median | Nodes document / transcript | Heap | Switch/search max long task | Result |
|---:|---:|---:|---:|---:|---:|---:|---|
| 250 | 78.3ms | 81.9ms | 2.0ms | 2,439 / 1,316 | 8.2MiB | 0ms | pass |
| 1,000 | 116.0ms | 107.1ms | 2.2ms | 5,439 / 1,316 | 9.5MiB | 0ms | pass production gate |
| 5,000 | 214.0ms | 218.4ms | 6.1ms | 21,439 / 1,316 | 16.3MiB | 111ms | pass stretch |
| 10,000 | 748.3ms | 386.3ms | 24.5ms | 41,439 / 1,316 | 25.0MiB | 583ms | pass falsifier |

Input-correlated long tasks were zero at every band. The 5,000 and 10,000 load
phases included longer cold construction tasks, but the reviewed budgets score
switch/search and input phases; those remained below 300ms and 1s respectively.
The observed real Codex maximum remains 882 projected messages, so 1,000 is the
production gate and the larger bands are deliberate falsifiers.

Compared with task #6551's old-renderer baseline, the production band now has
stable 0px cold anchoring instead of inconsistent key retention and 638px
extent revision, while search improved from 252.0ms to 107.1ms. At 10,000,
session switch improved from 821.1ms to 748.3ms and search from 519.9ms to
386.3ms; bounded semantic residency increased intentionally from 10–12 rows to
the fixed 64-row owned window.

## Deployed Rusty View evidence

`./scripts/deploy-local.sh` installs the exact source into the local production
and debug service roots before live checks. The opt-in live suite used isolated
profiles so it did not mutate existing user conversations.

- production Crew `http://127.0.0.1:9347`: a real Kimi-backed assistant turn
  remained streaming long enough for an actual upward/downward wheel gesture;
  before/after screenshots differed by 98,039 bytes, the transcript stayed
  coherent, and completion remained reachable;
- debug Crew `http://127.0.0.1:9348`: a real tester-chat turn completed, the
  sentinel completion survived reload without resending, and before/after
  screenshots plus debug snapshots were retained;
- both evidence packets recorded zero console errors and zero page errors;
- the deployed debug Codex projection proof loaded a reviewed archived app-server
  thread, rendered one compact assistant turn with distinct commentary and
  final-answer phases, and reproduced the same single turn after reload (1/1
  passed);
- deterministic external-thread fixtures and the semantic session-replacement
  contract additionally cover live projection churn, reasoning/tools/completion,
  delayed replacement, search navigation, reload-stable identity, and bounded
  residency without reaching into removed CDK internals.

The production streaming test now waits until the real transcript is actually
scrollable before applying the wheel gesture. This removes a false visual-proof
failure where the provider had emitted a streaming row but not yet enough
height for user motion.

## Direct Rusty Roleplay consumer

The isolated Roleplay archive compiled and ran against the exact locally packed
`0.0.6555` packages. Its long/decorated transcript boundary proof and
`rp-layout`/`rp-message-decorators` tests passed without access to renderer
internals. The live deployment at `http://127.0.0.1:9350` preserved its SQLite
profile, scene, lore, and transcript through the current Crew migration.

The exact consumer live scenario passed 1/1 in Chromium in 1.8 minutes. It
rendered five lore/state tool calls and the narrator completion across
`Done -> Searching lore... -> Writing... -> Reviewing... -> Writing... -> Idle`,
opened RP Setup/Characters, and verified the same completion after reload.
Console and page errors were zero. Detailed deployment, operation receipts,
backup path, and artifact root are recorded in Roleplay's
`docs/evidence/rusty-view-transport-compatibility-6569.md`.

## Residual device scope

No physical Android or iOS device was attached to this execution environment.
The automated matrix nevertheless exercises wheel, synthetic touch/momentum,
scrollbar drag, keyboard navigation, and installed-layout-compatible viewport
geometry in Chromium, Firefox, and WebKit. Physical mobile/PWA ergonomics remain
a device-lab limitation rather than an inferred pass; it does not conceal a
known semantic renderer failure.
