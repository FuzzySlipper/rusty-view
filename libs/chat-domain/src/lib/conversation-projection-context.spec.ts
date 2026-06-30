import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '@rusty-view/protocol';

import { projectConversation } from '../index';

/**
 * Tasks #3788/#3846/#3847: the four `context_*` events project into a context
 * timeline of UI/debug status rows (never assistant messages), and the newer
 * known-but-not-yet-projected kinds are safely no-op'd (not coerced to unknown).
 */
function contextEvent(
  kind: ChatEvent['kind'],
  payload: Record<string, unknown>,
  overrides: Partial<ChatEvent> = {},
): ChatEvent {
  return {
    event_id:
      overrides.event_id ?? `evt_${Math.random().toString(36).slice(2)}`,
    session_id: overrides.session_id ?? 'sess_1',
    sequence_id: overrides.sequence_id ?? 0,
    created_at: overrides.created_at ?? '2026-06-30T10:00:00Z',
    kind,
    // Justified cast: the spec constructs browser-safe ContextDebugPayload-shaped
    // data; ChatEventPayload is a wide oneOf we do not narrow here.
    payload: payload as ChatEvent['payload'],
  };
}

const STATUS_PAYLOAD = {
  session_id: 'sess_1',
  strategy_id: 'sliding-window',
  estimate_quality: 'approximate',
  fill_percent: 62,
  compact_at_percent: 80,
  target_percent_after_compaction: 40,
  ui_debug: true,
  model_facing: false,
};

describe('context event projection', () => {
  it('projects a context_status event into a timeline row, not a message', () => {
    const projection = projectConversation([
      contextEvent('context_status', STATUS_PAYLOAD, { event_id: 'c1' }),
    ]);

    expect(projection.messages).toHaveLength(0);
    expect(projection.unknownEvents).toHaveLength(0);
    expect(projection.contextTimeline).toHaveLength(1);

    const entry = projection.contextTimeline[0];
    expect(entry).toMatchObject({
      id: 'c1',
      kind: 'status',
      sessionId: 'sess_1',
      strategyId: 'sliding-window',
      estimateQuality: 'approximate',
      fillPercent: 62,
      compactAtPercent: 80,
      targetPercentAfterCompaction: 40,
    });
    expect(projection.contextStatus).toEqual(entry);
  });

  it('maps each compaction event kind to its timeline kind', () => {
    const projection = projectConversation([
      contextEvent('context_compaction_started', {
        session_id: 'sess_1',
        strategy_id: 's',
        ui_debug: true,
        model_facing: false,
      }),
      contextEvent('context_compaction_completed', {
        session_id: 'sess_1',
        strategy_id: 's',
        artifact_id: 'art_9',
        ui_debug: true,
        model_facing: false,
      }),
      contextEvent('context_compaction_failed', {
        session_id: 'sess_1',
        strategy_id: 's',
        reason_code: 'token_budget_exceeded',
        ui_debug: true,
        model_facing: false,
      }),
    ]);

    expect(projection.contextTimeline.map((e) => e.kind)).toEqual([
      'compaction_started',
      'compaction_completed',
      'compaction_failed',
    ]);
    expect(projection.contextTimeline[1].artifactId).toBe('art_9');
    expect(projection.contextTimeline[2].reasonCode).toBe(
      'token_budget_exceeded',
    );
  });

  it('keeps the timeline oldest-first and contextStatus as the latest row', () => {
    const projection = projectConversation([
      contextEvent(
        'context_status',
        { ...STATUS_PAYLOAD, fill_percent: 10 },
        {
          event_id: 'a',
        },
      ),
      contextEvent(
        'context_status',
        { ...STATUS_PAYLOAD, fill_percent: 90 },
        {
          event_id: 'b',
        },
      ),
    ]);

    expect(projection.contextTimeline.map((e) => e.id)).toEqual(['a', 'b']);
    expect(projection.contextStatus?.id).toBe('b');
    expect(projection.contextStatus?.fillPercent).toBe(90);
  });

  it('no-ops newer known kinds without coercing them to unknown', () => {
    const projection = projectConversation([
      contextEvent(
        'attachment_uploaded',
        { attachment_id: 'att_1' },
        { event_id: 'x1' },
      ),
      contextEvent(
        'message_variant_created',
        { slot_id: 'slot_1', variant_id: 'v1' },
        { event_id: 'x2' },
      ),
    ]);

    expect(projection.messages).toHaveLength(0);
    expect(projection.unknownEvents).toHaveLength(0);
    expect(projection.contextTimeline).toHaveLength(0);
    // The cursor still advances through these recognized events.
    expect(projection.latestCursor).toBe('x2');
  });
});
