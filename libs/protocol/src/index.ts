/**
 * @rusty-view/protocol
 *
 * Wire-contract types for the Rusty Crew chat API. Type-only package: no
 * runtime code, no Angular, no transport helpers, no domain reducers.
 *
 * Source of truth: the OpenAPI 3.1 artifact at
 *   /home/dev/rusty-crew/docs/rusty-view-chat-api-v0.openapi.json
 * (human-readable companion: rusty-crew/docs/rusty-view-chat-api-contract.md).
 *
 * The generated types live in `./generated/openapi.ts` and are produced by
 * `openapi-typescript` via `nx run protocol:generate`. Generated files are not
 * hand-edited. This barrel exposes STABLE, named aliases so downstream packages
 * (transport, chat-domain, ...) import from `@rusty-view/protocol` and never
 * reach deep into the generated internals — insulating them from changes in the
 * generator's output shape.
 *
 * These are WIRE types (backend request/response/SSE shapes), not frontend
 * domain/view-model types. Projection types (ConversationProjection,
 * ChatMessage, MessageBlock, TranscriptCursor, SummaryCheckpoint,
 * ConversationBranch) belong in @rusty-view/chat-domain (#3182).
 *
 * Forward-compatibility for unknown event kinds:
 *   `ChatEventKind` is a closed union of the kinds the contract knows today,
 *   including the explicit `'unknown'` escape. If the backend later emits a
 *   brand-new kind, the raw SSE/JSON object is still valid, but its `kind` will
 *   not satisfy the closed union. Coercing an unrecognized kind into the
 *   `'unknown'` envelope (carrying the original under `payload.raw`) is the
 *   transport/domain layer's job (#3181 / #3182), NOT this package's — protocol
 *   only describes the wire shapes.
 */

import type { components, operations } from './generated/openapi';

/**
 * Schemas namespace from the generated OpenAPI artifact. Re-exported so the
 * generated structure is reachable without a deep import, but downstream code
 * should prefer the named aliases below.
 */
export type { components, operations, paths } from './generated/openapi';

/** Shortcut into the generated schemas map, for the aliases below. */
type Schemas = components['schemas'];

// ---- envelope + meta + error ----
export type ApiEnvelope = Schemas['ApiEnvelope'];
export type ApiMeta = Schemas['ApiMeta'];
export type ApiError = Schemas['ApiError'];

// ---- sessions ----
export type ChatSessionStatus = Schemas['ChatSessionStatus'];
export type ChatSessionSummary = Schemas['ChatSessionSummary'];
export type ChatSessionPage = Schemas['ChatSessionPage'];
export type ChatSessionOpenResult = Schemas['ChatSessionOpenResult'];
export type ChatEventPage = Schemas['ChatEventPage'];

// ---- events ----
export type ChatEvent = Schemas['ChatEvent'];
export type ChatEventKind = Schemas['ChatEventKind'];
export type ChatEventPayload = Schemas['ChatEventPayload'];
export type SessionSnapshotPayload = Schemas['SessionSnapshotPayload'];
export type MessageCreatedPayload = Schemas['MessageCreatedPayload'];
export type AssistantTextDeltaPayload = Schemas['AssistantTextDeltaPayload'];
export type AssistantMessageCompletedPayload =
  Schemas['AssistantMessageCompletedPayload'];
export type ToolCallPayload = Schemas['ToolCallPayload'];
export type CommandPayload = Schemas['CommandPayload'];
export type StreamErrorPayload = Schemas['StreamErrorPayload'];
export type UnknownEventPayload = Schemas['UnknownEventPayload'];

// ---- send-message ----
export type SendChatMessageRequest = Schemas['SendChatMessageRequest'];
export type ChatActor = Schemas['ChatActor'];
export type SendChatMessageResult = Schemas['SendChatMessageResult'];

// ---- commands ----
export type ChatCommandRegistry = Schemas['ChatCommandRegistry'];
export type ChatCommandDescriptor = Schemas['ChatCommandDescriptor'];
export type ExecuteChatCommandRequest = Schemas['ExecuteChatCommandRequest'];
export type ExecuteChatCommandResult = Schemas['ExecuteChatCommandResult'];

// ---- operation-level response bodies (envelope + typed data) ----
// Useful for transport (#3181) to type each route's success response precisely.
// Route path STRINGS are owned by transport, not here — protocol is type-only.
export type ListChatSessionsResponse =
  operations['listChatSessions']['responses'][200]['content']['application/json'];
export type OpenChatSessionResponse =
  operations['openChatSession']['responses'][200]['content']['application/json'];
export type ReplayChatSessionEventsResponse =
  operations['replayChatSessionEvents']['responses'][200]['content']['application/json'];
export type SendChatMessageResponse =
  operations['sendChatMessage']['responses'][202]['content']['application/json'];
export type ListChatCommandsResponse =
  operations['listChatCommands']['responses'][200]['content']['application/json'];
export type ExecuteChatCommandResponse =
  operations['executeChatCommand']['responses'][200]['content']['application/json'];

// ---- id / cursor aliases ----
//
// The wire contract types every id and cursor as a plain `string`. These
// aliases are therefore TRANSPARENT (= string) — nominal documentation only,
// not branded. Branded ids would require either runtime constructors (excluded
// from this type-only package) or hand-overriding the generated wire types
// (forbidden: no hand-written duplicates of backend protocol types). They can be
// revisited when transport (#3181) defines its typed cast boundary.
export type SessionId = string;
export type ChatEventId = string;
export type ChatCursor = string;

export const PROTOCOL_VERSION = '0.0.0' as const;
