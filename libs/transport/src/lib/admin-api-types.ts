export interface AdminApiMeta {
  readonly request_id: string;
  readonly schema_version: 1;
}

export interface AdminApiError {
  readonly code:
    | 'unauthorized'
    | 'forbidden'
    | 'not_found'
    | 'invalid_input'
    | 'failed_precondition'
    | 'conflict'
    | 'internal_error';
  readonly reason_code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type AdminApiEnvelope<T> =
  | {
      readonly ok: true;
      readonly data: T;
      readonly meta: AdminApiMeta;
    }
  | {
      readonly ok: false;
      readonly error: AdminApiError;
      readonly meta: AdminApiMeta;
    };

export interface AdminPage<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly nextOffset?: number;
}

export interface AdminDiagnosticsOverview {
  readonly generatedAt: string;
  readonly health: string;
  readonly degraded: boolean;
  readonly reasonCodes: readonly string[];
  readonly summary: {
    readonly sessions: number;
    readonly activeSessions: number;
    readonly idleSessions: number;
    readonly archivedSessions: number;
    readonly delegatedSessions: number;
    readonly blockedDelegations: number;
    readonly pendingQueueItems: number;
    readonly expiredQueueItems: number;
    readonly toolErrors: number;
    readonly recentErrors: number;
  };
}

export interface AdminDiagnosticsBundle {
  readonly runtime?: {
    readonly runtimePauses?: readonly RuntimePauseDiagnostics[];
  };
  readonly overview: {
    readonly generatedAt: string;
    readonly health: string;
    readonly degraded: boolean;
    readonly reasonCodes: readonly string[];
    readonly summary: AdminDiagnosticsOverview['summary'];
    readonly runtime: {
      readonly brainModules: readonly RuntimeBrainModuleDiagnostics[];
      readonly sessions: readonly RuntimeSessionDiagnostics[];
      readonly delegatedSessions: readonly RuntimeDelegationDiagnostics[];
      readonly runtimePauses?: readonly RuntimePauseDiagnostics[];
    };
    readonly issues?: readonly RuntimeDiagnosticsIssue[];
  };
  readonly health: unknown;
}

export interface RuntimeSessionDiagnostics {
  readonly sessionId: string;
  readonly agentId: string;
  readonly profileId: string;
  readonly kind: string;
  readonly status: string;
  readonly toolCount: number;
  readonly brainTurnCount: number;
  readonly lastActiveAt: string;
  readonly stale: boolean;
  readonly effectiveDefaults?: Record<string, unknown>;
}

export interface RuntimeBrainModuleDiagnostics {
  readonly profileId: string;
  readonly implementationId: string;
  readonly moduleId: string;
  readonly strategy?: string;
  readonly effectiveStrategy?: string;
  readonly providerStateMode?: string;
  readonly selectedToolCount: number;
  readonly selectedToolSource: string;
  readonly toolAdapterStatus: string;
}

export interface RuntimeDelegationDiagnostics {
  readonly sessionId: string;
  readonly parentSessionId?: string;
  readonly runId?: string;
  readonly runStatus?: string;
  readonly terminal: boolean;
  readonly blocked: boolean;
}

export type RuntimePauseScope = 'session' | 'profile' | 'agent';

export interface RuntimePauseDiagnostics {
  readonly pauseId: string;
  readonly scope: RuntimePauseScope;
  readonly targetId: string;
  readonly pausedBy: string;
  readonly pausedAt: string;
  readonly reason?: string;
  readonly reasonCode?: string;
  readonly affectedSessionIds: readonly string[];
  readonly inFlightWakeCount: number;
  readonly cancellationSupported: boolean;
  readonly limitation: string;
}

export interface RuntimePauseControlResult extends RuntimePauseDiagnostics {
  readonly resumedAt?: string;
}

export interface RuntimeResumeNoopResult {
  readonly paused: false;
  readonly scope: RuntimePauseScope;
  readonly targetId: string;
}

export interface RuntimePauseControlRequest {
  readonly reason?: string;
  readonly reasonCode?: string;
  readonly denRefs?: readonly string[];
}

