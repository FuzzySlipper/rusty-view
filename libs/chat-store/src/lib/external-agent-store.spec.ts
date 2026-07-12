import { TestBed } from '@angular/core/testing';
import type {
  ExternalAgentBinding,
  ExternalInteractionRecord,
  ExternalRuntimeRegistration,
  ExternalThreadProjection,
  NormalizedExternalRuntimeEvent,
} from '@rusty-view/protocol';
import { ChatTransport } from '@rusty-view/transport';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  activeExternalTurnId,
  ExternalAgentStore,
  latestExternalTurnPhase,
} from './external-agent-store';

afterEach(() => TestBed.resetTestingModule());

describe('external agent lifecycle reduction', () => {
  it('ignores statusless diff notifications after a turn starts', () => {
    const events = [
      event(10, 'turn-old', 'completed'),
      event(20, 'turn-new', 'inProgress'),
      event(21, 'turn-new'),
    ];

    expect(latestExternalTurnPhase(events)).toBe('active');
    expect(activeExternalTurnId(events)).toBe('turn-new');
  });

  it('uses sequence order and closes the matching active turn', () => {
    const events = [
      event(30, 'turn-new', 'completed'),
      event(20, 'turn-new', 'inProgress'),
      event(25, 'turn-new'),
    ];

    expect(latestExternalTurnPhase(events)).toBe('completed');
    expect(activeExternalTurnId(events)).toBeUndefined();
  });
});

