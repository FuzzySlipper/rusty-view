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
  const knownItems = new Set<string>();
  const terminalByTurn = terminalStatusesByTurn(events);
  if (thread !== undefined) {
    for (const turn of thread.turns) {
      for (const item of turn.items) {
        knownItems.add(item.itemId);
        const content =
          item.text ?? item.summary?.join('\n') ?? item.status ?? item.kind;
        messages.push(
          buildMessage(
            `external:${thread.threadId}:${turn.turnId}:${item.itemId}`,
            thread.sessionId,
            roleForItem(item.kind),
            unixDate(turn.startedAt ?? thread.updatedAt),
            [blockForItem(item.itemId, item.kind, content, item.status)],
            messageStatus(item.status),
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
    // Thread projections intentionally summarize native items. Preserve file
    // activity events even when the item is present so paths/status remain
    // visible instead of being lost behind the summary-only history shape.
    if (
      event.itemId != null &&
      knownItems.has(event.itemId) &&
      event.kind !== 'file_activity'
    ) {
      continue;
    }
    const key =
      event.itemId ?? `${event.nativeTurnId ?? event.eventId}:${event.kind}`;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  for (const [key, group] of grouped) {
    const first = group[0];
    if (first === undefined) continue;
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

function blocksForGroup(
  events: readonly NormalizedExternalRuntimeEvent[],
  messageStatus: ChatMessage['status'],
): MessageBlock[] {
  const first = events[0];
  if (first === undefined) return [];
  if (first.kind === 'assistant_text_delta') {
    return [
      simpleBlock(
        first.eventId,
        'text',
        events.map((event) => event.payload.text ?? '').join(''),
      ),
    ];
  }
  if (first.kind === 'reasoning_delta') {
    return [
      simpleBlock(
        first.eventId,
        'reasoning',
        events
          .map(
            (event) =>
              event.payload.text ?? event.payload.summary?.join('\n') ?? '',
          )
          .join(''),
      ),
    ];
  }
  if (first.kind === 'plan_delta') {
    return [
      simpleBlock(
        first.eventId,
        'plan',
        events
          .map(
            (event) =>
              event.payload.text ?? event.payload.summary?.join('\n') ?? '',
          )
          .filter((value) => value !== '')
          .join('\n') || 'Plan updated',
      ),
    ];
  }
  if (first.kind === 'usage') {
    const last = events.at(-1);
    return last === undefined
      ? []
      : [
          simpleBlock(
            last.eventId,
            'usage',
            JSON.stringify(last.payload.usage ?? {}, null, 2),
          ),
        ];
  }
  if (first.kind === 'turn_lifecycle') {
    const latestDiff = events
      .filter((event) => event.payload.nativeMethod === 'turn/diff/updated')
      .at(-1);
    const block =
      latestDiff === undefined
        ? undefined
        : eventBlock(latestDiff, messageStatus);
    return block === undefined ? [] : [block];
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
      return toolBlock(
        event,
        'file_change',
        'Aggregate diff',
        event.rawDetailRef == null
          ? 'Aggregate diff updated.'
          : 'Aggregate diff updated. Inspect this event to load the bounded raw detail.',
        status,
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
