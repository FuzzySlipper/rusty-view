import type {
  ExternalThreadProjection,
  NormalizedExternalRuntimeEvent,
} from '@rusty-view/protocol';
import type {
  ChatMessage,
  MessageBlock,
  MessageRole,
  ToolBlockStatus,
} from './domain-types';

/** Convert runtime-neutral external thread history and live events into transcript view models. */
export function projectExternalAgentTranscript(
  thread: ExternalThreadProjection | undefined,
  events: readonly NormalizedExternalRuntimeEvent[],
): readonly ChatMessage[] {
  const messages: ChatMessage[] = [];
  const snapshotCoverageByTurn = new Map<string, SnapshotTurnCoverage>();
  const terminalByTurn = terminalStatusesByTurn(events);
  if (thread !== undefined) {
    for (const turn of thread.turns) {
      const coverage: SnapshotTurnCoverage = {
        terminal: isTerminalStatus(turn.status),
        items: [],
      };
      snapshotCoverageByTurn.set(turn.turnId, coverage);
      for (const item of turn.items) {
        const messageIndex = messages.length;
        const status = item.status ?? turn.status;
        const content =
          item.text ?? item.summary?.join('\n') ?? item.status ?? item.kind;
        coverage.items.push({
          itemId: item.itemId,
          kind: item.kind,
          content,
          messageIndex,
        });
        messages.push(
          buildMessage(
            `external:${thread.threadId}:${turn.turnId}:${item.itemId}`,
            thread.sessionId,
            roleForItem(item.kind),
            unixDate(turn.startedAt ?? thread.updatedAt),
            [blockForItem(item.itemId, item.kind, content, status)],
            messageStatus(status),
            {
              nativeThreadId: thread.threadId,
              nativeTurnId: turn.turnId,
              itemId: item.itemId,
              ...(item.kind === 'agentMessage'
                ? { externalAgentText: true }
                : {}),
              ...(item.messagePhase === undefined
                ? {}
                : { messagePhase: item.messagePhase }),
            },
          ),
        );
      }
    }
  }
  const grouped = new Map<string, NormalizedExternalRuntimeEvent[]>();
  for (const event of events) {
    const key = eventGroupKey(event);
    const group = grouped.get(key);
    if (group === undefined) grouped.set(key, [event]);
    else group.push(event);
  }
  for (const [key, group] of grouped) {
    const first = group[0];
    if (first === undefined) continue;
    const status = terminalStatus(
      group,
      terminalByTurn.get(first.nativeTurnId ?? ''),
    );
    const reconciliation = reconcileSnapshotEventGroup(
      snapshotCoverageByTurn.get(first.nativeTurnId ?? ''),
      group,
    );
    if (reconciliation.covered) {
      if (reconciliation.item !== undefined) {
        applyMessagePhase(
          messages,
          reconciliation.item.messageIndex,
          reconciliation.messagePhase,
        );
      }
      if (
        reconciliation.item !== undefined &&
        reconciliation.uncoveredContent !== undefined
      ) {
        appendSnapshotContinuation(
          messages,
          reconciliation.item.messageIndex,
          reconciliation.uncoveredContent,
          status,
        );
      }
      continue;
    }
    // A terminal native thread snapshot is the canonical transcript for that
    // turn. App-server replay item ids are not guaranteed to match the compact
    // ids returned by thread/read, so trying to append every unmatched replay
    // group can put old reasoning/tool rows after the snapshot's final_answer.
    // The raw events remain available in the inspector; event augmentation is
    // still used for in-progress turns where the snapshot may be incomplete.
    if (snapshotCoverageByTurn.get(first.nativeTurnId ?? '')?.terminal) {
      continue;
    }
    const blocks = blocksForGroup(group, status);
    if (blocks.length === 0) continue;
    messages.push(
      buildMessage(
        `external-event:${key}`,
        first.sessionId ??
          `${first.runtimeId}:${first.nativeThreadId ?? 'runtime'}`,
        'assistant',
        first.createdAt,
        blocks,
        status,
        {
          runtimeId: first.runtimeId,
          nativeThreadId: first.nativeThreadId,
          nativeTurnId: first.nativeTurnId,
          ...(blocks.some((block) => block.kind === 'text')
            ? { externalAgentText: true }
            : {}),
          ...(messagePhaseForEvents(group) === undefined
            ? {}
            : { messagePhase: messagePhaseForEvents(group) }),
        },
      ),
    );
  }
  return messages;
}

interface SnapshotItemCoverage {
  readonly itemId: string;
  readonly kind: string;
  readonly content: string;
  readonly messageIndex: number;
}

