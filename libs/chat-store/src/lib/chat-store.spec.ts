import type {
  ChatCommandRegistry,
  ChatEvent,
  ChatSessionOpenResult,
  ChatSessionPage,
  ChatSessionSummary,
  ExecuteChatCommandResult,
  SendChatMessageResult,
  SessionContextUsageResult,
} from '@rusty-view/protocol';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ChatStorageAdapter, ChatUiState } from '@rusty-view/chat-domain';
import { ChatTransport, ChatTransportError } from '@rusty-view/transport';
import type { ChatEventStream } from '@rusty-view/transport';
import type { ChatConnectionState } from '@rusty-view/transport';

import { CHAT_STORE_VERSION } from '../index';
import { ChatStore, CHAT_STORAGE_ADAPTER } from './chat-store';

// ---- in-memory storage for tests ----

class InMemoryChatStorage implements ChatStorageAdapter {
  readonly sessionsMap = new Map<string, ChatSessionSummary>();
  readonly eventsMap = new Map<string, ChatEvent[]>();
  readonly getEventsCalls: string[] = [];
  private uiState: ChatUiState | null = null;

  async putSession(session: ChatSessionSummary): Promise<void> {
    this.sessionsMap.set(session.session_id, session);
  }
  async putEvents(
    sessionId: string,
    events: readonly ChatEvent[],
  ): Promise<void> {
    const existing = this.eventsMap.get(sessionId) ?? [];
    this.eventsMap.set(sessionId, [...existing, ...events]);
  }
  async getEvents(sessionId: string): Promise<ChatEvent[]> {
    this.getEventsCalls.push(sessionId);
    return this.eventsMap.get(sessionId) ?? [];
  }
  async getSessions(): Promise<ChatSessionSummary[]> {
    return [...this.sessionsMap.values()];
  }
  async clearSession(sessionId: string): Promise<void> {
    this.sessionsMap.delete(sessionId);
    this.eventsMap.delete(sessionId);
  }
  async getUiState(): Promise<ChatUiState | null> {
    return this.uiState;
  }
  async setUiState(state: ChatUiState): Promise<void> {
    this.uiState = state;
  }
}

// ---- mock transport ----

function createMockTransport(opts: {
  sessions?: ChatSessionPage;
  openResult?: ChatSessionOpenResult;
  replayEvents?: ChatEvent[];
  streamEvents?: ChatEvent[];
  sendResult?: SendChatMessageResult;
  sendError?: unknown;
  commandResult?: ExecuteChatCommandResult;
  commandError?: unknown;
  contextUsage?: SessionContextUsageResult;
  contextUsageError?: boolean;
  toolCallDebugDetail?: unknown;
  toolCallDebugDetailError?: unknown;
}): ChatTransport {
  const mock = {
    getConfig: () => ({ baseUrl: 'http://test', timeoutMs: 5000 }),
    listSessions: vi.fn(async () => opts.sessions ?? emptySessionPage()),
    openSession: vi.fn(async () => opts.openResult ?? emptyOpenResult()),
    replayEvents: vi.fn(async () => opts.replayEvents ?? []),
    replayAllEvents: vi.fn(async () => opts.replayEvents ?? []),
    sendMessage: vi.fn(async () => {
      if (opts.sendError !== undefined) {
        throw opts.sendError;
      }
      return opts.sendResult ?? acceptedResult();
    }),
    sessionContext: vi.fn(async () => {
      if (opts.contextUsageError === true) {
        throw new Error('context route unavailable');
      }
      return opts.contextUsage ?? defaultContextUsage();
    }),
    toolCallDebugDetail: vi.fn(async () => {
      if (opts.toolCallDebugDetailError !== undefined) {
        throw opts.toolCallDebugDetailError;
      }
      return opts.toolCallDebugDetail;
    }),
    listCommands: vi.fn(
      async () => ({ commands: [] }) satisfies ChatCommandRegistry,
    ),
    sendCommand: vi.fn(async () => {
      if (opts.commandError !== undefined) {
        throw opts.commandError;
      }
      return opts.commandResult ?? completedCommandResult();
    }),
    streamEvents: vi.fn(() => createMockStream(opts.streamEvents ?? [])),
  };
  return mock as unknown as ChatTransport;
}

function createMockStream(events: ChatEvent[]): ChatEventStream {
  const yieldedEvents = [...events];
  let closed = false;
  let stateListener: ((s: ChatConnectionState) => void) | null = null;

  const stream = {
    events: async function* () {
      // Yield buffered events, then keep the generator alive until close().
      for (const event of yieldedEvents) {
        if (closed) return;
        yield event;
      }
      while (!closed) {
        await new Promise((r) => setTimeout(r, 5));
      }
    },
    onStateChange: (cb: (s: ChatConnectionState) => void) => {
      stateListener = cb;
      cb({ status: 'connected' });
      return () => {
        stateListener = null;
      };
    },
    getState: () => ({ status: 'connected' }) as ChatConnectionState,
    getLastCursor: () =>
      yieldedEvents.length > 0
        ? (yieldedEvents.at(-1) as ChatEvent).event_id
        : undefined,
    close: () => {
      closed = true;
      if (stateListener !== null) {
        stateListener({ status: 'closed' });
      }
    },
  };
  return stream as unknown as ChatEventStream;
}

function emptySessionPage(): ChatSessionPage {
  return { items: [], total: 0, limit: 100, offset: 0 };
}

