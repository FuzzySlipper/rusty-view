import type { ChatEvent } from '@rusty-view/protocol';

/**
 * Streaming and reconnect fixtures for testing cursor resume, dedup, and
 * out-of-order event handling.
 */

let streamSeq = 0;

function nextId(): string {
  streamSeq += 1;
  return `evt_stream_${streamSeq}`;
}

/**
 * Generate a complete assistant streaming turn with `deltaCount` text deltas.
 * Events: turn_started → N deltas → message_completed → turn_finished.
 */
export function generateStreamingTurn(
  messageId: string,
  deltaCount: number,
): ChatEvent[] {
  streamSeq = 0;
  const events: ChatEvent[] = [];
  const sessionId = 'sess_stream';

  events.push({
    event_id: nextId(),
    session_id: sessionId,
    sequence_id: 1,
    created_at: '2026-06-22T10:00:00Z',
    kind: 'assistant_turn_started',
    payload: {} as ChatEvent['payload'],
  });

  for (let i = 0; i < deltaCount; i++) {
    events.push({
      event_id: nextId(),
      session_id: sessionId,
      sequence_id: i + 2,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'assistant_text_delta',
      payload: {
        message_id: messageId,
        delta: `delta_${i} `,
        coalesced: false,
      },
    });
  }

  const fullBody = Array.from(
    { length: deltaCount },
    (_, i) => `delta_${i} `,
  ).join('');

  events.push({
    event_id: nextId(),
    session_id: sessionId,
    sequence_id: deltaCount + 2,
    created_at: '2026-06-22T10:00:00Z',
    kind: 'assistant_message_completed',
    payload: { message_id: messageId, body: fullBody },
  });

  events.push({
    event_id: nextId(),
    session_id: sessionId,
    sequence_id: deltaCount + 3,
    created_at: '2026-06-22T10:00:00Z',
    kind: 'assistant_turn_finished',
    payload: {} as ChatEvent['payload'],
  });

  return events;
}

/**
 * Split events into two batches simulating a disconnect/reconnect scenario.
 * The first batch is events[0..splitPoint), the second is events[splitPoint..].
 * Both batches have the same session_id so the store can project them
 * incrementally.
 */
export function generateReconnectBatches(
  events: readonly ChatEvent[],
  splitPoint: number,
): { firstBatch: ChatEvent[]; secondBatch: ChatEvent[] } {
  const safeSplit = Math.min(Math.max(splitPoint, 0), events.length);
  return {
    firstBatch: events.slice(0, safeSplit),
    secondBatch: events.slice(safeSplit),
  };
}

/**
 * Return the same event twice (same event_id and sequence_id) to simulate
 * duplicate replay after reconnect. The projection reducer must dedup by
 * message_id (for messages) and tolerate re-application of idempotent events.
 */
export function generateDuplicateEvents(event: ChatEvent): ChatEvent[] {
  return [event, { ...event }];
}

/**
 * Return events with sequence_ids shuffled to simulate out-of-order delivery.
 * The projection reducer should handle this gracefully — events are applied in
 * the order received, and the cursor tracks the last event_id regardless of
 * sequence_id order.
 */
export function generateOutOfOrderEvents(
  events: readonly ChatEvent[],
): ChatEvent[] {
  const shuffled = [...events];
  // Simple reverse — deterministic "out of order" without randomness.
  shuffled.reverse();
  return shuffled;
}

/**
 * Generate a batch of mixed-content events (text, tool calls, commands, debug)
 * for testing the renderer's mixed-block rendering.
 */
export function generateMixedContentEvents(): ChatEvent[] {
  streamSeq = 100;
  return [
    {
      event_id: nextId(),
      session_id: 'sess_mixed',
      sequence_id: 1,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'message_created',
      payload: {
        message_id: 'mix_u1',
        role: 'user',
        body: 'Search for the amber lantern.',
      },
    },
    {
      event_id: nextId(),
      session_id: 'sess_mixed',
      sequence_id: 2,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'tool_call_started',
      payload: {
        tool_call_id: 'mix_tc1',
        tool_name: 'search_lore',
        summary: 'Searching lore for "amber lantern"',
        status: 'started',
      },
    },
    {
      event_id: nextId(),
      session_id: 'sess_mixed',
      sequence_id: 3,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'tool_call_completed',
      payload: {
        tool_call_id: 'mix_tc1',
        tool_name: 'search_lore',
        summary: 'Found 2 entries about the amber lantern.',
        status: 'completed',
      },
    },
    {
      event_id: nextId(),
      session_id: 'sess_mixed',
      sequence_id: 4,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'assistant_text_delta',
      payload: {
        message_id: 'mix_a1',
        delta: 'The amber lantern flickers...',
        coalesced: false,
      },
    },
    {
      event_id: nextId(),
      session_id: 'sess_mixed',
      sequence_id: 5,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'assistant_message_completed',
      payload: {
        message_id: 'mix_a1',
        body: 'The amber lantern flickers in the darkness.',
      },
    },
    {
      event_id: nextId(),
      session_id: 'sess_mixed',
      sequence_id: 6,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'unknown',
      payload: { summary: 'Debug trace attached', raw: { trace_id: 'dbg_42' } },
    },
  ];
}
