# rusty-view

Boring, industrial, **roleplay-agnostic** chat client kit and debug console for
[Rusty Crew](../rusty-crew) sessions. Built as an Angular + Nx monorepo of
strictly-boundaried libraries plus a `debug-chat` reference app.

`rusty-view` knows nothing about roleplay. A future `rusty-roleplay` repo will
consume these packages and add roleplay presentation — without forking the core
transcript/client mechanics.

## Why strict?

Frontend projects rot quickly when agents improvise. This repo is deliberately
hostile to improvisation: load-bearing library boundaries enforced by Nx module
boundaries + ESLint, generated/shared protocol types (never hand-written), and
TypeScript strict mode with the full paranoid flag set. See
[`docs/rusty-view.md`](docs/rusty-view.md) for the full design and
[`agents-project.md`](agents-project.md) for the working policy.

## Repository layout

```text
apps/
  debug-chat/            brutally useful debug client (reference implementation)
  debug-chat-e2e/        Playwright smoke for debug-chat
libs/
  protocol/              generated TS wire types from the rusty-crew OpenAPI
  transport/             HTTP/SSE client (framework-agnostic)
  chat-domain/           pure TS projection / event-reduction logic
  chat-store/            Angular Signals store
  transcript-renderer/   virtualized transcript rendering (10k+ messages)
  chat-components/       dumb presentational components
  chat-shell/            debug app layout / container components
  design-tokens/         CSS custom properties + typed token names
  testing-fixtures/      fake sessions, giant transcripts, stream fixtures
  workspace-generators/  rv:component / rv:fixture / rv:library generators
docs/                    rusty-view.md + broader RP system design (00–06)
```

## Dependency direction

```text
rusty-crew (Rust backend, owns protocol truth)
  ↓ generated/shared protocol types
rusty-view (this repo — boring chat client kit)
  ↓ versioned package dependency
rusty-roleplay (separate future repo — RP presentation layer)
```

## Getting started

Requires Node 20+ and pnpm 11+.

```bash
pnpm install
pnpm start            # serve debug-chat (http://localhost:4200)
```

## Commands

| Script                              | What it does                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm start`                        | Serve `debug-chat`                                                                 |
| `pnpm build`                        | Build all projects                                                                 |
| `pnpm lint`                         | ESLint (incl. module-boundary + forbidden-pattern rules)                           |
| `pnpm typecheck`                    | `tsc --noEmit` per project                                                         |
| `pnpm test`                         | Unit tests (vitest) for all projects                                               |
| `pnpm test:affected`                | Unit tests for affected projects only                                              |
| `pnpm e2e`                          | Playwright smoke for `debug-chat` (needs browsers: `pnpm exec playwright install`) |
| `pnpm format` / `pnpm format:check` | Prettier write / check                                                             |
| `pnpm run ci`                       | Full gate: format check → lint → typecheck → test → build                          |
| `pnpm graph`                        | Open the Nx project graph                                                          |

## Workspace generators

Use these instead of hand-creating Angular structures:

```bash
pnpm exec nx g rv:component --name=message-bubble --project=chat-components
pnpm exec nx g rv:fixture    --name=huge-session
pnpm exec nx g rv:library    --name=my-lib --type=js --scope=chat-domain
```

`rv:component` scaffolds a presentational component (OnPush, standalone,
`rv-` kebab selector, strictly-typed signal input/output) and exports it from the
host library's barrel. `rv:library` delegates to Nx's library generators with
rusty-view conventions and a validated boundary `scope` tag.

## Backend contract

Protocol types are generated from the Rusty Crew OpenAPI artifact:
`rusty-crew/docs/rusty-view-chat-api-v0.openapi.json`. See
`rusty-crew/docs/rusty-view-chat-api-contract.md`. Never hand-write backend
protocol shapes in this repo.