function emptyOpenResult(): ChatSessionOpenResult {
  return {
    session: {
      session_id: 'sess_test',
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
}

function defaultContextUsage(): SessionContextUsageResult {
  return {
    session_id: 'sess_test',
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
    tools: { tool_count: 0, mcp_binding_count: 0, mcp_active_count: 0 },
    context: {
      estimate_quality: 'approximate',
      estimate_method: 'sampled',
      estimator_id: 'tok-1',
      sampled_event_count: 0,
      sampled_message_count: 0,
    },
    degraded: false,
    diagnostics: [],
  };
}

function acceptedResult(): SendChatMessageResult {
  return { status: 'accepted', message_id: 'msg_1', latest_cursor: 'cur_1' };
}

function completedCommandResult(): ExecuteChatCommandResult {
  return {
    status: 'completed',
    command_name: '/status',
    summary: 'OK',
    latest_cursor: 'cur_1',
  };
}

function messageEvent(
  sessionId: string,
  eventId: string,
  body: string,
): ChatEvent {
  return {
    event_id: eventId,
    session_id: sessionId,
    sequence_id: 1,
    created_at: '2026-06-22T10:00:00Z',
    kind: 'message_created',
    payload: { message_id: `message-${eventId}`, role: 'user', body },
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setupStore(
  transport: ChatTransport,
  storage: ChatStorageAdapter,
): ChatStore {
  TestBed.configureTestingModule({
    providers: [
      ChatStore,
      { provide: ChatTransport, useValue: transport },
      { provide: CHAT_STORAGE_ADAPTER, useValue: storage },
    ],
  });
  return TestBed.inject(ChatStore);
}

describe('@rusty-view/chat-store package version', () => {
  it('exports a version marker', () => {
    expect(CHAT_STORE_VERSION).toBe('0.0.0');
  });
});

describe('ChatStore', () => {
  it('starts with empty state', () => {
    const transport = createMockTransport({});
    const store = setupStore(transport, new InMemoryChatStorage());
    expect(store.sessions()).toEqual([]);
    expect(store.activeSessionId()).toBeNull();
    expect(store.projection().messages).toHaveLength(0);
    expect(store.connectionState().status).toBe('idle');
  });

  it('refreshSessions populates the sessions signal', async () => {
    const transport = createMockTransport({
      sessions: {
        items: [
          {
            session_id: 's1',
            agent_id: 'a1',
            profile_id: 'p1',
            kind: 'full',
            status: 'active',
            latest_cursor: 'c1',
            updated_at: '2026-06-22T10:00:00Z',
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      },
    });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.refreshSessions();
    expect(store.sessions()).toHaveLength(1);
    expect(store.sessions()[0]?.session_id).toBe('s1');
  });

  it('selectSession opens a session and populates projection from events', async () => {
    const events: ChatEvent[] = [
      {
        event_id: 'e1',
        session_id: 'sess_test',
        sequence_id: 1,
        created_at: '2026-06-22T10:00:00Z',
        kind: 'message_created',
        payload: { message_id: 'm1', role: 'user', body: 'hello' },
      },
    ];
    const transport = createMockTransport({
      openResult: { ...emptyOpenResult(), events },
    });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    expect(store.activeSessionId()).toBe('sess_test');
    expect(store.projection().messages).toHaveLength(1);
    expect(store.projection().messages[0]?.blocks[0]?.content).toBe('hello');
  });

  it('atomically restores a hot transcript without rescanning storage', async () => {
    const storage = new InMemoryChatStorage();
    const transport = createMockTransport({});
    vi.mocked(transport.openSession).mockImplementation(async (sessionId) => ({
      ...emptyOpenResult(),
      session: { ...emptyOpenResult().session, session_id: sessionId },
      events: [messageEvent(sessionId, `event-${sessionId}`, sessionId)],
    }));
    const store = setupStore(transport, storage);

    await store.selectSession('session-a');
    await store.selectSession('session-b');
    expect(storage.getEventsCalls).toEqual(['session-a', 'session-b']);

    const returning = store.selectSession('session-a');
    expect(store.activeSessionId()).toBe('session-a');
    expect(store.sessionLoading()).toBe(false);
    expect(store.messages()[0]?.blocks[0]?.content).toBe('session-a');
    expect(storage.getEventsCalls).toEqual(['session-a', 'session-b']);
    await returning;
  });

  it('ignores a late backend open from an older native selection', async () => {
    const first = deferred<ChatSessionOpenResult>();
    const second = deferred<ChatSessionOpenResult>();
    const transport = createMockTransport({});
    vi.mocked(transport.openSession)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const store = setupStore(transport, new InMemoryChatStorage());

    const selectingFirst = store.selectSession('session-a');
    const selectingSecond = store.selectSession('session-b');
    second.resolve({
      ...emptyOpenResult(),
      session: { ...emptyOpenResult().session, session_id: 'session-b' },
      events: [messageEvent('session-b', 'event-b', 'newest')],
    });
    await selectingSecond;
    first.resolve({
      ...emptyOpenResult(),
      session: { ...emptyOpenResult().session, session_id: 'session-a' },
      events: [messageEvent('session-a', 'event-a', 'stale')],
    });
    await selectingFirst;

    expect(store.activeSessionId()).toBe('session-b');
    expect(store.messages()[0]?.blocks[0]?.content).toBe('newest');
    expect(transport.streamEvents).toHaveBeenCalledTimes(1);
    expect(transport.streamEvents).toHaveBeenCalledWith(
      'session-b',
      expect.any(Object),
    );
  });

  it('clears a stale active turn from an incomplete replay on a non-active session', async () => {
    // Deltas with no terminal `assistant_turn_finished` — an incomplete turn
    // record. On a non-active session this must not wedge the UI as streaming.
    const deltaEvent: ChatEvent = {
      event_id: 'd1',
      session_id: 'sess_test',
      sequence_id: 1,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'assistant_text_delta',
      payload: { message_id: 'a1', delta: 'half a thought', coalesced: false },
    };
    const transport = createMockTransport({
      openResult: {
        ...emptyOpenResult(),
        session: { ...emptyOpenResult().session, status: 'idle' },
        events: [deltaEvent],
      },
    });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    // The streamed text still renders…
    expect(store.projection().messages).toHaveLength(1);
    // …but the stale turn is cleared, so the input is not disabled.
    expect(store.isStreaming()).toBe(false);
    expect(store.isGenerating()).toBe(false);
  });

  it('does not block the input on an idle session even if the stream re-feeds a turn', async () => {
    // Mirrors the live case: an idle session's open turn is re-replayed by the
    // SSE stream (events the openSession page did not include), so the client's
    // clear is overridden and `isStreaming` becomes true again. The input must
    // still be enabled because the session itself is idle.
    const streamDelta: ChatEvent = {
      event_id: 'stream-1',
      session_id: 'sess_test',
      sequence_id: 9,
      created_at: '2026-06-22T10:00:09Z',
      kind: 'assistant_text_delta',
      payload: { message_id: 'a1', delta: 're-replayed', coalesced: false },
    };
    const transport = createMockTransport({
      openResult: {
        ...emptyOpenResult(),
        session: { ...emptyOpenResult().session, status: 'idle' },
        events: [],
      },
      streamEvents: [streamDelta],
    });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    await new Promise((r) => setTimeout(r, 30)); // let the background stream deliver

    expect(store.isStreaming()).toBe(true); // stream re-fed an active turn
    expect(store.isGenerating()).toBe(false); // idle session → input NOT blocked
  });

  it('keeps the active turn for an actively-running session', async () => {
    const deltaEvent: ChatEvent = {
      event_id: 'd1',
      session_id: 'sess_test',
      sequence_id: 1,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'assistant_text_delta',
      payload: { message_id: 'a1', delta: 'still going', coalesced: false },
    };
    const transport = createMockTransport({
      openResult: { ...emptyOpenResult(), events: [deltaEvent] }, // status 'active'
    });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    expect(store.isStreaming()).toBe(true);
    // Active session + live turn → the input is correctly blocked.
    expect(store.isGenerating()).toBe(true);
  });

  it('ingestEvents deduplicates by event_id', () => {
    const transport = createMockTransport({});
    const store = setupStore(transport, new InMemoryChatStorage());

    const event: ChatEvent = {
      event_id: 'evt_dedup',
      session_id: 'sess_1',
      sequence_id: 1,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'message_created',
      payload: { message_id: 'm1', role: 'user', body: 'hi' },
    };
    store.ingestEvents([event]);
    store.ingestEvents([event]); // same event_id
    expect(store.rawEvents()).toHaveLength(1);
  });

  it('ingestEvents reduces incrementally without rebuilding projection', () => {
    const transport = createMockTransport({});
    const store = setupStore(transport, new InMemoryChatStorage());

    const streamingEvents: ChatEvent[] = [
      {
        event_id: 's1',
        session_id: 'sess_1',
        sequence_id: 1,
        created_at: '2026-06-22T10:00:00Z',
        kind: 'assistant_turn_started',
        payload: {} as ChatEvent['payload'],
      },
      {
        event_id: 's2',
        session_id: 'sess_1',
        sequence_id: 2,
        created_at: '2026-06-22T10:00:00Z',
        kind: 'assistant_text_delta',
        payload: { message_id: 'a1', delta: 'foo ', coalesced: false },
      },
      {
        event_id: 's3',
        session_id: 'sess_1',
        sequence_id: 3,
        created_at: '2026-06-22T10:00:00Z',
        kind: 'assistant_text_delta',
        payload: { message_id: 'a1', delta: 'bar', coalesced: false },
      },
      {
        event_id: 's4',
        session_id: 'sess_1',
        sequence_id: 4,
        created_at: '2026-06-22T10:00:00Z',
        kind: 'assistant_message_completed',
        payload: { message_id: 'a1', body: 'foo bar' },
      },
      {
        event_id: 's5',
        session_id: 'sess_1',
        sequence_id: 5,
        created_at: '2026-06-22T10:00:00Z',
        kind: 'assistant_turn_finished',
        payload: {} as ChatEvent['payload'],
      },
    ];
    store.ingestEvents(streamingEvents);

    expect(store.projection().messages).toHaveLength(1);
    expect(store.projection().messages[0]?.status).toBe('completed');
  });

  it('rebuilds in sequence order when catch-up delivers an older unseen delta after completion', () => {
    const transport = createMockTransport({});
    const store = setupStore(transport, new InMemoryChatStorage());

    store.ingestEvents([
      {
        event_id: 'race:1',
        session_id: 'sess_1',
        sequence_id: 1,
        created_at: '2026-07-18T05:50:00Z',
        kind: 'assistant_turn_started',
        payload: {} as ChatEvent['payload'],
      },
      {
        event_id: 'race:4',
        session_id: 'sess_1',
        sequence_id: 4,
        created_at: '2026-07-18T05:50:04Z',
        kind: 'assistant_message_completed',
        payload: { message_id: 'a1', body: 'complete answer' },
      },
      {
        event_id: 'race:5',
        session_id: 'sess_1',
        sequence_id: 5,
        created_at: '2026-07-18T05:50:05Z',
        kind: 'assistant_turn_finished',
        payload: {} as ChatEvent['payload'],
      },
    ]);
    expect(store.projection().messages[0]?.status).toBe('completed');

    store.ingestEvents([
      {
        event_id: 'race:3',
        session_id: 'sess_1',
        sequence_id: 3,
        created_at: '2026-07-18T05:50:03Z',
        kind: 'assistant_text_delta',
        payload: {
          message_id: 'a1',
          delta: 'complete answer',
          coalesced: false,
        },
      },
    ]);

    expect(store.rawEvents().map((event) => event.sequence_id)).toEqual([
      1, 3, 4, 5,
    ]);
    expect(store.projection().messages[0]?.status).toBe('completed');
    expect(store.projection().messages[0]?.blocks[0]?.content).toBe(
      'complete answer',
    );
    expect(store.projection().activeTurn).toBeUndefined();
  });

  it('sendMessage calls transport.sendMessage with the text', async () => {
    const transport = createMockTransport({});
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    await store.sendMessage('test message');

    expect(transport.sendMessage).toHaveBeenCalledWith(
      'sess_test',
      expect.objectContaining({ body: 'test message' }),
    );
  });

  it('sendMessage shows an immediate assistant typing placeholder while the send is in flight', async () => {
    const transport = createMockTransport({});
    let resolveSend!: (value: SendChatMessageResult) => void;
    const sendPromise = new Promise<SendChatMessageResult>((resolve) => {
      resolveSend = resolve;
    });
    (
      transport as unknown as {
        sendMessage: ReturnType<typeof vi.fn>;
      }
    ).sendMessage = vi.fn(() => sendPromise);
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    const submitted = store.sendMessage('slow response please');

    expect(store.isSubmitting()).toBe(true);
    const placeholder = store.messages().at(-1);
    expect(placeholder?.id).toMatch(/^pending-assistant-pending_/);
    expect(placeholder?.author.role).toBe('assistant');
    expect(placeholder?.status).toBe('streaming');

    resolveSend(acceptedResult());
    await submitted;

    expect(store.isSubmitting()).toBe(false);
    expect(store.messages()).toHaveLength(0);
  });

  it('does not let a pending send disable or render in another session', async () => {
    const transport = createMockTransport({});
    let resolveFirstSend!: (value: SendChatMessageResult) => void;
    const firstSend = new Promise<SendChatMessageResult>((resolve) => {
      resolveFirstSend = resolve;
    });
    (
      transport as unknown as {
        sendMessage: ReturnType<typeof vi.fn>;
      }
    ).sendMessage = vi
      .fn()
      .mockImplementationOnce(() => firstSend)
      .mockResolvedValue(acceptedResult());
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_slow');
    const slowSubmission = store.sendMessage('long-running turn');

    expect(store.isSubmitting()).toBe(true);
    expect(store.messages().at(-1)?.id).toMatch(/^pending-assistant-pending_/);
    expect(store.pendingSends()[0]?.sessionId).toBe('sess_slow');

    await store.selectSession('sess_complete');
    store.ingestEvents([
      {
        event_id: 'sess_complete:1',
        session_id: 'sess_complete',
        sequence_id: 1,
        created_at: '2026-07-22T08:00:00Z',
        kind: 'assistant_turn_started',
        payload: { wake_id: 'wake-complete' },
      },
      {
        event_id: 'sess_complete:2',
        session_id: 'sess_complete',
        sequence_id: 2,
        created_at: '2026-07-22T08:00:01Z',
        kind: 'assistant_message_completed',
        payload: {
          wake_id: 'wake-complete',
          status: 'completed',
          summary: 'done',
        },
      },
      {
        event_id: 'sess_complete:3',
        session_id: 'sess_complete',
        sequence_id: 3,
        created_at: '2026-07-22T08:00:02Z',
        kind: 'assistant_turn_finished',
        payload: { wake_id: 'wake-complete' },
      },
    ]);

    expect(store.isStreaming()).toBe(false);
    expect(store.isSubmitting()).toBe(false);
    expect(store.messages()).toHaveLength(1);

    resolveFirstSend(acceptedResult());
    await slowSubmission;
  });

  it('sendMessage clears pending send on success', async () => {
    const transport = createMockTransport({});
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    await store.sendMessage('test message');

    expect(store.pendingSends()).toHaveLength(0);
  });

  it('shows an assistant typing placeholder when a real turn starts before text arrives', async () => {
    const transport = createMockTransport({});
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    store.ingestEvents([
      {
        event_id: 'turn_1',
        session_id: 'sess_test',
        sequence_id: 1,
        created_at: '2026-06-22T10:00:01Z',
        kind: 'assistant_turn_started',
        payload: {} as ChatEvent['payload'],
      },
    ]);

    const placeholder = store.messages().at(-1);
    expect(placeholder?.id).toBe('assistant-turn-turn_1');
    expect(placeholder?.author.role).toBe('assistant');
    expect(placeholder?.status).toBe('streaming');
    expect(placeholder?.createdAt).toBe('2026-06-22T10:00:01Z');
  });

  it('sendMessage preserves structured transport error details on failure', async () => {
    const transport = createMockTransport({
      sendError: new ChatTransportError({
        code: 'http_error',
        message: 'Session is archived',
        statusCode: 409,
        endpoint: 'http://test/v1/chat/sessions/sess_test/messages',
        apiError: {
          code: 'conflict',
          reason_code: 'session_archived',
          message: 'Session is archived',
          retryable: false,
        },
      }),
    });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    await store.sendMessage('test message');

    const pending = store.pendingSends()[0];
    expect(pending?.status).toBe('error');
    expect(pending?.error?.message).toBe('Session is archived');
    expect(pending?.error?.transportCode).toBe('http_error');
    expect(pending?.error?.statusCode).toBe(409);
    expect(pending?.error?.endpoint).toContain('/v1/chat/sessions/');
    expect(pending?.error?.apiError?.reasonCode).toBe('session_archived');
    expect(pending?.error?.retryable).toBe(false);
    expect(store.isSubmitting()).toBe(false);
  });

  it('sendMessage replays missed events from the pre-send cursor', async () => {
    const replayed: ChatEvent = {
      event_id: 'cur_1',
      session_id: 'sess_test',
      sequence_id: 1,
      created_at: '2026-06-22T10:00:01Z',
      kind: 'message_created',
      payload: {
        message_id: 'msg_1',
        role: 'user',
        body: 'caught up after POST',
      },
    };
    const transport = createMockTransport({
      openResult: {
        ...emptyOpenResult(),
        events: [
          {
            event_id: 'cur_0',
            session_id: 'sess_test',
            sequence_id: 0,
            created_at: '2026-06-22T10:00:00Z',
            kind: 'session_snapshot',
            payload: { session: emptyOpenResult().session },
          },
        ],
      },
      sendResult: {
        status: 'accepted',
        message_id: 'msg_1',
        latest_cursor: 'cur_1',
      },
      replayEvents: [replayed],
      streamEvents: [],
    });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    await store.sendMessage('caught up after POST');

    expect(transport.replayAllEvents).toHaveBeenCalledWith('sess_test', {
      cursor: 'cur_0',
    });
    expect(store.rawEvents().map((event) => event.event_id)).toContain('cur_1');
    expect(store.messages().at(-1)?.blocks[0]?.content).toBe(
      'caught up after POST',
    );
  });

  it('sendMessage replays even when POST returns the stale pre-send cursor', async () => {
    const replayed: ChatEvent[] = [
      {
        event_id: 'cur_1',
        session_id: 'sess_test',
        sequence_id: 1,
        created_at: '2026-06-22T10:00:01Z',
        kind: 'message_created',
        payload: {
          message_id: 'msg_1',
          role: 'user',
          body: 'long response please',
        },
      },
      {
        event_id: 'cur_2',
        session_id: 'sess_test',
        sequence_id: 2,
        created_at: '2026-06-22T10:00:02Z',
        kind: 'assistant_turn_started',
        payload: {} as ChatEvent['payload'],
      },
      {
        event_id: 'cur_3',
        session_id: 'sess_test',
        sequence_id: 3,
        created_at: '2026-06-22T10:00:03Z',
        kind: 'assistant_text_delta',
        payload: { message_id: 'a1', delta: 'streamed text' },
      },
      {
        event_id: 'cur_4',
        session_id: 'sess_test',
        sequence_id: 4,
        created_at: '2026-06-22T10:00:04Z',
        kind: 'assistant_message_completed',
        payload: { message_id: 'a1', body: 'streamed text' },
      },
      {
        event_id: 'cur_5',
        session_id: 'sess_test',
        sequence_id: 5,
        created_at: '2026-06-22T10:00:05Z',
        kind: 'assistant_turn_finished',
        payload: {} as ChatEvent['payload'],
      },
    ];
    const transport = createMockTransport({
      openResult: {
        ...emptyOpenResult(),
        events: [
          {
            event_id: 'cur_0',
            session_id: 'sess_test',
            sequence_id: 0,
            created_at: '2026-06-22T10:00:00Z',
            kind: 'session_snapshot',
            payload: { session: emptyOpenResult().session },
          },
        ],
      },
      sendResult: {
        status: 'accepted',
        message_id: 'msg_1',
        latest_cursor: 'cur_0',
      },
      replayEvents: replayed,
      streamEvents: [],
    });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    await store.sendMessage('long response please');

    expect(transport.replayAllEvents).toHaveBeenCalledWith('sess_test', {
      cursor: 'cur_0',
    });
    expect(store.messages().map((message) => message.id)).toEqual([
      'msg_1',
      'a1',
    ]);
    expect(store.messages().at(-1)?.status).toBe('completed');
    expect(store.messages().at(-1)?.blocks[0]?.content).toBe('streamed text');
    expect(store.isStreaming()).toBe(false);
  });

  it('catch-up ingests a full multi-page turn so a terminal event on a later page clears streaming', async () => {
    // replayAllEvents (transport) follows has_more across pages and hands the
    // store the concatenated result — including the terminal turn event that Crew
    // may return on a later page. The store must ingest all of it (task #3865).
    const midTurn: ChatEvent[] = [
      {
        event_id: 'cur_1',
        session_id: 'sess_test',
        sequence_id: 1,
        created_at: '2026-06-22T10:00:01Z',
        kind: 'assistant_turn_started',
        payload: {} as ChatEvent['payload'],
      },
      {
        event_id: 'cur_2',
        session_id: 'sess_test',
        sequence_id: 2,
        created_at: '2026-06-22T10:00:02Z',
        kind: 'assistant_text_delta',
        payload: { wake_id: 'w1', text: 'A figure steps ' },
      },
    ];
    const terminalOnLaterPage: ChatEvent[] = [
      {
        event_id: 'cur_3',
        session_id: 'sess_test',
        sequence_id: 3,
        created_at: '2026-06-22T10:00:03Z',
        kind: 'assistant_turn_finished',
        payload: {} as ChatEvent['payload'],
      },
    ];
    const transport = createMockTransport({
      sendResult: {
        status: 'accepted',
        message_id: 'msg_1',
        latest_cursor: 'cur_3',
      },
      // Simulates replayAllEvents concatenating page 1 (mid-turn) + page 2 (terminal).
      replayEvents: [...midTurn, ...terminalOnLaterPage],
      streamEvents: [],
    });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    await store.sendMessage('hello');

    expect(store.rawEvents().map((e) => e.event_id)).toContain('cur_3');
    // The terminal event was ingested, so the active turn is cleared.
    expect(store.isStreaming()).toBe(false);
  });

  it('runCommand switches session when result has new_session_id', async () => {
    const transport = createMockTransport({
      commandResult: {
        status: 'completed',
        command_name: '/new',
        summary: 'Created new session',
        latest_cursor: 'cur_0',
        new_session_id: 'sess_new',
      },
      sessions: {
        items: [
          {
            session_id: 'sess_new',
            agent_id: 'a1',
            profile_id: 'p1',
            kind: 'full',
            status: 'active',
            latest_cursor: 'cur_0',
            updated_at: '2026-06-22T10:00:00Z',
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      },
    });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    await store.runCommand('/new');

    expect(store.activeSessionId()).toBe('sess_new');
  });

  it('runCommand preserves network error details on failure', async () => {
    const transport = createMockTransport({
      commandError: new ChatTransportError({
        code: 'network_error',
        message: 'Request timed out',
        endpoint: 'http://test/v1/chat/sessions/sess_test/commands',
      }),
    });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    await store.runCommand('/status');

    const pending = store.pendingCommands()[0];
    expect(pending?.status).toBe('error');
    expect(pending?.error?.source).toBe('transport');
    expect(pending?.error?.transportCode).toBe('network_error');
    expect(pending?.error?.endpoint).toContain('/commands');
    expect(pending?.error?.retryable).toBe(true);
  });

  it('SSE stream events are ingested into the projection', async () => {
    const streamEvent: ChatEvent = {
      event_id: 'stream_e1',
      session_id: 'sess_test',
      sequence_id: 100,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'message_created',
      payload: { message_id: 'sm1', role: 'user', body: 'from stream' },
    };
    const transport = createMockTransport({
      streamEvents: [streamEvent],
    });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');

    // Wait for the background stream consumer to process events.
    await new Promise((r) => setTimeout(r, 50));

    const rawEventIds = store.rawEvents().map((e) => e.event_id);
    expect(rawEventIds).toContain('stream_e1');
  });

  it('reconnect closes and reopens the stream', async () => {
    const transport = createMockTransport({});
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    await store.reconnect();

    // streamEvents called twice: initial + reconnect
    expect(transport.streamEvents).toHaveBeenCalledTimes(2);
  });

  it('connectionState updates from the stream', async () => {
    const transport = createMockTransport({});
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    await new Promise((r) => setTimeout(r, 30));

    // The mock stream emits 'connected' on state change.
    expect(store.connectionState().status).toBe('connected');
  });

  it('handles all known event kinds without crashing', () => {
    const transport = createMockTransport({});
    const store = setupStore(transport, new InMemoryChatStorage());

    const events: ChatEvent[] = [
      {
        event_id: 'k1',
        session_id: 's',
        sequence_id: 1,
        created_at: '2026-06-22T10:00:00Z',
        kind: 'message_created',
        payload: { message_id: 'm1', role: 'user', body: 'hi' },
      },
      {
        event_id: 'k2',
        session_id: 's',
        sequence_id: 2,
        created_at: '2026-06-22T10:00:00Z',
        kind: 'tool_call_started',
        payload: {
          tool_call_id: 'tc1',
          tool_name: 'search',
          summary: 'Searched',
          status: 'started',
        },
      },
      {
        event_id: 'k3',
        session_id: 's',
        sequence_id: 3,
        created_at: '2026-06-22T10:00:00Z',
        kind: 'command_started',
        payload: {
          command_name: '/status',
          summary: 'Checking',
          status: 'started',
        },
      },
      {
        event_id: 'k4',
        session_id: 's',
        sequence_id: 4,
        created_at: '2026-06-22T10:00:00Z',
        kind: 'stream_error',
        payload: { message: 'Lost connection', retryable: true },
      },
      {
        event_id: 'k5',
        session_id: 's',
        sequence_id: 5,
        created_at: '2026-06-22T10:00:00Z',
        kind: 'unknown',
        payload: { summary: 'Mystery', raw: { x: 1 } },
      },
    ];
    store.ingestEvents(events);

    expect(store.projection().messages.length).toBeGreaterThan(0);
    expect(store.projection().unknownEvents.length).toBeGreaterThan(0);
  });
});

// ---- profile / historical session tests ----

function makeSession(
  overrides: Partial<ChatSessionSummary>,
): ChatSessionSummary {
  return {
    session_id: 's1',
    agent_id: 'a1',
    profile_id: 'p1',
    kind: 'full',
    status: 'idle',
    latest_cursor: '',
    updated_at: '2026-06-22T10:00:00Z',
    ...overrides,
  } as ChatSessionSummary;
}

describe('ChatStore profiles', () => {
  it('derives profiles from the session list', async () => {
    const transport = createMockTransport({
      sessions: {
        items: [
          makeSession({
            session_id: 's1',
            profile_id: 'p1',
            status: 'idle',
            updated_at: '2026-06-01T00:00:00Z',
          }),
          makeSession({
            session_id: 's2',
            profile_id: 'p1',
            status: 'archived',
            updated_at: '2026-05-01T00:00:00Z',
          }),
          makeSession({
            session_id: 's3',
            profile_id: 'p2',
            status: 'active',
            updated_at: '2026-06-10T00:00:00Z',
          }),
        ],
        total: 3,
        limit: 100,
        offset: 0,
      },
    });
    const store = setupStore(transport, new InMemoryChatStorage());
    await store.refreshSessions();

    expect(store.profiles()).toHaveLength(2);
    // Most-recently active profile first.
    expect(store.profiles()[0]?.profileId).toBe('p2');
    expect(store.profiles()[0]?.status).toBe('active');
    expect(store.profiles()[0]?.activeSessionId).toBe('s3');
  });

  it('selectProfile opens the profile active session', async () => {
    const transport = createMockTransport({
      sessions: {
        items: [
          makeSession({
            session_id: 'live',
            profile_id: 'p1',
            status: 'active',
            updated_at: '2026-06-10T00:00:00Z',
          }),
          makeSession({
            session_id: 'old',
            profile_id: 'p1',
            status: 'archived',
            updated_at: '2026-05-01T00:00:00Z',
          }),
        ],
        total: 2,
        limit: 100,
        offset: 0,
      },
    });
    const store = setupStore(transport, new InMemoryChatStorage());
    await store.refreshSessions();

    await store.selectProfile('p1');
    expect(store.selectedProfileId()).toBe('p1');
    expect(store.activeSessionId()).toBe('live');
    expect(store.isViewingHistorical()).toBe(false);
  });

  it('viewHistoricalSession opens the chosen session without changing profile', async () => {
    const transport = createMockTransport({
      sessions: {
        items: [
          makeSession({
            session_id: 'live',
            profile_id: 'p1',
            status: 'active',
            updated_at: '2026-06-10T00:00:00Z',
          }),
          makeSession({
            session_id: 'archived-1',
            profile_id: 'p1',
            status: 'archived',
            updated_at: '2026-05-01T00:00:00Z',
          }),
        ],
        total: 2,
        limit: 100,
        offset: 0,
      },
    });
    const store = setupStore(transport, new InMemoryChatStorage());
    await store.refreshSessions();
    await store.selectProfile('p1');

    await store.viewHistoricalSession('archived-1');
    expect(store.selectedProfileId()).toBe('p1');
    expect(store.activeSessionId()).toBe('archived-1');
    expect(store.viewingHistoricalSessionId()).toBe('archived-1');
    expect(store.isViewingHistorical()).toBe(true);
  });

  it('returnToActiveSession restores the profile live session', async () => {
    const transport = createMockTransport({
      sessions: {
        items: [
          makeSession({
            session_id: 'live',
            profile_id: 'p1',
            status: 'active',
            updated_at: '2026-06-10T00:00:00Z',
          }),
          makeSession({
            session_id: 'archived-1',
            profile_id: 'p1',
            status: 'archived',
            updated_at: '2026-05-01T00:00:00Z',
          }),
        ],
        total: 2,
        limit: 100,
        offset: 0,
      },
    });
    const store = setupStore(transport, new InMemoryChatStorage());
    await store.refreshSessions();
    await store.selectProfile('p1');
    await store.viewHistoricalSession('archived-1');

    await store.returnToActiveSession();
    expect(store.viewingHistoricalSessionId()).toBeNull();
    expect(store.activeSessionId()).toBe('live');
    expect(store.isViewingHistorical()).toBe(false);
  });

  it('persists and restores selectedProfileId across refreshes', async () => {
    const storage = new InMemoryChatStorage();
    const transport = createMockTransport({
      sessions: {
        items: [
          makeSession({
            session_id: 'live',
            profile_id: 'p1',
            status: 'active',
            updated_at: '2026-06-10T00:00:00Z',
          }),
        ],
        total: 1,
        limit: 100,
        offset: 0,
      },
    });
    const store1 = setupStore(transport, storage);
    await store1.refreshSessions();
    await store1.selectProfile('p1');

    // Simulate a fresh store with the same storage.
    TestBed.resetTestingModule();
    const store2 = setupStore(transport, storage);
    await store2.refreshSessions();
    expect(store2.selectedProfileId()).toBe('p1');
  });

  it('does not restore a profile id that no longer exists', async () => {
    const storage = new InMemoryChatStorage();
    await storage.setUiState({ selectedProfileId: 'gone' });
    const transport = createMockTransport({
      sessions: {
        items: [
          makeSession({
            session_id: 'live',
            profile_id: 'p1',
            status: 'active',
            updated_at: '2026-06-10T00:00:00Z',
          }),
        ],
        total: 1,
        limit: 100,
        offset: 0,
      },
    });
    const store = setupStore(transport, storage);
    await store.refreshSessions();
    expect(store.selectedProfileId()).toBeNull();
  });
});

describe('ChatStore.submit (slash-command routing)', () => {
  it('routes plain text to sendMessage', async () => {
    const sendMock = vi.fn(async () => ({
      status: 'accepted' as const,
      message_id: 'm1',
      latest_cursor: 'c1',
    }));
    const commandMock = vi.fn(
      async () =>
        ({
          status: 'completed' as const,
          command_name: 'x',
          summary: '',
          latest_cursor: 'c1',
        }) satisfies ExecuteChatCommandResult,
    );
    const transport = createMockTransport({});
    (transport as unknown as { sendMessage: typeof sendMock }).sendMessage =
      sendMock;
    (transport as unknown as { sendCommand: typeof commandMock }).sendCommand =
      commandMock;

    const store = setupStore(transport, new InMemoryChatStorage());
    // Simulate an active session by injecting one via refreshSessions + selectSession.
    await store.refreshSessions();
    await store.selectSession('sess_test');

    await store.submit('hello world');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(commandMock).not.toHaveBeenCalled();
  });

  it('routes text starting with / to runCommand', async () => {
    const sendMock = vi.fn(async () => ({
      status: 'accepted' as const,
      message_id: 'm1',
      latest_cursor: 'c1',
    }));
    const commandMock = vi.fn(
      async () =>
        ({
          status: 'completed' as const,
          command_name: 'status',
          summary: 'OK',
          latest_cursor: 'c1',
        }) satisfies ExecuteChatCommandResult,
    );
    const transport = createMockTransport({});
    (transport as unknown as { sendMessage: typeof sendMock }).sendMessage =
      sendMock;
    (transport as unknown as { sendCommand: typeof commandMock }).sendCommand =
      commandMock;

    const store = setupStore(transport, new InMemoryChatStorage());
    await store.refreshSessions();
    await store.selectSession('sess_test');

    await store.submit('/status');
    expect(commandMock).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('records pendingCommands and clears on success', async () => {
    let resolve!: (v: ExecuteChatCommandResult) => void;
    const commandMock = vi.fn(
      () =>
        new Promise<ExecuteChatCommandResult>((r) => {
          resolve = r;
        }),
    );
    const transport = createMockTransport({});
    (transport as unknown as { sendCommand: typeof commandMock }).sendCommand =
      commandMock;

    const store = setupStore(transport, new InMemoryChatStorage());
    await store.refreshSessions();
    await store.selectSession('sess_test');

    const promise = store.submit('/slow');
    expect(store.pendingCommands()).toHaveLength(1);
    expect(store.isSubmitting()).toBe(true);

    resolve({
      status: 'completed',
      command_name: 'slow',
      summary: 'done',
      latest_cursor: 'c1',
    });
    await promise;

    expect(store.pendingCommands()).toHaveLength(0);
    expect(store.isSubmitting()).toBe(false);
  });

  it('records error on pendingCommand when transport throws', async () => {
    const commandMock = vi.fn(async () => {
      throw new Error('boom');
    });
    const transport = createMockTransport({});
    (transport as unknown as { sendCommand: typeof commandMock }).sendCommand =
      commandMock;

    const store = setupStore(transport, new InMemoryChatStorage());
    await store.refreshSessions();
    await store.selectSession('sess_test');

    await store.submit('/fail');

    expect(store.pendingCommands()).toHaveLength(1);
    expect(store.pendingCommands()[0]?.status).toBe('error');
    expect(store.pendingCommands()[0]?.error?.message).toBe('boom');
    expect(store.pendingCommands()[0]?.error?.source).toBe('error');
    expect(store.isSubmitting()).toBe(false);
  });
});

describe('ChatStore command history', () => {
  function commandResult(name: string): ExecuteChatCommandResult {
    return {
      status: 'completed',
      command_name: name,
      summary: '',
      latest_cursor: 'c1',
    };
  }

  async function setupStoreWithSession(storage?: ChatStorageAdapter) {
    const commandMock = vi.fn(
      async (sessionId: string, _req: { command: string }) =>
        commandResult(_req.command.replace(/^\//, '').split(/\s/)[0] ?? 'x'),
    );
    const transport = createMockTransport({});
    (transport as unknown as { sendCommand: typeof commandMock }).sendCommand =
      commandMock;
    const s = storage ?? new InMemoryChatStorage();
    const store = setupStore(transport, s);
    await store.refreshSessions();
    await store.selectSession('sess_test');
    return { store, storage: s, commandMock };
  }

  it('starts with empty command history', () => {
    const store = setupStore(
      createMockTransport({}),
      new InMemoryChatStorage(),
    );
    expect(store.commandHistory()).toEqual([]);
  });

  it('records submitted slash commands newest-first', async () => {
    const { store } = await setupStoreWithSession();
    await store.submit('/status');
    await store.submit('/help');
    expect(store.commandHistory()).toEqual(['/help', '/status']);
  });

  it('does not record normal messages in command history', async () => {
    const sendMock = vi.fn(async () => ({
      status: 'accepted' as const,
      message_id: 'm1',
      latest_cursor: 'c1',
    }));
    const transport = createMockTransport({});
    (transport as unknown as { sendMessage: typeof sendMock }).sendMessage =
      sendMock;
    const store = setupStore(transport, new InMemoryChatStorage());
    await store.refreshSessions();
    await store.selectSession('sess_test');

    await store.submit('hello world');
    expect(store.commandHistory()).toEqual([]);
  });

  it('skips consecutive duplicate commands', async () => {
    const { store } = await setupStoreWithSession();
    await store.submit('/status');
    await store.submit('/status');
    await store.submit('/status');
    expect(store.commandHistory()).toEqual(['/status']);
  });

  it('allows non-consecutive duplicate commands', async () => {
    const { store } = await setupStoreWithSession();
    await store.submit('/status');
    await store.submit('/help');
    await store.submit('/status');
    expect(store.commandHistory()).toEqual(['/status', '/help', '/status']);
  });

  it('does not record failed commands', async () => {
    const commandMock = vi.fn(async () => {
      throw new Error('boom');
    });
    const transport = createMockTransport({});
    (transport as unknown as { sendCommand: typeof commandMock }).sendCommand =
      commandMock;
    const store = setupStore(transport, new InMemoryChatStorage());
    await store.refreshSessions();
    await store.selectSession('sess_test');

    await store.submit('/fail');
    expect(store.commandHistory()).toEqual([]);
  });

  it('bounds history to MAX_COMMAND_HISTORY', async () => {
    const { store } = await setupStoreWithSession();
    const max = ChatStore.MAX_COMMAND_HISTORY;
    for (let i = 0; i < max + 10; i++) {
      await store.submit(`/cmd${i}`);
    }
    expect(store.commandHistory()).toHaveLength(max);
    // Newest should be the last submitted command.
    expect(store.commandHistory()[0]).toBe(`/cmd${max + 9}`);
  });

  it('persists command history across store recreation', async () => {
    const storage = new InMemoryChatStorage();
    const { store: store1 } = await setupStoreWithSession(storage);
    await store1.submit('/status');
    await store1.submit('/help');

    // Simulate a fresh store with the same storage.
    TestBed.resetTestingModule();
    const { store: store2 } = await setupStoreWithSession(storage);
    expect(store2.commandHistory()).toEqual(['/help', '/status']);
  });
});

describe('ChatStore context diagnostics', () => {
  function contextEvent(id: string, fillPercent: number): ChatEvent {
    return {
      event_id: id,
      session_id: 'sess_test',
      sequence_id: 1,
      created_at: '2026-06-30T10:00:00Z',
      kind: 'context_status',
      payload: {
        session_id: 'sess_test',
        strategy_id: 'sliding-window',
        fill_percent: fillPercent,
        ui_debug: true,
        model_facing: false,
      },
    };
  }

  it('loads context usage on selectSession', async () => {
    const transport = createMockTransport({});
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');

    expect(store.contextUsage()?.context_strategy.strategy_id).toBe(
      'sliding-window',
    );
  });

  it('leaves context usage null when the route is unavailable', async () => {
    const transport = createMockTransport({ contextUsageError: true });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');

    expect(store.contextUsage()).toBeNull();
  });

  it('projects context_status events into the context timeline', async () => {
    const transport = createMockTransport({
      openResult: {
        ...emptyOpenResult(),
        events: [contextEvent('c1', 30), contextEvent('c2', 70)],
      },
    });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');

    expect(store.contextTimeline().map((e) => e.id)).toEqual(['c1', 'c2']);
    expect(store.contextStatus()?.fillPercent).toBe(70);
    // Context events never become assistant transcript messages.
    expect(store.messages()).toHaveLength(0);
  });

  it('keeps consuming the live stream after an unknown/debug event (#3848)', async () => {
    // An unknown (or coerced-unparseable) event in the live stream must not
    // block the events that follow it from rendering.
    const unknownEvent: ChatEvent = {
      event_id: 'u1',
      session_id: 'sess_test',
      sequence_id: 1,
      created_at: '2026-06-30T10:00:00Z',
      kind: 'unknown',
      payload: { summary: 'Unparseable SSE frame', raw: {} },
    };
    const messageEvent: ChatEvent = {
      event_id: 'm-after',
      session_id: 'sess_test',
      sequence_id: 2,
      created_at: '2026-06-30T10:00:01Z',
      kind: 'message_created',
      payload: { message_id: 'm-after', role: 'assistant', body: 'after' },
    };
    const transport = createMockTransport({
      streamEvents: [unknownEvent, messageEvent],
    });
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    await new Promise((r) => setTimeout(r, 30)); // let the background stream deliver

    // The message after the unknown event still rendered.
    expect(store.messages().map((m) => m.id)).toContain('m-after');
  });

  it('clears context usage when switching sessions', async () => {
    const transport = createMockTransport({});
    const store = setupStore(transport, new InMemoryChatStorage());

    await store.selectSession('sess_test');
    expect(store.contextUsage()).not.toBeNull();

    // The reset happens synchronously at the start of the next selectSession.
    const pending = store.selectSession('sess_other');
    expect(store.contextUsage()).toBeNull();
    await pending;
  });
});
