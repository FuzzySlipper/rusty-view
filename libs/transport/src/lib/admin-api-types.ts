import type {
  AgentCorrelatedRound,
  AgentDirectoryEntry,
  AgentMessageDeliveryReceipt,
  AgentMessageInboxQuery,
  AgentMessageTrafficItem,
  AgentRouteRecord,
  AgentRouteResolution,
  AgentRouteWrite,
  ChatCompletionsDialect,
  ChatCompletionsPromptCaching,
  ChatCompletionsReasoningHistory,
  ChatCompletionsThinkingMode,
  ExternalMessageDeliveryPolicy,
  MemorySurfaceAvailability,
  MemorySurfaceCatalogItem,
  MemorySurfaceCatalogProjection,
  MemorySurfaceOwner,
  ProviderAdminModelProviderRecord,
  ProviderAdminModelProviderWrite,
  ResponsesProviderDialect,
  RuntimeActivityCensus,
  RuntimeActivityCensusSummary,
  RuntimeActivityFinding,
  RuntimeActivityFindingCode,
  RuntimeActivityKind,
  RuntimeActivityOwner,
  RuntimeActivityRecord,
  RuntimeActivityStatus,
  RuntimeActivityView,
  SessionWorkspaceUpdateRecord,
  TelegramDiplomatBinding,
  TelegramDiplomatBindingCreateRequest,
  TelegramDiplomatBindingData,
  TelegramDiplomatBindingMoveRequest,
  TelegramDiplomatBindingRelabelRequest,
  TelegramDiplomatBindingRevisionRequest,
  TelegramDiplomatCredentialUpdateRequest,
  TelegramDiplomatReadback,
} from '@rusty-view/protocol';

export type {
  MemorySurfaceAvailability,
  MemorySurfaceCatalogItem,
  MemorySurfaceCatalogProjection,
  MemorySurfaceOwner,
  RuntimeActivityCensus,
  RuntimeActivityCensusSummary,
  RuntimeActivityFinding,
  RuntimeActivityFindingCode,
  RuntimeActivityKind,
  RuntimeActivityOwner,
  RuntimeActivityRecord,
  RuntimeActivityStatus,
  RuntimeActivityView,
  ChatCompletionsPromptCaching,
  ResponsesProviderDialect,
  ExternalMessageDeliveryPolicy,
  TelegramDiplomatBinding,
  TelegramDiplomatBindingCreateRequest,
  TelegramDiplomatBindingData,
  TelegramDiplomatBindingMoveRequest,
  TelegramDiplomatBindingRelabelRequest,
  TelegramDiplomatBindingRevisionRequest,
  TelegramDiplomatCredentialUpdateRequest,
  TelegramDiplomatReadback,
};

export type CoordinationDeploymentRole = 'production' | 'debug';

export interface CoordinationAgentDirectory {
  readonly deploymentRole: CoordinationDeploymentRole;
  readonly agents: readonly AgentDirectoryEntry[];
}

/** Read-only coordination traffic filters and response used by the inspector. */
export type CoordinationMessageTrafficQuery = AgentMessageInboxQuery;

export interface CoordinationMessageTrafficResult {
  readonly deploymentRole: CoordinationDeploymentRole;
  readonly items: readonly AgentMessageTrafficItem[];
}

export interface CoordinationRouteList {
  readonly deploymentRole: CoordinationDeploymentRole;
  readonly routes: readonly AgentRouteResolution[];
}

export interface CoordinationRouteResult {
  readonly deploymentRole: CoordinationDeploymentRole;
  readonly route: AgentRouteRecord;
  readonly resolution?: AgentRouteResolution | null;
}

export interface CoordinationResolveResult {
  readonly deploymentRole: CoordinationDeploymentRole;
  readonly resolution: AgentRouteResolution;
}

export interface CoordinationDeliveryResult {
  readonly deploymentRole: CoordinationDeploymentRole;
  readonly targetAgentId: string;
  readonly deliveryId: string;
  readonly roundId?: string | null;
  readonly status: string;
  readonly terminalReason?: string | null;
  readonly delivery: AgentMessageDeliveryReceipt;
}

export interface CoordinationRoundResult {
  readonly deploymentRole: CoordinationDeploymentRole;
  readonly targetAgentId: string;
  readonly deliveryId: string;
  readonly roundId: string;
  readonly status: string;
  readonly terminalReason?: string | null;
  readonly delivery?: AgentMessageDeliveryReceipt;
  readonly round: AgentCorrelatedRound;
}

export type CoordinationRouteWriteRequest = Omit<AgentRouteWrite, 'updatedAt'>;

export interface CoordinationRouteTestRequest {
  readonly body: string;
  readonly ttlMs: number;
  readonly requireWake?: boolean;
  readonly correlationId?: string;
}

export interface CoordinationRoundRequest {
  readonly toAddress: string;
  readonly body: string;
  readonly ttlMs: number;
}

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

export type StorageQueryParameterType =
  | 'boolean'
  | 'enum'
  | 'integer'
  | 'string';

