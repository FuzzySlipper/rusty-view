import type {
  ChatCommandRegistry,
  ChatEvent,
  ChatEventPage,
  ChatSessionOpenResult,
  ChatSessionPage,
  ConversationTreeProjection,
  ExecuteChatCommandRequest,
  ExecuteChatCommandResult,
  MessageSlotMutationResult,
  MessageSlotPage,
  MessageVariantPage,
  ProviderRequestDebugDetail,
  SendChatMessageRequest,
  SendChatMessageResult,
  SelectActiveConversationBranchRequest,
  SelectActiveConversationBranchResult,
  SelectActiveMessageVariantRequest,
  SelectActiveMessageVariantResult,
  SessionContextUsageResult,
  ToolCallDebugDetail,
} from '@rusty-view/protocol';

import { ChatHttpTransport } from './chat-http-transport';
import type {
  ListSessionsQuery,
  OpenSessionQuery,
  ReplayEventsQuery,
} from './chat-http-transport';
import { ChatEventStream } from './chat-event-stream';
import type { SleepFunction } from './chat-event-stream';
import { defaultSleep } from './chat-event-stream';
import type {
  ChatTransportConfig,
  ChatTransportConfigInput,
  FetchImpl,
} from './chat-transport-config';
import { resolveChatTransportConfig } from './chat-transport-config';
import { AdminHttpTransport } from './admin-http-transport';
import type {
  AdminAgentDiagnostics,
  AdminControlResponse,
  AdminDiagnosticsBundle,
  AdminDiagnosticsOverview,
  AdminLocalToolProfile,
  AdminLocalToolProfileList,
  AdminLocalToolProfileWriteRequest,
  AdminMcpCatalog,
  AdminToolCatalog,
  AdminPage,
  ContextStrategyCatalog,
  AdminProfileRegistryDiagnostics,
  AdminProfileRegistryQuery,
  AdminProfileRegistryRecord,
  ApiCapabilityRegistry,
  CreateAdminProfileRequest,
  CreatedServiceProfile,
  McpSurfaceDiagnostics,
  ModelProviderPage,
  ModelProviderQuery,
  ModelProviderRecord,
  ModelProviderRefreshMode,
  ModelProviderWriteRequest,
  ModelProviderWriteResponse,
  OpenAiOauthClearRequest,
  OpenAiOauthClearResponse,
  OpenAiOauthCompleteRequest,
  OpenAiOauthCompleteResponse,
  OpenAiOauthStartRequest,
  OpenAiOauthStartResponse,
  OpenAiOauthStatusResponse,
  ProfileBundleExportPlan,
  ProfileBrainRebuildRequest,
  ProfileBrainRebuildResult,
  ProfileDeleteRequest,
  ProfileDeleteResult,
  ProfileRegistryFieldUpdateRequest,
  ProfileRegistryLifecycleRequest,
  ProfileRegistryPromptRequest,
  ProfileRegistryRuntimeConfigApplyResult,
  ProfileRegistryRuntimeConfigPlan,
  ProfileRegistryRuntimeConfigRequest,
  ProfileRegistryWriteApplyResult,
  ProfileRegistryWritePlan,
  RuntimeConfigApplyResult,
  RuntimeConfigValidationReport,
  RuntimePauseControlRequest,
  RuntimePauseControlResult,
  RuntimePauseScope,
  RuntimeResumeNoopResult,
  RuntimeSessionDiagnostics,
  StorageQueryCatalog,
  StorageQueryInput,
  StorageQueryResult,
} from './admin-api-types';
import type { AdminListQuery } from './admin-http-transport';

/** Options for {@link ChatTransport.streamEvents}. */
export interface StreamEventsOptions {
  /** Resume from this cursor (from a previous session's getLastCursor). */
  readonly initialCursor?: string;
  /** Override sleep (testing). Defaults to real setTimeout. */
  readonly sleep?: SleepFunction;
}

/**
 * Public transport client for the Rusty Crew chat session API.
 *
 * Composes {@link ChatHttpTransport} (request/response HTTP) and
 * {@link ChatEventStream} (SSE streaming). Owns ALL backend communication —
 * no transport code exists outside this package.
 *
 * Framework-neutral: no Angular. The Angular chat-store adapts connection
 * state to Signals.
 *
 * Create one per debug-app instance (or per browser tab). The config is
 * resolved and frozen at construction; bearer tokens are never persisted.
 */
export class ChatTransport {
  private readonly config: ChatTransportConfig;
  private readonly http: ChatHttpTransport;
  private readonly adminHttp: AdminHttpTransport;
  private readonly fetchImpl: FetchImpl;

