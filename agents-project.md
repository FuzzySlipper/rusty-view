# Rusty View Local Bootstrap

Project-specific live guidance and task management live in Den project
`rusty-crew` under the `rusty-view` tag.

Use project ID `rusty-crew` with tag filter `rusty-view` for Den tasks,
messages, documents, librarian queries, and guidance lookups related to
this frontend.

## Source-of-truth posture

This local file is bootstrap context for agents entering the repository. It is
not the current planning queue.

- **Den** owns current task state, implementation queues, durable planning
  docs, and known limitations.
- **Repo docs** (`/home/dev/rusty-view/docs/`) describe architecture and
  committed implementation surfaces.
- **The code/tests** are the implementation truth when they conflict with old
  planning prose.

## Architecture Soul

> A boring industrial chat console and reusable chat client kit. Roleplay-
> agnostic by design. `rusty-roleplay` consumes this; `rusty-view` never knows
> about roleplay.

- **Backend protocol truth** lives in `rusty-crew` (Rust). TypeScript protocol
  files are generated or schema-derived, never hand-written.
- **Library boundaries are load-bearing.** Each library has a strict
  responsibility and may not import across boundaries.
- **The transcript renderer is the hard part.** Virtualization, streaming,
  scroll anchoring, and 10k+ message support are not optional features — they
  are the core engineering challenge.
- **Angular Signals, not global stores.** State is local and signal-based.
  No NgRx global store unless explicitly approved.
- **Frontend code is deliberately hostile to improvisation.** Agents must use
  workspace generators, obey boundary rules, and prefer boring explicitness.

See `docs/rusty-view.md` for the full system design and the docs directory for
the broader roleplay system design documents.

## Repository Structure

```text
/rusty-view
  /apps
    /rusty-view              # durable operator chat client (reference implementation)
  /libs
    /protocol               # generated TypeScript types (no Angular, no app logic)
    /transport              # HTTP/SSE client for rusty-crew (no components)
    /chat-domain            # pure TypeScript domain logic (no Angular)
    /chat-store             # Angular Signals store (no roleplay state)
    /chat-theme             # appearance settings + live token application
    /transcript-renderer    # virtualized transcript rendering (roleplay-agnostic)
    /chat-components        # dumb presentational components (no service injection)
    /chat-shell             # app layout (session list, transcript, inspectors)
    /design-tokens          # colors, spacing, typography (no app assumptions)
    /testing-fixtures        # fake sessions, giant transcripts, streaming fixtures
    /workspace-generators   # Nx generators for approved scaffolding
  /docs                     # design docs (rusty-view.md + system design 00-06)
```

## Dependency Direction

```text
rusty-crew (Rust backend, owns protocol truth)
  ↓ generated/shared protocol types
rusty-view (this repo — boring chat client kit)
  ↓ versioned package dependency
rusty-roleplay (separate future repo — RP presentation layer)
```

`rusty-view` must know nothing about roleplay concepts. `rusty-roleplay` may
know about characters, personas, lorebooks, scene state, and presets, but it
must not own or fork core transcript mechanics.

## Library Boundary Rules

| Library | Owns | May not |
|---------|------|---------|
| protocol | Generated TS types from Rust | Angular, app logic, hand-written types |
| transport | HTTP/SSE/WS interaction with rusty-crew | Component imports, roleplay concepts |
| chat-domain | Conversation projection, event reduction, branch modeling | Angular components, network calls |
| chat-store | Current session state, message projection, stream status | Roleplay-specific state, direct network calls |
| chat-theme | Appearance settings + live `--rv-*` token application, settings persistence | Roleplay concepts, session/transcript state, direct `localStorage` |
| transcript-renderer | Virtualized rendering, scroll behavior, streaming deltas | Roleplay concepts, hardcoded message decoration |
| chat-components | Dumb presentational components (inputs/outputs only) | Service injection, store access, domain logic |
| chat-shell | Debug app layout, session list, inspector panels | Roleplay UI |
| design-tokens | Colors, spacing, typography | App-specific theme assumptions |
| testing-fixtures | Fake sessions, giant transcripts, streaming fixtures | Production code imports |

## Local Commands

