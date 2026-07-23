import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import {
  ChatTransport,
  ChatTransportError,
  type AdminDiagnosticsBundle,
  type AdminPage,
  type RuntimeSessionDiagnostics,
  type AdminAgentDiagnostics,
  type McpSurfaceDiagnostics,
  type RuntimeConfigValidationReport,
  type ApiCapabilityRegistry,
  type AdminProfileRegistryDiagnostics,
  type AdminMcpCatalog,
  type AdminToolCatalog,
  type AdminLocalToolProfile,
  type AdminLocalToolProfileList,
  type AdminLocalToolProfileWriteRequest,
  type AdminControlResponse,
  type CreatedServiceProfile,
  type ContextStrategyCatalog,
  type ModelProviderPage,
  type ModelProviderRecord,
  type ModelProviderWriteRequest,
  type ModelProviderWriteResponse,
  type ModelProviderCredentialLinkRequest,
  type ModelProviderCredentialLinkResponse,
  type ModelProviderCredentialUnlinkResponse,
  type OpenAiOauthClearResponse,
  type OpenAiOauthCompleteRequest,
  type OpenAiOauthCompleteResponse,
  type OpenAiOauthStartRequest,
  type OpenAiOauthStartResponse,
  type OpenAiOauthStatusResponse,
  type ServiceCredentialDeleteResponse,
  type ServiceCredentialImpact,
  type ServiceCredentialOpenAiOauthClearResponse,
  type ServiceCredentialOpenAiOauthCompleteResponse,
  type ServiceCredentialOpenAiOauthStartResponse,
  type ServiceCredentialOpenAiOauthStatusResponse,
  type ServiceCredentialPage,
  type ServiceCredentialRecord,
  type ServiceCredentialWriteRequest,
  type ServiceCredentialWriteResponse,
  type RuntimeBrainModuleDiagnostics,
  type RuntimeActivityCensus,
  type RuntimeConfigApplyResult,
  type RuntimePauseControlRequest,
  type RuntimePauseControlResult,
  type RuntimePauseScope,
  type RuntimeResumeNoopResult,
  type RuntimeWakeTimeoutPatchRequest,
  type RuntimeWakeTimeoutPatchResult,
  type ProfileDeleteRequest,
  type ProfileDeleteResult,
  type ProfileRegistryFieldUpdateRequest,
  type ProfileRegistryWriteApplyResult,
  type ProfileRegistryWritePlan,
  type StorageQueryCatalog,
  type StorageQueryResult,
} from '@rusty-view/transport';

import { AdminStore } from './admin-store';

