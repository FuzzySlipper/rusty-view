import type {
  AdminControlResponse,
  AdminLocalToolProfile,
  AdminLocalToolProfileList,
  AdminMcpCatalog,
  AdminProfileRegistryDiagnostics,
  AdminToolCatalog,
  ApiCapabilityDescriptor,
  ChatTransport,
  ContextStrategyCatalog,
  CreateAdminProfileRequest,
  CreatedServiceProfile,
  ProfileBrainRebuildRequest,
  ProfileBrainRebuildResult,
  ProfileDeleteRequest,
  ProfileDeleteResult,
  ProfileBundleExportPlan,
  ProfileRegistryRuntimeConfigRequest,
  RuntimeConfigApplyResult,
  RuntimeConfigDraftPlan,
  RuntimeConfigDraftRequest,
  RuntimeConfigValidationReport,
  RuntimeWakeTimeoutPatchRequest,
  RuntimeWakeTimeoutPatchResult,
} from '@rusty-view/transport';

/** Recording stub: a callable that records its call arguments like a vi.fn(). */
type RecordingFn<A extends unknown[], R> = ((...args: A) => R) & {
  readonly mock: { readonly calls: A[] };
};

function recordingFn<A extends unknown[], R>(
  impl: (...args: A) => R,
): RecordingFn<A, R> {
  const calls: A[] = [];
  const fn = (...args: A): R => {
    calls.push(args);
    return impl(...args);
  };
  (fn as unknown as { mock: { calls: A[] } }).mock = { calls };
  return fn as RecordingFn<A, R>;
}

/**
 * Shared test scaffolding for the profiles list/create/edit components (#3690).
 * A single fake {@link ChatTransport} plus catalog fixtures, reused by the
 * coordinator, create-window, and edit-window specs so the mock stays in one
 * place.
 */

export const LANDED_PROFILE_CONTROL_CAPABILITY_IDS = [
  'admin.control.profiles.create',
  'admin.control.config.reload',
  'admin.control.config.wake_timeout.patch',
  'admin.control.config.draft.plan',
  'admin.control.config.draft.apply',
  'admin.control.mcp.reload',
  'admin.control.profiles.read',
  'admin.control.profiles.update.plan',
  'admin.control.profiles.update.apply',
  'admin.control.sessions.rebuild_runtime.plan',
  'admin.control.sessions.rebuild_runtime.apply',
  'admin.control.profiles.rebuild_brain.plan',
  'admin.control.profiles.rebuild_brain.apply',
  'admin.control.profiles.delete',
] as const;

export function capability(id: string): ApiCapabilityDescriptor {
  return {
    id,
    method: 'POST',
    path_template: `/test/${id}`,
    description: id,
    auth: 'admin',
    mutation: 'control',
    stability: 'experimental',
    tags: [],
    public: false,
  };
}

export interface TransportOptions {
  readonly capabilityIds?: readonly string[];
  readonly profileDiagnostics?: AdminProfileRegistryDiagnostics | null;
  readonly exportPlan?: ProfileBundleExportPlan | null;
  readonly mcpCatalog?: AdminMcpCatalog | null;
  readonly toolCatalog?: AdminToolCatalog | null;
  readonly localToolProfiles?: AdminLocalToolProfileList | null;
  readonly contextStrategyCatalog?: ContextStrategyCatalog | null;
  readonly configValidation?: RuntimeConfigValidationReport | null;
}

