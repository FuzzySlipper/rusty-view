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

export interface ExternalAgentSession {
  readonly key: string;
  readonly runtime: ExternalRuntimeRegistration;
  readonly controller?: ExternalRuntimeControllerStatus;
  readonly thread: ExternalThreadProjection;
  readonly binding?: ExternalAgentBinding;
  readonly phase?: ExternalTurnPhase;
  readonly unread: boolean;
  readonly needsAttention: boolean;
}

export interface ExternalAgentProfileOption {
  readonly profileId: string;
  readonly displayName?: string;
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

const EXTERNAL_TRANSCRIPT_CACHE_CAPACITY = 8;
const EXTERNAL_TRANSCRIPT_CACHE_WEIGHT = 60_000;
const EXTERNAL_EVENT_PAGE_SIZE = 1_000;
// A stable search needs at most 53 exponential probes plus 53 binary probes
// across JavaScript's safe-integer sequence domain. The remaining probes let
// us absorb concurrent growth without allowing selection to wait forever.
const EXTERNAL_EVENT_CURSOR_PROBE_LIMIT = 128;

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
  readonly pending = signal(false);
  readonly loadingMore = signal(false);
  readonly creatingSession = signal(false);
  readonly creationError = signal<string | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly archivedInventory = signal(false);
  readonly inventoryMode = signal<ExternalAgentInventoryMode>('managed');
  readonly lifecyclePendingThreadIds = signal<ReadonlySet<string>>(new Set());
  readonly lifecycleNotice = signal<string | undefined>(undefined);
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
      const binding = bindings.find(
        (item) =>
          item.runtimeId === runtime.runtimeId &&
          item.nativeThreadId === thread.threadId,
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
        (unread && (phase === 'completed' || phase === 'interrupted'));
      return [
        {
          key,
          runtime,
          thread,
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
          const [listed, eventBootstrap] = await Promise.all([
            this.transport.external.listThreads(runtime.runtimeId, {
              limit: 100,
              archived: archivedInventory,
            }),
            this.loadFleetEventBootstrap(runtime.runtimeId),
          ]);
          const events = eventBootstrap.events;
          const nextFleetCursor = eventBootstrap.cursor;
          if (nextFleetCursor !== undefined) {
            nextFleetCursors.set(runtime.runtimeId, nextFleetCursor);
          }
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
            : refreshedBindings
                .filter(
                  (binding) =>
                    binding.runtimeId === runtime.runtimeId &&
                    binding.status === 'active' &&
                    binding.nativeThreadId != null &&
                    !known.has(binding.nativeThreadId) &&
                    !failedResumeBindingIds.has(binding.bindingId),
                )
                .map((binding) => binding.nativeThreadId)
                .filter((threadId): threadId is string => threadId != null);
          const recoveredReads = await Promise.allSettled(
            [...new Set(missingBoundIds)].map(async (threadId) =>
              this.transport.external.readThread(runtime.runtimeId, {
                threadId,
                includeTurns: false,
              }),
            ),
          );
          const recovered = recoveredReads.flatMap((result) =>
            result.status === 'fulfilled' ? [result.value.thread] : [],
          );
          return {
            runtimeId: runtime.runtimeId,
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
          return mergeThreads(
            item.threads.map((entry) => entry.thread),
            currentThreads,
          ).map((thread) => ({ runtimeId, thread }));
        }),
      );
      const knownFleetEventIds = new Set(
        previousFleetEvents.map((event) => event.eventId),
      );
      this.fleetEvents.set([
        ...previousFleetEvents.filter((event) =>
          activeRuntimeIds.has(event.runtimeId),
        ),
        ...runtimeData
          .flatMap((item) => item.events)
          .filter(
            (event) =>
              !knownFleetEventIds.has(event.eventId) &&
              event.kind === 'turn_lifecycle' &&
              phaseValue(event.payload.status) !== undefined,
          ),
      ]);
      await this.refreshSelectedEvents();
      this.error.set(undefined);
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
        !active && cached?.updatedAt === session.thread.updatedAt;
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

      const replayHistory = cached === undefined && fleetCursor === undefined;
      const [read, page] = await Promise.all([
        this.transport.external.readThread(runtimeId, {
          threadId: session.thread.threadId,
          includeTurns: true,
        }),
        replayHistory ? this.listAllEvents(runtimeId) : Promise.resolve([]),
      ]);
      if (!this.isCurrentSelection(revision, session.key)) return false;
      this.selectedThread.set(read.thread);
      if (cached === undefined) {
        const events = page.filter(
          (event) => event.nativeThreadId === session.thread.threadId,
        );
        this.selectedRuntimeEventCursor =
          page.at(-1)?.sequenceId ?? fleetCursor;
        this.events.set(events);
        this.eventHistoryLoaded.set(replayHistory);
      }
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
        this.error.set(error instanceof Error ? error.message : String(error));
      }
      return false;
    } finally {
      if (this.isCurrentSelection(revision, session.key)) {
        this.loading.set(false);
      }
    }
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
      const page = await this.listAllEvents(runtimeId);
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

  private async applyThreadReplacement(
    binding: ExternalAgentBinding,
    replacement: ExternalRuntimeThreadReplacementResult,
  ): Promise<void> {
    if (replacement.bindingId !== binding.bindingId) {
      throw new Error(
        `Crew returned replacement binding ${replacement.bindingId} for command binding ${binding.bindingId}`,
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
      includeTurns: true,
    });
    const sessionId = replacement.sessionId ?? binding.sessionId;
    const nextBinding: ExternalAgentBinding = {
      ...binding,
      nativeThreadId: replacement.nativeThreadId,
      ...(sessionId === undefined ? {} : { sessionId }),
      profileId: replacement.profileId,
      cwd: replacement.cwd,
      label: replacement.label,
      taskRef: replacement.taskRef,
      revision: replacement.bindingRevision,
    };

    this.bindingMutationRevision += 1;
    this.bindings.update((bindings) => [
      ...bindings.filter(
        (candidate) => candidate.bindingId !== nextBinding.bindingId,
      ),
      nextBinding,
    ]);
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
    const binding = this.selectedBinding();
    if (binding === undefined) {
      this.error.set(
        'Send failed: selected external thread has no Crew binding.',
      );
      return;
    }
    const optimisticId = this.addOptimisticUserMessage(text);
    const mode = this.composerMode();
    const operation: ExternalPromptFailureDetail['operation'] =
      mode === 'steer' ? 'steer_turn' : 'binding_message';
    this.pending.set(true);
    try {
      this.error.set(undefined);
      if (mode === 'steer') {
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
      }),
      this.refreshSelectedEvents(),
    ]);
    if (!this.isCurrentSelection(revision, key)) return;
    this.selectedThread.set(read.thread);
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
      const receipt =
        action === 'archive'
          ? await this.transport.external.archiveThread(runtimeId, threadId)
          : action === 'unarchive'
            ? await this.transport.external.unarchiveThread(runtimeId, threadId)
            : await this.transport.external.deleteThread(runtimeId, threadId);
      if (this.selectedSessionKey() === session.key) this.clearSelection();
      this.transcriptCache.delete(session.key);
      this.lifecycleNotice.set(
        `${action === 'unarchive' ? 'Restored' : action === 'archive' ? 'Archived' : 'Deleted'} native Codex thread ${threadId} (${receipt.outcome}).`,
      );
      this.runtimeThreads.update((threads) =>
        threads.filter(
          (entry) =>
            entry.runtimeId !== runtimeId || entry.thread.threadId !== threadId,
        ),
      );
      await this.refresh();
      return true;
    } catch (error) {
      this.error.set(`${capitalize(action)} failed: ${errorMessage(error)}`);
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
  ): Promise<NormalizedExternalRuntimeEvent[]> {
    const events: NormalizedExternalRuntimeEvent[] = [];
    let after = initialAfter;
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const page = await this.transport.external.listEvents(runtimeId, {
        limit: 1_000,
        ...(after === undefined ? {} : { after }),
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
   * larger, so discover its real high-water sequence with bounded one-event
   * probes. This avoids stranding the selected SSE stream behind the former
   * 100-page replay ceiling once a long-lived runtime exceeds 100k events.
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

    return {
      events: [],
      cursor: await this.findExternalEventHighWater(runtimeId, firstCursor),
    };
  }

  private async findExternalEventHighWater(
    runtimeId: string,
    knownSequence: number,
  ): Promise<number> {
    let lower = knownSequence;
    let upper: number | undefined;
    let stride = 1;

    // Every probe advances `lower`, lowers `upper`, or invalidates a stale
    // bracket after observing an event that arrived during the search. A
    // stable event set converges within 106 probes across the full safe-integer
    // domain. If concurrent growth keeps invalidating brackets, stop at the
    // explicit request budget and resume SSE from the highest observed cursor.
    for (
      let probe = 0;
      probe < EXTERNAL_EVENT_CURSOR_PROBE_LIMIT &&
      lower < Number.MAX_SAFE_INTEGER;
      probe++
    ) {
      const target =
        upper === undefined
          ? Math.min(Number.MAX_SAFE_INTEGER, lower + stride)
          : lower + Math.ceil((upper - lower) / 2);
      if (target <= lower) return lower;

      const page = await this.transport.external.listEvents(runtimeId, {
        after: target - 1,
        limit: 1,
      });
      const next = page.events.find(
        (event) => event.sequenceId >= target,
      )?.sequenceId;
      if (next !== undefined) {
        lower = Math.max(lower, next);
        if (upper !== undefined && lower > upper) {
          // Events can arrive while the probes run. The observed sequence is a
          // safe resume cursor; continue expanding from it for the remaining
          // bounded probes instead of trusting the now-stale upper bound.
          upper = undefined;
          stride = 1;
        } else if (upper === undefined) {
          stride = Math.min(Number.MAX_SAFE_INTEGER - lower, stride * 2);
        }
        continue;
      }

      upper = target - 1;
      if (upper <= lower) return lower;
    }

    return lower;
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
