import { describe, expect, it } from 'vitest';

import { AdminHttpTransport } from './admin-http-transport';
import type { ChatTransportConfig, FetchImpl } from './chat-transport-config';
import { resolveChatTransportConfig } from './chat-transport-config';
import type {
  AdminProfileRegistryDiagnostics,
  StorageQueryCatalog,
  StorageQueryResult,
} from './admin-api-types';

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string | undefined;
}

function makeConfig(fetchImpl: FetchImpl): ChatTransportConfig {
  return resolveChatTransportConfig({
    baseUrl: 'http://localhost:9347',
    bearerToken: 'admin-token',
    timeoutMs: 5_000,
    reconnectInitialMs: 100,
    reconnectMaxMs: 1_000,
    reconnectMaxAttempts: 3,
    fetchImpl,
  });
}

function jsonOk(data: unknown): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      data,
      meta: { request_id: 'req_test', schema_version: 1 },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

function capturingFetch(response: Response): {
  readonly fetch: FetchImpl;
  readonly lastRequest: () => CapturedRequest;
} {
  let captured: CapturedRequest | undefined;
  const fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    captured = {
      url: input.toString(),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    return response;
  };
  return {
    fetch: fetch as FetchImpl,
    lastRequest: () => {
      if (captured === undefined) {
        throw new Error('fetch was not called');
      }
      return captured;
    },
  };
}

