import type {
  ChatEvent,
  ChatEventPayload,
  ChatEventKind,
} from '@rusty-view/protocol';

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
      return applyAssistantTurnFinished(withCursor, event);
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
  if (!('message_id' in payload) || !('delta' in payload)) {
    return projection;
  }

  const messageId = payload.message_id;
  const delta = payload.delta;

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
  if (!('message_id' in payload) || !('body' in payload)) {
    return projection;
  }

  const messageId = payload.message_id;
  const body = payload.body;

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
  _event: ChatEvent,
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
  if (
    !('tool_call_id' in payload) ||
    !('tool_name' in payload) ||
    !('summary' in payload)
  ) {
    return projection;
  }

  const entry: ToolCallProjection = {
    toolCallId: payload.tool_call_id,
    toolName: payload.tool_name,
    summary: payload.summary,
    status,
    resultRef: 'result_ref' in payload ? payload.result_ref : undefined,
    reasonCode: 'reason_code' in payload ? payload.reason_code : undefined,
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

  return { ...projection, toolCalls };
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

  return { ...projection, commands: [...projection.commands, entry] };
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
  const existing = message.blocks.find((b) => b.kind === 'text');
  if (existing) {
    return { ...existing, content: existing.content + delta };
  }
  return {
    id: `${message.id}-block-text`,
    messageId: message.id,
    kind: 'text',
    content: delta,
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
      // Replace text content with authoritative final body.
      const blocks = msg.blocks.map((b) =>
        b.kind === 'text' ? { ...b, content: body } : b,
      );
      return { ...msg, status: 'completed' as const, blocks };
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
