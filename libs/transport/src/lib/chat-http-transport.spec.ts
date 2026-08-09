import type {
  ChatEvent,
  ChatEventPage,
  ChatSessionPage,
  ChatSessionOpenResult,
  SendChatMessageResult,
  ChatCommandRegistry,
  ToolCallDebugDetail,
  ProviderRequestDebugDetail,
} from '@rusty-view/protocol';
import { describe, expect, it } from 'vitest';

import { ChatHttpTransport } from './chat-http-transport';
import { ExternalRuntimeHttpTransport } from './external-runtime-http-transport';
import type { ChatTransportConfig, FetchImpl } from './chat-transport-config';
import { resolveChatTransportConfig } from './chat-transport-config';
import { ChatTransportError } from './chat-transport-error';

function makeConfig(
  opts: {
    baseUrl?: string;
    bearerToken?: string;
    fetchImpl?: FetchImpl;
  } = {},
): ChatTransportConfig {
  return resolveChatTransportConfig({
    baseUrl: opts.baseUrl ?? 'http://localhost:9347',
    timeoutMs: 5_000,
    reconnectInitialMs: 100,
    reconnectMaxMs: 1_000,
    reconnectMaxAttempts: 3,
    ...(opts.bearerToken !== undefined
      ? { bearerToken: opts.bearerToken }
      : {}),
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
  });
}

function jsonOk(data: unknown): Response {
  const body = JSON.stringify({
    ok: true,
    data,
    meta: { request_id: 'req_test', schema_version: 1 },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonError(status: number, code: string, message: string): Response {
  const body = JSON.stringify({
    ok: false,
    error: { code, reason_code: 'test', message, retryable: false },
    meta: { request_id: 'req_test', schema_version: 1 },
  });
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
}

function capturingFetch(response: Response): {
  fetch: FetchImpl;
  lastRequest: () => CapturedRequest;
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

/**
 * A fetch that resolves with `response` after `delayMs`, but honors the request's
 * abort signal: if the signal aborts first (e.g. AbortSignal.timeout fires), it
 * rejects with the signal's reason — mirroring how a real fetch behaves when the
 * configured timeout elapses before the response arrives.
 */
function signalHonoringFetch(
  delayMs: number,
  response: Response,
): { fetch: FetchImpl; lastSignal: () => AbortSignal | undefined } {
  let seen: AbortSignal | undefined;
  let called = false;
  const fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    seen = init?.signal ?? undefined;
    called = true;
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      const timer = setTimeout(() => resolve(response), delayMs);
      if (signal !== undefined && signal !== null) {
        if (signal.aborted) {
          clearTimeout(timer);
          reject(signal.reason);
          return;
        }
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(signal.reason);
        });
      }
    });
  }) as FetchImpl;
  return {
    fetch,
    lastSignal: () => {
      if (!called) {
        throw new Error('fetch was not called');
      }
      return seen;
    },
  };
}