export interface StorageQueryParameter {
  readonly name: string;
  readonly type: StorageQueryParameterType;
  readonly required: boolean;
  readonly description: string;
  readonly enumValues?: readonly string[];
  readonly defaultValue?: unknown;
}

export interface StorageQueryModuleMetadata {
  readonly moduleId: string;
  readonly schemaVersion: number;
  readonly logicalStore: string;
  readonly ownerCrate: string;
  readonly ownerModule: string;
}

export interface StorageQueryDescriptor {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly owner: string;
  readonly readOnly: true;
  readonly backendAgnostic: boolean;
  readonly resultShape: string;
  readonly parameters: readonly StorageQueryParameter[];
  readonly module?: StorageQueryModuleMetadata;
}

export interface StorageQueryCatalog {
  readonly schema_version: 1;
  readonly source: string;
  readonly items: readonly StorageQueryDescriptor[];
  readonly total: number;
}

export type StorageQueryInput = Readonly<Record<string, unknown>>;

export interface StorageQueryResult<TItem = unknown, TData = unknown> {
  readonly query_id: string;
  readonly read_only: true;
  readonly source: string;
  readonly items?: readonly TItem[];
  readonly total?: number;
  readonly data?: TData;
  readonly limit?: number;
  readonly offset?: number;
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

export type RuntimeWakeTimeoutConfig =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'default'; readonly defaultMs: number };

export interface RuntimeConfigDraft {
  readonly profilesDir?: string;
  readonly skillsDir?: string;
  readonly wakeTimeout?: RuntimeWakeTimeoutConfig;
  readonly brains: readonly unknown[];
  readonly sessions: readonly unknown[];
  readonly scheduledJobs: readonly unknown[];
  readonly channelBindings: readonly unknown[];
  readonly mcpServers?: readonly unknown[];
  readonly mcpBindings: readonly unknown[];
}

export interface RuntimeConfigDraftRequest {
  readonly runtimeConfig: RuntimeConfigDraft;
  readonly reason?: string;
}

export interface RuntimeWakeTimeoutPatchRequest {
  readonly wakeTimeout: RuntimeWakeTimeoutConfig;
  readonly reason?: string;
}

export interface RuntimeWakeTimeoutPatchResult {
  readonly ok: true;
  readonly wakeTimeout: RuntimeWakeTimeoutConfig;
  readonly previousWakeTimeout?: RuntimeWakeTimeoutConfig;
  readonly preservedSections: Record<string, number | undefined>;
  readonly safeWritePath: {
    readonly capabilityId: string;
    readonly method: 'POST';
    readonly path: '/v1/admin/control/config/wake-timeout';
    readonly body?: string;
  };
  readonly applyResult: RuntimeConfigApplyResult;
}

export interface RuntimeConfigDraftPlan {
  readonly ok: boolean;
  readonly configPath: string;
  readonly diagnostics: readonly RuntimeConfigDiagnostic[];
  readonly implications: {
    readonly configReloadRequired: true;
    readonly createMissingSessions: false;
    readonly explicitChannelLifecycle: true;
    readonly explicitSessionLifecycle: true;
  };
  readonly runtimePlan?: unknown;
  readonly applyResult?: RuntimeConfigApplyResult;
}

