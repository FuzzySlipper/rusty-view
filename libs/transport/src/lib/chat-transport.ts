import type {
  ChatCommandRegistry,
  ChatEvent,
  ChatEventPage,
  ChatSessionOpenResult,
  ChatSessionPage,
  ExecuteChatCommandRequest,
  ExecuteChatCommandResult,
  SendChatMessageRequest,
  SendChatMessageResult,
  SessionContextUsageResult,
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
  ModelProviderProtocol,
  ModelProviderQuery,
  ModelProviderRecord,
  ModelProviderRefreshMode,
  ModelProviderStatus,
  ModelProviderWriteRequest,
  ModelProviderWriteResponse,
  ProfileBundleExportPlan,
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

  createAdminProfile(
    request: CreateAdminProfileRequest,
  ): Promise<AdminControlResponse<CreatedServiceProfile>> {
    return this.adminHttp.createProfile(request);
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
