import { computed, inject, Injectable, signal } from '@angular/core';
import {
  ChatTransport,
  type AdminAgentDiagnostics,
  type AdminControlResponse,
  type AdminDiagnosticsBundle,
  type AdminPage,
  type AdminMcpBinding,
  type AdminMcpCatalog,
  type AdminMcpServer,
  type AdminLocalToolProfile,
  type AdminLocalToolProfileList,
  type AdminLocalToolProfileWriteRequest,
  type AdminProfileRegistryDiagnostics,
  type AdminProfileRegistryRecord,
  type AdminToolCatalog,
  type AdminToolDescriptor,
  type AdminToolsetDescriptor,
  type ApiCapabilityRegistry,
  type ContextStrategyCatalog,
  type ContextStrategyDescriptor,
  type ContextStrategyPolicy,
  type CreateAdminProfileRequest,
  type CreatedServiceProfile,
  type McpSurfaceDiagnostics,
  type ModelProviderPage,
  type ModelProviderRefreshMode,
  type ModelProviderRecord,
  type ModelProviderWriteRequest,
  type ModelProviderWriteResponse,
  type OpenAiOauthClearResponse,
  type OpenAiOauthCompleteRequest,
  type OpenAiOauthCompleteResponse,
  type OpenAiOauthStartRequest,
  type OpenAiOauthStartResponse,
  type OpenAiOauthStatusResponse,
  type ProfileBundleExportPlan,
  type ProfileBrainRebuildRequest,
  type ProfileBrainRebuildResult,
  type ProfileDeleteRequest,
  type ProfileDeleteResult,
  type ProfileRegistryFieldUpdateRequest,
  type ProfileRegistryLifecycleRequest,
  type ProfileRegistryPromptRequest,
  type ProfileRegistryRuntimeConfigApplyResult,
  type ProfileRegistryRuntimeConfigPlan,
  type ProfileRegistryRuntimeConfigRequest,
  type ProfileRegistryWriteApplyResult,
  type ProfileRegistryWritePlan,
  type RuntimeBrainModuleDiagnostics,
  type RuntimeConfigApplyResult,
  type RuntimeConfigValidationReport,
  type RuntimePauseControlRequest,
  type RuntimePauseControlResult,
  type RuntimePauseDiagnostics,
  type RuntimePauseScope,
  type RuntimeResumeNoopResult,
  type RuntimeSessionDiagnostics,
} from '@rusty-view/transport';

import {
  storeErrorDetail,
  storeErrorDetailMessage,
  type StoreErrorDetail,
} from './store-error';

export interface AdminProfileSummary {
  readonly profileId: string;
  readonly agentIds: readonly string[];
  readonly sessionIds: readonly string[];
  readonly activeSessions: number;
  readonly idleSessions: number;
  readonly archivedSessions: number;
  readonly staleSessions: number;
  readonly brainModules: readonly RuntimeBrainModuleDiagnostics[];
  readonly mcpSurfaces: readonly McpSurfaceDiagnostics[];
}

@Injectable()
export class AdminStore {
  private readonly transport = inject(ChatTransport);

