import {
  TESTING_FIXTURES_VERSION,
  allKindEvents,
  allSessions,
  generateDuplicateEvents,
  generateLongMessageEvents,
  generateOutOfOrderEvents,
  generateReconnectBatches,
  generateStreamingTurn,
  generateTranscriptEvents,
  generateMixedContentEvents,
  getLargeTranscript,
  unknownKindEvent,
  userMessageEvent,
} from '../index';

import { describe, expect, it } from 'vitest';

describe('@rusty-view/testing-fixtures package version', () => {
  it('exports a version marker', () => {
    expect(TESTING_FIXTURES_VERSION).toBe('0.0.0');
  });
});

describe('event fixtures', () => {
  it('allKindEvents covers every known kind', () => {
    const kinds = new Set(allKindEvents.map((e) => e.kind));
    expect(kinds.size).toBe(18);
    expect(kinds.has('session_snapshot')).toBe(true);
    expect(kinds.has('session_execution_changed')).toBe(true);
    expect(kinds.has('assistant_reasoning_delta')).toBe(true);
    expect(kinds.has('phase_change')).toBe(true);
    expect(kinds.has('provider_status')).toBe(true);
    expect(kinds.has('unknown')).toBe(true);
  });

  it('unknownKindEvent has summary and raw for debug rendering', () => {
    if ('raw' in unknownKindEvent.payload) {
      expect(unknownKindEvent.payload.summary).toBeTruthy();
      expect(unknownKindEvent.payload.raw).toBeDefined();
    }
  });
});

describe('session fixtures', () => {
  it('exports a variety of session states', () => {
    expect(allSessions.length).toBeGreaterThanOrEqual(5);
    const statuses = new Set(allSessions.map((s) => s.status));
    expect(statuses.has('active')).toBe(true);
    expect(statuses.has('archived')).toBe(true);
  });
});

describe('transcript generators', () => {
  it('generateTranscriptEvents produces the requested count', () => {
    const events = generateTranscriptEvents(30);
    expect(events.length).toBeGreaterThanOrEqual(30);
  });

  it('getLargeTranscript returns 10k+ events', () => {
    const events = getLargeTranscript();
    expect(events.length).toBeGreaterThanOrEqual(10_000);
  });

  it('generateLongMessageEvents produces deltas + a completed message', () => {
    const events = generateLongMessageEvents('msg_long', 10, 100);
    const hasDeltas = events.some((e) => e.kind === 'assistant_text_delta');
    const hasCompleted = events.some(
      (e) => e.kind === 'assistant_message_completed',
    );
    expect(hasDeltas).toBe(true);
    expect(hasCompleted).toBe(true);
  });
});

describe('stream fixtures', () => {
  it('generateStreamingTurn produces a complete turn', () => {
    const events = generateStreamingTurn('msg_stream', 5);
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe('assistant_turn_started');
    expect(kinds.at(-1)).toBe('assistant_turn_finished');
    expect(kinds.filter((k) => k === 'assistant_text_delta')).toHaveLength(5);
  });

  it('generateReconnectBatches splits at the given point', () => {
    const events = generateStreamingTurn('msg_recon', 4);
    const { firstBatch, secondBatch } = generateReconnectBatches(events, 3);
    expect(firstBatch).toHaveLength(3);
    expect(secondBatch.length).toBe(events.length - 3);
  });

  it('generateDuplicateEvents returns the same event_id twice', () => {
    const dupes = generateDuplicateEvents(userMessageEvent);
    expect(dupes).toHaveLength(2);
    expect(dupes[0]?.event_id).toBe(dupes[1]?.event_id);
  });

  it('generateOutOfOrderEvents reverses the order', () => {
    const events = generateStreamingTurn('msg_order', 3);
    const shuffled = generateOutOfOrderEvents(events);
    expect(shuffled[0]?.event_id).toBe(events.at(-1)?.event_id);
  });

  it('generateMixedContentEvents includes text, tool, and unknown', () => {
    const events = generateMixedContentEvents();
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds.has('message_created')).toBe(true);
    expect(kinds.has('tool_call_started')).toBe(true);
    expect(kinds.has('unknown')).toBe(true);
  });
});
