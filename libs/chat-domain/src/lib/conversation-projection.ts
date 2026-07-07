import type { ChatEvent, ChatSessionSummary } from '@rusty-view/protocol';

import {
  emptyProjection,
  type ActiveAssistantTurn,
  type ChatMessage,
  type CommandProjection,
  type ContextEstimateQuality,
  type ContextTimelineEntry,
  type ContextTimelineKind,
  type ConversationProjection,
  type MessageAuthor,
  type MessageBlock,
  type MessageRole,
  type StreamErrorState,
  type ToolBlockMeta,
  type ToolCallProjection,
} from './domain-types';

/**
 * Reduce a sequence of protocol ChatEvents into a ConversationProjection.
 *
 * If a `previous` projection is given, events are applied on top of it
 * (incremental update from a reconnect/replay). Otherwise the projection starts
 * empty.
 *
 * This is a PURE function — no I/O, no side effects, no Angular. The chat-store
 * calls this to turn raw events into view-model state.
 */
export function projectConversation(
  events: readonly ChatEvent[],
  previous?: ConversationProjection,
): ConversationProjection {
  let projection = previous ?? emptyProjection();
  for (const event of events) {
    projection = applyEvent(projection, event);
  }
  return projection;
}

/**
 * Apply a single event to a projection, returning a new immutable projection.
 *
 * The switch is deliberately exhaustive: every known ChatEventKind has a case.
 * If the contract adds a new kind, TypeScript errors (not all code paths return
 * a ConversationProjection), making unhandled kinds obvious in debug builds.
 *
 * Transport coerces unrecognized backend kinds to 'unknown' before they reach
 * here, so the 'unknown' case is the safe fallback for future/unrecognized
 * events.
 */
function applyEvent(
  projection: ConversationProjection,
  event: ChatEvent,
): ConversationProjection {
  const withCursor: ConversationProjection = {
    ...projection,
    latestCursor: event.event_id,
  };

  switch (event.kind) {
    case 'session_snapshot':
      return applySessionSnapshot(withCursor, event);
    case 'message_created':
      return applyMessageCreated(withCursor, event);
    case 'assistant_turn_started':
      return applyAssistantTurnStarted(withCursor, event);
    case 'assistant_text_delta':
      return applyAssistantTextDelta(withCursor, event);
    case 'assistant_reasoning_delta':
      return applyAssistantReasoningDelta(withCursor, event);
    case 'phase_change':
    case 'provider_status':
      return withCursor;
    case 'assistant_message_completed':
      return applyAssistantMessageCompleted(withCursor, event);
    case 'assistant_turn_finished':
      return applyAssistantTurnFinished(withCursor);
    case 'tool_call_started':
      return applyToolCall(withCursor, event, 'started');
    case 'tool_call_completed':
      return applyToolCall(withCursor, event, 'completed');
    case 'tool_call_failed':
      return applyToolCall(withCursor, event, 'failed');
    case 'command_started':
      return applyCommand(withCursor, event, 'started');
    case 'command_completed':
      return applyCommand(withCursor, event, 'completed');
    case 'command_failed':
      return applyCommand(withCursor, event, 'failed');
    case 'context_status':
      return applyContextEvent(withCursor, event, 'status');
    case 'context_compaction_started':
      return applyContextEvent(withCursor, event, 'compaction_started');
    case 'context_compaction_completed':
      return applyContextEvent(withCursor, event, 'compaction_completed');
    case 'context_compaction_failed':
      return applyContextEvent(withCursor, event, 'compaction_failed');
    // Known kinds the conversation model does not yet project (message slots /
    // variants, branches, snapshots, attachments, data-bank scopes). They are
    // tracked by their own tasks; here they only advance the cursor so replay
    // stays consistent. They are NOT coerced to `unknown` (they are recognized).
    case 'message_slot_created':
    case 'message_variant_created':
    case 'message_variant_deleted':
    case 'message_variants_reordered':
    case 'message_active_variant_selected':
    case 'conversation_branch_created':
    case 'conversation_active_branch_selected':
    case 'conversation_branch_head_updated':
    case 'conversation_snapshot_created':
    case 'attachment_uploaded':
    case 'attachment_linked':
    case 'attachment_removed':
    case 'attachment_updated':
    case 'data_bank_scope_created':
    case 'data_bank_scope_removed':
      return withCursor;
    case 'stream_error':
      return applyStreamError(withCursor, event);
    case 'unknown':
      return applyUnknown(withCursor, event);
  }
  // No default: if ChatEventKind gains a member, the switch is no longer
  // exhaustive and TypeScript errors because not all paths return.
}

