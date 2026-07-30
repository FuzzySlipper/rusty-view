import type {
  ChatSessionSummary,
  SessionExecutionState,
} from '@rusty-view/protocol';

import {
  legacySessionStatusForExecution,
  sessionExecutionDisplayStatus,
  sessionExecutionIsWorking,
} from './session-execution-status';

function execution(
  phase: SessionExecutionState['phase'],
  overrides: Partial<SessionExecutionState> = {},
): SessionExecutionState {
  return {
    sessionId: 'session-1',
    lifecycleStatus: 'live',
    phase,
    source: 'logical_turn',
    updatedAt: '2026-07-30T09:00:00Z',
    ...overrides,
  };
}

function session(
  state: SessionExecutionState | undefined,
  status: ChatSessionSummary['status'] = 'idle',
): ChatSessionSummary {
  return {
    session_id: 'session-1',
    agent_id: 'agent-1',
    profile_id: 'profile-1',
    kind: 'full',
    status,
    execution: state as SessionExecutionState,
    latest_cursor: 'session-1:0',
    updated_at: '2026-07-30T09:00:00Z',
  };
}

describe('session execution status', () => {
  it.each(['queued', 'active', 'waiting', 'paused', 'cancelling'] as const)(
    'preserves the live %s phase',
    (phase) => {
      const summary = session(execution(phase), 'active');
      expect(sessionExecutionDisplayStatus(summary)).toBe(phase);
      expect(sessionExecutionIsWorking(summary)).toBe(true);
      expect(legacySessionStatusForExecution(summary.execution)).toBe('active');
    },
  );

  it.each(['completed', 'failed', 'cancelled', 'interrupted'] as const)(
    'shows the latest %s outcome after work settles',
    (lastOutcome) => {
      const summary = session(execution('idle', { lastOutcome }));
      expect(sessionExecutionDisplayStatus(summary)).toBe(lastOutcome);
      expect(sessionExecutionIsWorking(summary)).toBe(false);
      expect(legacySessionStatusForExecution(summary.execution)).toBe('idle');
    },
  );

  it('keeps archived lifecycle stronger than execution details', () => {
    const summary = session(
      execution('idle', { lifecycleStatus: 'archived' }),
      'archived',
    );
    expect(sessionExecutionDisplayStatus(summary)).toBe('archived');
    expect(legacySessionStatusForExecution(summary.execution)).toBe('archived');
  });

  it('falls back to the legacy status for an older backend response', () => {
    const summary = session(undefined, 'blocked');
    expect(sessionExecutionDisplayStatus(summary)).toBe('blocked');
    expect(sessionExecutionIsWorking(summary)).toBe(false);
  });
});
