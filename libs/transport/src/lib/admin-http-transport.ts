import {
  ChatTransportError,
  classifyFetchError,
  withChatTransportEndpoint,
} from './chat-transport-error';
import type { ChatTransportConfig, FetchImpl } from './chat-transport-config';
import { HEADER_NAMES } from './chat-routes';
import type {
  AdminAgentDiagnostics,
  AdminApiEnvelope,
  ApiCapabilityRegistry,
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
  AdminProfileRegistryDiagnostics,
  AdminProfileRegistryQuery,
  AdminProfileRegistryRecord,
  CreateAdminProfileRequest,
  CreatedServiceProfile,
  McpSurfaceDiagnostics,
  MemorySurfaceCatalogProjection,
  ModelProviderPage,
  ModelProviderQuery,
  ModelProviderRecord,
  ModelProviderRefreshMode,
  ModelProviderWriteRequest,
  ModelProviderWriteResponse,
  ModelProviderCredentialLinkRequest,
  ModelProviderCredentialLinkResponse,
  ModelProviderCredentialUnlinkRequest,
  ModelProviderCredentialUnlinkResponse,
  OpenAiOauthClearRequest,
  OpenAiOauthClearResponse,
  OpenAiOauthCompleteRequest,
  OpenAiOauthCompleteResponse,
  OpenAiOauthStartRequest,
  OpenAiOauthStartResponse,
  OpenAiOauthStatusResponse,
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
  RuntimePauseControlRequest,
  RuntimePauseControlResult,
  RuntimeResumeNoopResult,
  RuntimeConfigApplyResult,
  RuntimeConfigDraftPlan,
  RuntimeConfigDraftRequest,
  RuntimeConfigValidationReport,
  RuntimeWakeTimeoutPatchRequest,
  RuntimeWakeTimeoutPatchResult,
  SessionWorkspaceChangeRequest,
  SessionWorkspaceChangeResult,
  RuntimePauseScope,
  RuntimeActivityCensus,
  RuntimeSessionDiagnostics,
  StorageQueryCatalog,
  StorageQueryInput,
  StorageQueryResult,
  TelegramDiplomatBindingCreateRequest,
  TelegramDiplomatBindingData,
  TelegramDiplomatBindingMoveRequest,
  TelegramDiplomatBindingRelabelRequest,
  TelegramDiplomatBindingRevisionRequest,
  TelegramDiplomatCredentialUpdateRequest,
  TelegramDiplomatReadback,
} from './admin-api-types';

interface RequestOptions {
  readonly query?: Record<string, unknown>;
  readonly body?: unknown;
}

export interface AdminListQuery {
  readonly limit?: number;
  readonly offset?: number;
  readonly status?: string;
  readonly profile_id?: string;
}

export interface AdminActivityQuery {
  readonly sessionProjection?: 'service' | 'durable';
}

export class AdminHttpTransport {
  private readonly fetchImpl: FetchImpl;

