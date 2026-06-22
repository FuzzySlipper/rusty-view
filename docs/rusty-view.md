# Planning Brief: Rusty Crew Chat Frontend Stack

## Context

Existing backend/harness repo:

* `rusty-crew`
* Rust-based agent loop harness
* DB-backed
* Owns backend technical fundamentals:

  * agents
  * wakes
  * persistence
  * session state
  * message/event history
  * comms plumbing
  * observability
* Current comms are presented internally like IRC for human observability, but that is not necessarily the real agent transport model.

Goal: build a formal, durable frontend architecture for interacting with `rusty-crew`.

There are two frontend projects:

1. A boring, technically strong debug/direct chat client.
2. A descendant roleplay frontend that reuses the basic chat client work while adding custom roleplay-specific presentation and menu complexity.

The intended user base is tiny, currently household-scale, not public SaaS. However, the frontend should still be architecturally strict because frontend projects rot quickly when agents are allowed to improvise.

## Core Architecture Principle

Do not build “the roleplay app” first.

Build a boring, industrial, reusable chat client kit first, with a debug app as its reference implementation.

Then build the roleplay frontend as a separate repo that consumes the base chat packages and adds roleplay-specific UI.

Dependency direction:

```text
rusty-crew
  ↓ generated/shared protocol types
rusty-view
  ↓ versioned package dependency
rusty-roleplay
```

`rusty-view` must know nothing about roleplay concepts.

`rusty-roleplay` may know about characters, personas, lorebooks, scene state, presets, and goofy menus, but it must not own or fork the core transcript/client mechanics.

## Recommended Tech Stack

Framework:

* Angular

Workspace / repo management:

* Nx

Language:

* TypeScript, strict mode

State:

* Angular Signals
* NgRx SignalStore or a very small internal signal-store wrapper

Rendering:

* Custom transcript viewport abstraction
* Start with Angular CDK virtual scroll or TanStack Virtual
* Hide chosen virtualizer behind an internal component/API

Storage:

* IndexedDB behind a storage adapter
* Do not use direct localStorage/sessionStorage for durable chat state

Transport:

* Typed client for `rusty-crew`
* HTTP for commands
* SSE or WebSocket for event streaming
* Every streamed event should have:

  * `event_id`
  * `session_id`
  * `sequence_id` or cursor
  * `created_at`
  * event kind
  * payload

Testing:

* Unit tests for pure TypeScript/domain logic
* Angular component tests sparingly
* Playwright for browser behavior
* Storybook for component contracts
* Large transcript torture fixtures
* CI typecheck/lint/test/build required

Styling:

* Design tokens
* CSS custom properties
* Angular component-scoped styles
* Avoid global CSS except reset/tokens
* Avoid utility-class soup unless tightly constrained/generated

Protocol sharing:

* Prefer Rust-generated TypeScript types.
* Candidate tools:

  * `ts-rs`
  * `specta`
  * OpenAPI generation if the backend API is shaped around HTTP endpoints
* Rule: no hand-written frontend copies of backend protocol types.

## `rusty-view` Repo Shape

`rusty-view` should be a formal Angular/Nx workspace containing a runnable debug app plus publishable libraries.

Suggested structure:

```text
rusty-view/
  apps/
    debug-chat/

  libs/
    protocol/
    transport/
    chat-domain/
    chat-store/
    transcript-renderer/
    chat-components/
    chat-shell/
    design-tokens/
    testing-fixtures/
    workspace-generators/
```

### Library Responsibilities

`protocol/`

* Generated or schema-derived TypeScript types.
* No Angular.
* No app logic.
* No hand-written duplicates of Rust backend types.

`transport/`

* Owns HTTP/SSE/WebSocket interaction with `rusty-crew`.
* No component imports.
* No roleplay concepts.
* No direct transport code outside this package.

`chat-domain/`

* Pure TypeScript domain logic.
* Conversation projection.
* Event reduction.
* Branch/session/message modeling.
* No Angular components.

`chat-store/`

* Angular-facing store layer.
* Signals/SignalStore.
* Owns current session state, message projection, stream status, connection status.
* Does not own roleplay-specific state.

`transcript-renderer/`

* Virtualized transcript rendering.
* Dynamic message height handling.
* Scroll anchoring.
* Tail-follow behavior.
* Jump-to-message behavior.
* Long-message block rendering.
* Must be roleplay-agnostic.

`chat-components/`

* Dumb reusable components:

  * message bubble
  * message input
  * stream status indicator
  * retry button
  * tool-call panel
  * raw JSON inspector
* Presentational components only.

`chat-shell/`

* Higher-level layout pieces for the debug app.
* Session list.
* Transcript region.
* Inspector panels.
* Command composer.

`design-tokens/`

* Colors, spacing, typography, density.
* No app-specific theme assumptions.

