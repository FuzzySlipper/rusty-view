import { readFileSync } from 'node:fs';

import type { ChatEvent } from '@rusty-view/protocol';
import { describe, expect, it } from 'vitest';

import { ChatEventStream } from './chat-event-stream';
import type { SleepFunction } from './chat-event-stream';
import { ChatTransport } from './chat-transport';
import type { FetchImpl } from './chat-transport-config';
import { ChatTransportError } from './chat-transport-error';

const fixtureRoot = new URL('./recorded-traffic/', import.meta.url);

function readFixture(name: string): string {
  return readFileSync(new URL(name, fixtureRoot), 'utf8');
}

function jsonFixtureResponse(name: string, status = 200): Response {
  return new Response(readFixture(name), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseFixtureResponse(name: string): Response {
  const encoder = new TextEncoder();
  const body = readFixture(name);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}

function recordedFetch(): FetchImpl {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input.toString());
    const path = url.pathname;

    if (path === '/v1/chat/sessions') {
      return jsonFixtureResponse('chat-session-page.json');
    }
    if (path === '/v1/chat/sessions/sess-recorded') {
      return jsonFixtureResponse('chat-session-open.json');
    }
    if (path === '/v1/chat/sessions/missing') {
      return jsonFixtureResponse('error-envelope.json', 404);
    }
    if (path === '/v1/chat/sessions/sess-recorded/events') {
      const cursor = url.searchParams.get('cursor');
      return jsonFixtureResponse(
        cursor === 'evt-0005'
          ? 'chat-replay-page-2.json'
          : 'chat-replay-page-1.json',
      );
    }
    if (path === '/v1/admin/diagnostics') {
      return jsonFixtureResponse('admin-diagnostics.json');
    }
    if (path === '/v1/admin/model-providers') {
      return jsonFixtureResponse('admin-model-providers.json');
    }

    throw new Error(`Unhandled recorded fixture route: ${url.toString()}`);
  }) as FetchImpl;
}

const instantSleep: SleepFunction = () => Promise.resolve();

function transport(): ChatTransport {
  return new ChatTransport({
    baseUrl: 'http://recorded.test',
    timeoutMs: 5_000,
    reconnectInitialMs: 10,
    reconnectMaxMs: 10,
    reconnectMaxAttempts: 1,
    fetchImpl: recordedFetch(),
  });
}

describe('recorded Rusty Crew transport conformance fixtures', () => {
  it('replays recorded chat session HTTP traffic through ChatTransport', async () => {
    const client = transport();

    const sessions = await client.listSessions();
    expect(sessions.items.map((session) => session.session_id)).toEqual([
      'sess-recorded',
    ]);

    const open = await client.openSession('sess-recorded');
    expect(open.session.profile_id).toBe('tester');
    expect(open.events.map((event) => event.event_id)).toEqual([
      'evt-0001',
      'evt-0002',
    ]);

    const replayed = await client.replayAllEvents('sess-recorded', {
      cursor: open.latest_cursor,
      limit: 3,
    });
    expect(replayed.map((event) => event.event_id)).toEqual([
      'evt-0003',
      'evt-0004',
      'evt-0005',
      'evt-0006',
      'evt-0007',
    ]);
    expect(replayed.at(-1)?.kind).toBe('assistant_turn_finished');
  });

  it('replays recorded admin/provider traffic through ChatTransport admin methods', async () => {
    const client = transport();

    const diagnostics = await client.adminDiagnostics();
    expect(diagnostics.overview.runtime.brainModules[0]?.profileId).toBe(
      'tester',
    );

    const providers = await client.adminModelProviders({ limit: 100 });
    expect(providers.items[0]?.alias).toBe('cheap-tester');
    expect(providers.items[0]?.credential.hasSecret).toBe(false);
  });

  it('preserves recorded error envelopes as ChatTransportError details', async () => {
    const client = transport();

    try {
      await client.openSession('missing');
      throw new Error('expected recorded 404 fixture to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ChatTransportError);
      const transportError = error as ChatTransportError;
      expect(transportError.statusCode).toBe(404);
      expect(transportError.endpoint).toContain('/v1/chat/sessions/missing');
      expect(transportError.apiError?.reason_code).toBe('session_not_found');
      expect(transportError.retryable).toBe(false);
    }
  });

  it('replays a recorded multi-event SSE stream through ChatEventStream', async () => {
    const fetch = (async (): Promise<Response> =>
      sseFixtureResponse('long-stream.sse')) as FetchImpl;
    const stream = new ChatEventStream({
      config: {
        ...clientConfig(),
        fetchImpl: fetch,
      },
      sessionId: 'sess-recorded',
      fetchImpl: fetch,
      sleep: instantSleep,
    });

    const events: ChatEvent[] = [];
    for await (const event of stream.events()) {
      events.push(event);
      if (event.event_id === 'evt-1007') {
        stream.close();
        break;
      }
    }

    expect(events).toHaveLength(7);
    expect(
      events.filter((event) => event.kind === 'assistant_text_delta'),
    ).toHaveLength(3);
    expect(
      events.some((event) => event.kind === 'assistant_reasoning_delta'),
    ).toBe(true);
    expect(stream.getLastCursor()).toBe('evt-1007');
  });
});

function clientConfig() {
  return {
    baseUrl: 'http://recorded.test',
    timeoutMs: 5_000,
    writeTimeoutMs: 120_000,
    reconnectInitialMs: 10,
    reconnectMaxMs: 10,
    reconnectMaxAttempts: 1,
  };
}
