# rusty-view

Rusty View is a boring, industrial chat console and reusable Angular client kit
for Rusty Crew sessions. It renders real agent transcripts, streams assistant
turns, exposes debug/admin panels, and keeps the reusable chat mechanics separate
from any downstream product-specific UI.

## What Lives Here

```text
apps/
  rusty-view/            operator/debug chat console
  rusty-view-e2e/        Playwright smoke and live conversation scenarios
libs/
  protocol/              generated OpenAPI wire types
  transport/             framework-neutral HTTP/SSE and admin clients
  chat-domain/           pure TS projection/search/navigation primitives
  chat-store/            Angular Signals store and IndexedDB chat storage
  transcript-renderer/   virtualized transcript and block rendering
  chat-components/       presentational inputs, status, menus, inspectors
  chat-shell/            debug shell, panels, command/plugin composition
  chat-theme/            persisted appearance settings and theme service
  design-tokens/         CSS custom properties and typed token names
  testing-fixtures/      protocol/session/transcript test fixtures
  workspace-generators/  local Nx generators
docs/                    current repo docs only
```

## Architecture

Rusty Crew owns backend protocol truth. Rusty View consumes generated
OpenAPI-derived TypeScript types and keeps each layer narrow:

```text
Rusty Crew API/SSE
  -> @rusty-view/protocol
  -> @rusty-view/transport
  -> @rusty-view/chat-store
  -> @rusty-view/chat-domain
  -> @rusty-view/transcript-renderer + shell/components
```

See [docs/rusty-view.md](docs/rusty-view.md) for the current architecture map.

## Getting Started

Requires Node 20+ and pnpm 11+.

```bash
pnpm install
pnpm start
```

`pnpm start` serves `apps/rusty-view` at the Angular dev-server URL printed by
Nx, normally `http://localhost:4200`.

## Commands

| Script                              | What it does                                                    |
| ----------------------------------- | --------------------------------------------------------------- |
| `pnpm start`                        | Serve `rusty-view`                                              |
| `pnpm build`                        | Build all projects                                              |
| `pnpm lint`                         | ESLint, including module-boundary rules                         |
| `pnpm lint:tokens`                  | Check component styles for design-token violations              |
| `pnpm typecheck`                    | `tsc --noEmit` per project                                      |
| `pnpm test`                         | Unit tests for all projects                                     |
| `pnpm e2e`                          | Playwright smoke tests                                          |
| `pnpm e2e:live`                     | Local fallback for live real Crew/LLM scenarios                 |
| `pnpm format` / `pnpm format:check` | Prettier write / check                                          |
| `pnpm protocol:generate`            | Regenerate OpenAPI-derived protocol types                       |
| `pnpm protocol:check`               | Verify generated protocol types are current                     |
| `pnpm run ci`                       | Format check, token lint, lint, typecheck, tests, build, checks |

Agents should run live scenarios through the shared `den-playwright` broker so
server ports, process ownership, and evidence artifacts are managed consistently.
The local script remains as a fallback. Live scenarios are intentionally opt-in
and write human-inspectable artifacts.
See [docs/live-testing.md](docs/live-testing.md).

## Workspace Generators

Use the local generators instead of hand-creating Angular structures:

```bash
pnpm exec nx g rv:component --name=message-bubble --project=chat-components
pnpm exec nx g rv:fixture --name=huge-session
pnpm exec nx g rv:library --name=my-lib --type=js --scope=chat-domain
```

## Protocol Contract

Protocol types are generated from the Rusty Crew OpenAPI artifact:

```text
/home/dev/rusty-crew/docs/rusty-view-chat-api-v0.openapi.json
```

Generated files are not hand-edited. Frontend domain/view-model types live in
`@rusty-view/chat-domain`; wire types live in `@rusty-view/protocol`.

## Docs

- [docs/rusty-view.md](docs/rusty-view.md) - current architecture map
- [docs/live-testing.md](docs/live-testing.md) - real LLM/front-end testing
- [docs/plugin-api.md](docs/plugin-api.md) - plugin and contribution contracts
- [docs/theming.md](docs/theming.md) - design tokens and appearance settings
- [docs/tooltips.md](docs/tooltips.md) - reusable tooltip API and guidance
- [docs/publishing.md](docs/publishing.md) - package publishing notes
