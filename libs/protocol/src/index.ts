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
import type {
  components as externalComponents,
  operations as externalOperations,
} from './generated/external-openapi';

/**
 * Schemas namespace from the generated OpenAPI artifact. Re-exported so the
 * generated structure is reachable without a deep import, but downstream code
 * should prefer the named aliases below.
 */
export type { components, operations, paths } from './generated/openapi';
export type {
  components as ExternalApiComponents,
  operations as ExternalApiOperations,
  paths as ExternalApiPaths,
} from './generated/external-openapi';

/** Shortcut into the generated schemas map, for the aliases below. */
type Schemas = components['schemas'];
type ExternalSchemas = externalComponents['schemas'];

// ---- external-agent runtime ----
export type ExternalRuntimeFleet = ExternalSchemas['ExternalRuntimeFleet'];
export type ExternalRuntimeRegistration =
  ExternalSchemas['ExternalRuntimeRegistration'];
export type ExternalRuntimeControllerStatus =
  ExternalSchemas['ExternalRuntimeControllerStatus'];
export type ExternalRuntimeObservedState =
  ExternalSchemas['ExternalRuntimeObservedState'];
export type ExternalBindingFleet = ExternalSchemas['ExternalBindingFleet'];
export type ExternalAgentBinding = ExternalSchemas['ExternalAgentBinding'];
export type ExternalBindingMetadataWrite =
  ExternalSchemas['ExternalBindingMetadataWrite'];
export type ExternalAgentSessionCreateWrite =
  ExternalSchemas['ExternalAgentSessionCreateWrite'];
export type ExternalAgentSessionCreateResult =
  ExternalSchemas['ExternalAgentSessionCreateResult'];
export type ExternalThreadPage = ExternalSchemas['ExternalThreadPage'];
export type ExternalThreadProjection =
  ExternalSchemas['ExternalThreadProjection'];
export type ExternalThreadReadRequest =
  ExternalSchemas['ExternalThreadReadRequest'];
export type ExternalThreadReadResult =
  ExternalSchemas['ExternalThreadReadResult'];
export type ExternalThreadLifecycleReceipt =
  ExternalSchemas['ExternalThreadLifecycleReceipt'];
export type ExternalThreadDeleteReceipt =
  ExternalSchemas['ExternalThreadDeleteReceipt'];
export type ExternalRuntimeEventPage =
  ExternalSchemas['ExternalRuntimeEventPage'];
export type NormalizedExternalRuntimeEvent =
  ExternalSchemas['NormalizedExternalRuntimeEvent'];
export type ExternalRuntimeEventPayload =
  ExternalSchemas['ExternalRuntimeEventPayload'];
export type ExternalRuntimeRawDetail =
  ExternalSchemas['ExternalRuntimeRawDetail'];
export type ExternalInteractionAttention =
  ExternalSchemas['ExternalInteractionAttention'];
export type ExternalInteractionRecord =
  ExternalSchemas['ExternalInteractionRecord'];
export type ExternalInteractionResolutionWrite =
  ExternalSchemas['ExternalInteractionResolutionWrite'];
export type ExternalControlKind = ExternalSchemas['ExternalControlKind'];
export type ExternalControlWrite = ExternalSchemas['ExternalControlWrite'];
export type ExternalControlReceipt = ExternalSchemas['ExternalControlReceipt'];
export type ExternalBindingMessageWrite =
  ExternalSchemas['ExternalBindingMessageWrite'];
export type ExternalTurnPhase = ExternalSchemas['ExternalTurnPhase'];
export type ExternalRuntimeCommandWrite =
  ExternalSchemas['ExternalRuntimeCommandWrite'];
export type ExternalRuntimeCommandDescriptor =
  ExternalSchemas['ExternalRuntimeCommandDescriptor'];
export type ExternalRuntimeReasoningEffortOption =
  ExternalSchemas['ExternalRuntimeReasoningEffortOption'];
export type ExternalRuntimeModelOption =
  ExternalSchemas['ExternalRuntimeModelOption'];
export type ExternalThreadSettingsProjection =
  ExternalSchemas['ExternalThreadSettingsProjection'];
export type ExternalThreadUsageProjection =
  ExternalSchemas['ExternalThreadUsageProjection'];
