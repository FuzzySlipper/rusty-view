import { describe, expect, it } from 'vitest';

import { parseChatEvent } from './chat-event-parser';
import { ChatTransportError } from './chat-transport-error';

function chatEventJson(kind: string, payload: unknown): string {
  return JSON.stringify({
    event_id: 'evt_1',
    session_id: 'sess_1',
    sequence_id: 1,
    created_at: '2026-06-22T10:00:00Z',
    kind,
    payload,
  });
}

describe('parseChatEvent', () => {
  it('parses a known message_created event', () => {
    const event = parseChatEvent(
      chatEventJson('message_created', {
        message_id: 'msg_1',
        role: 'user',
        body: 'Hello',
      }),
    );
    expect(event.kind).toBe('message_created');
    expect(event.event_id).toBe('evt_1');
    expect(event.sequence_id).toBe(1);
    if ('body' in event.payload) {
      expect(event.payload.body).toBe('Hello');
    }
  });

  it('parses a tool_call_started event', () => {
    const event = parseChatEvent(
      chatEventJson('tool_call_started', {
        tool_call_id: 'tc_1',
        tool_name: 'search_lore',
        summary: 'Searched for amber',
        status: 'started',
      }),
    );
    expect(event.kind).toBe('tool_call_started');
    if ('tool_call_id' in event.payload) {
      expect(event.payload.tool_name).toBe('search_lore');
    }
  });

  it('recognizes the context_* event kinds (not coerced to unknown)', () => {
    const kinds = [
      'context_status',
      'context_compaction_started',
      'context_compaction_completed',
      'context_compaction_failed',
    ] as const;
    for (const kind of kinds) {
      const event = parseChatEvent(
        chatEventJson(kind, {
          session_id: 'sess_1',
          strategy_id: 'sliding-window',
          fill_percent: 50,
          ui_debug: true,
          model_facing: false,
        }),
      );
      expect(event.kind).toBe(kind);
    }
  });

  it('recognizes every logical-turn lifecycle event', () => {
    const kinds = [
      'logical_turn_admitted',
      'logical_turn_continuing',
      'logical_turn_yielding',
      'logical_turn_queued_to_continue',
      'logical_turn_attention_required',
      'logical_turn_cancelling',
      'logical_turn_completed',
      'logical_turn_cancelled',
      'logical_turn_failed',
    ] as const;
    for (const kind of kinds) {
      expect(
        parseChatEvent(chatEventJson(kind, logicalTurnPayload())).kind,
      ).toBe(kind);
    }
  });

  it('recognizes phase_change and provider_status events as known events', () => {
    const phase = parseChatEvent(
      chatEventJson('phase_change', {
        wake_id: 'wake_1',
        phase: 'exploring',
        message: 'Gathering context',
      }),
    );
    const provider = parseChatEvent(
      chatEventJson('provider_status', {
        wake_id: 'wake_1',
        level: 'info',
        message: 'provider stream connected',
      }),
    );

    expect(phase.kind).toBe('phase_change');
    expect(provider.kind).toBe('provider_status');
  });

  it('passes through an explicit unknown kind event without double-coercing', () => {
    const event = parseChatEvent(
      chatEventJson('unknown', {
        summary: 'Something odd',
        raw: { detail: 42 },
      }),
    );
    expect(event.kind).toBe('unknown');
    if ('raw' in event.payload) {
      expect(event.payload.summary).toBe('Something odd');
      expect(event.payload.raw['detail']).toBe(42);
    }
  });

  it('coerces an unrecognized kind into an unknown event with raw preserved', () => {
    const raw = {
      event_id: 'evt_99',
      session_id: 'sess_1',
      sequence_id: 99,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'future_narrative_branch',
      payload: { branch: 'alpha', detail: 'something' },
    };
    const event = parseChatEvent(JSON.stringify(raw));

    expect(event.kind).toBe('unknown');
    expect(event.event_id).toBe('evt_99');
    expect(event.sequence_id).toBe(99);

    if ('raw' in event.payload) {
      expect(event.payload.summary).toContain('future_narrative_branch');
      // The original event (including its original kind) is preserved under raw.
      expect(event.payload.raw['kind']).toBe('future_narrative_branch');
      expect(event.payload.raw['original_kind']).toBe(
        'future_narrative_branch',
      );
    }
  });

  it('coerces an event missing the kind field', () => {
    const raw = {
      event_id: 'evt_x',
      session_id: 'sess_1',
      sequence_id: 5,
      created_at: '2026-06-22T10:00:00Z',
      payload: { data: 'no kind' },
    };
    const event = parseChatEvent(JSON.stringify(raw));
    expect(event.kind).toBe('unknown');
    if ('raw' in event.payload) {
      expect(event.payload.summary).toContain('missing kind');
    }
  });

  it('provides fallback values for missing base fields in unknown events', () => {
    const event = parseChatEvent(JSON.stringify({ kind: 'bogus' }));
    expect(event.kind).toBe('unknown');
    expect(event.event_id).toMatch(/^unknown-/);
    expect(event.session_id).toBe('');
    expect(event.sequence_id).toBe(0);
  });

  it('throws sse_parse_error on invalid JSON', () => {
    expect(() => parseChatEvent('not json')).toThrow(ChatTransportError);
    expect(() => parseChatEvent('not json')).toThrow(/not valid JSON/);
  });

  it('throws sse_parse_error on non-object JSON', () => {
    expect(() => parseChatEvent('42')).toThrow(/not a JSON object/);
    expect(() => parseChatEvent('[]')).toThrow(/not a JSON object/);
  });

  it('throws sse_parse_error when a known event is missing required base fields', () => {
    const broken = JSON.stringify({
      event_id: 'evt_1',
      // missing session_id, sequence_id, created_at
      kind: 'message_created',
      payload: { message_id: 'm1', role: 'user', body: 'hi' },
    });
    expect(() => parseChatEvent(broken)).toThrow(ChatTransportError);
  });

  it('throws sse_parse_error when payload is not an object for a known kind', () => {
    const broken = JSON.stringify({
      event_id: 'evt_1',
      session_id: 'sess_1',
      sequence_id: 1,
      created_at: '2026-06-22T10:00:00Z',
      kind: 'message_created',
      payload: 'not an object',
    });
    expect(() => parseChatEvent(broken)).toThrow(/payload/);
  });
});

function logicalTurnPayload() {
  return {
    logical_turn_id: 'turn_1',
    projection_id: 'projection_1',
    continuation_id: 'continuation_1',
    continuation_count: 2,
    wake_id: 'wake_1',
    phase: 'running',
    operator_state: 'running',
    progress_classification: 'provider_progress',
    reason_code: 'continuing',
    summary: 'Continuing the same logical turn.',
    progress: {
      semanticRevision: 3,
      committedProviderOperations: 4,
      committedToolOperations: 2,
      committedProjectionCursor: 5,
      assistantContentBytes: 100,
      acceptedActionCount: 2,
      delegatedCompletionCount: 0,
      stateFingerprint: 'sha256:test',
      lastLivenessAt: '2026-07-30T00:00:00Z',
      lastSemanticProgressAt: '2026-07-30T00:00:00Z',
    },
    logical_turn_revision: 4,
  };
}