// ---- session snapshot ----

function applySessionSnapshot(
  projection: ConversationProjection,
  event: ChatEvent,
): ConversationProjection {
  const payload = payloadRecord(event.payload);
  const session = payload['session'];
  if (!isPayloadObject(session)) {
    return projection;
  }
  // A session_snapshot always carries a ChatSessionSummary; transport validated
  // the envelope, so reading it as that shape is safe at the domain boundary.
  return { ...projection, sessionMetadata: session as ChatSessionSummary };
}

// ---- message created ----

function applyMessageCreated(
  projection: ConversationProjection,
  event: ChatEvent,
): ConversationProjection {
  const payload = payloadRecord(event.payload);
  const messageId = readOptionalString(payload, 'message_id');
  const role = readOptionalString(payload, 'role');
  const body = readOptionalString(payload, 'body');
  if (messageId === undefined || role === undefined || body === undefined) {
    return projection;
  }

  if (messageExists(projection, messageId)) {
    return projection; // dedup: already have this message
  }

  const message = buildMessage(
    messageId,
    event.session_id,
    role as MessageRole,
    event.created_at,
    'completed',
    [{ kind: 'text', content: body }],
  );

  return { ...projection, messages: [...projection.messages, message] };
}

// ---- assistant turn lifecycle ----

function applyAssistantTurnStarted(
  projection: ConversationProjection,
  event: ChatEvent,
): ConversationProjection {
  const turn: ActiveAssistantTurn = {
    startedAt: event.created_at,
    messageId: undefined,
    streamingText: '',
  };

  // Check if the payload carries a message_id (some implementations may include it).
  const payload = event.payload;
  if ('message_id' in payload && typeof payload.message_id === 'string') {
    return {
      ...projection,
      activeTurn: { ...turn, messageId: payload.message_id },
    };
  }
  return { ...projection, activeTurn: turn };
}

function applyAssistantTextDelta(
  projection: ConversationProjection,
  event: ChatEvent,
): ConversationProjection {
  const payload = payloadRecord(event.payload);

  // The OpenAPI contract specifies `message_id` and `delta` fields, but the
  // live backend currently emits `wake_id` (or sometimes `message_id`) and
  // `text` for the delta content. Accept both shapes to handle contract drift.
  const directMessageId = readOptionalString(payload, 'message_id');
  const wakeId = readOptionalString(payload, 'wake_id');
  const messageId =
    directMessageId ?? (wakeId !== undefined ? `asst:${wakeId}` : undefined);

  const delta =
    readOptionalString(payload, 'delta') ?? readOptionalString(payload, 'text');

  if (messageId === undefined || delta === undefined) {
    return projection;
  }

  const adoptedMessages = adoptActivityOnlyStreamingPlaceholder(
    projection.messages,
    messageId,
  );

  // Update or create the streaming message.
  const messages = upsertStreamingDelta(
    adoptedMessages,
    messageId,
    event,
    delta,
  );

  // Update the active turn.
  const activeTurn = updateActiveTurnForDelta(
    projection.activeTurn,
    messageId,
    delta,
  );

  return { ...projection, messages, activeTurn };
}

/**
 * Project an `assistant_reasoning_delta` into the active assistant turn's
 * reasoning block (task #3867).
 *
 * Reasoning/think output is kept SEPARATE from normal assistant text: it lands
 * in a dedicated `reasoning` block (rendered collapsed/expandable), never folded
 * into the visible answer. Deltas accumulate into the current reasoning block, or
 * start a new one when other content (text/tool activity) has intervened — so
 * reasoning, text, and tool blocks stay in chronological order within the turn.
 *
 * The reasoning block attaches to the SAME assistant message the text deltas use
 * (`asst:${wake_id}`), so reasoning that streams before any answer text still
 * shares one message rather than splitting into two.
 */