export type ExternalThreadCommandStatus =
  ExternalSchemas['ExternalThreadCommandStatus'];
export type ExternalRuntimeCommandCatalog =
  ExternalSchemas['ExternalRuntimeCommandCatalog'];
export type ExternalRuntimeCommandResultData =
  ExternalSchemas['ExternalRuntimeCommandResultData'];
export type ExternalRuntimeCommandExecutionResult =
  ExternalSchemas['ExternalRuntimeCommandExecutionResult'];

export type ListExternalRuntimesResponse =
  externalOperations['listExternalRuntimes']['responses'][200]['content']['application/json'];
export type CreateExternalAgentSessionResponse =
  externalOperations['createExternalAgentSession']['responses'][200]['content']['application/json'];
export type ListExternalBindingsResponse =
  externalOperations['listExternalBindings']['responses'][200]['content']['application/json'];
export type WriteExternalBindingMetadataResponse =
  externalOperations['writeExternalBindingMetadata']['responses'][200]['content']['application/json'];
export type ListExternalRuntimeThreadsResponse =
  externalOperations['listExternalRuntimeThreads']['responses'][200]['content']['application/json'];
export type ReadExternalRuntimeThreadResponse =
  externalOperations['readExternalRuntimeThread']['responses'][200]['content']['application/json'];
export type ArchiveExternalRuntimeThreadResponse =
  externalOperations['archiveExternalRuntimeThread']['responses'][200]['content']['application/json'];
export type UnarchiveExternalRuntimeThreadResponse =
  externalOperations['unarchiveExternalRuntimeThread']['responses'][200]['content']['application/json'];
export type DeleteExternalRuntimeThreadResponse =
  externalOperations['deleteExternalRuntimeThread']['responses'][200]['content']['application/json'];
export type ListExternalRuntimeEventsResponse =
  externalOperations['listExternalRuntimeEvents']['responses'][200]['content']['application/json'];
export type ListExternalInteractionsResponse =
  externalOperations['listExternalInteractions']['responses'][200]['content']['application/json'];
export type SubmitExternalBindingControlResponse =
  externalOperations['submitExternalBindingControl']['responses'][200]['content']['application/json'];
export type SendExternalBindingMessageResponse =
  externalOperations['sendExternalBindingMessage']['responses'][200]['content']['application/json'];
export type ListExternalBindingCommandsResponse =
  externalOperations['listExternalBindingCommands']['responses'][200]['content']['application/json'];
export type ExecuteExternalBindingCommandResponse =
  externalOperations['executeExternalBindingCommand']['responses'][200]['content']['application/json'];
export type ResolveExternalInteractionResponse =
  externalOperations['resolveExternalInteraction']['responses'][200]['content']['application/json'];
export type ReadExternalRuntimeRawDetailResponse =
  externalOperations['readExternalRuntimeRawDetail']['responses'][200]['content']['application/json'];

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

/**
 * Opaque downstream-owned session metadata. The current Rusty Crew chat
 * OpenAPI does not expose a first-class metadata field on
 * {@link ChatSessionSummary}; this helper type gives product packages a
 * roleplay-agnostic cast target if a compatible backend sends browser-safe
 * metadata before the generated contract grows a dedicated field.
 */
export type ChatSessionOpaqueMetadata = Record<string, unknown>;

export type ChatSessionSummaryWithOpaqueMetadata = ChatSessionSummary & {
  readonly metadata?: ChatSessionOpaqueMetadata;
  readonly metadata_json?: unknown;
  readonly extensions?: ChatSessionOpaqueMetadata;
};

// ---- events ----
export type ChatEvent = Schemas['ChatEvent'];
export type ChatEventKind = Schemas['ChatEventKind'];
export type ChatEventPayload = Schemas['ChatEventPayload'];
export type SessionSnapshotPayload = Schemas['SessionSnapshotPayload'];
export type MessageCreatedPayload = Schemas['MessageCreatedPayload'];
export type AssistantTextDeltaPayload = Schemas['AssistantTextDeltaPayload'];
export type AssistantReasoningDeltaPayload =
  Schemas['AssistantReasoningDeltaPayload'];
export type AssistantMessageCompletedPayload =
  Schemas['AssistantMessageCompletedPayload'];

