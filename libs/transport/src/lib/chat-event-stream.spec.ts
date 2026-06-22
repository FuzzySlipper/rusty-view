import type { ChatEvent } from '@rusty-view/protocol';
import { describe, expect, it } from 'vitest';

import { ChatEventStream, calculateBackoffDelay } from './chat-event-stream';
import type { SleepFunction } from './chat-event-stream';
import type { ChatTransportConfig, FetchImpl } from './chat-transport-config';
import { resolveChatTransportConfig } from './chat-transport-config';
import type { ChatConnectionState } from './connection-state';

function makeConfig(
  opts: {
    baseUrl?: string;
    bearerToken?: string;
    reconnectMaxAttempts?: number;
  } = {},
): ChatTransportConfig {
  return resolveChatTransportConfig({
    baseUrl: opts.baseUrl ?? 'http://localhost:9347',
    timeoutMs: 5_000,
    reconnectInitialMs: 10,
    reconnectMaxMs: 100,
    reconnectMaxAttempts: opts.reconnectMaxAttempts ?? 5,
    ...(opts.bearerToken !== undefined
      ? { bearerToken: opts.bearerToken }
      : {}),
  });
}

const instantSleep: SleepFunction = () => Promise.resolve();

function sseEvent(
  eventId: string,
  sequenceId: number,
  kind: string,
  payload: unknown,
): string {
  const data = JSON.stringify({
    event_id: eventId,
    session_id: 'sess_1',
    sequence_id: sequenceId,
    created_at: '2026-06-22T10:00:00Z',
    kind,
    payload,
  });
  return `id: ${eventId}\ndata: ${data}\n\n`;
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

interface FetchCall {
  url: string;
  headers: Headers;
}

function sequentialFetch(responses: Response[]): {
  fetch: FetchImpl;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let index = 0;
  const fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({
      url: input.toString(),
      headers: new Headers(init?.headers),
    });
    const response =
      index < responses.length
        ? responses[index]
        : (responses[responses.length - 1] as Response);
    index += 1;
    return response;
  };
  return { fetch: fetch as FetchImpl, calls };
}

describe('calculateBackoffDelay', () => {
  it('returns initialMs for attempt 0', () => {
    expect(calculateBackoffDelay(0, 500, 30_000)).toBe(500);
  });

  it('doubles for each subsequent attempt', () => {
    expect(calculateBackoffDelay(1, 500, 30_000)).toBe(1_000);
    expect(calculateBackoffDelay(2, 500, 30_000)).toBe(2_000);
    expect(calculateBackoffDelay(3, 500, 30_000)).toBe(4_000);
  });

  it('caps at maxMs', () => {
    expect(calculateBackoffDelay(10, 500, 30_000)).toBe(30_000);
    expect(calculateBackoffDelay(100, 500, 30_000)).toBe(30_000);
  });
});