`testing-fixtures/`

* Fake sessions.
* Giant transcript fixtures.
* Streaming fixtures.
* Reconnect fixtures.
* Corrupt/partial event fixtures.

`workspace-generators/`

* Nx generators for approved component/library/test scaffolding.
* Agents should use generators rather than hand-creating Angular structures.

## `rusty-view` Debug App Requirements

The debug app is not supposed to be beautiful. It should be brutally useful.

Minimum capabilities:

* Connect to `rusty-crew`
* List sessions
* Open a session
* Render transcript
* Send a user message
* Receive streamed assistant/agent response
* Survive refresh/reconnect
* Show connection state
* Show raw event stream
* Inspect message JSON
* Inspect tool calls/results if present
* Inspect active stream cursor
* Show backend health/status
* Provide a direct command composer for debug operations

Purpose:

```text
If a behavior fails in debug-chat, investigate backend/base client.
If it only fails in rusty-roleplay, investigate roleplay presentation layer.
```

## `rusty-roleplay` Repo Shape

`rusty-roleplay` is the roleplay frontend. It consumes `rusty-view` packages.

Suggested structure:

```text
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

Roleplay-specific concepts belong here, not in `rusty-view`.

Examples:

* character selector
* persona selector
* lorebook picker
* scene/mood controls
* generation preset controls
* bot/character profile panels
* message decoration
* alternate transcript chrome
* branch/regenerate UX
* narrative mode controls
* household-specific menus and presets

## Extension Model

Use Angular dependency injection and typed extension tokens.

`rusty-view` should expose extension points such as:

```text
CHAT_MESSAGE_DECORATORS
CHAT_TOOL_RENDERERS
CHAT_SESSION_ACTIONS
CHAT_SIDEBAR_PANELS
CHAT_COMMAND_REGISTRY
CHAT_ATTACHMENT_RENDERERS
CHAT_THEME
CHAT_STORAGE_ADAPTER
CHAT_TRANSPORT_ADAPTER
```

`rusty-view` provides boring defaults.

`rusty-roleplay` overrides or extends these providers.

Rule:

* Do not use class inheritance as the primary reuse mechanism.
* Use composition, typed contracts, provider overrides, and extension tokens.

## Long Chat / Novel-Sized Transcript Design

Assume roleplay chats will become extremely long, potentially novel-sized.

Do not model the transcript as “an array rendered top to bottom.”

Model it as:

```text
Durable backend event log
  ↓
Frontend event cache
  ↓
Conversation projection
  ↓
Virtualized transcript blocks
```

Core concepts:

```text
ConversationEvent
ConversationProjection
ChatSession
ChatMessage
MessageBlock
TranscriptCursor
SummaryCheckpoint
ConversationBranch
```

Messages may contain multiple render blocks.

Example:

```text
Message
  id
  session_id
  author
  created_at
  status
  blocks[]

MessageBlock
  id
  message_id
  kind
  content_ref
  estimated_height
  render_policy