describe('ExternalAgentStore', () => {
  it('projects a pending interaction as a waiting turn', () => {
    const store = setupStore({
      runtimes: [],
      listThreads: vi.fn(),
    });
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('thread-1');
    store.events.set([event(1, 'turn-1', 'inProgress')]);
    store.interactions.set([
      {
        runtimeId: 'runtime-1',
        nativeThreadId: 'thread-1',
        status: 'pending',
      } as ExternalInteractionRecord,
    ]);

    expect(store.turnPhase()).toBe('waiting_interaction');
    expect(store.isTurnActive()).toBe(true);
  });

  it('refreshes one thread page and appends exactly one page on demand', async () => {
    const runtime = registration('runtime-1');
    const listThreads = vi.fn(
      async (_runtimeId: string, query?: { cursor?: string }) =>
        query?.cursor === 'page-2'
          ? page([thread('thread-2', 20)], null)
          : page([thread('thread-1', 10)], 'page-2'),
    );
    const store = setupStore({ runtimes: [runtime], listThreads });

    await store.refresh();
    expect(listThreads).toHaveBeenCalledTimes(1);
    expect(store.threads().map((item) => item.threadId)).toEqual(['thread-1']);
    expect(store.hasMoreThreads()).toBe(true);

    await store.loadMoreThreads();
    expect(listThreads).toHaveBeenCalledTimes(2);
    expect(store.threads().map((item) => item.threadId)).toEqual([
      'thread-1',
      'thread-2',
    ]);

    await store.refresh();
    expect(listThreads).toHaveBeenCalledTimes(3);
    expect(store.threads().map((item) => item.threadId)).toEqual([
      'thread-1',
      'thread-2',
    ]);
  });

  it('preserves a page loaded while an older refresh finishes', async () => {
    const refreshPage = deferred<ReturnType<typeof page>>();
    let firstPageReads = 0;
    const listThreads = vi.fn(
      async (_runtimeId: string, query?: { cursor?: string }) => {
        if (query?.cursor === 'page-2') {
          return page([thread('thread-2', 20)], 'page-3');
        }
        if (query?.cursor === 'page-3') {
          return page([thread('thread-3', 30)], null);
        }
        firstPageReads += 1;
        return firstPageReads === 1
          ? page([thread('thread-1', 10)], 'page-2')
          : refreshPage.promise;
      },
    );
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      listThreads,
    });
    await store.refresh();

    const refresh = store.refresh();
    await store.loadMoreThreads();
    refreshPage.resolve(page([thread('thread-1', 11)], 'page-2'));
    await refresh;

    expect(store.threads().map((item) => item.threadId)).toEqual([
      'thread-1',
      'thread-2',
    ]);
    await store.loadMoreThreads();
    expect(listThreads).toHaveBeenLastCalledWith('runtime-1', {
      limit: 100,
      cursor: 'page-3',
    });
    expect(store.threads().map((item) => item.threadId)).toEqual([
      'thread-1',
      'thread-2',
      'thread-3',
    ]);
  });

  it('keeps selection and unread state qualified by runtime identity', async () => {
    const runtimes = [registration('runtime-1'), registration('runtime-2')];
    const store = setupStore({
      runtimes,
      listThreads: vi.fn(async (runtimeId: string) =>
        page(
          [thread('shared-thread', runtimeId === 'runtime-1' ? 10 : 20)],
          null,
        ),
      ),
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('shared-thread');

    const sessions = store.sessions();
    expect(store.selectedSessionKey()).toBe('runtime-1:shared-thread');
    expect(
      sessions.find((item) => item.runtime.runtimeId === 'runtime-1')?.unread,
    ).toBe(false);
    expect(
      sessions.find((item) => item.runtime.runtimeId === 'runtime-2')?.unread,
    ).toBe(true);
  });

  it('publishes rejected send and interrupt requests as operator-visible errors', async () => {
    const binding = externalBinding();
    const sendMessage = vi
      .fn()
      .mockRejectedValue(new Error('delivery offline'));
    const submitControl = vi
      .fn()
      .mockRejectedValue(new Error('control offline'));
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [binding],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      sendMessage,
      submitControl,
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('thread-1');

    await store.send('hello');
    expect(store.error()).toContain('Send failed: delivery offline');

    store.events.set([event(1, 'turn-1', 'inProgress')]);
    await store.interrupt();
    expect(store.error()).toContain('Interrupt failed: control offline');
  });

  it('sends Plan collaboration mode once and returns the composer to auto', async () => {
    const sendMessage = vi.fn();
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [externalBinding()],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      sendMessage,
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('thread-1');
    store.composerMode.set('plan');

    await store.send('ask me');

    expect(sendMessage).toHaveBeenCalledWith('binding-1', {
      body: 'ask me',
      ttlMs: 60_000,
      collaborationMode: 'plan',
    });
    expect(store.composerMode()).toBe('auto');
  });

  it('polls from the runtime cursor when a fresh selected thread has no events', async () => {
    const runtime = registration('runtime-1');
    const selectedThread = thread('thread-1', 10);
    const binding = externalBinding();
    const historicalEvent = {
      ...event(100, 'old-turn', 'completed'),
      nativeThreadId: 'other-thread',
    };
    const freshEvent = event(101, 'fresh-turn', 'inProgress');
    const listEvents = vi.fn(
      async (_runtimeId: string, query?: { after?: number }) => ({
        events: query?.after === 100 ? [freshEvent] : [historicalEvent],
      }),
    );
    const store = setupStore({
      runtimes: [runtime],
      bindings: [binding],
      listThreads: vi.fn(),
      listEvents,
      readThread: vi.fn(async () => ({ thread: selectedThread })),
    });
    store.bindings.set([binding]);

    await store.selectSession({
      key: 'runtime-1:thread-1',
      runtime,
      thread: selectedThread,
      binding,
      unread: false,
      needsAttention: false,
    });
    await store.send('start fresh work');

    expect(listEvents).toHaveBeenLastCalledWith('runtime-1', {
      after: 100,
      limit: 1_000,
    });
    expect(store.events()).toEqual([freshEvent]);
  });

  it('creates, indexes, and selects a browser-created external session', async () => {
    const runtime = registration('runtime-1');
    const createdThread = thread('thread-created', 30);
    const createdBinding = {
      ...externalBinding(),
      bindingId: 'binding-created',
      nativeThreadId: createdThread.threadId,
      sessionId: 'session-created',
      agentId: 'agent-created',
    };
    const createAgentSession = vi.fn(async () => ({
      creation: {
        creationId: 'creation-1',
        request: {
          idempotencyKey: 'create-1',
          runtimeId: runtime.runtimeId,
          profileId: 'tester',
          cwd: '/home/dev/rusty-view',
          requestedAt: '2026-07-12T00:00:00Z',
        },
        requestFingerprint: 'fingerprint',
        session: {
          sessionId: 'session-created',
          agentId: 'agent-created',
          profileId: 'tester',
          status: 'idle' as const,
        },
        binding: createdBinding,
        nativeThreadSource: 'rusty-crew:create-1',
        nativeThreadId: createdThread.threadId,
        phase: 'ready' as const,
        revision: 4,
        createdAt: '2026-07-12T00:00:00Z',
        updatedAt: '2026-07-12T00:00:01Z',
      },
      runtime,
      thread: createdThread,
    }));
    const readThread = vi.fn(async () => ({ thread: createdThread }));
    const store = setupStore({
      runtimes: [runtime],
      listThreads: vi.fn(async () => page([], null)),
      createAgentSession,
      readThread,
    });

    const result = await store.createSession({
      idempotencyKey: 'create-1',
      runtimeId: runtime.runtimeId,
      profileId: 'tester',
      cwd: '/home/dev/rusty-view',
    });

    expect(result?.creation.phase).toBe('ready');
    expect(store.selectedSessionKey()).toBe('runtime-1:thread-created');
    expect(store.selectedBinding()?.bindingId).toBe('binding-created');
    expect(readThread).not.toHaveBeenCalled();
    expect(
      store.sessions().map((session) => session.thread.threadId),
    ).toContain('thread-created');
  });

  it('keeps a creation failure visible across periodic fleet refreshes', async () => {
    const runtime = registration('runtime-1');
    const store = setupStore({
      runtimes: [runtime],
      listThreads: vi.fn(async () => page([], null)),
      createAgentSession: vi
        .fn()
        .mockRejectedValue(new Error('native offline')),
    });

    await store.createSession({
      idempotencyKey: 'create-failed',
      runtimeId: runtime.runtimeId,
      profileId: 'tester',
      cwd: '/home/dev/rusty-view',
    });
    await store.refresh();

    expect(store.creationError()).toBe('Create failed: native offline');
  });
});