interface SnapshotTurnCoverage {
  readonly terminal: boolean;
  readonly items: SnapshotItemCoverage[];
}

interface SnapshotEventReconciliation {
  readonly covered: boolean;
  readonly item?: SnapshotItemCoverage;
  readonly uncoveredContent?: string;
  readonly messagePhase?: 'commentary' | 'final_answer' | 'unknown';
}

function reconcileSnapshotEventGroup(
  snapshot: SnapshotTurnCoverage | undefined,
  events: readonly NormalizedExternalRuntimeEvent[],
): SnapshotEventReconciliation {
  if (snapshot === undefined) return { covered: false };
  const projected = snapshotProjectionForEvents(events);
  if (projected === undefined) return { covered: false };
  const itemId = events.find((event) => event.itemId != null)?.itemId;
  const sameItem = snapshot.items.find(
    (item) => item.itemId === itemId && item.kind === projected.kind,
  );
  if (sameItem !== undefined) {
    const messagePhase = messagePhaseForEvents(events);
    const snapshotContent = normalizeLineEndings(sameItem.content);
    const eventContent = normalizeLineEndings(projected.content);
    const normalizedEventContent = normalizeCoverageContent(eventContent);
    if (
      eventContent === '' ||
      (normalizedEventContent !== '' &&
        normalizeCoverageContent(snapshotContent).includes(
          normalizedEventContent,
        ))
    ) {
      return {
        covered: true,
        item: sameItem,
        ...(messagePhase === undefined ? {} : { messagePhase }),
      };
    }
    const overlap = suffixPrefixOverlap(snapshotContent, eventContent);
    return {
      covered: true,
      item: sameItem,
      uncoveredContent: eventContent.slice(overlap),
      ...(messagePhase === undefined ? {} : { messagePhase }),
    };
  }
  const eventContent = normalizeCoverageContent(projected.content);
  const semanticallyCovered = snapshot.items.find(
    (item) =>
      item.kind === projected.kind &&
      snapshot.terminal &&
      eventContent !== '' &&
      normalizeCoverageContent(item.content) === eventContent,
  );
  const messagePhase = messagePhaseForEvents(events);
  return {
    covered: semanticallyCovered !== undefined,
    ...(semanticallyCovered === undefined ? {} : { item: semanticallyCovered }),
    ...(messagePhase === undefined ? {} : { messagePhase }),
  };
}

function snapshotProjectionForEvents(
  events: readonly NormalizedExternalRuntimeEvent[],
): { readonly kind: string; readonly content: string } | undefined {
  const assistant = events.filter(
    (event) => event.kind === 'assistant_text_delta',
  );
  if (assistant.length > 0) {
    return {
      kind: 'agentMessage',
      content: assistant.map((event) => event.payload.text ?? '').join(''),
    };
  }
  const phasedAssistant = events.filter(
    (event) =>
      event.payload.messagePhase !== undefined &&
      event.payload.text !== undefined,
  );
  if (phasedAssistant.length > 0) {
    return {
      kind: 'agentMessage',
      content: phasedAssistant.at(-1)?.payload.text ?? '',
    };
  }
  const reasoning = events.filter((event) => event.kind === 'reasoning_delta');
  if (reasoning.length > 0) {
    return {
      kind: 'reasoning',
      content: reasoning
        .map(
          (event) =>
            event.payload.text ?? event.payload.summary?.join('\n') ?? '',
        )
        .join(''),
    };
  }
  const plan = events.filter((event) => event.kind === 'plan_delta');
  if (plan.length > 0) {
    return {
      kind: 'plan',
      content: plan
        .map(
          (event) =>
            event.payload.text ?? event.payload.summary?.join('\n') ?? '',
        )
        .filter((content) => content !== '')
        .join('\n'),
    };
  }
  const command = events.filter((event) => event.kind === 'command_activity');
  if (command.length > 0) {
    const latest = command.at(-1);
    return {
      kind: 'commandExecution',
      content: [latest?.payload.command, latest?.payload.output]
        .filter((value): value is string => value !== undefined)
        .join('\n'),
    };
  }
  return undefined;
}

function normalizeCoverageContent(content: string): string {
  return normalizeLineEndings(content).trim();
}

function normalizeLineEndings(content: string): string {
  return content.replaceAll('\r\n', '\n');
}

function suffixPrefixOverlap(snapshot: string, events: string): number {
  const limit = Math.min(snapshot.length, events.length);
  for (let length = limit; length > 0; length -= 1) {
    if (snapshot.endsWith(events.slice(0, length))) return length;
  }
  return 0;
}