export interface RuntimeDiagnosticsIssue {
  readonly code: string;
  readonly severity: string;
  readonly message: string;
  readonly source: string;
  readonly sessionId?: string;
}

export interface AdminAgentDiagnostics {
  readonly agentId: string;
  readonly profileId: string;
  readonly sessions: number;
  readonly activeSessions: number;
  readonly idleSessions: number;
  readonly archivedSessions: number;
  readonly staleSessions: number;
}

export interface McpSurfaceDiagnostics {
  readonly bindingId?: string;
  readonly profileId?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly status?: string;
  readonly transport?: string;
  readonly toolProfileKey?: string;
  readonly serverNames?: readonly string[];
  readonly lastError?: string;
  readonly [key: string]: unknown;
}

export interface RuntimeConfigDiagnostic {
  readonly severity: string;
  readonly code: string;
  readonly path?: string;
  readonly message: string;
}

export interface RuntimeConfigValidationReport {
  readonly ok: boolean;
  readonly configPath: string;
  readonly profilesDir?: string;
  readonly diagnostics: readonly RuntimeConfigDiagnostic[];
  readonly summary: {
    readonly diagnostics: number;
    readonly errors: number;
    readonly warnings: number;
    readonly brains: number;
    readonly sessions: number;
    readonly scheduledJobs: number;
    readonly channelBindings: number;
    readonly mcpBindings: number;
    readonly derivedScheduledJobs: number;
    readonly derivedMcpBindings: number;
    readonly sessionDefaultsApplied: number;
  };
  readonly derived: {
    readonly scheduledJobs: readonly {
      readonly id: string;
      readonly shape: string;
      readonly jobKind?: string;
      readonly targetSessionId?: string;
    }[];
    readonly mcpBindings: readonly {
      readonly bindingId: string;
      readonly agentId: string;
      readonly sessionId?: string;
      readonly profileId: string;
      readonly transport: string;
      readonly toolProfileKey: string;
      readonly serverNames: readonly string[];
    }[];
    readonly sessionDefaultsApplied: readonly {
      readonly sessionId: string;
      readonly ownerId: boolean;
      readonly resourceLimits: boolean;
      readonly maxHistoryMessages: boolean;
      readonly turnTimeoutMs: boolean;
    }[];
  };
}

export interface CreateAdminProfileRequest {
  readonly profileId: string;
  readonly displayName?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly implementationId?: string;
  readonly kind?: 'full' | 'worker' | 'delegated';
  readonly mcpToolProfile?: string;
  /**
   * Reference to a reusable model provider alias (task #3534/#3538). Preferred
   * over `modelConfig` for profiles that should reuse a configured provider.
   * When set, the backend resolves model/provider config from the alias and
   * omits inline `modelConfig` from the created profile.
   */
  readonly providerAlias?: string;
  readonly modelConfig?: {
    readonly provider: string;
    readonly modelName: string;
    readonly baseUrl?: string;
  };
  readonly brain?: {
    readonly module?: string;
    readonly strategy?: string;
  };
  readonly reason?: string;
}

export interface CreatedServiceProfile {
  readonly profileId: string;
  readonly displayName?: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly implementationId: string;
  readonly profilePath: string;
  readonly runtimeConfigPath: string;
  readonly applyResult: RuntimeConfigApplyResult;
  /**
   * Derived runtime graph actions produced by the create-profile planner
   * (task #3407): brains/sessions/jobs/channel/MCP bindings the backend will
   * create. Surfaced for a runtime-graph-impact preview before/after create.
   * Optional for backends that do not return the planner envelope.
   */
  readonly derivedRuntimeActions?: readonly CreatedProfileRuntimeAction[];
}

export interface RuntimeConfigApplyResult {
  readonly brainsRegistered: number;
  readonly brainsAlreadyPresent: number;
  readonly sessionsCreated: number;
  readonly sessionsAlreadyPresent: number;
  readonly sessionsReactivated: number;
  readonly sessionsMissing: number;
  readonly scheduledJobsRegistered: number;
}

export interface AdminControlOutcome<TResult = unknown> {
  readonly status: 'completed' | 'failed';
  readonly summary: string;
  readonly affectedIds?: Record<string, string | number>;
  readonly result?: TResult;
  readonly reasonCode?: string;
}