function applyAssistantReasoningDelta(
  projection: ConversationProjection,
  event: ChatEvent,
): ConversationProjection {
  const payload = payloadRecord(event.payload);

  // The contract keys reasoning deltas by an optional `wake_id` (no message_id)
  // and carries the chunk under `text`. Accept a direct `message_id`/`delta` too
  // for forward-compatibility with any contract drift.
  const directMessageId = readOptionalString(payload, 'message_id');
  const wakeId = readOptionalString(payload, 'wake_id');
  const messageId =
    directMessageId ??
    (wakeId !== undefined
      ? `asst:${wakeId}`
      : projection.activeTurn?.messageId);

  const delta =
    readOptionalString(payload, 'text') ?? readOptionalString(payload, 'delta');

  if (messageId === undefined || delta === undefined) {
    return projection;
  }

  const adoptedMessages = adoptActivityOnlyStreamingPlaceholder(
    projection.messages,
    messageId,
  );

  const messages = upsertReasoningDelta(
    adoptedMessages,
    messageId,
    event,
    delta,
  );

  // Reasoning implies a live turn is under way. Ensure one exists and points at
  // this message, but leave `streamingText` (the visible answer) untouched —
  // reasoning must not leak into the assistant's text.
  const activeTurn = updateActiveTurnForReasoning(
    projection.activeTurn,
    messageId,
    event,
  );

  return { ...projection, messages, activeTurn };
}

function applyAssistantMessageCompleted(
  projection: ConversationProjection,
  event: ChatEvent,
): ConversationProjection {
  const payload = event.payload;

  // The OpenAPI contract specifies `message_id` and `body`. Some live backend
  // terminal events carry only `status` + `summary` (and sometimes `wake_id`);
  // the summary is status/debug metadata, not an authoritative message body.
  const messageId =
    'message_id' in payload && typeof payload.message_id === 'string'
      ? payload.message_id
      : 'wake_id' in payload && typeof payload.wake_id === 'string'
        ? `asst:${payload.wake_id}`
        : projection.activeTurn?.messageId;

  const body =
    'body' in payload && typeof payload.body === 'string'
      ? payload.body
      : undefined;
  const summary =
    'summary' in payload && typeof payload.summary === 'string'
      ? payload.summary
      : undefined;
  const status =
    'status' in payload && typeof payload.status === 'string'
      ? payload.status
      : undefined;
  const reasonCode =
    'reason_code' in payload && typeof payload.reason_code === 'string'
      ? payload.reason_code
      : undefined;

  if (messageId === undefined) {
    return projection;
  }

  const adoptedMessages = adoptActivityOnlyStreamingPlaceholder(
    projection.messages,
    messageId,
  );

  const messages = finalizeAssistantMessage(
    adoptedMessages,
    messageId,
    event,
    body,
    summary,
    status,
    reasonCode,
    readOptionalInteger(payloadRecord(payload), 'timeout_ms'),
    'wake_id' in payload && typeof payload.wake_id === 'string'
      ? payload.wake_id
      : undefined,
  );

  return { ...projection, messages };
}

function applyAssistantTurnFinished(
  projection: ConversationProjection,
): ConversationProjection {
  if (projection.activeTurn === undefined) {
    return projection;
  }
  return { ...projection, activeTurn: undefined };
}

// ---- tool calls ----

