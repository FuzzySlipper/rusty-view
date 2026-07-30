import type {
  ChatSessionStatus,
  ChatSessionSummary,
  SessionExecutionOutcome,
  SessionExecutionPhase,
  SessionExecutionState,
} from '@rusty-view/protocol';

/**
 * Status vocabulary presented for a Crew session.
 *
 * Durable lifecycle values remain available, while a live session exposes the
 * more precise Rust-owned execution phase or its latest terminal outcome.
 */
export type SessionExecutionDisplayStatus =
  | ChatSessionStatus
  | SessionExecutionPhase
  | SessionExecutionOutcome;

/** Return the most useful protocol-owned status for one session row. */
export function sessionExecutionDisplayStatus(
  session: ChatSessionSummary,
): SessionExecutionDisplayStatus {
  const execution = session.execution;
  if (
    session.status === 'archived' ||
    execution?.lifecycleStatus === 'archived'
  ) {
    return 'archived';
  }
  if (execution === undefined) return session.status;
  if (execution.phase !== 'idle') return execution.phase;
  return execution.lastOutcome ?? 'idle';
}

/** Whether the canonical projection says the native session has live work. */
export function sessionExecutionIsWorking(
  session: ChatSessionSummary,
): boolean {
  const execution = session.execution;
  return execution === undefined
    ? session.status === 'active'
    : execution.lifecycleStatus === 'live' && execution.phase !== 'idle';
}

/**
 * Keep the legacy session status coherent when applying a live execution event.
 *
 * Crew snapshots already derive this field from the same Rust projection. SSE
 * events carry only the richer execution object, so the store mirrors Crew's
 * compatibility mapping locally while retaining the complete projection.
 */
export function legacySessionStatusForExecution(
  execution: SessionExecutionState,
): ChatSessionStatus {
  if (execution.lifecycleStatus === 'archived') return 'archived';
  return execution.phase === 'idle' ? 'idle' : 'active';
}
