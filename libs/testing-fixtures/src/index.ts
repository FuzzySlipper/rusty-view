/**
 * @rusty-view/testing-fixtures
 *
 * Test fixtures for rusty-view: fake sessions, event streams (including
 * unknown-kind and corrupt/partial events), giant transcript fixtures,
 * streaming fixtures, and reconnect/replay fixtures.
 *
 * Production code MUST NOT depend on this package. The module-boundary lint
 * forbids any `type:lib` project from importing a `type:testing` project, so a
 * stray fixture import in production code fails the build.
 *
 * Implemented in Den task #3182.
 */

// Event fixtures (one per known kind)
export {
  sessionSnapshotEvent,
  userMessageEvent,
  assistantTurnStartedEvent,
  assistantDeltaEvent,
  assistantMessageCompletedEvent,
  assistantTurnFinishedEvent,
  toolCallStartedEvent,
  toolCallCompletedEvent,
  toolCallFailedEvent,
  commandStartedEvent,
  commandCompletedEvent,
  commandFailedEvent,
  streamErrorEvent,
  unknownKindEvent,
  coercedFutureKindEvent,
  allKindEvents,
} from './lib/event-fixtures';

// Session fixtures
export {
  emptySession,
  midConversationSession,
  longHistorySession,
  commandHeavySession,
  toolHeavySession,
  archivedSession,
  allSessions,
} from './lib/session-fixtures';

// Transcript generators (10k+ events, long messages)
export {
  generateTranscriptEvents,
  generateLongMessageEvents,
  getLargeTranscript,
} from './lib/transcript-fixtures';

// Stream / reconnect / dedup fixtures
export {
  generateStreamingTurn,
  generateReconnectBatches,
  generateDuplicateEvents,
  generateOutOfOrderEvents,
  generateMixedContentEvents,
} from './lib/stream-fixtures';

export const TESTING_FIXTURES_VERSION = '0.0.0' as const;
