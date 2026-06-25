import { describe, expect, it } from 'vitest';

import { AdminHttpTransport } from './admin-http-transport';
import type { ChatTransportConfig, FetchImpl } from './chat-transport-config';
import { resolveChatTransportConfig } from './chat-transport-config';

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
});
