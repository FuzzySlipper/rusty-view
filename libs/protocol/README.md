# @rusty-view/protocol

Pure TypeScript **wire-contract** types for the Rusty Crew chat API. Type-only
package: no runtime code, no Angular, no transport helpers, no domain reducers.

## Source of truth

Types are generated from the Rusty Crew OpenAPI 3.1 artifact:

- **Artifact:** `/home/dev/rusty-crew/docs/rusty-view-chat-api-v0.openapi.json`
- **Human docs:** `rusty-crew/docs/rusty-view-chat-api-contract.md`

The generated file `src/generated/openapi.ts` is produced by
[`openapi-typescript`](https://github.com/drwpow/openapi-typescript) and is
**not hand-edited**. This package exposes stable, named aliases
(`ChatEvent`, `ChatSessionSummary`, `SendChatMessageRequest`, …) plus the
operation-level response bodies, so downstream packages import from
`@rusty-view/protocol` and never reach into the generated internals.

## Regenerating

```bash
# Default source: the sibling rusty-crew artifact path above.
pnpm run protocol:generate        # or: pnpm exec nx run protocol:generate

# Override the source (e.g. a local copy):
RUSTY_VIEW_OPENAPI_SOURCE=./my-openapi.json pnpm run protocol:generate
```

## Drift check

```bash
pnpm run protocol:check           # or: pnpm exec nx run protocol:check
```

Regenerates to a temp file and fails if the output differs from the checked-in
`src/generated/openapi.ts`. This runs as part of `pnpm run ci`.

> **Note:** drift can only be measured when the OpenAPI source is present. On a
> checkout without the backend repo co-located (e.g. some CI hosts), the check
> skips with a visible warning rather than failing. It is meaningful on dev
> machines where both repos are present.

## What belongs here vs. elsewhere

| Concept                                                                                                                        | Where it lives                    |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Wire request/response/SSE shapes (this package)                                                                                | `@rusty-view/protocol`            |
| Conversation projection, `ChatMessage`, `MessageBlock`, `TranscriptCursor` (scroll), `SummaryCheckpoint`, `ConversationBranch` | `@rusty-view/chat-domain` (#3182) |
| HTTP/SSE client, route path strings, fetch/EventSource mechanics                                                               | `@rusty-view/transport` (#3181)   |

## Forward-compatibility for unknown event kinds

`ChatEventKind` is a closed union of the kinds the contract knows today,
including the explicit `'unknown'` escape, and `ChatEventPayload` includes an
`UnknownEventPayload` (`{ summary, raw }`) for debug rendering. If the backend
later emits a brand-new kind, the raw object is still valid JSON but its `kind`
will not satisfy the closed union. Coercing an unrecognized kind into the
`'unknown'` envelope — carrying the original under `payload.raw` — is the
transport/domain layer's job (#3181 / #3182). This package only describes the
wire shapes; it does no runtime normalization.