  private readonly _diagnostics = signal<AdminDiagnosticsBundle | null>(null);
  private readonly _sessions =
    signal<AdminPage<RuntimeSessionDiagnostics> | null>(null);
  private readonly _agents = signal<AdminPage<AdminAgentDiagnostics> | null>(
    null,
  );
  private readonly _mcpSurfaces =
    signal<AdminPage<McpSurfaceDiagnostics> | null>(null);
  private readonly _configValidation =
    signal<RuntimeConfigValidationReport | null>(null);
  private readonly _capabilities = signal<ApiCapabilityRegistry | null>(null);
  private readonly _profileDiagnostics =
    signal<AdminProfileRegistryDiagnostics | null>(null);
  private readonly _mcpCatalog = signal<AdminMcpCatalog | null>(null);
  private readonly _toolCatalog = signal<AdminToolCatalog | null>(null);
  private readonly _localToolProfiles =
    signal<AdminLocalToolProfileList | null>(null);
  private readonly _contextStrategyCatalog =
    signal<ContextStrategyCatalog | null>(null);
  /**
   * Error from the most recent local-tool-profile write (#3689). First-class
   * (unlike the read which degrades to empty) so the editor surfaces failures.
   */
  private readonly _toolProfileWriteError = signal<StoreErrorDetail | null>(
    null,
  );
  private readonly _exportPlan = signal<ProfileBundleExportPlan | null>(null);
  private readonly _registryWritePlan = signal<ProfileRegistryWritePlan | null>(
    null,
  );
  private readonly _registryWriteResult =
    signal<ProfileRegistryWriteApplyResult | null>(null);
  /**
   * Runtime-config (provider/tools/MCP, #3742) plan/result. Kept in dedicated
   * signals because the runtime-config plan has a different shape than the
   * field-update/lifecycle/prompt {@link ProfileRegistryWritePlan} (no `kind`,
   * runtime-config-specific `implications`).
   */
  private readonly _runtimeConfigPlan =
    signal<ProfileRegistryRuntimeConfigPlan | null>(null);
  private readonly _runtimeConfigResult =
    signal<ProfileRegistryRuntimeConfigApplyResult | null>(null);
  private readonly _modelProviders = signal<ModelProviderPage | null>(null);
  private readonly _providerWriteResult =
    signal<ModelProviderWriteResponse | null>(null);
  private readonly _openAiOauthStatus =
    signal<OpenAiOauthStatusResponse | null>(null);
  private readonly _openAiOauthStartResult =
    signal<OpenAiOauthStartResponse | null>(null);
  private readonly _openAiOauthCompleteResult =
    signal<OpenAiOauthCompleteResponse | null>(null);
  private readonly _openAiOauthClearResult =
    signal<OpenAiOauthClearResponse | null>(null);
  /**
   * Provider-specific load error. Unlike the compatibility-diagnostic routes,
   * the model-provider registry is a first-class part of this panel; a failure
   * to load it must be visible rather than looking like an empty registry.
   */
  private readonly _providerLoadError = signal<StoreErrorDetail | null>(null);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<StoreErrorDetail | null>(null);
  private readonly _createResult =
    signal<AdminControlResponse<CreatedServiceProfile> | null>(null);
  private readonly _reloadResult =
    signal<AdminControlResponse<RuntimeConfigApplyResult> | null>(null);
  private readonly _profileBrainRebuildResult =
    signal<AdminControlResponse<ProfileBrainRebuildResult> | null>(null);
  private readonly _profileDeleteResult =
    signal<AdminControlResponse<ProfileDeleteResult> | null>(null);
  private readonly _runtimePauseResult =
    signal<AdminControlResponse<RuntimePauseControlResult> | null>(null);
  private readonly _runtimeResumeResult = signal<AdminControlResponse<
    RuntimePauseControlResult | RuntimeResumeNoopResult
  > | null>(null);

  readonly diagnostics = this._diagnostics.asReadonly();
  readonly sessions = this._sessions.asReadonly();
  readonly agents = this._agents.asReadonly();
  readonly mcpSurfaces = this._mcpSurfaces.asReadonly();
  readonly configValidation = this._configValidation.asReadonly();
  readonly capabilities = this._capabilities.asReadonly();
  readonly profileDiagnostics = this._profileDiagnostics.asReadonly();
  readonly mcpCatalog = this._mcpCatalog.asReadonly();
  readonly toolCatalog = this._toolCatalog.asReadonly();
  readonly contextStrategyCatalog = this._contextStrategyCatalog.asReadonly();
  readonly exportPlan = this._exportPlan.asReadonly();
  readonly registryWritePlan = this._registryWritePlan.asReadonly();
  readonly registryWriteResult = this._registryWriteResult.asReadonly();
  readonly runtimeConfigPlan = this._runtimeConfigPlan.asReadonly();
  readonly runtimeConfigResult = this._runtimeConfigResult.asReadonly();
  readonly modelProviders = this._modelProviders.asReadonly();
  readonly providerWriteResult = this._providerWriteResult.asReadonly();
  readonly openAiOauthStatus = this._openAiOauthStatus.asReadonly();
  readonly openAiOauthStartResult = this._openAiOauthStartResult.asReadonly();
  readonly openAiOauthCompleteResult =
    this._openAiOauthCompleteResult.asReadonly();
  readonly openAiOauthClearResult = this._openAiOauthClearResult.asReadonly();
  readonly providerLoadErrorDetail = this._providerLoadError.asReadonly();
  readonly providerLoadError = computed(() => {
    const error = this._providerLoadError();
    return error === null ? null : storeErrorDetailMessage(error);
  });
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly errorDetail = this._error.asReadonly();
  readonly error = computed(() => {
    const error = this._error();
    return error === null ? null : storeErrorDetailMessage(error);
  });
  readonly createResult = this._createResult.asReadonly();
  readonly reloadResult = this._reloadResult.asReadonly();
  readonly profileBrainRebuildResult =
    this._profileBrainRebuildResult.asReadonly();
  readonly profileDeleteResult = this._profileDeleteResult.asReadonly();
  readonly runtimePauseResult = this._runtimePauseResult.asReadonly();
  readonly runtimeResumeResult = this._runtimeResumeResult.asReadonly();

  readonly overview = computed(() => this._diagnostics()?.overview ?? null);
  readonly runtimePauses = computed<readonly RuntimePauseDiagnostics[]>(() => {
    const diagnostics = this._diagnostics();
    return (
      diagnostics?.runtime?.runtimePauses ??
      diagnostics?.overview.runtime.runtimePauses ??
      []
    );
  });