function applyToolCall(
  projection: ConversationProjection,
  event: ChatEvent,
  status: ToolCallProjection['status'],
): ConversationProjection {
  const payload = payloadRecord(event.payload);

  // Prefer the stable tool identity when present. Older live Crew events did
  // not carry `tool_call_id` but did carry per-call debug detail ids; using
  // `wake_id` too early collapsed every tool in a wake into one block.
  const toolCallId = readToolCallIdentity(payload);
  const toolName = readOptionalString(payload, 'tool_name');
  if (toolCallId === undefined || toolName === undefined) {
    return projection;
  }

  const summary = readOptionalString(payload, 'summary') ?? toolName;

  // A completed event carrying is_error is really a failure.
  const isError = readPayloadBoolean(payload, 'is_error');
  const effectiveStatus: ToolCallProjection['status'] =
    status === 'completed' && isError ? 'failed' : status;

  const reasonCode =
    readOptionalString(payload, 'reason_code') ??
    (effectiveStatus === 'failed' ? 'error' : undefined);
  const debugDetailId = readToolCallDebugDetailId(payload);

  const resultRef = payload['result_ref'];
  const entry: ToolCallProjection = {
    toolCallId,
    toolName,
    summary,
    status: effectiveStatus,
    resultRef: isPayloadObject(resultRef) ? resultRef : undefined,
    reasonCode,
    debugDetailId,
    eventId: event.event_id,
    createdAt: event.created_at,
  };

  // Upsert: replace if a tool_call_id already exists, otherwise append.
  const existing = projection.toolCalls.findIndex(
    (tc) => tc.toolCallId === entry.toolCallId,
  );
  const toolCalls =
    existing >= 0
      ? projection.toolCalls.map((tc, i) => (i === existing ? entry : tc))
      : [...projection.toolCalls, entry];

  // Also surface the tool activity inline in the transcript as a collapsible
  // block on the active assistant message, upserted by id so the started →
  // completed/failed transition updates one block in place.
  const meta: ToolBlockMeta = {
    name: toolName,
    status: effectiveStatus === 'started' ? 'running' : effectiveStatus,
    summary,
    reasonCode,
    debugDetailId,
  };
  const messages = upsertActivityBlock(
    { ...projection, toolCalls },
    event,
    `tool-${toolCallId}`,
    'tool_call',
    toolResultDetail(payload, effectiveStatus),
    meta,
  );

  return { ...projection, toolCalls, messages };
}

// ---- commands ----

function applyCommand(
  projection: ConversationProjection,
  event: ChatEvent,
  status: CommandProjection['status'],
): ConversationProjection {
  const payload = payloadRecord(event.payload);
  const commandName = readOptionalString(payload, 'command_name');
  const summary = readOptionalString(payload, 'summary');
  if (
    commandName === undefined ||
    summary === undefined ||
    !('status' in payload)
  ) {
    return projection;
  }

  const entry: CommandProjection = {
    commandName,
    summary,
    status,
    oldSessionId: readOptionalString(payload, 'old_session_id'),
    newSessionId: readOptionalString(payload, 'new_session_id'),
    reasonCode: readOptionalString(payload, 'reason_code'),
    eventId: event.event_id,
    createdAt: event.created_at,
  };

  // The collection is an append-only event log; the inline block (below) is
  // upserted by command name so its started → completed/failed updates in place.
  const commands = [...projection.commands, entry];

  const meta: ToolBlockMeta = {
    name: entry.commandName,
    status: status === 'started' ? 'running' : status,
    summary: entry.summary,
    reasonCode: entry.reasonCode,
    debugDetailId: undefined,
  };
  const messages = upsertActivityBlock(
    { ...projection, commands },
    event,
    `cmd-${entry.commandName}`,
    'command',
    entry.reasonCode ?? '',
    meta,
  );

  return { ...projection, commands, messages };
}

// ---- stream error ----

function applyStreamError(
  projection: ConversationProjection,
  event: ChatEvent,
): ConversationProjection {
  const payload = payloadRecord(event.payload);
  const message = readOptionalString(payload, 'message');
  if (message === undefined || !('retryable' in payload)) {
    return projection;
  }

  const errorState: StreamErrorState = {
    message,
    reasonCode: readOptionalString(payload, 'reason_code'),
    retryable: readPayloadBoolean(payload, 'retryable'),
    eventId: event.event_id,
  };

  return { ...projection, streamError: errorState };
}

// ---- context strategy / compaction status ----

const CONTEXT_ESTIMATE_QUALITIES: readonly ContextEstimateQuality[] = [
  'exact',
  'approximate',
  'unavailable',
];

function readContextEstimateQuality(
  value: unknown,
): ContextEstimateQuality | undefined {
  return typeof value === 'string' &&
    (CONTEXT_ESTIMATE_QUALITIES as readonly string[]).includes(value)
    ? (value as ContextEstimateQuality)
    : undefined;
}

function readOptionalString(
  payload: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = payload[field];
  return typeof value === 'string' ? value : undefined;
}