```bash
# Install dependencies
npm install

# Development server (rusty-view app)
npm start

# Full CI gate
npm run ci

# Individual checks
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:affected
npm run build
npm run e2e

# Nx-specific
npx nx run rusty-view:serve
npx nx run rusty-view:build
npx nx run-many --target=test --all
npx nx graph
```

## Design Principles

- **Boring architecture**: Libraries you call > frameworks that call you.
- **Explicit over clever**: Every import, function, and type should explain
  intent to a reviewer who has never seen this codebase.
- **Boundaries are the product**: The library boundary structure IS the
  architecture. Do not dissolve boundaries for convenience.
- **Virtualization is mandatory**: The transcript renderer must survive 10k+
  messages. This is not a nice-to-have; it is a core requirement.
- **Desired failure mode**: The agent cannot compile the wrong thing because
  TypeScript strict mode, ESLint boundary rules, and Nx module boundaries
  prevent it.

## TypeScript House Style

TypeScript in this repo is written for agent governance and long-term
maintainability, not clever terseness. Frontend code rots quickly when
agents improvise; this style guide is deliberately restrictive to prevent
that.

### Write code that explains itself

Every function, variable, and type should be readable by a reviewer agent who
has never seen this codebase. The name should explain the intent. The types
should explain the shape. The structure should explain the flow.

**Bad:**
```typescript
const d = msgs.filter(m => m.s === 'act').map(m => m.b).flat();
```

**Good:**
```typescript
const activeMessageBlocks = messages
  .filter(message => message.status === 'active')
  .map(message => message.blocks)
  .flat();
```

### Prefer explicit named intermediates over chained expressions

When a computation has meaningful decision points, name them. This makes the
logic inspectable and the diff reviewable.

**Bad:**
```typescript
return events
  .filter(e => e.kind === 'MessageDelta')
  .reduce((proj, e) => applyDelta(proj, e.payload), initialProjection);
```

**Good:**
```typescript
const messageDeltas = events.filter(event => event.kind === 'MessageDelta');
const updatedProjection = messageDeltas.reduce(
  (projection, event) => applyDelta(projection, event.payload),
  initialProjection,
);
return updatedProjection;
```

### No clever abstractions until duplication has stabilized

Do not create generic utilities, base classes, or framework-shaped machinery
until the same pattern has appeared at least three times with stable shape.
Premature abstraction is the primary way frontend code becomes unmaintainable.

When you do abstract, name the abstraction after what it does, not after a
pattern name. `MessageBlockRenderer` is good. `AbstractBlockStrategy` is bad.

### Keep mutation local and visible

Prefer immutable updates (spread, structuredClone, or library helpers). When
mutation is necessary, keep it local to the smallest possible scope and make
it visible.

**Never** mutate shared state, store signals directly from components, or
create hidden mutable singletons.

### Small functions with explicit verbs

Split work into small functions where each function name is an explicit verb
describing what it does. A reviewer should be able to understand a file's
behavior by reading function names, then dive into implementations only when
needed.

```typescript
// Good: each function name is an explicit verb
function projectMessageFromDeltas(deltas: MessageDelta[]): ChatMessage { ... }
function applyToolCallBlock(message: ChatMessage, call: ToolCallEvent): ChatMessage { ... }
function shouldAutoScroll(currentScroll: ScrollPosition, streamState: StreamState): boolean { ... }

// Bad: vague names that require reading the implementation
function process(events: ConversationEvent[]): void { ... }
function update(data: any): void { ... }
function handle(event: any): void { ... }
```

### No ambient state, managers, or registries

Do not create:
- Global mutable state
- Manager classes that accumulate responsibilities
- Registry patterns that couple unrelated code
- Hidden runtime singletons
- Service locators

State lives in the store (chat-store) or in component-local signals. State
does not live in module-level variables, static class fields, or closure
captures.

### Angular component rules

- **Presentational components** (chat-components) must not inject application
  services. They receive data through `@Input()` and emit events through
  `@Output()` or typed callbacks.
- **Container/shell components** (chat-shell) may inject the store and are the
  bridge between store state and presentational components.
- Components must have empty/loading/error/long-content states where relevant.
- Hot render paths (transcript renderer) must avoid expensive inline
  computations — offload to workers.
