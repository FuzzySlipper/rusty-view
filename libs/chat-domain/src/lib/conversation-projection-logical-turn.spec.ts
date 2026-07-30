import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '@rusty-view/protocol';

import { emptyProjection, projectConversation } from '../index';

describe('logical-turn projection', () => {
  it('keeps one logical turn across continuation events without transcript text', () => {
    const projection = projectConversation([
      logicalTurnEvent('logical_turn_admitted', 1, 0, 'running'),
      logicalTurnEvent('logical_turn_yielding', 2, 1, 'queued_to_continue'),
      logicalTurnEvent('logical_turn_continuing', 3, 2, 'running'),
    ]);

    expect(projection.messages).toEqual([]);
    expect(projection.logicalTurns).toHaveLength(1);
    expect(projection.logicalTurns[0]).toMatchObject({
      id: 'turn_1',
      continuationCount: 2,
      currentContinuationId: 'continuation_2',
      operatorState: 'running',
      revision: 3,
    });
    expect(projection.logicalTurns[0]?.progress).toMatchObject({
      committedProviderOperations: 6,
      committedToolOperations: 4,
    });
  });

  it('ignores stale lifecycle revisions replayed after a newer update', () => {
    const projection = projectConversation([
      logicalTurnEvent('logical_turn_continuing', 5, 4, 'running'),
      logicalTurnEvent('logical_turn_yielding', 4, 3, 'queued_to_continue'),
    ]);
    expect(projection.logicalTurns[0]).toMatchObject({
      revision: 5,
      continuationCount: 4,
      operatorState: 'running',
    });
  });

  it('repairs projections cached before context and logical-turn arrays existed', () => {
    const stale = { ...emptyProjection() } as unknown as Record<
      string,
      unknown
    >;
    delete stale['contextTimeline'];
    delete stale['logicalTurns'];

    expect(() =>
      projectConversation(
        [logicalTurnEvent('logical_turn_admitted', 1, 0, 'running')],
        stale as unknown as ReturnType<typeof emptyProjection>,
      ),
    ).not.toThrow();
    const projection = projectConversation(
      [logicalTurnEvent('logical_turn_admitted', 1, 0, 'running')],
      stale as unknown as ReturnType<typeof emptyProjection>,
    );
    expect(projection.contextTimeline).toEqual([]);
    expect(projection.logicalTurns).toHaveLength(1);
  });

  it('reads production compaction metadata from provider-status metadata_json', () => {
    const event: ChatEvent = {
      event_id: 'ctx_1',
      session_id: 'sess_1',
      sequence_id: 1,
      created_at: '2026-07-30T00:00:00Z',
      kind: 'context_compaction_completed',
      payload: {
        wake_id: 'wake_1',
        level: 'info',
        message: 'Context compaction completed.',
        metadata_json: JSON.stringify({
          kind: 'context_compaction_completed',
          usage: { fillPercent: 81 },
          artifact: {
            strategyId: 'rolling_summary_compaction',
            reasonCode: 'context_fill_threshold_exceeded',
          },
        }),
      },
    };
    const projection = projectConversation([event]);
    expect(projection.contextStatus).toMatchObject({
      strategyId: 'rolling_summary_compaction',
      fillPercent: 81,
      reasonCode: 'context_fill_threshold_exceeded',
    });
  });
});

function logicalTurnEvent(
  kind: ChatEvent['kind'],
  revision: number,
  continuationCount: number,
  operatorState: string,
): ChatEvent {
  return {
    event_id: `turn_${revision}`,
    session_id: 'sess_1',
    sequence_id: revision,
    created_at: `2026-07-30T00:00:0${revision}Z`,
    kind,
    payload: {
      logical_turn_id: 'turn_1',
      projection_id: 'projection_1',
      continuation_id: `continuation_${continuationCount}`,
      continuation_count: continuationCount,
      wake_id: `wake_${continuationCount}`,
      phase: operatorState === 'queued_to_continue' ? 'yielded' : 'running',
      operator_state: operatorState,
      progress_classification: 'provider_progress',
      reason_code: 'continuing',
      summary: 'Continuing the same logical turn.',
      progress: {
        semanticRevision: revision,
        committedProviderOperations: revision * 2,
        committedToolOperations: revision + 1,
        committedProjectionCursor: revision,
        assistantContentBytes: revision * 10,
        acceptedActionCount: revision,
        delegatedCompletionCount: 0,
        stateFingerprint: `sha256:${revision}`,
        lastLivenessAt: '2026-07-30T00:00:00Z',
        lastSemanticProgressAt: '2026-07-30T00:00:00Z',
      },
      logical_turn_revision: revision,
    },
  } as ChatEvent;
}