function appendSnapshotContinuation(
  messages: ChatMessage[],
  messageIndex: number,
  continuation: string,
  status: ChatMessage['status'],
): void {
  if (continuation === '') return;
  const message = messages[messageIndex];
  const block = message?.blocks[0];
  if (message === undefined || block === undefined) return;
  messages[messageIndex] = {
    ...message,
    status,
    blocks: [
      {
        ...block,
        content: `${block.content}${continuation}`,
        ...(block.tool === undefined
          ? {}
          : {
              tool: {
                ...block.tool,
                status: toolStatus(undefined, status),
              },
            }),
      },
      ...message.blocks.slice(1),
    ],
  };
}

function applyMessagePhase(
  messages: ChatMessage[],
  messageIndex: number,
  phase: 'commentary' | 'final_answer' | 'unknown' | undefined,
): void {
  if (phase === undefined) return;
  const message = messages[messageIndex];
  if (message === undefined || message.metadata?.['messagePhase'] === phase) {
    return;
  }
  messages[messageIndex] = {
    ...message,
    metadata: { ...message.metadata, messagePhase: phase },
  };
}

function isTerminalStatus(status: string): boolean {
  return ['completed', 'failed', 'interrupted'].includes(status);
}

function blocksForGroup(
  events: readonly NormalizedExternalRuntimeEvent[],
  messageStatus: ChatMessage['status'],
): MessageBlock[] {
  const first = events[0];
  if (first === undefined) return [];
  const textEvents = events.filter(
    (event) => event.kind === 'assistant_text_delta',
  );
  if (textEvents.length > 0) {
    return [
      simpleBlock(
        textEvents[0]?.eventId ?? first.eventId,
        'text',
        textEvents.map((event) => event.payload.text ?? '').join(''),
      ),
    ];
  }
  const phasedTextEvents = events.filter(
    (event) =>
      event.payload.messagePhase !== undefined &&
      event.payload.text !== undefined,
  );
  if (phasedTextEvents.length > 0) {
    const latest = phasedTextEvents.at(-1);
    return [
      simpleBlock(
        latest?.eventId ?? first.eventId,
        'text',
        latest?.payload.text ?? '',
      ),
    ];
  }
  const reasoningEvents = events.filter(
    (event) => event.kind === 'reasoning_delta',
  );
  if (reasoningEvents.length > 0) {
    return [
      simpleBlock(
        reasoningEvents[0]?.eventId ?? first.eventId,
        'reasoning',
        reasoningEvents
          .map(
            (event) =>
              event.payload.text ?? event.payload.summary?.join('\n') ?? '',
          )
          .join(''),
      ),
    ];
  }
  const planEvents = events.filter((event) => event.kind === 'plan_delta');
  if (planEvents.length > 0) {
    return [
      simpleBlock(
        planEvents[0]?.eventId ?? first.eventId,
        'plan',
        planEvents
          .map(
            (event) =>
              event.payload.text ?? event.payload.summary?.join('\n') ?? '',
          )
          .filter((value) => value !== '')
          .join('\n') || 'Plan updated',
      ),
    ];
  }
  if (
    first.kind === 'mcp_activity' &&
    events.every(
      (event) =>
        event.payload.nativeMethod === 'mcpServer/startupStatus/updated' &&
        event.payload.tool == null &&
        event.payload.server == null &&
        event.payload.text == null &&
        event.payload.message == null,
    )
  ) {
    return [];
  }
  if (first.kind === 'usage') {
    const last = events.at(-1);
    const usage = last?.payload.usage;
    if (
      usage == null ||
      (typeof usage === 'object' && Object.keys(usage).length === 0)
    ) {
      return [];
    }
    return last === undefined
      ? []
      : [simpleBlock(last.eventId, 'usage', JSON.stringify(usage, null, 2))];
  }
  if (first.kind === 'turn_lifecycle') {
    const diffEvents = events.filter(
      (event) => event.payload.nativeMethod === 'turn/diff/updated',
    );
    const latestDiff = diffEvents.at(-1);
    const block =
      latestDiff === undefined
        ? undefined
        : eventBlock(latestDiff, messageStatus);
    return block === undefined
      ? []
      : [withExternalDetailHistory(block, diffEvents)];
  }
  if (isExternalCommandEvent(first.kind)) {
    const latest = events.at(-1);
    if (latest === undefined) return [];
    const command = latest.payload.command ?? 'unknown';
    const argument = latest.payload.argument;
    return [
      toolBlock(
        latest,
        'command',
        `/${command}${argument == null || argument === '' ? '' : ` ${argument}`}`,
        latest.payload.message ??
          latest.payload.reasonCode ??
          (latest.kind === 'command_started'
            ? 'Command started.'
            : 'Command completed.'),
        toolStatus(latest.payload.status, messageStatus),
      ),
    ];
  }
  return events
    .map((event) => eventBlock(event, messageStatus))
    .filter((block): block is MessageBlock => block !== undefined);
}

