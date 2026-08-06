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
  type ExternalAgentSession,
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

  it('does not terminalize a turn while an error says Codex will retry', () => {
    const retrying = event(30, 'turn-new', 'failed', true);

    expect(latestExternalTurnPhase([retrying])).toBe('active');
    expect(activeExternalTurnId([retrying])).toBe('turn-new');
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

  it('keeps a retrying event active over a stale terminal snapshot', () => {
    const store = setupStore({
      runtimes: [],
      listThreads: vi.fn(),
    });
    const staleTerminalSnapshot = threadWithUserPrompts('retrying prompt');
    const staleTurn = staleTerminalSnapshot.turns[0];
    if (staleTurn === undefined) throw new Error('expected stale turn');
    store.selectedThread.set({
      ...staleTerminalSnapshot,
      turns: [
        {
          ...staleTurn,
          status: 'failed',
          terminalReasonCode: 'response_stream_connection_failed',
        },
      ],
    });
    store.events.set([event(30, 'turn-1', 'failed', true)]);

    expect(store.turnPhase()).toBe('active');
    expect(store.activeTurnId()).toBe('turn-1');
    expect(store.isTurnActive()).toBe(true);

    store.events.set([
      event(30, 'turn-1', 'failed', true),
      event(31, 'turn-1', 'failed', false),
    ]);

    expect(store.turnPhase()).toBe('failed');
    expect(store.activeTurnId()).toBeUndefined();
    expect(store.isTurnActive()).toBe(false);
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
  it('resolves a coordination session through a refreshed replacement binding', async () => {
    const runtime = registration('runtime-1');
    const selectedThread = thread('thread-1', 10);
    const readThread = vi.fn(async () => ({ thread: selectedThread }));
    const store = setupStore({
      runtimes: [runtime],
      bindings: [externalBinding()],
      listThreads: vi.fn(async () => page([selectedThread], null)),
      readThread,
    });

    await expect(
      store.selectCoordinationSession('session-1', 'stale-binding-id'),
    ).resolves.toBe(true);

    expect(store.selectedSessionKey()).toBe('runtime-1:thread-1');
    expect(store.selectedBinding()?.bindingId).toBe('binding-1');
    expect(readThread).toHaveBeenCalledWith('runtime-1', {
      threadId: 'thread-1',
      includeTurns: true,
    });
  });

  it('keeps a missing coordination binding non-destructive and visible', async () => {
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      listThreads: vi.fn(async () => page([], null)),
    });

    await expect(
      store.selectCoordinationSession('missing-session', 'missing-binding'),
    ).resolves.toBe(false);

    expect(store.selectedSessionKey()).toBeUndefined();
    expect(store.error()).toContain(
      'Codex session missing-session has no readable external binding',
    );
  });

  it('keeps a missing supplemental raw detail as a non-fatal notice', async () => {
    const store = setupStore({
      runtimes: [],
      listThreads: vi.fn(),
      rawDetail: vi.fn().mockRejectedValue(new Error('detail was evicted')),
    });

    await expect(
      store.loadRawDetail({
        ...event(1, 'turn-1', 'failed'),
        rawDetailRef: 'evicted-detail',
      }),
    ).resolves.toBeUndefined();

    expect(store.rawDetail()).toBeUndefined();
    expect(store.rawDetailError()).toContain('detail was evicted');
  });

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

  it('restores native history without reactivating its archived Crew binding', async () => {
    let nativeArchived = true;
    const archivedBinding = {
      ...externalBinding(),
      profileId: 'profile-1',
      status: 'archived' as const,
      revision: 4,
    };
    const unarchiveThread = vi.fn(async () => {
      nativeArchived = false;
      return {
        runtimeId: 'runtime-1',
        threadId: 'thread-1',
        action: 'unarchive' as const,
        outcome: 'applied' as const,
        nativeArchived: false,
        bindings: [],
      };
    });
    const restoreBinding = vi.fn();
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [archivedBinding],
      listThreads: vi.fn(async (_runtimeId, query) =>
        page(
          query?.archived === nativeArchived ? [thread('thread-1', 10)] : [],
          null,
        ),
      ),
      unarchiveThread,
      restoreBinding,
    });
    await store.setInventoryMode('archived');
    const session = store.sessions()[0];
    if (session === undefined) throw new Error('expected archived session');

    await expect(store.unarchiveThread(session)).resolves.toBe(true);

    expect(unarchiveThread).toHaveBeenCalledWith('runtime-1', 'thread-1');
    expect(restoreBinding).not.toHaveBeenCalled();
    expect(store.bindings()[0]).toMatchObject({
      bindingId: 'binding-1',
      status: 'archived',
      revision: 4,
    });
    expect(store.sessions()).toEqual([]);
    expect(store.lifecycleNotice()).toContain(
      'Restored native Codex thread thread-1',
    );
  });

  it('restores the exact archived Crew session and returns to managed inventory', async () => {
    let restored = false;
    const archivedBinding = {
      ...externalBinding(),
      profileId: 'profile-1',
      status: 'archived' as const,
      revision: 4,
    };
    const restoredBinding = {
      ...archivedBinding,
      status: 'active' as const,
      revision: 5,
    };
    const restoreBinding = vi.fn(async () => {
      restored = true;
      return {
        outcome: 'restored' as const,
        profileRevisionUpdated: false,
        binding: restoredBinding,
        session: { session_id: 'session-1', status: 'idle' },
      };
    });
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      listBindings: vi.fn(async () => ({
        bindings: [restored ? restoredBinding : archivedBinding],
      })),
      listThreads: vi.fn(
        async (
          _runtimeId: string,
          query?: {
            archived?: boolean;
          },
        ) => {
          const wantsArchived = query?.archived === true;
          return page(
            wantsArchived === !restored ? [thread('thread-1', 10)] : [],
            null,
          );
        },
      ),
      restoreBinding,
    });
    await store.setInventoryMode('archived');
    const session = store.sessions()[0];
    if (session === undefined) throw new Error('expected archived session');

    await expect(store.restoreBindingSession(session)).resolves.toBe(true);

    expect(restoreBinding).toHaveBeenCalledWith('binding-1', {
      expectedBindingRevision: 4,
      expectedSessionId: 'session-1',
      expectedAgentId: 'agent-1',
      expectedProfileId: 'profile-1',
      expectedNativeThreadId: 'thread-1',
    });
    expect(store.inventoryMode()).toBe('managed');
    expect(store.selectedSessionKey()).toBe('runtime-1:thread-1');
    expect(store.selectedBinding()).toMatchObject({
      status: 'active',
      revision: 5,
    });
    expect(store.lifecycleNotice()).toContain(
      'Restored Crew session session-1',
    );
  });

  it('reloads drifted binding state and requires a fresh restore confirmation', async () => {
    const archivedBinding = {
      ...externalBinding(),
      profileId: 'profile-1',
      status: 'archived' as const,
      revision: 4,
    };
    const restoreBinding = vi.fn().mockRejectedValue(
      new ChatTransportError({
        code: 'http_error',
        statusCode: 409,
        message: 'binding revision changed',
        apiError: {
          code: 'conflict',
          reason_code: 'external_binding_restore_revision_conflict',
          message: 'binding revision changed',
          retryable: false,
        },
      }),
    );
    const listBindings = vi.fn(async () => ({
      bindings: [{ ...archivedBinding, revision: 5 }],
    }));
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      listBindings,
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      restoreBinding,
    });
    await store.setInventoryMode('archived');
    const session = store.sessions()[0];
    if (session === undefined) throw new Error('expected archived session');

    await expect(store.restoreBindingSession(session)).resolves.toBe(false);

    expect(listBindings).toHaveBeenCalled();
    expect(store.bindings()[0]?.revision).toBe(5);
    expect(store.error()).toContain('review the exact identities');
    expect(store.error()).toContain(
      'external_binding_restore_revision_conflict',
    );
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
          observedCliVersion: '0.144.1',
          consumedContractRevision: 'external-runtime-api-v0',
          compatibilityState: 'certified',
          compatibilityDiagnostic: 'certified',
          lastCompatibilityProbe: null,
          recovery: {
            phase: 'idle',
            totalAttempts: 0,
            consecutiveFailures: 0,
            lastAttemptAt: null,
            lastRecoveredAt: null,
            nextAttemptAt: null,
            lastFailureReason: null,
          },
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

  it('keeps durable bindings visible when native inventory is unavailable on cold load', async () => {
    const store = setupStore({
      runtimes: [
        {
          ...registration('runtime-1'),
          observedState: 'degraded',
        },
      ],
      controllers: [
        {
          runtimeId: 'runtime-1',
          driverState: 'disconnected',
          controllerInstanceId: 'controller-1',
          controllerGeneration: 1,
          leaseExpiresAt: '2026-07-12T10:00:00.000Z',
          observedCliVersion: '0.144.1',
          consumedContractRevision: 'external-runtime-api-v0',
          compatibilityState: 'certified',
          compatibilityDiagnostic: 'disconnected',
          lastCompatibilityProbe: null,
          recovery: {
            phase: 'idle',
            totalAttempts: 0,
            consecutiveFailures: 0,
            lastAttemptAt: null,
            lastRecoveredAt: null,
            nextAttemptAt: null,
            lastFailureReason: null,
          },
          bindingResumeFailures: [],
        },
      ],
      bindings: [
        {
          ...externalBinding(),
          profileId: 'reviewer',
          label: 'Reviewer',
        },
      ],
      listThreads: vi
        .fn()
        .mockRejectedValue(new Error('Codex app-server disconnected')),
    });

    await store.refresh();

    expect(store.error()).toContain('Codex app-server disconnected');
    expect(store.sessions()).toHaveLength(1);
    expect(store.sessions()[0]).toMatchObject({
      key: 'runtime-1:thread-1',
      runtime: { runtimeId: 'runtime-1' },
      controller: { driverState: 'disconnected' },
      binding: {
        bindingId: 'binding-1',
        sessionId: 'session-1',
        profileId: 'reviewer',
        nativeThreadId: 'thread-1',
      },
      thread: {
        threadId: 'thread-1',
        sessionId: 'session-1',
        name: 'Reviewer',
        status: 'transport_unavailable',
      },
    });
  });

  it('enriches a binding fallback in place after native inventory reconnects', async () => {
    const nativeThread = {
      ...thread('thread-1', 42),
      preview: 'Native transcript preview',
      name: 'Native thread name',
    };
    const listThreads = vi
      .fn()
      .mockRejectedValueOnce(new Error('Codex app-server disconnected'))
      .mockResolvedValueOnce(page([nativeThread], null));
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [externalBinding()],
      listThreads,
    });

    await store.refresh();
    const fallback = store.sessions()[0];
    await store.refresh();
    const enriched = store.sessions()[0];

    expect(store.sessions()).toHaveLength(1);
    expect(enriched?.key).toBe(fallback?.key);
    expect(enriched?.binding?.bindingId).toBe(fallback?.binding?.bindingId);
    expect(enriched?.thread).toMatchObject({
      threadId: 'thread-1',
      preview: 'Native transcript preview',
      name: 'Native thread name',
      updatedAt: 42,
    });
    expect(store.error()).toBeUndefined();
  });

  it('retains other runtime inventories when one native runtime is unavailable', async () => {
    const runtimeTwoBinding = {
      ...externalBinding(),
      bindingId: 'binding-2',
      runtimeId: 'runtime-2',
      nativeThreadId: 'thread-2',
      sessionId: 'session-2',
      agentId: 'agent-2',
    };
    const store = setupStore({
      runtimes: [registration('runtime-1'), registration('runtime-2')],
      bindings: [externalBinding(), runtimeTwoBinding],
      listThreads: vi.fn(async (runtimeId: string) => {
        if (runtimeId === 'runtime-1') {
          throw new Error('runtime-1 disconnected');
        }
        return page([thread('thread-2', 20)], null);
      }),
    });

    await store.refresh();

    expect(
      store.sessions().map((session) => [session.key, session.thread.status]),
    ).toEqual([
      ['runtime-1:thread-1', 'transport_unavailable'],
      ['runtime-2:thread-2', 'active'],
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
          retryable: false,
          transportCode: 'http_error',
        },
      },
    });
    expect(store.activeTurnId()).toBeUndefined();
  });

  it('discards a deferred event page after switching runtimes with the same thread id', async () => {
    const staleEvents = deferred<{
      readonly events: readonly NormalizedExternalRuntimeEvent[];
    }>();
    const staleReadStarted = deferred<void>();
    let deferRuntimeOne = false;
    const listEvents = vi.fn(async (runtimeId: string) => {
      if (deferRuntimeOne && runtimeId === 'runtime-1') {
        staleReadStarted.resolve();
        return staleEvents.promise;
      }
      return { events: [] };
    });
    const sharedThreadId = 'shared-thread';
    const runtimeOneBinding = {
      ...externalBinding(),
      nativeThreadId: sharedThreadId,
    };
    const runtimeTwoBinding = {
      ...runtimeOneBinding,
      bindingId: 'binding-2',
      runtimeId: 'runtime-2',
      sessionId: 'session-2',
    };
    const store = setupStore({
      runtimes: [registration('runtime-1'), registration('runtime-2')],
      bindings: [runtimeOneBinding, runtimeTwoBinding],
      listThreads: vi.fn(async (runtimeId: string) =>
        page(
          [thread(sharedThreadId, runtimeId === 'runtime-1' ? 10 : 20)],
          null,
        ),
      ),
      listEvents,
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set(sharedThreadId);
    store.selectedThread.set(thread(sharedThreadId, 10));

    deferRuntimeOne = true;
    const firstSend = store.send('runtime one prompt');
    await staleReadStarted.promise;

    store.selectedRuntimeId.set('runtime-2');
    store.selectedThreadId.set(sharedThreadId);
    store.selectedThread.set(thread(sharedThreadId, 20));
    store.events.set([]);
    staleEvents.resolve({
      events: [
        {
          ...event(500, 'runtime-one-turn', 'inProgress'),
          nativeThreadId: sharedThreadId,
        },
      ],
    });
    await firstSend;

    expect(store.events()).toEqual([]);
    deferRuntimeOne = false;
    await store.send('runtime two prompt');
    expect(listEvents).toHaveBeenLastCalledWith('runtime-2', {
      limit: 1_000,
    });
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

  it('atomically switches an applied /new replacement and sends on the stable binding', async () => {
    const originalBinding = externalBinding();
    const replacementThread = thread('thread-replacement', 20);
    const readThread = vi.fn(async () => ({ thread: replacementThread }));
    const executeCommand = vi.fn(async () => ({
      ...externalCommandResult('applied'),
      input: '/new',
      command: 'new',
      result: {
        threadReplacement: {
          bindingId: originalBinding.bindingId,
          bindingRevision: 6,
          sessionId: originalBinding.sessionId ?? null,
          profileId: 'reviewer',
          cwd: '/home/dev/rusty-view',
          label: 'Replacement session',
          taskRef: { project_id: 'rusty-view', task_id: '5888' },
          previousNativeThreadId: 'thread-1',
          nativeThreadId: replacementThread.threadId,
          previousNativeThreadArchived: true,
          settingsPreserved: true,
          settings: {
            model: 'gpt-5.6',
            modelProvider: 'openai',
            effort: 'medium',
          },
        },
      },
    }));
    const sendMessage = vi.fn(async () => deliveryReceipt());
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      // This inventory intentionally remains stale until after /new.
      bindings: [originalBinding],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      readThread,
      executeCommand,
      sendMessage,
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('thread-1');
    store.selectedThread.set(thread('thread-1', 10));

    await store.executeCommand('/new');

    expect(readThread).toHaveBeenCalledWith('runtime-1', {
      threadId: 'thread-replacement',
      includeTurns: true,
    });
    expect(store.selectedThreadId()).toBe('thread-replacement');
    expect(store.selectedThread()).toBe(replacementThread);
    expect(store.selectedBinding()).toMatchObject({
      bindingId: 'binding-1',
      nativeThreadId: 'thread-replacement',
      sessionId: 'session-1',
      profileId: 'reviewer',
      revision: 6,
    });
    expect(
      store.commandResult()?.result.threadReplacement?.nativeThreadId,
    ).toBe('thread-replacement');

    await store.send('immediate replacement prompt');

    expect(sendMessage).toHaveBeenCalledWith('binding-1', {
      body: 'immediate replacement prompt',
      ttlMs: 60_000,
    });
    expect(store.messages()).toEqual([
      expect.objectContaining({
        sessionId: replacementThread.sessionId,
        metadata: expect.objectContaining({
          optimisticExternalUser: true,
          deliveryStatus: 'accepted',
        }),
      }),
    ]);
  });

  it('keeps an immediate post-/new transport failure visible on the replacement thread', async () => {
    const originalBinding = externalBinding();
    const replacementThread = thread('thread-replacement', 20);
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      bindings: [originalBinding],
      listThreads: vi.fn(async () => page([thread('thread-1', 10)], null)),
      readThread: vi.fn(async () => ({ thread: replacementThread })),
      executeCommand: vi.fn(async () => ({
        ...externalCommandResult('applied'),
        input: '/new',
        command: 'new',
        result: {
          threadReplacement: {
            bindingId: 'binding-1',
            bindingRevision: 2,
            sessionId: 'session-1',
            profileId: null,
            cwd: '/home/dev/rusty-view',
            label: null,
            taskRef: null,
            previousNativeThreadId: 'thread-1',
            nativeThreadId: 'thread-replacement',
            previousNativeThreadArchived: true,
            settingsPreserved: true,
            settings: {
              model: 'gpt-5.6',
              modelProvider: 'openai',
              effort: 'medium',
            },
          },
        },
      })),
      sendMessage: vi.fn(async () => {
        throw new ChatTransportError({
          code: 'network_error',
          message: 'Crew debug restarted during delivery',
          endpoint: '/v1/external-bindings/binding-1/messages',
        });
      }),
    });
    await store.refresh();
    store.selectedRuntimeId.set('runtime-1');
    store.selectedThreadId.set('thread-1');
    store.selectedThread.set(thread('thread-1', 10));

    await store.executeCommand('/new');
    await store.send('retryable replacement prompt');

    expect(store.selectedThreadId()).toBe('thread-replacement');
    expect(store.messages()).toEqual([
      expect.objectContaining({
        status: 'error',
        metadata: expect.objectContaining({
          deliveryStatus: 'failed',
          deliveryFailure: expect.objectContaining({
            endpoint: '/v1/external-bindings/binding-1/messages',
            message: 'Crew debug restarted during delivery',
            retryable: true,
          }),
        }),
      }),
    ]);
    expect(store.error()).toContain('Crew debug restarted during delivery');
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

  it('paints a cached active thread immediately while revalidating it', async () => {
    const runtime = registration('runtime-1');
    const firstThread = threadWithUserPrompts('hot transcript');
    const secondThread = thread('thread-2', 20);
    const revalidation = deferred<{
      readonly thread: ExternalThreadProjection;
    }>();
    const readThread = vi
      .fn()
      .mockResolvedValueOnce({ thread: firstThread })
      .mockResolvedValueOnce({ thread: secondThread })
      .mockImplementationOnce(() => revalidation.promise);
    const store = setupStore({
      runtimes: [runtime],
      listThreads: vi.fn(),
      listEvents: vi.fn(async () => ({ events: [] })),
      readThread,
    });
    const first: ExternalAgentSession = {
      key: 'runtime-1:thread-1',
      runtime,
      thread: firstThread,
      unread: false,
      needsAttention: false,
    };
    const second: ExternalAgentSession = {
      key: 'runtime-1:thread-2',
      runtime,
      thread: secondThread,
      unread: false,
      needsAttention: false,
    };

    await store.selectSession(first);
    await store.selectSession(second);
    const returning = store.selectSession(first);

    expect(store.loading()).toBe(false);
    expect(store.selectedThread()?.threadId).toBe('thread-1');
    expect(store.messages()[0]?.blocks[0]?.content).toBe('hot transcript');

    revalidation.resolve({ thread: firstThread });
    await expect(returning).resolves.toBe(true);
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
    const snapshot: ExternalThreadProjection = {
      ...thread('thread-1', 10),
      turns: [
        {
          turnId: 'turn-live',
          status: 'inProgress',
          statusSource: 'native',
          terminalReasonCode: null,
          error: null,
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

  it('seeds a large event cursor from one indexed tail read', async () => {
    const runtime = registration('runtime-1');
    const snapshot = { ...thread('thread-1', 10), status: 'active' as const };
    const latestSequence = 1_000_000_000_000_000;
    const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
      ...event(index + 1, 'old-turn', 'completed'),
      nativeThreadId: 'other-thread',
    }));
    const listEvents = vi.fn(async () => ({ events: firstPage }));
    const readEventHead = vi.fn(async () => ({
      event: {
        ...event(latestSequence, 'latest-turn', 'completed'),
        nativeThreadId: 'other-thread',
      },
    }));
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
      readEventHead,
      readThread: vi.fn(async () => ({ thread: snapshot })),
      streamExternalRuntimeEvents,
    });

    await store.refresh();
    const session = store.sessions()[0];
    if (session === undefined) throw new Error('expected active session');
    await store.selectSession(session);

    expect(streamExternalRuntimeEvents).toHaveBeenCalledWith(
      'runtime-1',
      latestSequence,
    );
    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(readEventHead).toHaveBeenCalledWith('runtime-1');
    expect(store.events()).toEqual([]);
  });

  it('surfaces a timed-out bootstrap and recovers on a later refresh', async () => {
    const snapshot = { ...thread('thread-1', 10), status: 'active' as const };
    const listEvents = vi
      .fn()
      .mockRejectedValueOnce(
        new ChatTransportError({
          code: 'network_error',
          message: 'Request timed out',
        }),
      )
      .mockResolvedValue({ events: [] });
    const store = setupStore({
      runtimes: [registration('runtime-1')],
      listThreads: vi.fn(async () => page([snapshot], null)),
      listEvents,
      readThread: vi.fn(async () => ({ thread: snapshot })),
    });

    await store.refresh();
    expect(store.error()).toContain('Request timed out');

    await store.refresh();
    expect(store.error()).toBeUndefined();
    const session = store.sessions()[0];
    if (session === undefined) throw new Error('expected active session');
    await expect(store.selectSession(session)).resolves.toBe(true);
    expect(store.error()).toBeUndefined();
  });

  it('derives the active turn from a native snapshot before live events arrive', () => {
    const store = setupStore({ runtimes: [], listThreads: vi.fn() });
    store.selectedThread.set({
      ...thread('thread-1', 10),
      turns: [
        {
          turnId: 'turn-live',
          status: 'inProgress',
          statusSource: 'native',
          terminalReasonCode: null,
          error: null,
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
  readEventHead?: ReturnType<typeof vi.fn>;
  readThread?: ReturnType<typeof vi.fn>;
  createAgentSession?: ReturnType<typeof vi.fn>;
  archiveThread?: ReturnType<typeof vi.fn>;
  unarchiveThread?: ReturnType<typeof vi.fn>;
  deleteThread?: ReturnType<typeof vi.fn>;
  listCommands?: ReturnType<typeof vi.fn>;
  executeCommand?: ReturnType<typeof vi.fn>;
  updateBindingMetadata?: ReturnType<typeof vi.fn>;
  restoreBinding?: ReturnType<typeof vi.fn>;
  rawDetail?: ReturnType<typeof vi.fn>;
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
    readEventHead:
      options.readEventHead ?? vi.fn(async () => ({ event: undefined })),
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
    restoreBinding: options.restoreBinding ?? vi.fn(),
    rawDetail: options.rawDetail ?? vi.fn(),
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
    compatibilityState: 'certified',
    consumedContractRevision: 'external-runtime-api-v0',
    observedCliVersion: '0.144.1',
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
      statusSource: 'native',
      terminalReasonCode: null,
      error: null,
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
    dynamicToolCatalogFingerprint: null,
    effectiveConfigFingerprint: 'config',
    messageDeliveryPolicy: 'immediate_steer',
    profileId: null,
    profilePromptHash: null,
    profilePromptSnapshot: null,
    profileRevision: null,
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
      inputKind: 'operator',
      messageId: 'message-1',
      requestedAddress: '@agent-1',
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
  willRetry?: boolean,
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
      ...(willRetry === undefined
        ? {}
        : {
            error: {
              message: 'temporary stream interruption',
              code: 'responseStreamConnectionFailed',
              additionalDetails: null,
              willRetry,
            },
          }),
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