interface AdminTransportMock {
  readonly adminDiagnostics: ReturnType<
    typeof vi.fn<() => Promise<AdminDiagnosticsBundle>>
  >;
  readonly adminSessions: ReturnType<
    typeof vi.fn<() => Promise<AdminPage<RuntimeSessionDiagnostics>>>
  >;
  readonly adminAgents: ReturnType<
    typeof vi.fn<() => Promise<AdminPage<AdminAgentDiagnostics>>>
  >;
  readonly adminActivities: ReturnType<
    typeof vi.fn<
      (query?: {
        readonly sessionProjection?: 'service' | 'durable';
      }) => Promise<RuntimeActivityCensus | null>
    >
  >;
  readonly adminMcpSurfaces: ReturnType<
    typeof vi.fn<() => Promise<AdminPage<McpSurfaceDiagnostics>>>
  >;
  readonly adminConfigValidation: ReturnType<
    typeof vi.fn<() => Promise<RuntimeConfigValidationReport | null>>
  >;
  readonly adminCapabilities: ReturnType<
    typeof vi.fn<() => Promise<ApiCapabilityRegistry>>
  >;
  readonly adminProfileDiagnostics: ReturnType<
    typeof vi.fn<() => Promise<AdminProfileRegistryDiagnostics>>
  >;
  readonly adminMcpCatalog: ReturnType<
    typeof vi.fn<() => Promise<AdminMcpCatalog>>
  >;
  readonly adminToolCatalog: ReturnType<
    typeof vi.fn<() => Promise<AdminToolCatalog>>
  >;
  readonly adminLocalToolProfiles: ReturnType<
    typeof vi.fn<() => Promise<AdminLocalToolProfileList>>
  >;
  readonly adminContextStrategies: ReturnType<
    typeof vi.fn<() => Promise<ContextStrategyCatalog>>
  >;
  readonly adminModelProviders: ReturnType<
    typeof vi.fn<() => Promise<ModelProviderPage>>
  >;
  readonly adminServiceCredentials: ReturnType<
    typeof vi.fn<() => Promise<ServiceCredentialPage>>
  >;
  readonly createAdminServiceCredential: ReturnType<
    typeof vi.fn<
      (
        request: ServiceCredentialWriteRequest & {
          readonly credentialId: string;
        },
      ) => Promise<ServiceCredentialWriteResponse>
    >
  >;
  readonly adminServiceCredentialImpact: ReturnType<
    typeof vi.fn<(credentialId: string) => Promise<ServiceCredentialImpact>>
  >;
  readonly clearAdminServiceCredential: ReturnType<
    typeof vi.fn<
      (
        credentialId: string,
        expectedRevision?: number,
      ) => Promise<ServiceCredentialWriteResponse>
    >
  >;
  readonly deleteAdminServiceCredential: ReturnType<
    typeof vi.fn<
      (
        credentialId: string,
        expectedRevision?: number,
      ) => Promise<ServiceCredentialDeleteResponse>
    >
  >;
  readonly linkAdminModelProviderCredential: ReturnType<
    typeof vi.fn<
      (
        alias: string,
        request: { readonly credentialId: string },
      ) => Promise<ModelProviderCredentialLinkResponse>
    >
  >;
  readonly unlinkAdminModelProviderCredential: ReturnType<
    typeof vi.fn<
      (alias: string) => Promise<ModelProviderCredentialUnlinkResponse>
    >
  >;
  readonly adminServiceCredentialOpenAiOauthStatus: ReturnType<
    typeof vi.fn<
      (
        credentialId: string,
      ) => Promise<ServiceCredentialOpenAiOauthStatusResponse>
    >
  >;
  readonly adminStartServiceCredentialOpenAiOauthLogin: ReturnType<
    typeof vi.fn<
      (
        credentialId: string,
        request?: OpenAiOauthStartRequest,
      ) => Promise<ServiceCredentialOpenAiOauthStartResponse>
    >
  >;
  readonly adminCompleteServiceCredentialOpenAiOauthLogin: ReturnType<
    typeof vi.fn<
      (
        credentialId: string,
        request: OpenAiOauthCompleteRequest,
      ) => Promise<ServiceCredentialOpenAiOauthCompleteResponse>
    >
  >;
  readonly adminClearServiceCredentialOpenAiOauth: ReturnType<
    typeof vi.fn<
      (
        credentialId: string,
        expectedRevision?: number,
      ) => Promise<ServiceCredentialOpenAiOauthClearResponse>
    >
  >;
  readonly adminStorageQueryCatalog: ReturnType<
    typeof vi.fn<() => Promise<StorageQueryCatalog>>
  >;
  readonly adminStorageQuery: ReturnType<
    typeof vi.fn<
      (
        queryId: string,
        input?: Record<string, unknown>,
      ) => Promise<StorageQueryResult>
    >
  >;
  readonly adminCreateLocalToolProfile: ReturnType<
    typeof vi.fn<
      (
        request: AdminLocalToolProfileWriteRequest,
      ) => Promise<AdminLocalToolProfile>
    >
  >;
  readonly adminUpdateLocalToolProfile: ReturnType<
    typeof vi.fn<
      (
        id: string,
        request: AdminLocalToolProfileWriteRequest,
      ) => Promise<AdminLocalToolProfile>
    >
  >;
  readonly adminDeleteLocalToolProfile: ReturnType<
    typeof vi.fn<(id: string) => Promise<void>>
  >;
  readonly planAdminProfileRegistryUpdate: ReturnType<
    typeof vi.fn<
      (
        profileId: string,
        request: ProfileRegistryFieldUpdateRequest,
      ) => Promise<ProfileRegistryWritePlan>
    >
  >;
  readonly applyAdminProfileRegistryUpdate: ReturnType<
    typeof vi.fn<
      (
        profileId: string,
        request: ProfileRegistryFieldUpdateRequest,
      ) => Promise<ProfileRegistryWriteApplyResult>
    >
  >;
  readonly createAdminProfile: ReturnType<
    typeof vi.fn<
      (request: {
        readonly profileId: string;
      }) => Promise<AdminControlResponse<CreatedServiceProfile>>
    >
  >;
  readonly deleteAdminProfile: ReturnType<
    typeof vi.fn<
      (
        profileId: string,
        request: ProfileDeleteRequest,
      ) => Promise<AdminControlResponse<ProfileDeleteResult>>
    >
  >;
  readonly createAdminModelProvider: ReturnType<
    typeof vi.fn<
      (
        request: ModelProviderWriteRequest,
        refresh: string,
      ) => Promise<ModelProviderWriteResponse>
    >
  >;
  readonly updateAdminModelProvider: ReturnType<
    typeof vi.fn<
      (
        alias: string,
        request: ModelProviderWriteRequest,
        refresh: string,
      ) => Promise<ModelProviderWriteResponse>
    >
  >;
  readonly adminOpenAiOauthStatus: ReturnType<
    typeof vi.fn<(alias: string) => Promise<OpenAiOauthStatusResponse>>
  >;
  readonly adminStartOpenAiOauthLogin: ReturnType<
    typeof vi.fn<
      (
        alias: string,
        request?: OpenAiOauthStartRequest,
      ) => Promise<OpenAiOauthStartResponse>
    >
  >;
  readonly adminCompleteOpenAiOauthLogin: ReturnType<
    typeof vi.fn<
      (
        alias: string,
        request: OpenAiOauthCompleteRequest,
      ) => Promise<OpenAiOauthCompleteResponse>
    >
  >;
  readonly adminClearOpenAiOauthCredential: ReturnType<
    typeof vi.fn<(alias: string) => Promise<OpenAiOauthClearResponse>>
  >;
  readonly pauseRuntime: ReturnType<
    typeof vi.fn<
      (
        scope: RuntimePauseScope,
        targetId: string,
        request: RuntimePauseControlRequest,
      ) => Promise<AdminControlResponse<RuntimePauseControlResult>>
    >
  >;
  readonly resumeRuntime: ReturnType<
    typeof vi.fn<
      (
        scope: RuntimePauseScope,
        targetId: string,
        request: RuntimePauseControlRequest,
      ) => Promise<
        AdminControlResponse<
          RuntimePauseControlResult | RuntimeResumeNoopResult
        >
      >
    >
  >;
  readonly patchWakeTimeoutConfig: ReturnType<
    typeof vi.fn<
      (
        request: RuntimeWakeTimeoutPatchRequest,
      ) => Promise<AdminControlResponse<RuntimeWakeTimeoutPatchResult>>
    >
  >;
}

function emptyPage<T>(): AdminPage<T> {
  return { items: [], total: 0, limit: 100, offset: 0 };
}

