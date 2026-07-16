import { TestBed } from '@angular/core/testing';
import type {
  ExternalAgentBinding,
  ExternalAgentSessionCreateResult,
  ExternalInteractionRecord,
  ExternalRuntimeControllerStatus,
  ExternalRuntimeRegistration,
  ExternalThreadProjection,
  NormalizedExternalRuntimeEvent,
  SendExternalBindingMessageResponse,
  ExternalControlReceipt,
} from '@rusty-view/protocol';
import { ChatTransport, ChatTransportError } from '@rusty-view/transport';
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

  it('lets a terminal thread snapshot override a stale active event', () => {
    const store = setupStore({
      runtimes: [],
      listThreads: vi.fn(),
    });
    store.selectedThread.set(threadWithUserPrompts('finished prompt'));
    store.events.set([event(20, 'turn-1', 'inProgress')]);

    expect(store.turnPhase()).toBe('completed');
    expect(store.activeTurnId()).toBeUndefined();
  });
});

describe('external agent metadata editing', () => {
  it('revision-fences the write and updates the binding and visible title locally', async () => {
    const original = externalBinding();
    const updateBindingMetadata = vi.fn(async () => ({
      ...original,
      label: 'Planning follow-up',
      taskRef: { project_id: 'rusty-crew', task_id: '5764' },
      revision: 2,
    }));
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [original],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      updateBindingMetadata,
    });
    await store.refresh();
    const session = store.sessions()[0];
    if (session === undefined) throw new Error('expected session');

    await expect(
      store.updateSessionMetadata(session, {
        label: 'Planning follow-up',
        taskRef: { project_id: 'rusty-crew', task_id: '5764' },
      }),
    ).resolves.toBe(true);

    expect(updateBindingMetadata).toHaveBeenCalledWith('binding-1', {
      expectedRevision: 1,
      label: 'Planning follow-up',
      taskRef: { project_id: 'rusty-crew', task_id: '5764' },
    });
    expect(store.bindings()[0]).toMatchObject({
      revision: 2,
      label: 'Planning follow-up',
    });
    expect(store.sessions()[0]?.thread.name).toBe('Planning follow-up');
    expect(store.metadataNotice()).toBe('Session options saved.');
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

  it('switches between active and archived paginated inventories explicitly', async () => {
    const listThreads = vi.fn(
      async (_runtimeId: string, query?: { archived?: boolean }) =>
        page(
          [thread(query?.archived ? 'thread-archived' : 'thread-active', 10)],
          null,
        ),
    );
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      listThreads,
    });

    await store.refresh();
    await store.setArchivedInventory(true);
    expect(store.threads().map((item) => item.threadId)).toEqual([
      'thread-archived',
    ]);
    expect(listThreads).toHaveBeenLastCalledWith(
      'runtime-1',
      expect.objectContaining({ archived: true }),
    );

    await store.setArchivedInventory(false);
    expect(store.threads().map((item) => item.threadId)).toEqual([
      'thread-active',
    ]);
  });

  it('does not let a deferred active refresh overwrite an archived inventory switch', async () => {
    const activePage = deferred<ReturnType<typeof page>>();
    const listThreads = vi
      .fn()
      .mockImplementationOnce(() => activePage.promise)
      .mockImplementationOnce(() =>
        Promise.resolve(page([thread('thread-archived', 20)], null)),
      );
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      listThreads,
    });

    const activeRefresh = store.refresh();
    const archivedSwitch = store.setArchivedInventory(true);
    activePage.resolve(page([thread('thread-active', 10)], null));
    await Promise.all([activeRefresh, archivedSwitch]);

    expect(store.threads().map((item) => item.threadId)).toEqual([
      'thread-archived',
    ]);
    expect(listThreads).toHaveBeenLastCalledWith(
      'runtime-1',
      expect.objectContaining({ archived: true }),
    );
  });

  it('replays fleet events when an inventory switch races deferred thread and event reads', async () => {
    const activePage = deferred<ReturnType<typeof page>>();
    const activeEvents = deferred<{
      readonly events: readonly NormalizedExternalRuntimeEvent[];
    }>();
    const completed = {
      ...event(11, 'turn-native', 'completed'),
      eventId: 'event-native-completed',
      nativeThreadId: 'thread-native',
    };
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce(page([thread('thread-1', 10)], null))
      .mockImplementationOnce(() => activePage.promise)
      .mockResolvedValueOnce(page([], null))
      .mockResolvedValueOnce(page([thread('thread-native', 20)], null));
    const listEvents = vi
      .fn()
      .mockResolvedValueOnce({ events: [event(10, 'turn-1', 'completed')] })
      .mockImplementationOnce(() => activeEvents.promise)
      .mockResolvedValueOnce({ events: [completed] })
      .mockResolvedValueOnce({ events: [] });
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      listThreads,
      listEvents,
    });
    await store.refresh();

    const staleRefresh = store.refresh();
    const archivedSwitch = store.setInventoryMode('archived');
    activePage.resolve(page([thread('thread-stale', 15)], null));
    activeEvents.resolve({ events: [completed] });
    await Promise.all([staleRefresh, archivedSwitch]);

    expect(listEvents).toHaveBeenNthCalledWith(3, 'runtime-1', {
      after: 10,
      limit: 1_000,
    });

    await store.setInventoryMode('managed');
    const nativeSession = store
      .inventorySessions()
      .find((session) => session.thread.threadId === 'thread-native');
    expect(nativeSession).toMatchObject({
      phase: 'completed',
      unread: true,
      needsAttention: true,
    });
  });

  it('does not append a deferred active page after switching to archived history', async () => {
    const activePageTwo = deferred<ReturnType<typeof page>>();
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce(page([thread('thread-active-1', 10)], 'page-2'))
      .mockImplementationOnce(() => activePageTwo.promise)
      .mockResolvedValueOnce(page([thread('thread-archived', 30)], null));
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      listThreads,
    });
    await store.refresh();

    const loadMore = store.loadMoreThreads();
    await store.setArchivedInventory(true);
    activePageTwo.resolve(page([thread('thread-active-2', 20)], null));
    await loadMore;

    expect(store.threads().map((item) => item.threadId)).toEqual([
      'thread-archived',
    ]);
  });

  it('archives through Crew, clears selection, and reconciles the active list', async () => {
    let archived = false;
    const archiveThread = vi.fn(async () => {
      archived = true;
      return {
        runtimeId: 'runtime-1',
        threadId: 'thread-1',
        action: 'archive' as const,
        outcome: 'applied' as const,
        nativeArchived: true,
        bindings: [],
      };
    });
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [externalBinding()],
      listThreads: vi.fn(async () =>
        page(archived ? [] : [thread('thread-1', 10)], null),
      ),
      archiveThread,
    });
    await store.refresh();
    const session = store.sessions()[0];
    if (session === undefined) throw new Error('expected refreshed session');
    await store.selectSession(session);

    await expect(store.archiveThread(session)).resolves.toBe(true);

    expect(archiveThread).toHaveBeenCalledWith('runtime-1', 'thread-1');
    expect(store.selectedSessionKey()).toBeUndefined();
    expect(store.sessions()).toEqual([]);
    expect(store.lifecycleNotice()).toContain('Archived native Codex thread');
  });

  it('keeps healthy sessions when a stale binding thread cannot be recovered', async () => {
    const staleBinding = {
      ...externalBinding(),
      bindingId: 'binding-stale',
      nativeThreadId: 'thread-stale',
    };
    const readThread = vi
      .fn()
      .mockRejectedValue(new Error('thread not loaded'));
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [externalBinding(), staleBinding],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      readThread,
    });

    await store.refresh();

    expect(readThread).toHaveBeenCalledWith('runtime-1', {
      threadId: 'thread-stale',
      includeTurns: false,
    });
    expect(store.sessions().map((session) => session.thread.threadId)).toEqual([
      'thread-1',
    ]);
    expect(store.error()).toBeUndefined();
  });

  it('recovers missing active bindings without reading archived bindings', async () => {
    const missingActiveBinding = {
      ...externalBinding(),
      bindingId: 'binding-active-missing',
      nativeThreadId: 'thread-active-missing',
    };
    const archivedBinding = {
      ...externalBinding(),
      bindingId: 'binding-archived',
      nativeThreadId: 'thread-archived',
      status: 'archived' as const,
    };
    const readThread = vi.fn(
      async (
        _runtimeId: string,
        request: {
          threadId: string;
        },
      ) => ({ thread: thread(request.threadId, 20) }),
    );
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [externalBinding(), missingActiveBinding, archivedBinding],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      readThread,
    });

    await store.refresh();

    expect(readThread).toHaveBeenCalledTimes(1);
    expect(readThread).toHaveBeenCalledWith('runtime-1', {
      threadId: 'thread-active-missing',
      includeTurns: false,
    });
    expect(store.sessions().map((session) => session.thread.threadId)).toEqual([
      'thread-1',
      'thread-active-missing',
    ]);
  });

  it('does not retry a binding thread with a controller resume failure', async () => {
    const staleBinding = {
      ...externalBinding(),
      bindingId: 'binding-stale',
      nativeThreadId: 'thread-stale',
    };
    const readThread = vi.fn();
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      controllers: [
        {
          runtimeId: 'runtime-1',
          driverState: 'ready',
          controllerInstanceId: 'controller-1',
          controllerGeneration: 1,
          leaseExpiresAt: '2026-07-12T10:00:00.000Z',
          bindingResumeFailures: [
            {
              bindingId: 'binding-stale',
              nativeThreadId: 'thread-stale',
              reason: 'no rollout found for thread id',
              observedAt: '2026-07-12T09:00:00.000Z',
            },
          ],
        },
      ],
      bindings: [externalBinding(), staleBinding],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      readThread,
    });

    await store.refresh();
    await store.refresh();

    expect(readThread).not.toHaveBeenCalled();
    expect(store.sessions().map((session) => session.thread.threadId)).toEqual([
      'thread-1',
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
      archived: false,
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
    expect(store.messages()).toEqual([
      expect.objectContaining({
        author: expect.objectContaining({ role: 'user' }),
        status: 'error',
        blocks: [expect.objectContaining({ content: 'hello' })],
      }),
    ]);

    store.events.set([event(1, 'turn-1', 'inProgress')]);
    await store.interrupt();
    expect(store.error()).toContain('Interrupt failed: control offline');
  });

  it('projects a user prompt immediately and marks it accepted after delivery', async () => {
    const delivery = deferred<SendExternalBindingMessageResponse['data']>();
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [externalBinding()],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      sendMessage: vi.fn(() => delivery.promise),
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('thread-1');
    store.selectedThread.set(thread('thread-1', 10));

    const sending = store.send('hello now');

    expect(store.messages()).toEqual([
      expect.objectContaining({
        author: expect.objectContaining({ role: 'user' }),
        status: 'streaming',
        blocks: [expect.objectContaining({ content: 'hello now' })],
        metadata: expect.objectContaining({ deliveryStatus: 'sending' }),
      }),
    ]);

    delivery.resolve(deliveryReceipt());
    await sending;
    expect(store.messages()[0]).toMatchObject({
      status: 'completed',
      metadata: { deliveryStatus: 'accepted' },
    });
  });

  it('keeps an optimistic prompt before authoritative rows that stream later', async () => {
    const delivery = deferred<SendExternalBindingMessageResponse['data']>();
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [externalBinding()],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      sendMessage: vi.fn(() => delivery.promise),
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('thread-1');
    store.selectedThread.set(threadWithUserPrompts('older prompt'));

    const sending = store.send('current prompt');
    store.events.set([assistantTextEvent(1, 'Streaming after the prompt')]);

    expect(
      store.messages().map((message) => ({
        role: message.author.role,
        content: message.blocks[0]?.content,
      })),
    ).toEqual([
      { role: 'user', content: 'older prompt' },
      { role: 'user', content: 'current prompt' },
      { role: 'assistant', content: 'Streaming after the prompt' },
    ]);

    delivery.resolve(deliveryReceipt());
    await sending;
  });

  it('reconciles repeated optimistic prompts against native user messages without duplicates', async () => {
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [externalBinding()],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      sendMessage: vi.fn(async () => deliveryReceipt()),
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('thread-1');
    store.selectedThread.set(threadWithUserPrompts('hello'));

    await store.send('hello');
    await store.send('hello');
    expect(
      store.messages().filter((message) => message.author.role === 'user'),
    ).toHaveLength(3);

    store.selectedThread.set(threadWithUserPrompts('hello', 'hello', 'hello'));

    expect(
      store.messages().filter((message) => message.author.role === 'user'),
    ).toHaveLength(3);
    expect(
      store
        .messages()
        .filter(
          (message) => message.metadata?.['optimisticExternalUser'] === true,
        ),
    ).toHaveLength(0);
  });

  it('sends Plan collaboration mode once and returns the composer to auto', async () => {
    const sendMessage = vi.fn(async () => deliveryReceipt());
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

  it('keeps auto delivery on the binding message route even when events look active', async () => {
    const sendMessage = vi.fn(async () => deliveryReceipt());
    const submitControl = vi.fn(async () => controlReceipt());
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [externalBinding()],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      sendMessage,
      submitControl,
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('thread-1');
    store.events.set([event(1, 'turn-active', 'inProgress')]);

    await store.send('authority-safe prompt');

    expect(sendMessage).toHaveBeenCalledWith('binding-1', {
      body: 'authority-safe prompt',
      ttlMs: 60_000,
    });
    expect(submitControl).not.toHaveBeenCalled();
  });

  it('uses the control route only for an explicit steer', async () => {
    const sendMessage = vi.fn(async () => deliveryReceipt());
    const submitControl = vi.fn(async () => controlReceipt());
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [externalBinding()],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      sendMessage,
      submitControl,
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('thread-1');
    store.events.set([event(1, 'turn-active', 'inProgress')]);
    store.composerMode.set('steer');

    await store.send('steer this turn');

    expect(submitControl).toHaveBeenCalledWith(
      'binding-1',
      expect.objectContaining({
        kind: 'steer_turn',
        expectedNativeTurnId: 'turn-active',
      }),
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('attaches a successful-envelope delivery rejection to the optimistic prompt', async () => {
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [externalBinding()],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      sendMessage: vi.fn(async () =>
        deliveryReceipt('rejected', 'delivery_not_routable'),
      ),
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('thread-1');

    await store.send('keep this visible');

    expect(store.messages()[0]).toMatchObject({
      status: 'error',
      metadata: {
        deliveryStatus: 'failed',
        deliveryFailure: {
          operation: 'binding_message',
          endpoint: '/v1/external-bindings/binding-1/messages',
          reasonCode: 'delivery_not_routable',
          retryable: true,
        },
      },
    });
    expect(store.error()).toContain('delivery_not_routable');
  });

  it('refreshes stale steer authority and keeps structured transport failure details', async () => {
    const readThread = vi.fn(async () => ({
      thread: threadWithUserPrompts('turn already finished'),
    }));
    const listEvents = vi.fn(async () => ({ events: [] }));
    const submitControl = vi.fn(async () => {
      throw new ChatTransportError({
        code: 'http_error',
        message: 'The expected turn is no longer active.',
        statusCode: 409,
        endpoint: '/v1/external-bindings/binding-1/controls',
        apiError: {
          code: 'conflict',
          reason_code: 'external_turn_not_active',
          message: 'The expected turn is no longer active.',
          retryable: false,
        },
      });
    });
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [externalBinding()],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      listEvents,
      readThread,
      submitControl,
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('thread-1');
    store.events.set([event(1, 'turn-1', 'inProgress')]);
    store.composerMode.set('steer');

    await store.send('late steer');

    expect(readThread).toHaveBeenCalledWith('runtime-1', {
      threadId: 'thread-1',
      includeTurns: true,
    });
    expect(store.messages()[0]).toMatchObject({
      status: 'error',
      blocks: [expect.objectContaining({ content: 'late steer' })],
      metadata: {
        deliveryFailure: {
          operation: 'steer_turn',
          endpoint: '/v1/external-bindings/binding-1/controls',
          reasonCode: 'external_turn_not_active',
          statusCode: 409,
          retryable: true,
          transportCode: 'http_error',
        },
      },
    });
    expect(store.activeTurnId()).toBeUndefined();
  });

  it('discovers and executes external commands without using the message route', async () => {
    const listCommands = vi.fn(async () => externalCommandCatalog());
    const executeCommand = vi.fn(async () => externalCommandResult('applied'));
    const sendMessage = vi.fn();
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [externalBinding()],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      listCommands,
      executeCommand,
      sendMessage,
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('thread-1');

    await store.refreshSelectedCommands();
    await store.executeCommand('/status');

    expect(store.commandCatalog()?.settings.model).toBe('gpt-5.6');
    expect(executeCommand).toHaveBeenCalledWith('binding-1', {
      input: '/status',
      idempotencyKey: expect.stringMatching(/^rusty-view-command:/),
      expectedBindingRevision: 1,
    });
    expect(store.commandHistory()).toEqual(['/status']);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(listCommands).toHaveBeenCalledTimes(2);
  });

  it('keeps command rejection explicit and command history isolated by external session', async () => {
    const secondBinding = {
      ...externalBinding(),
      bindingId: 'binding-2',
      nativeThreadId: 'thread-2',
      sessionId: 'session-2',
    };
    const executeCommand = vi
      .fn()
      .mockResolvedValueOnce(externalCommandResult('rejected'))
      .mockResolvedValueOnce(externalCommandResult('applied'));
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [externalBinding(), secondBinding],
      listThreads: vi.fn(async () =>
        page([thread('thread-1', 10), thread('thread-2', 20)], null),
      ),
      listCommands: vi.fn(async () => externalCommandCatalog()),
      executeCommand,
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('thread-1');

    await store.executeCommand('/model unavailable');
    expect(store.commandError()).toContain('external_command_model_invalid');
    expect(store.commandHistory()).toEqual(['/model unavailable']);

    store.selectedThreadId.set('thread-2');
    await store.executeCommand('/status');
    expect(store.commandHistory()).toEqual(['/status']);

    store.selectedThreadId.set('thread-1');
    expect(store.commandHistory()).toEqual(['/model unavailable']);
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

  it('loads an inactive thread from its snapshot without replaying runtime history and caches it', async () => {
    let updatedAt = 10;
    const runtime = registration('runtime-1');
    const historicalEvent = {
      ...event(100, 'old-turn', 'completed'),
      nativeThreadId: 'other-thread',
    };
    const listEvents = vi.fn(
      async (_runtimeId: string, query?: { after?: number }) => ({
        events: query?.after === 100 ? [] : [historicalEvent],
      }),
    );
    const readThread = vi.fn(async () => ({
      thread: { ...thread('thread-1', updatedAt), status: 'idle' },
    }));
    const store = setupStore({
      runtimes: [runtime],
      bindings: [externalBinding()],
      listThreads: vi.fn(async () =>
        page([{ ...thread('thread-1', updatedAt), status: 'idle' }], null),
      ),
      listEvents,
      readThread,
    });
    await store.refresh();
    const first = store.sessions()[0];
    if (first === undefined) throw new Error('expected inactive session');

    await store.selectSession(first);
    await store.selectSession(first);

    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(readThread).toHaveBeenCalledTimes(1);
    expect(store.selectedThread()?.threadId).toBe('thread-1');
    expect(store.eventHistoryLoaded()).toBe(false);

    updatedAt = 20;
    await store.refresh();
    const changed = store.sessions()[0];
    if (changed === undefined) throw new Error('expected changed session');
    await store.selectSession(changed);

    expect(readThread).toHaveBeenCalledTimes(2);
    expect(store.selectedThread()?.updatedAt).toBe(20);
  });

  it('keeps the newest session selected when an older thread read finishes late', async () => {
    const runtime = registration('runtime-1');
    const firstRead = deferred<{ readonly thread: ExternalThreadProjection }>();
    const secondRead = deferred<{
      readonly thread: ExternalThreadProjection;
    }>();
    const readThread = vi
      .fn()
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => secondRead.promise);
    const listedThreads = [
      { ...thread('thread-1', 10), status: 'idle' },
      { ...thread('thread-2', 20), status: 'idle' },
    ];
    const store = setupStore({
      runtimes: [runtime],
      listThreads: vi.fn(async () => page(listedThreads, null)),
      listEvents: vi.fn(async (_runtimeId, query?: { after?: number }) => ({
        events:
          query?.after === undefined
            ? [
                {
                  ...event(100, 'old-turn', 'completed'),
                  nativeThreadId: 'other-thread',
                },
              ]
            : [],
      })),
      readThread,
    });
    await store.refresh();
    const [first, second] = store.sessions();
    if (first === undefined || second === undefined) {
      throw new Error('expected two sessions');
    }

    const selectingFirst = store.selectSession(first);
    const selectingSecond = store.selectSession(second);
    secondRead.resolve({
      thread: listedThreads[1] as ExternalThreadProjection,
    });
    await expect(selectingSecond).resolves.toBe(true);
    firstRead.resolve({ thread: listedThreads[0] as ExternalThreadProjection });
    await expect(selectingFirst).resolves.toBe(false);

    expect(store.selectedSessionKey()).toBe('runtime-1:thread-2');
    expect(store.selectedThread()?.threadId).toBe('thread-2');
  });

  it('loads inactive raw event history only when explicitly requested', async () => {
    const runtime = registration('runtime-1');
    const selectedThread = { ...thread('thread-1', 10), status: 'idle' };
    const selectedEvent = event(90, 'turn-1', 'completed');
    const fleetTail = {
      ...event(100, 'old-turn', 'completed'),
      nativeThreadId: 'other-thread',
    };
    const listEvents = vi
      .fn()
      .mockResolvedValueOnce({ events: [fleetTail] })
      .mockResolvedValueOnce({ events: [selectedEvent, fleetTail] });
    const store = setupStore({
      runtimes: [runtime],
      listThreads: vi.fn(async () => page([selectedThread], null)),
      listEvents,
      readThread: vi.fn(async () => ({ thread: selectedThread })),
    });
    await store.refresh();
    const session = store.sessions()[0];
    if (session === undefined) throw new Error('expected inactive session');
    await store.selectSession(session);

    expect(store.events()).toEqual([]);
    await expect(store.loadSelectedEventHistory()).resolves.toBe(true);

    expect(listEvents).toHaveBeenCalledTimes(2);
    expect(store.events()).toEqual([selectedEvent]);
    expect(store.eventHistoryLoaded()).toBe(true);
  });

  it('hydrates an active turn from its snapshot and catches up from the fleet cursor', async () => {
    const runtime = registration('runtime-1');
    const snapshot = {
      ...thread('thread-1', 10),
      turns: [
        {
          turnId: 'turn-live',
          status: 'inProgress',
          startedAt: 10,
          completedAt: null,
          durationMs: null,
          items: [],
        },
      ],
    };
    const fleetTail = {
      ...event(100, 'old-turn', 'completed'),
      nativeThreadId: 'other-thread',
    };
    const listEvents = vi.fn(async () => ({ events: [fleetTail] }));
    const streamExternalRuntimeEvents = vi.fn(() => ({
      close: vi.fn(),
      async *events() {
        yield* [];
      },
    }));
    const store = setupStore({
      runtimes: [runtime],
      listThreads: vi.fn(async () => page([snapshot], null)),
      listEvents,
      readThread: vi.fn(async () => ({ thread: snapshot })),
      streamExternalRuntimeEvents,
    });
    await store.refresh();
    const session = store.sessions()[0];
    if (session === undefined) throw new Error('expected active session');

    await store.selectSession(session);

    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(streamExternalRuntimeEvents).toHaveBeenCalledWith('runtime-1', 100);
    expect(store.activeTurnId()).toBe('turn-live');
    expect(store.turnPhase()).toBe('active');
    expect(store.eventHistoryLoaded()).toBe(false);
  });

  it('derives the active turn from a native snapshot before live events arrive', () => {
    const store = setupStore({ runtimes: [], listThreads: vi.fn() });
    store.selectedThread.set({
      ...thread('thread-1', 10),
      turns: [
        {
          turnId: 'turn-live',
          status: 'inProgress',
          startedAt: 10,
          completedAt: null,
          durationMs: null,
          items: [],
        },
      ],
    });

    expect(store.activeTurnId()).toBe('turn-live');
    expect(store.turnPhase()).toBe('active');
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

  it('preserves a created binding when an older fleet refresh finishes later', async () => {
    const staleBindings = deferred<{
      bindings: readonly ExternalAgentBinding[];
    }>();
    const result = createdSessionResult();
    const sendMessage = vi.fn();
    const store = setupStore({
      runtimes: [result.runtime],
      listBindings: vi.fn(() => staleBindings.promise),
      listThreads: vi.fn(async () => page([], null)),
      createAgentSession: vi.fn(async () => result),
      sendMessage,
    });

    const refresh = store.refresh();
    await Promise.resolve();
    await store.createSession({
      idempotencyKey: 'create-racing-refresh',
      runtimeId: result.runtime.runtimeId,
      profileId: 'tester',
      cwd: '/home/dev/rusty-view',
    });
    staleBindings.resolve({ bindings: [] });
    await refresh;

    expect(store.selectedBinding()?.bindingId).toBe('binding-created');
    await store.send('immediate message');
    expect(sendMessage).toHaveBeenCalledWith('binding-created', {
      body: 'immediate message',
      ttlMs: 60_000,
    });
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
  controllers?: readonly ExternalRuntimeControllerStatus[];
  bindings?: readonly ExternalAgentBinding[];
  listBindings?: ReturnType<typeof vi.fn>;
  listThreads: ReturnType<typeof vi.fn>;
  sendMessage?: ReturnType<typeof vi.fn>;
  submitControl?: ReturnType<typeof vi.fn>;
  listEvents?: ReturnType<typeof vi.fn>;
  readThread?: ReturnType<typeof vi.fn>;
  createAgentSession?: ReturnType<typeof vi.fn>;
  archiveThread?: ReturnType<typeof vi.fn>;
  unarchiveThread?: ReturnType<typeof vi.fn>;
  deleteThread?: ReturnType<typeof vi.fn>;
  listCommands?: ReturnType<typeof vi.fn>;
  executeCommand?: ReturnType<typeof vi.fn>;
  updateBindingMetadata?: ReturnType<typeof vi.fn>;
  streamExternalRuntimeEvents?: ReturnType<typeof vi.fn>;
}): ExternalAgentStore {
  const external = {
    listRuntimes: vi.fn(async () => ({
      runtimes: options.runtimes,
      controllers: options.controllers ?? [],
    })),
    listBindings:
      options.listBindings ??
      vi.fn(async () => ({ bindings: options.bindings ?? [] })),
    listInteractions: vi.fn(async () => ({ interactions: [] })),
    listThreads: options.listThreads,
    listEvents: options.listEvents ?? vi.fn(async () => ({ events: [] })),
    readThread: options.readThread ?? vi.fn(),
    createAgentSession: options.createAgentSession ?? vi.fn(),
    sendMessage:
      options.sendMessage ?? vi.fn(async () => deliveryReceipt('accepted')),
    submitControl:
      options.submitControl ?? vi.fn(async () => controlReceipt('applied')),
    archiveThread: options.archiveThread ?? vi.fn(),
    unarchiveThread: options.unarchiveThread ?? vi.fn(),
    deleteThread: options.deleteThread ?? vi.fn(),
    listCommands:
      options.listCommands ?? vi.fn(async () => externalCommandCatalog()),
    executeCommand: options.executeCommand ?? vi.fn(),
    updateBindingMetadata: options.updateBindingMetadata ?? vi.fn(),
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
          streamExternalRuntimeEvents:
            options.streamExternalRuntimeEvents ??
            vi.fn(() => ({
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
    effectiveModel: null,
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

function threadWithUserPrompts(
  ...prompts: readonly string[]
): ExternalThreadProjection {
  return {
    ...thread('thread-1', 10),
    turns: prompts.map((text, index) => ({
      turnId: `turn-${index + 1}`,
      status: 'completed',
      startedAt: index + 1,
      completedAt: index + 1,
      durationMs: 0,
      items: [
        {
          itemId: `user-${index + 1}`,
          kind: 'userMessage',
          status: 'completed',
          text,
        },
      ],
    })),
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

function deliveryReceipt(
  status: SendExternalBindingMessageResponse['data']['status'] = 'accepted',
  reasonCode: string | null = null,
): SendExternalBindingMessageResponse['data'] {
  return {
    request: {
      body: 'test message',
      createdAt: '2026-07-11T00:00:00Z',
      deliveryId: 'delivery-1',
      expiresAt: '2026-07-11T00:01:00Z',
      fromAgentId: 'agent-sender',
      idempotencyKey: 'delivery-key-1',
      messageId: 'message-1',
      requireWake: true,
      toAgentId: 'agent-1',
    },
    reasonCode,
    revision: 1,
    status,
  };
}

function controlReceipt(
  status: ExternalControlReceipt['status'] = 'applied',
  reasonCode: string | null = null,
): ExternalControlReceipt {
  return {
    request: {
      bindingId: 'binding-1',
      controlId: 'control-1',
      expectedBindingRevision: 1,
      expectedNativeTurnId: 'turn-active',
      idempotencyKey: 'control-key-1',
      kind: 'steer_turn',
      payload: {},
      requestedAt: '2026-07-11T00:00:00Z',
    },
    reasonCode,
    requestFingerprint: 'control-fingerprint',
    revision: 1,
    status,
    updatedAt: '2026-07-11T00:00:00Z',
  };
}

function externalCommandCatalog() {
  return {
    contractVersion: '0.7.0',
    runtimeId: 'runtime-1',
    bindingId: 'binding-1',
    nativeThreadId: 'thread-1',
    commands: [
      {
        name: 'status',
        aliases: [],
        usage: '/status',
        description: 'Show status',
        mutates: false,
        requiredCapabilities: [],
        available: true,
        unavailableReasonCode: null,
      },
    ],
    settings: {
      model: 'gpt-5.6',
      modelProvider: 'openai',
      effort: 'medium',
    },
    models: [],
  };
}

function externalCommandResult(status: 'applied' | 'rejected') {
  const rejected = status === 'rejected';
  return {
    commandId: 'command-1',
    input: rejected ? '/model unavailable' : '/status',
    command: rejected ? 'model' : 'status',
    argument: rejected ? 'unavailable' : null,
    status,
    reasonCode: rejected ? 'external_command_model_invalid' : null,
    message: rejected ? 'model unavailable' : 'Runtime ready',
    result: {},
    receipt: {},
  };
}

function createdSessionResult(): ExternalAgentSessionCreateResult {
  const runtime = registration('runtime-1');
  const createdThread = thread('thread-created', 30);
  const createdBinding: ExternalAgentBinding = {
    ...externalBinding(),
    bindingId: 'binding-created',
    nativeThreadId: createdThread.threadId,
    sessionId: 'session-created',
    agentId: 'agent-created',
  };
  return {
    creation: {
      creationId: 'creation-1',
      request: {
        idempotencyKey: 'create-racing-refresh',
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
        status: 'idle',
      },
      binding: createdBinding,
      nativeThreadSource: 'rusty-crew:create-racing-refresh',
      nativeThreadId: createdThread.threadId,
      phase: 'ready',
      revision: 4,
      createdAt: '2026-07-12T00:00:00Z',
      updatedAt: '2026-07-12T00:00:01Z',
    },
    runtime,
    thread: createdThread,
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

function assistantTextEvent(
  sequenceId: number,
  text: string,
): NormalizedExternalRuntimeEvent {
  return {
    eventId: `assistant-${sequenceId}`,
    runtimeId: 'runtime-1',
    sequenceId,
    createdAt: '2026-07-11T00:00:01Z',
    kind: 'assistant_text_delta',
    nativeThreadId: 'thread-1',
    nativeTurnId: 'turn-live',
    itemId: 'assistant-live',
    payload: {
      nativeMethod: 'item/agentMessage/delta',
      text,
    },
  };
}