export interface AdminControlResponse<TResult = unknown> {
  readonly command: {
    readonly name: string;
    readonly target: Record<string, string>;
    readonly requestId: string;
    readonly reason?: string;
    readonly reasonCode?: string;
  };
  readonly outcome: AdminControlOutcome<TResult>;
  readonly audit: {
    readonly started: true;
    readonly terminal: true;
  };
  readonly observation: {
    readonly started?: string;
    readonly terminal?: string;
  };
}

export type ApiCapabilityAuth = 'none' | 'chat' | 'admin';
export type ApiCapabilityMutation = 'read' | 'write' | 'control';
export type ApiCapabilityStability = 'stable' | 'experimental';
export type ApiCapabilityScope =
  | 'attachment'
  | 'chat'
  | 'conversation'
  | 'diagnostics'
  | 'profile'
  | 'session'
  | 'delegation'
  | 'mcp'
  | 'config'
  | 'maintenance'
  | 'scheduler'
  | 'search'
  | 'curator'
  | 'service';

export interface ApiCapabilityDescriptor {
  readonly id: string;
  readonly method: 'DELETE' | 'GET' | 'POST';
  readonly path_template: string;
  readonly description: string;
  readonly auth: ApiCapabilityAuth;
  readonly mutation: ApiCapabilityMutation;
  readonly stability: ApiCapabilityStability;
  readonly tags: readonly ApiCapabilityScope[];
  readonly public: boolean;
  readonly command_name?: string;
}

export interface ApiCapabilityRegistry {
  readonly schema_version: 1;
  readonly slash_commands: readonly unknown[];
  readonly capabilities: readonly ApiCapabilityDescriptor[];
}

// ---- DB-backed profile registry (ADR 0019) ----

/**
 * Whether a profile registry record is backed by the DB registry or by a
 * file-backed compatibility projection. See ADR 0019.
 */
export type AdminProfileRegistrySource = 'registry' | 'file_fallback';

/**
 * Drift status for a profile source asset referenced by the registry.
 * `tracked` means the on-disk fingerprint matches the registry snapshot.
 */
export type AdminProfileAssetStatus =
  | 'tracked'
  | 'missing'
  | 'changed'
  | 'unknown';

/**
 * A reference to a file-backed profile asset (e.g. `soul.md`, `memory.md`,
 * `profile.yaml`, profile-local skills). File assets remain the authoritative
 * home for human-authored prompt material; the registry stores references and
 * fingerprints, not raw prompt text.
 */
export interface ProfileRegistrySourceAssetRef {
  readonly assetKind: string;
  readonly path: string;
  readonly contentHash?: string;
  readonly lastSeenAt?: string;
  readonly metadataJson: unknown;
}

/**
 * A derived runtime graph reference produced from registry state (brain,
 * session, scheduled job, channel binding, or MCP binding). Derived refs are
 * a snapshot/plan and must be applied through service APIs.
 */
export interface ProfileRegistryDerivedRuntimeRef {
  readonly refKind: string;
  readonly refId: string;
  readonly status: string;
  readonly updatedAt?: string;
  readonly metadataJson: unknown;
}

/**
 * A derived runtime graph action from the create-profile planner (task #3407):
 * the brain/session/job/channel/MCP binding the backend will create. Surfaced
 * for a runtime-graph-impact preview of the create flow.
 */
export interface CreatedProfileRuntimeAction {
  readonly refKind: string;
  readonly refId: string;
  readonly metadataJson?: unknown;
}

/**
 * Live status of a source asset, comparing the registry snapshot fingerprint
 * to the current on-disk fingerprint. Used to surface drift/missing assets.
 */
export interface AdminProfileRegistryAssetStatus {
  readonly assetKind: string;
  readonly path: string;
  readonly contentHash?: string;
  readonly currentContentHash?: string;
  readonly status: AdminProfileAssetStatus;
  readonly metadataJson?: unknown;
}

/**
 * Safe admin projection of a profile registry record. Active runtime settings
 * and raw prompt/file contents are intentionally not exposed here; the record
 * carries registry-owned metadata, derived runtime refs, and source asset
 * refs/fingerprints so the UI can distinguish DB-active state from file
 * assets.
 */