function diagnosticsBundle(): AdminDiagnosticsBundle {
  return {
    overview: {
      generatedAt: '2026-07-02T00:00:00Z',
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
  };
}

function diagnosticsWithBrains(
  brainModules: readonly RuntimeBrainModuleDiagnostics[],
): AdminDiagnosticsBundle {
  const base = diagnosticsBundle();
  return {
    ...base,
    overview: {
      ...base.overview,
      runtime: {
        ...base.overview.runtime,
        brainModules,
      },
    },
  };
}

function activityCensus(activityId = 'wake:test'): RuntimeActivityCensus {
  return {
    generatedAt: '2026-07-23T00:00:00Z',
    serviceInstanceId: 'service-test',
    active: [
      {
        activity: {
          activityId,
          serviceInstanceId: 'service-test',
          kind: 'wake',
          owner: 'rust_brain',
          status: 'active',
          phase: 'running',
          startedAt: '2026-07-23T00:00:00Z',
          lastProgressAt: '2026-07-23T00:00:01Z',
          revision: 1,
        },
        elapsedMs: 1_000,
        sinceProgressMs: 100,
      },
    ],
    recentlyAbnormal: [],
    findings: [],
    summary: {
      active: 1,
      recentlyAbnormal: 0,
      findings: 0,
      untrackedProcesses: 0,
    },
    automaticCancellationEnabled: false,
  };
}

function controlResponse<TResult>(
  name: string,
  result: TResult,
): AdminControlResponse<TResult> {
  return {
    command: {
      name,
      target: {},
      requestId: 'req-test',
    },
    outcome: {
      status: 'completed',
      summary: 'done',
      result,
    },
    audit: {
      started: true,
      terminal: true,
    },
    observation: {},
  };
}

function applyResult(): RuntimeConfigApplyResult {
  return {
    brainsRegistered: 1,
    brainsAlreadyPresent: 0,
    sessionsCreated: 1,
    sessionsAlreadyPresent: 0,
    sessionsReactivated: 0,
    sessionsMissing: 0,
    scheduledJobsRegistered: 0,
  };
}

function createdProfile(profileId: string): CreatedServiceProfile {
  return {
    profileId,
    agentId: `agent-${profileId}`,
    sessionId: `session-${profileId}`,
    implementationId: 'impl-test',
    profilePath: `/profiles/${profileId}`,
    runtimeConfigPath: `/profiles/${profileId}/runtime.json`,
    applyResult: applyResult(),
  };
}

function deletedProfile(profileId: string): ProfileDeleteResult {
  return {
    profileId,
    confirmProfileId: profileId,
    profileDirectoryDeleted: true,
    runtimeConfigReloaded: true,
    storagePurge: {
      profileId,
      profileRegistryDeleted: true,
      sessionIds: [`session-${profileId}`],
      agentIds: [`agent-${profileId}`],
      tableCounts: [{ table: 'profile_registry', rowsDeleted: 1 }],
      rowsDeleted: 9,
    },
  };
}

function registryPlan(profileId: string): ProfileRegistryWritePlan {
  return {
    ok: true,
    kind: 'field_update',
    profileId,
    mode: 'plan',
    expectedRevision: 1,
    current: {},
    next: {},
    nextWrite: {},
    diagnostics: [],
    implications: {},
  } as unknown as ProfileRegistryWritePlan;
}

function registryApplyResult(
  profileId: string,
): ProfileRegistryWriteApplyResult {
  return {
    ...registryPlan(profileId),
    applied: true,
    record: {},
    effects: {},
  } as unknown as ProfileRegistryWriteApplyResult;
}

function provider(alias: string): ModelProviderRecord {
  return {
    alias,
    status: 'active',
    protocol: 'chat_completions',
    providerKind: 'openai',
    modelId: 'gpt-test',
    chatCompletionsDialect: 'standard',
    thinkingMode: 'provider_default',
    reasoningHistory: 'provider_default',
    credential: { hasSecret: false },
    metadataJson: {},
    revision: 1,
    createdAt: '2026-07-02T00:00:00Z',
    updatedAt: '2026-07-02T00:00:00Z',
  };
}

function serviceCredential(
  credentialId: string,
  hasSecret = true,
): ServiceCredentialRecord {
  return {
    credentialId,
    displayName: `Credential ${credentialId}`,
    providerKind: 'openai',
    credentialKind: 'openai_oauth',
    credential: {
      hasSecret,
      kind: 'openai_oauth',
      status: hasSecret ? 'configured' : 'missing',
    },
    linkedProviderAliases: [],
    revision: 1,
    createdAt: '2026-07-02T00:00:00Z',
    updatedAt: '2026-07-02T00:00:00Z',
  };
}

function serviceCredentialImpact(
  credentialId: string,
): ServiceCredentialImpact {
  return {
    credential: serviceCredential(credentialId),
    linkedProviderAliases: [],
    linkedProviders: [],
    canClear: true,
    canDelete: true,
  };
}

function serviceCredentialPendingLogin(
  credentialId: string,
): ServiceCredentialOpenAiOauthStartResponse['pendingLogin'] {
  return {
    pendingLoginId: 'pending-credential-1',
    credentialId,
    issuer: 'https://auth.openai.com',
    clientId: 'app-client',
    redirectUri: 'http://localhost:1455/auth/callback',
    scopes: ['openid'],
    codeChallenge: 'challenge',
    authorizationUrl: 'https://auth.openai.com/oauth/authorize?...',
    createdAt: '2026-07-02T00:00:00Z',
    expiresAt: '2026-07-02T00:10:00Z',
  };
}

function openAiOauthLoginConfig(): OpenAiOauthStartResponse['loginConfig'] {
  return {
    issuer: 'https://auth.openai.com',
    clientId: 'app-client',
    redirectUri: 'http://localhost:1455/auth/callback',
    redirectUriOverrideAllowed: false,
    redirectUriMode: 'registered',
    callbackUrlCompletionAccepted: true,
    callbackUrlCompletionField: 'callbackUrl',
    pendingLoginIdRequiredForCallbackUrl: false,
    remoteOperatorFlow: 'paste_callback_url',
  };
}

function providerWriteResponse(alias: string): ModelProviderWriteResponse {
  return {
    provider: provider(alias),
    refresh: {
      mode: 'none',
      affectedProfiles: [],
      outcomes: [],
    },
  };
}

function pauseResult(targetId: string): RuntimePauseControlResult {
  return {
    pauseId: 'pause-1',
    scope: 'profile',
    targetId,
    pausedBy: 'tester',
    pausedAt: '2026-07-02T00:00:00Z',
    affectedSessionIds: ['session-alpha'],
    inFlightWakeCount: 0,
    cancellationSupported: true,
    limitation: 'none',
  };
}

function session(
  sessionId: string,
  profileId: string,
  status: string,
): RuntimeSessionDiagnostics {
  return {
    sessionId,
    agentId: `agent-${profileId}`,
    profileId,
    kind: 'full',
    status,
    toolCount: 0,
    brainTurnCount: 0,
    lastActiveAt: '2026-07-02T00:00:00Z',
    stale: false,
  };
}

function agent(profileId: string): AdminAgentDiagnostics {
  return {
    agentId: `agent-${profileId}`,
    profileId,
    sessions: 2,
    activeSessions: 1,
    idleSessions: 1,
    archivedSessions: 0,
    staleSessions: 0,
  };
}

function brain(profileId: string): RuntimeBrainModuleDiagnostics {
  return {
    profileId,
    implementationId: 'impl-test',
    moduleId: 'brain-test',
    selectedToolCount: 0,
    selectedToolSource: 'profile',
    toolAdapterStatus: 'ready',
  };
}

function apiError(
  reasonCode: string,
  message: string,
  statusCode = 503,
): ChatTransportError {
  return new ChatTransportError({
    code: 'http_error',
    message,
    statusCode,
    endpoint: 'http://test/v1/admin/diagnostics',
    apiError: {
      code: 'internal_error',
      reason_code: reasonCode,
      message,
      retryable: true,
    },
  });
}

function createTransport(
  overrides: Partial<AdminTransportMock> = {},
): AdminTransportMock {
  return {
    adminDiagnostics: vi.fn(async () => diagnosticsBundle()),
    adminSessions: vi.fn(async () => emptyPage<RuntimeSessionDiagnostics>()),
    adminAgents: vi.fn(async () => emptyPage<AdminAgentDiagnostics>()),
    adminActivities: vi.fn(async () => activityCensus()),
    adminMcpSurfaces: vi.fn(async () => emptyPage<McpSurfaceDiagnostics>()),
    adminConfigValidation: vi.fn(async () => null),
    adminCapabilities: vi.fn(
      async () =>
        ({
          schema_version: 1,
          slash_commands: [],
          capabilities: [],
        }) satisfies ApiCapabilityRegistry,
    ),
    adminProfileDiagnostics: vi.fn(
      async () =>
        ({
          generatedAt: '2026-07-02T00:00:00Z',
          registryCount: 0,
          fileFallbackCount: 0,
          driftCount: 0,
          missingAssetCount: 0,
          records: [],
          diagnostics: [],
        }) satisfies AdminProfileRegistryDiagnostics,
    ),
    adminMcpCatalog: vi.fn(async () => ({
      servers: [],
      toolProfiles: [],
      bindings: [],
    })),
    adminToolCatalog: vi.fn(async () => ({ toolsets: [], tools: [] })),
    adminLocalToolProfiles: vi.fn(async () => ({ profiles: [] })),
    adminContextStrategies: vi.fn(
      async () =>
        ({
          schemaVersion: 1,
          strategies: [],
          defaultStrategyId: 'sliding-window',
          policyDefaults: {
            enabled: true,
            strategyId: 'sliding-window',
            autoCompactionEnabled: true,
            compactAtPercent: 80,
            targetPercentAfterCompaction: 40,
            maxContextPercentForWake: 95,
            debugVisibility: 'status',
            includeDebugEventsInModelContext: false,
            strategyConfig: {},
          },
          percentRange: { min: 1, max: 100 },
        }) satisfies ContextStrategyCatalog,
    ),
    adminModelProviders: vi.fn(async () => emptyPage()),
    adminServiceCredentials: vi.fn(async () => emptyPage()),
    createAdminServiceCredential: vi.fn(async (request) => ({
      credential: serviceCredential(request.credentialId),
    })),
    adminServiceCredentialImpact: vi.fn(async (credentialId) =>
      serviceCredentialImpact(credentialId),
    ),
    clearAdminServiceCredential: vi.fn(async (credentialId) => ({
      credential: {
        ...serviceCredential(credentialId),
        credential: { hasSecret: false },
      },
    })),
    deleteAdminServiceCredential: vi.fn(async (credentialId) => ({
      deleted: true as const,
      credential: serviceCredential(credentialId),
    })),
    linkAdminModelProviderCredential: vi.fn(async (alias, request) => ({
      provider: {
        ...provider(alias),
        credentialId: request.credentialId,
        credential: { hasSecret: true, kind: 'openai_oauth' },
      },
      credential: serviceCredential(request.credentialId),
    })),
    unlinkAdminModelProviderCredential: vi.fn(async (alias) => ({
      provider: provider(alias),
    })),
    adminServiceCredentialOpenAiOauthStatus: vi.fn(async (credentialId) => ({
      credential: serviceCredential(credentialId),
      loginConfig: openAiOauthLoginConfig(),
      pendingLogins: [],
    })),
    adminStartServiceCredentialOpenAiOauthLogin: vi.fn(
      async (credentialId) => ({
        credential: serviceCredential(credentialId),
        loginConfig: openAiOauthLoginConfig(),
        pendingLogin: serviceCredentialPendingLogin(credentialId),
      }),
    ),
    adminCompleteServiceCredentialOpenAiOauthLogin: vi.fn(
      async (credentialId) => ({
        credential: serviceCredential(credentialId, true),
        completionMode: 'test' as const,
        pendingLoginId: 'pending-credential-1',
      }),
    ),
    adminClearServiceCredentialOpenAiOauth: vi.fn(async (credentialId) => ({
      credential: serviceCredential(credentialId, false),
    })),
    adminStorageQueryCatalog: vi.fn(async () => ({
      schema_version: 1,
      source: 'rust_bridge_read_model',
      items: [],
      total: 0,
    })),
    adminStorageQuery: vi.fn(async (queryId: string) => ({
      query_id: queryId,
      read_only: true,
      source: 'rust_bridge_read_model',
      items: [],
      total: 0,
    })),
    adminCreateLocalToolProfile: vi.fn(async () => ({
      id: 'tools-default',
      enabled: true,
      system: false,
      readOnly: false,
      requestedToolsets: [],
      requestedTools: [],
    })),
    adminUpdateLocalToolProfile: vi.fn(async (id: string) => ({
      id,
      enabled: true,
      system: false,
      readOnly: false,
      requestedToolsets: [],
      requestedTools: [],
    })),
    adminDeleteLocalToolProfile: vi.fn(async () => undefined),
    planAdminProfileRegistryUpdate: vi.fn(async (profileId: string) =>
      registryPlan(profileId),
    ),
    applyAdminProfileRegistryUpdate: vi.fn(async (profileId: string) =>
      registryApplyResult(profileId),
    ),
    createAdminProfile: vi.fn(async (request: { readonly profileId: string }) =>
      controlResponse('create-profile', createdProfile(request.profileId)),
    ),
    deleteAdminProfile: vi.fn(async (profileId: string) =>
      controlResponse('delete-profile', deletedProfile(profileId)),
    ),
    createAdminModelProvider: vi.fn(async () => providerWriteResponse('main')),
    updateAdminModelProvider: vi.fn(async (alias: string) =>
      providerWriteResponse(alias),
    ),
    adminOpenAiOauthStatus: vi.fn(async (alias: string) => ({
      provider: provider(alias),
      credential: { hasSecret: false },
      loginConfig: openAiOauthLoginConfig(),
      pendingLogins: [],
    })),
    adminStartOpenAiOauthLogin: vi.fn(async (alias: string) => ({
      provider: provider(alias),
      loginConfig: openAiOauthLoginConfig(),
      pendingLogin: {
        pendingLoginId: 'pending-1',
        providerAlias: alias,
        issuer: 'https://auth.openai.com',
        clientId: 'app-client',
        redirectUri: 'http://localhost:1455/auth/callback',
        scopes: ['openid'],
        codeChallenge: 'challenge',
        authorizationUrl: 'https://auth.openai.com/oauth/authorize?...',
        createdAt: '2026-07-02T00:00:00Z',
        expiresAt: '2026-07-02T00:10:00Z',
      },
    })),
    adminCompleteOpenAiOauthLogin: vi.fn(async (alias: string) => ({
      provider: {
        ...provider(alias),
        credential: { hasSecret: true, kind: 'openai_oauth' },
      },
      credential: { hasSecret: true, kind: 'openai_oauth' },
      completionMode: 'test',
      pendingLoginId: 'pending-1',
    })),
    adminClearOpenAiOauthCredential: vi.fn(async (alias: string) => ({
      provider: provider(alias),
      credential: { hasSecret: false },
    })),
    pauseRuntime: vi.fn(async (_scope, targetId) =>
      controlResponse('pause-runtime', pauseResult(targetId)),
    ),
    resumeRuntime: vi.fn(async (_scope, targetId) =>
      controlResponse('resume-runtime', {
        ...pauseResult(targetId),
        resumedAt: '2026-07-02T00:01:00Z',
      }),
    ),
    patchWakeTimeoutConfig: vi.fn(async (request) =>
      controlResponse('patch_wake_timeout', {
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
        applyResult: applyResult(),
      }),
    ),
    ...overrides,
  };
}

function setupAdminStore(transport: AdminTransportMock): AdminStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      AdminStore,
      {
        provide: ChatTransport,
        useValue: transport as unknown as ChatTransport,
      },
    ],
  });
  return TestBed.inject(AdminStore);
}

