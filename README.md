# Rusty View

Rusty View is a durable Angular chat console for Rusty Crew and a reusable set
of product-agnostic chat client libraries. The reference app is built for
operating real agents: long transcripts, active streaming, tool and reasoning
inspection, profile administration, external Codex sessions, and enough raw
diagnostics to understand what the runtime actually did.

The project deliberately stops at reusable chat and operator mechanics.
Downstream applications may add roleplay, project, character, or other product
concepts without forking the transport, transcript, session, or rendering
layers.

Rusty View is actively used against the live and debug Rusty Crew services. It
is beyond the scaffold stage, but its backend contracts still evolve with Crew
and may make deliberate breaking changes while the platform is under active
development.

## Start Here

- [Architecture](docs/rusty-view.md) describes the current library boundaries,
  data flow, external-agent console, transcript renderer, and extension points.
- [Live testing](docs/live-testing.md) defines the real Crew/LLM/browser
  certification path for streaming and user-visible work.
- [Installable web app](docs/installable-web-app.md) explains same-origin PWA
  installation and its intentionally online-only behavior.
- [Plugin API](docs/plugin-api.md) documents typed menu, panel, renderer,
  command, and data-action contributions.
- [Theming](docs/theming.md) documents design tokens and appearance settings.

## Current Application

The `apps/rusty-view` operator console has two peer conversation surfaces:

- **Profiles** are native Rusty Crew sessions. The app lists durable sessions,
  streams turns over SSE, sends messages and slash commands, and projects Crew
  text, reasoning, tool, command, usage, attachment, alternate, and debug
  events into one transcript model.
- **Agents** are Crew-managed external runtime sessions, currently including
  the official Codex app server. The app preserves runtime/session identity,
  working directory, optional Den task mapping, interaction state, controls,
  attention, and runtime-neutral transcript projection.

The operator shell also includes:

- profile creation, editing, prompt (`soul`/`memory`) management, lifecycle,
  provider assignment, context policy, local tool profiles, and MCP bindings;
- model-provider setup, reasoning controls, credential/OAuth state, revision
  conflict handling, and guarded runtime refresh;
- service configuration, wake-timeout controls, readiness and dependency
  diagnostics;
- bounded provider-request, tool-call, and Crew storage inspection;
- external-agent creation, metadata, model/collaboration options, steer/queue
  modes, interactions, interruption, archival, cleanup, and recovery;
- appearance, text-rendering, message-spacing, and hotkey settings stored in
  IndexedDB.

Backend storage and runtime state remain authoritative. Rusty View's IndexedDB
state is a local projection/cache and preference store, not a second Crew
database.

## Transcript And Streaming

The transcript renderer is the central engineering surface. It supports large
virtualized histories, active streaming at or away from the tail, stable
prepend anchoring, current-conversation search, message jumps, branches and
alternates, and collapsible reasoning/tool/command/debug blocks.

Transport uses typed HTTP plus cursor-resuming SSE. Stores hydrate snapshots,
reduce normalized events, detect cursor gaps, and reconcile reconnects without
making components perform network calls. Unknown/new event kinds remain
inspectable instead of silently disappearing.

See the focused contracts for:

- [transcript search and navigation](docs/transcript-search-navigation.md)
- [conversation tree navigation](docs/conversation-navigation.md)
- [message alternates](docs/message-alternates.md)
- [attachments and data-bank primitives](docs/attachments-and-data-bank.md)
- [rendering configuration](docs/rendering-configuration.md)
- [speaker identity](docs/speaker-identity.md)
- [semantic text scopes](docs/semantic-text-scopes.md)

Some of these are reusable frontend primitives whose full durable behavior
depends on corresponding Rusty Crew APIs. Each focused document calls out those
backend boundaries rather than faking persistence in the browser.

## Architecture

Rusty Crew owns backend protocol and persistence truth. Rusty View consumes
generated OpenAPI types and keeps transport, projection, storage, and rendering
separate:

```text
Rusty Crew chat and external-runtime HTTP/SSE APIs
  -> @rusty-view/protocol
  -> @rusty-view/transport
  -> @rusty-view/chat-store
  -> @rusty-view/chat-domain
  -> @rusty-view/transcript-renderer + shell/components
```

The main rules are:

- `protocol` contains generated/type-only wire contracts, never app logic.
- `transport` owns HTTP, SSE, cursor resumption, and admin/external clients.
- `chat-domain` is pure TypeScript projection and navigation logic.
- `chat-store` owns Angular Signals orchestration and browser persistence.
- `transcript-renderer` owns virtualization and transcript block rendering.
- `chat-components` stays presentational; `chat-shell` composes the app.
- product-specific concepts stay in downstream packages.

Nx and ESLint boundary tags enforce these directions. Do not bypass them with
cross-library relative imports or duplicate wire types.

## Repository Map

