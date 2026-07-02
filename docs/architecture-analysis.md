# Rusty View — Architecture Conformance Analysis

Date: 2026-07-01. Read-only audit of this repo against its own architecture
pattern: the layer/boundary rules stated in `docs/rusty-view.md`,
`agents-project.md`, and the ESLint boundary table, and the house pattern doc
`den:patch/rusty-view-ui-architecture-pattern` (v2) that was distilled from
this repo. Companion to `asha/docs/architecture-analysis.md`.

Because the v2 pattern doc postdates most of this code, findings are
classified three ways:

- **[violation]** — breaks a rule this repo itself states or enforces today;
- **[v2 gap]** — conforms to the v1-era pattern but not to v2; this is
  migration backlog, not drift;
- **[hygiene]** — housekeeping.

## Verdict

Rusty-view is genuinely built on its own pattern — the load-bearing claims
hold. Layer direction is enforced by a real, pairwise-enumerated
`@nx/enforce-module-boundaries` table; no deep imports exist anywhere (all
cross-lib traffic goes through `index.ts` barrels via tsconfig paths); the
strict TypeScript posture is complete (including `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`,
`noImplicitReturns` — stronger than asha's `ts/` base); protocol types are
generated with `generate`/`check` targets and the drift check runs in the `ci`
script; the app entrypoint is a thin 299-LOC composition root; the live-testing
harness matches its documentation exactly (five behavior templates, all tagged
`@live-agent`, gated on `RV_LIVE_RUN=1`, env vars as documented, `BASE_URL`
consumed rather than managed — already shaped for the den-playwright broker).

The two places it has *not* stuck to the pattern are the two the v2 doc now
names as failure modes — which is no coincidence; v2 was written partly from
watching this repo drift. `chat-shell` has become the god object the pattern
warns about, and the store layer flattens the transport's typed errors into
strings. Plus one outright broken gate: the CI e2e job targets projects that
do not exist in this workspace.

## Findings

### 1. [violation] CI's e2e smoke job targets nonexistent projects

`.github/workflows/ci.yml:42-67` builds `debug-chat` and runs
`debug-chat-e2e` — neither project exists in this workspace (`nx show
projects` lists only `rusty-view` and `rusty-view-e2e` as apps). The job
appears copied from another rusty-crew repo. Two consequences:

- the e2e job fails (or is being ignored) on every push/PR;
- rusty-view's **own** deterministic e2e suite — eight spec files in
  `apps/rusty-view-e2e/src/` covering streaming, scroll anchoring, transcript
  render, profiles — runs in **no** CI gate at all. The `pnpm run ci` script
  stops at build.

For the repo that hosts the evidence-class doctrine, this is the most ironic
possible defect: the deterministic evidence layer is silently absent. Fix: point
the job at `nx e2e rusty-view-e2e -- --project=chromium` (live specs already
self-skip without `RV_LIVE_RUN=1`), or fold e2e into the `ci` script.

### 2. [v2 gap, worst instance] Shell bloat — `chat-shell` is the missing feature axis

`libs/chat-shell` is 37 TS files / ~8.0k LOC — by far the largest lib (next
is transport at 6.6k, and the actual app is 0.3k). It contains at least three
complete vertical features, each with its own components/templates/specs:

- **admin**: `admin-profile-create/edit`, `admin-profiles-panel`,
  `admin-providers-panel`, `admin-service-panel`,
  `admin-tool-profile-editor`, `admin-profile-tool-selection` (~10 files,
  the majority of shell LOC);
- **debug**: `debug-shell`, `event-inspector`;
- **appearance/settings**: `appearance-tab`, plus composer pieces.

Under the v1 rules this was legal — shell was defined as "the only place that
may wire transport + store + components", so everything feature-shaped landed
there. v2 names the outcome (*shell bloat*) and prescribes the fix:
`feature-admin`, `feature-debug`, `feature-appearance` libs, with shell
reduced to layout + route-level composition. This is the highest-value
structural migration, and it unblocks finding 4 (the admin store splits along
the same seam).

### 3. [v2 gap] Error mush at the store boundary — the typed taxonomy is thrown away

Transport does its half correctly: `ChatTransportError`
(`libs/transport/src/lib/chat-transport-error.ts`) carries a closed
8-member `code` union ("never a bare `Error`"). But the stores flatten it:

- `chat-store.ts:407,488` — `error: String(error)` into status objects;
- `admin-store.ts:119` — `_error = signal<string | null>(null)`, fed by an
  `errorMessage(): string` helper (`admin-store.ts:903`) that inspects
  `ChatTransportError` in two places and then discards the code.

So the UI cannot distinguish retry-able network failure from auth failure from
envelope violation — the exact capability the transport codes exist to
provide. There is also no `AsyncState<T>`: async state is ad-hoc per-concern
signals (`_sessions`, `_connectionState`, `_pendingSends`, ...). The
chat-store's bespoke states are richer than a generic `AsyncState` in places
(pending-send queues, connection lifecycle) and should not be dumbed down —
but the plain load-and-render surfaces (admin panels, session lists) are
exactly the `AsyncState<{kind}>` shape and currently hand-roll
loading/error flags. Migration: introduce `AsyncState<T>` +
`ClassifiedError` in protocol/transport, adopt in admin-store first (it is
the closest fit and the least tested), preserve the chat-store's specialized
state machines as the documented exception.

### 4. [violation-adjacent] `admin-store.ts` — 999 LOC, no dedicated unit spec

`libs/chat-store` has one spec file (`chat-store.spec.ts`, 1215 LOC, good),
covering `chat-store.ts` only. `admin-store.ts` (999 LOC — the biggest
non-generated single file in the workspace) is exercised only indirectly
through `chat-shell` component specs. The repo's own DoD ("store method →
named command + store test") is not met for the admin store, and it is also
approaching the "if a store file needs a table of contents, it is three
stores" threshold. Splitting it should follow the feature-lib carve-out in
finding 2.

### 5. [v2 gap] Tags are one-axis in practice; the e2e app is untagged

Every lib is `['type:lib', 'scope:<its-own-name>']` — `scope:` restates the
lib name rather than a layer role, and `type:` only distinguishes
app/lib/testing. Enforcement still works because `eslint.config.mjs`
enumerates the scope constraints pairwise, and the constraint table is
accurate. But:

- `apps/rusty-view-e2e/project.json` has **no tags at all**, so no boundary
  constraint applies to it (today it imports nothing from libs — verified —
  but nothing prevents it);
- the app `rusty-view` has only the `type:app` constraint, so it may legally
  import `transport` directly (it does, for root providers — acceptable as
  composition root, but unenforced at scope level; a `scope:app` constraint
  mirroring the shell's would make root-wiring intent explicit);
- migrating to v2's role-based scopes (`scope:store` instead of
  `scope:chat-store`) is what lets the constraint table stop growing linearly
  with lib count — worth doing when the feature libs land, since that
  migration touches the same table.

### 6. [v2 gap] No platform layer — contained, but in the wrong homes

Browser/host API usage is admirably contained (five files total), but split
across layers instead of a `platform` lib: the IndexedDB persistence adapter
lives in `chat-store` (`indexed-db-chat-storage.ts`, 229 LOC) with its port
interface in `chat-domain` (`chat-storage-adapter.ts` — port-in-domain is
fine), and settings/theme storage lives in `chat-theme` per its documented
role. No urgency — the leaks are not spreading — but when a second port
appears (clipboard, hotkeys, URL sync), create `platform` rather than adding
a third home.

### 7. [v2 gap] Fixtures are typed factories, but no recorded-traffic conformance tests

`testing-fixtures` does the v1 job well (typed factory functions for
events/sessions/streams/transcripts, no `as any`). What's missing is v2's
transport conformance mechanism: recorded real backend traffic replayed
against the transport in CI. Transport is 6.6k LOC with 7 spec files of
hand-built cases — decent, but hand-built fixtures verify the transport
against the *author's* understanding of the backend, not against the backend.
Given rusty-crew's SSE envelope is the highest-churn contract here, this is
the most valuable v2 testing addition.

### 8. [v2 gap] Lint posture is thinner than the documented one

Beyond the boundary rule, only three TS rules are configured
(`no-explicit-any`, `no-non-null-assertion`, `consistent-type-imports`).
Missing from the doc's posture: type-aware rules (`no-floating-promises`,
`no-misused-promises`, `no-unsafe-*`), `prefer-readonly`,
`explicit-function-return-type` for exports, no-default-exports in shared
libs. For an async-heavy transport/store codebase, `no-floating-promises` is
the single highest-value addition — a dropped promise in reconnect/replay
logic is exactly the bug class deterministic tests miss.