describe('AdminStore structured errors', () => {
  it('keeps transport details while exposing a string message for top-level errors', async () => {
    const transport = createTransport({
      adminDiagnostics: vi.fn(async () => {
        throw apiError('admin_down', 'Admin diagnostics failed');
      }),
    });
    const store = setupAdminStore(transport);

    await store.refresh();

    expect(store.error()).toBe('Admin diagnostics failed (admin_down)');
    expect(store.errorDetail()?.transportCode).toBe('http_error');
    expect(store.errorDetail()?.statusCode).toBe(503);
    expect(store.errorDetail()?.endpoint).toContain('/v1/admin/diagnostics');
    expect(store.errorDetail()?.apiError?.reasonCode).toBe('admin_down');
    expect(store.errorDetail()?.retryable).toBe(true);
    expect(store.loading()).toBe(false);
  });

  it('captures provider load errors separately from overall refresh success', async () => {
    const transport = createTransport({
      adminModelProviders: vi.fn(async () => {
        throw apiError('provider_registry_unavailable', 'Providers failed');
      }),
    });
    const store = setupAdminStore(transport);

    await store.refresh();

    expect(store.error()).toBeNull();
    expect(store.providerLoadError()).toBe(
      'Providers failed (provider_registry_unavailable)',
    );
    expect(store.providerLoadErrorDetail()?.apiError?.reasonCode).toBe(
      'provider_registry_unavailable',
    );
  });

  it('preserves local tool profile write error details', async () => {
    const transport = createTransport({
      adminCreateLocalToolProfile: vi.fn(async () => {
        throw apiError('tool_profile_invalid', 'Tool profile rejected');
      }),
    });
    const store = setupAdminStore(transport);

    const ok = await store.createLocalToolProfile({
      id: 'tools-default',
      requestedToolsets: ['shell'],
    });

    expect(ok).toBe(false);
    expect(store.toolProfileWriteError()).toBe(
      'Tool profile rejected (tool_profile_invalid)',
    );
    expect(store.toolProfileWriteErrorDetail()?.apiError?.reasonCode).toBe(
      'tool_profile_invalid',
    );
    expect(store.saving()).toBe(false);
  });
});