- Use `ChangeDetectionStrategy.OnPush` everywhere.
- Use Angular Signals for reactivity. Do not use BehaviorSubject or RxJS
  subjects for local component state.

### Exhaustive type handling

Event handling and discriminated unions must be exhaustive. The TypeScript
compiler should reject unhandled cases.

```typescript
function handleEvent(event: ConversationEvent): void {
  switch (event.kind) {
    case 'MessageStarted': return handleMessageStarted(event);
    case 'MessageDelta': return handleMessageDelta(event);
    case 'MessageCompleted': return handleMessageCompleted(event);
    case 'ToolCallStarted': return handleToolCallStarted(event);
    case 'ToolCallResult': return handleToolCallResult(event);
    case 'StreamHeartbeat': return handleHeartbeat(event);
    case 'SummaryCheckpoint': return handleCheckpoint(event);
    // No default — compiler enforces exhaustive handling
  }
}
```

### A good TypeScript diff

A good diff should be easy for a reviewer agent to inspect mechanically:

- **Imports** reveal lane boundaries (does this import respect library rules?)
- **Functions** reveal intent (are the names explicit verbs?)
- **Types** reveal shape (are the interfaces clear and complete?)
- **Tests** reveal behavior (does the test name describe the scenario?)
- **Public API changes** are explicit (is the barrel export updated?)

When in doubt, write the boring version. The boring version is the one where
a reviewer can look at each line and immediately know why it's there.

## Forbidden Patterns

- No `any` — ever. Use `unknown` and narrow with type guards if needed.
- No non-null assertions (`!`). Handle nullability explicitly.
- No type assertions (`as`) unless justified in a comment and reviewed.
- No `eslint-disable` without planner-approved reason.
- No new dependency without ADR/planner approval.
- No direct import from another library's internals — public API entrypoints
  only.
- No circular dependencies.
- No hand-written protocol type duplicates.
- No direct network calls outside `transport`.
- No direct browser storage (localStorage/sessionStorage/IndexedDB) outside
  the storage adapter.
- No domain logic inside Angular components.
- No global state singleton unless explicitly approved.
- No global CSS except reset and design tokens.
- No roleplay imports inside rusty-view.

## Protocol Rules

- Rust backend owns protocol truth.
- TypeScript protocol files are generated or schema-derived.
- Generated files are not manually edited.
- Frontend command/event handling must be exhaustive by event kind.
- Unknown event kinds must fail safely and visibly in the operator client.

## Transcript Rules

- Transcript renderer must remain roleplay-agnostic.
- RP concepts must be added through decorators/providers in rusty-roleplay,
  not hardcoded into base renderer.
- Virtualization is mandatory for large transcripts.
- Tool/debug output must be collapsible.
- Large message rendering must be chunkable.
- Scroll behavior must be tested (see torture test requirements in design doc).

## Testing Rules

Every meaningful package should include:

- Unit tests for pure TypeScript/domain logic
- Fixture tests using testing-fixtures
- Public API tests where applicable

Transcript renderer must include torture tests:

- Huge session (10k+ messages)
- Huge individual message
- Streaming at tail
- Streaming while scrolled away
- Reconnect/replay
- Jump-to-message
- Collapsed/expanded large blocks

CI must run:

- Format check
- Lint
- Typecheck
- Unit tests
- Affected tests (Nx affected)
- Build
- E2E smoke test (Playwright)
- Dependency boundary checks (Nx enforce-module-boundaries)

## Suggested AGENTS.md Policy Text (for reference)

Agents working in this repo must treat architecture as fixed unless explicitly
assigned an architecture task.

Do not create new libraries, dependencies, protocols, stores, or cross-package
imports without planner approval.

Use workspace generators for new components, features, stores, and tests.

Never manually duplicate Rust protocol types in TypeScript.

Never add roleplay-specific concepts to base chat packages.

Never add direct HTTP, WebSocket, SSE, IndexedDB, localStorage, or
sessionStorage usage outside the approved adapter packages.

Never place domain logic in Angular components.

Never bypass the chat store to mutate transcript state.

Never import from another package's internal files. Use public API entrypoints
only.

Never fix a roleplay frontend problem by weakening base chat boundaries.

Prefer explicit, boring, typed code over clever abstractions.

When unsure, stop and ask the planner for a boundary decision.
