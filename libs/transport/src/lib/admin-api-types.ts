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
