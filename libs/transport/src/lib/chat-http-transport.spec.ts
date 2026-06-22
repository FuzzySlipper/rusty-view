import type {
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
      }
    });
  });
});