/**
 * Browser-safe agent phase event payload. The current OpenAPI enum includes
 * `phase_change`, but the contract artifact has not yet promoted this payload
 * into `ChatEventPayload.oneOf`; keep the shape deliberately generic and
 * label-free. Downstream packages own any user-facing labels.
 */
export interface PhaseChangePayload {
  readonly wake_id?: string;
  readonly phase: string;
  readonly message?: string;
  readonly [key: string]: unknown;
}

export interface ProviderStatusPayload {
  readonly wake_id?: string;
  readonly level: 'info' | 'degraded' | 'error' | string;
  readonly message: string;
  readonly metadata_json?: unknown;
  readonly [key: string]: unknown;
}

export type ToolCallPayload = Schemas['ToolCallPayload'];
export type ToolCallDebugValue = Schemas['ToolCallDebugValue'];
export type ToolCallDebugDetail = Schemas['ToolCallDebugDetail'];
export type ProviderRequestDebugDetail = Schemas['ProviderRequestDebugDetail'];
export type CommandPayload = Schemas['CommandPayload'];
export type StreamErrorPayload = Schemas['StreamErrorPayload'];
export type UnknownEventPayload = Schemas['UnknownEventPayload'];

// ---- message variants / conversation tree ----
export type MessageSlotRecord = Schemas['MessageSlotRecord'];
export type MessageSlotPage = Schemas['MessageSlotPage'];
export type MessageVariantRecord = Schemas['MessageVariantRecord'];
export type MessageVariantPage = Schemas['MessageVariantPage'];
export type SelectActiveMessageVariantRequest =
  Schemas['SelectActiveMessageVariantRequest'];
export type SelectActiveMessageVariantResult =
  Schemas['SelectActiveMessageVariantResult'];
export type MessageSlotMutationResult = Schemas['MessageSlotMutationResult'];
export type ConversationTreeProjection = Schemas['ConversationTreeProjection'];
export type ConversationBranchRecord = Schemas['ConversationBranchRecord'];
export type ConversationSnapshotRecord = Schemas['ConversationSnapshotRecord'];
export type SelectActiveConversationBranchRequest =
  Schemas['SelectActiveConversationBranchRequest'];
export type SelectActiveConversationBranchResult =
  Schemas['SelectActiveConversationBranchResult'];

// ---- context strategy / compaction diagnostics (tasks #3788/#3846/#3847) ----
//
// Browser-safe metadata payload carried by the four `context_*` event kinds
// (`context_status`, `context_compaction_started`, `context_compaction_completed`,
// `context_compaction_failed`). It is explicitly marked `ui_debug: true` /
// `model_facing: false` by the backend and never carries summary text or
// provider secrets.
export type ContextDebugPayload = Schemas['ContextDebugPayload'];

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
export type GetChatToolCallDebugDetailResponse =
  operations['getChatToolCallDebugDetail']['responses'][200]['content']['application/json'];
export type GetChatProviderRequestDebugDetailResponse =
  operations['getChatProviderRequestDebugDetail']['responses'][200]['content']['application/json'];
export type ListMessageSlotsResponse =
  operations['listMessageSlots']['responses'][200]['content']['application/json'];
export type ListMessageVariantsResponse =
  operations['listMessageVariants']['responses'][200]['content']['application/json'];
export type DeleteMessageVariantResponse =
  operations['deleteMessageVariant']['responses'][200]['content']['application/json'];
export type SelectActiveMessageVariantResponse =
  operations['selectActiveMessageVariant']['responses'][200]['content']['application/json'];
export type GetConversationTreeResponse =
  operations['getConversationTree']['responses'][200]['content']['application/json'];
export type SelectActiveConversationBranchResponse =
  operations['selectActiveConversationBranch']['responses'][200]['content']['application/json'];

// ---- context usage diagnostics (tasks #3788/#3847) ----
//
// Read model/provider/brain and approximate context-usage diagnostics for one
// session (`GET /v1/chat/sessions/{session_id}/context`). Browser-safe: hosts
// only redacted base URLs, never raw credentials. Includes the session's current
// context-strategy policy and the latest compaction artifact metadata (without
// summary text).
export type SessionContextUsageResult = Schemas['SessionContextUsageResult'];
export type GetChatSessionContextUsageResponse =
  operations['getChatSessionContextUsage']['responses'][200]['content']['application/json'];

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
