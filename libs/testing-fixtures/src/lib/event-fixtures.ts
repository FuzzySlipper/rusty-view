import type { ChatEvent, ChatSessionSummary } from '@rusty-view/protocol';

/**
 * Individual ChatEvent fixtures — one representative event per known kind.
 * Use these for unit tests that need specific event shapes.
 */

let seqCounter = 0;

function nextSeq(): number {
  seqCounter += 1;
  return seqCounter;
}

function makeEvent(
  kind: ChatEvent['kind'],
  payload: ChatEvent['payload'],
  overrides: Partial<ChatEvent> = {},
): ChatEvent {
  return {
    event_id: overrides.event_id ?? `evt_${nextSeq()}`,
    session_id: overrides.session_id ?? 'sess_fixture',
    sequence_id: overrides.sequence_id ?? nextSeq(),
    created_at: overrides.created_at ?? '2026-06-22T10:00:00Z',
    kind,
    payload,
  };
}

export const sessionSnapshotEvent: ChatEvent = makeEvent('session_snapshot', {
  session: {
    session_id: 'sess_fixture',
    agent_id: 'agent_narrator',
    profile_id: 'profile_rp',
    kind: 'full',
    status: 'active',
    execution: {
      sessionId: 'sess_fixture',
      lifecycleStatus: 'live',
      phase: 'active',
      source: 'runtime_activity',
      updatedAt: '2026-06-22T10:00:00Z',
    },
    title: 'Fixture Session',
    latest_cursor: 'cur_0',
    created_at: '2026-06-22T09:00:00Z',
    updated_at: '2026-06-22T10:00:00Z',
    message_count: 0,
    tool_event_count: 0,
  } satisfies ChatSessionSummary,
});

export const sessionExecutionChangedEvent: ChatEvent = makeEvent(
  'session_execution_changed',
  {
    execution: {
      sessionId: 'sess_fixture',
      lifecycleStatus: 'live',
      phase: 'waiting',
      source: 'logical_turn',
      updatedAt: '2026-06-22T10:00:01Z',
    },
  },
);

export const userMessageEvent: ChatEvent = makeEvent('message_created', {
  message_id: 'msg_user_1',
  role: 'user',
  body: 'The door creaks open.',
});

export const assistantTurnStartedEvent: ChatEvent = makeEvent(
  'assistant_turn_started',
  // The contract does not define a dedicated payload for turn lifecycle events.
  {} as ChatEvent['payload'],
);

export const assistantDeltaEvent: ChatEvent = makeEvent(
  'assistant_text_delta',
  {
    message_id: 'msg_asst_1',
    delta: 'A figure steps ',
    coalesced: false,
  },
);

export const assistantReasoningDeltaEvent: ChatEvent = makeEvent(
  'assistant_reasoning_delta',
  {
    wake_id: 'wake_asst_1',
    text: 'The door creaks — I should describe who enters.',
    visibility: 'reasoning',
  },
);

export const phaseChangeEvent: ChatEvent = makeEvent('phase_change', {
  phase: 'exploring',
  message: 'Gathering context',
} as ChatEvent['payload']);

export const providerStatusEvent: ChatEvent = makeEvent('provider_status', {
  level: 'info',
  message: 'provider stream connected',
} as ChatEvent['payload']);

export const assistantMessageCompletedEvent: ChatEvent = makeEvent(
  'assistant_message_completed',
  {
    message_id: 'msg_asst_1',
    body: 'A figure steps through the doorway, silhouetted against the amber light.',
  },
);

export const assistantTurnFinishedEvent: ChatEvent = makeEvent(
  'assistant_turn_finished',
  {} as ChatEvent['payload'],
);

export const toolCallStartedEvent: ChatEvent = makeEvent('tool_call_started', {
  tool_call_id: 'tc_1',
  tool_name: 'search_lore',
  summary: 'Searched lore for "amber lantern"',
  status: 'started',
});

export const toolCallCompletedEvent: ChatEvent = makeEvent(
  'tool_call_completed',
  {
    tool_call_id: 'tc_1',
    tool_name: 'search_lore',
    summary: 'Found 3 lore entries',
    status: 'completed',
  },
);

export const toolCallFailedEvent: ChatEvent = makeEvent('tool_call_failed', {
  tool_call_id: 'tc_2',
  tool_name: 'recall_lore',
  summary: 'Lore service timed out',
  status: 'failed',
  reason_code: 'timeout',
});

export const commandStartedEvent: ChatEvent = makeEvent('command_started', {
  command_name: '/status',
  summary: 'Checking session status',
  status: 'started',
});

export const commandCompletedEvent: ChatEvent = makeEvent('command_completed', {
  command_name: '/status',
  summary: 'Session is active with 12 messages',
  status: 'completed',
});

export const commandFailedEvent: ChatEvent = makeEvent('command_failed', {
  command_name: '/new',
  summary: 'Failed to create new session',
  status: 'failed',
  reason_code: 'internal_error',
});

export const streamErrorEvent: ChatEvent = makeEvent('stream_error', {
  message: 'Connection lost during streaming',
  retryable: true,
  reason_code: 'network',
});

export const unknownKindEvent: ChatEvent = makeEvent('unknown', {
  summary: 'Unrecognized event kind: future_feature',
  raw: { kind: 'future_feature', detail: 'something new' },
});

/**
 * A future-kind event that would have been coerced by transport into 'unknown'.
 * Simulates what the domain receives after transport coercion.
 */
export const coercedFutureKindEvent: ChatEvent = unknownKindEvent;

/** All known event kinds in one array (for exhaustive projection tests). */
export const allKindEvents: readonly ChatEvent[] = Object.freeze([
  sessionSnapshotEvent,
  sessionExecutionChangedEvent,
  userMessageEvent,
  assistantTurnStartedEvent,
  assistantDeltaEvent,
  assistantReasoningDeltaEvent,
  phaseChangeEvent,
  providerStatusEvent,
  assistantMessageCompletedEvent,
  assistantTurnFinishedEvent,
  toolCallStartedEvent,
  toolCallCompletedEvent,
  toolCallFailedEvent,
  commandStartedEvent,
  commandCompletedEvent,
  commandFailedEvent,
  streamErrorEvent,
  unknownKindEvent,
]);