function eventBlock(
  event: NormalizedExternalRuntimeEvent,
  messageStatus: ChatMessage['status'],
): MessageBlock | undefined {
  const payload = event.payload;
  const status = toolStatus(payload.status, messageStatus);
  switch (event.kind) {
    case 'assistant_text_delta':
      return simpleBlock(event.eventId, 'text', payload.text ?? '');
    case 'reasoning_delta':
      return simpleBlock(
        event.eventId,
        'reasoning',
        payload.text ?? payload.summary?.join('\n') ?? '',
      );
    case 'plan_delta':
      return simpleBlock(
        event.eventId,
        'plan',
        payload.text ?? payload.summary?.join('\n') ?? 'Plan updated',
      );
    case 'command_activity':
      return toolBlock(
        event,
        'command',
        payload.command ?? 'Command',
        payload.output ?? payload.cwd ?? '',
        status,
      );
    case 'file_activity': {
      const changes = payload.fileChanges ?? [];
      return toolBlock(
        event,
        'file_change',
        'File changes',
        [
          ...changes
            .slice(0, 100)
            .map((change) =>
              [change.status, change.kind, change.path]
                .filter(Boolean)
                .join(' '),
            ),
          ...(changes.length > 100
            ? [
                `... ${changes.length - 100} more changes; inspect the event for full detail.`,
              ]
            : []),
        ].join('\n'),
        status,
      );
    }
    case 'turn_lifecycle':
      if (payload.nativeMethod !== 'turn/diff/updated') return undefined;
      return withExternalDetail(
        toolBlock(
          event,
          'file_change',
          'Aggregate diff',
          payload.text ??
            (event.rawDetailRef == null
              ? 'Aggregate diff updated.'
              : 'Bounded aggregate diff detail is available on demand.'),
          status,
        ),
        event,
      );
    case 'mcp_activity':
    case 'dynamic_tool_activity':
      return toolBlock(
        event,
        'tool_call',
        payload.tool ?? payload.server ?? 'Tool',
        payload.text ?? payload.message ?? '',
        status,
      );
    case 'usage':
      return simpleBlock(
        event.eventId,
        'usage',
        JSON.stringify(payload.usage ?? {}, null, 2),
      );
    case 'compaction':
      return simpleBlock(
        event.eventId,
        'service_notice',
        payload.message ?? 'Context compacted',
      );
    case 'runtime_warning':
    case 'unsupported_server_request':
    case 'unknown_native_notification':
      return simpleBlock(
        event.eventId,
        'debug',
        payload.message ?? payload.nativeMethod,
      );
    default:
      return undefined;
  }
}

function blockForItem(
  id: string,
  kind: string,
  content: string,
  status?: string,
): MessageBlock {
  if (kind.includes('reason')) return simpleBlock(id, 'reasoning', content);
  if (kind.includes('command'))
    return toolBlockValues(
      id,
      'command',
      'Command',
      content,
      toolStatus(status),
    );
  if (kind.includes('file'))
    return toolBlockValues(
      id,
      'file_change',
      'File changes',
      content,
      toolStatus(status),
    );
  if (kind.includes('plan')) return simpleBlock(id, 'plan', content);
  return simpleBlock(id, 'text', content);
}

function buildMessage(
  id: string,
  sessionId: string,
  role: MessageRole,
  createdAt: string,
  blocks: readonly MessageBlock[],
  status: ChatMessage['status'],
  metadata: Readonly<Record<string, unknown>>,
): ChatMessage {
  return {
    id,
    sessionId,
    author: { role, displayName: role === 'assistant' ? 'Agent' : undefined },
    createdAt,
    status,
    blocks: blocks.map((block) => ({ ...block, messageId: id })),
    metadata,
  };
}

function simpleBlock(id: string, kind: string, content: string): MessageBlock {
  return {
    id: `block:${id}`,
    messageId: '',
    kind,
    content,
    estimatedHeight: undefined,
    renderPolicy: kind === 'text' ? 'full' : 'collapsed',
  };
}

function toolBlock(
  event: NormalizedExternalRuntimeEvent,
  kind: string,
  name: string,
  content: string,
  status: ToolBlockStatus,
): MessageBlock {
  return toolBlockValues(event.eventId, kind, name, content, status);
}

