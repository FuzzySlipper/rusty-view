import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { projectExternalAgentTranscript } from '@rusty-view/chat-domain';
import type {
  ExternalAgentBinding,
  ExternalAgentSessionCreateResult,
  ExternalAgentSessionCreateWrite,
  ExternalBindingMessageWrite,
  ExternalControlWrite,
  ExternalInteractionRecord,
  ExternalInteractionResolutionWrite,
  ExternalRuntimeControllerStatus,
  ExternalRuntimeRegistration,
  ExternalRuntimeRawDetail,
  ExternalThreadProjection,
  ExternalTurnPhase,
  NormalizedExternalRuntimeEvent,
} from '@rusty-view/protocol';
import {
  ChatTransport,
  type AdminProfileRegistryRecord,
  type ExternalRuntimeEventStream,
} from '@rusty-view/transport';

export type ExternalComposerMode = 'auto' | 'steer' | 'queue' | 'plan';

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

@Injectable({ providedIn: 'root' })
export class ExternalAgentStore {
  private readonly transport = inject(ChatTransport);
  private readonly destroyRef = inject(DestroyRef);
  private stream: ExternalRuntimeEventStream | undefined;
  private polling = false;
  private interactionsPolling = false;
  private selectedRuntimeEventCursor: number | undefined;
  private readonly fleetCursors = new Map<string, number>();
  private readonly threadCursors = signal<
    Readonly<Record<string, string | null>>
  >({});
  private readonly seen = signal<Readonly<Record<string, number>>>({});

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
  readonly pending = signal(false);
  readonly loadingMore = signal(false);
  readonly creatingSession = signal(false);
  readonly creationError = signal<string | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly rawDetail = signal<ExternalRuntimeRawDetail | undefined>(undefined);
  readonly composerMode = signal<ExternalComposerMode>('auto');

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

  readonly messages = computed(() =>
    projectExternalAgentTranscript(this.selectedThread(), this.events()),
  );

  readonly turnPhase = computed<ExternalTurnPhase | undefined>(() => {
    if (this.selectedInteractions().some((item) => item.status === 'pending')) {
      return 'waiting_interaction';
    }
    return latestExternalTurnPhase(this.events());
  });