function setupStore(options: {
  runtimes: readonly ExternalRuntimeRegistration[];
  bindings?: readonly ExternalAgentBinding[];
  listThreads: ReturnType<typeof vi.fn>;
  sendMessage?: ReturnType<typeof vi.fn>;
  submitControl?: ReturnType<typeof vi.fn>;
  listEvents?: ReturnType<typeof vi.fn>;
  readThread?: ReturnType<typeof vi.fn>;
  createAgentSession?: ReturnType<typeof vi.fn>;
}): ExternalAgentStore {
  const external = {
    listRuntimes: vi.fn(async () => ({
      runtimes: options.runtimes,
      controllers: [],
    })),
    listBindings: vi.fn(async () => ({ bindings: options.bindings ?? [] })),
    listInteractions: vi.fn(async () => ({ interactions: [] })),
    listThreads: options.listThreads,
    listEvents: options.listEvents ?? vi.fn(async () => ({ events: [] })),
    readThread: options.readThread ?? vi.fn(),
    createAgentSession: options.createAgentSession ?? vi.fn(),
    sendMessage: options.sendMessage ?? vi.fn(),
    submitControl: options.submitControl ?? vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      ExternalAgentStore,
      {
        provide: ChatTransport,
        useValue: {
          external,
          adminProfileRegistry: vi.fn(async () => ({
            items: [],
            total: 0,
            limit: 100,
            offset: 0,
          })),
          streamExternalRuntimeEvents: vi.fn(() => ({
            close: vi.fn(),
            async *events() {
              yield* [];
            },
          })),
        } as unknown as ChatTransport,
      },
    ],
  });
  return TestBed.inject(ExternalAgentStore);
}

function page(
  items: readonly ExternalThreadProjection[],
  nextCursor: string | null,
) {
  return { items, nextCursor, backwardsCursor: null };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function registration(runtimeId: string): ExternalRuntimeRegistration {
  return {
    runtimeId,
    kind: 'codex_app_server',
    desiredState: 'enabled',
    observedState: 'ready',
    processOwnership: 'attached',
    endpoint: {
      transport: 'unix_web_socket',
      address: `/run/${runtimeId}.sock`,
    },
    executableSha256: 'exe',
    protocolSchemaSha256: 'schema',
    expectedCliVersion: '0.144.1',
    revision: 1,
    createdAt: '2026-07-11T00:00:00Z',
    updatedAt: '2026-07-11T00:00:00Z',
  };
}

function thread(threadId: string, updatedAt: number): ExternalThreadProjection {
  return {
    threadId,
    sessionId: `session-${threadId}`,
    parentThreadId: null,
    preview: threadId,
    ephemeral: false,
    modelProvider: 'openai',
    createdAt: updatedAt,
    updatedAt,
    status: 'active',
    cwd: '/home/dev/rusty-view',
    cliVersion: '0.144.1',
    name: threadId,
    agentNickname: null,
    agentRole: null,
    turns: [],
  };
}

function externalBinding(): ExternalAgentBinding {
  return {
    bindingId: 'binding-1',
    runtimeId: 'runtime-1',
    nativeThreadId: 'thread-1',
    sessionId: 'session-1',
    agentId: 'agent-1',
    purpose: 'crew_agent',
    status: 'active',
    cwd: '/home/dev/rusty-view',
    effectiveConfigFingerprint: 'config',
    revision: 1,
    createdAt: '2026-07-11T00:00:00Z',
    updatedAt: '2026-07-11T00:00:00Z',
  };
}

function event(
  sequenceId: number,
  nativeTurnId: string,
  status?: string,
): NormalizedExternalRuntimeEvent {
  return {
    eventId: `event-${sequenceId}`,
    runtimeId: 'runtime-1',
    sequenceId,
    createdAt: '2026-07-11T00:00:00Z',
    kind: 'turn_lifecycle',
    nativeThreadId: 'thread-1',
    nativeTurnId,
    payload: {
      nativeMethod:
        status === undefined ? 'turn/diff/updated' : 'turn/completed',
      ...(status === undefined ? {} : { status }),
    },
  };
}
