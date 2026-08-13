/**
 * @rusty-view/transport
 *
 * HTTP/SSE client for the Rusty Crew chat session API. Owns ALL backend
 * communication: session list/open, event replay, send-message, command
 * registry/execute (HTTP), and live event streaming (fetch-based SSE with
 * cursor resume + bounded exponential backoff reconnection).
 *
 * Framework-neutral: no Angular, no components, no product concepts. The
 * Angular chat-store adapts transport's connection state to Signals.
 *
 * Protocol types come from @rusty-view/protocol (generated from OpenAPI).
 * No generated HTTP client — fetch/SSE handling is hand-written and explicit
 * for full control over auth, CORS, reconnect, cursor, and debug behavior.
 *
 * Implemented in Den task #3181.
 */

export { ChatTransport } from './lib/chat-transport';
export type { StreamEventsOptions } from './lib/chat-transport';

export { ChatHttpTransport } from './lib/chat-http-transport';
export type {
  ListSessionsQuery,
  OpenSessionQuery,
  ReplayEventsQuery,
} from './lib/chat-http-transport';
export { AdminHttpTransport } from './lib/admin-http-transport';
export { ExternalRuntimeHttpTransport } from './lib/external-runtime-http-transport';
export { ExternalRuntimeEventStream } from './lib/external-runtime-event-stream';
export type {
  AdminActivityQuery,
  AdminListQuery,
} from './lib/admin-http-transport';
export type {
  AdminAgentDiagnostics,
  AdminApiEnvelope,
  ApiCapabilityDescriptor,
  ApiCapabilityRegistry,
  AdminControlOutcome,
  AdminControlResponse,
  AdminDiagnosticsBundle,
  AdminDiagnosticsOverview,
  AdminPage,
  AdminLocalToolProfile,
  AdminLocalToolProfileList,
  AdminLocalToolProfileWriteRequest,
  AdminMcpBinding,
  AdminMcpCatalog,
  AdminMcpServer,
  AdminMcpServerSource,
  AdminProfileAssetStatus,
  AdminProfileRegistryAssetStatus,
  AdminProfileRegistryDiagnostics,
  AdminProfileRegistryQuery,
  AdminProfileRegistryRecord,
  AdminProfileRegistrySource,
  AdminToolCatalog,
  AdminToolDescriptor,
  AdminToolsetDescriptor,
  ContextDebugVisibility,
  ContextStrategyCatalog,
  CoordinationAgentDirectory,
  CoordinationMessageTrafficQuery,
  CoordinationMessageTrafficResult,
  CoordinationDeliveryResult,
  CoordinationDeploymentRole,
  CoordinationResolveResult,
  CoordinationRoundRequest,
  CoordinationRoundResult,
  CoordinationRouteList,
  CoordinationRouteResult,
  CoordinationRouteTestRequest,
  CoordinationRouteWriteRequest,
  ContextStrategyDescriptor,
  ContextStrategyPolicy,
  ChatCompletionsDialect,
  ChatCompletionsPromptCaching,
  ChatCompletionsReasoningHistory,
  ChatCompletionsThinkingMode,
  ExternalMessageDeliveryPolicy,
  CreateAdminProfileRequest,
  CreateProfileMcpBinding,
  CreateProfileToolPolicy,
  CreatedProfileRuntimeAction,
  CreatedServiceProfile,
  McpSurfaceDiagnostics,
  MemorySurfaceAvailability,
  MemorySurfaceCatalogItem,
  MemorySurfaceCatalogProjection,
  MemorySurfaceOwner,
  ModelProviderCredential,
  ModelProviderCredentialKind,
  ModelProviderCredentialSecretInput,
  ModelProviderCredentialStatus,
  ModelProviderKind,
  ModelProviderCredentialLinkRequest,
  ModelProviderCredentialLinkResponse,
  ModelProviderCredentialUnlinkRequest,
  ModelProviderCredentialUnlinkResponse,
  ModelProviderPage,
  ModelProviderProtocol,
  ModelProviderQuery,
  ModelProviderRecord,
  ModelProviderRefreshMode,
  ModelProviderRefreshOutcome,
  ModelProviderRefreshProfile,
  ModelProviderRefreshResult,
  ModelProviderStatus,
  ModelProviderWriteRequest,
  ModelProviderWriteResponse,
  OpenAiOauthClearRequest,
  OpenAiOauthClearResponse,
  OpenAiOauthCompleteRequest,
  OpenAiOauthCompleteResponse,
  OpenAiOauthFakeTokenResponse,
  OpenAiOauthPendingLogin,
  OpenAiOauthStartRequest,
  OpenAiOauthStartResponse,
  OpenAiOauthStatusResponse,
  ResponsesProviderDialect,
  ServiceCredentialDeleteResponse,
  ServiceCredentialImpact,
  ServiceCredentialOpenAiOauthClearResponse,
  ServiceCredentialOpenAiOauthCompleteResponse,
  ServiceCredentialOpenAiOauthStartResponse,
  ServiceCredentialOpenAiOauthStatusResponse,
  ServiceCredentialPage,
  ServiceCredentialQuery,
  ServiceCredentialRecord,
  ServiceCredentialWriteRequest,
  ServiceCredentialWriteResponse,
  ProfileBundleExportEntry,
  ProfileBundleExportEntryKind,
  ProfileBundleExportPlan,
  ProfileBundleExportSource,
  ProfileBrainRebuildRequest,
  ProfileBrainRebuildResult,
  ProfileDeleteRequest,
  ProfileDeleteResult,
  ProfilePurgeReport,
  ProfilePurgeTableCount,
  ProfileRegistryDerivedRuntimeRef,
  ProfileRegistryFieldUpdateRequest,
  ProfileRegistryLifecycleEffects,
  ProfileRegistryLifecycleRequest,
  ProfileRegistryLifecycleStatus,
  ProfileRegistryPromptRequest,
  ProfileRegistryRuntimeConfigRequest,
  ProfileRegistryRuntimeConfigPlan,
  ProfileRegistryRuntimeConfigApplyResult,
  ProfileRegistryRuntimeConfigAppliedResult,
  ProfileRegistryRuntimeConfigImplications,
  ProfileRegistryRuntimeConfigEffects,
  EditableProfileRuntimeConfig,
  ProfileRuntimeToolPolicy,
  AdminProfileRuntimeMcpBinding,
  ProfileRegistrySourceAssetRef,
  ProfileRegistryWriteApplyResult,
  ProfileRegistryWriteDiagnostic,
  ProfileRegistryWriteImplications,
  ProfileRegistryWritePlan,
  RuntimeBrainModuleDiagnostics,
  RuntimeActivityCensus,
  RuntimeActivityCensusSummary,
  RuntimeActivityFinding,
  RuntimeActivityFindingCode,
  RuntimeActivityKind,
  RuntimeActivityOwner,
  RuntimeActivityRecord,
  RuntimeActivityStatus,
  RuntimeActivityView,
  RuntimeConfigApplyResult,
  RuntimeConfigDiagnostic,
  RuntimeConfigDraft,
  RuntimeConfigDraftPlan,
  RuntimeConfigDraftRequest,
  RuntimeConfigValidationReport,
  RuntimeWakeTimeoutConfig,
  RuntimeWakeTimeoutPatchRequest,
  RuntimeWakeTimeoutPatchResult,
  SessionWorkspaceChangeRequest,
  SessionWorkspaceChangeResult,
  RuntimePauseControlRequest,
  RuntimePauseControlResult,
  RuntimePauseDiagnostics,
  RuntimePauseScope,
  RuntimeResumeNoopResult,
  RuntimeSessionDiagnostics,
  StorageQueryCatalog,
  StorageQueryDescriptor,
  StorageQueryInput,
  StorageQueryModuleMetadata,
  StorageQueryParameter,
  StorageQueryParameterType,
  StorageQueryResult,
  TelegramDiplomatBinding,
  TelegramDiplomatBindingCreateRequest,
  TelegramDiplomatBindingData,
  TelegramDiplomatBindingMoveRequest,
  TelegramDiplomatBindingRelabelRequest,
  TelegramDiplomatBindingRevisionRequest,
  TelegramDiplomatCredentialUpdateRequest,
  TelegramDiplomatReadback,
} from './lib/admin-api-types';

export { ChatEventStream } from './lib/chat-event-stream';
export type {
  ChatEventStreamOptions,
  SleepFunction,
} from './lib/chat-event-stream';
export { calculateBackoffDelay, defaultSleep } from './lib/chat-event-stream';

export type {
  ChatConnectionState,
  ConnectionStateListener,
  Unsubscribe,
} from './lib/connection-state';

export {
  ChatTransportError,
  classifyFetchError,
  toChatTransportError,
  withChatTransportEndpoint,
} from './lib/chat-transport-error';
export type {
  ChatTransportErrorCode,
  ChatTransportErrorInit,
} from './lib/chat-transport-error';

export type {
  ChatTransportConfig,
  ChatTransportConfigInput,
  FetchImpl,
} from './lib/chat-transport-config';
export { resolveChatTransportConfig } from './lib/chat-transport-config';

export const TRANSPORT_VERSION = '0.0.0' as const;
