# Task 6796: 10,000-turn Crew and Rusty View certification

Date: 2026-08-12

## Exact revisions and deployment

- Rusty View implementation: `72c249a3cd8c97755e91a70ae28411109c81deb7`
- Rusty Crew: `58ea9e11bebba6f92d17924aa2517cefd4daa972`
- Rusty View branch/ref: `main`; `origin/main` was read back at the exact implementation revision before certification.
- The implementation was deployed with `./scripts/deploy-local.sh` to both production and debug coordination sites before the final browser run.

Deployed production assets:

| Asset | SHA-256 |
| --- | --- |
| `main-2RYZYIXP.js` | `7cc4033c6038139d4e8848a4b57f470f1cd6245db240440bba0d7f9bbb3621ea` |
| `worker-O4KSZAHV.js` | `1808e9bbccf2d4367c1efa70a313f80011be5ad2cbe4c8038179c6e4313b239d` |
| `styles-ZJ3PMY66.css` | `311ba9690baf5e9161b75fd420305181e1a11eeef8455759151769106d5c80dc` |

The debug site's `main-2RYZYIXP.js` hash was identical to production.

## Certification boundary

The browser test uses the deployed Rusty View application and a deterministic, disposable HTTP implementation of Crew's generated external-runtime contract. That permits exact 10,000-turn content, deterministic cursor and failure injection, and complete cleanup without inserting synthetic records or attachments into the production Crew database. Crew's actual Rust-owned persistence and coordinated lifecycle implementations were separately exercised at the exact Crew revision below. This is an explicit split-layer certification, not a claim that a production reviewer thread was mutated to contain synthetic history.

Fixture content includes:

- 10,000 source turns with immutable turn/item identities;
- repeated `repeatable-tool` executions with 512-byte bounded summaries;
- image/document detail handles whose heavy bodies exist only behind a raw-detail endpoint;
- completed, failed, and interrupted turns;
- a concurrent SSE tail item while older pages hydrate;
- a separate three-message normal session.

The fixture owns no filesystem attachment and writes no Crew record. Closing the browser removes its only runtime state, so no active fixture session, binding, database row, or attachment survives the run.

## Deployed Chromium result

Command:

```bash
BASE_URL=http://127.0.0.1:9348 npx playwright test \
  --config apps/rusty-view-e2e/playwright.config.mts \
  apps/rusty-view-e2e/src/mega-session-certification.spec.ts \
  --project=chromium --reporter=line --workers=1
```

Result: 1/1 passed in 16.5 seconds.

| Measurement | Result |
| --- | ---: |
| Source turns | 10,000 |
| Reconstructed source turns | 10,000 |
| Backward pages | 200 |
| Page limit | 50 |
| Initial recent-window bytes | 19,313 |
| Maximum page bytes | 19,313 |
| Initial recent-window latency | 34.64 ms |
| Projected messages | 10,040 |
| Projected source-turn identities | 10,000 |
| Duplicate projected message IDs | 0 |
| Resident virtual rows | 64 |
| Resident transcript items | 64 |
| Total document nodes | 1,583 |
| Used JavaScript heap | 21,700,000 bytes |
| Input-to-next-frame latency | 12.3 ms |
| Small-session messages | 3 |
| Recent-page refresh reads | 1 |
| Heavy detail reads | 1, explicitly requested |

The test validates every requested and returned opaque cursor, page start/end cursor, page limit, response size, and source identity. It reconstructs all source turns, retains the concurrent live tail, switches to the small session, returns to the fully cached mega session, performs one bounded recent-page revalidation, and verifies the live item is present exactly once after reconnect.

The 40 projected messages beyond the source-turn count are deliberate terminal diagnostic blocks for failed/interrupted fixture turns. All projected message IDs remain unique.

## Partial-page and media behavior

During deep hydration the test injects one failure of each type at distinct opaque cursors:

- truncated JSON with HTTP 200;
- bounded-page timeout with HTTP 504;
- external-runtime unavailable with HTTP 503.

For each failure Rusty View retains the already-loaded transcript, renders the actionable `Retry page` state, retries the identical opaque cursor, clears the failure, and continues to exact reconstruction. A cursor-progress guard fails the test if a repeated page can loop.

Every page is asserted not to contain either heavy fixture body. The media/document turn carries only its stable raw-detail handle. The test then explicitly retrieves that handle once and verifies its detail ID and SHA-256 metadata.

## Crew persistence and lifecycle readback

At exact Crew revision `58ea9e11bebba6f92d17924aa2517cefd4daa972`:

```bash
cargo test -p rusty-crew-core-persistence \
  sqlite_external_turn_pages_remain_bounded_and_stable_at_ten_thousand_turns \
  -- --nocapture
```

Result: 1/1 passed in 0.66 seconds. The test inserts 10,000 Rust-owned external-turn correlations, reads the recent and preceding 50-turn pages, asserts the first page is under 256 KiB and under 250 ms, proves no overlap, adds later turns with equal/adjacent timestamp representations, and proves the saved opaque cursor still returns the identical older page.

The following exact Crew controller tests also passed together (4/4 in 3.51 seconds):

- profile prompt refresh creates a lineaged Crew session and preserves its predecessor;
- archive reconciliation survives partial orderings and controller restart;
- `/new` retries an archived partial predecessor without duplicate successors;
- `/new` reconciles after successor lineage persistence across restart.

Those read back both authorities: predecessor native thread/binding and Rust session become archived; one successor binding/session/thread remains current; route lineage survives restart; requested cwd is preserved; and a prompt-changing profile refresh creates a fresh successor at the current profile revision while preserving the archived predecessor.

Rusty View's full `npm run ci` passed at the implementation revision, including its 202 chat-store tests. Those include lifecycle controls that start/cancel from row metadata without reading predecessor history, coordinated archive/reconcile retry, atomic `/new` successor selection, fresh-guard profile refresh, bounded recent-page hydration, partial-page retry, stale-cursor rejection, concurrent refresh, and small-session behavior.

## Limits and interpretation

- The scale/browser run is deterministic Chromium automation against deployed assets, not a visible human playtest. The configured product-playtest tool surface was unavailable in this agent runtime, so that lane remains an infrastructure limitation rather than a product failure.
- The test does not increase timeouts to make the result pass. It enforces bounded page sizes, explicit failure recovery, cursor progress, identity reconstruction, resident-node bounds, and a 250 ms next-frame budget.
