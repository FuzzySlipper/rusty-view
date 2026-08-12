import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { projectExternalAgentTranscript } from '@rusty-view/chat-domain';
import type { ChatMessage } from '@rusty-view/chat-domain';
import type {
  ExternalAgentBinding,
  ExternalAgentSessionCreateResult,
  ExternalAgentSessionCreateWrite,
  ExternalBindingMetadataWrite,
  ExternalBindingMessageWrite,
  ExternalBindingProfileState,
  ExternalBindingProfileRefreshReceipt,
  ExternalBindingRestoreWrite,
  ExternalControlReceipt,
  ExternalControlWrite,
  ExternalInteractionRecord,
  ExternalInteractionResolutionWrite,
  ExternalRuntimeControllerStatus,
  ExternalRuntimeCommandCatalog,
  ExternalRuntimeCommandExecutionResult,
  ExternalRuntimeRegistration,
  ExternalRuntimeRawDetail,
  ExternalRuntimeThreadReplacementResult,
  ExternalThreadProjection,
  ExternalThreadLifecycleReceipt,
  ExternalThreadTurnPage,
  ExternalTurnPhase,
  NormalizedExternalRuntimeEvent,
  SendExternalBindingMessageResponse,
} from '@rusty-view/protocol';
import {
  ChatTransportError,
  ChatTransport,
  type AdminProfileRegistryRecord,
  type ExternalRuntimeEventStream,
} from '@rusty-view/transport';
import {
  storeErrorDetail,
  storeErrorDetailMessage,
  type StoreErrorDetail,
} from './store-error';
import { WeightedLruCache } from './weighted-lru-cache';

export type ExternalComposerMode = 'auto' | 'steer' | 'queue' | 'plan';
export type ExternalAgentInventoryMode =
  | 'managed'
  | 'attention'
  | 'all'
  | 'archived';

export type ExternalAgentSessionRelationship =
  | 'bound'
  | 'lineage_predecessor'
  | 'lineage_successor'
  | 'lineage_successor_recovery_required'
  | 'recovery_required'
  | 'unbound';

export interface ExternalLineageTransition {
  readonly transitionId: string;
  readonly reasonCode: string;
  readonly predecessorLifecycle: 'retained' | 'archived';
  readonly movedRouteCount?: number;
}

export interface ExternalAgentSession {
  readonly key: string;
  readonly runtime: ExternalRuntimeRegistration;
  readonly controller?: ExternalRuntimeControllerStatus;
  readonly thread: ExternalThreadProjection;
  readonly binding?: ExternalAgentBinding;
  readonly relationship: ExternalAgentSessionRelationship;
  readonly lineageTransition?: ExternalLineageTransition;
  readonly phase?: ExternalTurnPhase;
  readonly unread: boolean;
  readonly needsAttention: boolean;
}

export interface ExternalAgentProfileOption {
  readonly profileId: string;
  readonly displayName?: string;
  readonly revision?: number;
}

interface RuntimeThread {
  readonly runtimeId: string;
  readonly thread: ExternalThreadProjection;
}

interface CachedExternalTranscript {
  readonly updatedAt: number;
  readonly thread: ExternalThreadProjection;
  readonly events: readonly NormalizedExternalRuntimeEvent[];
  readonly cursor?: number;
  readonly eventHistoryLoaded: boolean;
  readonly turnPage: ExternalThreadTurnPage;
}

export interface ExternalTurnHistoryError {
  readonly kind: 'recent' | 'older';
  readonly message: string;
}

interface OptimisticExternalUserMessage {
  readonly id: string;
  readonly text: string;
  readonly createdAt: string;
  readonly afterAuthoritativeMessageId?: string;
  readonly expectedOccurrence: number;
  readonly status: 'sending' | 'accepted' | 'failed';
  readonly failure?: ExternalPromptFailureDetail;
}

export interface ExternalPromptFailureDetail {
  readonly operation: 'binding_message' | 'steer_turn';
  readonly endpoint: string;
  readonly message: string;
  readonly reasonCode?: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly transportCode?: StoreErrorDetail['transportCode'];
}

export interface ExternalLifecycleRecovery {
  readonly action: 'archive' | 'new_session';
  readonly message: string;
  readonly retryLabel: string;
}

const EXTERNAL_TRANSCRIPT_CACHE_CAPACITY = 8;
const EXTERNAL_TRANSCRIPT_CACHE_WEIGHT = 60_000;
const EXTERNAL_EVENT_PAGE_SIZE = 1_000;
const EXTERNAL_TURN_PAGE_SIZE = 50;

@Injectable({ providedIn: 'root' })
export class ExternalAgentStore {
  private readonly transport = inject(ChatTransport);
  private readonly destroyRef = inject(DestroyRef);
  private stream: ExternalRuntimeEventStream | undefined;
  private polling = false;
  private refreshQueued = false;
  private readonly refreshIdleWaiters: Array<() => void> = [];
  private interactionsPolling = false;
  private bindingMutationRevision = 0;
  private readonly lifecycleAttemptKeys = new Map<string, string>();
  private selectionRevision = 0;
  private selectedRuntimeEventCursor: number | undefined;
  private readonly fleetCursors = new Map<string, number>();
  private readonly transcriptCache = new WeightedLruCache<
    string,
    CachedExternalTranscript
  >(EXTERNAL_TRANSCRIPT_CACHE_CAPACITY, EXTERNAL_TRANSCRIPT_CACHE_WEIGHT);
  private readonly threadCursors = signal<
    Readonly<Record<string, string | null>>
  >({});
  private readonly seen = signal<Readonly<Record<string, number>>>({});
  private readonly commandHistoryBySession = signal<
    Readonly<Record<string, readonly string[]>>
  >({});
  private readonly optimisticUserMessagesBySession = signal<
    Readonly<Record<string, readonly OptimisticExternalUserMessage[]>>
  >({});

  readonly runtimes = signal<readonly ExternalRuntimeRegistration[]>([]);
  readonly controllers = signal<readonly ExternalRuntimeControllerStatus[]>([]);
  readonly bindings = signal<readonly ExternalAgentBinding[]>([]);
  readonly bindingProfileStates = signal<
    readonly ExternalBindingProfileState[]
  >([]);
  readonly creationProfiles = signal<readonly ExternalAgentProfileOption[]>([]);
  private readonly runtimeThreads = signal<readonly RuntimeThread[]>([]);
  private readonly fleetEvents = signal<
    readonly NormalizedExternalRuntimeEvent[]
  >([]);
  readonly threads = computed(() =>
    this.runtimeThreads().map((item) => item.thread),
  );
  readonly interactions = signal<readonly ExternalInteractionRecord[]>([]);
  readonly events = signal<readonly NormalizedExternalRuntimeEvent[]>([]);
  readonly selectedRuntimeId = signal<string | undefined>(undefined);
  readonly selectedThreadId = signal<string | undefined>(undefined);
  readonly selectedSessionKey = computed(() => {
    const runtimeId = this.selectedRuntimeId();
    const threadId = this.selectedThreadId();
    return runtimeId === undefined || threadId === undefined
      ? undefined
      : sessionKey(runtimeId, threadId);
  });
  readonly selectedThread = signal<ExternalThreadProjection | undefined>(
    undefined,
  );
  readonly loading = signal(false);
  readonly eventHistoryLoading = signal(false);
  readonly eventHistoryLoaded = signal(false);
  readonly turnHistoryLoading = signal(false);
  readonly turnHistoryPage = signal<ExternalThreadTurnPage | undefined>(
    undefined,
  );
  readonly turnHistoryError = signal<ExternalTurnHistoryError | undefined>(
    undefined,
  );
  readonly hasOlderTurns = computed(
    () => this.turnHistoryPage()?.hasMoreBefore === true,
  );
  readonly pending = signal(false);
  readonly loadingMore = signal(false);
  readonly creatingSession = signal(false);
  readonly creationError = signal<string | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly archivedInventory = signal(false);
  readonly inventoryMode = signal<ExternalAgentInventoryMode>('managed');
  readonly lifecyclePendingThreadIds = signal<ReadonlySet<string>>(new Set());
  readonly bindingRestorePendingIds = signal<ReadonlySet<string>>(new Set());
  readonly lifecycleNotice = signal<string | undefined>(undefined);
  readonly lifecycleRecoveryBySession = signal<
    Readonly<Record<string, ExternalLifecycleRecovery>>
  >({});
  readonly metadataPendingBindingIds = signal<ReadonlySet<string>>(new Set());
  readonly metadataError = signal<string | undefined>(undefined);
  readonly metadataNotice = signal<string | undefined>(undefined);
  readonly rawDetail = signal<ExternalRuntimeRawDetail | undefined>(undefined);
  readonly rawDetailError = signal<string | undefined>(undefined);
  readonly composerMode = signal<ExternalComposerMode>('auto');
  readonly commandCatalog = signal<ExternalRuntimeCommandCatalog | undefined>(
    undefined,
  );
  readonly commandResult = signal<
    ExternalRuntimeCommandExecutionResult | undefined
  >(undefined);
  readonly commandError = signal<string | undefined>(undefined);
  readonly commandHistory = computed(
    () => this.commandHistoryBySession()[this.selectedSessionKey() ?? ''] ?? [],
  );

  readonly readyRuntimes = computed(() => {
    const controllers = new Map(
      this.controllers().map((controller) => [
        controller.runtimeId,
        controller.driverState,
      ]),
    );
    return this.runtimes().filter(
      (runtime) =>
        runtime.desiredState === 'enabled' &&
        runtime.observedState === 'ready' &&
        controllers.get(runtime.runtimeId) === 'ready',
    );
  });

  readonly sessions = computed<readonly ExternalAgentSession[]>(() => {
    const controllers = new Map(
      this.controllers().map((item) => [item.runtimeId, item]),
    );
    const bindings = this.bindings();
    const interactions = this.interactions();
    const events = this.fleetEvents();
    const selected = this.selectedSessionKey();
    const seen = this.seen();
    return this.runtimeThreads().flatMap(({ runtimeId, thread }) => {
      const runtime = this.runtimes().find(
        (item) => item.runtimeId === runtimeId,
      );
      if (runtime === undefined) return [];
      const binding = bindingForThread(bindings, runtime.runtimeId, thread);
      const relationship = externalSessionRelationship(
        bindings,
        thread,
        binding,
      );
      const controller = controllers.get(runtime.runtimeId);
      const key = sessionKey(runtime.runtimeId, thread.threadId);
      const phase = latestExternalTurnPhase(
        events,
        runtime.runtimeId,
        thread.threadId,
      );
      const unread = selected !== key && (seen[key] ?? 0) < thread.updatedAt;
      const needsAttention =
        interactions.some(
          (item) =>
            item.runtimeId === runtime.runtimeId &&
            item.nativeThreadId === thread.threadId &&
            item.status === 'pending',
        ) ||
        phase === 'failed' ||
        relationship === 'recovery_required' ||
        relationship === 'lineage_successor_recovery_required' ||
        (unread && (phase === 'completed' || phase === 'interrupted'));
      const lineageTransition = lineageTransitionForSession(
        events,
        bindings,
        binding,
      );
      return [
        {
          key,
          runtime,
          thread,
          relationship,
          ...(lineageTransition === undefined ? {} : { lineageTransition }),
          ...(phase === undefined ? {} : { phase }),
          unread,
          needsAttention,
          ...(controller === undefined ? {} : { controller }),
          ...(binding === undefined ? {} : { binding }),
        },
      ];
    });
  });

  readonly inventorySessions = computed(() =>
    filterExternalAgentSessions(
      this.sessions(),
      this.inventoryMode(),
      this.selectedSessionKey(),
    ),
  );

  readonly selectedBinding = computed(() => {
    const runtimeId = this.selectedRuntimeId();
    const threadId = this.selectedThreadId();
    return this.bindings().find(
      (item) =>
        item.runtimeId === runtimeId && item.nativeThreadId === threadId,
    );
  });

  profileStateFor(
    session: ExternalAgentSession,
  ): ExternalBindingProfileState | undefined {
    const bindingId = session.binding?.bindingId;
    return bindingId === undefined
      ? undefined
      : this.bindingProfileStates().find(
          (profileState) => profileState.bindingId === bindingId,
        );
  }

  lifecycleRecoveryFor(
    session: ExternalAgentSession,
  ): ExternalLifecycleRecovery | undefined {
    return this.lifecycleRecoveryBySession()[session.key];
  }

  readonly hasMoreThreads = computed(() =>
    Object.values(this.threadCursors()).some((cursor) => cursor !== null),
  );

  readonly selectedInteractions = computed(() => {
    const runtimeId = this.selectedRuntimeId();
    const threadId = this.selectedThreadId();
    return this.interactions().filter(
      (item) =>
        item.runtimeId === runtimeId && item.nativeThreadId === threadId,
    );
  });

  readonly messages = computed(() => {
    const authoritative = projectExternalAgentTranscript(
      this.selectedThread(),
      this.events(),
    );
    const key = this.selectedSessionKey();
    if (key === undefined) return authoritative;
    return mergeOptimisticUserMessages(
      authoritative,
      this.optimisticUserMessagesBySession()[key] ?? [],
      this.selectedThread()?.sessionId ?? key,
    );
  });