  readonly activeTurnId = computed(() => activeExternalTurnId(this.events()));

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
    if (this.polling) return;
    this.polling = true;
    this.loading.set(this.runtimes().length === 0);
    try {
      const [fleet, bindingFleet, attention] = await Promise.all([
        this.transport.external.listRuntimes(),
        this.transport.external.listBindings(),
        this.transport.external.listInteractions(),
      ]);
      this.runtimes.set(fleet.runtimes);
      this.controllers.set(fleet.controllers);
      this.bindings.set(bindingFleet.bindings);
      this.interactions.set(attention.interactions);
      const previousFleetEvents = this.fleetEvents();
      const activeRuntimeIds = new Set(
        fleet.runtimes.map((runtime) => runtime.runtimeId),
      );
      const previousThreadCursors = this.threadCursors();
      const nextThreadCursors: Record<string, string | null> = {};
      for (const runtimeId of this.fleetCursors.keys()) {
        if (!activeRuntimeIds.has(runtimeId))
          this.fleetCursors.delete(runtimeId);
      }
      const runtimeData = await Promise.all(
        fleet.runtimes.map(async (runtime) => {
          const existing = this.runtimeThreads()
            .filter((item) => item.runtimeId === runtime.runtimeId)
            .map((item) => item.thread);
          const [listed, events] = await Promise.all([
            this.transport.external.listThreads(runtime.runtimeId, {
              limit: 100,
            }),
            this.listAllEvents(
              runtime.runtimeId,
              this.fleetCursors.get(runtime.runtimeId),
            ),
          ]);
          const lastSequence = events.at(-1)?.sequenceId;
          if (lastSequence !== undefined)
            this.fleetCursors.set(runtime.runtimeId, lastSequence);
          const knownThreads = mergeThreads(listed.items, existing);
          nextThreadCursors[runtime.runtimeId] = Object.hasOwn(
            previousThreadCursors,
            runtime.runtimeId,
          )
            ? (previousThreadCursors[runtime.runtimeId] ?? null)
            : listed.nextCursor;
          const known = new Set(knownThreads.map((thread) => thread.threadId));
          const missingBoundIds = bindingFleet.bindings
            .filter(
              (binding) =>
                binding.runtimeId === runtime.runtimeId &&
                binding.nativeThreadId != null &&
                !known.has(binding.nativeThreadId),
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
    }
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
    this.stream?.close();
    const runtimeId = result.runtime.runtimeId;
    const threadId = result.thread.threadId;
    this.selectedRuntimeEventCursor = this.fleetCursors.get(runtimeId);
    this.events.set([]);
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
    this.stream?.close();
    this.selectedRuntimeEventCursor = undefined;
    this.events.set([]);
    this.selectedThread.set(undefined);
    this.selectedRuntimeId.set(session.runtime.runtimeId);
    this.selectedThreadId.set(session.thread.threadId);
    this.seen.update((seen) => ({
      ...seen,
      [session.key]: session.thread.updatedAt,
    }));
    this.loading.set(true);
    try {
      const [read, page] = await Promise.all([
        this.transport.external.readThread(session.runtime.runtimeId, {
          threadId: session.thread.threadId,
          includeTurns: true,
        }),
        this.listAllEvents(session.runtime.runtimeId),
      ]);
      this.selectedThread.set(read.thread);
      const events = page.filter(
        (event) => event.nativeThreadId === session.thread.threadId,
      );
      this.selectedRuntimeEventCursor = page.at(-1)?.sequenceId;
      this.events.set(events);
      this.startStream(
        session.runtime.runtimeId,
        this.selectedRuntimeEventCursor,
      );
      this.error.set(undefined);
      return true;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      this.loading.set(false);
    }
  }

  clearSelection(): void {
    this.stream?.close();
    this.stream = undefined;
    this.selectedRuntimeId.set(undefined);
    this.selectedThreadId.set(undefined);
    this.selectedThread.set(undefined);
    this.events.set([]);
    this.selectedRuntimeEventCursor = undefined;
  }

  async send(text: string): Promise<void> {
    const binding = this.selectedBinding();
    if (binding === undefined) {
      this.error.set(
        'Send failed: selected external thread has no Crew binding.',
      );
      return;
    }
    this.pending.set(true);
    try {
      this.error.set(undefined);
      const mode = this.composerMode();
      const activeTurnId = this.activeTurnId();
      if (mode === 'steer' || (mode === 'auto' && activeTurnId !== undefined)) {
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
        await this.transport.external.submitControl(binding.bindingId, request);
      } else {
        const request: ExternalBindingMessageWrite = {
          body: text,
          ttlMs: 60_000,
          ...(mode === 'plan' ? { collaborationMode: 'plan' } : {}),
        };
        await this.transport.external.sendMessage(binding.bindingId, request);
        if (mode === 'plan') this.composerMode.set('auto');
      }
      await this.refreshSelectedEvents();
    } catch (error) {
      this.error.set(`Send failed: ${errorMessage(error)}`);
    } finally {
      this.pending.set(false);
    }
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
      idempotencyKey: `rusty-view:${interaction.interactionId}:${crypto.randomUUID()}`,
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
    this.rawDetail.set(
      await this.readRawDetail(event.runtimeId, event.rawDetailRef),
    );
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
    this.loadingMore.set(true);
    try {
      const pages = await Promise.all(
        pending.map(async ([runtimeId, cursor]) => ({
          runtimeId,
          page: await this.transport.external.listThreads(runtimeId, {
            limit: 100,
            cursor,
          }),
        })),
      );
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
    if (runtimeId === undefined) return;
    const after = this.selectedRuntimeEventCursor;
    const page = await this.transport.external.listEvents(runtimeId, {
      ...(after === undefined ? {} : { after }),
      limit: 1_000,
    });
    const lastSequence = page.events.at(-1)?.sequenceId;
    if (lastSequence !== undefined) {
      this.selectedRuntimeEventCursor = Math.max(
        this.selectedRuntimeEventCursor ?? lastSequence,
        lastSequence,
      );
    }
    const selectedThreadId = this.selectedThreadId();
    this.appendEvents(
      page.events.filter((event) => event.nativeThreadId === selectedThreadId),
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
}

export function sessionKey(runtimeId: string, threadId: string): string {
  return `${runtimeId}:${threadId}`;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    const phase = phaseValue(event.payload.status);
    if (
      phase !== undefined &&
      (latest === undefined || event.sequenceId > latest.sequenceId)
    ) {
      latest = { sequenceId: event.sequenceId, phase };
    }
  }
  return latest?.phase;
}

export function activeExternalTurnId(
  events: readonly NormalizedExternalRuntimeEvent[],
): string | undefined {
  const latestByTurn = new Map<
    string,
    { readonly sequenceId: number; readonly phase: ExternalTurnPhase }
  >();
  for (const event of events) {
    if (event.kind !== 'turn_lifecycle' || event.nativeTurnId == null) continue;
    const phase = phaseValue(event.payload.status);
    if (phase === undefined) continue;
    const previous = latestByTurn.get(event.nativeTurnId);
    if (previous === undefined || event.sequenceId > previous.sequenceId) {
      latestByTurn.set(event.nativeTurnId, {
        sequenceId: event.sequenceId,
        phase,
      });
    }
  }
  return [...latestByTurn.entries()]
    .filter(([, value]) => !isTerminalPhase(value.phase))
    .sort((left, right) => right[1].sequenceId - left[1].sequenceId)[0]?.[0];
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
