# Rusty View Architecture

Rusty View is an Angular/Nx frontend for Rusty Crew chat sessions and generic
external agent runtimes. It is both:

- the `apps/rusty-view` operator/debug console; and
- a set of reusable `@rusty-view/*` chat client libraries.

The repo is intentionally product-agnostic. Backend protocol truth lives in
Rusty Crew. This repo consumes generated/schema-derived wire types, projects
them into frontend view models, and renders/debugs real sessions.

## Current Workspace Shape

```text
apps/
  rusty-view/            operator/debug chat console
  rusty-view-e2e/        Playwright smoke and live conversation tests
libs/
  protocol/              generated OpenAPI wire types
  transport/             framework-neutral HTTP/SSE and admin clients
  chat-domain/           pure TS projection, search, attachments, navigation
  chat-store/            Angular Signals store and IndexedDB chat storage
  transcript-renderer/   virtualized transcript and block rendering
  chat-components/       presentational inputs, status, menus, inspectors
  chat-shell/            debug shell, panels, command/plugin composition
  chat-theme/            persisted appearance settings and theme service
  design-tokens/         CSS custom properties and token-name exports
  testing-fixtures/      protocol/session/transcript test fixtures
  workspace-generators/  local Nx generators
```

## Data Flow

```text
Rusty Crew chat and external-runtime OpenAPI / SSE
  -> @rusty-view/protocol
  -> @rusty-view/transport
  -> @rusty-view/chat-store
  -> @rusty-view/chat-domain projection
  -> @rusty-view/transcript-renderer + chat shell/components
```

Important boundaries:

- `protocol` is type-only wire contract. Generated files are not hand-edited.
- `transport` owns backend I/O. Components and stores do not perform raw fetches.
- `chat-domain` is pure TypeScript. It has no Angular, browser, storage, or I/O.
- `chat-store` adapts transport/domain to Angular Signals and storage.
- `transcript-renderer` owns virtualized transcript behavior and rendering hooks.
- `chat-shell` composes the reference app and plugin contribution points.
- `chat-theme` owns persisted appearance settings and applies design tokens.
- `testing-fixtures` is test-only and must not be imported by production libs.

## External Agent Console

The reference shell exposes Profiles and Agents as peer conversation sources.
The Agents source is session-first: it lists persisted external threads with
runtime, working directory, optional Den task mapping, lifecycle state, unread
activity, and attention. Selecting a thread projects its runtime-neutral history
and normalized live events through the same transcript renderer used by direct
chat sessions.

The implementation keeps the normal library boundaries:

- `protocol` generates wire types from `external-runtime-api-v0.openapi.json`;
- `transport` owns external runtime HTTP, cursor-resuming SSE, interactions, and controls;
- `chat-domain` projects text, reasoning, plans, commands, file changes, usage, tools, and unknown debug events into generic message blocks;
- `chat-store` owns runtime-namespaced identity, fleet polling, selected-thread streaming, lifecycle reduction, attention, and async controls; and
- `chat-shell` owns the Agents panel, auto/steer/queue composer modes, interrupt control, structured interaction card, and bounded raw-event inspection.

Selection is load-gated so a user cannot submit against a half-loaded thread.
Only the selected thread opens an SSE stream; fleet lifecycle and interaction
attention advance through cursor-based polling. Full native payloads remain out
of the normal transcript and are fetched on demand through bounded raw-detail
references.

## Transcript Renderer

The transcript renderer is the core engineering surface. It must support:

- 10k+ message histories;
- active streaming while at the tail and while scrolled away;
- stable scroll anchoring when history is prepended;
- jump-to-message and current-conversation search;
- collapsible reasoning/tool/command/debug blocks;
- attachment blocks;
- configurable text rendering modes;
- extension-provided content renderers.
- avatar-capable speaker identity and generic semantic text scopes.

See:

- [transcript-search-navigation.md](transcript-search-navigation.md)
- [conversation-navigation.md](conversation-navigation.md)
- [attachments-and-data-bank.md](attachments-and-data-bank.md)
- [rendering-configuration.md](rendering-configuration.md)
- [speaker-identity.md](speaker-identity.md)
- [semantic-text-scopes.md](semantic-text-scopes.md)
- [message-alternates.md](message-alternates.md)

## Extension Points

Rusty View uses Angular DI and typed contribution contracts. Current public
extension surfaces include top-menu items, Options tabs, content renderers,
slash commands, enum providers, sidebar panel contracts, data-action contracts,
message toolbar action contracts, and theme defaults.

See [plugin-api.md](plugin-api.md).

## Session Metadata And Lifecycle

Rusty View's generic chat session contract is intentionally product-agnostic.
Downstream packages may attach meaning to opaque session metadata, but
Rusty View does not define product fields such as character ids, lore layer ids,
or roleplay phase labels.

The current Rusty Crew chat OpenAPI exposes list/open/replay/stream/send-command
flows for sessions. It does not yet expose browser-safe session
create/update/archive/restore routes or first-class session metadata fields on
`ChatSessionSummary`. Until Crew promotes those fields/routes into the generic
contract, `@rusty-view/transport` and `ChatStore` do not provide fake lifecycle
methods. Consumers can use the type-only
`ChatSessionSummaryWithOpaqueMetadata` helper for compatible backend extensions,
but backend data remains the source of truth.

## Theming

Visual styling flows through `libs/design-tokens` CSS custom properties and the
`libs/chat-theme` appearance service. Components should reference `--rv-*`
tokens and avoid hardcoded colors or fallback values.

See [theming.md](theming.md).

## Tooltips

Use the exported `rvTooltip` directive from `@rusty-view/chat-components` for
short supplemental hints on compact controls. Avoid native `title` attributes on
app chrome, and keep required instructions visible in the UI instead of hiding
them in a tooltip.

See [tooltips.md](tooltips.md).

## Live Testing

For bugs that depend on real streaming, controls, or rendered transcript output,
use the broker-managed live Playwright scenarios against a real Rusty Crew
backend/profile/LLM. The close criterion is inspected browser evidence, not
merely a passing deterministic assertion.

See [live-testing.md](live-testing.md).

The gated `external-agent-console.live.spec.ts` scenario uses the real Codex
app-server and Rusty Crew external-runtime routes. It proves Den-mapped work,
steer, interrupt, fleet attention, command/file rendering, browser refresh, and
exact-thread recovery after service replacement. See
[external-agent-console-certification.md](external-agent-console-certification.md)
for the low-risk edit created by that real external agent.

## Publishing

Publishable libraries are built from `dist/libs/<lib>` and must avoid source
workspace-only package metadata leaking into published artifacts.

See [publishing.md](publishing.md).
