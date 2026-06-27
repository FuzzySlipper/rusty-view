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
});
