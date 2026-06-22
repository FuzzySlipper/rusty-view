import type { ChatSessionSummary } from '@rusty-view/protocol';

/**
 * Fake session summaries for testing. Each represents a different session state.
 */

function makeSession(
  overrides: Partial<ChatSessionSummary>,
): ChatSessionSummary {
  return {
    session_id: overrides.session_id ?? 'sess_fixture',
    agent_id: overrides.agent_id ?? 'agent_narrator',
    profile_id: overrides.profile_id ?? 'profile_rp',
    kind: overrides.kind ?? 'full',
    status: overrides.status ?? 'active',
    latest_cursor: overrides.latest_cursor ?? 'cur_0',
    updated_at: overrides.updated_at ?? '2026-06-22T10:00:00Z',
    ...adjustOptionals(overrides),
  };
}

function adjustOptionals(
  overrides: Partial<ChatSessionSummary>,
): Partial<ChatSessionSummary> {
  const result: Partial<ChatSessionSummary> = {};
  if (overrides.title !== undefined) result.title = overrides.title;
  if (overrides.created_at !== undefined)
    result.created_at = overrides.created_at;
  if (overrides.message_count !== undefined)
    result.message_count = overrides.message_count;
  if (overrides.tool_event_count !== undefined)
    result.tool_event_count = overrides.tool_event_count;
  return result;
}

export const emptySession: ChatSessionSummary = makeSession({
  session_id: 'sess_empty',
  title: 'Empty Session',
  message_count: 0,
  tool_event_count: 0,
});

export const midConversationSession: ChatSessionSummary = makeSession({
  session_id: 'sess_mid',
  title: 'Mid-Conversation',
  latest_cursor: 'cur_50',
  message_count: 12,
  tool_event_count: 3,
});

export const longHistorySession: ChatSessionSummary = makeSession({
  session_id: 'sess_long',
  title: 'Long History',
  latest_cursor: 'cur_5000',
  message_count: 5_000,
  tool_event_count: 200,
});

export const commandHeavySession: ChatSessionSummary = makeSession({
  session_id: 'sess_commands',
  title: 'Command-Heavy',
  latest_cursor: 'cur_100',
  message_count: 20,
  tool_event_count: 0,
});

export const toolHeavySession: ChatSessionSummary = makeSession({
  session_id: 'sess_tools',
  title: 'Tool-Heavy',
  latest_cursor: 'cur_300',
  message_count: 15,
  tool_event_count: 150,
});

export const archivedSession: ChatSessionSummary = makeSession({
  session_id: 'sess_archived',
  title: 'Archived Session',
  status: 'archived',
  latest_cursor: 'cur_999',
  message_count: 42,
  tool_event_count: 10,
});

export const allSessions: readonly ChatSessionSummary[] = Object.freeze([
  emptySession,
  midConversationSession,
  longHistorySession,
  commandHeavySession,
  toolHeavySession,
  archivedSession,
]);