  readonly turnPhase = computed<ExternalTurnPhase | undefined>(() => {
    if (this.selectedInteractions().some((item) => item.status === 'pending')) {
      return 'waiting_interaction';
    }
    return reconciledExternalTurnPhase(this.events(), this.selectedThread());
  });

  readonly activeTurnId = computed(() =>
    reconciledActiveExternalTurnId(this.events(), this.selectedThread()),
  );

  readonly isTurnActive = computed(() => {
    return (
      this.activeTurnId() !== undefined ||
      this.turnPhase() === 'waiting_interaction'
    );
  });

  constructor() {
    const timer = setInterval(() => {
      void this.refresh();
      void this.refreshInteractions();
    }, 3_000);
    this.destroyRef.onDestroy(() => {
      clearInterval(timer);
      this.stream?.close();
    });
  }

  async refresh(): Promise<void> {
    if (this.polling) {
      this.refreshQueued = true;
      await new Promise<void>((resolve) =>
        this.refreshIdleWaiters.push(resolve),
      );
      return;
    }
    this.polling = true;
    const archivedInventory = this.archivedInventory();
    const bindingRevisionAtStart = this.bindingMutationRevision;
    this.loading.set(this.runtimes().length === 0);
    try {
      const [fleet, bindingFleet, attention] = await Promise.all([
        this.transport.external.listRuntimes(),
        this.transport.external.listBindings(),
        this.transport.external.listInteractions(),
      ]);
      this.runtimes.set(fleet.runtimes);
      this.controllers.set(fleet.controllers);
      const refreshedBindings =
        this.bindingMutationRevision === bindingRevisionAtStart
          ? bindingFleet.bindings
          : mergeBindings(this.bindings(), bindingFleet.bindings);
      this.bindings.set(refreshedBindings);
      this.bindingProfileStates.set(bindingFleet.profileStates ?? []);
      this.interactions.set(attention.interactions);
      const previousFleetEvents = this.fleetEvents();
      const activeRuntimeIds = new Set(
        fleet.runtimes.map((runtime) => runtime.runtimeId),
      );
      const previousThreadCursors = this.threadCursors();
      const nextThreadCursors: Record<string, string | null> = {};
      const nextFleetCursors = new Map<string, number>();
      const runtimeData = await Promise.all(
        fleet.runtimes.map(async (runtime) => {
          const existing = this.runtimeThreads()
            .filter((item) => item.runtimeId === runtime.runtimeId)
            .map((item) => item.thread);
          const [listedResult, eventBootstrapResult] = await Promise.allSettled(
            [
              this.transport.external.listThreads(runtime.runtimeId, {
                limit: 100,
                archived: archivedInventory,
              }),
              this.loadFleetEventBootstrap(runtime.runtimeId),
            ],
          );
          const errors = [listedResult, eventBootstrapResult].flatMap(
            (result) =>
              result.status === 'rejected' ? [errorMessage(result.reason)] : [],
          );
          const eventBootstrap =
            eventBootstrapResult.status === 'fulfilled'
              ? eventBootstrapResult.value
              : { events: [] };
          const events = eventBootstrap.events;
          const nextFleetCursor = eventBootstrap.cursor;
          if (nextFleetCursor !== undefined) {
            nextFleetCursors.set(runtime.runtimeId, nextFleetCursor);
          }
          if (listedResult.status === 'rejected') {
            const fallback = bindingFallbackThreads(
              refreshedBindings,
              runtime,
              archivedInventory,
            );
            return {
              runtimeId: runtime.runtimeId,
              authoritative: false,
              errors,
              events,
              threads: fallback.map((thread) => ({
                runtimeId: runtime.runtimeId,
                thread,
              })),
            };
          }
          const listed = listedResult.value;
          const knownThreads = mergeThreads(listed.items, existing);
          nextThreadCursors[runtime.runtimeId] = Object.hasOwn(
            previousThreadCursors,
            runtime.runtimeId,
          )
            ? (previousThreadCursors[runtime.runtimeId] ?? null)
            : listed.nextCursor;
          const known = new Set(knownThreads.map((thread) => thread.threadId));
          const failedResumeBindingIds = new Set(
            fleet.controllers
              .filter(
                (controller) => controller.runtimeId === runtime.runtimeId,
              )
              .flatMap((controller) => controller.bindingResumeFailures)
              .map((failure) => failure.bindingId),
          );
          const missingBoundIds = archivedInventory
            ? []
            : bindingsNeedingDirectThreadRead(
                refreshedBindings,
                runtime.runtimeId,
                known,
                failedResumeBindingIds,
              );
          const recoveredReads = await Promise.allSettled(
            [...new Set(missingBoundIds)].map(async (threadId) =>
              this.transport.external.readThread(runtime.runtimeId, {
                threadId,
                includeTurns: false,
                limit: 50,
              }),
            ),
          );
          const recovered = recoveredReads.flatMap((result) =>
            result.status === 'fulfilled' ? [result.value.thread] : [],
          );
          return {
            runtimeId: runtime.runtimeId,
            authoritative: true,
            errors,
            events,
            threads: mergeThreads(listed.items, recovered).map((thread) => ({
              runtimeId: runtime.runtimeId,
              thread,
            })),
          };
        }),
      );
      if (archivedInventory !== this.archivedInventory()) return;
      this.fleetCursors.clear();
      for (const [runtimeId, cursor] of nextFleetCursors) {
        this.fleetCursors.set(runtimeId, cursor);
      }
      this.threadCursors.update((current) =>
        Object.fromEntries(
          Object.entries(nextThreadCursors).map(([runtimeId, nextCursor]) => [
            runtimeId,
            Object.hasOwn(previousThreadCursors, runtimeId)
              ? (current[runtimeId] ?? null)
              : nextCursor,
          ]),
        ),
      );
      this.runtimeThreads.update((current) =>
        runtimeData.flatMap((item) => {
          const runtimeId = item.runtimeId;
          const currentThreads = current
            .filter((entry) => entry.runtimeId === runtimeId)
            .map((entry) => entry.thread);
          const refreshedThreads = item.threads.map((entry) => entry.thread);
          return mergeThreads(
            item.authoritative ? refreshedThreads : currentThreads,
            item.authoritative ? currentThreads : refreshedThreads,
          ).map((thread) => ({ runtimeId, thread }));
        }),
      );
      this.fleetEvents.set(
        mergeFleetEvents(
          previousFleetEvents.filter((event) =>
            activeRuntimeIds.has(event.runtimeId),
          ),
          runtimeData
            .flatMap((item) => item.events)
            .filter(
              (event) =>
                (event.kind === 'turn_lifecycle' &&
                  phaseValue(event.payload.status) !== undefined) ||
                event.kind === 'thread_lineage_replaced',
            ),
        ),
      );
      await this.refreshSelectedEvents();
      const runtimeErrors = runtimeData.flatMap((item) => item.errors);
      this.error.set(
        runtimeErrors.length === 0 ? undefined : runtimeErrors.join('; '),
      );
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.loading.set(false);
      this.polling = false;
      if (this.refreshQueued) {
        this.refreshQueued = false;
        void this.refresh();
      } else {
        for (const resolve of this.refreshIdleWaiters.splice(0)) resolve();
      }
    }
  }

  async setInventoryMode(mode: ExternalAgentInventoryMode): Promise<void> {
    if (this.inventoryMode() === mode) return;
    this.inventoryMode.set(mode);
    const archived = mode === 'archived';
    if (this.archivedInventory() === archived) return;
    this.archivedInventory.set(archived);
    this.runtimeThreads.set([]);
    this.threadCursors.set({});
    this.loading.set(true);
    await this.refresh();
  }

  async setArchivedInventory(archived: boolean): Promise<void> {
    await this.setInventoryMode(archived ? 'archived' : 'managed');
  }

  async refreshInteractions(): Promise<void> {
    if (this.interactionsPolling) return;
    this.interactionsPolling = true;
    try {
      const attention = await this.transport.external.listInteractions();
      this.interactions.set(attention.interactions);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.interactionsPolling = false;
    }
  }

  async refreshCreationProfiles(): Promise<void> {
    try {
      const page = await this.transport.adminProfileRegistry({
        limit: 100,
        lifecycleStatus: 'active',
      });
      this.creationProfiles.set(
        page.items
          .filter(
            (record: AdminProfileRegistryRecord) =>
              record.lifecycleStatus === 'active' &&
              (record.defaultSessionKind === undefined ||
                record.defaultSessionKind === 'full'),
          )
          .map((record: AdminProfileRegistryRecord) => ({
            profileId: record.profileId,
            ...(record.displayName === undefined
              ? {}
              : { displayName: record.displayName }),
            ...(record.revision === undefined
              ? {}
              : { revision: record.revision }),
          })),
      );
    } catch (error) {
      this.error.set(`Loading profiles failed: ${errorMessage(error)}`);
    }
  }

  async createSession(
    request: ExternalAgentSessionCreateWrite,
  ): Promise<ExternalAgentSessionCreateResult | undefined> {
    if (this.creatingSession()) return undefined;
    this.creatingSession.set(true);
    try {
      this.error.set(undefined);
      this.creationError.set(undefined);
      const result = await this.transport.external.createAgentSession(request);
      this.runtimes.update((runtimes) => [
        ...runtimes.filter(
          (runtime) => runtime.runtimeId !== result.runtime.runtimeId,
        ),
        result.runtime,
      ]);
      this.bindingMutationRevision += 1;
      this.bindings.update((bindings) => [
        ...bindings.filter(
          (binding) => binding.bindingId !== result.creation.binding.bindingId,
        ),
        result.creation.binding,
      ]);
      this.runtimeThreads.update((threads) => [
        ...threads.filter(
          (item) =>
            item.runtimeId !== result.runtime.runtimeId ||
            item.thread.threadId !== result.thread.threadId,
        ),
        { runtimeId: result.runtime.runtimeId, thread: result.thread },
      ]);
      this.selectCreatedSession(result);
      await this.refreshSelectedCommands();
      return result;
    } catch (error) {
      const message = `Create failed: ${errorMessage(error)}`;
      this.creationError.set(message);
      this.error.set(message);
      return undefined;
    } finally {
      this.creatingSession.set(false);
    }
  }

  private selectCreatedSession(result: ExternalAgentSessionCreateResult): void {
    this.selectionRevision += 1;
    this.stream?.close();
    const runtimeId = result.runtime.runtimeId;
    const threadId = result.thread.threadId;
    this.selectedRuntimeEventCursor = this.fleetCursors.get(runtimeId);
    this.events.set([]);
    this.rawDetail.set(undefined);
    this.rawDetailError.set(undefined);
    this.eventHistoryLoading.set(false);
    this.eventHistoryLoaded.set(false);
    this.turnHistoryLoading.set(false);
    this.turnHistoryError.set(undefined);
    this.turnHistoryPage.set(emptyExternalTurnPage());
    this.selectedRuntimeId.set(runtimeId);
    this.selectedThreadId.set(threadId);
    this.selectedThread.set(result.thread);
    this.seen.update((seen) => ({
      ...seen,
      [sessionKey(runtimeId, threadId)]: result.thread.updatedAt,
    }));
    this.startStream(runtimeId, this.selectedRuntimeEventCursor);
    this.error.set(undefined);
  }

  async selectSession(session: ExternalAgentSession): Promise<boolean> {
    const revision = ++this.selectionRevision;
    this.cacheSelectedTranscript();
    this.stream?.close();
    this.stream = undefined;
    const cached = this.transcriptCache.get(session.key);
    this.selectedRuntimeEventCursor = cached?.cursor;
    this.events.set(cached?.events ?? []);
    this.rawDetail.set(undefined);
    this.rawDetailError.set(undefined);
    this.eventHistoryLoading.set(false);
    this.eventHistoryLoaded.set(cached?.eventHistoryLoaded ?? false);
    this.turnHistoryLoading.set(false);
    this.turnHistoryError.set(undefined);
    this.turnHistoryPage.set(cached?.turnPage);
    const active = isActiveExternalSession(session);
    this.selectedThread.set(cached?.thread);
    this.commandCatalog.set(undefined);
    this.commandResult.set(undefined);
    this.commandError.set(undefined);
    this.selectedRuntimeId.set(session.runtime.runtimeId);
    this.selectedThreadId.set(session.thread.threadId);
    this.seen.update((seen) => ({
      ...seen,
      [session.key]: session.thread.updatedAt,
    }));
    this.loading.set(cached === undefined);
    try {
      const runtimeId = session.runtime.runtimeId;
      const fleetCursor = this.fleetCursors.get(runtimeId);
      const cachedIsAuthoritativeInactive =
        !active &&
        cached?.updatedAt === session.thread.updatedAt &&
        cached.eventHistoryLoaded;
      if (cached !== undefined) {
        this.selectedRuntimeEventCursor = latestDefinedCursor(
          cached.cursor,
          fleetCursor,
        );
        this.startStream(runtimeId, this.selectedRuntimeEventCursor);
      }
      if (cachedIsAuthoritativeInactive) {
        await this.refreshSelectedCommands(revision, session.key);
        if (!this.isCurrentSelection(revision, session.key)) return false;
        this.error.set(undefined);
        return true;
      }

      const read = await this.transport.external.readThread(runtimeId, {
        threadId: session.thread.threadId,
        includeTurns: true,
        limit: EXTERNAL_TURN_PAGE_SIZE,
      });
      if (!this.isCurrentSelection(revision, session.key)) return false;
      this.selectedThread.update((current) =>
        current === undefined
          ? read.thread
          : mergeExternalThreadPage(current, read.thread, 'newer'),
      );
      this.turnHistoryPage.set(
        cached?.turnPage ?? normalizedExternalTurnPage(read.turnPage),
      );
      this.selectedRuntimeEventCursor = latestDefinedCursor(
        this.selectedRuntimeEventCursor,
        fleetCursor,
      );
      this.cacheSelectedTranscript();
      if (cached === undefined) {
        this.startStream(runtimeId, this.selectedRuntimeEventCursor);
      }
      await this.refreshSelectedCommands(revision, session.key);
      if (!this.isCurrentSelection(revision, session.key)) return false;
      this.error.set(undefined);
      return true;
    } catch (error) {
      if (this.isCurrentSelection(revision, session.key)) {
        const message = `Loading the recent transcript page failed: ${errorMessage(error)}. Retry without losing the history already shown.`;
        this.error.set(message);
        this.turnHistoryError.set({ kind: 'recent', message });
      }
      return false;
    } finally {
      if (this.isCurrentSelection(revision, session.key)) {
        this.loading.set(false);
      }
    }
  }

