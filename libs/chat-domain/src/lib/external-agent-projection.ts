import type {
  ExternalThreadProjection,
  ExternalInputImageReference,
  ExternalThreadTurnErrorProjection,
  ExternalThreadTurnProjection,
  ExternalRuntimeDocumentReference,
  ExternalRuntimeMediaReference,
  NormalizedExternalRuntimeEvent,
} from '@rusty-view/protocol';
import type {
  ChatAttachment,
  ChatMessage,
  MessageBlock,
  MessageRole,
  ToolBlockStatus,
} from './domain-types';

const MAX_PROJECTED_COMMAND_OUTPUT_CHARACTERS = 64_000;

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
        terminal:
          isTerminalStatus(turn.status) && turn.error?.willRetry !== true,
        error: turn.error ?? null,
        items: [],
      };
      snapshotCoverageByTurn.set(turn.turnId, coverage);
      const assistantBlocks: MessageBlock[] = [];
      const assistantCoverage: Array<Omit<SnapshotItemCoverage, 'messageId'>> =
        [];
      let hasExternalAgentText = false;
      for (const item of turn.items) {
        if (isContentlessGenericSnapshotItem(item)) continue;
        const status = item.status ?? turn.status;
        const content = visibleSnapshotItemContent(item);
        const block = withExternalItemMetadata(
          blockForItem(item.itemId, item.kind, content, status),
          item.itemId,
          item.kind,
          item.messagePhase,
        );
        if (roleForItem(item.kind) === 'user') {
          const userBlocks = [
            block,
            ...blocksForExternalInputImages(item.inputImages),
          ];
          const messageId = `external:${thread.threadId}:${turn.turnId}:${item.itemId}`;
          coverage.items.push({
            itemId: item.itemId,
            kind: item.kind,
            content,
            messageId,
            blockIndex: 0,
          });
          messages.push(
            buildMessage(
              messageId,
              thread.sessionId,
              'user',
              unixDate(turn.startedAt ?? thread.updatedAt),
              userBlocks,
              messageStatus(status),
              {
                nativeThreadId: thread.threadId,
                nativeTurnId: turn.turnId,
                itemId: item.itemId,
              },
            ),
          );
          continue;
        }
        assistantCoverage.push({
          itemId: item.itemId,
          kind: item.kind,
          content,
          blockIndex: assistantBlocks.length,
        });
        assistantBlocks.push(block);
        hasExternalAgentText ||= item.kind === 'agentMessage';
      }
      const errorMessage = buildSnapshotTurnErrorMessage(thread, turn);
      if (errorMessage !== undefined) {
        assistantBlocks.push(...errorMessage.blocks);
      }
      if (assistantBlocks.length > 0) {
        const messageId = externalTurnMessageId(thread.threadId, turn.turnId);
        coverage.items.push(
          ...assistantCoverage.map((item) => ({ ...item, messageId })),
        );
        const messagePhase = messagePhaseForBlocks(assistantBlocks);
        messages.push(
          buildMessage(
            messageId,
            thread.sessionId,
            'assistant',
            unixDate(turn.startedAt ?? thread.updatedAt),
            assistantBlocks,
            errorMessage?.status ?? messageStatus(turn.status),
            {
              nativeThreadId: thread.threadId,
              nativeTurnId: turn.turnId,
              ...(hasExternalAgentText ? { externalAgentText: true } : {}),
              ...(messagePhase === undefined ? {} : { messagePhase }),
              ...errorMessage?.metadata,
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
    const turnTerminalStatus = terminalByTurn.get(first.nativeTurnId ?? '');
    const status = terminalStatus(group, turnTerminalStatus);
    const assistantTurnStatus =
      first.nativeTurnId == null
        ? status
        : (turnTerminalStatus ?? turnErrorStatus(group));
    const reconciliation = reconcileSnapshotEventGroup(
      snapshotCoverageByTurn.get(first.nativeTurnId ?? ''),
      group,
    );
    if (reconciliation.covered) {
      if (reconciliation.item !== undefined) {
        applyMessagePhase(
          messages,
          reconciliation.item.messageId,
          reconciliation.item.blockIndex,
          reconciliation.messagePhase,
        );
      }
      if (
        reconciliation.item !== undefined &&
        reconciliation.uncoveredContent !== undefined
      ) {
        appendSnapshotContinuation(
          messages,
          reconciliation.item.messageId,
          reconciliation.item.blockIndex,
          reconciliation.uncoveredContent,
          assistantTurnStatus,
        );
      }
      const documentBlocks = blocksForExternalDocuments(group).map((block) =>
        withExternalItemMetadata(
          block,
          first.itemId ?? key,
          first.kind,
          messagePhaseForEvents(group),
        ),
      );
      if (documentBlocks.length > 0) {
        appendExternalTurnBlocks(
          messages,
          first,
          documentBlocks,
          assistantTurnStatus,
          messagePhaseForEvents(group),
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
    const snapshotCoverage = snapshotCoverageByTurn.get(
      first.nativeTurnId ?? '',
    );
    const preservesOmittedDynamicTool = group.some(
      (event) => event.kind === 'dynamic_tool_activity',
    );
    const preservesMediaCheckpoint = group.some(
      (event) => (event.payload.media?.length ?? 0) > 0,
    );
    const preservesDocumentCheckpoint = group.some(
      (event) => (event.payload.documents?.length ?? 0) > 0,
    );
    if (
      snapshotCoverage?.terminal &&
      !preservesOmittedDynamicTool &&
      !preservesMediaCheckpoint &&
      !preservesDocumentCheckpoint &&
      !(
        snapshotCoverage.error === null &&
        group.some((event) => event.payload.error !== undefined)
      )
    ) {
      continue;
    }
    const messagePhase = messagePhaseForEvents(group);
    const projectedBlocks = blocksForGroup(group, status);
    const itemIdentity = first.itemId ?? key;
    const blocks = projectedBlocks.map((block, index) =>
      withExternalItemMetadata(
        {
          ...block,
          id:
            block.metadata?.['externalMedia'] === true
              ? block.id
              : projectedBlocks.length === 1
                ? `block:${itemIdentity}`
                : `block:${itemIdentity}:${block.kind}:${index}`,
        },
        itemIdentity,
        first.kind,
        messagePhase,
      ),
    );
    if (blocks.length === 0) continue;
    if (first.nativeTurnId != null) {
      appendExternalTurnBlocks(
        messages,
        first,
        blocks,
        assistantTurnStatus,
        messagePhase,
      );
      continue;
    }
    const standaloneMessage = buildMessage(
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
        ...(messagePhase === undefined ? {} : { messagePhase }),
      },
    );
    if (isExternalCommandEvent(first.kind)) {
      insertMessageChronologically(messages, standaloneMessage);
    } else {
      messages.push(standaloneMessage);
    }
  }
  return messages;
}

function insertMessageChronologically(
  messages: ChatMessage[],
  message: ChatMessage,
): void {
  const insertionIndex = messages.findIndex(
    (existing) => existing.createdAt.localeCompare(message.createdAt) > 0,
  );
  if (insertionIndex < 0) {
    messages.push(message);
    return;
  }
  messages.splice(insertionIndex, 0, message);
}

function blocksForExternalInputImages(
  references: readonly ExternalInputImageReference[] | undefined,
): MessageBlock[] {
  if (references === undefined || references.length === 0) return [];
  const attachments: ChatAttachment[] = references.map((reference) => ({
    id: reference.attachmentId,
    status: 'active',
    kind: 'image',
    name: reference.filename,
    mimeType: reference.mimeType,
    sizeBytes: reference.byteSize,
    url: reference.contentUrl,
    thumbnailUrl: undefined,
    contentState: 'available',
    contentLoadPolicy: 'authenticated_lazy',
    ...(reference.sha256 === null ? {} : { contentSha256: reference.sha256 }),
    textPreview: undefined,
    scopeId: undefined,
    metadata: { externalInputImage: true },
  }));
  return [
    {
      id: `block:external-input-images:${attachments.map((attachment) => attachment.id).join(':')}`,
      messageId: '',
      kind: 'attachment',
      content: attachments.map((attachment) => attachment.name).join('\n'),
      estimatedHeight: undefined,
      renderPolicy: 'full',
      attachments,
      metadata: { externalInputImages: true },
    },
  ];
}

interface SnapshotItemCoverage {
  readonly itemId: string;
  readonly kind: string;
  readonly content: string;
  readonly messageId: string;
  readonly blockIndex: number;
}

interface SnapshotTurnCoverage {
  readonly terminal: boolean;
  readonly error: ExternalThreadTurnErrorProjection | null;
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
  const eventError = events.find((event) => event.payload.error !== undefined)
    ?.payload.error;
  if (
    eventError !== undefined &&
    snapshot.error !== null &&
    sameTurnError(eventError, snapshot.error)
  ) {
    return { covered: true };
  }
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
    const activity = projectCommandActivity(command);
    if (activity === undefined) return undefined;
    return {
      kind: 'commandExecution',
      content: [activity.command, activity.output]
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
  messageId: string,
  blockIndex: number,
  continuation: string,
  status: ChatMessage['status'],
): void {
  if (continuation === '') return;
  const messageIndex = messages.findIndex(
    (message) => message.id === messageId,
  );
  if (messageIndex < 0) return;
  const message = messages[messageIndex];
  const block = message?.blocks[blockIndex];
  if (message === undefined || block === undefined) return;
  const blocks = [...message.blocks];
  blocks[blockIndex] = {
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
  };
  messages[messageIndex] = {
    ...message,
    status,
    blocks,
  };
}

function applyMessagePhase(
  messages: ChatMessage[],
  messageId: string,
  blockIndex: number,
  phase: 'commentary' | 'final_answer' | 'unknown' | undefined,
): void {
  if (phase === undefined) return;
  const messageIndex = messages.findIndex(
    (message) => message.id === messageId,
  );
  if (messageIndex < 0) return;
  const message = messages[messageIndex];
  const block = message?.blocks[blockIndex];
  if (message === undefined || block === undefined) return;
  const blocks = [...message.blocks];
  blocks[blockIndex] = {
    ...block,
    metadata: { ...block.metadata, messagePhase: phase },
  };
  const messagePhase = messagePhaseForBlocks(blocks);
  messages[messageIndex] = {
    ...message,
    blocks,
    metadata: {
      ...message.metadata,
      ...(messagePhase === undefined ? {} : { messagePhase }),
    },
  };
}

function isTerminalStatus(status: string): boolean {
  return ['completed', 'failed', 'interrupted', 'outcome_unknown'].includes(
    status,
  );
}

function blocksForGroup(
  events: readonly NormalizedExternalRuntimeEvent[],
  messageStatus: ChatMessage['status'],
): MessageBlock[] {
  return [
    ...blocksForGroupWithoutMedia(events, messageStatus),
    ...blocksForExternalMedia(events),
    ...blocksForExternalDocuments(events),
  ];
}

function blocksForGroupWithoutMedia(
  events: readonly NormalizedExternalRuntimeEvent[],
  messageStatus: ChatMessage['status'],
): MessageBlock[] {
  const first = events[0];
  if (first === undefined) return [];
  const latestErrorEvent = events
    .filter((event) => event.payload.error !== undefined)
    .at(-1);
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
    return [
      ...(block === undefined
        ? []
        : [withExternalDetailHistory(block, diffEvents)]),
      ...(latestErrorEvent === undefined
        ? []
        : [blockForTurnErrorEvent(latestErrorEvent)]),
    ];
  }
  if (latestErrorEvent !== undefined) {
    return [blockForTurnErrorEvent(latestErrorEvent)];
  }
  const externalToolActivity = projectExternalToolActivity(events);
  if (externalToolActivity !== undefined) {
    const content =
      externalToolActivity.text ??
      (externalToolActivity.status === 'failed'
        ? 'Tool call failed.'
        : externalToolActivity.status === 'completed'
          ? 'Tool call completed.'
          : 'Tool call is running.');
    return [
      withExternalDetailHistory(
        toolBlockValues(
          externalToolActivity.itemId ?? externalToolActivity.first.eventId,
          'tool_call',
          externalToolActivity.name,
          content,
          externalToolActivity.status,
        ),
        events,
      ),
    ];
  }
  const commandActivity = projectCommandActivity(events);
  if (commandActivity !== undefined) {
    const content =
      boundedCommandOutput(commandActivity.output) ?? commandActivity.cwd ?? '';
    return [
      withExternalDetailHistory(
        toolBlockValues(
          commandActivity.itemId ?? commandActivity.first.eventId,
          'command',
          commandActivity.command ?? 'Command',
          content,
          toolStatus(commandActivity.status, messageStatus),
        ),
        events,
      ),
    ];
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

interface ProjectedExternalMedia {
  readonly firstSequenceId: number;
  readonly event: NormalizedExternalRuntimeEvent;
  readonly reference: ExternalRuntimeMediaReference;
}

function blocksForExternalMedia(
  events: readonly NormalizedExternalRuntimeEvent[],
): MessageBlock[] {
  const mediaByIndex = new Map<number, ProjectedExternalMedia>();
  for (const event of events) {
    for (const reference of event.payload.media ?? []) {
      const existing = mediaByIndex.get(reference.mediaIndex);
      mediaByIndex.set(reference.mediaIndex, {
        firstSequenceId: existing?.firstSequenceId ?? event.sequenceId,
        event,
        reference,
      });
    }
  }
  const orderedMedia = [...mediaByIndex.values()].sort(
    (left, right) =>
      left.firstSequenceId - right.firstSequenceId ||
      left.reference.mediaIndex - right.reference.mediaIndex,
  );
  if (orderedMedia.length === 0) return [];
  const first = orderedMedia[0];
  if (first === undefined) return [];
  const itemIdentity =
    first.event.itemId ??
    `${first.event.eventId}:${first.reference.mediaIndex}`;
  const blockId = [
    'block:external-media',
    first.event.runtimeId,
    first.event.nativeThreadId ?? 'thread',
    first.event.nativeTurnId ?? 'turn',
    itemIdentity,
  ].join(':');
  const attachments = orderedMedia.map(projectExternalMediaAttachment);
  return [
    {
      id: blockId,
      messageId: '',
      kind: 'attachment',
      content: attachments.map((attachment) => attachment.name).join('\n'),
      estimatedHeight: undefined,
      renderPolicy: 'full',
      attachments,
      metadata: {
        externalMedia: true,
        externalRuntimeId: first.event.runtimeId,
        externalThreadId: first.event.nativeThreadId,
        externalTurnId: first.event.nativeTurnId,
        externalItemId: first.event.itemId,
        firstExternalSequenceId: first.firstSequenceId,
      },
    },
  ];
}

function projectExternalMediaAttachment(
  media: ProjectedExternalMedia,
): ChatAttachment {
  const reference = media.reference;
  const event = media.event;
  const stableFallbackId = [
    'external-media',
    event.runtimeId,
    event.nativeThreadId ?? 'thread',
    event.nativeTurnId ?? 'turn',
    event.itemId ?? event.eventId,
    reference.mediaIndex,
  ].join(':');
  return {
    id: reference.attachmentId ?? stableFallbackId,
    status: 'active',
    kind: 'image',
    name: reference.filename ?? `Image ${reference.mediaIndex + 1}`,
    mimeType: reference.mimeType,
    sizeBytes: reference.byteSize,
    url:
      reference.captureState === 'available' ? reference.contentUrl : undefined,
    thumbnailUrl: undefined,
    contentState: reference.captureState,
    contentLoadPolicy: 'authenticated_lazy',
    ...(reference.sha256 === undefined
      ? {}
      : { contentSha256: reference.sha256 }),
    ...(reference.width === undefined ? {} : { width: reference.width }),
    ...(reference.height === undefined ? {} : { height: reference.height }),
    textPreview: undefined,
    scopeId: undefined,
    metadata: {
      externalRuntimeMedia: true,
      captureSource: reference.captureSource,
      captureState: reference.captureState,
      reasonCode: reference.reasonCode,
      mediaIndex: reference.mediaIndex,
      externalSequenceId: media.firstSequenceId,
      externalEventId: event.eventId,
      externalRuntimeId: event.runtimeId,
      externalThreadId: event.nativeThreadId,
      externalTurnId: event.nativeTurnId,
      externalItemId: event.itemId,
    },
  };
}

interface ProjectedExternalDocument {
  readonly firstSequenceId: number;
  readonly event: NormalizedExternalRuntimeEvent;
  readonly reference: ExternalRuntimeDocumentReference;
}

function blocksForExternalDocuments(
  events: readonly NormalizedExternalRuntimeEvent[],
): MessageBlock[] {
  const documentsByIndex = new Map<number, ProjectedExternalDocument>();
  for (const event of events) {
    for (const reference of event.payload.documents ?? []) {
      const existing = documentsByIndex.get(reference.documentIndex);
      documentsByIndex.set(reference.documentIndex, {
        firstSequenceId: existing?.firstSequenceId ?? event.sequenceId,
        event,
        reference,
      });
    }
  }
  const orderedDocuments = [...documentsByIndex.values()].sort(
    (left, right) =>
      left.firstSequenceId - right.firstSequenceId ||
      left.reference.documentIndex - right.reference.documentIndex,
  );
  const first = orderedDocuments[0];
  if (first === undefined) return [];
  const itemIdentity =
    first.event.itemId ??
    `${first.event.eventId}:${first.reference.documentIndex}`;
  const blockId = [
    'block:external-documents',
    first.event.runtimeId,
    first.event.nativeThreadId ?? 'thread',
    first.event.nativeTurnId ?? 'turn',
    itemIdentity,
  ].join(':');
  const attachments = orderedDocuments.map(projectExternalDocumentAttachment);
  return [
    {
      id: blockId,
      messageId: '',
      kind: 'attachment',
      content: attachments.map((attachment) => attachment.name).join('\n'),
      estimatedHeight: undefined,
      renderPolicy: 'full',
      attachments,
      metadata: {
        externalDocuments: true,
        externalRuntimeId: first.event.runtimeId,
        externalThreadId: first.event.nativeThreadId,
        externalTurnId: first.event.nativeTurnId,
        externalItemId: first.event.itemId,
        firstExternalSequenceId: first.firstSequenceId,
      },
    },
  ];
}

function projectExternalDocumentAttachment(
  document: ProjectedExternalDocument,
): ChatAttachment {
  const reference = document.reference;
  const event = document.event;
  const stableFallbackId = [
    'external-document',
    event.runtimeId,
    event.nativeThreadId ?? 'thread',
    event.nativeTurnId ?? 'turn',
    event.itemId ?? event.eventId,
    reference.documentIndex,
  ].join(':');
  return {
    id: reference.attachmentId ?? stableFallbackId,
    status: 'active',
    kind: 'file',
    name: reference.filename ?? `Checkpoint ${reference.documentIndex + 1}`,
    mimeType: reference.mimeType,
    sizeBytes: reference.byteSize,
    url:
      reference.captureState === 'available' ? reference.contentUrl : undefined,
    thumbnailUrl: undefined,
    contentState: reference.captureState,
    contentLoadPolicy: 'authenticated_lazy',
    ...(reference.sha256 === undefined
      ? {}
      : { contentSha256: reference.sha256 }),
    textPreview: undefined,
    scopeId: undefined,
    metadata: {
      externalRuntimeDocument: true,
      captureSource: reference.captureSource,
      captureState: reference.captureState,
      reasonCode: reference.reasonCode,
      languageHint: reference.languageHint,
      documentIndex: reference.documentIndex,
      externalSequenceId: document.firstSequenceId,
      externalEventId: event.eventId,
      externalRuntimeId: event.runtimeId,
      externalThreadId: event.nativeThreadId,
      externalTurnId: event.nativeTurnId,
      externalItemId: event.itemId,
    },
  };
}

interface ProjectedExternalToolActivity {
  readonly first: NormalizedExternalRuntimeEvent;
  readonly itemId: string | undefined;
  readonly name: string;
  readonly text: string | undefined;
  readonly status: ToolBlockStatus;
}

function projectExternalToolActivity(
  events: readonly NormalizedExternalRuntimeEvent[],
): ProjectedExternalToolActivity | undefined {
  const toolEvents = events.filter(
    (event) =>
      event.kind === 'mcp_activity' || event.kind === 'dynamic_tool_activity',
  );
  const first = toolEvents[0];
  if (first === undefined) return undefined;

  const success = latestDefined(toolEvents, (event) => event.payload.success);
  const nativeStatus = latestDefined(
    toolEvents,
    (event) => event.payload.status,
  );
  const status =
    success === false
      ? 'failed'
      : success === true
        ? 'completed'
        : toolStatus(nativeStatus);

  return {
    first,
    itemId: latestDefined(toolEvents, (event) => event.itemId),
    name:
      latestDefined(
        toolEvents,
        (event) => event.payload.tool ?? event.payload.server,
      ) ?? 'Tool',
    text: latestDefined(
      toolEvents,
      (event) => event.payload.text ?? event.payload.message,
    ),
    status,
  };
}

interface ProjectedCommandActivity {
  readonly first: NormalizedExternalRuntimeEvent;
  readonly itemId: string | undefined;
  readonly command: string | undefined;
  readonly cwd: string | undefined;
  readonly output: string | undefined;
  readonly status: string | undefined;
}

function projectCommandActivity(
  events: readonly NormalizedExternalRuntimeEvent[],
): ProjectedCommandActivity | undefined {
  const commandEvents = events.filter(
    (event) => event.kind === 'command_activity',
  );
  const first = commandEvents[0];
  if (first === undefined) return undefined;

  const command = latestDefined(
    commandEvents,
    (event) => event.payload.command,
  );
  const cwd = latestDefined(commandEvents, (event) => event.payload.cwd);
  const status = latestDefined(commandEvents, (event) => event.payload.status);
  const aggregatedOutput = latestDefined(
    commandEvents,
    (event) => event.payload.output,
  );
  const deltaOutput = commandEvents
    .filter(
      (event) =>
        event.payload.nativeMethod === 'item/commandExecution/outputDelta',
    )
    .map((event) => event.payload.text ?? '')
    .join('');

  return {
    first,
    itemId:
      latestDefined(commandEvents, (event) => event.itemId ?? undefined) ??
      undefined,
    command,
    cwd,
    output: aggregatedOutput ?? (deltaOutput === '' ? undefined : deltaOutput),
    status,
  };
}

function latestDefined<T>(
  events: readonly NormalizedExternalRuntimeEvent[],
  select: (event: NormalizedExternalRuntimeEvent) => T | null | undefined,
): T | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined) continue;
    const value = select(event);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function boundedCommandOutput(output: string | undefined): string | undefined {
  if (
    output === undefined ||
    output.length <= MAX_PROJECTED_COMMAND_OUTPUT_CHARACTERS
  ) {
    return output;
  }
  return `[... earlier command output omitted ...]\n${output.slice(
    -MAX_PROJECTED_COMMAND_OUTPUT_CHARACTERS,
  )}`;
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

function buildSnapshotTurnErrorMessage(
  thread: ExternalThreadProjection,
  turn: ExternalThreadTurnProjection,
): ChatMessage | undefined {
  if (turn.error == null && !isFailureStatus(turn.status)) return undefined;
  const retrying = turn.error?.willRetry === true;
  const id = `external:${thread.threadId}:${turn.turnId}:turn-error`;
  return buildMessage(
    id,
    thread.sessionId,
    'assistant',
    unixDate(turn.completedAt ?? turn.startedAt ?? thread.updatedAt),
    [
      blockForTurnError(
        id,
        turn.error ?? null,
        {
          status: turn.status,
          statusSource: turn.statusSource ?? 'native',
          terminalReasonCode: turn.terminalReasonCode ?? null,
        },
        retrying,
      ),
    ],
    retrying ? 'streaming' : 'error',
    {
      nativeThreadId: thread.threadId,
      nativeTurnId: turn.turnId,
      statusSource: turn.statusSource ?? 'native',
      terminalReasonCode: turn.terminalReasonCode ?? null,
      externalTurnError: turn.error ?? null,
      retrying,
    },
  );
}

function blockForTurnErrorEvent(
  event: NormalizedExternalRuntimeEvent,
): MessageBlock {
  const error = event.payload.error;
  if (error === undefined) {
    return simpleBlock(event.eventId, 'debug', event.payload.nativeMethod);
  }
  return blockForTurnError(
    event.eventId,
    error,
    {
      status:
        event.payload.status ??
        (error.willRetry === true ? 'active' : 'failed'),
      statusSource: 'native',
      terminalReasonCode: event.payload.reasonCode ?? null,
    },
    error.willRetry === true,
  );
}

function blockForTurnError(
  id: string,
  error: ExternalThreadTurnErrorProjection | null,
  diagnostic: Pick<
    ExternalThreadTurnProjection,
    'status' | 'statusSource' | 'terminalReasonCode'
  >,
  retrying: boolean,
): MessageBlock {
  const summary =
    error?.message ??
    `Turn ended with status ${diagnostic.status.replaceAll('_', ' ')}.`;
  const details = [
    `Message: ${summary}`,
    ...(error?.code == null ? [] : [`Code: ${error.code}`]),
    ...(error?.additionalDetails == null
      ? []
      : [`Additional details: ${error.additionalDetails}`]),
    `Status: ${diagnostic.status}`,
    `Status source: ${diagnostic.statusSource}`,
    ...(diagnostic.terminalReasonCode === null
      ? []
      : [`Terminal reason: ${diagnostic.terminalReasonCode}`]),
    `Will retry: ${retrying ? 'yes' : 'no'}`,
  ].join('\n');
  const block = toolBlockValues(
    id,
    'external_turn_error',
    retrying ? 'Codex retrying' : failureLabel(diagnostic.status),
    details,
    retrying ? 'running' : 'failed',
  );
  const tool = block.tool;
  if (tool === undefined) return block;
  return {
    ...block,
    metadata: {
      statusSource: diagnostic.statusSource,
      terminalReasonCode: diagnostic.terminalReasonCode,
      retrying,
    },
    tool: {
      ...tool,
      summary,
      reasonCode: diagnostic.terminalReasonCode ?? undefined,
    },
  };
}

function failureLabel(status: string): string {
  if (status === 'interrupted') return 'Codex turn interrupted';
  if (status === 'outcome_unknown') return 'Codex turn outcome unknown';
  return 'Codex turn failed';
}

function isFailureStatus(status: string): boolean {
  return ['failed', 'interrupted', 'outcome_unknown'].includes(status);
}

function sameTurnError(
  left: ExternalThreadTurnErrorProjection,
  right: ExternalThreadTurnErrorProjection,
): boolean {
  return (
    left.message === right.message &&
    left.code === right.code &&
    left.additionalDetails === right.additionalDetails &&
    left.willRetry === right.willRetry
  );
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

function isContentlessGenericSnapshotItem(
  item: ExternalThreadTurnProjection['items'][number],
): boolean {
  if (item.kind.trim().toLowerCase() !== 'item') return false;
  if ((item.inputImages?.length ?? 0) > 0) return false;
  return (
    !hasVisibleSnapshotItemText(item.text) &&
    !item.summary?.some(hasVisibleSnapshotItemText) &&
    !hasVisibleSnapshotItemText(item.status)
  );
}

function visibleSnapshotItemContent(
  item: ExternalThreadTurnProjection['items'][number],
): string {
  const text = item.text;
  if (hasVisibleSnapshotItemText(text)) return text;
  const summary = item.summary?.filter(hasVisibleSnapshotItemText).join('\n');
  if (hasVisibleSnapshotItemText(summary)) return summary;
  const status = item.status;
  if (hasVisibleSnapshotItemText(status)) return status;
  return item.kind;
}

function hasVisibleSnapshotItemText(
  value: string | undefined,
): value is string {
  return value !== undefined && value.trim().length > 0;
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

function appendExternalTurnBlocks(
  messages: ChatMessage[],
  event: NormalizedExternalRuntimeEvent,
  blocks: readonly MessageBlock[],
  status: ChatMessage['status'],
  eventPhase: 'commentary' | 'final_answer' | 'unknown' | undefined,
): void {
  const turnId = event.nativeTurnId;
  if (turnId == null) return;
  const threadId =
    event.nativeThreadId ??
    event.sessionId ??
    `${event.runtimeId}:unbound-thread`;
  const messageIndex = messages.findIndex(
    (message) =>
      message.author.role !== 'user' &&
      message.metadata?.['nativeTurnId'] === turnId &&
      (event.nativeThreadId == null ||
        message.metadata?.['nativeThreadId'] === event.nativeThreadId),
  );
  if (messageIndex < 0) {
    const messagePhase = messagePhaseForBlocks(blocks) ?? eventPhase;
    messages.push(
      buildMessage(
        externalTurnMessageId(threadId, turnId),
        event.sessionId ?? `${event.runtimeId}:${threadId}`,
        'assistant',
        event.createdAt,
        blocks,
        status,
        {
          runtimeId: event.runtimeId,
          nativeThreadId: event.nativeThreadId,
          nativeTurnId: turnId,
          ...(blocks.some((block) => block.kind === 'text')
            ? { externalAgentText: true }
            : {}),
          ...(messagePhase === undefined ? {} : { messagePhase }),
        },
      ),
    );
    return;
  }

  const message = messages[messageIndex];
  if (message === undefined) return;
  const appendedBlocks = blocks.map((block) => ({
    ...block,
    messageId: message.id,
  }));
  const firstFinalAnswer = message.blocks.findIndex(
    (block) => block.metadata?.['messagePhase'] === 'final_answer',
  );
  const insertBeforeFinalAnswer =
    firstFinalAnswer >= 0 &&
    appendedBlocks.some((block) => block.kind === 'tool_call');
  const nextBlocks = insertBeforeFinalAnswer
    ? [
        ...message.blocks.slice(0, firstFinalAnswer),
        ...appendedBlocks,
        ...message.blocks.slice(firstFinalAnswer),
      ]
    : [...message.blocks, ...appendedBlocks];
  const messagePhase = messagePhaseForBlocks(nextBlocks) ?? eventPhase;
  messages[messageIndex] = {
    ...message,
    status: mergeTurnMessageStatus(message.status, status),
    blocks: nextBlocks,
    metadata: {
      ...message.metadata,
      runtimeId: event.runtimeId,
      ...(nextBlocks.some((block) => block.kind === 'text')
        ? { externalAgentText: true }
        : {}),
      ...(messagePhase === undefined ? {} : { messagePhase }),
    },
  };
}

function mergeTurnMessageStatus(
  current: ChatMessage['status'],
  incoming: ChatMessage['status'],
): ChatMessage['status'] {
  if (current === 'error' || incoming === 'error') return 'error';
  if (current === 'completed' || incoming === 'completed') return 'completed';
  return 'streaming';
}

function externalTurnMessageId(threadId: string, turnId: string): string {
  return `external:${threadId}:${turnId}:assistant`;
}

function withExternalItemMetadata(
  block: MessageBlock,
  itemId: string,
  itemKind: string,
  phase: 'commentary' | 'final_answer' | 'unknown' | undefined,
): MessageBlock {
  return {
    ...block,
    metadata: {
      ...block.metadata,
      externalItemId: itemId,
      externalItemKind: itemKind,
      ...(phase === undefined ? {} : { messagePhase: phase }),
    },
  };
}

function messagePhaseForBlocks(
  blocks: readonly MessageBlock[],
): 'commentary' | 'final_answer' | 'unknown' | undefined {
  const phases = blocks
    .map((block) => block.metadata?.['messagePhase'])
    .filter(
      (phase): phase is 'commentary' | 'final_answer' | 'unknown' =>
        phase === 'commentary' ||
        phase === 'final_answer' ||
        phase === 'unknown',
    );
  if (phases.includes('final_answer')) return 'final_answer';
  return phases.at(-1);
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
    const status = eventMessageStatus(event);
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
    const status = eventMessageStatus(event);
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

function eventMessageStatus(
  event: NormalizedExternalRuntimeEvent,
): ChatMessage['status'] {
  if (event.payload.error?.willRetry === true) return 'streaming';
  if (event.payload.error !== undefined) return 'error';
  return messageStatus(event.payload.status);
}

function turnErrorStatus(
  events: readonly NormalizedExternalRuntimeEvent[],
): ChatMessage['status'] {
  return events.some(
    (event) =>
      event.payload.error !== undefined &&
      event.payload.error.willRetry !== true,
  )
    ? 'error'
    : 'streaming';
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
