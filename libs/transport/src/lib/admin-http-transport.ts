import { ChatTransportError, classifyFetchError } from './chat-transport-error';
import type { ChatTransportConfig, FetchImpl } from './chat-transport-config';
import { HEADER_NAMES } from './chat-routes';
import type {
  AdminAgentDiagnostics,
  AdminApiEnvelope,
  ApiCapabilityRegistry,
  AdminControlResponse,
  AdminDiagnosticsBundle,
  AdminDiagnosticsOverview,
  AdminMcpCatalog,
  AdminToolCatalog,
  AdminPage,
  AdminProfileRegistryDiagnostics,
  AdminProfileRegistryQuery,
  AdminProfileRegistryRecord,
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
  ProfileRegistryWriteApplyResult,
  ProfileRegistryWritePlan,
  RuntimePauseControlRequest,
  RuntimePauseControlResult,
  RuntimeResumeNoopResult,
  RuntimeConfigApplyResult,
  RuntimeConfigValidationReport,
  RuntimePauseScope,
  RuntimeSessionDiagnostics,
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

  mcpSurfaces(
    query?: AdminListQuery,
  ): Promise<AdminPage<McpSurfaceDiagnostics>> {
    return this.request(
      'GET',
      '/v1/admin/diagnostics/mcp',
      optionsForQuery(query),
    );
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

  capabilities(): Promise<ApiCapabilityRegistry> {
    return this.request('GET', '/v1/admin/capabilities');
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

  createProfile(
    request: CreateAdminProfileRequest,
  ): Promise<AdminControlResponse<CreatedServiceProfile>> {
    return this.request('POST', '/v1/admin/control/profiles', {
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
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const init: RequestInit = {
      method,
      headers: this.buildHeaders(options.body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw classifyFetchError(error);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ChatTransportError({
        code: 'envelope_error',
        message: `Admin API returned non-JSON response (${response.status}).`,
        statusCode: response.status,
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
        apiError: envelope.error,
      });
    }

    throw new ChatTransportError({
      code: 'envelope_error',
      message: 'Admin API response did not match the expected envelope.',
      statusCode: response.status,
    });
  }
}

function optionsForQuery(query?: AdminListQuery): RequestOptions {
  return query === undefined ? {} : { query: { ...query } };
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

function providerWritePath(refresh: ModelProviderRefreshMode): string {
  return refresh === 'none'
    ? '/v1/admin/model-providers'
    : `/v1/admin/model-providers?refresh=${encodeURIComponent(refresh)}`;
}

function providerItemPath(alias: string): string {
  return `/v1/admin/model-providers/${encodeURIComponent(alias)}`;
}

function registryWritePath(
  profileId: string,
  kind: 'update' | 'lifecycle' | 'prompt',
  mode: 'plan' | 'apply',
): string {
  return `/v1/admin/profiles/registry/${encodeURIComponent(profileId)}/${kind}/${mode}`;
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
  if (request.clearSecret !== undefined) {
    body['clearSecret'] = request.clearSecret;
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