export interface AdminProfileRegistryRecord {
  readonly source: AdminProfileRegistrySource;
  readonly profileId: string;
  readonly lifecycleStatus: string;
  readonly displayName?: string;
  readonly summary?: string;
  readonly defaultSessionKind?: string;
  readonly agentId?: string;
  readonly ownerId?: string;
  readonly revision?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly importedFrom?: string;
  readonly importedAt?: string;
  readonly activeRuntimeRefs: readonly ProfileRegistryDerivedRuntimeRef[];
  readonly sourceAssetRefs: readonly ProfileRegistrySourceAssetRef[];
  readonly sourceAssetStatuses: readonly AdminProfileRegistryAssetStatus[];
  readonly diagnostics: readonly RuntimeConfigDiagnostic[];
  readonly fallbackStatus: 'registry_authoritative' | 'file_backed_fallback';
}

/**
 * Profile registry diagnostics bundle. Aggregates registry records (including
 * file-backed fallback projections) plus drift/missing-asset diagnostics and
 * registry/file fallback counts.
 */
export interface AdminProfileRegistryDiagnostics {
  readonly generatedAt: string;
  readonly records: readonly AdminProfileRegistryRecord[];
  readonly registryCount: number;
  readonly fileFallbackCount: number;
  readonly driftCount: number;
  readonly missingAssetCount: number;
  readonly diagnostics: readonly RuntimeConfigDiagnostic[];
}

/**
 * Query filters for the profile registry list route. `source` and
 * `fallbackStatus` select registry vs file-backed fallback records.
 */
export interface AdminProfileRegistryQuery {
  readonly limit?: number;
  readonly offset?: number;
  readonly lifecycleStatus?: string;
  readonly source?: AdminProfileRegistrySource;
  readonly fallbackStatus?: 'registry_authoritative' | 'file_backed_fallback';
}

// ---- profile registry field update + lifecycle (tasks #3519/#3521) ----

/**
 * Lifecycle status a registry record can transition to through the lifecycle
 * plan/apply routes (#3521). Non-active transitions disable derived runtime
 * refs, archive active sessions, and unregister the profile brain; assets and
 * memory are preserved.
 */
export type ProfileRegistryLifecycleStatus =
  | 'active'
  | 'paused'
  | 'decommissioned'
  | 'archived';

/**
 * Body for the registry field update plan/apply routes (#3519). All fields
 * are optional; omitted fields keep their current value. `null` clears a
 * field. `expectedRevision` is required for optimistic concurrency.
 */
export interface ProfileRegistryFieldUpdateRequest {
  readonly expectedRevision: number;
  readonly displayName?: string | null | undefined;
  readonly summary?: string | null | undefined;
  readonly defaultSessionKind?:
    | 'full'
    | 'worker'
    | 'delegated'
    | null
    | undefined;
  readonly agentId?: string | null | undefined;
  readonly ownerId?: string | null | undefined;
}

/**
 * Body for the registry lifecycle plan/apply routes (#3521). `lifecycleStatus`
 * is the target status. `expectedRevision` is required for optimistic concurrency.
 */
export interface ProfileRegistryLifecycleRequest {
  readonly expectedRevision: number;
  readonly lifecycleStatus: ProfileRegistryLifecycleStatus;
}

/**
 * Diagnostic from a registry write plan (e.g. revision mismatch). Mirrors the
 * `RuntimeConfigDiagnostic` shape the backend emits.
 */