export function makeTransport(options: TransportOptions = {}): ChatTransport {
  const capabilityIds =
    options.capabilityIds ?? LANDED_PROFILE_CONTROL_CAPABILITY_IDS;
  return {
    listSessions: async () => ({ items: [], total: 0, limit: 100, offset: 0 }),
    adminDiagnostics: async () => ({
      overview: {
        generatedAt: '2026-06-25T00:00:00Z',
        health: 'ok',
        degraded: false,
        reasonCodes: [],
        summary: {
          sessions: 0,
          activeSessions: 0,
          idleSessions: 0,
          archivedSessions: 0,
          delegatedSessions: 0,
          blockedDelegations: 0,
          pendingQueueItems: 0,
          expiredQueueItems: 0,
          toolErrors: 0,
          recentErrors: 0,
        },
        runtime: {
          brainModules: [],
          sessions: [],
          delegatedSessions: [],
          runtimePauses: [],
        },
      },
      health: {},
    }),
    adminSessions: async () => ({ items: [], total: 0, limit: 100, offset: 0 }),
    adminAgents: async () => ({ items: [], total: 0, limit: 100, offset: 0 }),
    adminMcpSurfaces: async () => ({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    }),
    adminConfigValidation: async () => options.configValidation ?? null,
    adminCapabilities: async () => ({
      schema_version: 1,
      slash_commands: [],
      capabilities: capabilityIds.map(capability),
    }),
    adminProfileDiagnostics: async () => options.profileDiagnostics ?? null,
    adminMcpCatalog: async () => options.mcpCatalog ?? null,
    adminToolCatalog: async () => options.toolCatalog ?? null,
    adminLocalToolProfiles: async () => options.localToolProfiles ?? null,
    adminContextStrategies: async () =>
      options.contextStrategyCatalog === undefined
        ? contextStrategyCatalog()
        : options.contextStrategyCatalog,
    adminCreateLocalToolProfile: recordingFn(
      async (body: unknown) =>
        ({ id: 'created', ...(body as object) }) as unknown,
    ),
    adminUpdateLocalToolProfile: recordingFn(
      async (_id: string, body: unknown) => body as unknown,
    ),
    adminDeleteLocalToolProfile: recordingFn(async (_id: string) => undefined),
    adminModelProviders: async () => null,
    adminProfileExportPlan: async () =>
      options.exportPlan ?? {
        profileId: 'field-prime',
        generatedAt: '2026-06-26T00:00:00Z',
        source: 'registry',
        lifecycleStatus: 'active',
        fallbackStatus: 'registry_authoritative',
        bundleRootName: 'field-prime-profile-bundle',
        entries: [],
        activeDbStateEntries: [],
        fileAssetEntries: [],
        optionalEntries: [],
        diagnostics: [],
        warnings: [],
      },
    createAdminProfile: recordingFn(
      async (
        request: CreateAdminProfileRequest,
      ): Promise<AdminControlResponse<CreatedServiceProfile>> => ({
        command: {
          name: 'create_profile',
          target: { profileId: request.profileId },
          requestId: 'req',
        },
        outcome: {
          status: 'completed',
          summary: `profile ${request.profileId} created`,
          result: {
            profileId: request.profileId,
            agentId: request.profileId,
            sessionId: `${request.profileId}-session`,
            implementationId: `${request.profileId}-brain`,
            profilePath: '/tmp/profile.json',
            runtimeConfigPath: '/tmp/service.json',
            applyResult: {
              brainsRegistered: 1,
              brainsAlreadyPresent: 0,
              sessionsCreated: 1,
              sessionsAlreadyPresent: 0,
              sessionsReactivated: 0,
              sessionsMissing: 0,
              scheduledJobsRegistered: 0,
            },
            derivedRuntimeActions: [
              { refKind: 'brain', refId: `${request.profileId}-brain` },
              { refKind: 'session', refId: `${request.profileId}-session` },
              {
                refKind: 'profile_mcp_config',
                refId: `${request.profileId}-mcp`,
              },
            ],
          },
        },
        audit: { started: true, terminal: true },
        observation: {},
      }),
    ),
    planAdminProfileRegistryUpdate: recordingFn(async () =>
      registryPlan('update'),
    ),
    applyAdminProfileRegistryUpdate: recordingFn(async () =>
      appliedRegistryPlan('update'),
    ),
    planAdminProfileRegistryLifecycle: recordingFn(async () =>
      registryPlan('lifecycle'),
    ),
    applyAdminProfileRegistryLifecycle: recordingFn(async () =>
      appliedRegistryPlan('lifecycle'),
    ),
    planAdminProfileRegistryPrompt: recordingFn(async () =>
      registryPlan('prompt'),
    ),
    applyAdminProfileRegistryPrompt: recordingFn(async () =>
      appliedRegistryPlan('prompt'),
    ),
    planAdminProfileRegistryRuntimeConfig: recordingFn(
      async (
        _profileId: string,
        request: ProfileRegistryRuntimeConfigRequest,
      ) => runtimeConfigPlan(false, request),
    ),
    applyAdminProfileRegistryRuntimeConfig: recordingFn(
      async (
        _profileId: string,
        request: ProfileRegistryRuntimeConfigRequest,
      ) => runtimeConfigPlan(true, request),
    ),
    planAdminProfileBrainRebuild: recordingFn(
      async (profileId: string, _request: ProfileBrainRebuildRequest = {}) =>
        brainRebuildResponse(profileId, 'planned'),
    ),
    applyAdminProfileBrainRebuild: recordingFn(
      async (profileId: string, _request: ProfileBrainRebuildRequest = {}) =>
        brainRebuildResponse(profileId, 'completed'),
    ),
    deleteAdminProfile: recordingFn(
      async (profileId: string, request: ProfileDeleteRequest) =>
        profileDeleteResponse(profileId, request),
    ),
    reloadAdminConfig: recordingFn(async () => configReloadResponse()),
    planRuntimeConfigDraft: recordingFn(
      async (request: RuntimeConfigDraftRequest) =>
        runtimeConfigDraftResponse(request, false),
    ),
    applyRuntimeConfigDraft: recordingFn(
      async (request: RuntimeConfigDraftRequest) =>
        runtimeConfigDraftResponse(request, true),
    ),
    patchWakeTimeoutConfig: recordingFn(
      async (request: RuntimeWakeTimeoutPatchRequest) =>
        wakeTimeoutPatchResponse(request),
    ),
  } as unknown as ChatTransport;
}