  /**
   * Resolve a Crew coordination session to its bound native external thread.
   *
   * The coordination directory can briefly lag a binding replacement, so an
   * exact binding-id match is preferred but the stable Crew session id remains
   * a recovery key after one fleet refresh.
   */
  async selectCoordinationSession(
    sessionId: string,
    bindingId?: string,
  ): Promise<boolean> {
    const findSession = (): ExternalAgentSession | undefined => {
      const sessions = this.sessions();
      const exact =
        bindingId === undefined
          ? undefined
          : sessions.find(
              (session) => session.binding?.bindingId === bindingId,
            );
      return (
        exact ??
        sessions.find((session) => session.binding?.sessionId === sessionId)
      );
    };

    let session = findSession();
    if (session === undefined) {
      await this.refresh();
      session = findSession();
    }
    if (session === undefined) {
      this.error.set(
        `Codex session ${sessionId} has no readable external binding. Refresh Agents or open Codex management to inspect its runtime state.`,
      );
      return false;
    }
    return this.selectSession(session);
  }

  async loadSelectedEventHistory(): Promise<boolean> {
    const runtimeId = this.selectedRuntimeId();
    const threadId = this.selectedThreadId();
    const key = this.selectedSessionKey();
    if (
      runtimeId === undefined ||
      threadId === undefined ||
      key === undefined ||
      this.eventHistoryLoading() ||
      this.eventHistoryLoaded()
    ) {
      return false;
    }
    const revision = this.selectionRevision;
    this.eventHistoryLoading.set(true);
    try {
      const page = await this.listAllEvents(runtimeId, undefined, threadId);
      if (!this.isCurrentSelection(revision, key)) return false;
      const selected = page.filter(
        (event) => event.nativeThreadId === threadId,
      );
      const lastSequence = page.at(-1)?.sequenceId;
      if (lastSequence !== undefined) {
        this.selectedRuntimeEventCursor = Math.max(
          this.selectedRuntimeEventCursor ?? lastSequence,
          lastSequence,
        );
      }
      this.mergeEvents(selected);
      this.eventHistoryLoaded.set(true);
      this.cacheSelectedTranscript();
      return true;
    } catch (error) {
      if (this.isCurrentSelection(revision, key)) {
        this.error.set(`Loading event history failed: ${errorMessage(error)}`);
      }
      return false;
    } finally {
      if (this.isCurrentSelection(revision, key)) {
        this.eventHistoryLoading.set(false);
      }
    }
  }

  async loadOlderSelectedTurns(): Promise<boolean> {
    const runtimeId = this.selectedRuntimeId();
    const threadId = this.selectedThreadId();
    const key = this.selectedSessionKey();
    const page = this.turnHistoryPage();
    if (
      runtimeId === undefined ||
      threadId === undefined ||
      key === undefined ||
      page?.hasMoreBefore !== true ||
      this.turnHistoryLoading()
    ) {
      return false;
    }
    const beforeCursor = page.pageStartCursor;
    if (beforeCursor === null) {
      const message =
        'Older transcript history is available, but Crew did not provide a backward cursor. Refresh the session and retry.';
      this.turnHistoryError.set({ kind: 'older', message });
      this.error.set(message);
      return false;
    }

    const revision = this.selectionRevision;
    this.turnHistoryLoading.set(true);
    this.turnHistoryError.set(undefined);
    try {
      const read = await this.transport.external.readThread(runtimeId, {
        threadId,
        includeTurns: true,
        limit: EXTERNAL_TURN_PAGE_SIZE,
        beforeCursor,
      });
      if (!this.isCurrentSelection(revision, key)) return false;
      if (read.thread.threadId !== threadId) {
        throw new Error(
          `Crew returned thread ${read.thread.threadId} for requested thread ${threadId}`,
        );
      }
      const nextPage = normalizedExternalTurnPage(read.turnPage);
      if (nextPage.hasMoreBefore && nextPage.pageStartCursor === beforeCursor) {
        throw new Error(
          'Crew returned a stale backward cursor and did not advance the transcript page',
        );
      }
      this.selectedThread.update((current) =>
        current === undefined
          ? read.thread
          : mergeExternalThreadPage(current, read.thread, 'older'),
      );
      this.turnHistoryPage.set(nextPage);
      this.error.set(undefined);
      this.cacheSelectedTranscript();
      return true;
    } catch (error) {
      if (this.isCurrentSelection(revision, key)) {
        const message = `Loading older transcript history failed: ${errorMessage(error)}. Already-loaded messages were kept; retry this page.`;
        this.turnHistoryError.set({ kind: 'older', message });
        this.error.set(message);
      }
      return false;
    } finally {
      if (this.isCurrentSelection(revision, key)) {
        this.turnHistoryLoading.set(false);
      }
    }
  }

  async retrySelectedTurnHistory(): Promise<boolean> {
    const failure = this.turnHistoryError();
    if (failure?.kind === 'older') return this.loadOlderSelectedTurns();
    const key = this.selectedSessionKey();
    const session = this.sessions().find((candidate) => candidate.key === key);
    if (session === undefined) {
      const message =
        'The selected session is no longer in the loaded inventory. Refresh Agents and select it again.';
      this.turnHistoryError.set({ kind: 'recent', message });
      this.error.set(message);
      return false;
    }
    return this.selectSession(session);
  }

  lineagePeer(session: ExternalAgentSession): ExternalAgentSession | undefined {
    const binding = session.binding;
    if (binding === undefined) return undefined;
    const peerBindingId =
      session.relationship === 'lineage_predecessor'
        ? this.bindings().find(
            (candidate) =>
              candidate.runtimeId === binding.runtimeId &&
              candidate.lineage?.predecessorBindingId === binding.bindingId &&
              candidate.lineage.predecessorNativeThreadId ===
                session.thread.threadId,
          )?.bindingId
        : binding.lineage?.predecessorBindingId;
    if (peerBindingId === undefined) return undefined;
    return this.sessions().find(
      (candidate) => candidate.binding?.bindingId === peerBindingId,
    );
  }

  async switchToLineagePeer(session: ExternalAgentSession): Promise<boolean> {
    const peer = this.lineagePeer(session);
    if (peer === undefined) {
      this.error.set('The related Crew session is not currently available.');
      return false;
    }
    return this.selectSession(peer);
  }

  clearSelection(): void {
    this.cacheSelectedTranscript();
    this.selectionRevision += 1;
    this.stream?.close();
    this.stream = undefined;
    this.selectedRuntimeId.set(undefined);
    this.selectedThreadId.set(undefined);
    this.selectedThread.set(undefined);
    this.events.set([]);
    this.rawDetail.set(undefined);
    this.rawDetailError.set(undefined);
    this.eventHistoryLoading.set(false);
    this.eventHistoryLoaded.set(false);
    this.turnHistoryLoading.set(false);
    this.turnHistoryPage.set(undefined);
    this.turnHistoryError.set(undefined);
    this.selectedRuntimeEventCursor = undefined;
    this.commandCatalog.set(undefined);
    this.commandResult.set(undefined);
    this.commandError.set(undefined);
  }

  async refreshSelectedCommands(
    revision = this.selectionRevision,
    key = this.selectedSessionKey(),
  ): Promise<boolean> {
    const binding = this.selectedBinding();
    if (binding === undefined) {
      this.commandCatalog.set(undefined);
      this.commandError.set(
        'Command discovery failed: selected external thread has no Crew binding.',
      );
      return false;
    }
    const bindingId = binding.bindingId;
    try {
      const catalog = await this.transport.external.listCommands(bindingId);
      if (
        key === undefined ||
        !this.isCurrentSelection(revision, key) ||
        this.selectedBinding()?.bindingId !== bindingId
      ) {
        return false;
      }
      this.commandCatalog.set(catalog);
      return true;
    } catch (error) {
      if (
        key === undefined ||
        !this.isCurrentSelection(revision, key) ||
        this.selectedBinding()?.bindingId !== bindingId
      ) {
        return false;
      }
      this.commandCatalog.set(undefined);
      this.commandError.set(`Command discovery failed: ${errorMessage(error)}`);
      return false;
    }
  }

  async executeCommand(
    input: string,
  ): Promise<ExternalRuntimeCommandExecutionResult | undefined> {
    const binding = this.selectedBinding();
    this.recordCommand(input);
    if (binding === undefined) {
      this.commandError.set(
        'Command failed: selected external thread has no Crew binding.',
      );
      return undefined;
    }
    if (isProfileRefreshCommand(input)) {
      const session = this.sessions().find(
        (candidate) => candidate.binding?.bindingId === binding.bindingId,
      );
      if (session === undefined) {
        this.commandError.set(
          'Profile refresh failed: the selected binding is no longer present in the session inventory. Refresh Agents and try again.',
        );
        return undefined;
      }
      await this.refreshSessionProfile(session);
      return undefined;
    }
    this.pending.set(true);
    this.commandError.set(undefined);
    this.commandResult.set(undefined);
    try {
      const result = await this.transport.external.executeCommand(
        binding.bindingId,
        {
          input,
          idempotencyKey: `rusty-view-command:${createExternalAgentRequestKey()}`,
          expectedBindingRevision: binding.revision,
        },
      );
      this.commandResult.set(result);
      if (result.result.catalog !== undefined) {
        this.commandCatalog.set(result.result.catalog);
      }
      if (
        result.status === 'applied' &&
        result.result.threadReplacement !== undefined
      ) {
        try {
          await this.applyThreadReplacement(
            binding,
            result.result.threadReplacement,
            result.commandId,
          );
        } catch (error) {
          this.commandError.set(
            `Command applied, but loading replacement thread ${result.result.threadReplacement.nativeThreadId} failed: ${errorMessage(error)}`,
          );
        }
      }
      await Promise.all([
        this.refreshSelectedEvents(),
        this.refreshSelectedCommands(),
      ]);
      if (result.status !== 'applied') {
        this.commandError.set(
          `${result.message}${result.reasonCode === null ? '' : ` (${result.reasonCode})`}`,
        );
      }
      return result;
    } catch (error) {
      this.commandError.set(`Command failed: ${errorMessage(error)}`);
      return undefined;
    } finally {
      this.pending.set(false);
    }
  }

  async refreshSessionProfile(session: ExternalAgentSession): Promise<void> {
    const selectedBinding = session.binding;
    if (selectedBinding === undefined) {
      this.commandError.set(
        'Profile refresh failed: this native thread has no Crew binding.',
      );
      return;
    }
    this.pending.set(true);
    this.commandError.set(undefined);
    this.commandResult.set(undefined);
    this.lifecycleNotice.set(undefined);
    try {
      const fleet = await this.transport.external.listBindings();
      this.bindingProfileStates.set(fleet.profileStates ?? []);
      const binding = fleet.bindings.find(
        (candidate) => candidate.bindingId === selectedBinding.bindingId,
      );
      const profileState = fleet.profileStates.find(
        (candidate) => candidate.bindingId === selectedBinding.bindingId,
      );
      if (binding === undefined || binding.nativeThreadId == null) {
        throw new Error(
          'The selected Codex binding changed. Refresh Agents and run /refresh-profile again.',
        );
      }
      if (
        profileState === undefined ||
        profileState.currentProfileRevision === null ||
        profileState.currentPromptHash === null
      ) {
        throw new Error(
          'The current profile prompt is unavailable. Refresh Agents and inspect the profile before retrying.',
        );
      }
      const receipt = await this.transport.external.refreshBindingProfile(
        binding.bindingId,
        {
          expectedBindingRevision: binding.revision,
          expectedNativeThreadId: binding.nativeThreadId,
          expectedProfileRevision: profileState.currentProfileRevision,
          expectedProfilePromptHash: profileState.currentPromptHash,
        },
      );
      if (receipt.outcome === 'thread_replaced') {
        await this.applyProfileRefreshReplacement(binding, receipt);
        this.bindingProfileStates.update((states) => [
          ...states.filter(
            (profileState) =>
              profileState.bindingId !== receipt.profileState.bindingId,
          ),
          receipt.profileState,
        ]);
        this.lifecycleNotice.set(
          `Started a fresh Codex session with profile ${receipt.profileState.profileId ?? 'unknown'} revision ${receipt.profileState.appliedProfileRevision ?? 'unknown'} in ${receipt.binding.cwd}; exact switchboard routes were moved by Crew.`,
        );
        if (this.selectedBinding()?.bindingId === receipt.binding.bindingId) {
          await this.refreshSelectedCommands();
        }
        return;
      }
      this.bindingMutationRevision += 1;
      this.bindings.update((bindings) =>
        bindings.map((candidate) =>
          candidate.bindingId === receipt.binding.bindingId
            ? receipt.binding
            : candidate,
        ),
      );
      this.lifecycleNotice.set(
        receipt.outcome === 'already_current'
          ? 'The selected Codex session already uses the current profile prompt; no new session was created.'
          : 'Updated the selected Codex binding to the current profile revision; the prompt was unchanged, so the existing thread was preserved.',
      );
    } catch (error) {
      this.commandError.set(
        `Profile refresh failed: ${profileRefreshErrorMessage(error)}`,
      );
    } finally {
      this.pending.set(false);
    }
  }