```text
apps/
  rusty-view/            operator/debug chat console
  rusty-view-e2e/        Playwright smoke and live Crew/LLM scenarios
libs/
  protocol/              generated OpenAPI wire types
  transport/             framework-neutral HTTP/SSE and admin clients
  chat-domain/           pure projection/search/navigation primitives
  chat-store/            Angular Signals stores and IndexedDB adapters
  transcript-renderer/   virtualized transcript and block rendering
  chat-components/       presentational controls and inspectors
  chat-shell/            app shell, admin panels, commands, plugins
  chat-theme/            persisted appearance settings
  design-tokens/         CSS custom properties and typed token names
  testing-fixtures/      test-only protocol/session/transcript fixtures
  workspace-generators/  approved Nx generators
docs/                    architecture and focused behavior contracts
scripts/                 local deployment helpers
```

## Getting Started

Rusty View expects Node 20+ and pnpm 11+.

```bash
pnpm install
pnpm start
```

The development server normally listens on `http://localhost:4200`. Backend
resolution is runtime-based, so one frontend build can be used in different
deployments:

1. `?api=<url>` selects an explicit, ephemeral backend for testing.
2. `window.__RUSTY_VIEW_CONFIG__.baseUrl` supplies deploy-time configuration.
3. Normal deployments use the page's own origin.
4. Recognized dev-server ports use the same host on Crew's live port `9347`.

The `?api=` override is useful for pointing a dev server at the debug Crew
service, for example:

```text
http://localhost:4200/?api=http%3A%2F%2F127.0.0.1%3A9348
```

For browser access from another machine, use the Crew host's LAN name/address;
`127.0.0.1` always means the browser's own machine.

## Deploy Into Rusty Crew

Rusty Crew serves a static frontend from `<service-root>/site` (or the
`RUSTY_CREW_STATIC_DIR` override). Deploying Rusty View there gives the app and
Crew APIs the same origin, so HTTP, SSE, reverse proxies, and installable-app
URLs require no separate backend setting.

For the standard local live and debug services, run:

```bash
./scripts/deploy-local.sh
```

The script builds `apps/rusty-view`, clears the previous static assets, and
copies `dist/apps/rusty-view/browser/` into both:

```text
/home/system/rusty-crew/site
/home/system/rusty-crew-debug/site
```

To deploy one build into another Crew service root:

```bash
pnpm exec nx build rusty-view
node tools/fix-package-esm-specifiers.mjs --write

CREW_ROOT=/path/to/rusty-crew
install -d "$CREW_ROOT/site"
find "$CREW_ROOT/site" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -a dist/apps/rusty-view/browser/. "$CREW_ROOT/site/"
```

Crew serves `index.html` at `/`, hashed assets beside it, and retains `/v1/*`
for APIs. Ordinary asset replacement does not require a Crew restart; refresh
the browser after deployment. If the service uses a custom static directory,
copy to that directory instead.

## Commands

| Script                   | Purpose                                            |
| ------------------------ | -------------------------------------------------- |
| `pnpm start`             | Serve the reference app                            |
| `pnpm build:rusty-view`  | Build the deployable application                   |
| `pnpm build`             | Build every app and library                        |
| `pnpm lint`              | Run ESLint and module-boundary checks              |
| `pnpm lint:tokens`       | Check component styles for design-token violations |
| `pnpm typecheck`         | Run strict TypeScript checks for every project     |
| `pnpm test`              | Run unit tests for every project                   |
| `pnpm e2e`               | Run deterministic Playwright scenarios             |
| `pnpm e2e:live`          | Run the local fallback live Crew/LLM scenarios     |
| `pnpm protocol:generate` | Regenerate OpenAPI-derived protocol types          |
| `pnpm protocol:check`    | Check generated protocol drift                     |
| `pnpm run ci`            | Run the deterministic repository gate              |

Use the workspace generators rather than hand-creating Angular structures:

```bash
pnpm exec nx g rv:component --name=message-bubble --project=chat-components
pnpm exec nx g rv:fixture --name=huge-session
pnpm exec nx g rv:library --name=my-lib --type=js --scope=chat-domain
```

## Protocol Contract

Protocol types are generated from Rusty Crew's checked-in OpenAPI artifacts:

```text
/home/dev/rusty-crew/docs/rusty-view-chat-api-v0.openapi.json
/home/dev/rusty-crew/docs/external-runtime-api-v0.openapi.json
```

Generated files are not hand-edited. Wire types live in
`@rusty-view/protocol`; frontend projection types live in
`@rusty-view/chat-domain`. Run `pnpm protocol:check` whenever Crew contract
changes are consumed.

## Verification

The deterministic gate is:

```bash
pnpm run ci
```

It checks formatting, design tokens, lint/boundaries, strict types, unit tests,
protocol generation drift, builds, and package smoke coverage. Playwright and
live-provider/browser certification are separate because they exercise running
services and visible behavior.

For streaming, controls, external agents, or transcript rendering, run the
broker-managed scenarios described in [live testing](docs/live-testing.md).
Passing store tests is supporting evidence; inspected browser output is the
delivery evidence for visible behavior.

## Installable App

The deployed app advertises a same-origin web manifest and can be installed by
Chromium as a standalone window. It intentionally has no service worker and
does not cache API, transcript, session, or credential data for offline use. A
stale offline operator console would be actively misleading.

See [installable-web-app.md](docs/installable-web-app.md) for certification.

## Publishing

The reusable libraries can be built from `dist/libs/<library>`. Publishing is
separate from deploying the reference app and must preserve ESM/package
boundaries. See [publishing.md](docs/publishing.md).