function wakeTimeoutPatchResponse(
  request: RuntimeWakeTimeoutPatchRequest,
): AdminControlResponse<RuntimeWakeTimeoutPatchResult> {
  return {
    command: {
      name: 'patch_wake_timeout',
      target: {},
      requestId: 'req-wake-timeout-patch',
      ...(request.reason === undefined ? {} : { reason: request.reason }),
    },
    outcome: {
      status: 'completed',
      summary:
        request.wakeTimeout.mode === 'default'
          ? `wake timeout set to ${request.wakeTimeout.defaultMs}ms`
          : 'wake timeout disabled',
      result: {
        ok: true,
        wakeTimeout: request.wakeTimeout,
        preservedSections: {
          brains: 1,
          sessions: 1,
          scheduledJobs: 1,
          channelBindings: 1,
          mcpServers: 1,
          mcpBindings: 1,
        },
        safeWritePath: {
          capabilityId: 'admin.control.config.wake_timeout.patch',
          method: 'POST',
          path: '/v1/admin/control/config/wake-timeout',
        },
        applyResult: {
          brainsRegistered: 0,
          brainsAlreadyPresent: 1,
          sessionsCreated: 0,
          sessionsAlreadyPresent: 1,
          sessionsReactivated: 0,
          sessionsMissing: 0,
          scheduledJobsRegistered: 0,
        },
      },
    },
    audit: { started: true, terminal: true },
    observation: {},
  };
}

function runtimeConfigDraftResponse(
  request: RuntimeConfigDraftRequest,
  applied: boolean,
): AdminControlResponse<RuntimeConfigDraftPlan> {
  return {
    command: {
      name: applied
        ? 'apply_runtime_config_update'
        : 'plan_runtime_config_update',
      target: {},
      requestId: 'req-runtime-config-draft',
      ...(request.reason === undefined ? {} : { reason: request.reason }),
    },
    outcome: {
      status: 'completed',
      summary: applied
        ? 'runtime config draft applied'
        : 'runtime config draft plan is valid',
      result: {
        ok: true,
        configPath: '/tmp/service.json',
        diagnostics: [],
        implications: {
          configReloadRequired: true,
          createMissingSessions: false,
          explicitChannelLifecycle: true,
          explicitSessionLifecycle: true,
        },
        ...(applied
          ? {
              applyResult: {
                brainsRegistered: request.runtimeConfig.brains.length,
                brainsAlreadyPresent: 0,
                sessionsCreated: request.runtimeConfig.sessions.length,
                sessionsAlreadyPresent: 0,
                sessionsReactivated: 0,
                sessionsMissing: 0,
                scheduledJobsRegistered:
                  request.runtimeConfig.scheduledJobs.length,
              },
            }
          : {}),
      },
    },
    audit: { started: true, terminal: true },
    observation: {},
  };
}