export interface ProfileRegistryWriteDiagnostic {
  readonly severity: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/**
 * Implications of a registry write, as reported by the planner. Reassures the
 * UI that files/service config are untouched and whether a runtime rebuild is
 * recommended.
 */
export interface ProfileRegistryWriteImplications {
  readonly registryRevisionWillIncrement: true;
  readonly profileFilesUnchanged: true;
  readonly serviceConfigUnchanged: true;
  readonly runtimeRebuildRecommended: boolean;
  readonly lifecycleEffects:
    | 'none'
    | 'archive_active_sessions_and_unregister_brain';
}

/**
 * Plan result for a registry field update or lifecycle transition. `ok` is
 * false when diagnostics contain an error (e.g. revision mismatch); the plan
 * is still returned so the UI can show the mismatch. `current`/`next` are the
 * before/after records; `next` is the projected post-apply record.
 */
export interface ProfileRegistryWritePlan {
  readonly ok: boolean;
  readonly profileId: string;
  readonly kind: 'update' | 'lifecycle';
  readonly mode: 'plan' | 'apply';
  readonly expectedRevision: number;
  readonly current: AdminProfileRegistryRecord;
  readonly next: AdminProfileRegistryRecord;
  readonly diagnostics: readonly ProfileRegistryWriteDiagnostic[];
  readonly implications: ProfileRegistryWriteImplications;
}

/**
 * Apply result for a registry write. The backend returns a plain
 * {@link ProfileRegistryWritePlan} (no `applied`/`record`/`effects`) when the
 * plan is not `ok` (e.g. revision mismatch), so the apply response is a union:
 * either the non-applied plan or the applied result. For lifecycle applies,
 * `effects` describes the runtime side effects.
 */
export type ProfileRegistryWriteApplyResult =
  | ProfileRegistryAppliedWriteResult
  | ProfileRegistryWritePlan;

/**
 * A successful registry apply: the plan plus `applied: true`, the persisted
 * `record` (with bumped revision), and (lifecycle only) runtime `effects`.
 */
export interface ProfileRegistryAppliedWriteResult
  extends ProfileRegistryWritePlan {
  readonly applied: true;
  readonly record: AdminProfileRegistryRecord;
  readonly effects?: ProfileRegistryLifecycleEffects;
}

/**
 * Runtime side effects of a lifecycle apply (#3521). `sessionsArchived` lists
 * the sessions archived; `brainHandle` reports whether the profile brain was
 * removed or already absent. Assets and memory are preserved (V1 does not
 * purge).
 */
export interface ProfileRegistryLifecycleEffects {
  readonly sessionsArchived: readonly string[];
  readonly brainHandle: {
    readonly action: 'removed' | 'already_absent';
    readonly handle?: unknown;
  };
}

// ---- profile bundle export plan (ADR 0019) ----

/**
 * Origin category for a profile bundle export entry. `registry_active_state`
 * entries are generated from DB-backed registry state; `file_asset` entries
 * are planned file copies of prompt/assets; `memory_space_optional` entries
 * are optional separate memory-space exports.
 */
export type ProfileBundleExportSource =
  | 'registry_active_state'
  | 'file_asset'
  | 'generated_metadata'
  | 'memory_space_optional';

/**
 * Kind of artifact a profile bundle export entry materializes in the bundle.
 */
export type ProfileBundleExportEntryKind =
  | 'generated_profile_yaml'
  | 'copy_file_asset'
  | 'generated_registry_json'
  | 'generated_runtime_plan_json'
  | 'generated_checksums_json'
  | 'optional_memory_space_export';

/**
 * One planned entry in a profile bundle export. Raw file content is never
 * embedded in the plan; file assets are referenced by origin path and hash.
 */
export interface ProfileBundleExportEntry {
  readonly targetPath: string;
  readonly kind: ProfileBundleExportEntryKind;
  readonly source: ProfileBundleExportSource;
  readonly originPath?: string;
  readonly originAssetKind?: string;
  readonly contentHash?: string;
  readonly currentContentHash?: string;
  readonly assetStatus?: string;
  readonly contentJson?: unknown;
  readonly notes: readonly string[];
}

/**
 * A profile bundle export plan. Distinguishes active DB state entries from
 * file asset entries and optional memory-space entries. The plan is a
 * snapshot for backup/review and does not mutate service config or sessions.
 */
export interface ProfileBundleExportPlan {
  readonly profileId: string;
  readonly generatedAt: string;
  readonly source: AdminProfileRegistrySource;
  readonly lifecycleStatus: string;
  readonly fallbackStatus: 'registry_authoritative' | 'file_backed_fallback';
  readonly bundleRootName: string;
  readonly entries: readonly ProfileBundleExportEntry[];
  readonly activeDbStateEntries: readonly string[];
  readonly fileAssetEntries: readonly string[];
  readonly optionalEntries: readonly string[];
  readonly diagnostics: readonly RuntimeConfigDiagnostic[];
  readonly warnings: readonly string[];
}

// ---- service-level model provider registry (tasks #3534/#3537) ----

/** Lifecycle status for a model provider alias. */
export type ModelProviderStatus = 'active' | 'disabled' | 'archived';

/** Wire protocol the provider speaks. */
export type ModelProviderProtocol = 'responses' | 'chat_completions';

/**
 * Redacted credential status for a model provider. The backend never returns
 * the raw secret; `hasSecret` tells the UI whether a key is configured and
 * `secretRef`/`updatedAt` give provenance for intentional set/replace/clear.
 */
export interface ModelProviderCredential {
  readonly hasSecret: boolean;
  readonly secretRef?: string;
  readonly updatedAt?: string;
}

/**
 * A reusable model provider alias. Profiles reference it by `alias` instead
 * of embedding full model/provider config. Secrets are redacted on read.
 */
export interface ModelProviderRecord {
  readonly alias: string;
  readonly status: ModelProviderStatus;
  readonly protocol: ModelProviderProtocol;
  readonly providerKind: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly baseUrl?: string;
  readonly modelId: string;
  readonly contextWindowTokens?: number;
  readonly maxOutputTokens?: number;
  readonly temperatureMilli?: number;
  readonly reasoningEffort?: string;
  readonly reasoningFormat?: string;
  readonly credential: ModelProviderCredential;
  readonly metadataJson: unknown;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Query filters for the model provider list route. */
export interface ModelProviderQuery {
  readonly status?: ModelProviderStatus;
  readonly aliasPrefix?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Create/update body for a model provider (POST create, PATCH update by alias).
 * `secret` sets/replaces the API key; `clearSecret` removes it. `apiKey` is an
 * accepted alias for `secret` (backend compatibility). `expectedRevision`
 * guards concurrent PATCH edits.
 */
export interface ModelProviderWriteRequest {
  readonly alias?: string;
  readonly status?: ModelProviderStatus;
  readonly protocol: ModelProviderProtocol;
  readonly providerKind?: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly baseUrl?: string;
  readonly modelId: string;
  readonly contextWindowTokens?: number;
  readonly maxOutputTokens?: number;
  readonly temperatureMilli?: number;
  readonly reasoningEffort?: string;
  readonly reasoningFormat?: string;
  readonly secret?: string;
  readonly apiKey?: string;
  readonly clearSecret?: boolean;
  readonly metadataJson?: Record<string, unknown>;
  readonly expectedRevision?: number;
}
/**
 * Refresh mode applied after a provider write: `none` (no rebuild), `plan`
 * (prepare runtime rebuild plans for affected profiles), or `apply` (execute
 * the rebuilds). Sent as the `?refresh=` query param.
 */
export type ModelProviderRefreshMode = 'none' | 'plan' | 'apply';

/** One affected profile when refreshing after a provider write. */
export interface ModelProviderRefreshProfile {
  readonly profileId: string;
  readonly sessionIds: readonly string[];
  readonly configuredSessionIds: readonly string[];
  readonly activeSessionIds: readonly string[];
}

/** Per-profile outcome of a refresh plan/apply. */
export interface ModelProviderRefreshOutcome {
  readonly profileId: string;
  readonly status: 'planned' | 'applied' | 'blocked' | 'failed';
  readonly summary: string;
  readonly reasonCode?: string;
  readonly result?: unknown;
}

/** Refresh envelope returned alongside a created/updated provider. */
export interface ModelProviderRefreshResult {
  readonly mode: ModelProviderRefreshMode;
  readonly affectedProfiles: readonly ModelProviderRefreshProfile[];
  readonly outcomes: readonly ModelProviderRefreshOutcome[];
}

/** Response for a provider create/update (POST/PATCH). */
export interface ModelProviderWriteResponse {
  readonly provider: ModelProviderRecord;
  readonly refresh: ModelProviderRefreshResult;
}

/** Paginated list response for model providers. */
export interface ModelProviderPage {
  readonly items: readonly ModelProviderRecord[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}