describe('ChatEventStream', () => {
  it('yields events from a single SSE stream', async () => {
    const { fetch } = sequentialFetch([
      sseResponse([
        sseEvent('evt_1', 1, 'message_created', {
          message_id: 'm1',
          role: 'user',
          body: 'hello',
        }),
        sseEvent('evt_2', 2, 'message_created', {
          message_id: 'm2',
          role: 'assistant',
          body: 'hi there',
        }),
      ]),
    ]);

    const stream = new ChatEventStream({
      config: makeConfig({ reconnectMaxAttempts: 1 }),
      sessionId: 'sess_1',
      fetchImpl: fetch,
      sleep: instantSleep,
    });

    const events: ChatEvent[] = [];
    for await (const event of stream.events()) {
      events.push(event);
      if (events.length >= 2) {
        stream.close();
        break;
      }
    }

    expect(events.map((e) => e.event_id)).toEqual(['evt_1', 'evt_2']);
    expect(stream.getLastCursor()).toBe('evt_2');
  });

  it('reconnects after disconnect and resumes from the last cursor', async () => {
    const { fetch, calls } = sequentialFetch([
      // First connection: two events, then stream closes.
      sseResponse([
        sseEvent('evt_1', 1, 'message_created', {
          message_id: 'm1',
          role: 'user',
          body: 'first',
        }),
        sseEvent('evt_2', 2, 'message_created', {
          message_id: 'm2',
          role: 'assistant',
          body: 'second',
        }),
      ]),
      // Second connection (reconnect): one more event.
      sseResponse([
        sseEvent('evt_3', 3, 'message_created', {
          message_id: 'm3',
          role: 'user',
          body: 'third',
        }),
      ]),
    ]);

    const stream = new ChatEventStream({
      config: makeConfig(),
      sessionId: 'sess_1',
      fetchImpl: fetch,
      sleep: instantSleep,
    });

    const events: ChatEvent[] = [];
    for await (const event of stream.events()) {
      events.push(event);
      if (events.length >= 3) {
        stream.close();
        break;
      }
    }

    expect(events.map((e) => e.event_id)).toEqual(['evt_1', 'evt_2', 'evt_3']);
    expect(calls.length).toBe(2);
    // The reconnect must include the last cursor for resume.
    expect(calls[1]?.url).toContain('cursor=evt_2');
    expect(calls[1]?.headers.get('Last-Event-ID')).toBe('evt_2');
  });

  it('tracks connection state through connect → reconnect → connect', async () => {
    const { fetch } = sequentialFetch([
      sseResponse([
        sseEvent('e1', 1, 'message_created', {
          message_id: 'm1',
          role: 'user',
          body: 'a',
        }),
      ]),
      sseResponse([
        sseEvent('e2', 2, 'message_created', {
          message_id: 'm2',
          role: 'user',
          body: 'b',
        }),
      ]),
    ]);

    const stream = new ChatEventStream({
      config: makeConfig(),
      sessionId: 'sess_1',
      fetchImpl: fetch,
      sleep: instantSleep,
    });

    const states: ChatConnectionState[] = [];
    stream.onStateChange((state) => {
      states.push(state);
    });

    for await (const event of stream.events()) {
      if (event.event_id === 'e2') {
        stream.close();
        break;
      }
    }

    const statuses = states.map((s) => s.status);
    expect(statuses).toContain('connecting');
    expect(statuses).toContain('connected');
    expect(statuses).toContain('reconnecting');
    expect(statuses.at(-1)).toBe('closed');
  });

  it('sends Authorization header in bearer mode', async () => {
    const { fetch, calls } = sequentialFetch([
      sseResponse([
        sseEvent('e1', 1, 'message_created', {
          message_id: 'm1',
          role: 'user',
          body: 'hi',
        }),
      ]),
    ]);

    const stream = new ChatEventStream({
      config: makeConfig({ bearerToken: 'tok-abc' }),
      sessionId: 'sess_1',
      fetchImpl: fetch,
      sleep: instantSleep,
    });

    for await (const event of stream.events()) {
      expect(event).toBeDefined();
      stream.close();
      break;
    }

    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer tok-abc');
  });

  it('does not send Authorization header in no-auth mode', async () => {
    const { fetch, calls } = sequentialFetch([
      sseResponse([
        sseEvent('e1', 1, 'message_created', {
          message_id: 'm1',
          role: 'user',
          body: 'hi',
        }),
      ]),
    ]);

    const stream = new ChatEventStream({
      config: makeConfig(),
      sessionId: 'sess_1',
      fetchImpl: fetch,
      sleep: instantSleep,
    });

    for await (const event of stream.events()) {
      expect(event).toBeDefined();
      stream.close();
      break;
    }

    expect(calls[0]?.headers.get('Authorization')).toBeNull();
  });

  it('stops reconnection after max attempts are exhausted', async () => {
    const errorResponse = new Response('Internal Server Error', {
      status: 500,
    });
    const { fetch, calls } = sequentialFetch([
      errorResponse,
      errorResponse,
      errorResponse,
    ]);

    const stream = new ChatEventStream({
      config: makeConfig({ reconnectMaxAttempts: 2 }),
      sessionId: 'sess_1',
      fetchImpl: fetch,
      sleep: instantSleep,
    });

    const events: ChatEvent[] = [];
    let threwReconnectExhausted = false;
    try {
      for await (const event of stream.events()) {
        events.push(event);
      }
    } catch (error) {
      threwReconnectExhausted = (error as Error).message.includes(
        'Max reconnection',
      );
    }

    expect(events).toHaveLength(0);
    expect(threwReconnectExhausted).toBe(true);
    // Should have tried initial + 2 reconnects = 3 fetch calls.
    expect(calls.length).toBe(3);
  });

  it('close() prevents further reconnection', async () => {
    const { fetch, calls } = sequentialFetch([
      sseResponse([
        sseEvent('e1', 1, 'message_created', {
          message_id: 'm1',
          role: 'user',
          body: 'stop',
        }),
      ]),
    ]);

    const stream = new ChatEventStream({
      config: makeConfig({ reconnectMaxAttempts: 10 }),
      sessionId: 'sess_1',
      fetchImpl: fetch,
      sleep: instantSleep,
    });

    for await (const event of stream.events()) {
      expect(event).toBeDefined();
      stream.close();
      break;
    }

    // Only one fetch call — close() prevented reconnection after the stream ended.
    expect(calls.length).toBe(1);
    expect(stream.getState().status).toBe('closed');
  });

  it('coerces unrecognized event kinds without crashing', async () => {
    const futureData = JSON.stringify({
      event_id: 'e_future',
      session_id: 'sess_1',
      sequence_id: 99,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'narrative_branch_created',
      payload: { branch: 'alpha' },
    });
    const { fetch } = sequentialFetch([
      sseResponse([`id: e_future\ndata: ${futureData}\n\n`]),
    ]);

    const stream = new ChatEventStream({
      config: makeConfig({ reconnectMaxAttempts: 1 }),
      sessionId: 'sess_1',
      fetchImpl: fetch,
      sleep: instantSleep,
    });

    let received: ChatEvent | undefined;
    for await (const event of stream.events()) {
      received = event;
      stream.close();
      break;
    }

    expect(received?.kind).toBe('unknown');
    if (received && 'raw' in received.payload) {
      expect(received.payload.summary).toContain('narrative_branch_created');
    }
  });
});