  private async applyProfileRefreshReplacement(
    predecessor: ExternalAgentBinding,
    receipt: ExternalBindingProfileRefreshReceipt,
  ): Promise<void> {
    const successor = receipt.binding;
    if (
      successor.bindingId === predecessor.bindingId ||
      successor.nativeThreadId == null
    ) {
      throw new Error(
        'Crew profile refresh did not return a distinct bound successor thread.',
      );
    }
    const runtimeId = predecessor.runtimeId;
    const previousKey = sessionKey(runtimeId, receipt.previousNativeThreadId);
    const selectionRevision = this.selectionRevision;
    const stillSelected = () =>
      selectionRevision === this.selectionRevision &&
      this.selectedSessionKey() === previousKey;
    const read = await this.transport.external.readThread(runtimeId, {
      threadId: receipt.nativeThreadId,
      includeTurns: false,
      limit: 50,
    });

    this.bindingMutationRevision += 1;
    this.bindings.update((bindings) => [
      ...bindings.filter(
        (candidate) =>
          candidate.bindingId !== predecessor.bindingId &&
          candidate.bindingId !== successor.bindingId,
      ),
      successor,
    ]);
    this.transcriptCache.delete(previousKey);
    this.runtimeThreads.update((threads) => [
      ...threads.filter(
        (entry) =>
          entry.runtimeId !== runtimeId ||
          (entry.thread.threadId !== receipt.nativeThreadId &&
            entry.thread.threadId !== receipt.previousNativeThreadId),
      ),
      { runtimeId, thread: read.thread },
    ]);

    if (!stillSelected()) return;
    this.selectionRevision += 1;
    this.stream?.close();
    this.stream = undefined;
    this.selectedRuntimeEventCursor = this.fleetCursors.get(runtimeId);
    this.events.set([]);
    this.eventHistoryLoading.set(false);
    this.eventHistoryLoaded.set(false);
    this.turnHistoryLoading.set(false);
    this.turnHistoryPage.set(normalizedExternalTurnPage(read.turnPage));
    this.turnHistoryError.set(undefined);
    this.selectedRuntimeId.set(runtimeId);
    this.selectedThreadId.set(receipt.nativeThreadId);
    this.selectedThread.set(read.thread);
    this.seen.update((seen) => ({
      ...seen,
      [sessionKey(runtimeId, receipt.nativeThreadId)]: read.thread.updatedAt,
    }));
    this.startStream(runtimeId, this.selectedRuntimeEventCursor);
  }

  private async applyThreadReplacement(
    binding: ExternalAgentBinding,
    replacement: ExternalRuntimeThreadReplacementResult,
    transitionId: string,
  ): Promise<void> {
    if (replacement.previousBindingId !== binding.bindingId) {
      throw new Error(
        `Crew returned predecessor binding ${replacement.previousBindingId} for command binding ${binding.bindingId}`,
      );
    }
    if (replacement.bindingId === binding.bindingId) {
      throw new Error(
        `Crew returned predecessor binding ${binding.bindingId} as its own replacement`,
      );
    }

    const runtimeId = binding.runtimeId;
    const previousKey = sessionKey(
      runtimeId,
      replacement.previousNativeThreadId,
    );
    const selectionRevision = this.selectionRevision;
    const stillSelected = () =>
      selectionRevision === this.selectionRevision &&
      this.selectedSessionKey() === previousKey;
    const read = await this.transport.external.readThread(runtimeId, {
      threadId: replacement.nativeThreadId,
      includeTurns: false,
      limit: 50,
    });
    const sessionId = replacement.sessionId ?? binding.sessionId;
    const nextBinding: ExternalAgentBinding = {
      ...binding,
      bindingId: replacement.bindingId,
      nativeThreadId: replacement.nativeThreadId,
      ...(sessionId === undefined ? {} : { sessionId }),
      profileId: replacement.profileId,
      cwd: replacement.cwd,
      label: replacement.label,
      taskRef: replacement.taskRef,
      lineage:
        replacement.previousSessionId === null
          ? null
          : {
              predecessorBindingId: replacement.previousBindingId,
              predecessorSessionId: replacement.previousSessionId,
              predecessorNativeThreadId: replacement.previousNativeThreadId,
              transitionId,
              reasonCode: 'external_command_new_session',
              createdAt: binding.updatedAt,
            },
      revision: replacement.bindingRevision,
    };

    this.bindingMutationRevision += 1;
    this.bindings.update((bindings) => {
      const reconciledPredecessors = bindings
        .filter((candidate) => candidate.bindingId !== nextBinding.bindingId)
        .map((candidate) =>
          candidate.bindingId === replacement.previousBindingId &&
          replacement.previousNativeThreadArchived
            ? { ...candidate, status: 'archived' as const }
            : candidate,
        );
      return [...reconciledPredecessors, nextBinding];
    });
    this.transcriptCache.delete(previousKey);
    this.runtimeThreads.update((threads) => [
      ...threads.filter(
        (entry) =>
          entry.runtimeId !== runtimeId ||
          (entry.thread.threadId !== replacement.nativeThreadId &&
            (!replacement.previousNativeThreadArchived ||
              entry.thread.threadId !== replacement.previousNativeThreadId)),
      ),
      { runtimeId, thread: read.thread },
    ]);

    // A user may have selected another session while the replacement snapshot
    // was loading. Keep the fleet state current without stealing that newer
    // selection.
    if (!stillSelected()) return;

    this.selectionRevision += 1;
    this.stream?.close();
    this.stream = undefined;
    this.selectedRuntimeEventCursor = this.fleetCursors.get(runtimeId);
    this.events.set([]);
    this.eventHistoryLoading.set(false);
    this.eventHistoryLoaded.set(false);
    this.turnHistoryLoading.set(false);
    this.turnHistoryPage.set(normalizedExternalTurnPage(read.turnPage));
    this.turnHistoryError.set(undefined);
    this.selectedRuntimeId.set(runtimeId);
    this.selectedThreadId.set(replacement.nativeThreadId);
    this.selectedThread.set(read.thread);
    this.seen.update((seen) => ({
      ...seen,
      [sessionKey(runtimeId, replacement.nativeThreadId)]:
        read.thread.updatedAt,
    }));
    this.startStream(runtimeId, this.selectedRuntimeEventCursor);
  }

  async restartSession(session: ExternalAgentSession): Promise<boolean> {
    const binding = session.binding;
    if (binding === undefined) {
      this.error.set(
        'New session failed: this native thread has no Crew binding.',
      );
      return false;
    }
    const threadId = session.thread.threadId;
    if (this.lifecyclePendingThreadIds().has(threadId)) return false;
    this.lifecyclePendingThreadIds.update(
      (current) => new Set([...current, threadId]),
    );
    this.error.set(undefined);
    this.lifecycleNotice.set(undefined);
    const attemptKey = `new:${binding.bindingId}`;
    const idempotencyKey =
      this.lifecycleAttemptKeys.get(attemptKey) ??
      `rusty-view-new:${createExternalAgentRequestKey()}`;
    this.lifecycleAttemptKeys.set(attemptKey, idempotencyKey);
    try {
      const latest = await this.refreshBindingInventory(binding.bindingId);
      const result = await this.transport.external.executeCommand(
        latest.bindingId,
        {
          input: '/new',
          idempotencyKey,
          expectedBindingRevision: latest.revision,
        },
      );
      const replacement = result.result.threadReplacement;
      if (result.status !== 'applied' || replacement === undefined) {
        const message = newSessionRecoveryMessage(
          result.message,
          result.reasonCode,
        );
        if (result.reasonCode === 'external_command_restart_failed') {
          this.setLifecycleRecovery(session.key, {
            action: 'new_session',
            message,
            retryLabel: 'Reconcile new session',
          });
        } else {
          this.lifecycleAttemptKeys.delete(attemptKey);
          this.clearLifecycleRecovery(session.key);
        }
        this.error.set(message);
        return false;
      }
      await this.applyThreadReplacement(latest, replacement, result.commandId);
      const successor = await this.refreshBindingInventory(
        replacement.bindingId,
      );
      this.clearLifecycleRecovery(session.key);
      this.lifecycleAttemptKeys.delete(attemptKey);
      const profileState = this.bindingProfileStates().find(
        (state) => state.bindingId === successor.bindingId,
      );
      this.lifecycleNotice.set(
        `Started fresh session ${successor.sessionId ?? replacement.sessionId ?? replacement.nativeThreadId} with profile ${successor.profileId ?? replacement.profileId ?? 'unknown'} revision ${profileState?.appliedProfileRevision ?? 'unknown'} in ${replacement.cwd}. Crew archived the predecessor thread, binding, and session together.`,
      );
      return true;
    } catch (error) {
      const reasonCode =
        error instanceof ChatTransportError
          ? error.apiError?.reason_code
          : undefined;
      const message = newSessionRecoveryMessage(
        errorMessage(error),
        reasonCode,
      );
      if (reasonCode === 'external_command_restart_failed') {
        this.setLifecycleRecovery(session.key, {
          action: 'new_session',
          message,
          retryLabel: 'Reconcile new session',
        });
      } else {
        this.lifecycleAttemptKeys.delete(attemptKey);
        this.clearLifecycleRecovery(session.key);
      }
      this.error.set(message);
      return false;
    } finally {
      this.lifecyclePendingThreadIds.update((current) => {
        const next = new Set(current);
        next.delete(threadId);
        return next;
      });
    }
  }

  async interruptSession(session: ExternalAgentSession): Promise<boolean> {
    const binding = session.binding;
    if (binding === undefined) {
      this.error.set('Cancel failed: this native thread has no Crew binding.');
      return false;
    }
    const threadId = session.thread.threadId;
    if (this.lifecyclePendingThreadIds().has(threadId)) return false;
    this.lifecyclePendingThreadIds.update(
      (current) => new Set([...current, threadId]),
    );
    try {
      this.error.set(undefined);
      const latest = await this.refreshBindingInventory(binding.bindingId);
      const receipt = await this.transport.external.submitControl(
        latest.bindingId,
        {
          kind: 'interrupt_turn',
          expectedBindingRevision: latest.revision,
          idempotencyKey: `rusty-view-cancel:${createExternalAgentRequestKey()}`,
          payload: {},
        },
      );
      if (receipt.status !== 'applied') {
        this.error.set(
          `Cancel was ${receipt.status}${receipt.reasonCode == null ? '' : ` (${receipt.reasonCode})`}. Refresh the session state and retry if work is still active.`,
        );
        return false;
      }
      this.lifecycleNotice.set(
        `Cancelled the authoritative active turn for Crew session ${latest.sessionId ?? latest.bindingId}.`,
      );
      return true;
    } catch (error) {
      this.error.set(`Cancel failed: ${lifecycleErrorMessage(error)}`);
      return false;
    } finally {
      this.lifecyclePendingThreadIds.update((current) => {
        const next = new Set(current);
        next.delete(threadId);
        return next;
      });
    }
  }

  private async refreshBindingInventory(
    bindingId: string,
  ): Promise<ExternalAgentBinding> {
    const fleet = await this.transport.external.listBindings();
    this.bindingMutationRevision += 1;
    this.bindings.update((bindings) => mergeBindings(fleet.bindings, bindings));
    this.bindingProfileStates.set(fleet.profileStates ?? []);
    const binding = this.bindings().find(
      (candidate) => candidate.bindingId === bindingId,
    );
    if (binding === undefined) {
      throw new Error(`Crew binding ${bindingId} is no longer available.`);
    }
    return binding;
  }

  private setLifecycleRecovery(
    sessionKey: string,
    recovery: ExternalLifecycleRecovery,
  ): void {
    this.lifecycleRecoveryBySession.update((recoveries) => ({
      ...recoveries,
      [sessionKey]: recovery,
    }));
  }

  private clearLifecycleRecovery(sessionKey: string): void {
    this.lifecycleRecoveryBySession.update((recoveries) =>
      Object.fromEntries(
        Object.entries(recoveries).filter(([key]) => key !== sessionKey),
      ),
    );
  }

