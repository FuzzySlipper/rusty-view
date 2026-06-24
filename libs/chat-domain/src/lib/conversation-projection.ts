import type { ChatEvent } from '@rusty-view/protocol';

import {
  emptyProjection,
  type ActiveAssistantTurn,
  type ChatMessage,
  type CommandProjection,
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
  const payload = event.payload;
  if ('session' in payload) {
    return { ...projection, sessionMetadata: payload.session };
  }
  return projection;
}

// ---- message created ----

function applyMessageCreated(
  projection: ConversationProjection,
  event: ChatEvent,
): ConversationProjection {
  const payload = event.payload;
  if (
    !('message_id' in payload) ||
    !('role' in payload) ||
    !('body' in payload)
  ) {
    return projection;
  }

  const messageId = payload.message_id;
  if (messageExists(projection, messageId)) {
    return projection; // dedup: already have this message
  }

  const message = buildMessage(
    messageId,
    event.session_id,
    payload.role,
    event.created_at,
    'completed',
    [{ kind: 'text', content: payload.body }],
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
  const payload = event.payload;

  // The OpenAPI contract specifies `message_id` and `delta` fields, but the
  // live backend currently emits `wake_id` (or sometimes `message_id`) and
  // `text` for the delta content. Accept both shapes to handle contract drift.
  const messageId =
    'message_id' in payload && typeof payload.message_id === 'string'
      ? payload.message_id
      : 'wake_id' in payload && typeof payload.wake_id === 'string'
        ? `asst:${payload.wake_id}`
        : undefined;

  const delta =
    'delta' in payload && typeof payload.delta === 'string'
      ? payload.delta
      : 'text' in payload && typeof payload.text === 'string'
        ? payload.text
        : undefined;

  if (messageId === undefined || delta === undefined) {
    return projection;
  }

  // Update or create the streaming message.
  const messages = upsertStreamingDelta(
    projection.messages,
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

function applyAssistantMessageCompleted(
  projection: ConversationProjection,
  event: ChatEvent,
): ConversationProjection {
  const payload = event.payload;

  // The OpenAPI contract specifies `message_id` and `body`, but the live backend
  // emits `status` + `summary` (and sometimes `wake_id`) with no `message_id`.
  // Accept both shapes.
  const messageId =
    'message_id' in payload && typeof payload.message_id === 'string'
      ? payload.message_id
      : 'wake_id' in payload && typeof payload.wake_id === 'string'
        ? `asst:${payload.wake_id}`
        : projection.activeTurn?.messageId;

  const body =
    'body' in payload && typeof payload.body === 'string'
      ? payload.body
      : 'summary' in payload && typeof payload.summary === 'string'
        ? payload.summary
        : undefined;

  if (messageId === undefined || body === undefined) {
    return projection;
  }

  const messages = finalizeAssistantMessage(
    projection.messages,
    messageId,
    event,
    body,
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
  const payload = event.payload;

  // The OpenAPI contract specifies `tool_call_id`, `tool_name`, `summary` (and
  // `result_ref`/`reason_code`). The live backend instead keys tool calls by
  // `wake_id`, omits `summary`, and signals failure via `is_error` on the
  // completed event (no separate tool_call_failed/result_ref). Accept both.
  const toolCallId =
    'tool_call_id' in payload && typeof payload.tool_call_id === 'string'
      ? payload.tool_call_id
      : 'wake_id' in payload && typeof payload.wake_id === 'string'
        ? payload.wake_id
        : undefined;
  const toolName =
    'tool_name' in payload && typeof payload.tool_name === 'string'
      ? payload.tool_name
      : undefined;
  if (toolCallId === undefined || toolName === undefined) {
    return projection;
  }

  const summary =
    'summary' in payload && typeof payload.summary === 'string'
      ? payload.summary
      : toolName;

  // A completed event carrying is_error is really a failure.
  const isError = 'is_error' in payload && payload.is_error === true;
  const effectiveStatus: ToolCallProjection['status'] =
    status === 'completed' && isError ? 'failed' : status;

  const reasonCode =
    'reason_code' in payload && typeof payload.reason_code === 'string'
      ? payload.reason_code
      : effectiveStatus === 'failed'
        ? 'error'
        : undefined;

  const entry: ToolCallProjection = {
    toolCallId,
    toolName,
    summary,
    status: effectiveStatus,
    resultRef: 'result_ref' in payload ? payload.result_ref : undefined,
    reasonCode,
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
  const payload = event.payload;
  if (
    !('command_name' in payload) ||
    !('summary' in payload) ||
    !('status' in payload)
  ) {
    return projection;
  }

  const entry: CommandProjection = {
    commandName: payload.command_name,
    summary: payload.summary,
    status,
    oldSessionId:
      'old_session_id' in payload ? payload.old_session_id : undefined,
    newSessionId:
      'new_session_id' in payload ? payload.new_session_id : undefined,
    reasonCode: 'reason_code' in payload ? payload.reason_code : undefined,
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
  const payload = event.payload;
  if (!('message' in payload) || !('retryable' in payload)) {
    return projection;
  }

  const errorState: StreamErrorState = {
    message: payload.message,
    reasonCode: 'reason_code' in payload ? payload.reason_code : undefined,
    retryable: payload.retryable,
    eventId: event.event_id,
  };

  return { ...projection, streamError: errorState };
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
  payload: ChatEvent['payload'],
  status: ToolCallProjection['status'],
): string {
  if (status === 'failed') {
    return 'reason_code' in payload && typeof payload.reason_code === 'string'
      ? payload.reason_code
      : '';
  }
  if ('result_ref' in payload && payload.result_ref) {
    try {
      return JSON.stringify(payload.result_ref, null, 2);
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
  body: string,
): readonly ChatMessage[] {
  const existingIndex = messages.findIndex((msg) => msg.id === messageId);
  if (existingIndex >= 0) {
    return messages.map((msg, i) => {
      if (i !== existingIndex) return msg;
      const textBlocks = msg.blocks.filter((b) => b.kind === 'text');
      if (textBlocks.length === 1) {
        // No tool interleaving — replace the single text block with the
        // authoritative final body (deltas may have been lossy).
        const blocks = msg.blocks.map((b) =>
          b.kind === 'text' ? { ...b, content: body } : b,
        );
        return { ...msg, status: 'completed' as const, blocks };
      }
      if (textBlocks.length === 0) {
        // Completed with no streamed text — attach the body as a text block.
        const block = makeTextBlock(msg.id, msg.blocks.length, body);
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
  const message = buildMessage(
    messageId,
    event.session_id,
    'assistant',
    event.created_at,
    'completed',
    [{ kind: 'text', content: body }],
  );
  return [...messages, message];
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