  constructor(private readonly config: ChatTransportConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  diagnostics(): Promise<AdminDiagnosticsBundle> {
    return this.request('GET', '/v1/admin/diagnostics');
  }

  overview(): Promise<AdminDiagnosticsOverview> {
    return this.request('GET', '/v1/admin/diagnostics/overview');
  }

  sessions(
    query?: AdminListQuery,
  ): Promise<AdminPage<RuntimeSessionDiagnostics>> {
    return this.request(
      'GET',
      '/v1/admin/diagnostics/sessions',
      optionsForQuery(query),
    );
  }

  agents(query?: AdminListQuery): Promise<AdminPage<AdminAgentDiagnostics>> {
    return this.request(
      'GET',
      '/v1/admin/diagnostics/agents',
      optionsForQuery(query),
    );
  }

  activities(
    query?: AdminActivityQuery,
  ): Promise<RuntimeActivityCensus | null> {
    return this.request(
      'GET',
      '/v1/admin/diagnostics/activities',
      optionsForQuery(query),
    );
  }

  mcpSurfaces(
    query?: AdminListQuery,
  ): Promise<AdminPage<McpSurfaceDiagnostics>> {
    return this.request(
      'GET',
      '/v1/admin/diagnostics/mcp',
      optionsForQuery(query),
    );
  }

  memorySurfaces(): Promise<MemorySurfaceCatalogProjection> {
    return this.request('GET', '/v1/admin/diagnostics/memory-surfaces');
  }

  configValidation(): Promise<RuntimeConfigValidationReport | null> {
    return this.request('GET', '/v1/admin/diagnostics/config');
  }

  /**
   * MCP server catalog (task #3647): configured MCP servers, known tool
   * profile keys, and current binding resolution details. Used to populate
   * MCP server choices for profile creation instead of asking for a free-form
   * base URL.
   */
  mcpCatalog(): Promise<AdminMcpCatalog> {
    return this.request('GET', '/v1/admin/mcp/servers');
  }

  /**
   * Built-in tool catalog (task #3686): valid non-MCP toolsets/tools from
   * Crew's tool registry. Used to populate built-in tool policy choices for
   * profile creation instead of hardcoding registry contents in the frontend.
   */
  toolCatalog(): Promise<AdminToolCatalog> {
    return this.request('GET', '/v1/admin/tools/catalog');
  }

  /**
   * List DB-backed local tool profiles (task #3689 / Crew #3688). Reusable
   * named built-in tool selections referenced by profiles.
   *
   * Crew's live contract returns `{ items: [...] }` with `toolsets`/`tools`
   * fields on each item; we normalize at this boundary to the UI-facing
   * `{ profiles: [...] }` / `requestedToolsets`/`requestedTools` shape so the
   * store and components stay decoupled from the wire spelling.
   */
  async localToolProfiles(): Promise<AdminLocalToolProfileList> {
    const wire = await this.request<LocalToolProfileListWire>(
      'GET',
      '/v1/admin/local-tool-profiles',
    );
    const items = wire.items ?? wire.profiles ?? [];
    return { profiles: items.map(normalizeLocalToolProfile) };
  }

  /** Create a local tool profile (task #3689). */
  async createLocalToolProfile(
    body: AdminLocalToolProfileWriteRequest,
  ): Promise<AdminLocalToolProfile> {
    const wire = await this.request<LocalToolProfileWriteWire>(
      'POST',
      '/v1/admin/local-tool-profiles',
      { body: localToolProfileWriteBody(body) },
    );
    return normalizeLocalToolProfile(wire.profile);
  }

  /** Update a local tool profile by id (task #3689). */
  async updateLocalToolProfile(
    id: string,
    body: AdminLocalToolProfileWriteRequest,
  ): Promise<AdminLocalToolProfile> {
    const wire = await this.request<LocalToolProfileWriteWire>(
      'PATCH',
      `/v1/admin/local-tool-profiles/${encodeURIComponent(id)}`,
      { body: localToolProfileWriteBody(body) },
    );
    return normalizeLocalToolProfile(wire.profile);
  }

  /** Delete or archive a local tool profile by id (task #3689). */
  deleteLocalToolProfile(id: string): Promise<void> {
    return this.request(
      'DELETE',
      `/v1/admin/local-tool-profiles/${encodeURIComponent(id)}`,
    );
  }

  capabilities(): Promise<ApiCapabilityRegistry> {
    return this.request('GET', '/v1/admin/capabilities');
  }

  telegramDiplomat(): Promise<TelegramDiplomatReadback> {
    return this.request('GET', '/v1/admin/telegram-diplomat');
  }

  createTelegramDiplomatBinding(
    request: TelegramDiplomatBindingCreateRequest,
  ): Promise<TelegramDiplomatBindingData> {
    return this.request('POST', '/v1/admin/telegram-diplomat/bindings', {
      body: request,
    });
  }

  moveTelegramDiplomatBinding(
    bindingId: string,
    request: TelegramDiplomatBindingMoveRequest,
  ): Promise<TelegramDiplomatBindingData> {
    return this.telegramDiplomatBindingMutation(bindingId, 'move', request);
  }

  relabelTelegramDiplomatBinding(
    bindingId: string,
    request: TelegramDiplomatBindingRelabelRequest,
  ): Promise<TelegramDiplomatBindingData> {
    return this.telegramDiplomatBindingMutation(bindingId, 'relabel', request);
  }

  setTelegramDiplomatBindingStatus(
    bindingId: string,
    action: 'pause' | 'resume' | 'remove',
    request: TelegramDiplomatBindingRevisionRequest,
  ): Promise<TelegramDiplomatBindingData> {
    return this.telegramDiplomatBindingMutation(bindingId, action, request);
  }

  updateTelegramDiplomatCredential(
    request: TelegramDiplomatCredentialUpdateRequest,
  ): Promise<TelegramDiplomatReadback & { readonly tokenUpdated: true }> {
    return this.request('POST', '/v1/admin/telegram-diplomat/credential', {
      body: request,
    });
  }

  reloadTelegramDiplomat(): Promise<TelegramDiplomatReadback> {
    return this.request('POST', '/v1/admin/telegram-diplomat/reload', {
      body: {},
    });
  }

  private telegramDiplomatBindingMutation(
    bindingId: string,
    action: 'move' | 'relabel' | 'pause' | 'resume' | 'remove',
    body:
      | TelegramDiplomatBindingMoveRequest
      | TelegramDiplomatBindingRelabelRequest
      | TelegramDiplomatBindingRevisionRequest,
  ): Promise<TelegramDiplomatBindingData> {
    return this.request(
      'POST',
      `/v1/admin/telegram-diplomat/bindings/${encodeURIComponent(bindingId)}/${action}`,
      { body },
    );
  }

  /** Read the directory through this deployment's fixed coordination surface. */
  async coordinationAgentDirectory(): Promise<CoordinationAgentDirectory> {
    const expectedRole = coordinationRole(this.config);
    const directory = await this.request<CoordinationAgentDirectory>(
      'GET',
      `${coordinationPrefix(expectedRole)}/agents`,
    );
    if (directory.deploymentRole !== expectedRole) {
      throw new ChatTransportError({
        code: 'envelope_error',
        message: `Crew coordination endpoint expected ${expectedRole} but reported ${directory.deploymentRole}`,
      });
    }
    return directory;
  }

  /** Read durable coordination delivery legs from this deployment role. */
  async coordinationMessageTraffic(
    query: CoordinationMessageTrafficQuery = {},
  ): Promise<CoordinationMessageTrafficResult> {
    const expectedRole = coordinationRole(this.config);
    const result = await this.request<CoordinationMessageTrafficResult>(
      'GET',
      `${coordinationPrefix(expectedRole)}/messages`,
      { query: compactRecord(query) },
    );
    if (result.deploymentRole !== expectedRole) {
      throw new ChatTransportError({
        code: 'envelope_error',
        message: `Crew coordination endpoint expected ${expectedRole} but reported ${result.deploymentRole}`,
      });
    }
    return result;
  }

  coordinationRoutes(
    role: CoordinationDeploymentRole,
  ): Promise<CoordinationRouteList> {
    return this.request('GET', `${coordinationPrefix(role)}/routes`);
  }

  coordinationCreateRoute(
    role: CoordinationDeploymentRole,
    request: CoordinationRouteWriteRequest,
  ): Promise<CoordinationRouteResult> {
    return this.request('POST', `${coordinationPrefix(role)}/routes`, {
      body: request,
    });
  }

  coordinationUpdateRoute(
    role: CoordinationDeploymentRole,
    routeKey: string,
    request: CoordinationRouteWriteRequest,
  ): Promise<CoordinationRouteResult> {
    return this.request(
      'PATCH',
      `${coordinationPrefix(role)}/routes/${encodeURIComponent(routeKey)}`,
      { body: request },
    );
  }

  coordinationDeleteRoute(
    role: CoordinationDeploymentRole,
    routeKey: string,
    expectedRevision: number,
  ): Promise<CoordinationRouteResult> {
    return this.request(
      'DELETE',
      `${coordinationPrefix(role)}/routes/${encodeURIComponent(routeKey)}`,
      { query: { expectedRevision } },
    );
  }

  coordinationResolveAddress(
    role: CoordinationDeploymentRole,
    address: string,
  ): Promise<CoordinationResolveResult> {
    return this.request('POST', `${coordinationPrefix(role)}/routes/resolve`, {
      body: { address },
    });
  }

  coordinationTestRoute(
    role: CoordinationDeploymentRole,
    routeKey: string,
    request: CoordinationRouteTestRequest,
  ): Promise<CoordinationDeliveryResult> {
    return this.request(
      'POST',
      `${coordinationPrefix(role)}/routes/${encodeURIComponent(routeKey)}/test`,
      { body: request },
    );
  }

  coordinationStartRound(
    role: CoordinationDeploymentRole,
    request: CoordinationRoundRequest,
  ): Promise<CoordinationRoundResult> {
    return this.request('POST', `${coordinationPrefix(role)}/rounds`, {
      body: request,
    });
  }

  coordinationRound(
    role: CoordinationDeploymentRole,
    roundId: string,
  ): Promise<CoordinationRoundResult> {
    return this.request(
      'GET',
      `${coordinationPrefix(role)}/rounds/${encodeURIComponent(roundId)}`,
    );
  }

  /** List curated read-only Rusty Crew storage queries. */
  storageQueryCatalog(): Promise<StorageQueryCatalog> {
    return this.request('GET', '/v1/admin/storage/query-catalog');
  }

  /** Execute one curated read-only storage query by id. Raw SQL is not exposed. */
  storageQuery(
    queryId: string,
    input: StorageQueryInput = {},
  ): Promise<StorageQueryResult> {
    return this.request(
      'POST',
      `/v1/admin/storage/query/${encodeURIComponent(queryId)}`,
      { body: input },
    );
  }

  /** Read Rusty Crew storage schema diagnostics. */
  storageSchema(): Promise<unknown> {
    return this.request('GET', '/v1/admin/storage/schema');
  }

  /** Read Rusty Crew storage backend diagnostics/capability projection. */
  storageDiagnostics(): Promise<unknown> {
    return this.request('GET', '/v1/admin/diagnostics/storage');
  }

  /**
   * Context strategy catalog (task #3849): default strategy id, available
   * strategy descriptors, policy defaults, and the percent range. Drives the
   * profile context-policy controls so strategy ids are never hardcoded.
   */
  contextStrategies(): Promise<ContextStrategyCatalog> {
    return this.request('GET', '/v1/admin/context-strategies');
  }

  /**
   * List DB-backed profile registry records (including file-backed fallback
   * projections). See ADR 0019. Returns a paginated admin page.
   */
  profileRegistry(
    query?: AdminProfileRegistryQuery,
  ): Promise<AdminPage<AdminProfileRegistryRecord>> {
    return this.request(
      'GET',
      '/v1/admin/profiles/registry',
      optionsForRegistryQuery(query),
    );
  }

  /**
   * Read a single profile registry record by profile id. Throws a
   * `not_found` admin error when the profile is not in the registry and has
   * no file-backed fallback projection.
   */
  profileRegistryRecord(
    profileId: string,
  ): Promise<AdminProfileRegistryRecord> {
    return this.request(
      'GET',
      `/v1/admin/profiles/registry/${encodeURIComponent(profileId)}`,
    );
  }

  /**
   * Profile registry diagnostics: lifecycle status, revision, derived runtime
   * refs, source asset refs/fingerprints, and registry/file drift. Returns
   * `null` when the backend does not expose the registry diagnostics route.
   */
  profileDiagnostics(): Promise<AdminProfileRegistryDiagnostics | null> {
    return this.request('GET', '/v1/admin/diagnostics/profiles');
  }

  /**
   * Plan a profile bundle export for backup/review. The plan distinguishes
   * active DB state entries from file asset entries and optional memory-space
   * entries; it does not mutate service config or sessions.
   */
  profileExportPlan(profileId: string): Promise<ProfileBundleExportPlan> {
    return this.request(
      'GET',
      `/v1/admin/profiles/registry/${encodeURIComponent(profileId)}/export-plan`,
    );
  }

  /**
   * Plan a registry field update (task #3519) without applying it. Returns the
   * projected `next` record and any diagnostics (e.g. revision mismatch).
   */
  planProfileRegistryUpdate(
    profileId: string,
    request: ProfileRegistryFieldUpdateRequest,
  ): Promise<ProfileRegistryWritePlan> {
    return this.request(
      'POST',
      registryWritePath(profileId, 'update', 'plan'),
      { body: request as unknown as Record<string, unknown> },
    );
  }

  /**
   * Apply a registry field update (task #3519). Requires `expectedRevision`;
   * on success the persisted record is returned with a bumped revision.
   */
  applyProfileRegistryUpdate(
    profileId: string,
    request: ProfileRegistryFieldUpdateRequest,
  ): Promise<ProfileRegistryWriteApplyResult> {
    return this.request(
      'POST',
      registryWritePath(profileId, 'update', 'apply'),
      { body: request as unknown as Record<string, unknown> },
    );
  }

  /**
   * Plan a registry lifecycle transition (task #3521) without applying it.
   * Returns the projected `next` record and lifecycle implications.
   */
  planProfileRegistryLifecycle(
    profileId: string,
    request: ProfileRegistryLifecycleRequest,
  ): Promise<ProfileRegistryWritePlan> {
    return this.request(
      'POST',
      registryWritePath(profileId, 'lifecycle', 'plan'),
      { body: request as unknown as Record<string, unknown> },
    );
  }

  /**
   * Apply a registry lifecycle transition (task #3521). Non-active transitions
   * disable derived runtime refs, archive active sessions, and unregister the
   * profile brain; assets and memory are preserved.
   */
  applyProfileRegistryLifecycle(
    profileId: string,
    request: ProfileRegistryLifecycleRequest,
  ): Promise<ProfileRegistryWriteApplyResult> {
    return this.request(
      'POST',
      registryWritePath(profileId, 'lifecycle', 'apply'),
      { body: request as unknown as Record<string, unknown> },
    );
  }

  /**
   * Plan a prompt text edit (soul/memory markdown) for a registry-backed
   * profile (task #3555) without applying it. Missing fields mean no change;
   * null clears; empty string is preserved.
   */
  planProfileRegistryPrompt(
    profileId: string,
    request: ProfileRegistryPromptRequest,
  ): Promise<ProfileRegistryWritePlan> {
    return this.request(
      'POST',
      registryWritePath(profileId, 'prompt', 'plan'),
      { body: request as unknown as Record<string, unknown> },
    );
  }

  /**
   * Apply a prompt text edit (soul/memory markdown) for a registry-backed
   * profile (task #3555). Returns the applied record on success, or the
   * non-applied plan with diagnostics on failure (e.g. revision mismatch).
   */
  applyProfileRegistryPrompt(
    profileId: string,
    request: ProfileRegistryPromptRequest,
  ): Promise<ProfileRegistryWriteApplyResult> {
    return this.request(
      'POST',
      registryWritePath(profileId, 'prompt', 'apply'),
      { body: request as unknown as Record<string, unknown> },
    );
  }

  /**
   * Plan a runtime-config change (provider / built-in tools / MCP bindings) for
   * an existing profile (task #3742) without applying it. Returns the projected
   * `next` record and diagnostics (e.g. revision mismatch, unknown alias).
   */
  planProfileRegistryRuntimeConfig(
    profileId: string,
    request: ProfileRegistryRuntimeConfigRequest,
  ): Promise<ProfileRegistryRuntimeConfigPlan> {
    return this.request(
      'POST',
      registryWritePath(profileId, 'runtime-config', 'plan'),
      { body: request as unknown as Record<string, unknown> },
    );
  }

  /**
   * Apply a runtime-config change (task #3742): persists provider/tool/MCP
   * changes and rebuilds the profile runtime without creating a new session.
   * Returns the applied record on success, or the non-applied plan with
   * diagnostics on failure (e.g. revision mismatch).
   */
  applyProfileRegistryRuntimeConfig(
    profileId: string,
    request: ProfileRegistryRuntimeConfigRequest,
  ): Promise<ProfileRegistryRuntimeConfigApplyResult> {
    return this.request(
      'POST',
      registryWritePath(profileId, 'runtime-config', 'apply'),
      { body: request as unknown as Record<string, unknown> },
    );
  }

  /**
   * List reusable model provider aliases (tasks #3534/#3537). Secrets are
   * redacted on read; `credential.hasSecret` indicates whether a key is set.
   */
  modelProviders(query?: ModelProviderQuery): Promise<ModelProviderPage> {
    return this.request(
      'GET',
      '/v1/admin/model-providers',
      optionsForProviderQuery(query),
    );
  }

  /**
   * Read one model provider alias by alias. Returns redacted credential
   * status.
   */
  modelProvider(alias: string): Promise<ModelProviderRecord> {
    return this.request(
      'GET',
      `/v1/admin/model-providers/${encodeURIComponent(alias)}`,
    );
  }

  /**
   * Create a model provider alias (POST). Optionally trigger a runtime
   * refresh of profiles referencing this alias via `refresh`.
   */
  createModelProvider(
    request: ModelProviderWriteRequest,
    refresh: ModelProviderRefreshMode = 'none',
  ): Promise<ModelProviderWriteResponse> {
    return this.request('POST', providerWritePath(refresh), {
      body: compactRecord(providerWriteBody(request)) as Record<
        string,
        unknown
      >,
    });
  }

  /**
   * Update a model provider alias by alias (PATCH). Use `refresh` to plan or
   * apply runtime rebuilds for affected profiles. `expectedRevision` guards
   * concurrent edits.
   */
  updateModelProvider(
    alias: string,
    request: ModelProviderWriteRequest,
    refresh: ModelProviderRefreshMode = 'none',
  ): Promise<ModelProviderWriteResponse> {
    return this.request(
      'PATCH',
      `${providerItemPath(alias)}?refresh=${encodeURIComponent(refresh)}`,
      {
        body: compactRecord(providerWriteBody(request)) as Record<
          string,
          unknown
        >,
      },
    );
  }

  serviceCredentials(
    query?: ServiceCredentialQuery,
  ): Promise<ServiceCredentialPage> {
    return this.request(
      'GET',
      '/v1/admin/service-credentials',
      optionsForServiceCredentialQuery(query),
    );
  }

  serviceCredential(credentialId: string): Promise<ServiceCredentialRecord> {
    return this.request('GET', serviceCredentialPath(credentialId));
  }

  createServiceCredential(
    request: ServiceCredentialWriteRequest & { readonly credentialId: string },
  ): Promise<ServiceCredentialWriteResponse> {
    return this.request('POST', '/v1/admin/service-credentials', {
      body: compactRecord(serviceCredentialWriteBody(request)),
    });
  }

  updateServiceCredential(
    credentialId: string,
    request: ServiceCredentialWriteRequest,
  ): Promise<ServiceCredentialWriteResponse> {
    return this.request('PATCH', serviceCredentialPath(credentialId), {
      body: compactRecord(serviceCredentialWriteBody(request)),
    });
  }

  serviceCredentialImpact(
    credentialId: string,
  ): Promise<ServiceCredentialImpact> {
    return this.request('GET', `${serviceCredentialPath(credentialId)}/impact`);
  }

  clearServiceCredential(
    credentialId: string,
    expectedRevision?: number,
  ): Promise<ServiceCredentialWriteResponse> {
    return this.request(
      'POST',
      `${serviceCredentialPath(credentialId)}/clear`,
      { body: compactRecord({ expectedRevision }) },
    );
  }

  deleteServiceCredential(
    credentialId: string,
    expectedRevision?: number,
  ): Promise<ServiceCredentialDeleteResponse> {
    return this.request('DELETE', serviceCredentialPath(credentialId), {
      query: expectedRevision === undefined ? {} : { expectedRevision },
    });
  }

  linkModelProviderCredential(
    alias: string,
    request: ModelProviderCredentialLinkRequest,
  ): Promise<ModelProviderCredentialLinkResponse> {
    return this.request('POST', `${providerItemPath(alias)}/credential/link`, {
      body: compactRecord({ ...request }),
    });
  }

  unlinkModelProviderCredential(
    alias: string,
    request: ModelProviderCredentialUnlinkRequest = {},
  ): Promise<ModelProviderCredentialUnlinkResponse> {
    return this.request(
      'POST',
      `${providerItemPath(alias)}/credential/unlink`,
      { body: compactRecord({ ...request }) },
    );
  }

  serviceCredentialOpenAiOauthStatus(
    credentialId: string,
  ): Promise<ServiceCredentialOpenAiOauthStatusResponse> {
    return this.request(
      'GET',
      openAiOauthCredentialPath(credentialId, 'status'),
    );
  }

  startServiceCredentialOpenAiOauthLogin(
    credentialId: string,
    request: OpenAiOauthStartRequest = {},
  ): Promise<ServiceCredentialOpenAiOauthStartResponse> {
    return this.request(
      'POST',
      openAiOauthCredentialPath(credentialId, 'start'),
      { body: compactRecord(openAiOauthStartBody(request)) },
    );
  }

  completeServiceCredentialOpenAiOauthLogin(
    credentialId: string,
    request: OpenAiOauthCompleteRequest,
  ): Promise<ServiceCredentialOpenAiOauthCompleteResponse> {
    return this.request(
      'POST',
      openAiOauthCredentialPath(credentialId, 'complete'),
      { body: compactRecord(openAiOauthCompleteBody(request)) },
    );
  }

  clearServiceCredentialOpenAiOauth(
    credentialId: string,
    expectedRevision?: number,
  ): Promise<ServiceCredentialOpenAiOauthClearResponse> {
    return this.request(
      'POST',
      openAiOauthCredentialPath(credentialId, 'clear'),
      { body: compactRecord({ expectedRevision }) },
    );
  }

  openAiOauthStatus(alias: string): Promise<OpenAiOauthStatusResponse> {
    return this.request('GET', openAiOauthProviderPath(alias, 'status'));
  }

  startOpenAiOauthLogin(
    alias: string,
    request: OpenAiOauthStartRequest = {},
  ): Promise<OpenAiOauthStartResponse> {
    return this.request('POST', openAiOauthProviderPath(alias, 'start'), {
      body: compactRecord(openAiOauthStartBody(request)),
    });
  }

  completeOpenAiOauthLogin(
    alias: string,
    request: OpenAiOauthCompleteRequest,
  ): Promise<OpenAiOauthCompleteResponse> {
    return this.request('POST', openAiOauthProviderPath(alias, 'complete'), {
      body: compactRecord(openAiOauthCompleteBody(request)),
    });
  }

  clearOpenAiOauthCredential(
    alias: string,
    request: OpenAiOauthClearRequest = {},
  ): Promise<OpenAiOauthClearResponse> {
    return this.request('POST', openAiOauthProviderPath(alias, 'clear'), {
      body: compactRecord({ expectedRevision: request.expectedRevision }),
    });
  }

  createProfile(
    request: CreateAdminProfileRequest,
  ): Promise<AdminControlResponse<CreatedServiceProfile>> {
    return this.request('POST', '/v1/admin/control/profiles', {
      body: compactRecord(request),
    });
  }

  switchSessionWorkspace(
    sessionId: string,
    request: SessionWorkspaceChangeRequest,
  ): Promise<AdminControlResponse<SessionWorkspaceChangeResult>> {
    return this.request(
      'POST',
      `/v1/admin/control/sessions/${encodeURIComponent(sessionId)}/workspace`,
      { body: compactRecord(request) },
    );
  }

  planProfileBrainRebuild(
    profileId: string,
    request: ProfileBrainRebuildRequest = {},
  ): Promise<AdminControlResponse<ProfileBrainRebuildResult>> {
    return this.request('POST', profileBrainRebuildPath(profileId, 'plan'), {
      body: compactRecord(request),
    });
  }

  applyProfileBrainRebuild(
    profileId: string,
    request: ProfileBrainRebuildRequest = {},
  ): Promise<AdminControlResponse<ProfileBrainRebuildResult>> {
    return this.request('POST', profileBrainRebuildPath(profileId, 'apply'), {
      body: compactRecord(request),
    });
  }

  deleteProfile(
    profileId: string,
    request: ProfileDeleteRequest,
  ): Promise<AdminControlResponse<ProfileDeleteResult>> {
    return this.request('POST', profileDeletePath(profileId), {
      body: compactRecord(request),
    });
  }

  reloadConfig(
    reason = 'rusty-view service config reload',
  ): Promise<AdminControlResponse<RuntimeConfigApplyResult>> {
    return this.request('POST', '/v1/admin/control/config/reload', {
      body: { reason },
    });
  }

  planRuntimeConfigDraft(
    request: RuntimeConfigDraftRequest,
  ): Promise<AdminControlResponse<RuntimeConfigDraftPlan>> {
    return this.request('POST', '/v1/admin/control/config/draft/plan', {
      body: compactRecord(request),
    });
  }

  applyRuntimeConfigDraft(
    request: RuntimeConfigDraftRequest,
  ): Promise<AdminControlResponse<RuntimeConfigDraftPlan>> {
    return this.request('POST', '/v1/admin/control/config/draft/apply', {
      body: compactRecord(request),
    });
  }

  patchWakeTimeoutConfig(
    request: RuntimeWakeTimeoutPatchRequest,
  ): Promise<AdminControlResponse<RuntimeWakeTimeoutPatchResult>> {
    return this.request('POST', '/v1/admin/control/config/wake-timeout', {
      body: compactRecord(request),
    });
  }

  pauseRuntime(
    scope: RuntimePauseScope,
    targetId: string,
    request: RuntimePauseControlRequest,
  ): Promise<AdminControlResponse<RuntimePauseControlResult>> {
    return this.request('POST', runtimePausePath(scope, targetId, 'pause'), {
      body: compactRecord(request),
    });
  }

  resumeRuntime(
    scope: RuntimePauseScope,
    targetId: string,
    request: RuntimePauseControlRequest = {},
  ): Promise<
    AdminControlResponse<RuntimePauseControlResult | RuntimeResumeNoopResult>
  > {
    return this.request('POST', runtimePausePath(scope, targetId, 'resume'), {
      body: compactRecord(request),
    });
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const url = new URL(path, this.config.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private buildHeaders(body: unknown): Headers {
    const headers = new Headers();
    headers.set('Accept', 'application/json');
    if (body !== undefined) {
      headers.set(HEADER_NAMES.contentType, 'application/json');
    }
    if (this.config.bearerToken !== undefined) {
      headers.set(
        HEADER_NAMES.authorization,
        `Bearer ${this.config.bearerToken}`,
      );
    }
    return headers;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const init: RequestInit = {
      method,
      headers: this.buildHeaders(options.body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    };
    if (method === 'GET') {
      init.cache = 'no-store';
    }
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw withChatTransportEndpoint(classifyFetchError(error), url);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ChatTransportError({
        code: 'envelope_error',
        message: `Admin API returned non-JSON response (${response.status}).`,
        statusCode: response.status,
        endpoint: url,
      });
    }

    const envelope = json as AdminApiEnvelope<T>;
    if (response.ok && envelope.ok === true) {
      return envelope.data;
    }
    if (envelope.ok === false) {
      throw new ChatTransportError({
        code:
          envelope.error.code === 'unauthorized' ||
          envelope.error.code === 'forbidden'
            ? 'auth_error'
            : 'http_error',
        message: envelope.error.message,
        statusCode: response.status,
        endpoint: url,
        apiError: envelope.error,
      });
    }

    throw new ChatTransportError({
      code: 'envelope_error',
      message: 'Admin API response did not match the expected envelope.',
      statusCode: response.status,
      endpoint: url,
    });
  }
}

function optionsForQuery(
  query?: AdminListQuery | AdminActivityQuery,
): RequestOptions {
  return query === undefined ? {} : { query: { ...query } };
}

function coordinationPrefix(role: CoordinationDeploymentRole): string {
  return role === 'debug' ? '/v1/debug/coordination' : '/v1/coordination';
}

function coordinationRole(
  config: ChatTransportConfig,
): CoordinationDeploymentRole {
  return config.coordinationRole ?? 'production';
}

function optionsForRegistryQuery(
  query?: AdminProfileRegistryQuery,
): RequestOptions {
  if (query === undefined) return {};
  const params: Record<string, unknown> = {};
  if (query.limit !== undefined) params['limit'] = query.limit;
  if (query.offset !== undefined) params['offset'] = query.offset;
  if (query.lifecycleStatus !== undefined) {
    params['lifecycle_status'] = query.lifecycleStatus;
  }
  if (query.source !== undefined) params['source'] = query.source;
  if (query.fallbackStatus !== undefined) {
    params['fallback_status'] = query.fallbackStatus;
  }
  return { query: params };
}

function optionsForProviderQuery(query?: ModelProviderQuery): RequestOptions {
  if (query === undefined) return {};
  const params: Record<string, unknown> = {};
  if (query.status !== undefined) params['status'] = query.status;
  if (query.aliasPrefix !== undefined) {
    params['aliasPrefix'] = query.aliasPrefix;
  }
  if (query.limit !== undefined) params['limit'] = query.limit;
  if (query.offset !== undefined) params['offset'] = query.offset;
  return { query: params };
}

function optionsForServiceCredentialQuery(
  query?: ServiceCredentialQuery,
): RequestOptions {
  if (query === undefined) return {};
  const params: Record<string, unknown> = {};
  if (query.providerKind !== undefined) {
    params['providerKind'] = query.providerKind;
  }
  if (query.limit !== undefined) params['limit'] = query.limit;
  if (query.offset !== undefined) params['offset'] = query.offset;
  return { query: params };
}

function providerWritePath(refresh: ModelProviderRefreshMode): string {
  return refresh === 'none'
    ? '/v1/admin/model-providers'
    : `/v1/admin/model-providers?refresh=${encodeURIComponent(refresh)}`;
}

function providerItemPath(alias: string): string {
  return `/v1/admin/model-providers/${encodeURIComponent(alias)}`;
}

function openAiOauthProviderPath(
  alias: string,
  action: 'status' | 'start' | 'complete' | 'clear',
): string {
  return `${providerItemPath(alias)}/oauth/openai/${action}`;
}

function serviceCredentialPath(credentialId: string): string {
  return `/v1/admin/service-credentials/${encodeURIComponent(credentialId)}`;
}

function openAiOauthCredentialPath(
  credentialId: string,
  action: 'status' | 'start' | 'complete' | 'clear',
): string {
  return `${serviceCredentialPath(credentialId)}/oauth/openai/${action}`;
}

function registryWritePath(
  profileId: string,
  kind: 'update' | 'lifecycle' | 'prompt' | 'runtime-config',
  mode: 'plan' | 'apply',
): string {
  return `/v1/admin/profiles/registry/${encodeURIComponent(profileId)}/${kind}/${mode}`;
}

function profileBrainRebuildPath(
  profileId: string,
  mode: 'plan' | 'apply',
): string {
  return `/v1/admin/control/profiles/${encodeURIComponent(profileId)}/rebuild-brain/${mode}`;
}

function profileDeletePath(profileId: string): string {
  return `/v1/admin/control/profiles/${encodeURIComponent(profileId)}/delete`;
}

/**
 * Build the provider write body, normalizing the secret alias. The backend
 * accepts both `secret` and `apiKey`; we forward whichever the caller set.
 */
function providerWriteBody(
  request: ModelProviderWriteRequest,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    protocol: request.protocol,
    modelId: request.modelId,
  };
  if (request.alias !== undefined) body['alias'] = request.alias;
  if (request.status !== undefined) body['status'] = request.status;
  if (request.providerKind !== undefined) {
    body['providerKind'] = request.providerKind;
  }
  if (request.displayName !== undefined) {
    body['displayName'] = request.displayName;
  }
  if (request.description !== undefined) {
    body['description'] = request.description;
  }
  if (request.baseUrl !== undefined) body['baseUrl'] = request.baseUrl;
  if (request.contextWindowTokens !== undefined) {
    body['contextWindowTokens'] = request.contextWindowTokens;
  }
  if (request.maxOutputTokens !== undefined) {
    body['maxOutputTokens'] = request.maxOutputTokens;
  }
  if (request.temperatureMilli !== undefined) {
    body['temperatureMilli'] = request.temperatureMilli;
  }
  if (request.reasoningEffort !== undefined) {
    body['reasoningEffort'] = request.reasoningEffort;
  }
  if (request.reasoningFormat !== undefined) {
    body['reasoningFormat'] = request.reasoningFormat;
  }
  if (
    request.protocol === 'responses' &&
    request.responsesDialect !== undefined
  ) {
    body['responsesDialect'] = request.responsesDialect;
  }
  if (request.promptCaching !== undefined) {
    body['promptCaching'] = request.promptCaching;
  }
  if (request.chatCompletionsDialect !== undefined) {
    body['chatCompletionsDialect'] = request.chatCompletionsDialect;
  }
  if (request.thinkingMode !== undefined) {
    body['thinkingMode'] = request.thinkingMode;
  }
  if (request.reasoningHistory !== undefined) {
    body['reasoningHistory'] = request.reasoningHistory;
  }
  if (request.reasoningBudgetTokens !== undefined) {
    body['reasoningBudgetTokens'] = request.reasoningBudgetTokens;
  }
  if (request.clearSecret !== undefined) {
    body['clearSecret'] = request.clearSecret;
  }
  if (request.credentialSecret !== undefined) {
    body['credentialSecret'] = request.credentialSecret;
  }
  if (request.metadataJson !== undefined) {
    body['metadataJson'] = request.metadataJson;
  }
  if (request.expectedRevision !== undefined) {
    body['expectedRevision'] = request.expectedRevision;
  }
  // The caller should set at most one; forward the secret under both keys the
  // backend accepts so the explicit `secret` field is honored.
  if (request.secret !== undefined) {
    body['secret'] = request.secret;
  } else if (request.apiKey !== undefined) {
    body['apiKey'] = request.apiKey;
  }
  return body;
}

function serviceCredentialWriteBody(
  request: ServiceCredentialWriteRequest,
): Record<string, unknown> {
  return {
    credentialId: request.credentialId,
    displayName: request.displayName,
    providerKind: request.providerKind,
    credentialKind: request.credentialKind,
    secret: request.secret,
    clearSecret: request.clearSecret,
    expectedRevision: request.expectedRevision,
  };
}

function openAiOauthStartBody(
  request: OpenAiOauthStartRequest,
): Record<string, unknown> {
  return {
    issuer: request.issuer,
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    scopes: request.scopes,
    allowedWorkspaceIds: request.allowedWorkspaceIds,
    originator: request.originator,
  };
}

function openAiOauthCompleteBody(
  request: OpenAiOauthCompleteRequest,
): Record<string, unknown> {
  return {
    callbackUrl: request.callbackUrl,
    authorizationResponseUrl: request.authorizationResponseUrl,
    pendingLoginId: request.pendingLoginId,
    state: request.state,
    code: request.code,
    expectedRevision: request.expectedRevision,
    testMode: request.testMode,
    fakeTokenResponse: request.fakeTokenResponse,
  };
}

/**
 * Wire shape of a single local tool profile as returned by Crew (task #3689).
 * Differs from the UI-facing {@link AdminLocalToolProfile} only in the spelling
 * of the selection arrays: Crew uses `toolsets`/`tools`.
 */
interface LocalToolProfileWire
  extends Omit<AdminLocalToolProfile, 'requestedToolsets' | 'requestedTools'> {
  readonly toolsets?: readonly string[];
  readonly tools?: readonly string[];
}

/**
 * Wire shape of the list response. Crew returns `{ items: [...] }`; we also
 * tolerate a `{ profiles: [...] }` spelling defensively.
 */
interface LocalToolProfileListWire {
  readonly items?: readonly LocalToolProfileWire[];
  readonly profiles?: readonly LocalToolProfileWire[];
}

/**
 * Wire shape of a create/update write response. Crew's write routes wrap the
 * persisted record under `data.profile` (alongside other fields like
 * `deleted`), unlike the list route which returns `items` directly.
 */
interface LocalToolProfileWriteWire {
  readonly profile: LocalToolProfileWire;
}

/** Map a wire local tool profile into the UI-facing shape (task #3689). */
function normalizeLocalToolProfile(
  wire: LocalToolProfileWire,
): AdminLocalToolProfile {
  const { toolsets, tools, ...rest } = wire;
  return {
    ...rest,
    requestedToolsets: toolsets ?? [],
    requestedTools: tools ?? [],
  };
}

/**
 * Map a UI-facing write request into Crew's wire body (task #3689): rename
 * `requestedToolsets`/`requestedTools` to `toolsets`/`tools` and drop
 * empty/undefined fields.
 */
function localToolProfileWriteBody(
  body: AdminLocalToolProfileWriteRequest,
): Record<string, unknown> {
  const { requestedToolsets, requestedTools, ...rest } = body;
  const wire: Record<string, unknown> = { ...rest };
  if (requestedToolsets !== undefined) wire['toolsets'] = requestedToolsets;
  if (requestedTools !== undefined) wire['tools'] = requestedTools;
  return compactRecord(wire);
}

function compactRecord(value: object): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && entry !== '') {
      next[key] = entry;
    }
  }
  return next;
}

function runtimePausePath(
  scope: RuntimePauseScope,
  targetId: string,
  action: 'pause' | 'resume',
): string {
  const family =
    scope === 'session'
      ? 'sessions'
      : scope === 'profile'
        ? 'profiles'
        : 'agents';
  const targetKey =
    scope === 'session'
      ? 'session_id'
      : scope === 'profile'
        ? 'profile_id'
        : 'agent_id';
  return `/v1/admin/control/${family}/{${targetKey}}/runtime/${action}`.replace(
    `{${targetKey}}`,
    encodeURIComponent(targetId),
  );
}
