import { TestBed } from '@angular/core/testing';
import type {
  ExternalAgentBinding,
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
});

function setupStore(options: {
  runtimes: readonly ExternalRuntimeRegistration[];
  bindings?: readonly ExternalAgentBinding[];
  listThreads: ReturnType<typeof vi.fn>;
  sendMessage?: ReturnType<typeof vi.fn>;
  submitControl?: ReturnType<typeof vi.fn>;
}): ExternalAgentStore {
  const external = {
    listRuntimes: vi.fn(async () => ({
      runtimes: options.runtimes,
      controllers: [],
    })),
    listBindings: vi.fn(async () => ({ bindings: options.bindings ?? [] })),
    listInteractions: vi.fn(async () => ({ interactions: [] })),
    listThreads: options.listThreads,
    listEvents: vi.fn(async () => ({ events: [] })),
    readThread: vi.fn(),
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
          streamExternalRuntimeEvents: vi.fn(),
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