describe('ChatHttpTransport', () => {
  describe('readAttachmentContent', () => {
    it('fetches opaque relative content through configured auth and returns exact bytes', async () => {
      const expected = new Uint8Array([137, 80, 78, 71]);
      const { fetch, lastRequest } = capturingFetch(
        new Response(expected, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );
      const transport = new ChatHttpTransport(
        makeConfig({ fetchImpl: fetch, bearerToken: 'media-token' }),
      );

      const blob = await transport.readAttachmentContent(
        '/v1/chat/sessions/session-1/attachments/attachment%3Aproof/content',
      );

      expect(lastRequest().url).toBe(
        'http://localhost:9347/v1/chat/sessions/session-1/attachments/attachment%3Aproof/content',
      );
      expect(lastRequest().headers.get('Authorization')).toBe(
        'Bearer media-token',
      );
      expect(blob.type).toBe('image/png');
      expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([
        137, 80, 78, 71,
      ]);
    });
  });

  describe('listSessions', () => {
    it('sends GET to /v1/chat/sessions', async () => {
      const page: ChatSessionPage = {
        items: [],
        total: 0,
        limit: 100,
        offset: 0,
      };
      const { fetch, lastRequest } = capturingFetch(jsonOk(page));
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      const result = await transport.listSessions();
      expect(result.total).toBe(0);
      expect(lastRequest().url).toContain('/v1/chat/sessions');
      expect(lastRequest().method).toBe('GET');
    });

    it('appends query params for limit, offset, profile_id, status', async () => {
      const { fetch, lastRequest } = capturingFetch(
        jsonOk({ items: [], total: 0, limit: 5, offset: 10 }),
      );
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      await transport.listSessions({
        limit: 5,
        offset: 10,
        profile_id: 'prof_1',
        status: 'active',
      });

      const url = new URL(lastRequest().url);
      expect(url.searchParams.get('limit')).toBe('5');
      expect(url.searchParams.get('offset')).toBe('10');
      expect(url.searchParams.get('profile_id')).toBe('prof_1');
      expect(url.searchParams.get('status')).toBe('active');
    });
  });

  describe('createCrewSession', () => {
    it('posts profile identity, revision, and session workspace with an idempotency key', async () => {
      const result = {
        creation: {
          requestFingerprint: 'sha256:test',
          profileRevision: 8,
          outcome: 'created' as const,
          session: { sessionId: 'crew-session-1' },
        },
        applyResult: {},
      };
      const { fetch, lastRequest } = capturingFetch(jsonOk(result));
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      await expect(
        transport.createCrewSession(
          {
            profile_id: 'software-engineer',
            expected_profile_revision: 7,
            workspace_cwd: '/home/dev/project-a',
          },
          'crew-create-key',
        ),
      ).resolves.toEqual(result);

      const request = lastRequest();
      expect(request.url).toBe('http://localhost:9347/v1/chat/sessions');
      expect(request.method).toBe('POST');
      expect(request.headers.get('Idempotency-Key')).toBe('crew-create-key');
      expect(JSON.parse(request.body ?? '')).toEqual({
        profile_id: 'software-engineer',
        expected_profile_revision: 7,
        workspace_cwd: '/home/dev/project-a',
      });
    });
  });

  describe('auth modes', () => {
    it('does not send Authorization in no-auth mode', async () => {
      const { fetch, lastRequest } = capturingFetch(
        jsonOk({ items: [], total: 0, limit: 100, offset: 0 }),
      );
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      await transport.listSessions();
      expect(lastRequest().headers.get('Authorization')).toBeNull();
    });

    it('sends Authorization: Bearer <token> in bearer mode', async () => {
      const { fetch, lastRequest } = capturingFetch(
        jsonOk({ items: [], total: 0, limit: 100, offset: 0 }),
      );
      const transport = new ChatHttpTransport(
        makeConfig({ bearerToken: 'secret-token', fetchImpl: fetch }),
      );

      await transport.listSessions();
      expect(lastRequest().headers.get('Authorization')).toBe(
        'Bearer secret-token',
      );
    });
  });

  describe('openSession', () => {
    it('substitutes session_id in the path', async () => {
      const openResult: ChatSessionOpenResult = {
        session: {
          session_id: 'sess_1',
          agent_id: 'agent_1',
          profile_id: 'prof_1',
          kind: 'full',
          status: 'active',
          latest_cursor: 'cur_0',
          updated_at: '2026-06-22T10:00:00Z',
        },
        events: [],
        latest_cursor: 'cur_0',
        has_more_before: false,
      };
      const { fetch, lastRequest } = capturingFetch(jsonOk(openResult));
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      await transport.openSession('sess_1');
      expect(lastRequest().url).toContain('/v1/chat/sessions/sess_1');
    });

    it('normalizes known and future event kinds through the shared event boundary', async () => {
      const openResult = {
        session: {
          session_id: 'sess_1',
          agent_id: 'agent_1',
          profile_id: 'prof_1',
          kind: 'full',
          status: 'idle',
          latest_cursor: 'sess_1:1',
          updated_at: '2026-06-22T10:00:00Z',
        },
        events: [
          {
            event_id: 'sess_1:0',
            session_id: 'sess_1',
            sequence_id: 0,
            created_at: '2026-06-22T10:00:00Z',
            kind: 'runtime_rebuild_transition',
            payload: { outcome: 'reconstructed', transitionId: 'transition_1' },
          },
          {
            event_id: 'sess_1:1',
            session_id: 'sess_1',
            sequence_id: 1,
            created_at: '2026-06-22T10:00:01Z',
            kind: 'future_runtime_event',
            payload: { detail: 'preserve me' },
          },
        ],
        latest_cursor: 'sess_1:1',
        has_more_before: false,
      };
      const { fetch } = capturingFetch(jsonOk(openResult));
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      const result = await transport.openSession('sess_1');

      expect(result.events[0]?.kind).toBe('runtime_rebuild_transition');
      expect(result.events[1]?.kind).toBe('unknown');
      expect(result.events[1]?.payload).toMatchObject({
        raw: { original_kind: 'future_runtime_event' },
      });
    });
  });

  describe('replayEventsPage', () => {
    it('normalizes replayed events before returning them to the store', async () => {
      const page = {
        items: [
          {
            event_id: 'sess_1:4',
            session_id: 'sess_1',
            sequence_id: 4,
            created_at: '2026-06-22T10:00:04Z',
            kind: 'runtime_rebuild_transition',
            payload: { outcome: 'preserved', transitionId: 'transition_2' },
          },
        ],
        latest_cursor: 'sess_1:4',
        has_more: false,
      };
      const { fetch } = capturingFetch(jsonOk(page));
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      const result = await transport.replayEventsPage('sess_1');

      expect(result.items[0]?.kind).toBe('runtime_rebuild_transition');
      expect(result.items[0]?.payload).toMatchObject({
        outcome: 'preserved',
      });
    });
  });

  describe('sendMessage', () => {
    it('sends POST with JSON body, Content-Type, and Idempotency-Key', async () => {
      const result: SendChatMessageResult = {
        status: 'accepted',
        message_id: 'msg_1',
        latest_cursor: 'cur_1',
      };
      const { fetch, lastRequest } = capturingFetch(jsonOk(result));
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      await transport.sendMessage(
        'sess_1',
        { actor: { id: 'u1', kind: 'human' }, body: 'Hello' },
        'idem-key-123',
      );

      const req = lastRequest();
      expect(req.method).toBe('POST');
      expect(req.url).toContain('/v1/chat/sessions/sess_1/messages');
      expect(req.headers.get('Content-Type')).toBe('application/json');
      expect(req.headers.get('Idempotency-Key')).toBe('idem-key-123');
      expect(req.body).toContain('Hello');
    });

    it('works without an idempotency key', async () => {
      const result: SendChatMessageResult = {
        status: 'accepted',
        message_id: 'msg_1',
        latest_cursor: 'cur_1',
      };
      const { fetch, lastRequest } = capturingFetch(jsonOk(result));
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      await transport.sendMessage('sess_1', {
        actor: { id: 'u1', kind: 'human' },
        body: 'Hello',
      });

      expect(lastRequest().headers.get('Idempotency-Key')).toBeNull();
    });
  });

  describe('write timeout (#3848)', () => {
    const acceptedResult = (): Response =>
      jsonOk({ status: 'accepted', message_id: 'm', latest_cursor: 'c' });

    function configWith(
      overrides: Partial<{
        timeoutMs: number;
        writeTimeoutMs: number;
        fetchImpl: FetchImpl;
      }>,
    ): ChatTransportConfig {
      return resolveChatTransportConfig({
        baseUrl: 'http://localhost:9347',
        ...overrides,
      });
    }

    it('does not apply the short read timeout to send-message', async () => {
      // Response arrives after the read timeout but well within the write one:
      // the old behavior aborted this POST at timeoutMs ("canceled" in devtools).
      const { fetch } = signalHonoringFetch(60, acceptedResult());
      const transport = new ChatHttpTransport(
        configWith({ timeoutMs: 15, writeTimeoutMs: 5_000, fetchImpl: fetch }),
      );

      const result = await transport.sendMessage('sess_1', {
        actor: { id: 'u1', kind: 'human' },
        body: 'Hello',
      });
      expect(result.status).toBe('accepted');
    });

    it('still applies the read timeout to GET requests', async () => {
      const { fetch } = signalHonoringFetch(
        60,
        jsonOk({ items: [], total: 0, limit: 100, offset: 0 }),
      );
      const transport = new ChatHttpTransport(
        configWith({ timeoutMs: 15, writeTimeoutMs: 5_000, fetchImpl: fetch }),
      );

      await expect(transport.listSessions()).rejects.toBeInstanceOf(
        ChatTransportError,
      );
    });

    it('omits the abort signal entirely when writeTimeoutMs is 0', async () => {
      const { fetch, lastSignal } = signalHonoringFetch(0, acceptedResult());
      const transport = new ChatHttpTransport(
        configWith({ writeTimeoutMs: 0, fetchImpl: fetch }),
      );

      await transport.sendMessage('sess_1', {
        actor: { id: 'u1', kind: 'human' },
        body: 'Hello',
      });
      expect(lastSignal()).toBeUndefined();
    });
  });

  describe('listCommands', () => {
    it('sends GET to /v1/chat/commands', async () => {
      const registry: ChatCommandRegistry = { commands: [] };
      const { fetch, lastRequest } = capturingFetch(jsonOk(registry));
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      const result = await transport.listCommands();
      expect(result.commands).toEqual([]);
      expect(lastRequest().url).toContain('/v1/chat/commands');
    });
  });

  describe('sessionContext', () => {
    it('sends GET to /v1/chat/sessions/{id}/context and unwraps the result', async () => {
      const usage = {
        session_id: 'sess_1',
        agent_id: 'agent_1',
        profile_id: 'prof_1',
        provider: {
          alias: 'main',
          status: 'active',
          model_id: 'm1',
          reasoning_effort: 'high',
          reasoning_effort_source: 'session_override',
          provider_reasoning_effort: 'medium',
          session_reasoning_effort_override: 'high',
        },
        brain: { backend: 'openai' },
        context_strategy: {
          strategy_id: 'sliding-window',
          enabled: true,
          auto_compaction_enabled: true,
          compact_at_percent: 80,
          target_percent_after_compaction: 40,
          max_context_percent_for_wake: 90,
          debug_visibility: 'status',
          include_debug_events_in_model_context: false,
        },
        tools: { tool_count: 3, mcp_binding_count: 1, mcp_active_count: 1 },
        context: {
          estimate_quality: 'approximate',
          estimate_method: 'sampled',
          estimator_id: 'tok-1',
          sampled_event_count: 12,
          sampled_message_count: 8,
        },
        degraded: false,
        diagnostics: [],
      };
      const { fetch, lastRequest } = capturingFetch(jsonOk(usage));
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      const result = await transport.sessionContext('sess_1');
      expect(result.provider.alias).toBe('main');
      expect(result.provider.reasoning_effort).toBe('high');
      expect(result.provider.reasoning_effort_source).toBe('session_override');
      expect(result.provider.provider_reasoning_effort).toBe('medium');
      expect(result.provider.session_reasoning_effort_override).toBe('high');
      expect(result.context_strategy.strategy_id).toBe('sliding-window');
      expect(lastRequest().url).toContain('/v1/chat/sessions/sess_1/context');
      expect(lastRequest().method).toBe('GET');
    });
  });

  describe('toolCallDebugDetail', () => {
    it('sends GET to /v1/chat/sessions/{id}/tool-calls/{debug_detail_id}', async () => {
      const detail: ToolCallDebugDetail = {
        debug_detail_id: 'dbg_1',
        tool_call_id: 'tc_1',
        session_id: 'sess_1',
        wake_id: 'wake_1',
        tool_name: 'search',
        status: 'completed',
        arguments: {
          value: { q: 'debug' },
          truncated: false,
          redacted: false,
        },
        partial_updates: [],
        final_result: {
          value: { ok: true },
          truncated: true,
          redacted: false,
          sha256: 'abc123',
          originalJsonChars: 1200,
        },
        source_metadata: { source: 'mcp' },
        started_at: '2026-07-03T22:00:00Z',
        updated_at: '2026-07-03T22:00:01Z',
        expires_at: '2026-07-03T23:00:00Z',
        limits: { max_chars: 1024 },
      };
      const { fetch, lastRequest } = capturingFetch(jsonOk(detail));
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      const result = await transport.toolCallDebugDetail('sess_1', 'dbg_1');

      expect(result.final_result?.truncated).toBe(true);
      expect(lastRequest().url).toContain(
        '/v1/chat/sessions/sess_1/tool-calls/dbg_1',
      );
      expect(lastRequest().method).toBe('GET');
    });
  });

  describe('providerRequestDebugDetail', () => {
    it('sends GET to /v1/chat/sessions/{id}/provider-requests/{debug_detail_id}', async () => {
      const detail: ProviderRequestDebugDetail = {
        debug_detail_id: 'prd_1',
        session_id: 'sess_1',
        wake_id: 'wake_1',
        provider: {
          brain_module: 'openai-responses',
          provider_alias: 'main',
          model: 'gpt-test',
          protocol: 'responses',
          provider_kind: 'openai',
        },
        request: {
          value: { model: 'gpt-test', input: [{ role: 'user' }] },
          truncated: false,
          redacted: true,
        },
        request_sha256: 'abc123',
        request_json_chars: 420,
        recorded_at: '2026-07-05T00:00:00Z',
        expires_at: '2026-07-05T01:00:00Z',
        limits: { max_chars: 4096 },
      };
      const { fetch, lastRequest } = capturingFetch(jsonOk(detail));
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      const result = await transport.providerRequestDebugDetail(
        'sess_1',
        'prd_1',
      );

      expect(result.provider.protocol).toBe('responses');
      expect(lastRequest().url).toContain(
        '/v1/chat/sessions/sess_1/provider-requests/prd_1',
      );
      expect(lastRequest().method).toBe('GET');
    });
  });

  describe('message variants and conversation tree', () => {
    it('lists message slots with alternates query params', async () => {
      const { fetch, lastRequest } = capturingFetch(
        jsonOk({ items: [], total: 0, limit: 10, offset: 5 }),
      );
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      const result = await transport.listMessageSlots('sess_1', {
        limit: 10,
        offset: 5,
        include_alternates: true,
      });

      const url = new URL(lastRequest().url);
      expect(result.total).toBe(0);
      expect(lastRequest().method).toBe('GET');
      expect(url.pathname).toBe('/v1/chat/sessions/sess_1/slots');
      expect(url.searchParams.get('include_alternates')).toBe('true');
    });

    it('selects and deletes message variants through slot routes', async () => {
      const { fetch, lastRequest } = capturingFetch(
        jsonOk({
          status: 'selected',
          latest_cursor: 'cur_2',
          slot: {
            slot_id: 'slot_1',
            session_id: 'sess_1',
            primary_message_id: 'msg_1',
            active_variant_id: 'variant_2',
            variant_count: 2,
            updated_at: '2026-07-05T00:00:00Z',
          },
        }),
      );
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      await transport.selectActiveMessageVariant('sess_1', 'slot_1', {
        active_variant_id: 'variant_2',
        expected: { type: 'any' },
      });

      expect(lastRequest().method).toBe('POST');
      expect(new URL(lastRequest().url).pathname).toBe(
        '/v1/chat/sessions/sess_1/slots/slot_1/active-variant',
      );
      expect(lastRequest().body).toContain('variant_2');

      const deleteFetch = capturingFetch(
        jsonOk({
          status: 'deleted',
          latest_cursor: 'cur_3',
          slot: {
            slot_id: 'slot_1',
            session_id: 'sess_1',
            primary_message_id: 'msg_1',
            active_variant_id: null,
            variant_count: 1,
            updated_at: '2026-07-05T00:00:01Z',
          },
        }),
      );
      const deleteTransport = new ChatHttpTransport(
        makeConfig({ fetchImpl: deleteFetch.fetch }),
      );

      await deleteTransport.deleteMessageVariant(
        'sess_1',
        'slot_1',
        'variant_2',
      );

      expect(deleteFetch.lastRequest().method).toBe('DELETE');
      expect(new URL(deleteFetch.lastRequest().url).pathname).toBe(
        '/v1/chat/sessions/sess_1/slots/slot_1/variants/variant_2',
      );
    });

    it('loads tree state and selects an active branch', async () => {
      const { fetch, lastRequest } = capturingFetch(
        jsonOk({
          branches: [],
          snapshots: [],
          branch_state: {
            session_id: 'sess_1',
            active_branch_id: 'branch_2',
            updated_at: '2026-07-05T00:00:00Z',
          },
          active_branch_id: 'branch_2',
        }),
      );
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      await transport.conversationTree('sess_1', {
        limit: 20,
        exclude_snapshots: true,
      });

      const url = new URL(lastRequest().url);
      expect(lastRequest().method).toBe('GET');
      expect(url.pathname).toBe('/v1/chat/sessions/sess_1/tree');
      expect(url.searchParams.get('exclude_snapshots')).toBe('true');

      const branchFetch = capturingFetch(
        jsonOk({
          status: 'selected',
          latest_cursor: 'cur_4',
          state: {
            session_id: 'sess_1',
            active_branch_id: 'branch_2',
            updated_at: '2026-07-05T00:00:01Z',
          },
        }),
      );
      const branchTransport = new ChatHttpTransport(
        makeConfig({ fetchImpl: branchFetch.fetch }),
      );

      await branchTransport.selectActiveConversationBranch('sess_1', {
        active_branch_id: 'branch_2',
        expected: { type: 'any' },
      });

      expect(branchFetch.lastRequest().method).toBe('POST');
      expect(new URL(branchFetch.lastRequest().url).pathname).toBe(
        '/v1/chat/sessions/sess_1/branches/active',
      );
      expect(branchFetch.lastRequest().body).toContain('branch_2');
    });
  });

  describe('error handling', () => {
    it('throws auth_error on 401', async () => {
      const { fetch } = capturingFetch(
        jsonError(401, 'unauthorized', 'Token expired'),
      );
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      await expect(transport.listSessions()).rejects.toThrow(
        ChatTransportError,
      );
      try {
        await transport.listSessions();
      } catch (error) {
        const transportError = error as ChatTransportError;
        expect(transportError.code).toBe('auth_error');
        expect(transportError.statusCode).toBe(401);
        expect(transportError.endpoint).toContain('/v1/chat/sessions');
      }
    });

    it('throws http_error on 404', async () => {
      const { fetch } = capturingFetch(
        jsonError(404, 'not_found', 'Session not found'),
      );
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      try {
        await transport.openSession('missing');
        throw new Error('should have thrown');
      } catch (error) {
        const transportError = error as ChatTransportError;
        expect(transportError.code).toBe('http_error');
        expect(transportError.statusCode).toBe(404);
        expect(transportError.endpoint).toContain('/v1/chat/sessions/missing');
      }
    });

    it('throws envelope_error when ok=false', async () => {
      const { fetch } = capturingFetch(
        jsonError(200, 'failed_precondition', 'Session blocked'),
      );
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      try {
        await transport.listSessions();
        throw new Error('should have thrown');
      } catch (error) {
        const transportError = error as ChatTransportError;
        expect(transportError.code).toBe('envelope_error');
        expect(transportError.message).toBe('Session blocked');
      }
    });

    it('wraps network errors', async () => {
      const fetch = (async () => {
        throw new TypeError('fetch failed');
      }) as FetchImpl;
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      try {
        await transport.listSessions();
        throw new Error('should have thrown');
      } catch (error) {
        const transportError = error as ChatTransportError;
        expect(transportError.code).toBe('network_error');
        expect(transportError.endpoint).toContain('/v1/chat/sessions');
      }
    });
  });

  describe('replayAllEvents (paged replay, task #3865)', () => {
    function replayEvent(id: string): ChatEvent {
      return {
        event_id: id,
        session_id: 'sess_1',
        sequence_id: Number(id.replace(/\D/g, '')) || 0,
        created_at: '2026-06-22T10:00:00Z',
        kind: 'assistant_text_delta',
        payload: { wake_id: 'w', text: id },
      };
    }

    /** A fetch that returns each queued page in turn, capturing request URLs. */
    function queuedFetch(pages: ChatEventPage[]): {
      fetch: FetchImpl;
      urls: () => string[];
    } {
      const urls: string[] = [];
      let call = 0;
      const fetch = (async (input: RequestInfo | URL): Promise<Response> => {
        urls.push(input.toString());
        const page = pages[Math.min(call, pages.length - 1)];
        call += 1;
        return jsonOk(page);
      }) as FetchImpl;
      return { fetch, urls: () => urls };
    }

    it('follows has_more across pages, concatenating events and advancing the cursor', async () => {
      const { fetch, urls } = queuedFetch([
        {
          items: [replayEvent('e1'), replayEvent('e2')],
          latest_cursor: 'e2',
          has_more: true,
        },
        { items: [replayEvent('e3')], latest_cursor: 'e3', has_more: false },
      ]);
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      const events = await transport.replayAllEvents('sess_1', {
        cursor: 'e0',
      });

      expect(events.map((e) => e.event_id)).toEqual(['e1', 'e2', 'e3']);
      expect(urls()).toHaveLength(2);
      // Page 1 uses the caller's cursor; page 2 follows the returned latest_cursor.
      expect(new URL(urls()[0] as string).searchParams.get('cursor')).toBe(
        'e0',
      );
      expect(new URL(urls()[1] as string).searchParams.get('cursor')).toBe(
        'e2',
      );
    });

    it('returns a single page when has_more is false', async () => {
      const { fetch, urls } = queuedFetch([
        { items: [replayEvent('e1')], latest_cursor: 'e1', has_more: false },
      ]);
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      const events = await transport.replayAllEvents('sess_1');

      expect(events.map((e) => e.event_id)).toEqual(['e1']);
      expect(urls()).toHaveLength(1);
    });

    it('stops when the cursor fails to advance (malformed-cursor guard)', async () => {
      // has_more stays true but latest_cursor never moves past the input cursor.
      const { fetch, urls } = queuedFetch([
        { items: [replayEvent('e1')], latest_cursor: 'e0', has_more: true },
      ]);
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      const events = await transport.replayAllEvents('sess_1', {
        cursor: 'e0',
      });

      expect(events.map((e) => e.event_id)).toEqual(['e1']);
      expect(urls()).toHaveLength(1);
    });

    it('caps at MAX_REPLAY_PAGES when has_more never turns false', async () => {
      let n = 0;
      const fetch = (async (): Promise<Response> => {
        n += 1;
        return jsonOk({
          items: [replayEvent(`e${n}`)],
          latest_cursor: `e${n}`,
          has_more: true,
        } satisfies ChatEventPage);
      }) as FetchImpl;
      const transport = new ChatHttpTransport(makeConfig({ fetchImpl: fetch }));

      const events = await transport.replayAllEvents('sess_1');

      expect(events).toHaveLength(ChatHttpTransport.MAX_REPLAY_PAGES);
    });
  });
});

describe('ExternalRuntimeHttpTransport', () => {
  it('maps a selected thread event query to the snake-case HTTP contract', async () => {
    const { fetch, lastRequest } = capturingFetch(jsonOk({ events: [] }));
    const transport = new ExternalRuntimeHttpTransport(
      makeConfig({ fetchImpl: fetch }),
    );

    await transport.listEvents('runtime-1', {
      after: 40,
      limit: 25,
      nativeThreadId: 'thread-1',
    });

    const url = new URL(lastRequest().url);
    expect(url.pathname).toBe('/v1/external-runtimes/runtime-1/events');
    expect(url.searchParams.get('after')).toBe('40');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('native_thread_id')).toBe('thread-1');
    expect(url.searchParams.has('nativeThreadId')).toBe(false);
  });
});