function configReloadResponse(): AdminControlResponse<RuntimeConfigApplyResult> {
  return {
    command: {
      name: 'reload_config',
      target: {},
      requestId: 'req-reload',
      reason: 'rusty-view service config reload',
    },
    outcome: {
      status: 'completed',
      summary: 'runtime config reloaded',
      result: {
        brainsRegistered: 0,
        brainsAlreadyPresent: 1,
        sessionsCreated: 0,
        sessionsAlreadyPresent: 1,
        sessionsReactivated: 0,
        sessionsMissing: 0,
        scheduledJobsRegistered: 0,
      },
    },
    audit: { started: true, terminal: true },
    observation: {},
  };
}

function brainRebuildResponse(
  profileId: string,
  status: NonNullable<ProfileBrainRebuildResult['status']>,
): AdminControlResponse<ProfileBrainRebuildResult> {
  return {
    command: {
      name: 'profile_rebuild_brain',
      target: { profile_id: profileId },
      requestId: 'req-rebuild',
      reason: 'profile runtime config changed from Rusty View',
    },
    outcome: {
      status: status === 'planned' ? 'completed' : 'completed',
      summary:
        status === 'planned'
          ? 'profile brain rebuild planned'
          : 'profile brain rebuild applied',
      result: {
        profileId,
        status,
        affectedSessionIds: ['session-1'],
        blockedInFlightWakeIds: [],
        sessionIdsPreserved: true,
        sessionHistoryPreserved: true,
        mcpRefresh: { status: 'completed' },
      },
    },
    audit: { started: true, terminal: true },
    observation: {},
  };
}

function profileDeleteResponse(
  profileId: string,
  request: ProfileDeleteRequest,
): AdminControlResponse<ProfileDeleteResult> {
  return {
    command: {
      name: 'delete_profile',
      target: { profileId },
      requestId: 'req-delete',
      ...(request.reason !== undefined ? { reason: request.reason } : {}),
    },
    outcome: {
      status: 'completed',
      summary: `profile ${profileId} hard-deleted`,
      result: {
        profileId,
        confirmProfileId: request.confirmProfileId,
        profileDirectoryDeleted: true,
        runtimeConfigReloaded: true,
        storagePurge: {
          profileId,
          profileRegistryDeleted: true,
          sessionIds: [`${profileId}-session`],
          agentIds: [`${profileId}-agent`],
          tableCounts: [
            { table: 'profile_registry', rowsDeleted: 1 },
            { table: 'session_events', rowsDeleted: 6 },
          ],
          rowsDeleted: 7,
        },
      },
    },
    audit: { started: true, terminal: true },
    observation: {},
  };
}

type RegistryPlanKind = 'update' | 'lifecycle' | 'prompt';

/**
 * A representative runtime-config plan/apply response (#3742). Distinct from
 * {@link registryPlan}: no `kind`, runtime-config-specific implications, plus
 * `runtimeConfig`/`nextWrite` and (on apply) `applied`/`record`/`effects`.
 */