  readonly profiles = computed<readonly AdminProfileSummary[]>(() => {
    const sessions = this._sessions()?.items ?? [];
    const agents = this._agents()?.items ?? [];
    const brains = this._diagnostics()?.overview.runtime.brainModules ?? [];
    const mcp = this._mcpSurfaces()?.items ?? [];
    const profileIds = new Set<string>();
    for (const session of sessions) profileIds.add(session.profileId);
    for (const agent of agents) profileIds.add(agent.profileId);
    for (const brain of brains) profileIds.add(brain.profileId);
    for (const surface of mcp) {
      if (surface.profileId !== undefined) profileIds.add(surface.profileId);
    }

    return [...profileIds]
      .sort()
      .map((profileId) =>
        summarizeProfile(profileId, sessions, agents, brains, mcp),
      );
  });

  /**
   * Profile registry records from the DB-backed registry diagnostics,
   * including file-backed fallback projections. Empty when the backend has
   * not exposed the registry diagnostics route.
   */
  readonly registryRecords = computed<readonly AdminProfileRegistryRecord[]>(
    () => this._profileDiagnostics()?.records ?? [],
  );

  /**
   * Model provider aliases loaded from the service-level provider registry
   * (tasks #3534/#3537). Profiles reference these by alias instead of
   * embedding full model/provider config.
   */
  readonly providerAliases = computed<readonly ModelProviderRecord[]>(
    () => this._modelProviders()?.items ?? [],
  );

  /**
   * Configured MCP servers from the Crew catalog (task #3647). Empty when the
   * backend has not exposed the MCP catalog route; the create-profile flow
   * still allows profiles with no MCP bindings in that case.
   */
  readonly mcpServers = computed<readonly AdminMcpServer[]>(
    () => this._mcpCatalog()?.servers ?? [],
  );

  /** Known tool profile keys from current runtime bindings (task #3647). */
  readonly mcpToolProfiles = computed<readonly string[]>(
    () => this._mcpCatalog()?.toolProfiles ?? [],
  );

  /**
   * Current MCP binding resolution details from the catalog (task #3649).
   * Surfaced read-only so operators can distinguish explicit server bindings
   * from compatibility fallback (`endpointServerId` vs `resolvedServerId`).
   */
  readonly mcpBindings = computed<readonly AdminMcpBinding[]>(
    () => this._mcpCatalog()?.bindings ?? [],
  );

  /**
   * Built-in (non-MCP) toolsets from Crew's tool catalog (task #3686). Empty
   * when the backend has not exposed the tool catalog route; profile creation
   * still works with no built-in tools selected in that case.
   */
  readonly toolsetCatalog = computed<readonly AdminToolsetDescriptor[]>(
    () => this._toolCatalog()?.toolsets ?? [],
  );

  /** Built-in (non-MCP) individual tools from Crew's tool catalog (#3686). */
  readonly toolCatalogTools = computed<readonly AdminToolDescriptor[]>(
    () => this._toolCatalog()?.tools ?? [],
  );

  /**
   * DB-backed local tool profiles (task #3689). Empty when the backend has not
   * exposed the route; profile creation then falls back to inline/no built-in
   * tools and the editor shows a non-blocking empty state.
   */
  readonly localToolProfiles = computed<readonly AdminLocalToolProfile[]>(
    () => this._localToolProfiles()?.profiles ?? [],
  );

  /** Error from the latest local-tool-profile write, or null (#3689). */
  readonly toolProfileWriteErrorDetail =
    this._toolProfileWriteError.asReadonly();
  readonly toolProfileWriteError = computed(() => {
    const error = this._toolProfileWriteError();
    return error === null ? null : storeErrorDetailMessage(error);
  });

  /**
   * Selectable context strategies from Crew's catalog (task #3849). Empty when
   * the backend has not exposed the route; the context-policy controls then
   * fall back to a non-blocking empty state (strategy ids are never hardcoded).
   */
  readonly contextStrategies = computed<readonly ContextStrategyDescriptor[]>(
    () => this._contextStrategyCatalog()?.strategies ?? [],
  );

  /** Default strategy id from the catalog, or null when unavailable (#3849). */
  readonly defaultContextStrategyId = computed<string | null>(
    () => this._contextStrategyCatalog()?.defaultStrategyId ?? null,
  );

  /** Catalog policy defaults used to seed a fresh context policy (#3849). */
  readonly contextPolicyDefaults = computed<ContextStrategyPolicy | null>(
    () => this._contextStrategyCatalog()?.policyDefaults ?? null,
  );

  /** Percent control bounds from the catalog (defaults to 1–100) (#3849). */
  readonly contextPercentRange = computed<{ min: number; max: number }>(() => {
    const range = this._contextStrategyCatalog()?.percentRange;
    return { min: range?.min ?? 1, max: range?.max ?? 100 };
  });

