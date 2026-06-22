# Project Layout

## Proposed structure

The RP system is composed of three main pieces:

1. **lorekeep** — standalone lore/memory service (Go, sibling to den-memory)
2. **RP harness** — rusty-crew profiles, tools, and prompt configuration (TypeScript, lives in rusty-crew's TS packages)
3. **Frontend** — thin client(s) over rusty-crew session API (separate, multiple possible)

## Service dependency graph

```
┌──────────┐     HTTP      ┌─────────────┐     HTTP      ┌──────────┐
│ Frontend │ ──────────── │  rusty-crew  │ ──────────── │ lorekeep │
│ (Discord │  session     │   service    │  lore/recall  │  (Go)    │
│  bot /   │  events      │              │               │          │
│  web UI) │              │  ┌────────┐  │               │          │
└──────────┘              │  │  TS    │  │               │          │
                          │  │ brain  │  │               │          │
                          │  │ island │  │               │          │
                          │  └────────┘  │               │          │
                          │  ┌────────┐  │               │          │
                          │  │ Rust   │  │               │          │
                          │  │ sessio │  │               │          │
                          │  │ ns     │  │               │          │
                          │  └────────┘  │               │          │
                          └─────────────┘                └──────────┘
```

No service depends on the frontend. The frontend depends on rusty-crew's
session API. rusty-crew's brain island calls lorekeep over HTTP. All
dependencies flow rightward.

## lorekeep — lore/memory service

### Repository

```
/home/dev/lorekeep/
```

Standalone Go service. Same pattern as den-memory.

### Structure

```
lorekeep/
  README.md
  AGENTS.md
  cmd/
    lorekeep/              # main service binary
      main.go
    lorekeep-validate/     # contract validation command
      main.go
    lorekeep-migrate-st/   # SillyTavern lore book migration
      main.go
  internal/
    store/                 # SQLite + FTS5 storage layer
    recall/                # scoring, budgeting, packet assembly
    httpapi/               # HTTP handlers
    topics/                # topic graph + edge traversal
    traces/                # retrieval trace recording
    config/                # retrieval config per campaign
  contracts/
    v0/
      registry.json
      scoring-defaults.json
      schemas/
        *.schema.json
      examples/
        *.example.json
  docs/
    v0-contract.md
    deployment.md
    api-reference.md
  scripts/
    deploy-den-srv.sh      # deploy helper (following den-memory pattern)
  tests/
    test_contracts.py      # validation/readback tests
```

### Deployment

Following den-memory's model:
- systemd service on den-srv (192.168.1.10)
- service user/group: `lorekeep`
- service root: `/data/services/lorekeep`
- SQLite: `/data/services/lorekeep/data/lorekeep.sqlite`
- LAN HTTP (port TBD, probably 8790 to follow den-memory's 8780 pattern)
- No auth in v0 (trusted-LAN)

### Development dependencies

- Go 1.22+
- SQLite (modernc.org/sqlite — pure Go, no CGO)
- FTS5 (built into SQLite)

No external services. No message queues. No caches. Single binary, single
database file.

## RP harness — rusty-crew integration

### Location

Lives inside rusty-crew's TS package structure. The harness is a set of
profiles, tools, and prompt configuration — not a separate service.

```
/home/dev/rusty-crew/ts/packages/
  adapter-lorekeep/         # lorekeep HTTP client + tool definitions
    src/
      client.ts             # HTTP client for lorekeep API
      tools.ts              # narrator tools (search_lore, recall_lore, etc.)
      mechanic-tools.ts     # mechanic tools (get_rp_history, propose_change, etc.)
      types.ts              # lorekeep contract types (hand-written or generated)
      config.ts             # typed YAML config (timeouts, endpoints, budgets)
    config.example.yaml     # documented example config

  rp-profile/               # narrator and mechanic profile definitions
    src/
      narrator-profile.ts   # narrator system prompt, phase config, tool gating
      mechanic-profile.ts   # mechanic system prompt, tool gating
      exemplars/            # style exemplar templates
      prompts/              # register-establishment prompt fragments
```

### What the harness owns

- Tool definitions that call lorekeep over HTTP
- Narrator profile (system prompt, phase config, tool availability)
- Mechanic profile (system prompt, tool availability, proposal workflow)
- Style exemplar management
- Scene state tools (read/write Rust session state)
- Phase orchestration (explore → compose → review)

### What the harness does NOT own

- Agent loop (pi-agent-core provides this)
- Session management (Rust layer provides this)
- Provider adapters (pi-agent-core provides this)
- Delegation infrastructure (Rust layer provides this)
- Lore storage and retrieval (lorekeep provides this)
- Frontend rendering (separate frontend provides this)

### Configuration

Following Patch's no-hardcoded-config principle: all tunable values in
typed YAML.

```yaml
# rusty-crew RP harness config
lorekeep:
  base_url: "http://192.168.1.10:8790"
  timeout_ms: 5000
  retry_attempts: 2

narrator:
  exploration:
    max_rounds: 3              # max tool-call rounds in Phase 1
    delegation_threshold: 2    # rounds before spawning librarian
    token_budget: 2000
  review:
    enabled: true              # review pass on/off
    gravity_check: true        # check for PG-13 drift
    max_revisions: 1           # re-generation attempts
  prompt:
    system_prompt_file: "prompts/narrator-system.md"
    exemplar_dir: "exemplars/"
  compaction:
    strategy: "scene-aware"
    tool_results: "ephemeral"  # excise after turn completes
    active_scene_max_turns: 15
    recent_scene_summaries: 3
    token_threshold_pct: 70

mechanic:
  analysis:
    history_depth: 10          # RP turns to read when diagnosing
    trace_depth: 5             # retrieval traces to read
  proposals:
    require_approval: true     # always true — proposals must be approved
    batch_limit: 5             # max proposals per diagnostic round
```

## Frontend

The frontend architecture is already designed in detail in
`rusty-view.md`. Summary of the key decisions from that brief:

### Two-repo separation

```
rusty-view       — boring debug chat client + reusable chat kit
  ↓ versioned package dependency
rusty-roleplay — roleplay frontend, consumes rusty-view packages
```

`rusty-view` knows nothing about roleplay concepts. `rusty-roleplay`
adds RP-specific UI (character menus, persona selectors, lorebook pickers,
scene/mood controls, generation presets, message decorators, narrative mode
controls).

### Stack (from rusty-view.md)

- Angular + Nx workspace
- TypeScript strict mode (no `any`, no non-null assertions)
- Angular Signals + NgRx SignalStore
- Virtualized transcript rendering (TanStack Virtual or Angular CDK)
- IndexedDB behind storage adapter (no direct localStorage)
- HTTP for commands, SSE/WebSocket for event streaming
- Rust-generated TypeScript protocol types (ts-rs or specta)
- Playwright for browser testing, Storybook for component contracts

### rusty-view libraries

```
rusty-view/
  apps/
    debug-chat/           # brutal, useful debug client
  libs/
    protocol/             # generated TS types from Rust
    transport/            # HTTP/SSE/WS client for rusty-crew
    chat-domain/          # pure TS domain logic, conversation projection
    chat-store/           # Angular-facing store (Signals/SignalStore)
    transcript-renderer/  # virtualized transcript, scroll anchoring
    chat-components/      # dumb presentational components
    chat-shell/           # debug app layout
    design-tokens/        # colors, spacing, typography
    testing-fixtures/     # fake sessions, giant transcripts, streaming fixtures
    workspace-generators/ # Nx generators for scaffolding
```

### rusty-roleplay libraries

```
rusty-roleplay/
  apps/
    roleplay-web/
  libs/
    rp-character-menu/
    rp-persona-menu/
    rp-lorebook/
    rp-scene-state/
    rp-generation-presets/
    rp-session-config/
    rp-message-decorators/
    rp-layout/
```

### Connection to this design

The frontend architecture in `rusty-view.md` is the right foundation. The
RP system design in these docs connects at:

1. **Session events** — the typed event stream from `rusty-view`'s transport
   layer carries the phase indicators (exploring, composing, review) that
   the narrator agent emits. `rusty-view` renders them generically;
   `rusty-roleplay` renders them as RP-specific indicators.

2. **OOC mode** — the mode switch (RP ↔ mechanic) is a `rusty-roleplay`
   concern. `rusty-view` provides the session mechanics; `rusty-roleplay`
   adds the mode toggle, proposal review UI, and diagnostic context panel.

3. **Lore management** — the lorebook library in `rusty-roleplay` talks
   to lorekeep over HTTP (through `rusty-view`'s transport layer or
   directly, TBD).

4. **Long transcript design** — `rusty-view.md` already designs for
   novel-sized transcripts with virtualized rendering, IndexedDB caching,
   and worker offloading. RP sessions are exactly this use case.

5. **Generated protocol types** — lorekeep should provide its own schema or
   OpenAPI spec for TS type generation, following the same "no hand-written
   protocol copies" rule from `rusty-view.md`.

### Implementation note

The `rusty-view` debug client is the natural spike frontend — it validates
the session transport against rusty-crew without any RP complexity.
`rusty-roleplay` can begin once the narrator profile and tool surface are
proven through the debug client.

## Implementation sequencing

This is not a schedule estimate — it's dependency ordering. Each phase has
a clear validation gate. The key difference from the earlier sketch is that
UX is day-1: the users won't use a debug client, so the RP frontend is in
the critical path.

### Phase 0: lorekeep contract

**Produce:** v0 contract artifacts (registry, schemas, examples, validation)
**Validate:** Contract tests pass, schemas describe all needed operations
**No service code yet** — just the contract. This locks the interface for
everything downstream.

### Phase 1: lorekeep service

**Produce:** Working Go service with recall, search, capture, traces, config
**Validate:** Health check, smoke tests, recall returns sensible packets
against seed lore

### Phase 2: SillyTavern migration + seed lore

**Produce:** Migration script + seed lore in lorekeep from existing ST lore books
**Validate:** The users' actual lore content is queryable and retrievable.
This is the first onboarding touchpoint — if migration doesn't work smoothly,
they won't cross over.

### Phase 3: rusty-crew narrator profile + tools

**Produce:** Narrator profile with lorekeep tools, two-phase loop, basic prompt architecture
**Validate:** **The quality spike.** Does an agent with lore tools produce
better RP than ST's keyword injection? This is the core empirical question.
Test with the users' migrated lore. If narrative quality doesn't match or
beat ST, the architecture is wrong and needs revisiting before any frontend
work.

### Phase 4: rusty-view debug client + protocol plumbing

**Produce:** Working debug chat client against rusty-crew session API.
Protocol types generated from Rust. Transport layer proven.
**Validate:** Can send/receive messages, see session events, survive reconnect.
**Dev-only tool** — not shown to users.

### Phase 5: rusty-roleplay RP frontend (first user release)

**Produce:** RP chat interface in rusty-roleplay consuming rusty-view packages.
**Validate:** The users can RP through it. Migration worked. Lore is
retrieving correctly. Responses are good. They're comfortable enough to
stop using ST.

**Minimum for this phase:**
- Chat UI with streaming responses
- Phase indicators (exploring/composing)
- Retry/regenerate on messages
- Campaign/session switching
- Lore management basics (view/edit entries)

**Not required for this phase:**
- Mechanic agent / OOC mode
- Review pass / gravity correction
- Proposal system
- Topic graph
- Full lore admin UI

### Phase 6: Mechanic agent + OOC mode

**Produce:** Mechanic profile, proposal system, read/write tools, OOC mode in rusty-roleplay
**Validate:** User can diagnose a quality problem and apply a fix through
the mechanic. Diagnostic loop works end-to-end.

### Phase 7: Review pass + gravity correction + polish

**Produce:** Self-review phase in narrator loop, gravity detection, enhanced
lore admin, topic graph UI
**Validate:** Review pass catches drift. Full feature parity.

## Onboarding as an architectural concern

Transitioning users off ST is a real design constraint:

1. **Lore book migration must be one-click or one-command.** "Import from
   SillyTavern" → all lore entries appear. Manual recreation is a non-starter.

2. **First-run experience must work immediately.** The narrator profile
   should ship with sensible defaults (style exemplar, retrieval depth,
   system prompt) that work for their existing usage (generic narrator,
   lore-heavy, saucy content). They shouldn't need to configure anything
   before their first RP turn.

3. **The chat UI should feel familiar.** Messages flowing in, streaming
   text, a way to retry or regenerate. They shouldn't need to learn a new
   interaction model. The old ST concept of "back button / swipe" maps to
   the new system's retry/regenerate.

4. **Don't make them care about the architecture.** They shouldn't need to
   know what a scene brief is, or that there's a lore service, or that
   phases exist. Phase indicators can be subtle ("Thinking..." then the
   response appears). The mechanic agent is a power-user feature they
   discover, not a prerequisite.

5. **Kill the old ST instance once they've crossed over.** Not literally
   — keep it as backup — but the goal is that after a few sessions they
   stop asking about ST because this is better.

## What can be parallelized

Once the lorekeep contract (Phase 0) is locked:
- lorekeep service (Phase 1) and rusty-crew tool definitions can proceed in
  parallel — the TS types just need the contract, not the implementation
- Migration script (Phase 2) can proceed once Phase 1 has basic entry CRUD
- rusty-view debug client (Phase 4) can proceed once Phase 3 has a working
  narrator session, even before the full tool suite is complete
- rusty-roleplay profile system (Phase 5) depends on the RP frontend but
  the profile model is simple enough to develop in parallel

## Open structural questions

1. **Does lorekeep need its own Den project?** Probably yes, once it's
   real. For now, design docs in `/home/research/code-design/`.
2. **Does the RP harness need a Den project?** It's a rusty-crew concern,
   so probably under `rusty-crew` Den project, or a new project if the
   scope warrants separation.
3. **Where does rusty-roleplay live?** Separate Angular/Nx workspace
   repo (`/home/dev/rusty-roleplay`). Consumes rusty-view packages.
4. **Profile storage** — where does profile config live? lorekeep?
   Separate profile file on the server? Start with simple YAML/JSON files
   on the server (profile directory per user). No database needed for
   two users with plain-text storage.
5. **Model routing** — narrator, librarian (if delegated), mechanic, and
   compaction agent may want different models. rusty-crew profile config
   handles this per-profile. The mechanic can propose model routing changes
   as provider pattern data accumulates.
6. **No multi-user security in v0** — plain-text profiles, optional
   passwords, frontend-managed profile switching. See
   `03-mechanic-ooc-agent.md` User profiles section. Do not add auth
   middleware, cryptographic hashing, or session tokens to v0.