describe('AdminHttpTransport', () => {
  it('reads the diagnostics bundle with bearer auth', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        overview: {
          generatedAt: '2026-06-24T00:00:00Z',
          health: 'ok',
          degraded: false,
          reasonCodes: ['ok'],
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
          runtime: { brainModules: [], sessions: [], delegatedSessions: [] },
        },
        health: {},
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    await transport.diagnostics();

    expect(lastRequest().method).toBe('GET');
    expect(lastRequest().url).toContain('/v1/admin/diagnostics');
    expect(lastRequest().headers.get('Authorization')).toBe(
      'Bearer admin-token',
    );
  });

  it('loads the read-only storage query catalog', async () => {
    const catalog: StorageQueryCatalog = {
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
          parameters: [
            {
              name: 'query',
              type: 'string',
              required: true,
              description: 'Search text.',
            },
          ],
        },
      ],
      total: 1,
    };
    const { fetch, lastRequest } = capturingFetch(jsonOk(catalog));
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const result = await transport.storageQueryCatalog();

    expect(result.items[0]?.id).toBe('runtime.search');
    expect(lastRequest().method).toBe('GET');
    expect(lastRequest().url).toContain('/v1/admin/storage/query-catalog');
  });

  it('executes a curated read-only storage query by id', async () => {
    const queryResult: StorageQueryResult = {
      query_id: 'runtime.search',
      read_only: true,
      source: 'rust_bridge_read_model',
      items: [{ rowType: 'message', snippet: 'hello' }],
      total: 1,
      limit: 25,
    };
    const { fetch, lastRequest } = capturingFetch(jsonOk(queryResult));
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const result = await transport.storageQuery('runtime.search', {
      query: 'hello',
    });

    expect(result.total).toBe(1);
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain('/v1/admin/storage/query/runtime.search');
    expect(req.body).toContain('hello');
  });

  it('creates a profile through the control route', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        command: { name: 'create_profile', target: {}, requestId: 'req' },
        outcome: {
          status: 'completed',
          summary:
            'profile field-prime created with session field-prime-session',
          affectedIds: {
            profileId: 'field-prime',
            agentId: 'field-prime',
            sessionId: 'field-prime-session',
            implementationId: 'field-prime-brain',
          },
          result: {
            profileId: 'field-prime',
            agentId: 'field-prime',
            sessionId: 'field-prime-session',
            implementationId: 'field-prime-brain',
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
          },
        },
        audit: { started: true, terminal: true },
        observation: {},
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    await transport.createProfile({
      profileId: 'field-prime',
      displayName: 'Field Prime',
      kind: 'full',
      modelConfig: { provider: 'local', modelName: 'deterministic' },
    });

    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain('/v1/admin/control/profiles');
    expect(req.headers.get('Content-Type')).toBe('application/json');
    expect(req.body).toContain('field-prime');
    expect(req.body).toContain('Field Prime');
  });

  it('plans and applies a profile brain rebuild through the guarded control route', async () => {
    let captured: CapturedRequest | undefined;
    const fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      captured = {
        url: input.toString(),
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? init.body : undefined,
      };
      return jsonOk({
        command: {
          name: 'profile_rebuild_brain',
          target: { profile_id: 'field prime' },
          requestId: 'req',
          reason: 'profile runtime config changed from Rusty View',
        },
        outcome: {
          status: 'blocked',
          summary: 'profile has in-flight wakes',
          reasonCode: 'in_flight_wakes',
          result: {
            profileId: 'field prime',
            blockedInFlightWakeIds: ['wake-1'],
            sessionIdsPreserved: true,
            sessionHistoryPreserved: true,
          },
        },
        audit: { started: true, terminal: true },
        observation: {},
      });
    }) as FetchImpl;
    const lastRequest = (): CapturedRequest => {
      if (captured === undefined) throw new Error('fetch was not called');
      return captured;
    };
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const plan = await transport.planProfileBrainRebuild('field prime', {
      reason: 'profile runtime config changed from Rusty View',
    });

    let req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain(
      '/v1/admin/control/profiles/field%20prime/rebuild-brain/plan',
    );
    expect(req.body).toContain(
      'profile runtime config changed from Rusty View',
    );
    expect(plan.outcome.status).toBe('blocked');

    await transport.applyProfileBrainRebuild('field prime', {
      reason: 'profile runtime config changed from Rusty View',
    });

    req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain(
      '/v1/admin/control/profiles/field%20prime/rebuild-brain/apply',
    );
    expect(req.body).toContain(
      'profile runtime config changed from Rusty View',
    );
  });

  it('hard-deletes a profile through the guarded control route', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        command: {
          name: 'delete_profile',
          target: { profileId: 'field prime' },
          requestId: 'req',
          reason: 'operator hard-deleted profile',
        },
        outcome: {
          status: 'completed',
          summary: 'profile hard-deleted',
          result: {
            profileId: 'field prime',
            confirmProfileId: 'field prime',
            profileDirectoryDeleted: true,
            runtimeConfigReloaded: true,
            storagePurge: {
              profileId: 'field prime',
              profileRegistryDeleted: true,
              sessionIds: ['field-prime-session'],
              agentIds: ['field-prime-agent'],
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
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const result = await transport.deleteProfile('field prime', {
      reason: 'operator hard-deleted profile',
      confirmProfileId: 'field prime',
    });

    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain(
      '/v1/admin/control/profiles/field%20prime/delete',
    );
    expect(JSON.parse(req.body ?? '{}')).toEqual({
      reason: 'operator hard-deleted profile',
      confirmProfileId: 'field prime',
    });
    expect(result.outcome.result?.profileDirectoryDeleted).toBe(true);
    expect(result.outcome.result?.storagePurge?.rowsDeleted).toBe(7);
  });

  it('reloads runtime config through the control route', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        command: { name: 'reload_config', target: {}, requestId: 'req' },
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
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    await transport.reloadConfig();

    expect(lastRequest().method).toBe('POST');
    expect(lastRequest().url).toContain('/v1/admin/control/config/reload');
    expect(lastRequest().body).toContain('rusty-view service config reload');
  });

  it('reads the admin capability registry', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        schema_version: 1,
        slash_commands: [],
        capabilities: [
          {
            id: 'admin.control.sessions.runtime.pause',
            method: 'POST',
            path_template:
              '/v1/admin/control/sessions/{session_id}/runtime/pause',
            description: 'Pause runtime work for one session.',
            auth: 'admin',
            mutation: 'control',
            stability: 'stable',
            tags: ['session', 'service'],
            public: true,
            command_name: 'pause_runtime',
          },
        ],
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const registry = await transport.capabilities();

    expect(registry.capabilities).toHaveLength(1);
    expect(lastRequest().method).toBe('GET');
    expect(lastRequest().url).toContain('/v1/admin/capabilities');
  });

  it('reads the context strategy catalog (#3849)', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
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
            description: 'Compatibility strategy.',
            status: 'active',
            supportsAutoCompaction: false,
            modelFacingDebugDefault: false,
          },
        ],
        percentRange: { min: 1, max: 100 },
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const catalog = await transport.contextStrategies();

    expect(catalog.defaultStrategyId).toBe('recent_window');
    expect(catalog.strategies).toHaveLength(1);
    expect(lastRequest().method).toBe('GET');
    expect(lastRequest().url).toContain('/v1/admin/context-strategies');
  });

  it('pauses a session runtime through the control route', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        command: {
          name: 'pause_runtime',
          target: { scope: 'session', sessionId: 'session alpha' },
          requestId: 'req',
          reason: 'operator emergency stop',
          reasonCode: 'runtime_pause_operator',
        },
        outcome: {
          status: 'completed',
          summary: 'runtime session session alpha paused',
          result: {
            pauseId: 'pause:session:session_alpha:1',
            scope: 'session',
            targetId: 'session alpha',
            pausedBy: 'operator',
            pausedAt: '2026-06-25T00:00:00Z',
            reason: 'operator emergency stop',
            reasonCode: 'runtime_pause_operator',
            affectedSessionIds: ['session alpha'],
            inFlightWakeCount: 0,
            cancellationSupported: false,
            limitation: 'suppresses new wakes only',
          },
        },
        audit: { started: true, terminal: true },
        observation: {},
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    await transport.pauseRuntime('session', 'session alpha', {
      reason: 'operator emergency stop',
      reasonCode: 'runtime_pause_operator',
    });

    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain(
      '/v1/admin/control/sessions/session%20alpha/runtime/pause',
    );
    expect(req.body).toContain('operator emergency stop');
    expect(req.body).toContain('runtime_pause_operator');
  });

  it('resumes a session runtime through the control route', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        command: {
          name: 'resume_runtime',
          target: { scope: 'session', sessionId: 'session-alpha' },
          requestId: 'req',
        },
        outcome: {
          status: 'completed',
          summary: 'runtime session session-alpha resumed',
          result: {
            paused: false,
            scope: 'session',
            targetId: 'session-alpha',
          },
        },
        audit: { started: true, terminal: true },
        observation: {},
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    await transport.resumeRuntime('session', 'session-alpha');

    expect(lastRequest().method).toBe('POST');
    expect(lastRequest().url).toContain(
      '/v1/admin/control/sessions/session-alpha/runtime/resume',
    );
  });

  it('lists profile registry records through the registry route', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({ items: [], total: 0, limit: 50, offset: 0 }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    await transport.profileRegistry({
      source: 'file_fallback',
      lifecycleStatus: 'active',
    });

    const req = lastRequest();
    expect(req.method).toBe('GET');
    expect(req.url).toContain('/v1/admin/profiles/registry');
    expect(req.url).toContain('source=file_fallback');
    expect(req.url).toContain('lifecycle_status=active');
  });

  it('reads a single profile registry record by profile id', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        source: 'registry',
        profileId: 'field-prime',
        lifecycleStatus: 'active',
        activeRuntimeRefs: [],
        sourceAssetRefs: [],
        sourceAssetStatuses: [],
        diagnostics: [],
        fallbackStatus: 'registry_authoritative',
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const record = await transport.profileRegistryRecord('field prime');

    expect(record.profileId).toBe('field-prime');
    expect(lastRequest().url).toContain(
      '/v1/admin/profiles/registry/field%20prime',
    );
  });

  it('reads profile registry diagnostics', async () => {
    const bundle: AdminProfileRegistryDiagnostics = {
      generatedAt: '2026-06-26T00:00:00Z',
      records: [],
      registryCount: 0,
      fileFallbackCount: 0,
      driftCount: 0,
      missingAssetCount: 0,
      diagnostics: [],
    };
    const { fetch, lastRequest } = capturingFetch(jsonOk(bundle));
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const result = await transport.profileDiagnostics();

    expect(result?.registryCount).toBe(0);
    expect(lastRequest().url).toContain('/v1/admin/diagnostics/profiles');
  });

  it('requests a profile bundle export plan', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
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
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const plan = await transport.profileExportPlan('field-prime');

    expect(plan.profileId).toBe('field-prime');
    expect(lastRequest().url).toContain(
      '/v1/admin/profiles/registry/field-prime/export-plan',
    );
  });

  it('plans and applies a registry field update', async () => {
    const planResponse = {
      ok: true,
      profileId: 'field-prime',
      kind: 'update',
      mode: 'plan',
      expectedRevision: 3,
      current: { profileId: 'field-prime', revision: 3 },
      next: { profileId: 'field-prime', revision: 4, displayName: 'Updated' },
      diagnostics: [],
      implications: {
        registryRevisionWillIncrement: true,
        profileFilesUnchanged: true,
        serviceConfigUnchanged: true,
        runtimeRebuildRecommended: false,
        lifecycleEffects: 'none',
      },
    };
    const { fetch, lastRequest } = capturingFetch(jsonOk(planResponse));
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const plan = await transport.planProfileRegistryUpdate('field-prime', {
      expectedRevision: 3,
      displayName: 'Updated',
    });

    expect(plan.kind).toBe('update');
    expect(plan.mode).toBe('plan');
    const planReq = lastRequest();
    expect(planReq.method).toBe('POST');
    expect(planReq.url).toContain(
      '/v1/admin/profiles/registry/field-prime/update/plan',
    );
    expect(planReq.body).toContain('"expectedRevision":3');
    expect(planReq.body).toContain('Updated');
  });

  it('applies a registry field update', async () => {
    const applyResponse = {
      ok: true,
      profileId: 'field-prime',
      kind: 'update',
      mode: 'apply',
      expectedRevision: 3,
      current: { profileId: 'field-prime', revision: 3 },
      next: { profileId: 'field-prime', revision: 4 },
      diagnostics: [],
      implications: {
        registryRevisionWillIncrement: true,
        profileFilesUnchanged: true,
        serviceConfigUnchanged: true,
        runtimeRebuildRecommended: false,
        lifecycleEffects: 'none',
      },
      applied: true,
      record: { profileId: 'field-prime', revision: 4, displayName: 'Updated' },
    };
    const { fetch, lastRequest } = capturingFetch(jsonOk(applyResponse));
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const result = await transport.applyProfileRegistryUpdate('field prime', {
      expectedRevision: 3,
      displayName: 'Updated',
    });

    if (!('applied' in result)) {
      throw new Error('expected an applied result');
    }
    expect(result.applied).toBe(true);
    expect(result.record.revision).toBe(4);
    expect(lastRequest().url).toContain(
      '/v1/admin/profiles/registry/field%20prime/update/apply',
    );
  });

  it('returns a non-applied plan when an apply fails (revision mismatch)', async () => {
    // Backend returns the plain plan (no applied/record) when !plan.ok.
    const failedResponse = {
      ok: false,
      profileId: 'field-prime',
      kind: 'update',
      mode: 'apply',
      expectedRevision: 9,
      current: { profileId: 'field-prime', revision: 3 },
      next: { profileId: 'field-prime', revision: 3 },
      diagnostics: [
        {
          severity: 'error',
          code: 'profile_registry_revision_mismatch',
          path: 'expectedRevision',
          message: 'expected revision 9, found 3',
        },
      ],
      implications: {
        registryRevisionWillIncrement: true,
        profileFilesUnchanged: true,
        serviceConfigUnchanged: true,
        runtimeRebuildRecommended: false,
        lifecycleEffects: 'none',
      },
    };
    const { fetch } = capturingFetch(jsonOk(failedResponse));
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const result = await transport.applyProfileRegistryUpdate('field-prime', {
      expectedRevision: 9,
      displayName: 'Stale',
    });

    expect(result.ok).toBe(false);
    expect('applied' in result).toBe(false);
    expect(result.diagnostics[0]?.code).toBe(
      'profile_registry_revision_mismatch',
    );
  });

  it('plans and applies a registry lifecycle transition', async () => {
    const lifecycleResponse = {
      ok: true,
      profileId: 'field-prime',
      kind: 'lifecycle',
      mode: 'apply',
      expectedRevision: 4,
      current: {
        profileId: 'field-prime',
        revision: 4,
        lifecycleStatus: 'active',
      },
      next: {
        profileId: 'field-prime',
        revision: 5,
        lifecycleStatus: 'paused',
      },
      diagnostics: [],
      implications: {
        registryRevisionWillIncrement: true,
        profileFilesUnchanged: true,
        serviceConfigUnchanged: true,
        runtimeRebuildRecommended: true,
        lifecycleEffects: 'archive_active_sessions_and_unregister_brain',
      },
      applied: true,
      record: {
        profileId: 'field-prime',
        revision: 5,
        lifecycleStatus: 'paused',
      },
      effects: {
        sessionsArchived: ['field-prime-session'],
        brainHandle: { action: 'removed' },
      },
    };
    const { fetch, lastRequest } = capturingFetch(jsonOk(lifecycleResponse));
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const result = await transport.applyProfileRegistryLifecycle(
      'field-prime',
      {
        expectedRevision: 4,
        lifecycleStatus: 'paused',
      },
    );

    if (!('applied' in result)) {
      throw new Error('expected an applied result');
    }
    expect(result.applied).toBe(true);
    expect(result.effects?.sessionsArchived).toEqual(['field-prime-session']);
    expect(result.effects?.brainHandle.action).toBe('removed');
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain(
      '/v1/admin/profiles/registry/field-prime/lifecycle/apply',
    );
    expect(req.body).toContain('"lifecycleStatus":"paused"');
  });

  it('plans a registry prompt edit with soul and memory fields', async () => {
    const planResponse = {
      ok: true,
      profileId: 'prompt-prime',
      kind: 'prompt',
      mode: 'plan',
      expectedRevision: 3,
      current: { profileId: 'prompt-prime', revision: 3 },
      next: { profileId: 'prompt-prime', revision: 4 },
      diagnostics: [],
      implications: {
        registryRevisionWillIncrement: true,
        profileFilesUnchanged: true,
        serviceConfigUnchanged: true,
        runtimeRebuildRecommended: true,
        lifecycleEffects: 'none',
      },
    };
    const { fetch, lastRequest } = capturingFetch(jsonOk(planResponse));
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const plan = await transport.planProfileRegistryPrompt('prompt-prime', {
      expectedRevision: 3,
      soulMarkdown: 'new soul',
      memoryMarkdown: 'new memory',
    });

    expect(plan.kind).toBe('prompt');
    expect(plan.mode).toBe('plan');
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain(
      '/v1/admin/profiles/registry/prompt-prime/prompt/plan',
    );
    expect(req.body).toContain('"soulMarkdown":"new soul"');
    expect(req.body).toContain('"memoryMarkdown":"new memory"');
  });

  it('applies a registry prompt edit with a null clear for soul', async () => {
    const applyResponse = {
      ok: true,
      profileId: 'prompt-prime',
      kind: 'prompt',
      mode: 'apply',
      expectedRevision: 3,
      current: { profileId: 'prompt-prime', revision: 3 },
      next: { profileId: 'prompt-prime', revision: 4 },
      diagnostics: [],
      implications: {
        registryRevisionWillIncrement: true,
        profileFilesUnchanged: true,
        serviceConfigUnchanged: true,
        runtimeRebuildRecommended: true,
        lifecycleEffects: 'none',
      },
      applied: true,
      record: { profileId: 'prompt-prime', revision: 4 },
    };
    const { fetch, lastRequest } = capturingFetch(jsonOk(applyResponse));
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const result = await transport.applyProfileRegistryPrompt('prompt-prime', {
      expectedRevision: 3,
      soulMarkdown: null,
      memoryMarkdown: '',
    });

    if (!('applied' in result)) {
      throw new Error('expected an applied result');
    }
    expect(result.applied).toBe(true);
    const req = lastRequest();
    expect(req.url).toContain(
      '/v1/admin/profiles/registry/prompt-prime/prompt/apply',
    );
    // null clear is serialized as the JSON null literal.
    expect(req.body).toContain('"soulMarkdown":null');
    // Empty string is serialized as a string, not coerced.
    expect(req.body).toContain('"memoryMarkdown":""');
  });

  it('plans a runtime-config change on the registry runtime-config route (#3742)', async () => {
    // Crew's runtime-config plan has no `kind`, carries `runtimeConfig`, and a
    // runtime-config-specific `implications` block.
    const planResponse = {
      ok: true,
      profileId: 'rt-prime',
      mode: 'plan',
      expectedRevision: 5,
      current: { profileId: 'rt-prime', revision: 5 },
      next: { profileId: 'rt-prime', revision: 6 },
      nextWrite: {},
      runtimeConfig: {
        providerAlias: 'default',
        localToolProfileId: 'planner-tools',
        mcpBindings: [{ serverId: 'den', toolProfileKey: 'den-key' }],
      },
      diagnostics: [],
      implications: {
        registryRevisionWillIncrement: true,
        profileFileWillChange: true,
        serviceConfigWillChange: false,
        configReloadRequired: true,
        runtimeRebuildRecommended: true,
        mcpRefreshRecommended: false,
      },
    };
    const { fetch, lastRequest } = capturingFetch(jsonOk(planResponse));
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const plan = await transport.planProfileRegistryRuntimeConfig('rt-prime', {
      expectedRevision: 5,
      providerAlias: 'default',
      localToolProfileId: 'planner-tools',
      mcpBindings: [{ serverId: 'den', toolProfileKey: 'den-key' }],
    });

    expect(plan.implications.runtimeRebuildRecommended).toBe(true);
    expect(plan.runtimeConfig.providerAlias).toBe('default');
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain(
      '/v1/admin/profiles/registry/rt-prime/runtime-config/plan',
    );
    expect(req.body).toContain('"providerAlias":"default"');
    expect(req.body).toContain('"localToolProfileId":"planner-tools"');
    expect(req.body).toContain('"serverId":"den"');
  });

  it('applies a runtime-config change with inline tool policy and null local profile (#3742)', async () => {
    const applyResponse = {
      ok: true,
      profileId: 'rt-prime',
      mode: 'apply',
      expectedRevision: 5,
      current: { profileId: 'rt-prime', revision: 5 },
      next: { profileId: 'rt-prime', revision: 6 },
      nextWrite: {},
      runtimeConfig: {
        providerAlias: 'default',
        mcpBindings: [],
      },
      applied: true,
      record: { profileId: 'rt-prime', revision: 6 },
      effects: {
        profilePath: '/profiles/rt-prime/profile.json',
        runtimeConfigPath: '/service.json',
        mcpBindings: { removed: 0, added: 0 },
        applyResult: {},
      },
      diagnostics: [],
      implications: {
        registryRevisionWillIncrement: true,
        profileFileWillChange: true,
        serviceConfigWillChange: false,
        configReloadRequired: true,
        runtimeRebuildRecommended: true,
        mcpRefreshRecommended: false,
      },
    };
    const { fetch, lastRequest } = capturingFetch(jsonOk(applyResponse));
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const result = await transport.applyProfileRegistryRuntimeConfig(
      'rt-prime',
      {
        expectedRevision: 5,
        localToolProfileId: null,
        toolPolicy: { requestedToolsets: ['local_code_read'] },
      },
    );

    if (!('applied' in result)) {
      throw new Error('expected an applied result');
    }
    expect(result.applied).toBe(true);
    expect(result.record.revision).toBe(6);
    const req = lastRequest();
    expect(req.url).toContain(
      '/v1/admin/profiles/registry/rt-prime/runtime-config/apply',
    );
    expect(req.body).toContain('"localToolProfileId":null');
    expect(req.body).toContain('"requestedToolsets":["local_code_read"]');
  });

  it('lists model providers through the provider registry route', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({ items: [], total: 0, limit: 100, offset: 0 }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    await transport.modelProviders({ status: 'active', aliasPrefix: 'loc' });

    const req = lastRequest();
    expect(req.method).toBe('GET');
    expect(req.url).toContain('/v1/admin/model-providers');
    expect(req.url).toContain('status=active');
    expect(req.url).toContain('aliasPrefix=loc');
  });

  it('reads a single model provider by alias', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        alias: 'default',
        status: 'active',
        protocol: 'chat_completions',
        providerKind: 'local',
        modelId: 'deterministic',
        credential: { hasSecret: false },
        metadataJson: null,
        revision: 1,
        createdAt: '2026-06-27T00:00:00Z',
        updatedAt: '2026-06-27T00:00:00Z',
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const provider = await transport.modelProvider('default');

    expect(provider.alias).toBe('default');
    expect(lastRequest().url).toContain('/v1/admin/model-providers/default');
  });

  it('creates a model provider with an optional refresh', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        provider: { alias: 'default', credential: { hasSecret: true } },
        refresh: { mode: 'plan', affectedProfiles: [], outcomes: [] },
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const result = await transport.createModelProvider(
      {
        protocol: 'chat_completions',
        modelId: 'deterministic',
        secret: 'super-secret',
      },
      'plan',
    );

    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain('/v1/admin/model-providers');
    expect(req.url).toContain('refresh=plan');
    expect(req.body).toContain('chat_completions');
    expect(req.body).toContain('super-secret');
    expect(result.refresh.mode).toBe('plan');
    // Secret must never echo back in the response.
    expect(req.body).not.toContain('hasSecret');
  });

  it('updates a model provider by alias via PATCH', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        provider: { alias: 'alternate', status: 'disabled' },
        refresh: { mode: 'apply', affectedProfiles: [], outcomes: [] },
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    await transport.updateModelProvider(
      'alternate',
      {
        protocol: 'chat_completions',
        modelId: 'deterministic-updated',
        status: 'disabled',
        expectedRevision: 3,
      },
      'apply',
    );

    const req = lastRequest();
    expect(req.method).toBe('PATCH');
    expect(req.url).toContain('/v1/admin/model-providers/alternate');
    expect(req.url).toContain('refresh=apply');
    expect(req.body).toContain('disabled');
    expect(req.body).toContain('"expectedRevision":3');
  });

  it('starts an OpenAI OAuth provider login through the explicit route', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        provider: { alias: 'openai-oauth', credential: { hasSecret: false } },
        loginConfig: {
          issuer: 'https://auth.openai.com',
          clientId: 'app-client',
          redirectUri: 'http://localhost:1455/auth/callback',
          redirectUriOverrideAllowed: false,
          redirectUriMode: 'registered',
          callbackUrlCompletionAccepted: true,
          callbackUrlCompletionField: 'callbackUrl',
          pendingLoginIdRequiredForCallbackUrl: false,
          remoteOperatorFlow: 'paste_callback_url',
        },
        pendingLogin: {
          pendingLoginId: 'pending-1',
          providerAlias: 'openai-oauth',
          issuer: 'https://auth.openai.com',
          clientId: 'app-client',
          redirectUri: 'http://localhost:1455/auth/callback',
          scopes: ['openid'],
          codeChallenge: 'challenge',
          authorizationUrl: 'https://auth.openai.com/oauth/authorize?...',
          createdAt: '2026-07-02T00:00:00Z',
          expiresAt: '2026-07-02T00:10:00Z',
        },
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const result = await transport.startOpenAiOauthLogin('openai-oauth', {
      redirectUri: 'http://localhost:1455/auth/callback',
      originator: 'rusty_view',
    });

    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain(
      '/v1/admin/model-providers/openai-oauth/oauth/openai/start',
    );
    expect(req.body).toContain('rusty_view');
    expect(result.pendingLogin.authorizationUrl).toContain('/oauth/authorize');
  });

  it('completes OpenAI OAuth with deterministic fake token response without echoing secrets', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        provider: {
          alias: 'openai-oauth',
          credential: { hasSecret: true, kind: 'openai_oauth' },
        },
        credential: { hasSecret: true, kind: 'openai_oauth' },
        completionMode: 'test',
        pendingLoginId: 'pending-1',
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const result = await transport.completeOpenAiOauthLogin('openai-oauth', {
      pendingLoginId: 'pending-1',
      state: 'callback-state',
      testMode: true,
      fakeTokenResponse: {
        idToken: 'id.jwt.token',
        accessToken: 'access.jwt.token',
        refreshToken: 'refresh-token',
      },
    });

    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain(
      '/v1/admin/model-providers/openai-oauth/oauth/openai/complete',
    );
    expect(req.body).toContain('"testMode":true');
    expect(req.body).toContain('refresh-token');
    expect(JSON.stringify(result)).not.toContain('refresh-token');
    expect(result.credential.kind).toBe('openai_oauth');
  });

  it('completes OpenAI OAuth by forwarding the pasted callback URL', async () => {
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        provider: {
          alias: 'openai-oauth',
          credential: { hasSecret: true, kind: 'openai_oauth' },
        },
        credential: { hasSecret: true, kind: 'openai_oauth' },
        completionMode: 'real',
        pendingLoginId: 'pending-1',
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    await transport.completeOpenAiOauthLogin('openai-oauth', {
      callbackUrl:
        'http://localhost:1455/auth/callback?code=code-1&state=callback-state',
    });

    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain(
      '/v1/admin/model-providers/openai-oauth/oauth/openai/complete',
    );
    expect(req.body).toContain('"callbackUrl"');
    expect(req.body).toContain('callback-state');
    expect(req.body).not.toContain('"pendingLoginId"');
  });

  it('reads and clears OpenAI OAuth status through explicit credential routes', async () => {
    let captured: CapturedRequest | undefined;
    const fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      captured = {
        url: input.toString(),
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? init.body : undefined,
      };
      return jsonOk({
        provider: { alias: 'openai-oauth', credential: { hasSecret: false } },
        credential: { hasSecret: false },
        loginConfig: {
          issuer: 'https://auth.openai.com',
          clientId: 'app-client',
          redirectUri: 'http://localhost:1455/auth/callback',
          redirectUriOverrideAllowed: false,
          redirectUriMode: 'registered',
          callbackUrlCompletionAccepted: true,
          callbackUrlCompletionField: 'callbackUrl',
          pendingLoginIdRequiredForCallbackUrl: false,
          remoteOperatorFlow: 'paste_callback_url',
        },
        pendingLogins: [],
      });
    }) as FetchImpl;
    const lastRequest = (): CapturedRequest => {
      if (captured === undefined) throw new Error('fetch was not called');
      return captured;
    };
    const transport = new AdminHttpTransport(makeConfig(fetch));

    await transport.openAiOauthStatus('openai-oauth');
    expect(lastRequest().method).toBe('GET');
    expect(lastRequest().url).toContain(
      '/v1/admin/model-providers/openai-oauth/oauth/openai/status',
    );

    await transport.clearOpenAiOauthCredential('openai-oauth', {
      expectedRevision: 7,
    });
    expect(lastRequest().method).toBe('POST');
    expect(lastRequest().url).toContain(
      '/v1/admin/model-providers/openai-oauth/oauth/openai/clear',
    );
    expect(lastRequest().body).toContain('"expectedRevision":7');
  });

  it('lists local tool profiles from the live Crew route and normalizes the wire shape', async () => {
    // Crew returns `{ items: [...] }` with `toolsets`/`tools` fields; the
    // transport normalizes to `{ profiles: [...] }` with
    // `requestedToolsets`/`requestedTools` for the UI.
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        items: [
          {
            id: 'research',
            displayName: 'Research',
            enabled: true,
            system: false,
            readOnly: false,
            toolsets: ['web'],
            tools: ['web.search'],
            revision: 2,
          },
        ],
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const result = await transport.localToolProfiles();

    const req = lastRequest();
    expect(req.method).toBe('GET');
    expect(req.url).toContain('/v1/admin/local-tool-profiles');
    expect(req.url).not.toContain('/v1/admin/tool-profiles/');
    expect(result.profiles).toHaveLength(1);
    const profile = result.profiles[0];
    if (profile === undefined) throw new Error('expected one profile');
    expect(profile.id).toBe('research');
    expect(profile.requestedToolsets).toEqual(['web']);
    expect(profile.requestedTools).toEqual(['web.search']);
    expect(profile.revision).toBe(2);
  });

  it('defaults missing selection arrays to empty when listing local tool profiles', async () => {
    const { fetch } = capturingFetch(
      jsonOk({
        items: [{ id: 'bare', enabled: true, system: true, readOnly: true }],
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const result = await transport.localToolProfiles();

    const profile = result.profiles[0];
    if (profile === undefined) throw new Error('expected one profile');
    expect(profile.requestedToolsets).toEqual([]);
    expect(profile.requestedTools).toEqual([]);
  });

  it('creates a local tool profile, mapping selection fields to the Crew wire spelling', async () => {
    // Crew write routes wrap the persisted record under data.profile.
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        profile: {
          id: 'research',
          enabled: true,
          system: false,
          readOnly: false,
          toolsets: ['web'],
          tools: ['web.search'],
        },
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const created = await transport.createLocalToolProfile({
      id: 'research',
      displayName: 'Research',
      enabled: true,
      requestedToolsets: ['web'],
      requestedTools: ['web.search'],
    });

    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain('/v1/admin/local-tool-profiles');
    const body = JSON.parse(req.body ?? '{}');
    // Wire spelling, not the UI-facing field names.
    expect(body.toolsets).toEqual(['web']);
    expect(body.tools).toEqual(['web.search']);
    expect('requestedToolsets' in body).toBe(false);
    expect('requestedTools' in body).toBe(false);
    // Response is unwrapped from data.profile and normalized to UI names.
    expect(created.id).toBe('research');
    expect(created.requestedToolsets).toEqual(['web']);
  });

  it('updates a local tool profile via PATCH on the live Crew route', async () => {
    // Crew write routes wrap the persisted record under data.profile.
    const { fetch, lastRequest } = capturingFetch(
      jsonOk({
        profile: {
          id: 'research',
          enabled: false,
          system: false,
          readOnly: false,
          toolsets: ['web'],
          tools: [],
          revision: 5,
        },
      }),
    );
    const transport = new AdminHttpTransport(makeConfig(fetch));

    const updated = await transport.updateLocalToolProfile('research', {
      enabled: false,
      requestedToolsets: ['web'],
      expectedRevision: 4,
    });

    const req = lastRequest();
    expect(req.method).toBe('PATCH');
    expect(req.url).toContain('/v1/admin/local-tool-profiles/research');
    const body = JSON.parse(req.body ?? '{}');
    expect(body.toolsets).toEqual(['web']);
    expect(body.enabled).toBe(false);
    expect(body.expectedRevision).toBe(4);
    // Response is unwrapped from data.profile and normalized.
    expect(updated.id).toBe('research');
    expect(updated.revision).toBe(5);
    expect(updated.requestedToolsets).toEqual(['web']);
  });

  it('deletes a local tool profile via DELETE on the live Crew route', async () => {
    const { fetch, lastRequest } = capturingFetch(jsonOk({}));
    const transport = new AdminHttpTransport(makeConfig(fetch));

    await transport.deleteLocalToolProfile('research');

    const req = lastRequest();
    expect(req.method).toBe('DELETE');
    expect(req.url).toContain('/v1/admin/local-tool-profiles/research');
  });
});