  private recordCommand(command: string): void {
    const key = this.selectedSessionKey();
    const trimmed = command.trim();
    if (key === undefined || trimmed.length === 0) return;
    this.commandHistoryBySession.update((histories) => {
      const current = histories[key] ?? [];
      const next = current[0] === trimmed ? current : [trimmed, ...current];
      return { ...histories, [key]: next.slice(0, 100) };
    });
  }

  async send(text: string): Promise<void> {
    await this.sendInternal(text, []);
  }

  async sendWithAttachments(
    text: string,
    attachmentIds: readonly string[],
    idempotencyKey?: string,
  ): Promise<boolean> {
    return this.sendInternal(text, attachmentIds, idempotencyKey);
  }

  private async sendInternal(
    text: string,
    attachmentIds: readonly string[],
    idempotencyKey?: string,
  ): Promise<boolean> {
    const binding = this.selectedBinding();
    if (binding === undefined) {
      this.error.set(
        'Send failed: selected external thread has no Crew binding.',
      );
      return false;
    }
    const optimisticId = this.addOptimisticUserMessage(text);
    const mode = this.composerMode();
    const operation: ExternalPromptFailureDetail['operation'] =
      mode === 'steer' && attachmentIds.length === 0
        ? 'steer_turn'
        : 'binding_message';
    this.pending.set(true);
    try {
      this.error.set(undefined);
      if (mode === 'steer' && attachmentIds.length === 0) {
        const activeTurnId = this.activeTurnId();
        if (activeTurnId === undefined || binding.nativeThreadId == null) {
          throw new Error('No active turn is available to steer');
        }
        const request: ExternalControlWrite = {
          kind: 'steer_turn',
          expectedNativeTurnId: activeTurnId,
          payload: {
            threadId: binding.nativeThreadId,
            turnId: activeTurnId,
            input: [{ type: 'text', text }],
          },
        };
        const receipt = await this.transport.external.submitControl(
          binding.bindingId,
          request,
        );
        const failure = controlReceiptFailure(binding.bindingId, receipt);
        if (failure !== undefined) {
          throw new ExternalPromptSubmissionError(failure);
        }
      } else {
        const request: ExternalBindingMessageWrite = {
          body: text,
          ttlMs: 60_000,
          ...(attachmentIds.length === 0
            ? {}
            : { attachmentIds: [...attachmentIds] }),
          ...(idempotencyKey === undefined
            ? {}
            : {
                deliveryId: `rusty-view:${idempotencyKey}`,
                idempotencyKey,
                messageId: `rusty-view:${idempotencyKey}`,
              }),
          ...(mode === 'plan' ? { collaborationMode: 'plan' } : {}),
        };
        const receipt = await this.transport.external.sendMessage(
          binding.bindingId,
          request,
        );
        const failure = deliveryReceiptFailure(binding.bindingId, receipt);
        if (failure !== undefined) {
          throw new ExternalPromptSubmissionError(failure);
        }
        if (mode === 'plan') this.composerMode.set('auto');
      }
      this.updateOptimisticUserMessage(optimisticId, 'accepted');
      await this.refreshSelectedEvents();
      if (attachmentIds.length > 0) {
        await this.refreshSelectedProjection().catch(() => undefined);
      }
      return true;
    } catch (error) {
      const failure =
        error instanceof ExternalPromptSubmissionError
          ? error.detail
          : promptFailureDetail(error, operation, binding.bindingId);
      this.updateOptimisticUserMessage(optimisticId, 'failed', failure);
      if (mode === 'steer') {
        await this.refreshSelectedProjection().catch(() => undefined);
      }
      this.error.set(`Send failed: ${promptFailureMessage(failure)}`);
      return false;
    } finally {
      this.pending.set(false);
    }
  }

  private addOptimisticUserMessage(text: string): string {
    const key = this.selectedSessionKey();
    const id = createExternalAgentRequestKey();
    if (key === undefined) return id;
    const authoritative = projectExternalAgentTranscript(
      this.selectedThread(),
      this.events(),
    );
    const authoritativeCount = userMessageOccurrenceCount(authoritative, text);
    const afterAuthoritativeMessageId = authoritative.at(-1)?.id;
    this.optimisticUserMessagesBySession.update((messagesBySession) => {
      const current = messagesBySession[key] ?? [];
      const pendingSameText = current.filter(
        (message) =>
          message.text === text &&
          message.expectedOccurrence > authoritativeCount,
      ).length;
      const next: OptimisticExternalUserMessage = {
        id,
        text,
        createdAt: new Date().toISOString(),
        ...(afterAuthoritativeMessageId === undefined
          ? {}
          : { afterAuthoritativeMessageId }),
        expectedOccurrence: authoritativeCount + pendingSameText + 1,
        status: 'sending',
      };
      return { ...messagesBySession, [key]: [...current, next].slice(-100) };
    });
    return id;
  }

  private updateOptimisticUserMessage(
    id: string,
    status: OptimisticExternalUserMessage['status'],
    failure?: ExternalPromptFailureDetail,
  ): void {
    this.optimisticUserMessagesBySession.update((messagesBySession) =>
      Object.fromEntries(
        Object.entries(messagesBySession).map(([key, messages]) => [
          key,
          messages.map((message) =>
            message.id === id
              ? {
                  ...message,
                  status,
                  ...(failure === undefined ? {} : { failure }),
                }
              : message,
          ),
        ]),
      ),
    );
  }

  private async refreshSelectedProjection(): Promise<void> {
    const runtimeId = this.selectedRuntimeId();
    const threadId = this.selectedThreadId();
    const key = this.selectedSessionKey();
    const revision = this.selectionRevision;
    if (
      runtimeId === undefined ||
      threadId === undefined ||
      key === undefined
    ) {
      return;
    }
    const [read] = await Promise.all([
      this.transport.external.readThread(runtimeId, {
        threadId,
        includeTurns: true,
        limit: EXTERNAL_TURN_PAGE_SIZE,
      }),
      this.refreshSelectedEvents(),
    ]);
    if (!this.isCurrentSelection(revision, key)) return;
    this.selectedThread.update((current) =>
      current === undefined
        ? read.thread
        : mergeExternalThreadPage(current, read.thread, 'newer'),
    );
    this.cacheSelectedTranscript();
  }

  async interrupt(): Promise<void> {
    const binding = this.selectedBinding();
    const turnId = this.activeTurnId();
    if (binding?.nativeThreadId == null || turnId === undefined) return;
    this.pending.set(true);
    try {
      this.error.set(undefined);
      await this.transport.external.submitControl(binding.bindingId, {
        kind: 'interrupt_turn',
        expectedNativeTurnId: turnId,
        payload: { threadId: binding.nativeThreadId, turnId },
      });
    } catch (error) {
      this.error.set(`Interrupt failed: ${errorMessage(error)}`);
    } finally {
      this.pending.set(false);
    }
  }

  async resolveInteraction(
    interaction: ExternalInteractionRecord,
    result: unknown,
  ): Promise<void> {
    const request: ExternalInteractionResolutionWrite = {
      expectedRevision: interaction.revision,
      idempotencyKey: `rusty-view:${interaction.interactionId}:${createExternalAgentRequestKey()}`,
      result,
    };
    await this.transport.external.resolveInteraction(
      interaction.interactionId,
      request,
    );
    await this.refresh();
  }

  async loadRawDetail(event: NormalizedExternalRuntimeEvent): Promise<void> {
    if (event.rawDetailRef == null) return;
    this.rawDetail.set(undefined);
    this.rawDetailError.set(undefined);
    try {
      this.rawDetail.set(
        await this.readRawDetail(event.runtimeId, event.rawDetailRef),
      );
    } catch (error) {
      this.rawDetailError.set(
        `Supplemental raw detail is unavailable. ${errorMessage(error)}`,
      );
    }
  }

  async readRawDetail(
    runtimeId: string,
    detailId: string,
  ): Promise<ExternalRuntimeRawDetail> {
    return this.transport.external.rawDetail(runtimeId, detailId);
  }

  async loadMoreThreads(): Promise<void> {
    if (this.loadingMore()) return;
    const cursors = this.threadCursors();
    const pending = Object.entries(cursors).filter(
      (entry): entry is [string, string] => entry[1] !== null,
    );
    if (pending.length === 0) return;
    const archivedInventory = this.archivedInventory();
    this.loadingMore.set(true);
    try {
      const pages = await Promise.all(
        pending.map(async ([runtimeId, cursor]) => ({
          runtimeId,
          page: await this.transport.external.listThreads(runtimeId, {
            limit: 100,
            cursor,
            archived: archivedInventory,
          }),
        })),
      );
      if (archivedInventory !== this.archivedInventory()) return;
      this.runtimeThreads.update((current) => {
        let next = [...current];
        for (const { runtimeId, page } of pages) {
          const otherRuntimes = next.filter(
            (item) => item.runtimeId !== runtimeId,
          );
          const runtimeThreads = next
            .filter((item) => item.runtimeId === runtimeId)
            .map((item) => item.thread);
          next = [
            ...otherRuntimes,
            ...mergeThreads(runtimeThreads, page.items).map((thread) => ({
              runtimeId,
              thread,
            })),
          ];
        }
        return next;
      });
      this.threadCursors.update((current) => ({
        ...current,
        ...Object.fromEntries(
          pages.map(({ runtimeId, page }) => [
            runtimeId,
            page.nextCursor === current[runtimeId] ? null : page.nextCursor,
          ]),
        ),
      }));
      this.error.set(undefined);
    } catch (error) {
      this.error.set(`Loading more sessions failed: ${errorMessage(error)}`);
    } finally {
      this.loadingMore.set(false);
    }
  }

  async archiveThread(session: ExternalAgentSession): Promise<boolean> {
    return this.mutateThreadLifecycle(session, 'archive');
  }

  async unarchiveThread(session: ExternalAgentSession): Promise<boolean> {
    return this.mutateThreadLifecycle(session, 'unarchive');
  }

  async deleteThread(session: ExternalAgentSession): Promise<boolean> {
    return this.mutateThreadLifecycle(session, 'delete');
  }

  bindingRestoreUnavailableReason(
    session: ExternalAgentSession,
  ): string | undefined {
    const binding = session.binding;
    if (binding === undefined) {
      return 'This native Codex thread has no Crew binding to restore.';
    }
    if (binding.status !== 'archived') {
      return 'The Crew binding is not archived.';
    }
    if (this.bindingRestorePendingIds().has(binding.bindingId)) {
      return 'This Crew session restore is already running.';
    }
    if (binding.sessionId == null) {
      return 'The archived binding has no exact Crew session identity.';
    }
    if (binding.agentId == null) {
      return 'The archived binding has no exact Crew agent identity.';
    }
    if (binding.profileId == null) {
      return 'The archived binding has no exact profile identity.';
    }
    if (binding.nativeThreadId == null) {
      return 'The archived binding has no exact native Codex thread identity.';
    }
    if (binding.nativeThreadId !== session.thread.threadId) {
      return 'The archived binding no longer matches this native Codex thread.';
    }
    return undefined;
  }

  async restoreBindingSession(session: ExternalAgentSession): Promise<boolean> {
    const binding = session.binding;
    const unavailable = this.bindingRestoreUnavailableReason(session);
    if (binding === undefined || unavailable !== undefined) {
      this.error.set(
        unavailable ?? 'The archived Crew binding is unavailable.',
      );
      return false;
    }
    const request = exactBindingRestoreWrite(binding);
    if (request === undefined) {
      this.error.set('The archived Crew binding identities are incomplete.');
      return false;
    }
    this.bindingRestorePendingIds.update(
      (current) => new Set([...current, binding.bindingId]),
    );
    this.error.set(undefined);
    this.lifecycleNotice.set(undefined);
    try {
      const receipt = await this.transport.external.restoreBinding(
        binding.bindingId,
        request,
      );
      this.bindingMutationRevision += 1;
      this.bindings.update((bindings) => [
        ...bindings.filter(
          (candidate) => candidate.bindingId !== receipt.binding.bindingId,
        ),
        receipt.binding,
      ]);
      this.transcriptCache.delete(session.key);
      this.lifecycleNotice.set(
        `Restored Crew session ${request.expectedSessionId} with its existing native Codex thread (${receipt.outcome}).`,
      );
      if (this.inventoryMode() === 'archived') {
        await this.setInventoryMode('managed');
      } else {
        await this.refresh();
      }
      const restored = this.sessions().find(
        (candidate) =>
          candidate.binding?.bindingId === receipt.binding.bindingId,
      );
      if (restored !== undefined) await this.selectSession(restored);
      return true;
    } catch (error) {
      if (error instanceof ChatTransportError && error.statusCode === 409) {
        await this.refresh();
      }
      this.error.set(bindingRestoreFailureMessage(error));
      return false;
    } finally {
      this.bindingRestorePendingIds.update((current) => {
        const next = new Set(current);
        next.delete(binding.bindingId);
        return next;
      });
    }
  }

