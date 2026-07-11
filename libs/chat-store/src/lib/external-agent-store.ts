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
  type ExternalRuntimeEventStream,
} from '@rusty-view/transport';

export type ExternalComposerMode = 'auto' | 'steer' | 'queue';

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
  private readonly fleetCursors = new Map<string, number>();
  private readonly seen = signal<Readonly<Record<string, number>>>({});

  readonly runtimes = signal<readonly ExternalRuntimeRegistration[]>([]);
  readonly controllers = signal<readonly ExternalRuntimeControllerStatus[]>([]);
  readonly bindings = signal<readonly ExternalAgentBinding[]>([]);
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
  readonly selectedThread = signal<ExternalThreadProjection | undefined>(
    undefined,
  );
  readonly loading = signal(false);
  readonly pending = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly rawDetail = signal<ExternalRuntimeRawDetail | undefined>(undefined);
  readonly composerMode = signal<ExternalComposerMode>('auto');

  readonly sessions = computed<readonly ExternalAgentSession[]>(() => {
    const controllers = new Map(
      this.controllers().map((item) => [item.runtimeId, item]),
    );
    const bindings = this.bindings();
    const interactions = this.interactions();
    const events = this.fleetEvents();
    const selected = this.selectedThreadId();
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
      const key = `${runtime.runtimeId}:${thread.threadId}`;
      const phase = latestExternalTurnPhase(
        events,
        runtime.runtimeId,
        thread.threadId,
      );
      const unread =
        selected !== thread.threadId && (seen[key] ?? 0) < thread.updatedAt;
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
    const timer = setInterval(() => void this.refresh(), 3_000);
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
      for (const runtimeId of this.fleetCursors.keys()) {
        if (!activeRuntimeIds.has(runtimeId))
          this.fleetCursors.delete(runtimeId);
      }
      const runtimeData = await Promise.all(
        fleet.runtimes.map(async (runtime) => {
          const [listed, events] = await Promise.all([
            this.listAllThreads(runtime.runtimeId),
            this.listAllEvents(
              runtime.runtimeId,
              this.fleetCursors.get(runtime.runtimeId),
            ),
          ]);
          const lastSequence = events.at(-1)?.sequenceId;
          if (lastSequence !== undefined)
            this.fleetCursors.set(runtime.runtimeId, lastSequence);
          const known = new Set(listed.map((thread) => thread.threadId));
          const missingBoundIds = bindingFleet.bindings
            .filter(
              (binding) =>
                binding.runtimeId === runtime.runtimeId &&
                binding.nativeThreadId != null &&
                !known.has(binding.nativeThreadId),
            )
            .map((binding) => binding.nativeThreadId)
            .filter((threadId): threadId is string => threadId != null);
          const recovered = await Promise.all(
            missingBoundIds.map(
              async (threadId) =>
                (
                  await this.transport.external.readThread(runtime.runtimeId, {
                    threadId,
                    includeTurns: false,
                  })
                ).thread,
            ),
          );
          return {
            events,
            threads: [...listed, ...recovered].map((thread) => ({
              runtimeId: runtime.runtimeId,
              thread,
            })),
          };
        }),
      );
      this.runtimeThreads.set(runtimeData.flatMap((item) => item.threads));
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

  async selectSession(session: ExternalAgentSession): Promise<void> {
    this.stream?.close();
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
      this.events.set(events);
      this.startStream(session.runtime.runtimeId, events.at(-1)?.sequenceId);
      this.error.set(undefined);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
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
  }

  async send(text: string): Promise<void> {
    const binding = this.selectedBinding();
    if (binding === undefined)
      throw new Error('Selected external thread has no Crew binding');
    this.pending.set(true);
    try {
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
        };
        await this.transport.external.sendMessage(binding.bindingId, request);
      }
      await this.refreshSelectedEvents();
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
      await this.transport.external.submitControl(binding.bindingId, {
        kind: 'interrupt_turn',
        expectedNativeTurnId: turnId,
        payload: { threadId: binding.nativeThreadId, turnId },
      });
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
      await this.transport.external.rawDetail(
        event.runtimeId,
        event.rawDetailRef,
      ),
    );
  }

  private startStream(runtimeId: string, cursor?: number): void {
    this.stream = this.transport.streamExternalRuntimeEvents(runtimeId, cursor);
    const stream = this.stream;
    void (async () => {
      try {
        for await (const event of stream.events()) {
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
    const after = this.events().at(-1)?.sequenceId;
    const page = await this.transport.external.listEvents(runtimeId, {
      ...(after === undefined ? {} : { after }),
      limit: 1_000,
    });
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

  private async listAllThreads(
    runtimeId: string,
  ): Promise<ExternalThreadProjection[]> {
    const threads: ExternalThreadProjection[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const page = await this.transport.external.listThreads(runtimeId, {
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      });
      threads.push(...page.items);
      if (page.nextCursor == null || page.nextCursor === cursor) break;
      cursor = page.nextCursor;
    }
    return threads;
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