function toolBlockValues(
  id: string,
  kind: string,
  name: string,
  content: string,
  status: ToolBlockStatus,
  debugDetailId?: string,
): MessageBlock {
  return {
    ...simpleBlock(id, kind, content),
    tool: {
      name,
      status,
      summary: content.split('\n')[0] ?? '',
      reasonCode: undefined,
      debugDetailId,
    },
  };
}

function withExternalDetail(
  block: MessageBlock,
  event: NormalizedExternalRuntimeEvent,
): MessageBlock {
  return event.rawDetailRef == null
    ? block
    : {
        ...block,
        metadata: {
          boundedDetailRef: event.rawDetailRef,
          externalRuntimeId: event.runtimeId,
        },
      };
}

function withExternalDetailHistory(
  block: MessageBlock,
  events: readonly NormalizedExternalRuntimeEvent[],
): MessageBlock {
  const references = events
    .flatMap((event) =>
      event.rawDetailRef == null ? [] : [event.rawDetailRef],
    )
    .slice(-32);
  if (references.length === 0) return block;
  return {
    ...block,
    metadata: {
      ...block.metadata,
      boundedDetailRefs: references,
    },
  };
}

function roleForItem(kind: string): MessageRole {
  return kind.includes('user')
    ? 'user'
    : kind.includes('tool')
      ? 'tool'
      : 'assistant';
}

function toolStatus(
  status: string | undefined,
  fallbackMessageStatus: ChatMessage['status'] = 'streaming',
): ToolBlockStatus {
  if (status === 'failed' || status === 'error' || status === 'rejected')
    return 'failed';
  if (status === 'completed' || status === 'success' || status === 'applied')
    return 'completed';
  if (status === 'started' || status === 'pending') return 'started';
  if (fallbackMessageStatus === 'completed') return 'completed';
  if (fallbackMessageStatus === 'error') return 'failed';
  return 'running';
}

function terminalStatus(
  events: readonly NormalizedExternalRuntimeEvent[],
  turnStatus: ChatMessage['status'] | undefined,
): ChatMessage['status'] {
  let latest: { sequenceId: number; status: ChatMessage['status'] } | undefined;
  for (const event of events) {
    const status = messageStatus(event.payload.status);
    if (
      status !== 'streaming' &&
      (latest === undefined || event.sequenceId > latest.sequenceId)
    ) {
      latest = { sequenceId: event.sequenceId, status };
    }
  }
  return latest?.status ?? turnStatus ?? 'streaming';
}

function terminalStatusesByTurn(
  events: readonly NormalizedExternalRuntimeEvent[],
): ReadonlyMap<string, ChatMessage['status']> {
  const latest = new Map<
    string,
    { readonly sequenceId: number; readonly status: ChatMessage['status'] }
  >();
  for (const event of events) {
    if (event.kind !== 'turn_lifecycle' || event.nativeTurnId == null) continue;
    const status = messageStatus(event.payload.status);
    if (status === 'streaming') continue;
    const previous = latest.get(event.nativeTurnId);
    if (previous === undefined || event.sequenceId > previous.sequenceId) {
      latest.set(event.nativeTurnId, { sequenceId: event.sequenceId, status });
    }
  }
  return new Map([...latest].map(([turnId, value]) => [turnId, value.status]));
}

function messagePhaseForEvents(
  events: readonly NormalizedExternalRuntimeEvent[],
): 'commentary' | 'final_answer' | 'unknown' | undefined {
  return events
    .filter((event) => event.payload.messagePhase !== undefined)
    .at(-1)?.payload.messagePhase;
}

function messageStatus(status: string | undefined): ChatMessage['status'] {
  if (status === 'failed' || status === 'error' || status === 'rejected')
    return 'error';
  if (
    status === 'completed' ||
    status === 'success' ||
    status === 'interrupted' ||
    status === 'applied'
  ) {
    return 'completed';
  }
  return 'streaming';
}

function eventGroupKey(event: NormalizedExternalRuntimeEvent): string {
  if (event.itemId !== undefined && event.itemId !== null) return event.itemId;
  if (isExternalCommandEvent(event.kind) && event.requestId != null) {
    return `external-command:${event.requestId}`;
  }
  return `${event.nativeTurnId ?? event.eventId}:${event.kind}`;
}

function isExternalCommandEvent(kind: string): boolean {
  return (
    kind === 'command_started' ||
    kind === 'command_completed' ||
    kind === 'command_failed'
  );
}

function unixDate(value: number): string {
  return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
}