function readOptionalInteger(
  payload: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = payload[field];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function readPayloadBoolean(
  payload: Record<string, unknown>,
  field: string,
): boolean {
  return payload[field] === true;
}

function readToolCallDebugDetailId(
  payload: Record<string, unknown>,
): string | undefined {
  const direct = readOptionalString(payload, 'debug_detail_id');
  if (direct !== undefined) return direct;

  const metadata = payload['metadata'];
  if (!isPayloadObject(metadata)) return undefined;
  return readOptionalString(metadata, 'debugDetailId');
}

function readToolCallIdentity(
  payload: Record<string, unknown>,
): string | undefined {
  return (
    readOptionalString(payload, 'tool_call_id') ??
    readToolCallDebugDetailId(payload) ??
    readOptionalString(payload, 'wake_id')
  );
}

function isPayloadObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * View an event payload as a plain record. `ChatEventPayload` is a wide oneOf
 * whose newer members (message slots/variants, conversation tree, attachments,
 * data-bank scopes) carry `[key: string]: unknown` index signatures. Reading
 * documented fields through a record view keeps field narrowing robust and
 * tolerates the live backend's contract drift, instead of fighting the union's
 * polluted `in`-narrowing. Transport guarantees the payload is a JSON object, so
 * this widening cast is safe at the domain boundary.
 */
function payloadRecord(payload: ChatEvent['payload']): Record<string, unknown> {
  return payload as Record<string, unknown>;
}

/**
 * Project a `context_*` event into a {@link ContextTimelineEntry} and append it
 * to the context timeline. The payload is the browser-safe `ContextDebugPayload`
 * (metadata only — no summary text, no secrets). Entries render as UI/debug
 * status rows and are never folded into assistant messages.
 */
function applyContextEvent(
  projection: ConversationProjection,
  event: ChatEvent,
  kind: ContextTimelineKind,
): ConversationProjection {
  const payload = payloadRecord(event.payload);

  const entry: ContextTimelineEntry = {
    id: event.event_id,
    kind,
    sessionId: readOptionalString(payload, 'session_id') ?? event.session_id,
    wakeId: readOptionalString(payload, 'wake_id'),
    strategyId: readOptionalString(payload, 'strategy_id') ?? '',
    estimateQuality: readContextEstimateQuality(payload['estimate_quality']),
    fillPercent: readOptionalInteger(payload, 'fill_percent'),
    compactAtPercent: readOptionalInteger(payload, 'compact_at_percent'),
    targetPercentAfterCompaction: readOptionalInteger(
      payload,
      'target_percent_after_compaction',
    ),
    artifactId: readOptionalString(payload, 'artifact_id'),
    reasonCode: readOptionalString(payload, 'reason_code'),
    createdAt: event.created_at,
  };

  return {
    ...projection,
    contextTimeline: [...projection.contextTimeline, entry],
    contextStatus: entry,
  };
}

// ---- unknown ----

function applyUnknown(
  projection: ConversationProjection,
  event: ChatEvent,
): ConversationProjection {
  return { ...projection, unknownEvents: [...projection.unknownEvents, event] };
}

// ---- helpers ----

function messageExists(
  projection: ConversationProjection,
  messageId: string,
): boolean {
  return projection.messages.some((msg) => msg.id === messageId);
}

function buildMessage(
  id: string,
  sessionId: string,
  role: MessageRole,
  createdAt: string,
  status: ChatMessage['status'],
  blockSpecs: ReadonlyArray<{ kind: MessageBlock['kind']; content: string }>,
): ChatMessage {
  const author: MessageAuthor = { role, displayName: undefined };
  const blocks: MessageBlock[] = blockSpecs.map((spec, index) => ({
    id: `${id}-block-${index}`,
    messageId: id,
    kind: spec.kind,
    content: spec.content,
    estimatedHeight: undefined,
    renderPolicy: spec.kind === 'text' ? 'full' : 'collapsed',
  }));

  return { id, sessionId, author, createdAt, status, blocks };
}

function upsertStreamingDelta(
  messages: readonly ChatMessage[],
  messageId: string,
  event: ChatEvent,
  delta: string,
): readonly ChatMessage[] {
  const existingIndex = messages.findIndex((msg) => msg.id === messageId);
  if (existingIndex >= 0) {
    return messages.map((msg, i) => {
      if (i !== existingIndex) return msg;
      const textBlock = findOrCreateTextBlock(msg, delta);
      return { ...msg, blocks: replaceBlock(msg.blocks, textBlock) };
    });
  }

  // Create a new streaming assistant message.
  const message = buildMessage(
    messageId,
    event.session_id,
    'assistant',
    event.created_at,
    'streaming',
    [{ kind: 'text', content: delta }],
  );
  return [...messages, message];
}

function upsertReasoningDelta(
  messages: readonly ChatMessage[],
  messageId: string,
  event: ChatEvent,
  delta: string,
): readonly ChatMessage[] {
  const existingIndex = messages.findIndex((msg) => msg.id === messageId);
  if (existingIndex >= 0) {
    return messages.map((msg, i) => {
      if (i !== existingIndex) return msg;
      const reasoningBlock = findOrCreateReasoningBlock(msg, delta);
      return { ...msg, blocks: replaceBlock(msg.blocks, reasoningBlock) };
    });
  }

  // Reasoning arrived before any answer text — create the streaming assistant
  // message to host it.
  const message = buildMessage(
    messageId,
    event.session_id,
    'assistant',
    event.created_at,
    'streaming',
    [{ kind: 'reasoning', content: delta }],
  );
  return [...messages, message];
}

function findOrCreateReasoningBlock(
  message: ChatMessage,
  delta: string,
): MessageBlock {
  // Append to the current reasoning segment — the LAST block, if it is a
  // reasoning block. When other content (text/tool) intervened, start a fresh
  // reasoning segment so blocks stay in chronological order.
  const last = message.blocks[message.blocks.length - 1];
  if (last !== undefined && last.kind === 'reasoning') {
    return { ...last, content: last.content + delta };
  }
  return makeReasoningBlock(message.id, message.blocks.length, delta);
}

function makeReasoningBlock(
  messageId: string,
  index: number,
  content: string,
): MessageBlock {
  return {
    id: `${messageId}-reasoning-${index}`,
    messageId,
    kind: 'reasoning',
    content,
    estimatedHeight: undefined,
    renderPolicy: 'collapsed',
  };
}

function findOrCreateTextBlock(
  message: ChatMessage,
  delta: string,
): MessageBlock {
  // Append to the current text segment — the LAST block, if it is text. When the
  // last block is a tool/command block (activity occurred mid-turn), start a new
  // text segment so text and tool blocks interleave in chronological order.
  const last = message.blocks[message.blocks.length - 1];
  if (last !== undefined && last.kind === 'text') {
    return { ...last, content: last.content + delta };
  }
  return makeTextBlock(message.id, message.blocks.length, delta);
}

function makeTextBlock(
  messageId: string,
  index: number,
  content: string,
): MessageBlock {
  return {
    id: `${messageId}-text-${index}`,
    messageId,
    kind: 'text',
    content,
    estimatedHeight: undefined,
    renderPolicy: 'full',
  };
}

function replaceBlock(
  blocks: readonly MessageBlock[],
  replacement: MessageBlock,
): MessageBlock[] {
  const index = blocks.findIndex((b) => b.id === replacement.id);
  if (index >= 0) {
    return blocks.map((b, i) => (i === index ? replacement : b));
  }
  return [...blocks, replacement];
}

/** Serialize the detail/result content shown (collapsed) in a tool block. */
function toolResultDetail(
  payload: Record<string, unknown>,
  status: ToolCallProjection['status'],
): string {
  if (status === 'failed') {
    return readOptionalString(payload, 'reason_code') ?? '';
  }
  const resultRef = payload['result_ref'];
  if (isPayloadObject(resultRef)) {
    try {
      return JSON.stringify(resultRef, null, 2);
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Resolve the assistant message that tool/command blocks attach to: the active
 * turn's message, else the most recent streaming assistant message, else a new
 * streaming assistant message created to host the activity.
 */
function resolveActiveAssistantMessage(
  projection: ConversationProjection,
  event: ChatEvent,
): { messages: readonly ChatMessage[]; messageId: string } {
  const turnId = projection.activeTurn?.messageId;
  if (turnId !== undefined && messageExists(projection, turnId)) {
    return { messages: projection.messages, messageId: turnId };
  }
  const streaming = findLastStreamingAssistant(projection.messages);
  if (streaming !== undefined) {
    return { messages: projection.messages, messageId: streaming };
  }
  const messageId = turnId ?? `asst:${event.event_id}`;
  const message = buildMessage(
    messageId,
    event.session_id,
    'assistant',
    event.created_at,
    'streaming',
    [],
  );
  return { messages: [...projection.messages, message], messageId };
}

function findLastStreamingAssistant(
  messages: readonly ChatMessage[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (
      message !== undefined &&
      message.author.role === 'assistant' &&
      message.status === 'streaming'
    ) {
      return message.id;
    }
  }
  return undefined;
}

function adoptActivityOnlyStreamingPlaceholder(
  messages: readonly ChatMessage[],
  realMessageId: string,
): readonly ChatMessage[] {
  if (messages.some((message) => message.id === realMessageId)) {
    return mergeActivityOnlyPlaceholderIntoExistingMessage(
      messages,
      realMessageId,
    );
  }

  const placeholderIndex =
    findLastActivityOnlyStreamingAssistantIndex(messages);
  if (placeholderIndex < 0) {
    return messages;
  }

  return messages.map((message, index) => {
    if (index !== placeholderIndex) {
      return message;
    }
    return {
      ...message,
      id: realMessageId,
      blocks: message.blocks.map((block) => ({
        ...block,
        messageId: realMessageId,
      })),
    };
  });
}

function mergeActivityOnlyPlaceholderIntoExistingMessage(
  messages: readonly ChatMessage[],
  realMessageId: string,
): readonly ChatMessage[] {
  const placeholderIndex =
    findLastActivityOnlyStreamingAssistantIndex(messages);
  if (placeholderIndex < 0) {
    return messages;
  }

  const placeholder = messages[placeholderIndex];
  if (placeholder === undefined || placeholder.id === realMessageId) {
    return messages;
  }

  const realIndex = messages.findIndex(
    (message) => message.id === realMessageId,
  );
  if (realIndex < 0) {
    return messages;
  }

  const adoptedBlocks = placeholder.blocks.map((block) => ({
    ...block,
    messageId: realMessageId,
  }));

  return messages
    .filter((_, index) => index !== placeholderIndex)
    .map((message) =>
      message.id === realMessageId
        ? { ...message, blocks: [...adoptedBlocks, ...message.blocks] }
        : message,
    );
}

function findLastActivityOnlyStreamingAssistantIndex(
  messages: readonly ChatMessage[],
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (
      message !== undefined &&
      message.author.role === 'assistant' &&
      message.status === 'streaming' &&
      message.blocks.length > 0 &&
      message.blocks.every(isActivityBlock)
    ) {
      return i;
    }
  }
  return -1;
}

function isActivityBlock(block: MessageBlock): boolean {
  return block.kind === 'tool_call' || block.kind === 'command';
}

/**
 * Upsert a tool_call/command block (by stable id) onto the active assistant
 * message, so started → completed/failed updates one block in place and the
 * renderer keeps its collapse state stable.
 */
function upsertActivityBlock(
  projection: ConversationProjection,
  event: ChatEvent,
  blockId: string,
  kind: 'tool_call' | 'command',
  content: string,
  tool: ToolBlockMeta,
): readonly ChatMessage[] {
  const { messages, messageId } = resolveActiveAssistantMessage(
    projection,
    event,
  );
  const index = messages.findIndex((msg) => msg.id === messageId);
  if (index < 0) {
    return messages;
  }
  return messages.map((msg, i) => {
    if (i !== index) return msg;
    const block: MessageBlock = {
      id: blockId,
      messageId,
      kind,
      content,
      estimatedHeight: undefined,
      renderPolicy: 'collapsed',
      tool,
    };
    return { ...msg, blocks: replaceBlock(msg.blocks, block) };
  });
}

function finalizeAssistantMessage(
  messages: readonly ChatMessage[],
  messageId: string,
  event: ChatEvent,
  body: string | undefined,
  summary: string | undefined,
  status: string | undefined,
  reasonCode: string | undefined,
  timeoutMs: number | undefined,
  wakeId: string | undefined,
): readonly ChatMessage[] {
  const wakeTimeout = status === 'failed' && reasonCode === 'wake_timeout';
  const existingIndex = messages.findIndex((msg) => msg.id === messageId);
  if (existingIndex >= 0) {
    return messages.map((msg, i) => {
      if (i !== existingIndex) return msg;
      if (wakeTimeout) {
        return addWakeTimeoutNotice(msg, event, summary, timeoutMs, wakeId);
      }
      const textBlocks = msg.blocks.filter((b) => b.kind === 'text');
      if (textBlocks.length === 1) {
        if (body === undefined) {
          // Summary-only terminal events are status/debug metadata. Preserve the
          // accumulated deltas instead of replacing the answer with the summary.
          return { ...msg, status: 'completed' as const };
        }
        // No tool interleaving and an explicit final body — replace the single
        // text block with the authoritative final body (deltas may be lossy).
        const blocks = msg.blocks.map((b) =>
          b.kind === 'text' ? { ...b, content: body } : b,
        );
        return { ...msg, status: 'completed' as const, blocks };
      }
      if (textBlocks.length === 0) {
        const content = body ?? summary;
        if (content === undefined || content === '') {
          return { ...msg, status: 'completed' as const };
        }
        // Completed with no streamed text — attach available terminal text.
        const block = makeTextBlock(msg.id, msg.blocks.length, content);
        return {
          ...msg,
          status: 'completed' as const,
          blocks: [...msg.blocks, block],
        };
      }
      // Multiple text segments interleaved with tool blocks — the streamed
      // segments already carry the text in order; just mark completed.
      return { ...msg, status: 'completed' as const };
    });
  }

  // Message not seen during streaming — create it as completed.
  const content = body ?? summary;
  if (wakeTimeout) {
    const message = buildMessage(
      messageId,
      event.session_id,
      'assistant',
      event.created_at,
      'error',
      [],
    );
    return [
      ...messages,
      addWakeTimeoutNotice(message, event, summary, timeoutMs, wakeId),
    ];
  }
  if (content === undefined || content === '') {
    return messages;
  }
  const message = buildMessage(
    messageId,
    event.session_id,
    'assistant',
    event.created_at,
    'completed',
    [{ kind: 'text', content }],
  );
  return [...messages, message];
}

function addWakeTimeoutNotice(
  message: ChatMessage,
  event: ChatEvent,
  summary: string | undefined,
  timeoutMs: number | undefined,
  wakeId: string | undefined,
): ChatMessage {
  const content =
    summary ??
    `Service turn cap reached${timeoutMs === undefined ? '' : ` after ${timeoutMs} ms`}.`;
  const block: MessageBlock = {
    id: `${message.id}-wake-timeout-${event.event_id}`,
    messageId: message.id,
    kind: 'service_notice',
    content,
    estimatedHeight: undefined,
    renderPolicy: 'full',
    metadata: {
      reasonCode: 'wake_timeout',
      wakeId,
      timeoutMs,
    },
  };
  return {
    ...message,
    status: 'error',
    blocks: [...message.blocks, block],
  };
}

function updateActiveTurnForDelta(
  activeTurn: ActiveAssistantTurn | undefined,
  messageId: string,
  delta: string,
): ActiveAssistantTurn | undefined {
  if (activeTurn === undefined) {
    // No turn was started — create a minimal one from the delta.
    return {
      startedAt: new Date(0).toISOString(),
      messageId,
      streamingText: delta,
    };
  }
  return {
    ...activeTurn,
    messageId,
    streamingText: activeTurn.streamingText + delta,
  };
}

function updateActiveTurnForReasoning(
  activeTurn: ActiveAssistantTurn | undefined,
  messageId: string,
  event: ChatEvent,
): ActiveAssistantTurn {
  if (activeTurn === undefined) {
    // Reasoning began the turn — start a minimal one. No streamingText yet:
    // reasoning is tracked in its own block, not the visible answer text.
    return { startedAt: event.created_at, messageId, streamingText: '' };
  }
  // Adopt the message id if the turn didn't have one yet; otherwise leave the
  // turn (and its streamingText) untouched.
  return activeTurn.messageId === undefined
    ? { ...activeTurn, messageId }
    : activeTurn;
}
