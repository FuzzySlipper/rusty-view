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
        const status = item.status ?? turn.status;
        const content =
          item.text ?? item.summary?.join('\n') ?? item.status ?? item.kind;
        coverage.items.push({
          itemId: item.itemId,
          kind: item.kind,
          content,
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
            },
          ),
        );
      }
    }
  }
  const grouped = new Map<string, NormalizedExternalRuntimeEvent[]>();
  for (const event of events) {
    const key =
      event.itemId ?? `${event.nativeTurnId ?? event.eventId}:${event.kind}`;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  for (const [key, group] of grouped) {
    const first = group[0];
    if (first === undefined) continue;
    if (
      snapshotCoversEventGroup(
        snapshotCoverageByTurn.get(first.nativeTurnId ?? ''),
        group,
      )
    ) {
      continue;
    }
    const status = terminalStatus(
      group,
      terminalByTurn.get(first.nativeTurnId ?? ''),
    );
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
}

interface SnapshotTurnCoverage {
  readonly terminal: boolean;
  readonly items: SnapshotItemCoverage[];
}

function snapshotCoversEventGroup(
  snapshot: SnapshotTurnCoverage | undefined,
  events: readonly NormalizedExternalRuntimeEvent[],
): boolean {
  if (snapshot === undefined) return false;
  const projected = snapshotProjectionForEvents(events);
  if (projected === undefined) return false;
  const itemId = events.find((event) => event.itemId != null)?.itemId;
  return snapshot.items.some((item) => {
    if (item.kind !== projected.kind) return false;
    const snapshotContent = normalizeCoverageContent(item.content);
    const eventContent = normalizeCoverageContent(projected.content);
    if (itemId === item.itemId) {
      return eventContent === '' || snapshotContent.includes(eventContent);
    }
    return (
      snapshot.terminal &&
      eventContent !== '' &&
      snapshotContent === eventContent
    );
  });
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
  return content.replaceAll('\r\n', '\n').trim();
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
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'completed' || status === 'success') return 'completed';
  if (status === 'started') return 'started';
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

function messageStatus(status: string | undefined): ChatMessage['status'] {
  if (status === 'failed' || status === 'error') return 'error';
  if (
    status === 'completed' ||
    status === 'success' ||
    status === 'interrupted'
  ) {
    return 'completed';
  }
  return 'streaming';
}

function unixDate(value: number): string {
  return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
}