export interface RuntimeConfigValidationReport {
  readonly ok: boolean;
  readonly configPath: string;
  readonly profilesDir?: string;
  /**
   * Service-level wake timeout policy from `service.json` when the backend
   * includes a config readback. Omitted means the service-wide wake ceiling is
   * disabled unless a profile/session override supplies an effective timeout.
   */
  readonly wakeTimeout?: {
    readonly mode?: 'disabled' | 'default' | string;
    readonly defaultMs?: number;
  };
  readonly runtimeConfig?: RuntimeConfigDraft;
  readonly serviceConfig?: RuntimeConfigDraft;
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

/**
 * Where a configured MCP server entry came from (task #3647). `env` is
 * compatibility/default config (e.g. `RUSTY_CREW_MCP_BASE_URL`); `runtime` is
 * an explicitly configured server. The frontend treats neither as special —
 * Den MCP is just one possible `env` or `runtime` server.
 */
export type AdminMcpServerSource = 'env' | 'runtime';

/**
 * A configured MCP server from the Crew catalog (`GET /v1/admin/mcp/servers`,
 * alias `/v1/admin/mcp/catalog`). Profiles bind to a server by `id`; the
 * frontend renders these as selectable choices instead of asking for a
 * free-form base URL.
 */
export interface AdminMcpServer {
  readonly id: string;
  readonly label?: string;
  readonly baseUrl: string;
  readonly transport: string;
  readonly requestTimeoutMs?: number;
  readonly source: AdminMcpServerSource;
  readonly configuredBindingCount: number;
}

/**
 * A current MCP runtime binding from the catalog (task #3647/#3649). Used for
 * read-only diagnostics: `endpointServerId` vs `resolvedServerId` distinguishes
 * explicit server bindings from compatibility fallback (e.g. a profile-derived
 * `endpointServerId` resolving to an `env-default` server). A divergence is not
 * an error by itself but is surfaced so operators can see the fallback.
 */
export interface AdminMcpBinding {
  readonly bindingId: string;
  readonly adapterId: string;
  readonly agentId: string;
  readonly sessionId?: string;
  readonly profileId: string;
  readonly endpointRef: string;
  readonly endpointServerId: string;
  readonly resolvedServerId: string;
  readonly transport: string;
  readonly toolProfileKey: string;
  readonly serverNames: readonly string[];
  readonly status: string;
  readonly degradedReason?: string;
}

/**
 * MCP server catalog response (task #3647). `servers` are the configured MCP
 * servers; `toolProfiles` are known tool profile keys from current runtime
 * bindings; `bindings` are current binding resolution details for diagnostics.
 */
export interface AdminMcpCatalog {
  readonly servers: readonly AdminMcpServer[];
  readonly toolProfiles: readonly string[];
  readonly bindings: readonly AdminMcpBinding[];
}

/**
 * A single MCP server binding for the create-profile request (task #3648).
 * Only `serverId` is required (sourced from the MCP catalog); the remaining
 * fields are advanced overrides that are omitted in the simple create flow.
 * Prefer `toolProfileKey` over the legacy `toolProfile` input spelling.
 */
export interface CreateProfileMcpBinding {
  readonly serverId: string;
  readonly bindingId?: string;
  readonly adapterId?: string;
  readonly serverNames?: readonly string[];
  readonly transport?: string;
  readonly toolProfileKey?: string;
}

/**
 * A built-in toolset from Crew's tool registry (task #3686). A toolset groups
 * one or more non-MCP, code-defined tools. Profiles opt in by id via
 * `toolPolicy.requestedToolsets`. `label`/`description` are optional human
 * readable hints; the frontend falls back to `id` when absent. Dynamic MCP
 * tool sets (`mcp:<toolProfileKey>`) are NOT part of this catalog — MCP tools
 * are selected separately through `mcpBindings`.
 */
export interface AdminToolsetDescriptor {
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
  readonly toolCount?: number;
  readonly tools?: readonly string[];
}

/**
 * A single built-in tool from Crew's tool registry (task #3686). Profiles may
 * request individual tools by `name` via `toolPolicy.requestedTools` in
 * addition to whole toolsets. `toolsets` lists the toolsets that include this
 * tool (informational).
 */
export interface AdminToolDescriptor {
  readonly name: string;
  readonly label?: string;
  readonly description?: string;
  readonly toolsets?: readonly string[];
}

/**
 * Built-in tool catalog response (task #3686). Exposes the valid non-MCP
 * toolsets/tools from Crew's tool registry so the frontend can offer a
 * selectable menu instead of hardcoding registry contents. Excludes dynamic
 * `mcp:<toolProfileKey>` sets.
 */
export interface AdminToolCatalog {
  readonly toolsets: readonly AdminToolsetDescriptor[];
  readonly tools: readonly AdminToolDescriptor[];
}

/**
 * Inline built-in (non-MCP) tool policy for the create-profile request (task
 * #3686). `requestedToolsets`/`requestedTools` opt into raw toolsets/tools from
 * Crew's catalog. This is the advanced/custom path; the preferred path is to
 * reference a reusable local tool profile via the top-level `localToolProfileId`
 * on {@link CreateAdminProfileRequest} (task #3689) instead.
 *
 * Omit entirely for a profile with no inline built-in tools. Independent of
 * `mcpBindings` — MCP tools are never expressed here.
 */
export interface CreateProfileToolPolicy {
  readonly requestedToolsets?: readonly string[];
  readonly requestedTools?: readonly string[];
}

/**
 * A DB-backed local tool profile (task #3689 / Crew #3688): a reusable, named
 * selection of built-in (non-MCP) toolsets/tools that profiles can reference by
 * `id`. `system`/`readOnly` reflect backend-managed or immutable profiles;
 * `diagnostics` surface stale/invalid toolset/tool references reported by
 * backend validation. MCP servers are never part of a local tool profile.
 */
export interface AdminLocalToolProfile {
  readonly id: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly system: boolean;
  readonly readOnly: boolean;
  readonly requestedToolsets: readonly string[];
  readonly requestedTools: readonly string[];
  readonly revision?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly diagnostics?: readonly RuntimeConfigDiagnostic[];
}

/**
 * List response for local tool profiles (task #3689). `profiles` are the
 * configured local tool profiles; backends that have not shipped the route
 * yield `null` at the transport layer so the UI degrades to an empty state.
 */
export interface AdminLocalToolProfileList {
  readonly profiles: readonly AdminLocalToolProfile[];
}

/**
 * Create/update body for a local tool profile (task #3689). `id` is accepted on
 * create when the backend allows caller-supplied ids; omitted/ignored on
 * update. `expectedRevision` guards concurrent updates. Omitted fields keep
 * their current value on update.
 */
export interface AdminLocalToolProfileWriteRequest {
  readonly id?: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly requestedToolsets?: readonly string[];
  readonly requestedTools?: readonly string[];
  readonly expectedRevision?: number;
}

export interface CreateAdminProfileRequest {
  readonly profileId: string;
  readonly displayName?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly implementationId?: string;
  readonly kind?: 'full' | 'worker' | 'delegated';
  /**
   * Explicit MCP server bindings (task #3648). Omit for a profile with no MCP
   * tools. Each binding requires `serverId` from the MCP catalog; optional
   * fields default on the backend. Preferred over the legacy
   * `mcpToolProfile` free-form string for new UI paths.
   */
  readonly mcpBindings?: readonly CreateProfileMcpBinding[];
  /**
   * Reference to a reusable DB-backed local tool profile (task #3689). This is
   * the preferred create-flow shape: operators pick a named local tool profile
   * instead of low-level toolset/tool arrays. Crew expects this at the top
   * level (sibling of `toolPolicy`), not nested inside it. Mutually exclusive
   * with an inline `toolPolicy` in the create UI.
   */
  readonly localToolProfileId?: string;
  /**
   * Inline built-in (non-MCP) tool policy (task #3686). Selected from Crew's
   * tool catalog as an advanced/custom path. Omit when referencing a
   * `localToolProfileId` or for a profile with no built-in tools. Kept separate
   * from `mcpBindings`; MCP tools are never expressed here.
   */
  readonly toolPolicy?: CreateProfileToolPolicy;
  /**
   * Legacy free-form MCP tool profile string. Superseded by `mcpBindings`
   * (task #3648); retained only as an advanced/import compatibility affordance.
   */
  readonly mcpToolProfile?: string;
  /**
   * Reference to a reusable model provider alias (task #3534/#3538). Preferred
   * over `modelConfig` for profiles that should reuse a configured provider.
   * When set, the backend resolves model/provider config from the alias and
   * omits inline `modelConfig` from the created profile.
   */
  readonly providerAlias?: string;
  /**
   * Optional DB-backed profile soul prompt. Omit to let the backend default or
   * imported profile data stand; send a non-empty string to seed prompt.soul at
   * create time.
   */
  readonly soulMarkdown?: string;
  /**
   * Optional DB-backed profile memory prompt. Currently not surfaced in the
   * create UI, but accepted by Crew and exposed for generated/template flows.
   */
  readonly memoryMarkdown?: string;
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
  readonly status: 'completed' | 'blocked' | 'failed';
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

export interface SessionWorkspaceChangeRequest {
  readonly cwd: string;
  readonly expectedRevision: number;
}

export type SessionWorkspaceChangeResult = SessionWorkspaceUpdateRecord;

export interface ProfileBrainRebuildRequest {
  readonly reason?: string;
}

export interface ProfileDeleteRequest {
  readonly reason?: string;
  readonly confirmProfileId: string;
}

export interface ProfileBrainRebuildResult {
  readonly profileId?: string;
  readonly status?: 'planned' | 'completed' | 'blocked' | 'failed';
  readonly summary?: string;
  readonly sessionIds?: readonly string[];
  readonly affectedSessionIds?: readonly string[];
  readonly configuredSessionIds?: readonly string[];
  readonly activeSessionIds?: readonly string[];
  readonly blockedSessionIds?: readonly string[];
  readonly blockedInFlightWakeIds?: readonly string[];
  readonly sessionIdsPreserved?: boolean;
  readonly sessionHistoryPreserved?: boolean;
  readonly mcpRefresh?: unknown;
  readonly reasonCode?: string;
  readonly [key: string]: unknown;
}

export interface ProfilePurgeTableCount {
  readonly table: string;
  readonly rowsDeleted: number;
}

export interface ProfilePurgeReport {
  readonly profileId: string;
  readonly profileRegistryDeleted: boolean;
  readonly sessionIds: readonly string[];
  readonly agentIds: readonly string[];
  readonly tableCounts: readonly ProfilePurgeTableCount[];
  readonly rowsDeleted: number;
}

export interface ProfileDeleteResult {
  readonly profileId?: string;
  readonly confirmProfileId?: string;
  readonly profilePath?: string;
  readonly profileDirectoryDeleted?: boolean;
  readonly runtimeConfigReloaded?: boolean;
  readonly storagePurge?: ProfilePurgeReport;
  readonly [key: string]: unknown;
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
  /**
   * Current model provider alias the profile references (task #3742), when it
   * uses a configured provider alias rather than inline model config. Used to
   * seed the Edit window's provider control.
   */
  readonly providerAlias?: string;
  /**
   * Profile policy used when Crew creates a managed external binding. Existing
   * bindings retain their concrete policy until explicitly replaced.
   */
  readonly externalMessageDeliveryPolicy: ExternalMessageDeliveryPolicy;
  /**
   * Current reusable local tool profile id the profile references (task #3742),
   * when its built-in tool policy comes from a named local tool profile rather
   * than inline toolsets/tools. Seeds the Edit window's tool control.
   */
  readonly localToolProfileId?: string;
  /**
   * Current effective built-in (non-MCP) tool policy (task #3742). When
   * `localToolProfileId` is set this is the policy that profile supplies;
   * otherwise it reflects inline toolset/tool selections.
   */
  readonly toolPolicy?: ProfileRuntimeToolPolicy;
  /**
   * Current configured MCP server bindings for the profile (task #3742). Seeds
   * the Edit window's MCP binding control. Distinct from the resolution
   * diagnostics in {@link AdminMcpBinding}.
   */
  readonly mcpBindings?: readonly AdminProfileRuntimeMcpBinding[];
  /**
   * Current context-strategy policy for the profile (task #3849). Seeds the
   * Edit window's context-policy controls. Absent on backends that predate the
   * context-strategy contract.
   */
  readonly contextPolicy?: ContextStrategyPolicy;
  /**
   * DB-backed static prompt text for the profile's soul (long-form
   * persona/instruction text). Only populated for registry-backed records;
   * file-backed fallback records omit this (prompt text lives in
   * `soul.md`).
   */
  readonly promptSoulMarkdown?: string;
  /**
   * DB-backed static prompt text for the profile's memory (static prompt
   * notes). Only populated for registry-backed records; file-backed fallback
   * records omit this (prompt text lives in `memory.md`).
   */
  readonly promptMemoryMarkdown?: string;
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
 * Effective built-in (non-MCP) tool policy reported on a registry record
 * (task #3742). Mirrors Crew's read shape; `requestedToolsets`/`requestedTools`
 * are the granted built-ins, `deniedTools` are explicit exclusions, and
 * `includeDeprecated` toggles deprecated tools.
 */
export interface ProfileRuntimeToolPolicy {
  readonly requestedToolsets?: readonly string[];
  readonly requestedTools?: readonly string[];
  readonly deniedTools?: readonly string[];
  readonly includeDeprecated?: boolean;
}

/**
 * A configured MCP server binding reported on a registry record (task #3742).
 * Structurally matches {@link CreateProfileMcpBinding} but represents the
 * profile's current bindings rather than a create request.
 */
export interface AdminProfileRuntimeMcpBinding {
  readonly serverId: string;
  readonly bindingId?: string;
  readonly adapterId?: string;
  readonly serverNames?: readonly string[];
  readonly transport?: string;
  readonly toolProfileKey?: string;
}

// ---- context strategy catalog + policy (task #3849) ----

/** How verbose the context debug surface is for a session/profile. */
export type ContextDebugVisibility = 'off' | 'status' | 'verbose';

/**
 * A profile/session context-strategy policy (task #3849). Mirrors Crew's
 * camelCase wire shape exactly. `strategyId` is intentionally typed as a plain
 * string (not a closed union): valid ids come from the strategy catalog
 * (`GET /v1/admin/context-strategies`), never hardcoded in the frontend.
 */
export interface ContextStrategyPolicy {
  readonly enabled: boolean;
  readonly strategyId: string;
  readonly autoCompactionEnabled: boolean;
  readonly compactAtPercent: number;
  readonly targetPercentAfterCompaction: number;
  readonly maxContextPercentForWake: number;
  readonly debugVisibility: ContextDebugVisibility;
  readonly includeDebugEventsInModelContext: boolean;
  readonly strategyConfig: Record<string, unknown>;
}

/**
 * One selectable context strategy from the catalog (task #3849). `status`
 * distinguishes shipped strategies from planned ones; `supportsAutoCompaction`
 * gates the auto-compaction control.
 */
export interface ContextStrategyDescriptor {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly status: 'active' | 'planned';
  readonly supportsAutoCompaction: boolean;
  readonly modelFacingDebugDefault: false;
}

/**
 * Context strategy catalog response (`GET /v1/admin/context-strategies`, task
 * #3849). The UI drives strategy selection from `strategies`/`defaultStrategyId`
 * and seeds new policies from `policyDefaults` instead of hardcoding ids or
 * thresholds. `percentRange` bounds the percent controls.
 */
export interface ContextStrategyCatalog {
  readonly schemaVersion: 1;
  readonly defaultStrategyId: string;
  readonly policyDefaults: ContextStrategyPolicy;
  readonly strategies: readonly ContextStrategyDescriptor[];
  readonly percentRange: { readonly min: number; readonly max: number };
}

/**
 * Body for the registry runtime-config plan/apply routes (task #3742): change a
 * profile's provider and/or built-in tools and/or MCP bindings on an existing
 * profile, rebuilding the runtime without creating a new session.
 *
 * Field semantics (per Crew contract):
 * - `expectedRevision` is required (optimistic concurrency).
 * - `providerAlias`: set to a configured alias; `null` clears; omit to keep.
 * - `localToolProfileId`: when set it wins and supplies the effective tool
 *   policy; `null` clears the reference so inline `toolPolicy` applies; omit to
 *   keep current.
 * - `toolPolicy`: inline built-in toolsets/tools, used when no
 *   `localToolProfileId` is in effect.
 * - `mcpBindings`: replaces the profile's current bindings on apply; omit to
 *   preserve current bindings, send `[]` to clear them.
 */
export interface ProfileRegistryRuntimeConfigRequest {
  readonly expectedRevision: number;
  /**
   * Policy for new managed external bindings. A runtime-config write always
   * sends the effective value so omission cannot silently reset it.
   */
  readonly externalMessageDeliveryPolicy: ExternalMessageDeliveryPolicy;
  readonly providerAlias?: string | null;
  readonly localToolProfileId?: string | null;
  readonly toolPolicy?: CreateProfileToolPolicy;
  readonly mcpBindings?: readonly CreateProfileMcpBinding[];
  /**
   * Context-strategy policy to apply (task #3849). Omit to keep the profile's
   * current policy. Invalid values (e.g. an unknown `strategyId`) come back as
   * plan diagnostics at path `contextPolicy.*` rather than applying.
   */
  readonly contextPolicy?: ContextStrategyPolicy;
}

/**
 * The effective editable runtime config echoed back on a runtime-config plan
 * (task #3742): the resolved provider/tool/MCP state after the requested
 * change. Used for confirmation/preview.
 */
export interface EditableProfileRuntimeConfig {
  readonly providerAlias: string;
  readonly externalMessageDeliveryPolicy: ExternalMessageDeliveryPolicy;
  readonly brain?: { readonly module?: string; readonly strategy?: string };
  readonly localToolProfileId?: string;
  readonly toolPolicy?: ProfileRuntimeToolPolicy;
  readonly mcpBindings: readonly AdminProfileRuntimeMcpBinding[];
  /** Resolved context-strategy policy after the requested change (task #3849). */
  readonly contextPolicy?: ContextStrategyPolicy;
}

/**
 * Implications block for a runtime-config write (task #3742). Distinct from the
 * field-update/lifecycle implications: a runtime-config change may rewrite the
 * profile file and service config and always requires a config reload.
 */
export interface ProfileRegistryRuntimeConfigImplications {
  readonly registryRevisionWillIncrement: true;
  readonly profileFileWillChange: boolean;
  readonly serviceConfigWillChange: boolean;
  readonly configReloadRequired: true;
  readonly runtimeRebuildRecommended: boolean;
  readonly mcpRefreshRecommended: boolean;
  /** True when an existing external binding must be explicitly replaced. */
  readonly externalBindingRebuildRecommended: boolean;
}

/**
 * Plan for a runtime-config change (task #3742). Unlike the
 * {@link ProfileRegistryWritePlan} family this has no `kind`, and carries the
 * resolved `runtimeConfig` plus a runtime-config-specific `implications` block.
 * `nextWrite` is the backend's persisted-write projection and is opaque to the
 * UI.
 */
export interface ProfileRegistryRuntimeConfigPlan {
  readonly ok: boolean;
  readonly profileId: string;
  readonly mode: 'plan' | 'apply';
  readonly expectedRevision: number;
  readonly current: AdminProfileRegistryRecord;
  readonly next: AdminProfileRegistryRecord;
  readonly nextWrite: unknown;
  readonly runtimeConfig: EditableProfileRuntimeConfig;
  readonly diagnostics: readonly ProfileRegistryWriteDiagnostic[];
  readonly implications: ProfileRegistryRuntimeConfigImplications;
}

/** Runtime side effects of a runtime-config apply (task #3742). */
export interface ProfileRegistryRuntimeConfigEffects {
  readonly profilePath: string;
  readonly runtimeConfigPath: string;
  readonly mcpBindings: { readonly removed: number; readonly added: number };
  readonly externalBindingRebuildRecommended: boolean;
  readonly applyResult: unknown;
}

/**
 * A successful runtime-config apply (task #3742): the plan plus `applied: true`,
 * the persisted `record` (bumped revision), and runtime `effects`.
 */
export interface ProfileRegistryRuntimeConfigAppliedResult
  extends ProfileRegistryRuntimeConfigPlan {
  readonly applied: true;
  readonly record: AdminProfileRegistryRecord;
  readonly effects?: ProfileRegistryRuntimeConfigEffects;
}

/**
 * Apply result for a runtime-config write (task #3742): either the applied
 * result or, when the plan is not `ok` (e.g. revision mismatch), the
 * non-applied plan (no `applied` field).
 */
export type ProfileRegistryRuntimeConfigApplyResult =
  | ProfileRegistryRuntimeConfigAppliedResult
  | ProfileRegistryRuntimeConfigPlan;

/**
 * Body for the registry lifecycle plan/apply routes (#3521). `lifecycleStatus`
 * is the target status. `expectedRevision` is required for optimistic concurrency.
 */
export interface ProfileRegistryLifecycleRequest {
  readonly expectedRevision: number;
  readonly lifecycleStatus: ProfileRegistryLifecycleStatus;
}

/**
 * Body for the profile registry prompt plan/apply routes (task #3555).
 * `soulMarkdown`/`memoryMarkdown` are the new prompt text values.
 * - Missing fields: no change.
 * - `null`: clear the field.
 * - Empty string `""`: valid markdown content; sent as a string, not
 *   coerced to null.
 *
 * The plan/apply responses reuse {@link ProfileRegistryWritePlan} /
 * {@link ProfileRegistryWriteApplyResult}.
 */
export interface ProfileRegistryPromptRequest {
  readonly expectedRevision: number;
  readonly soulMarkdown?: string | null;
  readonly memoryMarkdown?: string | null;
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
  readonly kind: 'update' | 'lifecycle' | 'prompt';
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

/** Redacted credential auth kind reported by Crew. */
export type ModelProviderCredentialKind =
  | 'api_key'
  | 'openai_oauth'
  | 'legacy_raw_api_key';

/** Redacted credential state; older Crew builds omit this field. */
export type ModelProviderCredentialStatus =
  | 'configured'
  | 'missing'
  | 'expired'
  | 'refresh_needed';

/**
 * Redacted credential status for a model provider. The backend never returns
 * the raw secret; `hasSecret` tells the UI whether a key is configured and
 * `secretRef`/`updatedAt` give provenance for intentional set/replace/clear.
 */
export interface ModelProviderCredential {
  readonly hasSecret: boolean;
  readonly secretRef?: string;
  readonly updatedAt?: string;
  readonly kind?: ModelProviderCredentialKind;
  readonly status?: ModelProviderCredentialStatus;
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
  readonly responsesDialect?: ProviderAdminModelProviderRecord['responsesDialect'];
  /** Explicit Crew policy; older service responses may omit it and mean disabled. */
  readonly promptCaching?: ChatCompletionsPromptCaching;
  readonly chatCompletionsDialect: ProviderAdminModelProviderRecord['chatCompletionsDialect'];
  readonly thinkingMode: ProviderAdminModelProviderRecord['thinkingMode'];
  readonly reasoningHistory: ProviderAdminModelProviderRecord['reasoningHistory'];
  readonly reasoningBudgetTokens?: ProviderAdminModelProviderRecord['reasoningBudgetTokens'];
  /** Service-scoped credential identity linked to this alias, when configured. */
  readonly credentialId?: string;
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
  readonly temperatureMilli?: number | null;
  readonly reasoningEffort?: string;
  readonly reasoningFormat?: string;
  readonly responsesDialect?: ProviderAdminModelProviderWrite['responsesDialect'];
  readonly promptCaching?: ChatCompletionsPromptCaching;
  readonly chatCompletionsDialect?: ProviderAdminModelProviderWrite['chatCompletionsDialect'];
  readonly thinkingMode?: ProviderAdminModelProviderWrite['thinkingMode'];
  readonly reasoningHistory?: ProviderAdminModelProviderWrite['reasoningHistory'];
  readonly reasoningBudgetTokens?: ProviderAdminModelProviderWrite['reasoningBudgetTokens'];
  readonly secret?: string;
  readonly apiKey?: string;
  readonly credentialSecret?: ModelProviderCredentialSecretInput;
  readonly clearSecret?: boolean;
  readonly metadataJson?: Record<string, unknown>;
  readonly expectedRevision?: number;
}

export type {
  ChatCompletionsDialect,
  ChatCompletionsReasoningHistory,
  ChatCompletionsThinkingMode,
};

/** Explicit typed credential write for provider setup. Do not use for raw OAuth bundles in UI. */
export type ModelProviderCredentialSecretInput =
  | {
      readonly kind: 'api_key';
      readonly version?: 1;
      readonly value: string;
    }
  | {
      readonly kind: 'openai_oauth';
      readonly version?: 1;
      readonly issuer: string;
      readonly clientId: string;
      readonly idToken: string;
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly exchangedApiToken?: string;
      readonly lastRefreshAt?: string;
      readonly accountId?: string;
      readonly email?: string;
      readonly planType?: string;
      readonly isFedrampAccount?: boolean;
      readonly accessTokenExpiresAt?: string;
    };
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

// ---- service-scoped credential registry (tasks rusty-crew #5894/#5895) ----

/** Redacted reusable credential record. Secret material never appears here. */
export interface ServiceCredentialRecord {
  readonly credentialId: string;
  readonly displayName: string;
  readonly providerKind: string;
  readonly credentialKind: ModelProviderCredentialKind;
  readonly credential: ModelProviderCredential;
  readonly linkedProviderAliases: readonly string[];
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ServiceCredentialQuery {
  readonly providerKind?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ServiceCredentialPage {
  readonly items: readonly ServiceCredentialRecord[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface ServiceCredentialWriteRequest {
  readonly credentialId?: string;
  readonly displayName?: string;
  readonly providerKind?: string;
  readonly credentialKind?: Exclude<
    ModelProviderCredentialKind,
    'legacy_raw_api_key'
  >;
  readonly secret?: string;
  readonly clearSecret?: boolean;
  readonly expectedRevision?: number;
}

export interface ServiceCredentialWriteResponse {
  readonly credential: ServiceCredentialRecord;
}

export interface ServiceCredentialDeleteResponse {
  readonly deleted: true;
  readonly credential: ServiceCredentialRecord;
}

export interface ServiceCredentialImpact {
  readonly credential: ServiceCredentialRecord;
  readonly linkedProviderAliases: readonly string[];
  readonly linkedProviders: readonly ModelProviderRecord[];
  readonly canClear: boolean;
  readonly canDelete: boolean;
}

export interface ModelProviderCredentialLinkRequest {
  readonly credentialId: string;
  readonly expectedProviderRevision?: number;
  readonly expectedCredentialRevision?: number;
}

export interface ModelProviderCredentialUnlinkRequest {
  readonly expectedProviderRevision?: number;
}

export interface ModelProviderCredentialLinkResponse {
  readonly provider: ModelProviderRecord;
  readonly credential: ServiceCredentialRecord;
}

export interface ModelProviderCredentialUnlinkResponse {
  readonly provider: ModelProviderRecord;
}

// ---- OpenAI OAuth provider credential setup ----

export interface OpenAiOauthPendingLogin {
  readonly pendingLoginId: string;
  readonly credentialId?: string;
  readonly providerAlias?: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly codeChallenge: string;
  readonly authorizationUrl: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface OpenAiOauthStartRequest {
  readonly issuer?: string;
  readonly clientId?: string;
  readonly redirectUri?: string;
  readonly scopes?: readonly string[];
  readonly allowedWorkspaceIds?: readonly string[];
  readonly originator?: string;
}

export interface OpenAiOauthLoginConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly redirectUriOverrideAllowed: boolean;
  readonly redirectUriMode: string;
  readonly callbackUrlCompletionAccepted: boolean;
  readonly callbackUrlCompletionField: string;
  readonly pendingLoginIdRequiredForCallbackUrl: boolean;
  readonly remoteOperatorFlow: string;
}

export interface OpenAiOauthStartResponse {
  readonly provider: ModelProviderRecord;
  readonly loginConfig: OpenAiOauthLoginConfig;
  readonly pendingLogin: OpenAiOauthPendingLogin;
}

export interface OpenAiOauthStatusResponse {
  readonly provider: ModelProviderRecord;
  readonly credential: ModelProviderCredential;
  readonly loginConfig?: OpenAiOauthLoginConfig;
  readonly pendingLogins: readonly OpenAiOauthPendingLogin[];
}

export interface OpenAiOauthFakeTokenResponse {
  readonly idToken: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly exchangedApiToken?: string;
  readonly lastRefreshAt?: string;
  readonly accountId?: string;
  readonly email?: string;
  readonly planType?: string;
  readonly isFedrampAccount?: boolean;
  readonly accessTokenExpiresAt?: string;
}

export interface OpenAiOauthCompleteRequest {
  readonly callbackUrl?: string;
  readonly authorizationResponseUrl?: string;
  readonly pendingLoginId?: string;
  readonly state?: string;
  readonly code?: string;
  readonly expectedRevision?: number;
  readonly testMode?: boolean;
  readonly fakeTokenResponse?: OpenAiOauthFakeTokenResponse;
}

export interface OpenAiOauthCompleteResponse {
  readonly provider: ModelProviderRecord;
  readonly credential: ModelProviderCredential;
  readonly completionMode: 'real' | 'test';
  readonly oauthSummary?: unknown;
  readonly pendingLoginId: string;
}

export interface OpenAiOauthClearRequest {
  readonly expectedRevision?: number;
}

export interface OpenAiOauthClearResponse {
  readonly provider: ModelProviderRecord;
  readonly credential: ModelProviderCredential;
}

/** Credential-scoped OAuth status; unlike the compatibility route it has no provider wrapper. */
export interface ServiceCredentialOpenAiOauthStatusResponse {
  readonly credential: ServiceCredentialRecord;
  readonly loginConfig?: OpenAiOauthLoginConfig;
  readonly pendingLogins: readonly OpenAiOauthPendingLogin[];
}

export interface ServiceCredentialOpenAiOauthStartResponse {
  readonly credential: ServiceCredentialRecord;
  readonly loginConfig: OpenAiOauthLoginConfig;
  readonly pendingLogin: OpenAiOauthPendingLogin;
}

export interface ServiceCredentialOpenAiOauthCompleteResponse {
  readonly credential: ServiceCredentialRecord;
  readonly completionMode: 'real' | 'test';
  readonly oauthSummary?: unknown;
  readonly pendingLoginId: string;
}

export interface ServiceCredentialOpenAiOauthClearResponse {
  readonly credential: ServiceCredentialRecord;
}
