import { describe, expect, it } from 'vitest';

import { AdminHttpTransport } from './admin-http-transport';
import type { ChatTransportConfig, FetchImpl } from './chat-transport-config';
import { resolveChatTransportConfig } from './chat-transport-config';
import type { AdminProfileRegistryDiagnostics } from './admin-api-types';

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
        items: [
          { id: 'bare', enabled: true, system: true, readOnly: true },
        ],
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
