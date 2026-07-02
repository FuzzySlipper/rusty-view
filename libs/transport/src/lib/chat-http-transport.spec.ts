import type {
  ChatEvent,
  ChatEventPage,
  ChatSessionPage,
  ChatSessionOpenResult,
  SendChatMessageResult,
  ChatCommandRegistry,
} from '@rusty-view/protocol';
import { describe, expect, it } from 'vitest';

import { ChatHttpTransport } from './chat-http-transport';
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
        provider: { alias: 'main', status: 'active', model_id: 'm1' },
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
      expect(result.context_strategy.strategy_id).toBe('sliding-window');
      expect(lastRequest().url).toContain('/v1/chat/sessions/sess_1/context');
      expect(lastRequest().method).toBe('GET');
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