describe('AdminStore behavior', () => {
  it('preserves the last activity snapshot and marks it stale after a poll error', async () => {
    const first = activityCensus('wake:first');
    const adminActivities = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(
        apiError('activity_census_unavailable', 'Activity census failed'),
      );
    const store = setupAdminStore(createTransport({ adminActivities }));

    expect(await store.refreshActivities('durable')).toBe(true);
    expect(adminActivities).toHaveBeenCalledWith({
      sessionProjection: 'durable',
    });
    expect(store.activityCensus()).toBe(first);
    expect(store.activityProjectionMode()).toBe('durable');
    expect(store.activitySnapshotStale()).toBe(false);

    expect(await store.refreshActivities('durable')).toBe(false);
    expect(store.activityCensus()).toBe(first);
    expect(store.activitySnapshotStale()).toBe(true);
    expect(store.activityError()).toBe(
      'Activity census failed (activity_census_unavailable)',
    );
    expect(store.activityLoading()).toBe(false);
  });

  it('does not turn a missing activity response into an empty census', async () => {
    const store = setupAdminStore(
      createTransport({ adminActivities: vi.fn(async () => null) }),
    );

    expect(await store.refreshActivities()).toBe(false);
    expect(store.activityCensus()).toBeNull();
    expect(store.activityError()).toBe(
      'Crew returned no runtime activity census.',
    );
  });

  it('refresh populates diagnostics, providers, and profile summaries', async () => {
    const alphaSessions = [
      session('session-alpha-live', 'alpha', 'active'),
      session('session-alpha-idle', 'alpha', 'idle'),
    ];
    const transport = createTransport({
      adminDiagnostics: vi.fn(async () =>
        diagnosticsWithBrains([brain('alpha')]),
      ),
      adminSessions: vi.fn(async () => ({
        ...emptyPage<RuntimeSessionDiagnostics>(),
        items: alphaSessions,
        total: alphaSessions.length,
      })),
      adminAgents: vi.fn(async () => ({
        ...emptyPage<AdminAgentDiagnostics>(),
        items: [agent('alpha')],
        total: 1,
      })),
      adminMcpSurfaces: vi.fn(async () => ({
        ...emptyPage<McpSurfaceDiagnostics>(),
        items: [{ profileId: 'alpha', status: 'ready' }],
        total: 1,
      })),
      adminModelProviders: vi.fn(async () => ({
        ...emptyPage<ModelProviderRecord>(),
        items: [provider('main')],
        total: 1,
      })),
    });
    const store = setupAdminStore(transport);

    await store.refresh();

    expect(store.loading()).toBe(false);
    expect(store.sessions()?.items).toHaveLength(2);
    expect(store.providerAliases().map((item) => item.alias)).toEqual(['main']);
    expect(store.profiles()).toHaveLength(1);
    expect(store.profiles()[0]?.profileId).toBe('alpha');
    expect(store.profiles()[0]?.activeSessions).toBe(1);
    expect(store.profiles()[0]?.idleSessions).toBe(1);
    expect(store.profiles()[0]?.brainModules).toHaveLength(1);
    expect(store.profiles()[0]?.mcpSurfaces).toHaveLength(1);
  });

  it('loads and executes storage query catalog entries', async () => {
    const transport = createTransport({
      adminStorageQueryCatalog: vi.fn(async () => ({
        schema_version: 1,
        source: 'rust_bridge_read_model',
        items: [
          {
            id: 'runtime.search',
            title: 'Runtime search',
            description: 'Search runtime storage.',
            owner: 'rust_coordination',
            readOnly: true,
            backendAgnostic: true,
            resultShape: 'runtime.search_result.v1',
            parameters: [],
          },
        ],
        total: 1,
      })),
      adminStorageQuery: vi.fn(async (queryId: string) => ({
        query_id: queryId,
        read_only: true,
        source: 'rust_bridge_read_model',
        items: [{ snippet: 'hello' }],
        total: 1,
      })),
    });
    const store = setupAdminStore(transport);

    await store.loadStorageQueryCatalog();
    const ok = await store.executeStorageQuery('runtime.search', {
      query: 'hello',
    });

    expect(ok).toBe(true);
    expect(store.storageQueryCatalog()?.items[0]?.id).toBe('runtime.search');
    expect(store.storageQueryResult()?.total).toBe(1);
    expect(transport.adminStorageQuery).toHaveBeenCalledWith('runtime.search', {
      query: 'hello',
    });
    expect(store.storageQueryError()).toBeNull();
  });

  it('createProfile stores the control result and refreshes admin data', async () => {
    const transport = createTransport();
    const store = setupAdminStore(transport);

    await store.createProfile({ profileId: 'new-profile' });

    expect(transport.createAdminProfile).toHaveBeenCalledWith({
      profileId: 'new-profile',
    });
    expect(store.createResult()?.outcome.result?.profileId).toBe('new-profile');
    expect(transport.adminDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.saving()).toBe(false);
  });

  it('deleteProfile stores purge details and refreshes admin data', async () => {
    const transport = createTransport();
    const store = setupAdminStore(transport);

    await store.deleteProfile('old-profile', {
      confirmProfileId: 'old-profile',
      reason: 'operator confirmed hard delete',
    });

    expect(transport.deleteAdminProfile).toHaveBeenCalledWith('old-profile', {
      confirmProfileId: 'old-profile',
      reason: 'operator confirmed hard delete',
    });
    expect(
      store.profileDeleteResult()?.outcome.result?.storagePurge,
    ).toMatchObject({
      profileId: 'old-profile',
      profileRegistryDeleted: true,
      rowsDeleted: 9,
    });
    expect(transport.adminDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.saving()).toBe(false);
  });

  it('updates and deletes local tool profiles through the write helper', async () => {
    const transport = createTransport();
    const store = setupAdminStore(transport);

    const updated = await store.updateLocalToolProfile('tools-default', {
      displayName: 'Default tools',
    });
    const deleted = await store.deleteLocalToolProfile('tools-default');

    expect(updated).toBe(true);
    expect(deleted).toBe(true);
    expect(transport.adminUpdateLocalToolProfile).toHaveBeenCalledWith(
      'tools-default',
      { displayName: 'Default tools' },
    );
    expect(transport.adminDeleteLocalToolProfile).toHaveBeenCalledWith(
      'tools-default',
    );
    expect(store.toolProfileWriteError()).toBeNull();
    expect(store.saving()).toBe(false);
  });

  it('patches service wake timeout and refreshes admin data', async () => {
    const transport = createTransport();
    const store = setupAdminStore(transport);

    const ok = await store.patchWakeTimeoutConfig({
      wakeTimeout: { mode: 'default', defaultMs: 45_000 },
      reason: 'test wake timeout update',
    });

    expect(ok).toBe(true);
    expect(transport.patchWakeTimeoutConfig).toHaveBeenCalledWith({
      wakeTimeout: { mode: 'default', defaultMs: 45_000 },
      reason: 'test wake timeout update',
    });
    expect(store.wakeTimeoutPatchResult()?.outcome.result).toMatchObject({
      ok: true,
      wakeTimeout: { mode: 'default', defaultMs: 45_000 },
      safeWritePath: {
        capabilityId: 'admin.control.config.wake_timeout.patch',
      },
    });
    expect(transport.adminDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.saving()).toBe(false);
  });

  it('plans and applies profile registry field updates', async () => {
    const transport = createTransport();
    const store = setupAdminStore(transport);
    const request: ProfileRegistryFieldUpdateRequest = {
      expectedRevision: 1,
      displayName: 'Alpha',
    };

    await store.planRegistryUpdate('alpha', request);
    expect(transport.planAdminProfileRegistryUpdate).toHaveBeenCalledWith(
      'alpha',
      request,
    );
    expect(store.registryWritePlan()?.profileId).toBe('alpha');

    await store.applyRegistryUpdate('alpha', request);
    expect(transport.applyAdminProfileRegistryUpdate).toHaveBeenCalledWith(
      'alpha',
      request,
    );
    expect(store.registryWriteResult()).not.toBeNull();
    expect(store.registryWritePlan()).toBeNull();
    expect(transport.adminDiagnostics).toHaveBeenCalledTimes(1);
    expect(store.saving()).toBe(false);
  });

  it('createModelProvider always applies affected profile rebuilds', async () => {
    const transport = createTransport();
    const store = setupAdminStore(transport);
    const request: ModelProviderWriteRequest = {
      alias: 'main',
      protocol: 'chat_completions',
      modelId: 'gpt-test',
    };

    await store.createModelProvider(request);

    expect(transport.createAdminModelProvider).toHaveBeenCalledWith(
      request,
      'apply',
    );
    expect(store.providerWriteResult()?.provider.alias).toBe('main');
    expect(store.saving()).toBe(false);
  });

  it('updateModelProvider always applies rebuilds and refreshes data', async () => {
    const transport = createTransport();
    const store = setupAdminStore(transport);
    const request: ModelProviderWriteRequest = {
      protocol: 'chat_completions',
      modelId: 'gpt-next',
    };

    await store.updateModelProvider('main', request);

    expect(transport.updateAdminModelProvider).toHaveBeenCalledWith(
      'main',
      request,
      'apply',
    );
    expect(store.providerWriteResult()?.provider.alias).toBe('main');
    expect(transport.adminDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('links two aliases to one shared credential and unlinks without deleting it', async () => {
    let linkedAliases: string[] = [];
    let providers: ModelProviderRecord[] = ['sol', 'terra'].map((alias) => ({
      ...provider(alias),
      protocol: 'responses' as const,
    }));
    const credential = serviceCredential('openai:shared');
    const currentCredential = (): ServiceCredentialRecord => ({
      ...credential,
      linkedProviderAliases: linkedAliases,
    });
    const transport = createTransport({
      adminModelProviders: vi.fn(async () => ({
        ...emptyPage<ModelProviderRecord>(),
        items: providers,
        total: providers.length,
      })),
      adminServiceCredentials: vi.fn(async () => ({
        ...emptyPage<ServiceCredentialRecord>(),
        items: [currentCredential()],
        total: 1,
      })),
      linkAdminModelProviderCredential: vi.fn(async (alias, request) => {
        linkedAliases = [...new Set([...linkedAliases, alias])];
        const current = providers.find((item) => item.alias === alias);
        const linked = {
          ...(current ?? provider(alias)),
          credentialId: request.credentialId,
          credential: credential.credential,
          revision: (current?.revision ?? 0) + 1,
        };
        providers = [
          ...providers.filter((item) => item.alias !== alias),
          linked,
        ];
        return { provider: linked, credential: currentCredential() };
      }),
      unlinkAdminModelProviderCredential: vi.fn(async (alias) => {
        linkedAliases = linkedAliases.filter((item) => item !== alias);
        const current = providers.find((item) => item.alias === alias);
        const rest = { ...(current ?? provider(alias)) };
        delete rest.credentialId;
        const unlinked = {
          ...rest,
          credential: { hasSecret: false },
          revision: (current?.revision ?? 0) + 1,
        };
        providers = [
          ...providers.filter((item) => item.alias !== alias),
          unlinked,
        ];
        return { provider: unlinked };
      }),
      adminServiceCredentialImpact: vi.fn(async () => ({
        credential: currentCredential(),
        linkedProviderAliases: linkedAliases,
        linkedProviders: providers.filter((item) =>
          linkedAliases.includes(item.alias),
        ),
        canClear: linkedAliases.length === 0,
        canDelete: linkedAliases.length === 0,
      })),
    });
    const store = setupAdminStore(transport);
    await store.refresh();

    await store.linkModelProviderCredential('sol', credential);
    await store.linkModelProviderCredential('terra', currentCredential());

    expect(linkedAliases).toEqual(['sol', 'terra']);
    expect(
      store.providerAliases().find((item) => item.alias === 'terra')
        ?.credentialId,
    ).toBe('openai:shared');
    expect(store.serviceCredentials()[0]?.linkedProviderAliases).toEqual([
      'sol',
      'terra',
    ]);
    const terra = store
      .providerAliases()
      .find((item) => item.alias === 'terra');
    if (terra === undefined) throw new Error('expected terra provider');
    await store.unlinkModelProviderCredential(terra);

    expect(linkedAliases).toEqual(['sol']);
    expect(
      store.providerAliases().find((item) => item.alias === 'terra')
        ?.credentialId,
    ).toBeUndefined();
    expect(store.serviceCredentials()[0]?.credentialId).toBe('openai:shared');
    expect(transport.deleteAdminServiceCredential).not.toHaveBeenCalled();
  });

  it('surfaces linked-credential structured errors with an unlink-first action', async () => {
    const transport = createTransport({
      deleteAdminServiceCredential: vi.fn(async () => {
        throw apiError(
          'service_credential_linked',
          'cannot delete while linked',
        );
      }),
    });
    const store = setupAdminStore(transport);

    await store.deleteServiceCredential(serviceCredential('openai:shared'));

    expect(store.error()).toContain('Unlink every affected alias');
    expect(store.errorDetail()?.apiError?.reasonCode).toBe(
      'service_credential_linked',
    );
  });

  it('reloads a stale credential revision so the next link attempt can succeed', async () => {
    let backendCredentialRevision = 1;
    const currentCredential = (): ServiceCredentialRecord => ({
      ...serviceCredential('openai:shared'),
      revision: backendCredentialRevision,
    });
    const linkAdminModelProviderCredential = vi.fn(
      async (
        alias: string,
        request: ModelProviderCredentialLinkRequest,
      ): Promise<ModelProviderCredentialLinkResponse> => {
        if (request.expectedCredentialRevision !== backendCredentialRevision) {
          throw apiError(
            'service_credential_revision_mismatch',
            'credential revision changed',
            409,
          );
        }
        return {
          provider: {
            ...provider(alias),
            credentialId: request.credentialId,
            credential: currentCredential().credential,
          },
          credential: currentCredential(),
        };
      },
    );
    const transport = createTransport({
      adminServiceCredentials: vi.fn(async () => ({
        ...emptyPage<ServiceCredentialRecord>(),
        items: [currentCredential()],
        total: 1,
      })),
      linkAdminModelProviderCredential,
    });
    const store = setupAdminStore(transport);
    await store.refresh();
    const staleCredential = store.serviceCredentials()[0];
    if (staleCredential === undefined) {
      throw new Error('expected the initial credential');
    }
    backendCredentialRevision = 2;

    const firstResult = await store.linkModelProviderCredential(
      'terra',
      staleCredential,
    );

    expect(firstResult).toBeUndefined();
    expect(store.errorDetail()?.apiError?.reasonCode).toBe(
      'service_credential_revision_mismatch',
    );
    expect(store.error()).toContain('current redacted state has been reloaded');
    expect(store.serviceCredentials()[0]?.revision).toBe(2);

    const refreshedCredential = store.serviceCredentials()[0];
    if (refreshedCredential === undefined) {
      throw new Error('expected the refreshed credential');
    }
    const secondResult = await store.linkModelProviderCredential(
      'terra',
      refreshedCredential,
    );

    expect(secondResult?.provider.credentialId).toBe('openai:shared');
    expect(
      linkAdminModelProviderCredential.mock.calls.map(
        ([, request]) => request.expectedCredentialRevision,
      ),
    ).toEqual([1, 2]);
  });

  it('tracks OpenAI OAuth pending login and completion without exposing token material', async () => {
    const adminOpenAiOauthStatus = vi.fn(async (alias: string) => ({
      provider: {
        ...provider(alias),
        credential: { hasSecret: true, kind: 'openai_oauth' as const },
      },
      credential: { hasSecret: true, kind: 'openai_oauth' as const },
      loginConfig: openAiOauthLoginConfig(),
      pendingLogins: [],
    }));
    const transport = createTransport({ adminOpenAiOauthStatus });
    const store = setupAdminStore(transport);

    await store.startOpenAiOauthLogin('openai-oauth', {
      originator: 'rusty_view',
    });

    expect(transport.adminStartOpenAiOauthLogin).toHaveBeenCalledWith(
      'openai-oauth',
      { originator: 'rusty_view' },
    );
    expect(store.openAiOauthStartResult()?.pendingLogin.pendingLoginId).toBe(
      'pending-1',
    );
    expect(store.openAiOauthStatus()?.pendingLogins).toHaveLength(1);

    await store.completeOpenAiOauthLogin('openai-oauth', {
      callbackUrl:
        'http://localhost:1455/auth/callback?code=authorization-code&state=callback-state',
    });

    expect(transport.adminCompleteOpenAiOauthLogin).toHaveBeenCalledWith(
      'openai-oauth',
      {
        callbackUrl:
          'http://localhost:1455/auth/callback?code=authorization-code&state=callback-state',
      },
    );
    expect(store.openAiOauthCompleteResult()?.credential.kind).toBe(
      'openai_oauth',
    );
    expect(JSON.stringify(store.openAiOauthCompleteResult())).not.toContain(
      'refresh-token',
    );
    expect(store.openAiOauthStatus()?.pendingLogins).toHaveLength(0);
    expect(store.openAiOauthStatus()?.credential).toEqual({
      hasSecret: true,
      kind: 'openai_oauth',
    });
    expect(adminOpenAiOauthStatus).toHaveBeenCalledWith('openai-oauth');
  });

  it('clears OpenAI OAuth credentials through the explicit credential endpoint', async () => {
    const transport = createTransport();
    const store = setupAdminStore(transport);

    await store.clearOpenAiOauthCredential('openai-oauth');

    expect(transport.adminClearOpenAiOauthCredential).toHaveBeenCalledWith(
      'openai-oauth',
    );
    expect(store.openAiOauthClearResult()?.credential.hasSecret).toBe(false);
    expect(store.openAiOauthStatus()?.credential).toEqual({ hasSecret: false });
    expect(transport.adminOpenAiOauthStatus).toHaveBeenCalledWith(
      'openai-oauth',
    );
  });

  it('keeps structured OpenAI OAuth failures actionable for the provider alert', async () => {
    const transport = createTransport({
      adminCompleteOpenAiOauthLogin: vi.fn(async () => {
        throw apiError(
          'openai_oauth_state_mismatch',
          'callback state did not match',
        );
      }),
    });
    const store = setupAdminStore(transport);

    await store.completeOpenAiOauthLogin('openai-oauth', {
      callbackUrl:
        'http://localhost:1455/auth/callback?code=authorization-code&state=stale-state',
    });

    expect(store.error()).toContain('did not match the pending login');
    expect(store.errorDetail()?.apiError?.reasonCode).toBe(
      'openai_oauth_state_mismatch',
    );
  });

  it('pauseRuntime and resumeRuntime expose control results', async () => {
    const transport = createTransport();
    const store = setupAdminStore(transport);

    await store.pauseRuntime('profile', 'alpha', { reason: 'maintenance' });
    expect(store.runtimePauseResult()?.outcome.result?.targetId).toBe('alpha');

    await store.resumeRuntime('profile', 'alpha');

    expect(transport.pauseRuntime).toHaveBeenCalledWith('profile', 'alpha', {
      reason: 'maintenance',
    });
    expect(transport.resumeRuntime).toHaveBeenCalledWith(
      'profile',
      'alpha',
      {},
    );
    expect(store.runtimeResumeResult()?.outcome.result?.targetId).toBe('alpha');
    expect(store.saving()).toBe(false);
  });
});
