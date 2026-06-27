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