### 9. [v2 gap] Generators cover component/fixture/library only

The local `rv` Nx plugin is real and wired (`libs/workspace-generators`,
resolved via `nx.json` plugins). Missing: `store`, `feature` (which should
stamp tags + boundary entry + route providers + live-scenario stub per v2
DoD), and `live-scenario` generators. Also `workspace-generators` itself has
zero tests. The feature generator is prerequisite-shaped for finding 2 — build
it first, then use it for the carve-out.

### 10. [hygiene] `tmp/` is untracked but not gitignored

`tmp/` (a stale `libs/` build mirror) is excluded from tsconfig but absent
from `.gitignore` — one agent `git add -A` away from committing build output.
Add `/tmp` to `.gitignore` (test-results/playwright artifacts are already
covered). Also: `docs/live-testing.md` and README commands all resolve to
real package scripts (checked) — prose drift is currently confined to the CI
file in finding 1.

## Priority

| # | Action | Class | Effort |
|---|--------|-------|--------|
| 1 | Fix CI e2e job → `rusty-view-e2e`; add e2e to the gate | violation | trivial |
| 2 | Add `/tmp` to `.gitignore` | hygiene | trivial |
| 3 | Enable `no-floating-promises` (+ type-aware lint) | v2 gap | small |
| 4 | Unit spec for `admin-store` | DoD gap | small |
| 5 | Tag `rusty-view-e2e`; add `scope:app` constraint | v2 gap | small |
| 6 | `feature` generator, then carve `feature-admin` / `feature-debug` / `feature-appearance` out of shell | v2 gap | medium |
| 7 | `AsyncState<T>` + `ClassifiedError`; adopt in admin-store; stop `String(error)` flattening | v2 gap | medium |
| 8 | Recorded-traffic transport conformance fixtures | v2 gap | medium |
| 9 | Role-based `scope:` tags (with 6) | v2 gap | small |
| 10 | `platform` lib when the next host port appears | v2 gap | deferred |

Items 6–9 are the same migration the bootstrap template
(`den:patch/ui-pattern-bootstrap-template`) will encode; doing them here first
doubles as the template's harvest source, which is the planned extraction
path anyway.