  constructor(configInput: ChatTransportConfigInput) {
    this.config = resolveChatTransportConfig(configInput);
    this.http = new ChatHttpTransport(this.config);
    this.adminHttp = new AdminHttpTransport(this.config);
    // Bind fetch to globalThis (see ChatHttpTransport for the 'Illegal
    // invocation' rationale).
    this.fetchImpl = this.config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  getConfig(): Readonly<ChatTransportConfig> {
    return this.config;
  }

  // ---- HTTP endpoints (delegate to ChatHttpTransport) ----

  listSessions(query?: ListSessionsQuery): Promise<ChatSessionPage> {
    return this.http.listSessions(query);
  }

  openSession(
    sessionId: string,
    query?: OpenSessionQuery,
  ): Promise<ChatSessionOpenResult> {
    return this.http.openSession(sessionId, query);
  }

  replayEventsPage(
    sessionId: string,
    query?: ReplayEventsQuery,
  ): Promise<ChatEventPage> {
    return this.http.replayEventsPage(sessionId, query);
  }

  replayEvents(
    sessionId: string,
    query?: ReplayEventsQuery,
  ): Promise<ChatEvent[]> {
    return this.http.replayEvents(sessionId, query);
  }

  /**
   * Replay all historical events after a cursor, following pagination until the
   * backend reports no more (task #3865). Prefer this over {@link replayEvents}
   * for catch-up/recovery so a multi-page turn is fully ingested.
   */
  replayAllEvents(
    sessionId: string,
    query?: ReplayEventsQuery,
  ): Promise<ChatEvent[]> {
    return this.http.replayAllEvents(sessionId, query);
  }

  sendMessage(
    sessionId: string,
    request: SendChatMessageRequest,
    idempotencyKey?: string,
  ): Promise<SendChatMessageResult> {
    return this.http.sendMessage(sessionId, request, idempotencyKey);
  }

  sessionContext(sessionId: string): Promise<SessionContextUsageResult> {
    return this.http.sessionContext(sessionId);
  }

  toolCallDebugDetail(
    sessionId: string,
    debugDetailId: string,
  ): Promise<ToolCallDebugDetail> {
    return this.http.toolCallDebugDetail(sessionId, debugDetailId);
  }

  providerRequestDebugDetail(
    sessionId: string,
    debugDetailId: string,
  ): Promise<ProviderRequestDebugDetail> {
    return this.http.providerRequestDebugDetail(sessionId, debugDetailId);
  }

  listMessageSlots(
    sessionId: string,
    query?: { limit?: number; offset?: number; include_alternates?: boolean },
  ): Promise<MessageSlotPage> {
    return this.http.listMessageSlots(sessionId, query);
  }

  listMessageVariants(
    sessionId: string,
    slotId: string,
    query?: { limit?: number; offset?: number },
  ): Promise<MessageVariantPage> {
    return this.http.listMessageVariants(sessionId, slotId, query);
  }

  selectActiveMessageVariant(
    sessionId: string,
    slotId: string,
    request: SelectActiveMessageVariantRequest,
  ): Promise<SelectActiveMessageVariantResult> {
    return this.http.selectActiveMessageVariant(sessionId, slotId, request);
  }

  deleteMessageVariant(
    sessionId: string,
    slotId: string,
    variantId: string,
  ): Promise<MessageSlotMutationResult> {
    return this.http.deleteMessageVariant(sessionId, slotId, variantId);
  }

  conversationTree(
    sessionId: string,
    query?: { limit?: number; offset?: number; exclude_snapshots?: boolean },
  ): Promise<ConversationTreeProjection> {
    return this.http.conversationTree(sessionId, query);
  }

  selectActiveConversationBranch(
    sessionId: string,
    request: SelectActiveConversationBranchRequest,
  ): Promise<SelectActiveConversationBranchResult> {
    return this.http.selectActiveConversationBranch(sessionId, request);
  }

  listCommands(): Promise<ChatCommandRegistry> {
    return this.http.listCommands();
  }

  sendCommand(
    sessionId: string,
    request: ExecuteChatCommandRequest,
    idempotencyKey?: string,
  ): Promise<ExecuteChatCommandResult> {
    return this.http.sendCommand(sessionId, request, idempotencyKey);
  }

  // ---- admin diagnostics/control endpoints ----

  adminDiagnostics(): Promise<AdminDiagnosticsBundle> {
    return this.adminHttp.diagnostics();
  }

  adminOverview(): Promise<AdminDiagnosticsOverview> {
    return this.adminHttp.overview();
  }

  adminSessions(
    query?: AdminListQuery,
  ): Promise<AdminPage<RuntimeSessionDiagnostics>> {
    return this.adminHttp.sessions(query);
  }

  adminAgents(
    query?: AdminListQuery,
  ): Promise<AdminPage<AdminAgentDiagnostics>> {
    return this.adminHttp.agents(query);
  }

  adminMcpSurfaces(
    query?: AdminListQuery,
  ): Promise<AdminPage<McpSurfaceDiagnostics>> {
    return this.adminHttp.mcpSurfaces(query);
  }

  adminConfigValidation(): Promise<RuntimeConfigValidationReport | null> {
    return this.adminHttp.configValidation();
  }

  adminMcpCatalog(): Promise<AdminMcpCatalog> {
    return this.adminHttp.mcpCatalog();
  }

  adminToolCatalog(): Promise<AdminToolCatalog> {
    return this.adminHttp.toolCatalog();
  }

  adminLocalToolProfiles(): Promise<AdminLocalToolProfileList> {
    return this.adminHttp.localToolProfiles();
  }

  adminCreateLocalToolProfile(
    body: AdminLocalToolProfileWriteRequest,
  ): Promise<AdminLocalToolProfile> {
    return this.adminHttp.createLocalToolProfile(body);
  }

  adminUpdateLocalToolProfile(
    id: string,
    body: AdminLocalToolProfileWriteRequest,
  ): Promise<AdminLocalToolProfile> {
    return this.adminHttp.updateLocalToolProfile(id, body);
  }

  adminDeleteLocalToolProfile(id: string): Promise<void> {
    return this.adminHttp.deleteLocalToolProfile(id);
  }

  adminCapabilities(): Promise<ApiCapabilityRegistry> {
    return this.adminHttp.capabilities();
  }

  adminStorageQueryCatalog(): Promise<StorageQueryCatalog> {
    return this.adminHttp.storageQueryCatalog();
  }

  adminStorageQuery(
    queryId: string,
    input?: StorageQueryInput,
  ): Promise<StorageQueryResult> {
    return this.adminHttp.storageQuery(queryId, input);
  }

  adminStorageSchema(): Promise<unknown> {
    return this.adminHttp.storageSchema();
  }

  adminStorageDiagnostics(): Promise<unknown> {
    return this.adminHttp.storageDiagnostics();
  }

  adminContextStrategies(): Promise<ContextStrategyCatalog> {
    return this.adminHttp.contextStrategies();
  }

  adminProfileRegistry(
    query?: AdminProfileRegistryQuery,
  ): Promise<AdminPage<AdminProfileRegistryRecord>> {
    return this.adminHttp.profileRegistry(query);
  }

  adminProfileRegistryRecord(
    profileId: string,
  ): Promise<AdminProfileRegistryRecord> {
    return this.adminHttp.profileRegistryRecord(profileId);
  }

  adminProfileDiagnostics(): Promise<AdminProfileRegistryDiagnostics | null> {
    return this.adminHttp.profileDiagnostics();
  }

  adminProfileExportPlan(profileId: string): Promise<ProfileBundleExportPlan> {
    return this.adminHttp.profileExportPlan(profileId);
  }

  planAdminProfileRegistryUpdate(
    profileId: string,
    request: ProfileRegistryFieldUpdateRequest,
  ): Promise<ProfileRegistryWritePlan> {
    return this.adminHttp.planProfileRegistryUpdate(profileId, request);
  }

  applyAdminProfileRegistryUpdate(
    profileId: string,
    request: ProfileRegistryFieldUpdateRequest,
  ): Promise<ProfileRegistryWriteApplyResult> {
    return this.adminHttp.applyProfileRegistryUpdate(profileId, request);
  }

  planAdminProfileRegistryLifecycle(
    profileId: string,
    request: ProfileRegistryLifecycleRequest,
  ): Promise<ProfileRegistryWritePlan> {
    return this.adminHttp.planProfileRegistryLifecycle(profileId, request);
  }

  applyAdminProfileRegistryLifecycle(
    profileId: string,
    request: ProfileRegistryLifecycleRequest,
  ): Promise<ProfileRegistryWriteApplyResult> {
    return this.adminHttp.applyProfileRegistryLifecycle(profileId, request);
  }

  planAdminProfileRegistryPrompt(
    profileId: string,
    request: ProfileRegistryPromptRequest,
  ): Promise<ProfileRegistryWritePlan> {
    return this.adminHttp.planProfileRegistryPrompt(profileId, request);
  }

  applyAdminProfileRegistryPrompt(
    profileId: string,
    request: ProfileRegistryPromptRequest,
  ): Promise<ProfileRegistryWriteApplyResult> {
    return this.adminHttp.applyProfileRegistryPrompt(profileId, request);
  }

  planAdminProfileRegistryRuntimeConfig(
    profileId: string,
    request: ProfileRegistryRuntimeConfigRequest,
  ): Promise<ProfileRegistryRuntimeConfigPlan> {
    return this.adminHttp.planProfileRegistryRuntimeConfig(profileId, request);
  }

  applyAdminProfileRegistryRuntimeConfig(
    profileId: string,
    request: ProfileRegistryRuntimeConfigRequest,
  ): Promise<ProfileRegistryRuntimeConfigApplyResult> {
    return this.adminHttp.applyProfileRegistryRuntimeConfig(profileId, request);
  }

  adminModelProviders(query?: ModelProviderQuery): Promise<ModelProviderPage> {
    return this.adminHttp.modelProviders(query);
  }

  adminModelProvider(alias: string): Promise<ModelProviderRecord> {
    return this.adminHttp.modelProvider(alias);
  }

  createAdminModelProvider(
    request: ModelProviderWriteRequest,
    refresh?: ModelProviderRefreshMode,
  ): Promise<ModelProviderWriteResponse> {
    return this.adminHttp.createModelProvider(request, refresh);
  }

  updateAdminModelProvider(
    alias: string,
    request: ModelProviderWriteRequest,
    refresh?: ModelProviderRefreshMode,
  ): Promise<ModelProviderWriteResponse> {
    return this.adminHttp.updateModelProvider(alias, request, refresh);
  }

  adminOpenAiOauthStatus(alias: string): Promise<OpenAiOauthStatusResponse> {
    return this.adminHttp.openAiOauthStatus(alias);
  }

  adminStartOpenAiOauthLogin(
    alias: string,
    request?: OpenAiOauthStartRequest,
  ): Promise<OpenAiOauthStartResponse> {
    return this.adminHttp.startOpenAiOauthLogin(alias, request);
  }

  adminCompleteOpenAiOauthLogin(
    alias: string,
    request: OpenAiOauthCompleteRequest,
  ): Promise<OpenAiOauthCompleteResponse> {
    return this.adminHttp.completeOpenAiOauthLogin(alias, request);
  }

  adminClearOpenAiOauthCredential(
    alias: string,
    request?: OpenAiOauthClearRequest,
  ): Promise<OpenAiOauthClearResponse> {
    return this.adminHttp.clearOpenAiOauthCredential(alias, request);
  }

  createAdminProfile(
    request: CreateAdminProfileRequest,
  ): Promise<AdminControlResponse<CreatedServiceProfile>> {
    return this.adminHttp.createProfile(request);
  }

  planAdminProfileBrainRebuild(
    profileId: string,
    request?: ProfileBrainRebuildRequest,
  ): Promise<AdminControlResponse<ProfileBrainRebuildResult>> {
    return this.adminHttp.planProfileBrainRebuild(profileId, request);
  }

  applyAdminProfileBrainRebuild(
    profileId: string,
    request?: ProfileBrainRebuildRequest,
  ): Promise<AdminControlResponse<ProfileBrainRebuildResult>> {
    return this.adminHttp.applyProfileBrainRebuild(profileId, request);
  }

  deleteAdminProfile(
    profileId: string,
    request: ProfileDeleteRequest,
  ): Promise<AdminControlResponse<ProfileDeleteResult>> {
    return this.adminHttp.deleteProfile(profileId, request);
  }

  reloadAdminConfig(
    reason?: string,
  ): Promise<AdminControlResponse<RuntimeConfigApplyResult>> {
    return this.adminHttp.reloadConfig(reason);
  }

  pauseRuntime(
    scope: RuntimePauseScope,
    targetId: string,
    request: RuntimePauseControlRequest,
  ): Promise<AdminControlResponse<RuntimePauseControlResult>> {
    return this.adminHttp.pauseRuntime(scope, targetId, request);
  }

  resumeRuntime(
    scope: RuntimePauseScope,
    targetId: string,
    request?: RuntimePauseControlRequest,
  ): Promise<
    AdminControlResponse<RuntimePauseControlResult | RuntimeResumeNoopResult>
  > {
    return this.adminHttp.resumeRuntime(scope, targetId, request);
  }

  // ---- SSE event stream ----

  /**
   * Open a live SSE event stream for a chat session. Returns a
   * {@link ChatEventStream} whose `events()` async iterator yields typed
   * {@link ChatEvent} values, reconnecting transparently on disconnect.
   *
   * The caller is responsible for calling `close()` when done (e.g. when the
   * Angular store is destroyed or the user navigates away).
   */
  streamEvents(
    sessionId: string,
    options?: StreamEventsOptions,
  ): ChatEventStream {
    const sleep = options?.sleep ?? defaultSleep;
    return new ChatEventStream({
      config: this.config,
      sessionId,
      fetchImpl: this.fetchImpl,
      sleep,
      ...(options?.initialCursor !== undefined
        ? { initialCursor: options.initialCursor }
        : {}),
    });
  }
}

// Query types re-exported for callers; see chat-http-transport for definitions.