```

Reasons:

* Very long messages can be chunked.
* Tool outputs can be collapsed.
* Search can jump to specific blocks.
* Virtualization can work properly.
* Scroll position can be preserved.
* Branches/checkpoints can be modeled cleanly.

## Performance Requirements

The transcript renderer must support:

* 10k+ messages
* very long individual messages
* active streaming while user is at bottom
* active streaming while user has scrolled upward
* stable scroll anchoring when older history loads
* jump-to-message
* reload and restore scroll position
* collapsed large tool/debug sections
* partial rendering of huge text blocks
* no full transcript re-render on token delta

Streaming rule:

* Do not create one DOM update per token.
* Buffer active stream deltas.
* Update only the active message/block.
* Commit completed chunks into durable projection.

Storage rule:

* Use IndexedDB for local cache.
* Do not use localStorage for transcript/session storage.

Worker rule:

Move expensive processing off the UI thread where practical:

* markdown parsing
* syntax highlighting
* search indexing
* transcript compaction
* diffing
* large JSON inspection
* summary/checkpoint preparation

## Agent / Implementation Guardrails

The frontend should be deliberately hostile to improvisation.

### General Rules

Agents may not create arbitrary architecture.

Agents must obey repo boundaries, generated scaffolds, and public APIs.

Agents must prefer boring explicitness over cleverness.

### Required TypeScript Strictness

Enable:

```text
strict
strictNullChecks
noUncheckedIndexedAccess
exactOptionalPropertyTypes
noImplicitOverride
noPropertyAccessFromIndexSignature
noImplicitReturns
noFallthroughCasesInSwitch
```

### Dependency Rules

* No new dependency without ADR/planner approval.
* No direct import from another library’s internals.
* No circular dependencies.
* No deep imports.
* No roleplay imports inside `rusty-view`.
* No frontend-defined duplicate protocol types.
* No direct network calls outside `transport`.
* No direct browser storage outside storage adapter.
* No domain logic inside Angular components.
* No global state singleton unless approved.
* No global CSS except reset/design tokens.
* No `any`.
* No non-null assertions.
* No type assertions unless justified in comments and reviewed.
* No `eslint-disable` without planner-approved reason.

### Component Rules

* Presentational components must not inject application services.
* Components receive data through inputs and emit events through outputs or typed callbacks.
* Store-aware/container components should exist only at feature/shell boundaries.
* Components must have empty/loading/error/long-content states where relevant.
* Public reusable components need Storybook stories or equivalent fixtures.
* Hot render paths must avoid expensive inline computations.

### Protocol Rules

* Rust backend owns protocol truth.
* TypeScript protocol files are generated or schema-derived.
* Generated files are not manually edited.
* Frontend command/event handling must be exhaustive by event kind.
* Unknown event kinds must fail safely and visibly in debug client.

### Transcript Rules

* Transcript renderer must remain roleplay-agnostic.
* RP concepts must be added through decorators/providers, not hardcoded into base renderer.
* Virtualization is mandatory for large transcripts.
* Tool/debug output must be collapsible.
* Large message rendering must be chunkable.
* Scroll behavior must be tested.

### Testing Rules

Every meaningful package should include:

* unit tests
* fixture tests
* public API tests where applicable

Transcript renderer must include torture tests:

* huge session
* huge message
* streaming at tail
* streaming while scrolled away
* reconnect/replay
* jump-to-message
* collapsed/expanded large blocks

CI must run:

* format check
* lint
* typecheck
* unit tests
* affected tests
* build
* e2e smoke test
* dependency boundary checks

## Suggested `AGENTS.md` Policy Text

Agents working in this repo must treat architecture as fixed unless explicitly assigned an architecture task.

Do not create new libraries, dependencies, protocols, stores, or cross-package imports without planner approval.

Use workspace generators for new components, features, stores, and tests.

Never manually duplicate Rust protocol types in TypeScript.

Never add roleplay-specific concepts to base chat packages.

Never add direct HTTP, WebSocket, SSE, IndexedDB, localStorage, or sessionStorage usage outside the approved adapter packages.

Never place domain logic in Angular components.

Never bypass the chat store to mutate transcript state.

Never import from another package’s internal files. Use public API entrypoints only.

Never fix a roleplay frontend problem by weakening base chat boundaries.

Prefer explicit, boring, typed code over clever abstractions.

When unsure, stop and ask the planner for a boundary decision.

## Milestones

### Milestone 1: Backend Contract Spike

Goal:

* Establish minimal typed contract between `rusty-crew` and `rusty-view`.

Deliverables:

* Session list endpoint/client
* Session open endpoint/client
* Send message command
* Event stream
* Generated/shared TypeScript types
* Fake backend fixture for frontend tests

### Milestone 2: Debug Chat MVP

Goal:

* `rusty-view` can directly interact with `rusty-crew`.

Deliverables:

* session list
* transcript view
* message input
* streaming response
* connection state
* raw event inspector
* reconnect/replay behavior

### Milestone 3: Long Transcript Foundation

Goal:

* Prove the renderer survives roleplay-scale sessions.

Deliverables:

* virtualized transcript viewport
* large transcript fixtures
* scroll anchoring
* tail-follow mode
* jump-to-message
* large message chunk rendering
* streaming tests

### Milestone 4: Package Boundary Proof

Goal:

* Prove `rusty-roleplay` can consume `rusty-view` without forking.

Deliverables:

* publish or locally consume `rusty-view` packages
* create `rusty-roleplay`
* render real session via imported base packages
* override one message decorator
* add one roleplay sidebar panel through extension token

### Milestone 5: Roleplay UX Layer

Goal:

* Add roleplay-specific UI without contaminating base chat packages.

Deliverables:

* character selector
* persona selector
* scene config
* lorebook selector
* generation preset menu
* message decorators
* RP-specific layout

## Non-Goals

For `rusty-view`:

* no roleplay-specific UI
* no character/lore/persona concepts
* no fancy theme work beyond tokens
* no public SaaS account/billing/admin features
* no multi-tenant product assumptions
* no clever frontend architecture experiments

For `rusty-roleplay`:

* no ownership of core transcript mechanics
* no forked transport
* no duplicate chat store
* no direct backend protocol copies
* no bypass of `rusty-view` base client packages

## Core Design Slogan

Build `rusty-view` as a boring industrial chat console and reusable chat client kit.

Build `rusty-roleplay` as a decorated consumer with theatrical menus, not as a mutant fork.

The base client owns chat mechanics.

The roleplay client owns roleplay presentation.