function runtimeConfigPlan(
  applied: boolean,
  request?: ProfileRegistryRuntimeConfigRequest,
) {
  const strategyId = request?.contextPolicy?.strategyId;
  const knownStrategyIds = contextStrategyCatalog().strategies.map((s) => s.id);
  // Mirror Crew: an unknown strategy id comes back as a non-ok plan with a
  // diagnostic at contextPolicy.strategyId rather than applying.
  const contextDiagnostics =
    strategyId !== undefined && !knownStrategyIds.includes(strategyId)
      ? [
          {
            severity: 'error' as const,
            code: 'context_strategy_unknown',
            path: 'contextPolicy.strategyId',
            message: `unknown context strategy ${strategyId}`,
          },
        ]
      : [];
  const base = {
    ok: contextDiagnostics.length === 0,
    profileId: 'rt-prime',
    mode: applied ? ('apply' as const) : ('plan' as const),
    expectedRevision: 5,
    current: { profileId: 'rt-prime', revision: 5 },
    next: { profileId: 'rt-prime', revision: 6 },
    nextWrite: {},
    runtimeConfig: {
      providerAlias: 'default',
      localToolProfileId: 'planner-tools',
      mcpBindings: [],
      ...(request?.contextPolicy !== undefined
        ? { contextPolicy: request.contextPolicy }
        : {}),
    },
    diagnostics: contextDiagnostics,
    implications: {
      registryRevisionWillIncrement: true as const,
      profileFileWillChange: true,
      serviceConfigWillChange: false,
      configReloadRequired: true as const,
      runtimeRebuildRecommended: true,
      mcpRefreshRecommended: false,
    },
  };
  // A non-ok plan (e.g. unknown strategy) is returned as a plain plan even on
  // apply, mirroring Crew (no `applied`/`record`/`effects`).
  return applied && base.ok
    ? {
        ...base,
        applied: true as const,
        record: { profileId: 'rt-prime', revision: 6 },
        effects: {
          profilePath: '/profiles/rt-prime/profile.json',
          runtimeConfigPath: '/service.json',
          mcpBindings: { removed: 0, added: 0 },
          applyResult: {},
        },
      }
    : base;
}

/**
 * A representative context strategy catalog (task #3849), matching the live
 * Crew shape: `recent_window` default plus a compaction-capable strategy.
 */
export function contextStrategyCatalog(): ContextStrategyCatalog {
  return {
    schemaVersion: 1,
    defaultStrategyId: 'recent_window',
    policyDefaults: {
      enabled: true,
      strategyId: 'recent_window',
      autoCompactionEnabled: false,
      compactAtPercent: 80,
      targetPercentAfterCompaction: 55,
      maxContextPercentForWake: 95,
      debugVisibility: 'status',
      includeDebugEventsInModelContext: false,
      strategyConfig: {},
    },
    strategies: [
      {
        id: 'recent_window',
        label: 'Recent Window',
        description: 'Preserves the current wake assembly behavior.',
        status: 'active',
        supportsAutoCompaction: false,
        modelFacingDebugDefault: false,
      },
      {
        id: 'rolling_summary_compaction',
        label: 'Rolling Summary Compaction',
        description: 'Plans context-fill-triggered compaction.',
        status: 'planned',
        supportsAutoCompaction: true,
        modelFacingDebugDefault: false,
      },
    ],
    percentRange: { min: 1, max: 100 },
  };
}

function registryPlan(kind: RegistryPlanKind) {
  return {
    ok: true,
    profileId: 'field-prime',
    kind,
    mode: 'plan',
    expectedRevision: 3,
    current: { profileId: 'field-prime', revision: 3 },
    next: { profileId: 'field-prime', revision: 4, displayName: 'Updated' },
    diagnostics: [],
    implications: {
      registryRevisionWillIncrement: true as const,
      profileFilesUnchanged: true as const,
      serviceConfigUnchanged: true as const,
      runtimeRebuildRecommended: kind !== 'update',
      lifecycleEffects:
        kind === 'lifecycle'
          ? ('archive_active_sessions_and_unregister_brain' as const)
          : ('none' as const),
    },
  };
}

function appliedRegistryPlan(kind: RegistryPlanKind) {
  return {
    ...registryPlan(kind),
    mode: 'apply',
    applied: true as const,
    record: { profileId: 'field-prime', revision: 4, displayName: 'Updated' },
    ...(kind === 'lifecycle'
      ? {
          effects: {
            sessionsArchived: [],
            brainHandle: { action: 'already_absent' },
          },
        }
      : {}),
  };
}

/**
 * A representative MCP catalog: one runtime server, one explicit binding, and
 * one legacy/profile-derived binding whose endpoint resolves to a different
 * (env-default) server via compatibility fallback.
 */