  async updateSessionMetadata(
    session: ExternalAgentSession,
    metadata: Pick<ExternalBindingMetadataWrite, 'label' | 'taskRef'>,
  ): Promise<boolean> {
    const binding = session.binding;
    if (binding === undefined) {
      this.metadataError.set(
        'Session options are unavailable because this Codex thread has no Crew binding.',
      );
      return false;
    }
    if (this.metadataPendingBindingIds().has(binding.bindingId)) return false;
    this.metadataPendingBindingIds.update(
      (current) => new Set([...current, binding.bindingId]),
    );
    this.metadataError.set(undefined);
    this.metadataNotice.set(undefined);
    try {
      const saved = await this.transport.external.updateBindingMetadata(
        binding.bindingId,
        {
          expectedRevision: binding.revision,
          ...metadata,
        },
      );
      this.bindingMutationRevision += 1;
      this.transcriptCache.delete(session.key);
      this.bindings.update((bindings) =>
        bindings.map((candidate) =>
          candidate.bindingId === saved.bindingId ? saved : candidate,
        ),
      );
      const name = saved.label ?? null;
      this.runtimeThreads.update((threads) =>
        threads.map((entry) =>
          entry.runtimeId === session.runtime.runtimeId &&
          entry.thread.threadId === session.thread.threadId
            ? { ...entry, thread: { ...entry.thread, name } }
            : entry,
        ),
      );
      if (this.selectedSessionKey() === session.key) {
        this.selectedThread.update((thread) =>
          thread === undefined ? thread : { ...thread, name },
        );
      }
      this.metadataNotice.set('Session options saved.');
      return true;
    } catch (error) {
      if (error instanceof ChatTransportError && error.statusCode === 409) {
        this.metadataError.set(
          'Session metadata changed elsewhere. The latest revision was loaded; review and save again.',
        );
        await this.refresh();
      } else {
        this.metadataError.set(
          `Saving session options failed: ${errorMessage(error)}`,
        );
      }
      return false;
    } finally {
      this.metadataPendingBindingIds.update((current) => {
        const next = new Set(current);
        next.delete(binding.bindingId);
        return next;
      });
    }
  }

  private async mutateThreadLifecycle(
    session: ExternalAgentSession,
    action: 'archive' | 'unarchive' | 'delete',
  ): Promise<boolean> {
    const threadId = session.thread.threadId;
    if (this.lifecyclePendingThreadIds().has(threadId)) return false;
    this.lifecyclePendingThreadIds.update(
      (current) => new Set([...current, threadId]),
    );
    try {
      this.error.set(undefined);
      this.lifecycleNotice.set(undefined);
      const runtimeId = session.runtime.runtimeId;
      let notice: string;
      if (action === 'archive') {
        const receipt = await this.transport.external.archiveThread(
          runtimeId,
          threadId,
        );
        assertCoordinatedArchiveReceipt(session, receipt);
        notice = coordinatedArchiveNotice(session, receipt);
      } else if (action === 'unarchive') {
        const receipt = await this.transport.external.unarchiveThread(
          runtimeId,
          threadId,
        );
        notice = `Restored native Codex thread ${threadId} (${receipt.outcome}).`;
      } else {
        const receipt = await this.transport.external.deleteThread(
          runtimeId,
          threadId,
        );
        notice = `Deleted native Codex thread ${threadId} (${receipt.outcome}).`;
      }
      if (this.selectedSessionKey() === session.key) this.clearSelection();
      this.transcriptCache.delete(session.key);
      this.clearLifecycleRecovery(session.key);
      this.lifecycleNotice.set(notice);
      this.runtimeThreads.update((threads) =>
        threads.filter(
          (entry) =>
            entry.runtimeId !== runtimeId || entry.thread.threadId !== threadId,
        ),
      );
      await this.refresh();
      return true;
    } catch (error) {
      const message = `${capitalize(action)} failed: ${lifecycleErrorMessage(error)}`;
      if (action === 'archive' && isPartialLifecycleFailure(error)) {
        this.setLifecycleRecovery(session.key, {
          action: 'archive',
          message: `${message} Crew preserved the partial state. Use Reconcile archive to retry the same idempotent operation; it will finish whichever native, binding, or Crew-session step remains.`,
          retryLabel: 'Reconcile archive',
        });
      }
      this.error.set(this.lifecycleRecoveryFor(session)?.message ?? message);
      return false;
    } finally {
      this.lifecyclePendingThreadIds.update((current) => {
        const next = new Set(current);
        next.delete(threadId);
        return next;
      });
    }
  }

