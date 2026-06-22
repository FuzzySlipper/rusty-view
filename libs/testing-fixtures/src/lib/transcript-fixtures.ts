import type { ChatEvent } from '@rusty-view/protocol';

/**
 * Large transcript event generators for torture-testing the transcript renderer
 * and projection reducer. These generate events programmatically to avoid
 * checking megabytes of static JSON.
 */

let transcriptSeq = 0;

function resetSeq(): void {
  transcriptSeq = 0;
}

function nextEventId(): string {
  transcriptSeq += 1;
  return `evt_${transcriptSeq}`;
}

function nextSeqId(): number {
  return transcriptSeq;
}

/**
 * Generate `count` alternating user/assistant message events.
 * Each pair is: user message_created → assistant turn (delta + completed).
 * Produces approximately `count` events (3 per pair + turn lifecycle).
 */
export function generateTranscriptEvents(count: number): ChatEvent[] {
  resetSeq();
  const events: ChatEvent[] = [];
  const sessionId = 'sess_large';
  const pairs = Math.ceil(count / 3);

  for (let i = 0; i < pairs; i++) {
    const userMsgId = `msg_u_${i}`;
    const asstMsgId = `msg_a_${i}`;
    const timestamp = `2026-06-22T${String(10 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`;

    events.push({
      event_id: nextEventId(),
      session_id: sessionId,
      sequence_id: nextSeqId(),
      created_at: timestamp,
      kind: 'message_created',
      payload: {
        message_id: userMsgId,
        role: 'user',
        body: `User message number ${i}. This is test content for transcript generation.`,
      },
    });

    events.push({
      event_id: nextEventId(),
      session_id: sessionId,
      sequence_id: nextSeqId(),
      created_at: timestamp,
      kind: 'assistant_turn_started',
      payload: {} as ChatEvent['payload'],
    });

    events.push({
      event_id: nextEventId(),
      session_id: sessionId,
      sequence_id: nextSeqId(),
      created_at: timestamp,
      kind: 'assistant_text_delta',
      payload: {
        message_id: asstMsgId,
        coalesced: false,
        delta: `Assistant response ${i}. The narrative continues with evocative prose.`,
      },
    });

    events.push({
      event_id: nextEventId(),
      session_id: sessionId,
      sequence_id: nextSeqId(),
      created_at: timestamp,
      kind: 'assistant_message_completed',
      payload: {
        message_id: asstMsgId,
        body: `Assistant response ${i}. The narrative continues with evocative prose.`,
      },
    });

    events.push({
      event_id: nextEventId(),
      session_id: sessionId,
      sequence_id: nextSeqId(),
      created_at: timestamp,
      kind: 'assistant_turn_finished',
      payload: {} as ChatEvent['payload'],
    });

    if (events.length >= count) break;
  }

  return events;
}

/**
 * Generate a single very long assistant message via many small deltas.
 * Useful for testing the renderer's handling of long individual messages.
 */
export function generateLongMessageEvents(
  messageId: string,
  deltaCount: number,
  deltaSize: number,
): ChatEvent[] {
  resetSeq();
  const events: ChatEvent[] = [];
  const sessionId = 'sess_long_msg';
  const token = 'lorem ipsum dolor sit amet ';

  events.push({
    event_id: nextEventId(),
    session_id: sessionId,
    sequence_id: nextSeqId(),
    created_at: '2026-06-22T10:00:00Z',
    kind: 'assistant_turn_started',
    payload: {} as ChatEvent['payload'],
  });

  let fullBody = '';
  for (let i = 0; i < deltaCount; i++) {
    let delta = '';
    while (delta.length < deltaSize) {
      delta += token;
    }
    delta = delta.slice(0, deltaSize);
    fullBody += delta;

    events.push({
      event_id: nextEventId(),
      session_id: sessionId,
      sequence_id: nextSeqId(),
      created_at: '2026-06-22T10:00:00Z',
      kind: 'assistant_text_delta',
      payload: { message_id: messageId, delta, coalesced: false },
    });
  }

  events.push({
    event_id: nextEventId(),
    session_id: sessionId,
    sequence_id: nextSeqId(),
    created_at: '2026-06-22T10:00:00Z',
    kind: 'assistant_message_completed',
    payload: { message_id: messageId, body: fullBody },
  });

  events.push({
    event_id: nextEventId(),
    session_id: sessionId,
    sequence_id: nextSeqId(),
    created_at: '2026-06-22T10:00:00Z',
    kind: 'assistant_turn_finished',
    payload: {} as ChatEvent['payload'],
  });

  return events;
}

/** Pre-built 10k+ event transcript (generated lazily on first access). */
let cachedLargeTranscript: ChatEvent[] | undefined;

export function getLargeTranscript(): ChatEvent[] {
  if (cachedLargeTranscript === undefined) {
    cachedLargeTranscript = generateTranscriptEvents(10_000);
  }
  return cachedLargeTranscript;
}