export function mcpCatalog(): AdminMcpCatalog {
  return {
    servers: [
      {
        id: 'den',
        label: 'Den',
        baseUrl: 'https://den.example/mcp',
        transport: 'streamable_http',
        source: 'runtime',
        configuredBindingCount: 1,
      },
      {
        id: 'files',
        baseUrl: 'https://files.example/mcp',
        transport: 'streamable_http',
        source: 'env',
        configuredBindingCount: 0,
      },
    ],
    toolProfiles: ['planner', 'files'],
    bindings: [
      {
        bindingId: 'den-binding',
        adapterId: 'mcp-den',
        agentId: 'agent-prime',
        profileId: 'field-prime',
        endpointRef: 'config://mcp/den',
        endpointServerId: 'den',
        resolvedServerId: 'den',
        transport: 'streamable_http',
        toolProfileKey: 'planner',
        serverNames: ['den'],
        status: 'active',
      },
      {
        bindingId: 'legacy-files',
        adapterId: 'mcp-ts-files',
        agentId: 'agent-legacy',
        profileId: 'field-prime',
        endpointRef: 'config://mcp/legacy',
        endpointServerId: 'legacy',
        resolvedServerId: 'env-default',
        transport: 'streamable_http',
        toolProfileKey: 'files',
        serverNames: ['files'],
        status: 'degraded',
        degradedReason: 'degraded server unreachable',
      },
    ],
  };
}

/**
 * A representative built-in tool catalog: two toolsets (one with a label and
 * tool count, one bare) and one individually selectable tool.
 */
export function toolCatalog(): AdminToolCatalog {
  return {
    toolsets: [
      {
        id: 'local_code_read',
        label: 'Local code read',
        description: 'Read files from the local workspace',
        toolCount: 3,
        tools: ['read_file', 'list_files', 'grep'],
      },
      { id: 'memory_profile' },
    ],
    tools: [
      {
        name: 'todo',
        toolsets: ['planning_session'],
        description: 'Manage a task list',
      },
    ],
  };
}

/** A representative local tool profile list (task #3689). */
export function localToolProfiles(): AdminLocalToolProfileList {
  return {
    profiles: [
      {
        id: 'planner-tools',
        displayName: 'Planner tools',
        description: 'Tools for planning sessions',
        enabled: true,
        system: false,
        readOnly: false,
        requestedToolsets: ['local_code_read'],
        requestedTools: ['todo'],
        revision: 2,
      },
      {
        id: 'builtin-readonly',
        displayName: 'Built-in (read only)',
        enabled: true,
        system: true,
        readOnly: true,
        requestedToolsets: ['memory_profile'],
        requestedTools: [],
        revision: 1,
        diagnostics: [
          {
            severity: 'warning',
            code: 'tool_profile_stale_reference',
            path: 'requestedToolsets[0]',
            message: 'toolset memory_profile no longer in catalog',
          },
        ],
      },
    ] satisfies AdminLocalToolProfile[],
  };
}

/** A single registry-backed record for edit-window tests. */
export function registryDiagnostics(
  record: Partial<AdminProfileRegistryDiagnostics['records'][number]> & {
    readonly profileId: string;
  },
): AdminProfileRegistryDiagnostics {
  return {
    generatedAt: '2026-06-27T00:00:00Z',
    records: [
      {
        source: 'registry',
        lifecycleStatus: 'active',
        activeRuntimeRefs: [],
        sourceAssetRefs: [],
        sourceAssetStatuses: [],
        diagnostics: [],
        fallbackStatus: 'registry_authoritative',
        ...record,
      },
    ],
    registryCount: 1,
    fileFallbackCount: 0,
    driftCount: 0,
    missingAssetCount: 0,
    diagnostics: [],
  };
}

/**
 * Pull the most recent createAdminProfile request off the transport mock.
 * Throws when the spy was never called so the failing assertion is obvious.
 */
export function lastCreateRequest(spy: {
  mock: { calls: [CreateAdminProfileRequest][] };
}): CreateAdminProfileRequest {
  const calls = spy.mock.calls;
  const last = calls[calls.length - 1];
  if (last === undefined) {
    throw new Error('createAdminProfile was never called');
  }
  return last[0];
}

/**
 * Pull the most recent runtime-config plan/apply request (profileId, request)
 * off a transport mock and return the request body (#3742).
 */
export function lastRuntimeConfigRequest(spy: {
  mock: { calls: [string, ProfileRegistryRuntimeConfigRequest][] };
}): ProfileRegistryRuntimeConfigRequest {
  const calls = spy.mock.calls;
  const last = calls[calls.length - 1];
  if (last === undefined) {
    throw new Error('runtime-config was never called');
  }
  return last[1];
}