  private startStream(runtimeId: string, cursor?: number): void {
    this.stream = this.transport.streamExternalRuntimeEvents(runtimeId, cursor);
    const stream = this.stream;
    void (async () => {
      try {
        for await (const event of stream.events()) {
          if (this.stream !== stream) break;
          this.selectedRuntimeEventCursor = Math.max(
            this.selectedRuntimeEventCursor ?? event.sequenceId,
            event.sequenceId,
          );
          if (event.kind === 'thread_lineage_replaced') {
            this.fleetEvents.update((events) =>
              mergeFleetEvents(events, [event]),
            );
            void this.refresh();
          }
          if (event.nativeThreadId === this.selectedThreadId()) {
            this.appendEvents([event]);
            const settings = event.payload.settings;
            if (settings !== undefined) {
              this.commandCatalog.update((catalog) =>
                catalog === undefined ? catalog : { ...catalog, settings },
              );
            }
          }
          if (
            event.kind === 'turn_lifecycle' &&
            ['completed', 'failed', 'interrupted'].includes(
              event.payload.status ?? '',
            )
          ) {
            void this.refresh();
            if (event.nativeThreadId === this.selectedThreadId()) {
              void this.refreshSelectedProjection();
            }
          }
          if (
            event.kind === 'thread_lifecycle' &&
            event.payload.nativeMethod === 'thread/status/changed'
          ) {
            void this.refreshInteractions();
          }
        }
      } catch (error) {
        if (this.stream === stream) {
          this.error.set(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    })();
  }

  private async refreshSelectedEvents(): Promise<void> {
    const runtimeId = this.selectedRuntimeId();
    const threadId = this.selectedThreadId();
    const key = this.selectedSessionKey();
    const revision = this.selectionRevision;
    if (
      runtimeId === undefined ||
      threadId === undefined ||
      key === undefined
    ) {
      return;
    }
    const after = this.selectedRuntimeEventCursor;
    const page = await this.transport.external.listEvents(runtimeId, {
      ...(after === undefined ? {} : { after }),
      limit: 1_000,
      nativeThreadId: threadId,
    });
    if (
      !this.isCurrentSelection(revision, key) ||
      this.selectedRuntimeId() !== runtimeId ||
      this.selectedThreadId() !== threadId
    ) {
      return;
    }
    const lastSequence = page.events.at(-1)?.sequenceId;
    if (lastSequence !== undefined) {
      this.selectedRuntimeEventCursor = Math.max(
        this.selectedRuntimeEventCursor ?? lastSequence,
        lastSequence,
      );
    }
    this.appendEvents(
      page.events.filter((event) => event.nativeThreadId === threadId),
    );
  }

  private appendEvents(
    incoming: readonly NormalizedExternalRuntimeEvent[],
  ): void {
    if (incoming.length === 0) return;
    this.events.update((events) => {
      const known = new Set(events.map((event) => event.eventId));
      return [
        ...events,
        ...incoming.filter((event) => !known.has(event.eventId)),
      ];
    });
    this.cacheSelectedTranscript();
  }

  private mergeEvents(
    incoming: readonly NormalizedExternalRuntimeEvent[],
  ): void {
    if (incoming.length === 0) return;
    this.events.update((events) => {
      const merged = new Map(
        [...events, ...incoming].map((event) => [event.eventId, event]),
      );
      return [...merged.values()].sort(
        (left, right) => left.sequenceId - right.sequenceId,
      );
    });
    this.cacheSelectedTranscript();
  }

  private cacheSelectedTranscript(): void {
    const key = this.selectedSessionKey();
    const thread = this.selectedThread();
    if (key === undefined || thread === undefined) return;
    const events = this.events();
    const turnPage = this.turnHistoryPage() ?? emptyExternalTurnPage();
    this.transcriptCache.set(
      key,
      {
        updatedAt: thread.updatedAt,
        thread,
        events,
        ...(this.selectedRuntimeEventCursor === undefined
          ? {}
          : { cursor: this.selectedRuntimeEventCursor }),
        eventHistoryLoaded: this.eventHistoryLoaded(),
        turnPage,
      },
      events.length + thread.turns.length * 8,
    );
  }

  private isCurrentSelection(revision: number, key: string): boolean {
    return (
      revision === this.selectionRevision && this.selectedSessionKey() === key
    );
  }

  private async listAllEvents(
    runtimeId: string,
    initialAfter?: number,
    nativeThreadId?: string,
  ): Promise<NormalizedExternalRuntimeEvent[]> {
    const events: NormalizedExternalRuntimeEvent[] = [];
    let after = initialAfter;
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const page = await this.transport.external.listEvents(runtimeId, {
        limit: 1_000,
        ...(after === undefined ? {} : { after }),
        ...(nativeThreadId === undefined ? {} : { nativeThreadId }),
      });
      events.push(...page.events);
      const next = page.events.at(-1)?.sequenceId;
      if (page.events.length < 1_000 || next === undefined || next === after)
        break;
      after = next;
    }
    return events;
  }

  /**
   * Establish the fleet cursor without replaying an unbounded runtime history.
   *
   * Small runtimes retain their complete first page so lifecycle badges keep
   * their historical context. A full first page means history may be much
   * larger, so read the indexed event head once instead of probing sequence
   * numbers across the entire history. This avoids stranding the selected SSE
   * stream behind the former 100-page replay ceiling once a long-lived runtime
   * exceeds 100k events.
   */
  private async loadFleetEventBootstrap(runtimeId: string): Promise<{
    readonly events: readonly NormalizedExternalRuntimeEvent[];
    readonly cursor?: number;
  }> {
    const existingCursor = this.fleetCursors.get(runtimeId);
    if (existingCursor !== undefined) {
      const events = await this.listAllEvents(runtimeId, existingCursor);
      return {
        events,
        cursor: events.at(-1)?.sequenceId ?? existingCursor,
      };
    }

    const firstPage = await this.transport.external.listEvents(runtimeId, {
      limit: EXTERNAL_EVENT_PAGE_SIZE,
    });
    const firstCursor = firstPage.events.at(-1)?.sequenceId;
    if (
      firstCursor === undefined ||
      firstPage.events.length < EXTERNAL_EVENT_PAGE_SIZE
    ) {
      return {
        events: firstPage.events,
        ...(firstCursor === undefined ? {} : { cursor: firstCursor }),
      };
    }

    const head = await this.transport.external.readEventHead(runtimeId);
    return {
      events: [],
      cursor: head.event?.sequenceId ?? firstCursor,
    };
  }
}

function mergeOptimisticUserMessages(
  authoritative: readonly ChatMessage[],
  optimistic: readonly OptimisticExternalUserMessage[],
  sessionId: string,
): readonly ChatMessage[] {
  const occurrences = userMessageOccurrences(authoritative);
  const outstanding = optimistic.filter(
    (message) =>
      (occurrences.get(message.text) ?? 0) < message.expectedOccurrence,
  );
  if (outstanding.length === 0) return authoritative;

  const authoritativeIndexById = new Map(
    authoritative.map((message, index) => [message.id, index]),
  );
  const optimisticByBoundary = new Map<number, ChatMessage[]>();
  for (const message of outstanding) {
    const anchorIndex = authoritativeIndexById.get(
      message.afterAuthoritativeMessageId ?? '',
    );
    const boundary =
      message.afterAuthoritativeMessageId === undefined
        ? 0
        : anchorIndex === undefined
          ? chronologicalInsertionBoundary(authoritative, message.createdAt)
          : anchorIndex + 1;
    const projected = optimisticUserMessage(message, sessionId);
    optimisticByBoundary.set(boundary, [
      ...(optimisticByBoundary.get(boundary) ?? []),
      projected,
    ]);
  }

  const merged: ChatMessage[] = [...(optimisticByBoundary.get(0) ?? [])];
  authoritative.forEach((message, index) => {
    merged.push(message, ...(optimisticByBoundary.get(index + 1) ?? []));
  });
  return merged;
}

function chronologicalInsertionBoundary(
  authoritative: readonly ChatMessage[],
  createdAt: string,
): number {
  const optimisticTimestamp = Date.parse(createdAt);
  if (Number.isNaN(optimisticTimestamp)) return authoritative.length;
  const nextIndex = authoritative.findIndex((message) => {
    const timestamp = Date.parse(message.createdAt);
    return !Number.isNaN(timestamp) && timestamp > optimisticTimestamp;
  });
  return nextIndex < 0 ? authoritative.length : nextIndex;
}

function userMessageOccurrenceCount(
  messages: readonly ChatMessage[],
  text: string,
): number {
  return userMessageOccurrences(messages).get(text) ?? 0;
}

function userMessageOccurrences(
  messages: readonly ChatMessage[],
): ReadonlyMap<string, number> {
  const occurrences = new Map<string, number>();
  for (const message of messages) {
    if (message.author.role !== 'user') continue;
    const text = message.blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.content)
      .join('\n');
    occurrences.set(text, (occurrences.get(text) ?? 0) + 1);
  }
  return occurrences;
}

function optimisticUserMessage(
  optimistic: OptimisticExternalUserMessage,
  sessionId: string,
): ChatMessage {
  const id = `external-optimistic-user:${optimistic.id}`;
  return {
    id,
    sessionId,
    author: { role: 'user', displayName: undefined },
    createdAt: optimistic.createdAt,
    status:
      optimistic.status === 'failed'
        ? 'error'
        : optimistic.status === 'sending'
          ? 'streaming'
          : 'completed',
    blocks: [
      {
        id: `block:${id}`,
        messageId: id,
        kind: 'text',
        content: optimistic.text,
        estimatedHeight: undefined,
        renderPolicy: 'full',
      },
    ],
    metadata: {
      optimisticExternalUser: true,
      deliveryStatus: optimistic.status,
      ...(optimistic.failure === undefined
        ? {}
        : { deliveryFailure: optimistic.failure }),
    },
  };
}

export function sessionKey(runtimeId: string, threadId: string): string {
  return `${runtimeId}:${threadId}`;
}

function emptyExternalTurnPage(): ExternalThreadTurnPage {
  return {
    limit: EXTERNAL_TURN_PAGE_SIZE,
    hasMoreBefore: false,
    beforeCursor: null,
    pageStartCursor: null,
    pageEndCursor: null,
  };
}

function normalizedExternalTurnPage(
  page: ExternalThreadTurnPage | undefined,
): ExternalThreadTurnPage {
  return page ?? emptyExternalTurnPage();
}

function mergeExternalThreadPage(
  current: ExternalThreadProjection,
  incoming: ExternalThreadProjection,
  direction: 'older' | 'newer',
): ExternalThreadProjection {
  const orderedTurns =
    direction === 'older'
      ? [...incoming.turns, ...current.turns]
      : [...current.turns, ...incoming.turns];
  const turnOrder: string[] = [];
  const turnsById = new Map<
    string,
    ExternalThreadProjection['turns'][number]
  >();
  for (const turn of orderedTurns) {
    const previous = turnsById.get(turn.turnId);
    if (previous === undefined) turnOrder.push(turn.turnId);
    turnsById.set(
      turn.turnId,
      previous === undefined ? turn : mergeExternalTurn(previous, turn),
    );
  }
  const authoritative = direction === 'older' ? current : incoming;
  return {
    ...authoritative,
    turns: turnOrder.flatMap((turnId) => {
      const turn = turnsById.get(turnId);
      return turn === undefined ? [] : [turn];
    }),
  };
}

function mergeExternalTurn(
  current: ExternalThreadProjection['turns'][number],
  incoming: ExternalThreadProjection['turns'][number],
): ExternalThreadProjection['turns'][number] {
  const itemOrder: string[] = [];
  const itemsById = new Map<
    string,
    ExternalThreadProjection['turns'][number]['items'][number]
  >();
  for (const item of [...current.items, ...incoming.items]) {
    const previous = itemsById.get(item.itemId);
    if (previous === undefined) itemOrder.push(item.itemId);
    itemsById.set(
      item.itemId,
      previous === undefined ? item : { ...previous, ...item },
    );
  }
  return {
    ...current,
    ...incoming,
    items: itemOrder.flatMap((itemId) => {
      const item = itemsById.get(itemId);
      return item === undefined ? [] : [item];
    }),
  };
}

function latestDefinedCursor(
  first: number | undefined,
  second: number | undefined,
): number | undefined {
  if (first === undefined) return second;
  if (second === undefined) return first;
  return Math.max(first, second);
}

export function filterExternalAgentSessions(
  sessions: readonly ExternalAgentSession[],
  mode: ExternalAgentInventoryMode,
  selectedKey?: string,
): readonly ExternalAgentSession[] {
  if (mode === 'all' || mode === 'archived') return sessions;
  return sessions.filter((session) => {
    if (session.key === selectedKey) return true;
    const active = isActiveExternalSession(session);
    return mode === 'attention'
      ? session.needsAttention || active
      : session.binding !== undefined || session.needsAttention || active;
  });
}

function bindingForThread(
  bindings: readonly ExternalAgentBinding[],
  runtimeId: string,
  thread: ExternalThreadProjection,
): ExternalAgentBinding | undefined {
  const exact =
    thread.bindingId === null
      ? undefined
      : bindings.find(
          (binding) =>
            binding.runtimeId === runtimeId &&
            binding.bindingId === thread.bindingId,
        );
  return (
    exact ??
    bindings.find(
      (binding) =>
        binding.runtimeId === runtimeId &&
        binding.nativeThreadId === thread.threadId,
    )
  );
}

function externalSessionRelationship(
  bindings: readonly ExternalAgentBinding[],
  thread: ExternalThreadProjection,
  binding: ExternalAgentBinding | undefined,
): ExternalAgentSessionRelationship {
  if (binding === undefined) return 'unbound';
  const isPredecessor = bindings.some(
    (candidate) =>
      candidate.runtimeId === binding.runtimeId &&
      candidate.lineage?.predecessorBindingId === binding.bindingId &&
      candidate.lineage.predecessorNativeThreadId === thread.threadId,
  );
  if (isPredecessor) return 'lineage_predecessor';
  if (binding.lineage != null) {
    return binding.status === 'active' && thread.nativeMaterialized === false
      ? 'lineage_successor_recovery_required'
      : 'lineage_successor';
  }
  if (binding.status === 'active' && thread.nativeMaterialized === false) {
    return 'recovery_required';
  }
  return 'bound';
}

function lineageTransitionForSession(
  events: readonly NormalizedExternalRuntimeEvent[],
  bindings: readonly ExternalAgentBinding[],
  binding: ExternalAgentBinding | undefined,
): ExternalLineageTransition | undefined {
  if (binding?.lineage == null) return undefined;
  const event = events
    .filter(
      (candidate) =>
        candidate.kind === 'thread_lineage_replaced' &&
        candidate.payload.successorBindingId === binding.bindingId,
    )
    .at(-1);
  const predecessor = bindings.find(
    (candidate) =>
      candidate.bindingId === binding.lineage?.predecessorBindingId,
  );
  const eventLifecycle = event?.payload.predecessorLifecycle;
  return {
    transitionId: event?.requestId ?? binding.lineage.transitionId,
    reasonCode: event?.payload.reasonCode ?? binding.lineage.reasonCode,
    predecessorLifecycle:
      eventLifecycle === 'retained' || eventLifecycle === 'archived'
        ? eventLifecycle
        : predecessor?.status === 'archived'
          ? 'archived'
          : 'retained',
    ...(event?.payload.movedRouteCount === undefined
      ? {}
      : { movedRouteCount: event.payload.movedRouteCount }),
  };
}

function mergeFleetEvents(
  existing: readonly NormalizedExternalRuntimeEvent[],
  incoming: readonly NormalizedExternalRuntimeEvent[],
): NormalizedExternalRuntimeEvent[] {
  const merged = new Map<string, NormalizedExternalRuntimeEvent>();
  for (const event of [...existing, ...incoming]) {
    const key =
      event.kind === 'thread_lineage_replaced' && event.requestId != null
        ? `${event.runtimeId}:${event.kind}:${event.requestId}`
        : event.eventId;
    const previous = merged.get(key);
    if (previous === undefined || event.sequenceId >= previous.sequenceId) {
      merged.set(key, event);
    }
  }
  return [...merged.values()].sort(
    (left, right) => left.sequenceId - right.sequenceId,
  );
}

function bindingsNeedingDirectThreadRead(
  bindings: readonly ExternalAgentBinding[],
  runtimeId: string,
  knownThreadIds: ReadonlySet<string>,
  failedResumeBindingIds: ReadonlySet<string>,
): string[] {
  const predecessorBindingIds = new Set(
    bindings.flatMap((binding) =>
      binding.runtimeId === runtimeId && binding.lineage != null
        ? [binding.lineage.predecessorBindingId]
        : [],
    ),
  );
  return bindings.flatMap((binding) => {
    const nativeThreadId = binding.nativeThreadId;
    if (
      binding.runtimeId !== runtimeId ||
      nativeThreadId == null ||
      knownThreadIds.has(nativeThreadId)
    ) {
      return [];
    }
    const isRecoverablePredecessor = predecessorBindingIds.has(
      binding.bindingId,
    );
    const isHealthyActiveBinding =
      binding.status === 'active' &&
      !failedResumeBindingIds.has(binding.bindingId);
    return isRecoverablePredecessor || isHealthyActiveBinding
      ? [nativeThreadId]
      : [];
  });
}

export function isActiveExternalSession(
  session: ExternalAgentSession,
): boolean {
  return (
    session.phase === 'active' ||
    session.phase === 'waiting_interaction' ||
    session.thread.status === 'active'
  );
}

export function createExternalAgentRequestKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

export function mergeThreads(
  preferred: readonly ExternalThreadProjection[],
  additional: readonly ExternalThreadProjection[],
): ExternalThreadProjection[] {
  const seen = new Set(preferred.map((thread) => thread.threadId));
  const merged = [...preferred];
  for (const thread of additional) {
    if (seen.has(thread.threadId)) continue;
    seen.add(thread.threadId);
    merged.push(thread);
  }
  return merged;
}

function bindingFallbackThreads(
  bindings: readonly ExternalAgentBinding[],
  runtime: ExternalRuntimeRegistration,
  archived: boolean,
): ExternalThreadProjection[] {
  return bindings.flatMap((binding) => {
    if (
      binding.runtimeId !== runtime.runtimeId ||
      binding.nativeThreadId == null ||
      (archived ? binding.status !== 'archived' : binding.status !== 'active')
    ) {
      return [];
    }
    const createdAt = Date.parse(binding.createdAt);
    const updatedAt = Date.parse(binding.updatedAt);
    const label =
      binding.label ??
      binding.agentId ??
      binding.profileId ??
      binding.nativeThreadId;
    return [
      {
        threadId: binding.nativeThreadId,
        sessionId: binding.sessionId ?? `binding:${binding.bindingId}`,
        bindingId: binding.bindingId,
        crewSessionId: binding.sessionId ?? null,
        lineage: binding.lineage,
        nativeMaterialized: false,
        parentThreadId: null,
        preview: label,
        ephemeral: false,
        modelProvider: 'unavailable',
        effectiveModel: null,
        createdAt: Number.isFinite(createdAt) ? createdAt : 0,
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
        status:
          binding.status === 'archived' ? 'archived' : 'transport_unavailable',
        cwd: binding.cwd ?? '',
        cliVersion: runtime.observedCliVersion ?? '',
        name: binding.label ?? binding.agentId ?? binding.profileId ?? null,
        agentNickname: binding.agentId ?? null,
        agentRole: binding.profileId ?? null,
        turns: [],
      },
    ];
  });
}

function mergeBindings(
  preferred: readonly ExternalAgentBinding[],
  additional: readonly ExternalAgentBinding[],
): ExternalAgentBinding[] {
  const seen = new Set(preferred.map((binding) => binding.bindingId));
  return [
    ...preferred,
    ...additional.filter((binding) => !seen.has(binding.bindingId)),
  ];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertCoordinatedArchiveReceipt(
  session: ExternalAgentSession,
  receipt: ExternalThreadLifecycleReceipt,
): void {
  if (receipt.runtimeId !== session.runtime.runtimeId) {
    throw new Error(
      `Crew returned an archive receipt for runtime ${receipt.runtimeId}, but runtime ${session.runtime.runtimeId} was requested. The requested session remains visible for recovery.`,
    );
  }
  if (receipt.threadId !== session.thread.threadId) {
    throw new Error(
      `Crew returned an archive receipt for native thread ${receipt.threadId}, but thread ${session.thread.threadId} was requested. The requested session remains visible for recovery.`,
    );
  }
  if (!receipt.nativeArchived) {
    throw new Error(
      'Crew returned archive success while the native thread remained active.',
    );
  }
  const binding = session.binding;
  if (binding === undefined) return;
  const bindingTransition = receipt.bindings.find(
    (transition) => transition.bindingId === binding.bindingId,
  );
  if (bindingTransition?.currentStatus !== 'archived') {
    throw new Error(
      `Crew returned archive success without an archived transition for binding ${binding.bindingId}.`,
    );
  }
  if (binding.sessionId == null) return;
  const sessionTransition = receipt.crewSessions.find(
    (transition) => transition.sessionId === binding.sessionId,
  );
  if (sessionTransition?.currentStatus !== 'archived') {
    throw new Error(
      `Crew returned archive success without an archived transition for Crew session ${binding.sessionId}.`,
    );
  }
}

function coordinatedArchiveNotice(
  session: ExternalAgentSession,
  receipt: ExternalThreadLifecycleReceipt,
): string {
  const bindingCount = receipt.bindings.filter(
    (transition) => transition.currentStatus === 'archived',
  ).length;
  const sessionCount = receipt.crewSessions.filter(
    (transition) => transition.currentStatus === 'archived',
  ).length;
  if (session.binding === undefined) {
    return `Archived native Codex thread ${receipt.threadId} (${receipt.outcome}); it had no Crew binding to reconcile.`;
  }
  return `Archived native Codex thread ${receipt.threadId}, ${bindingCount} Crew binding${bindingCount === 1 ? '' : 's'}, and ${sessionCount} exact Crew session${sessionCount === 1 ? '' : 's'} (${receipt.outcome}).`;
}

function lifecycleErrorMessage(error: unknown): string {
  if (!(error instanceof ChatTransportError)) return errorMessage(error);
  const reason = error.apiError?.reason_code;
  if (reason === 'external_thread_active') {
    return 'Crew reports an authoritative active turn. Cancel it or wait for it to finish, then retry.';
  }
  if (reason === 'external_thread_interaction_pending') {
    return 'Crew reports a pending interaction. Resolve it, then retry.';
  }
  if (isPartialLifecycleFailure(error)) {
    return `${error.message}${reason === undefined ? '' : ` (${reason})`}`;
  }
  return errorMessage(error);
}

function isPartialLifecycleFailure(error: unknown): boolean {
  if (!(error instanceof ChatTransportError)) return false;
  const reason = error.apiError?.reason_code;
  return (
    reason === 'external_thread_binding_reconciliation_failed' ||
    reason === 'external_thread_crew_session_reconciliation_failed' ||
    reason === 'external_command_restart_failed'
  );
}

function newSessionRecoveryMessage(
  message: string,
  reasonCode?: string | null,
): string {
  if (reasonCode === 'external_command_restart_failed') {
    return `New session only partially completed: ${message} Crew preserved the predecessor and any successor identity. Use Reconcile new session; the retry cannot create a duplicate successor.`;
  }
  if (reasonCode === 'external_command_turn_active') {
    return 'New session is unavailable because Crew reports an authoritative active turn. Cancel it or wait for it to finish, then retry.';
  }
  return `New session failed${reasonCode == null ? '' : ` (${reasonCode})`}: ${message}`;
}

function isProfileRefreshCommand(input: string): boolean {
  const command = input.trim().split(/\s+/, 1)[0]?.toLowerCase();
  return command === '/refresh-profile' || command === '/profile-refresh';
}

function profileRefreshErrorMessage(error: unknown): string {
  if (!(error instanceof ChatTransportError)) return errorMessage(error);
  const reason = error.apiError?.reason_code;
  if (reason === 'external_binding_profile_refresh_thread_busy') {
    return 'the Codex thread still has active work. Wait for it to settle, then run /refresh-profile again.';
  }
  if (
    reason === 'external_binding_profile_refresh_revision_conflict' ||
    reason === 'external_binding_profile_refresh_identity_conflict' ||
    reason === 'external_binding_profile_refresh_profile_revision_conflict'
  ) {
    return 'the binding or profile changed while the command was prepared. Refresh Agents, verify the selected session, and run /refresh-profile again.';
  }
  return errorMessage(error);
}

function exactBindingRestoreWrite(
  binding: ExternalAgentBinding,
): ExternalBindingRestoreWrite | undefined {
  if (
    binding.sessionId == null ||
    binding.agentId == null ||
    binding.profileId == null ||
    binding.nativeThreadId == null
  ) {
    return undefined;
  }
  return {
    expectedBindingRevision: binding.revision,
    expectedSessionId: binding.sessionId,
    expectedAgentId: binding.agentId,
    expectedProfileId: binding.profileId,
    expectedNativeThreadId: binding.nativeThreadId,
  };
}

function bindingRestoreFailureMessage(error: unknown): string {
  if (!(error instanceof ChatTransportError)) {
    return `Crew session restore failed: ${errorMessage(error)}`;
  }
  const reason = error.apiError?.reason_code;
  if (reason === 'external_binding_restore_prompt_conflict') {
    return 'Crew session restore is blocked because the profile prompt changed. Keep this preserved history and use the existing refresh/fork workflow.';
  }
  if (error.statusCode === 409) {
    return `Crew session restore conflicted with newer state${reason === undefined ? '' : ` (${reason})`}. The latest binding data was loaded; review the exact identities and confirm Restore Crew session again.`;
  }
  const retryable = error.apiError?.retryable === true;
  return `Crew session restore failed${reason === undefined ? '' : ` (${reason})`}: ${error.message}${retryable ? ' The backend marked this failure retryable.' : ''}`;
}

class ExternalPromptSubmissionError extends Error {
  constructor(readonly detail: ExternalPromptFailureDetail) {
    super(detail.message);
    this.name = 'ExternalPromptSubmissionError';
  }
}

function deliveryReceiptFailure(
  bindingId: string,
  receipt: SendExternalBindingMessageResponse['data'],
): ExternalPromptFailureDetail | undefined {
  if (receipt.status === 'accepted' || receipt.status === 'pending') {
    return undefined;
  }
  const reasonCode =
    receipt.reasonCode ?? `external_delivery_${receipt.status}`;
  return {
    operation: 'binding_message',
    endpoint: externalBindingOperationPath(bindingId, 'messages'),
    message:
      receipt.status === 'expired'
        ? 'Delivery expired before Crew accepted it.'
        : 'Delivery was rejected by Crew.',
    reasonCode,
    retryable: true,
  };
}

function controlReceiptFailure(
  bindingId: string,
  receipt: ExternalControlReceipt,
): ExternalPromptFailureDetail | undefined {
  if (receipt.status === 'applied' || receipt.status === 'pending') {
    return undefined;
  }
  return {
    operation: 'steer_turn',
    endpoint: externalBindingOperationPath(bindingId, 'controls'),
    message:
      receipt.status === 'rejected'
        ? 'Steer request was rejected by Crew.'
        : 'Steer request failed in Crew.',
    reasonCode: receipt.reasonCode ?? `external_steer_${receipt.status}`,
    retryable: true,
  };
}

function promptFailureDetail(
  error: unknown,
  operation: ExternalPromptFailureDetail['operation'],
  bindingId: string,
): ExternalPromptFailureDetail {
  const detail = storeErrorDetail(error);
  const endpoint =
    detail.endpoint ??
    externalBindingOperationPath(
      bindingId,
      operation === 'steer_turn' ? 'controls' : 'messages',
    );
  return {
    operation,
    endpoint,
    message: detail.message,
    ...(detail.apiError?.reasonCode === undefined
      ? {}
      : { reasonCode: detail.apiError.reasonCode }),
    ...(detail.statusCode === undefined
      ? {}
      : { statusCode: detail.statusCode }),
    retryable: detail.retryable,
    ...(detail.transportCode === undefined
      ? {}
      : { transportCode: detail.transportCode }),
  };
}

function promptFailureMessage(detail: ExternalPromptFailureDetail): string {
  return storeErrorDetailMessage({
    source: 'error',
    message: detail.message,
    retryable: detail.retryable,
    ...(detail.reasonCode === undefined
      ? {}
      : {
          apiError: {
            code: 'external_prompt_submission_failed',
            reasonCode: detail.reasonCode,
            message: detail.message,
          },
        }),
  });
}

function externalBindingOperationPath(
  bindingId: string,
  operation: 'messages' | 'controls',
): string {
  return `/v1/external-bindings/${encodeURIComponent(bindingId)}/${operation}`;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

export function latestExternalTurnPhase(
  events: readonly NormalizedExternalRuntimeEvent[],
  runtimeId?: string,
  threadId?: string,
): ExternalTurnPhase | undefined {
  let latest:
    | { readonly sequenceId: number; readonly phase: ExternalTurnPhase }
    | undefined;
  for (const event of events) {
    if (
      event.kind !== 'turn_lifecycle' ||
      (runtimeId !== undefined && event.runtimeId !== runtimeId) ||
      (threadId !== undefined && event.nativeThreadId !== threadId)
    ) {
      continue;
    }
    const phase = eventPhase(event);
    if (
      phase !== undefined &&
      (latest === undefined || event.sequenceId > latest.sequenceId)
    ) {
      latest = { sequenceId: event.sequenceId, phase };
    }
  }
  return latest?.phase;
}

function reconciledExternalTurnPhase(
  events: readonly NormalizedExternalRuntimeEvent[],
  thread: ExternalThreadProjection | undefined,
): ExternalTurnPhase | undefined {
  const eventState = latestExternalTurnState(events);
  if (eventState === undefined) return latestSnapshotTurnPhase(thread);
  if (isTerminalPhase(eventState.phase)) return eventState.phase;
  if (eventState.retrying) return eventState.phase;
  const matchingSnapshot = thread?.turns.find(
    (turn) => turn.turnId === eventState.turnId,
  );
  const snapshotPhase = snapshotTurnPhase(matchingSnapshot);
  if (snapshotPhase !== undefined && isTerminalPhase(snapshotPhase)) {
    return latestSnapshotTurnPhase(thread) ?? snapshotPhase;
  }
  return eventState.phase;
}

function latestExternalTurnState(
  events: readonly NormalizedExternalRuntimeEvent[],
):
  | {
      readonly turnId: string | undefined;
      readonly sequenceId: number;
      readonly phase: ExternalTurnPhase;
      readonly retrying: boolean;
    }
  | undefined {
  let latest:
    | {
        readonly turnId: string | undefined;
        readonly sequenceId: number;
        readonly phase: ExternalTurnPhase;
        readonly retrying: boolean;
      }
    | undefined;
  for (const event of events) {
    if (event.kind !== 'turn_lifecycle') continue;
    const phase = eventPhase(event);
    if (
      phase !== undefined &&
      (latest === undefined || event.sequenceId > latest.sequenceId)
    ) {
      latest = {
        turnId: event.nativeTurnId ?? undefined,
        sequenceId: event.sequenceId,
        phase,
        retrying: isRetryingEvent(event),
      };
    }
  }
  return latest;
}

function reconciledActiveExternalTurnId(
  events: readonly NormalizedExternalRuntimeEvent[],
  thread: ExternalThreadProjection | undefined,
): string | undefined {
  const eventState = latestActiveExternalTurnState(events);
  if (eventState !== undefined) {
    if (eventState.retrying) return eventState.turnId;
    const snapshotPhase = snapshotTurnPhase(
      thread?.turns.find((turn) => turn.turnId === eventState.turnId),
    );
    if (snapshotPhase === undefined || !isTerminalPhase(snapshotPhase)) {
      return eventState.turnId;
    }
  }
  return activeSnapshotTurnId(thread);
}

export function activeExternalTurnId(
  events: readonly NormalizedExternalRuntimeEvent[],
): string | undefined {
  return latestActiveExternalTurnState(events)?.turnId;
}

function latestActiveExternalTurnState(
  events: readonly NormalizedExternalRuntimeEvent[],
):
  | {
      readonly turnId: string;
      readonly sequenceId: number;
      readonly phase: ExternalTurnPhase;
      readonly retrying: boolean;
    }
  | undefined {
  const latestByTurn = new Map<
    string,
    {
      readonly turnId: string;
      readonly sequenceId: number;
      readonly phase: ExternalTurnPhase;
      readonly retrying: boolean;
    }
  >();
  for (const event of events) {
    if (event.kind !== 'turn_lifecycle' || event.nativeTurnId == null) continue;
    const phase = eventPhase(event);
    if (phase === undefined) continue;
    const previous = latestByTurn.get(event.nativeTurnId);
    if (previous === undefined || event.sequenceId > previous.sequenceId) {
      latestByTurn.set(event.nativeTurnId, {
        turnId: event.nativeTurnId,
        sequenceId: event.sequenceId,
        phase,
        retrying: isRetryingEvent(event),
      });
    }
  }
  return [...latestByTurn.values()]
    .filter((value) => !isTerminalPhase(value.phase))
    .sort((left, right) => right.sequenceId - left.sequenceId)[0];
}

function latestSnapshotTurnPhase(
  thread: ExternalThreadProjection | undefined,
): ExternalTurnPhase | undefined {
  const latest = thread?.turns.at(-1);
  return snapshotTurnPhase(latest);
}

function activeSnapshotTurnId(
  thread: ExternalThreadProjection | undefined,
): string | undefined {
  const latest = thread?.turns.at(-1);
  if (latest === undefined) return undefined;
  const phase = snapshotTurnPhase(latest);
  return phase !== undefined && !isTerminalPhase(phase)
    ? latest.turnId
    : undefined;
}

function eventPhase(
  event: NormalizedExternalRuntimeEvent,
): ExternalTurnPhase | undefined {
  const phase = phaseValue(event.payload.status);
  return phase !== undefined && isTerminalPhase(phase) && isRetryingEvent(event)
    ? 'active'
    : phase;
}

function isRetryingEvent(event: NormalizedExternalRuntimeEvent): boolean {
  return event.payload.error?.willRetry === true;
}

function snapshotTurnPhase(
  turn: ExternalThreadProjection['turns'][number] | undefined,
): ExternalTurnPhase | undefined {
  const phase = phaseValue(turn?.status);
  return phase !== undefined &&
    isTerminalPhase(phase) &&
    turn?.error?.willRetry === true
    ? 'active'
    : phase;
}

function isTerminalPhase(phase: ExternalTurnPhase): boolean {
  return (
    phase === 'completed' ||
    phase === 'failed' ||
    phase === 'interrupted' ||
    phase === 'outcome_unknown'
  );
}

function phaseValue(value: string | undefined): ExternalTurnPhase | undefined {
  switch (value) {
    case 'accepted':
    case 'starting':
    case 'active':
    case 'waiting_interaction':
    case 'completed':
    case 'failed':
    case 'interrupted':
    case 'outcome_unknown':
      return value;
    case 'inProgress':
      return 'active';
    case 'notStarted':
      return 'accepted';
    default:
      return undefined;
  }
}
