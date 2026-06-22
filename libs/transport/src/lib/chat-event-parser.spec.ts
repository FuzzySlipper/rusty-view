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
