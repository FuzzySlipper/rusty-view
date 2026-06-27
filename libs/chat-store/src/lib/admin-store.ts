import { computed, inject, Injectable, signal } from '@angular/core';
import {
  ChatTransport,
  ChatTransportError,
  type AdminAgentDiagnostics,
  type AdminControlResponse,
  type AdminDiagnosticsBundle,
  type AdminPage,
  type AdminProfileRegistryDiagnostics,
  type AdminProfileRegistryRecord,
  type ApiCapabilityRegistry,
  type CreateAdminProfileRequest,
  type CreatedServiceProfile,
  type McpSurfaceDiagnostics,
  type ModelProviderPage,
  type ModelProviderRefreshMode,
  type ModelProviderRecord,
  type ModelProviderWriteRequest,
  type ModelProviderWriteResponse,
  type ProfileBundleExportPlan,
  type ProfileRegistryFieldUpdateRequest,
  type ProfileRegistryLifecycleRequest,
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
  private readonly _exportPlan = signal<ProfileBundleExportPlan | null>(null);
  private readonly _registryWritePlan = signal<ProfileRegistryWritePlan | null>(
    null,
  );
  private readonly _registryWriteResult =
    signal<ProfileRegistryWriteApplyResult | null>(null);
  private readonly _modelProviders = signal<ModelProviderPage | null>(null);
  private readonly _providerWriteResult =
    signal<ModelProviderWriteResponse | null>(null);
  /**
   * Provider-specific load error. Unlike the compatibility-diagnostic routes,
   * the model-provider registry is a first-class part of this panel; a failure
   * to load it must be visible rather than looking like an empty registry.
   */
  private readonly _providerLoadError = signal<string | null>(null);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _createResult =
    signal<AdminControlResponse<CreatedServiceProfile> | null>(null);
  private readonly _reloadResult =
    signal<AdminControlResponse<RuntimeConfigApplyResult> | null>(null);
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
  readonly exportPlan = this._exportPlan.asReadonly();
  readonly registryWritePlan = this._registryWritePlan.asReadonly();
  readonly registryWriteResult = this._registryWriteResult.asReadonly();
  readonly modelProviders = this._modelProviders.asReadonly();
  readonly providerWriteResult = this._providerWriteResult.asReadonly();
  readonly providerLoadError = this._providerLoadError.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly error = this._error.asReadonly();
  readonly createResult = this._createResult.asReadonly();
  readonly reloadResult = this._reloadResult.asReadonly();
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
        modelProvidersResult,
      ] = await Promise.all([
        this.transport.adminDiagnostics(),
        this.transport.adminSessions({ limit: 100 }),
        this.transport.adminAgents({ limit: 100 }),
        this.transport.adminMcpSurfaces({ limit: 100 }),
        this.transport.adminConfigValidation(),
        this.transport.adminCapabilities().catch(() => null),
        this.transport.adminProfileDiagnostics().catch(() => null),
        loadModelProviders(this.transport),
      ]);
      this._diagnostics.set(diagnostics);
      this._sessions.set(sessions);
      this._agents.set(agents);
      this._mcpSurfaces.set(mcpSurfaces);
      this._configValidation.set(configValidation);
      this._capabilities.set(capabilities);
      this._profileDiagnostics.set(profileDiagnostics);
      this._modelProviders.set(modelProvidersResult.page);
      this._providerLoadError.set(modelProvidersResult.error);
    } catch (error) {
      this._error.set(errorMessage(error));
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
      this._error.set(errorMessage(error));
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
      this._error.set(errorMessage(error));
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
      this._error.set(errorMessage(error));
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
      this._error.set(errorMessage(error));
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
    try {
      const result = await this.transport.applyAdminProfileRegistryUpdate(
        profileId,
        request,
      );
      this._registryWriteResult.set(result);
      await this.refresh();
    } catch (error) {
      this._error.set(errorMessage(error));
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
      this._error.set(errorMessage(error));
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
    try {
      const result = await this.transport.applyAdminProfileRegistryLifecycle(
        profileId,
        request,
      );
      this._registryWriteResult.set(result);
      await this.refresh();
    } catch (error) {
      this._error.set(errorMessage(error));
    } finally {
      this._saving.set(false);
    }
  }

  /** Clear the current registry write plan/result (e.g. after dismissing). */
  clearRegistryWrite(): void {
    this._registryWritePlan.set(null);
    this._registryWriteResult.set(null);
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
      this._error.set(errorMessage(error));
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
      this._error.set(errorMessage(error));
    } finally {
      this._saving.set(false);
    }
  }

  /** Clear the provider write result (e.g. after dismissing its panel). */
  clearProviderWriteResult(): void {
    this._providerWriteResult.set(null);
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
      this._error.set(errorMessage(error));
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
      this._error.set(errorMessage(error));
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

function errorMessage(error: unknown): string {
  if (error instanceof ChatTransportError && error.apiError !== undefined) {
    return `${error.message} (${error.apiError.reason_code})`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Load model providers, capturing any failure as a provider-specific error so
 * the Providers panel can distinguish a broken registry from an empty one.
 */
async function loadModelProviders(transport: ChatTransport): Promise<{
  page: ModelProviderPage | null;
  error: string | null;
}> {
  try {
    const page = await transport.adminModelProviders({ limit: 100 });
    return { page, error: null };
  } catch (error) {
    return { page: null, error: errorMessage(error) };
  }
}