  async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const [
        diagnostics,
        sessions,
        agents,
        mcpSurfaces,
        configValidation,
        capabilities,
        profileDiagnostics,
        mcpCatalog,
        toolCatalog,
        localToolProfiles,
        contextStrategyCatalog,
        modelProvidersResult,
      ] = await Promise.all([
        this.transport.adminDiagnostics(),
        this.transport.adminSessions({ limit: 100 }),
        this.transport.adminAgents({ limit: 100 }),
        this.transport.adminMcpSurfaces({ limit: 100 }),
        this.transport.adminConfigValidation(),
        this.transport.adminCapabilities().catch(() => null),
        this.transport.adminProfileDiagnostics().catch(() => null),
        loadMcpCatalog(this.transport),
        loadToolCatalog(this.transport),
        loadLocalToolProfiles(this.transport),
        loadContextStrategyCatalog(this.transport),
        loadModelProviders(this.transport),
      ]);
      this._diagnostics.set(diagnostics);
      this._sessions.set(sessions);
      this._agents.set(agents);
      this._mcpSurfaces.set(mcpSurfaces);
      this._configValidation.set(configValidation);
      this._capabilities.set(capabilities);
      this._profileDiagnostics.set(profileDiagnostics);
      this._mcpCatalog.set(mcpCatalog);
      this._toolCatalog.set(toolCatalog);
      this._localToolProfiles.set(localToolProfiles);
      this._contextStrategyCatalog.set(contextStrategyCatalog);
      this._modelProviders.set(modelProvidersResult.page);
      this._providerLoadError.set(modelProvidersResult.error);
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._loading.set(false);
    }
  }

  async createProfile(request: CreateAdminProfileRequest): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._createResult.set(null);
    try {
      const result = await this.transport.createAdminProfile(request);
      this._createResult.set(result);
      await this.refresh();
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  /**
   * Create a local tool profile (#3689) and refresh. Captures failures in
   * {@link toolProfileWriteError} so the editor can surface them. Returns true
   * on success.
   */
  async createLocalToolProfile(
    request: AdminLocalToolProfileWriteRequest,
  ): Promise<boolean> {
    return this.writeLocalToolProfile(() =>
      this.transport.adminCreateLocalToolProfile(request),
    );
  }

  /** Update a local tool profile by id (#3689) and refresh. */
  async updateLocalToolProfile(
    id: string,
    request: AdminLocalToolProfileWriteRequest,
  ): Promise<boolean> {
    return this.writeLocalToolProfile(() =>
      this.transport.adminUpdateLocalToolProfile(id, request),
    );
  }

  /** Delete or archive a local tool profile by id (#3689) and refresh. */
  async deleteLocalToolProfile(id: string): Promise<boolean> {
    return this.writeLocalToolProfile(() =>
      this.transport.adminDeleteLocalToolProfile(id),
    );
  }

  /** Clear the last local-tool-profile write error (#3689). */
  clearToolProfileWriteError(): void {
    this._toolProfileWriteError.set(null);
  }

  private async writeLocalToolProfile(
    write: () => Promise<unknown>,
  ): Promise<boolean> {
    this._saving.set(true);
    this._toolProfileWriteError.set(null);
    try {
      await write();
      await this.refresh();
      return true;
    } catch (error) {
      this._toolProfileWriteError.set(storeErrorDetail(error));
      return false;
    } finally {
      this._saving.set(false);
    }
  }

  async reloadConfig(): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._reloadResult.set(null);
    try {
      const result = await this.transport.reloadAdminConfig();
      this._reloadResult.set(result);
      await this.refresh();
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  /**
   * Request a profile bundle export plan for backup/review. The plan
   * distinguishes active DB state entries from file asset entries and does
   * not mutate service config or sessions. See ADR 0019.
   */
  async loadExportPlan(profileId: string): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._exportPlan.set(null);
    try {
      const plan = await this.transport.adminProfileExportPlan(profileId);
      this._exportPlan.set(plan);
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  /** Clear the currently loaded export plan without affecting other state. */
  clearExportPlan(): void {
    this._exportPlan.set(null);
  }

  /**
   * Plan a registry field update (#3519) without applying it. The projected
   * `next` record and any diagnostics (e.g. revision mismatch) are exposed via
   * `registryWritePlan`.
   */
  async planRegistryUpdate(
    profileId: string,
    request: ProfileRegistryFieldUpdateRequest,
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._registryWritePlan.set(null);
    this._registryWriteResult.set(null);
    try {
      const plan = await this.transport.planAdminProfileRegistryUpdate(
        profileId,
        request,
      );
      this._registryWritePlan.set(plan);
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  /**
   * Apply a registry field update (#3519). Requires `expectedRevision`; on
   * success the persisted record (bumped revision) is exposed via
   * `registryWriteResult` and the registry diagnostics are refreshed.
   */
  async applyRegistryUpdate(
    profileId: string,
    request: ProfileRegistryFieldUpdateRequest,
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._registryWriteResult.set(null);
    this._registryWritePlan.set(null);
    try {
      const result = await this.transport.applyAdminProfileRegistryUpdate(
        profileId,
        request,
      );
      this.recordRegistryApplyResult(result);
      // Only refresh on a successful apply; a failed apply (e.g. revision
      // mismatch) leaves the current records unchanged.
      if ('applied' in result) {
        await this.refresh();
      }
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  /**
   * Plan a registry lifecycle transition (#3521) without applying it. The
   * projected `next` record and lifecycle implications are exposed via
   * `registryWritePlan`.
   */
  async planRegistryLifecycle(
    profileId: string,
    request: ProfileRegistryLifecycleRequest,
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._registryWritePlan.set(null);
    this._registryWriteResult.set(null);
    try {
      const plan = await this.transport.planAdminProfileRegistryLifecycle(
        profileId,
        request,
      );
      this._registryWritePlan.set(plan);
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  /**
   * Apply a registry lifecycle transition (#3521). Non-active transitions
   * disable derived runtime refs, archive sessions, and unregister the brain;
   * assets/memory are preserved. Result + effects are exposed via
   * `registryWriteResult`.
   */
  async applyRegistryLifecycle(
    profileId: string,
    request: ProfileRegistryLifecycleRequest,
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._registryWriteResult.set(null);
    this._registryWritePlan.set(null);
    try {
      const result = await this.transport.applyAdminProfileRegistryLifecycle(
        profileId,
        request,
      );
      this.recordRegistryApplyResult(result);
      if ('applied' in result) {
        await this.refresh();
      }
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  /**
   * Plan an edit to a registry-backed profile's static prompt text
   * (soul/markdown / memory/markdown) (task #3555). Missing fields mean no
   * change; `null` clears; empty strings are preserved.
   */
  async planPromptEdit(
    profileId: string,
    request: ProfileRegistryPromptRequest,
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._registryWritePlan.set(null);
    this._registryWriteResult.set(null);
    try {
      const plan = await this.transport.planAdminProfileRegistryPrompt(
        profileId,
        request,
      );
      this._registryWritePlan.set(plan);
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  /**
   * Apply an edit to a registry-backed profile's static prompt text
   * (task #3555). On success the bumped record is exposed via
   * `registryWriteResult` and the registry diagnostics are refreshed; a
   * non-ok plan (e.g. revision mismatch) surfaces through
   * `registryWritePlan` via `recordRegistryApplyResult`.
   */
  async applyPromptEdit(
    profileId: string,
    request: ProfileRegistryPromptRequest,
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._registryWriteResult.set(null);
    this._registryWritePlan.set(null);
    try {
      const result = await this.transport.applyAdminProfileRegistryPrompt(
        profileId,
        request,
      );
      this.recordRegistryApplyResult(result);
      if ('applied' in result) {
        await this.refresh();
      }
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  /**
   * Plan a runtime-config change (provider / built-in tools / MCP bindings) for
   * an existing profile (task #3742) without applying it. The projected `next`
   * record and any diagnostics are exposed via `registryWritePlan`.
   */
  async planRegistryRuntimeConfig(
    profileId: string,
    request: ProfileRegistryRuntimeConfigRequest,
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._runtimeConfigPlan.set(null);
    this._runtimeConfigResult.set(null);
    try {
      const plan = await this.transport.planAdminProfileRegistryRuntimeConfig(
        profileId,
        request,
      );
      this._runtimeConfigPlan.set(plan);
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  /**
   * Apply a runtime-config change (task #3742): persists provider/tool/MCP
   * changes and rebuilds the runtime. On success the bumped record is exposed
   * via `runtimeConfigResult` and the registry diagnostics are refreshed; a
   * non-ok plan (e.g. revision mismatch) surfaces through `runtimeConfigPlan`.
   */
  async applyRegistryRuntimeConfig(
    profileId: string,
    request: ProfileRegistryRuntimeConfigRequest,
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._runtimeConfigResult.set(null);
    this._runtimeConfigPlan.set(null);
    try {
      const result =
        await this.transport.applyAdminProfileRegistryRuntimeConfig(
          profileId,
          request,
        );
      if ('applied' in result) {
        this._runtimeConfigResult.set(result);
        await this.refresh();
      } else {
        // Non-ok plan (e.g. revision mismatch): surface its diagnostics.
        this._runtimeConfigPlan.set(result);
      }
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  async planProfileBrainRebuild(
    profileId: string,
    request: ProfileBrainRebuildRequest = {},
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._profileBrainRebuildResult.set(null);
    try {
      this._profileBrainRebuildResult.set(
        await this.transport.planAdminProfileBrainRebuild(profileId, request),
      );
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  async applyProfileBrainRebuild(
    profileId: string,
    request: ProfileBrainRebuildRequest = {},
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._profileBrainRebuildResult.set(null);
    try {
      this._profileBrainRebuildResult.set(
        await this.transport.applyAdminProfileBrainRebuild(profileId, request),
      );
      await this.refresh();
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  async deleteProfile(
    profileId: string,
    request: ProfileDeleteRequest,
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._profileDeleteResult.set(null);
    try {
      this._profileDeleteResult.set(
        await this.transport.deleteAdminProfile(profileId, request),
      );
      await this.refresh();
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  /** Clear the current registry write plan/result (e.g. after dismissing). */
  clearRegistryWrite(): void {
    this._registryWritePlan.set(null);
    this._registryWriteResult.set(null);
    this._runtimeConfigPlan.set(null);
    this._runtimeConfigResult.set(null);
    this._profileBrainRebuildResult.set(null);
    this._profileDeleteResult.set(null);
  }

  /**
   * Route an apply response. A successful apply (has `applied`) is stored in
   * `registryWriteResult` and the plan is cleared. A failed apply (the backend
   * returns a plain non-applied plan, e.g. revision mismatch) is promoted into
   * `registryWritePlan` so its diagnostics surface in the same panel the
   * operator planned from.
   */
  private recordRegistryApplyResult(
    result: ProfileRegistryWriteApplyResult,
  ): void {
    if ('applied' in result) {
      this._registryWriteResult.set(result);
      this._registryWritePlan.set(null);
    } else {
      this._registryWritePlan.set(result);
      this._registryWriteResult.set(null);
    }
  }

  /**
   * Create a reusable model provider alias (task #3534). Optionally trigger a
   * runtime refresh of profiles referencing this alias via `refresh`.
   */
  async createModelProvider(
    request: ModelProviderWriteRequest,
    refresh: ModelProviderRefreshMode = 'none',
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._providerWriteResult.set(null);
    try {
      const result = await this.transport.createAdminModelProvider(
        request,
        refresh,
      );
      this._providerWriteResult.set(result);
      await this.refresh();
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  /**
   * Update a model provider alias by alias (task #3534). Use `refresh` to plan
   * or apply runtime rebuilds for affected profiles.
   */
  async updateModelProvider(
    alias: string,
    request: ModelProviderWriteRequest,
    refresh: ModelProviderRefreshMode = 'none',
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._providerWriteResult.set(null);
    try {
      const result = await this.transport.updateAdminModelProvider(
        alias,
        request,
        refresh,
      );
      this._providerWriteResult.set(result);
      await this.refresh();
    } catch (error) {
      if (isProviderRevisionConflict(error)) {
        // Recoverable conflict (task #3722): the record advanced elsewhere.
        // Refresh so the panel shows current data, then surface a clear,
        // non-generic message telling the operator to simply save again.
        // Normal saves omit `expectedRevision` and never hit this; this guards
        // the case Crew still reports a mismatch.
        await this.refresh();
        this._error.set({
          source: 'error',
          message:
            'This provider was changed elsewhere; the list has been refreshed. Review the current values and save again to overwrite.',
          retryable: false,
        });
      } else {
        this._error.set(storeErrorDetail(error));
      }
    } finally {
      this._saving.set(false);
    }
  }

  /** Clear the provider write result (e.g. after dismissing its panel). */
  clearProviderWriteResult(): void {
    this._providerWriteResult.set(null);
  }

  setLocalError(message: string): void {
    this._error.set({ source: 'error', message, retryable: false });
  }

  async loadOpenAiOauthStatus(alias: string): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    try {
      this._openAiOauthStatus.set(
        await this.transport.adminOpenAiOauthStatus(alias),
      );
    } catch (error) {
      this._error.set(providerCredentialErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  async startOpenAiOauthLogin(
    alias: string,
    request: OpenAiOauthStartRequest = {},
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._openAiOauthStartResult.set(null);
    try {
      const result = await this.transport.adminStartOpenAiOauthLogin(
        alias,
        request,
      );
      this._openAiOauthStartResult.set(result);
      this._openAiOauthStatus.set({
        provider: result.provider,
        credential: result.provider.credential,
        loginConfig: result.loginConfig,
        pendingLogins: [result.pendingLogin],
      });
    } catch (error) {
      this._error.set(providerCredentialErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  async completeOpenAiOauthLogin(
    alias: string,
    request: OpenAiOauthCompleteRequest,
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._openAiOauthCompleteResult.set(null);
    try {
      const result = await this.transport.adminCompleteOpenAiOauthLogin(
        alias,
        request,
      );
      this._openAiOauthCompleteResult.set(result);
      const loginConfig =
        this._openAiOauthStatus()?.loginConfig ??
        this._openAiOauthStartResult()?.loginConfig;
      this._openAiOauthStatus.set({
        provider: result.provider,
        credential: result.credential,
        ...(loginConfig === undefined ? {} : { loginConfig }),
        pendingLogins: [],
      });
      await this.refresh();
    } catch (error) {
      this._error.set(providerCredentialErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  async clearOpenAiOauthCredential(alias: string): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._openAiOauthClearResult.set(null);
    try {
      const result =
        await this.transport.adminClearOpenAiOauthCredential(alias);
      this._openAiOauthClearResult.set(result);
      const loginConfig =
        this._openAiOauthStatus()?.loginConfig ??
        this._openAiOauthStartResult()?.loginConfig;
      this._openAiOauthStatus.set({
        provider: result.provider,
        credential: result.credential,
        ...(loginConfig === undefined ? {} : { loginConfig }),
        pendingLogins: [],
      });
      await this.refresh();
    } catch (error) {
      if (isProviderRevisionConflict(error)) {
        await this.refresh();
      }
      this._error.set(providerCredentialErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  async pauseRuntime(
    scope: RuntimePauseScope,
    targetId: string,
    request: RuntimePauseControlRequest,
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._runtimePauseResult.set(null);
    this._runtimeResumeResult.set(null);
    try {
      const result = await this.transport.pauseRuntime(
        scope,
        targetId,
        request,
      );
      this._runtimePauseResult.set(result);
      await this.refresh();
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  async resumeRuntime(
    scope: RuntimePauseScope,
    targetId: string,
    request: RuntimePauseControlRequest = {},
  ): Promise<void> {
    this._saving.set(true);
    this._error.set(null);
    this._runtimePauseResult.set(null);
    this._runtimeResumeResult.set(null);
    try {
      const result = await this.transport.resumeRuntime(
        scope,
        targetId,
        request,
      );
      this._runtimeResumeResult.set(result);
      await this.refresh();
    } catch (error) {
      this._error.set(storeErrorDetail(error));
    } finally {
      this._saving.set(false);
    }
  }

  pauseForSession(sessionId: string): RuntimePauseDiagnostics | undefined {
    return this.runtimePauses().find(
      (pause) =>
        (pause.scope === 'session' && pause.targetId === sessionId) ||
        pause.affectedSessionIds.includes(sessionId),
    );
  }

  profilePauseCount(
    profileId: string,
    sessions: readonly { readonly session_id: string }[],
  ): number {
    const sessionIds = new Set(sessions.map((session) => session.session_id));
    return this.runtimePauses().filter(
      (pause) =>
        (pause.scope === 'profile' && pause.targetId === profileId) ||
        pause.affectedSessionIds.some((sessionId) => sessionIds.has(sessionId)),
    ).length;
  }

  controlCapabilityState(
    capabilityId: string,
  ): 'available' | 'unavailable' | 'unknown' {
    const registry = this._capabilities();
    if (registry === null) return 'unknown';
    return registry.capabilities.some(
      (capability) => capability.id === capabilityId,
    )
      ? 'available'
      : 'unavailable';
  }
}

function summarizeProfile(
  profileId: string,
  sessions: readonly RuntimeSessionDiagnostics[],
  agents: readonly AdminAgentDiagnostics[],
  brains: readonly RuntimeBrainModuleDiagnostics[],
  mcp: readonly McpSurfaceDiagnostics[],
): AdminProfileSummary {
  const profileSessions = sessions.filter((s) => s.profileId === profileId);
  const profileAgents = agents.filter((a) => a.profileId === profileId);
  const agentIds = new Set<string>();
  for (const session of profileSessions) agentIds.add(session.agentId);
  for (const agent of profileAgents) agentIds.add(agent.agentId);

  return {
    profileId,
    agentIds: [...agentIds].sort(),
    sessionIds: profileSessions.map((s) => s.sessionId).sort(),
    activeSessions: sumAgentCount(
      profileAgents,
      'activeSessions',
      profileSessions,
    ),
    idleSessions: sumAgentCount(profileAgents, 'idleSessions', profileSessions),
    archivedSessions: sumAgentCount(
      profileAgents,
      'archivedSessions',
      profileSessions,
    ),
    staleSessions: sumAgentCount(
      profileAgents,
      'staleSessions',
      profileSessions,
    ),
    brainModules: brains.filter((b) => b.profileId === profileId),
    mcpSurfaces: mcp.filter((surface) => surface.profileId === profileId),
  };
}

function sumAgentCount(
  agents: readonly AdminAgentDiagnostics[],
  key: 'activeSessions' | 'idleSessions' | 'archivedSessions' | 'staleSessions',
  sessions: readonly RuntimeSessionDiagnostics[],
): number {
  if (agents.length > 0) {
    return agents.reduce((sum, agent) => sum + agent[key], 0);
  }
  const status =
    key === 'activeSessions'
      ? 'active'
      : key === 'idleSessions'
        ? 'idle'
        : key === 'archivedSessions'
          ? 'archived'
          : undefined;
  if (status === undefined) {
    return sessions.filter((session) => session.stale).length;
  }
  return sessions.filter((session) => session.status === status).length;
}

/**
 * Whether an error is a model provider revision-mismatch conflict (task #3722).
 * Crew returns a `409` with `reason_code: 'model_provider_revision_mismatch'`
 * when a stale `expectedRevision` is supplied. Treated as a refreshable
 * conflict rather than a generic service error.
 */
function isProviderRevisionConflict(error: unknown): boolean {
  return (
    storeErrorDetail(error).apiError?.reasonCode ===
    'model_provider_revision_mismatch'
  );
}

function providerCredentialErrorDetail(error: unknown): StoreErrorDetail {
  const detail = storeErrorDetail(error);
  const reasonCode = detail.apiError?.reasonCode;
  if (reasonCode === undefined) return detail;
  const message = providerCredentialErrorMessage(reasonCode);
  return message === undefined ? detail : { ...detail, message };
}

function providerCredentialErrorMessage(
  reasonCode: string,
): string | undefined {
  switch (reasonCode) {
    case 'openai_oauth_unregistered_redirect_uri':
      return 'OpenAI OAuth rejected the redirect URI override. Start again with the Crew configured redirect URI.';
    case 'openai_oauth_invalid_callback_url':
      return 'OpenAI OAuth callback URL must include code and state.';
    case 'openai_oauth_callback_error':
      return 'OpenAI OAuth callback returned an authorization error.';
    case 'openai_oauth_pending_login_not_found':
      return 'OpenAI OAuth login expired or was cancelled. Start a new login.';
    case 'openai_oauth_state_mismatch':
      return 'OpenAI OAuth callback did not match the pending login. Start a new login and use the newest callback URL.';
    case 'openai_oauth_transport':
    case 'openai_oauth_upstream_status':
    case 'openai_oauth_malformed_response':
      return 'OpenAI OAuth token exchange failed. Check the callback URL and try the login again.';
    case 'openai_oauth_credential_error':
      return 'OpenAI OAuth credential exchange failed before tokens could be stored.';
    case 'openai_oauth_refresh_failed':
      return 'OpenAI OAuth token refresh failed. Clear the credential and sign in again.';
    case 'model_provider_revision_mismatch':
      return 'This provider was changed elsewhere; the list has been refreshed. Review the current values and save again to overwrite.';
    default:
      return undefined;
  }
}

/**
 * Load the MCP server catalog (task #3647). The catalog is an optional,
 * compatibility-gated route: backends that have not exposed it (or that omit
 * the method on the transport) yield `null` so the create-profile flow falls
 * back to a non-blocking empty state rather than failing the whole refresh.
 */
async function loadMcpCatalog(
  transport: ChatTransport,
): Promise<AdminMcpCatalog | null> {
  try {
    return await transport.adminMcpCatalog();
  } catch {
    return null;
  }
}

/**
 * Load the built-in tool catalog (task #3686). Like the MCP catalog this is an
 * optional, compatibility-gated route: backends (or transport mocks) that have
 * not exposed it yield `null` so the create-profile flow falls back to a
 * non-blocking empty state rather than failing the whole refresh.
 */
async function loadToolCatalog(
  transport: ChatTransport,
): Promise<AdminToolCatalog | null> {
  try {
    return (await transport.adminToolCatalog?.()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Load the DB-backed local tool profiles (task #3689). Optional,
 * compatibility-gated route: backends (or transport mocks) without it yield
 * `null` so the create flow and editor degrade to a non-blocking empty state.
 */
async function loadLocalToolProfiles(
  transport: ChatTransport,
): Promise<AdminLocalToolProfileList | null> {
  try {
    return (await transport.adminLocalToolProfiles?.()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Load the context strategy catalog (task #3849). Optional, compatibility-gated
 * route: backends (or transport mocks) without it yield `null` so the
 * context-policy controls degrade to a non-blocking empty state.
 */
async function loadContextStrategyCatalog(
  transport: ChatTransport,
): Promise<ContextStrategyCatalog | null> {
  try {
    return (await transport.adminContextStrategies?.()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Load model providers, capturing any failure as a provider-specific error so
 * the Providers panel can distinguish a broken registry from an empty one.
 */
async function loadModelProviders(transport: ChatTransport): Promise<{
  page: ModelProviderPage | null;
  error: StoreErrorDetail | null;
}> {
  try {
    const page = await transport.adminModelProviders({ limit: 100 });
    return { page, error: null };
  } catch (error) {
    return { page: null, error: storeErrorDetail(error) };
  }
}
