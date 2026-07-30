import type { paths } from '@rusty-view/protocol';

/**
 * Chat route path literals.
 *
 * These string constants are the runtime route strings transport uses to build
 * URLs. Each is checked at compile time against the generated `paths` type from
 * the protocol package (`satisfies ChatPath`), so if the OpenAPI contract
 * changes a route path, regeneration breaks the build here — preventing silent
 * drift between transport and protocol.
 *
 * Route-path ownership lives in transport, not protocol: protocol is type-only
 * and describes shapes; transport is the runtime HTTP/SSE boundary.
 */
type ChatPath = keyof paths;

export const SESSIONS_PATH = '/v1/chat/sessions' as const satisfies ChatPath;

export const SESSION_PATH =
  '/v1/chat/sessions/{session_id}' as const satisfies ChatPath;

export const SESSION_EVENTS_PATH =
  '/v1/chat/sessions/{session_id}/events' as const satisfies ChatPath;

export const SESSION_STREAM_PATH =
  '/v1/chat/sessions/{session_id}/stream' as const satisfies ChatPath;

export const SESSION_CONTEXT_PATH =
  '/v1/chat/sessions/{session_id}/context' as const satisfies ChatPath;

export const SESSION_LOGICAL_TURNS_PATH =
  '/v1/chat/sessions/{session_id}/logical-turns' as const satisfies ChatPath;

export const SESSION_LOGICAL_TURN_CANCEL_PATH =
  '/v1/chat/sessions/{session_id}/logical-turns/{logical_turn_id}/cancel' as const satisfies ChatPath;

export const SESSION_LOGICAL_TURN_RESOLVE_PATH =
  '/v1/chat/sessions/{session_id}/logical-turns/{logical_turn_id}/resolve' as const satisfies ChatPath;

export const SESSION_TOOL_CALL_DEBUG_DETAIL_PATH =
  '/v1/chat/sessions/{session_id}/tool-calls/{debug_detail_id}' as const satisfies ChatPath;

export const SESSION_PROVIDER_REQUEST_DEBUG_DETAIL_PATH =
  '/v1/chat/sessions/{session_id}/provider-requests/{debug_detail_id}' as const satisfies ChatPath;

export const SESSION_MESSAGES_PATH =
  '/v1/chat/sessions/{session_id}/messages' as const satisfies ChatPath;

export const SESSION_SLOTS_PATH =
  '/v1/chat/sessions/{session_id}/slots' as const satisfies ChatPath;

export const SESSION_SLOT_VARIANTS_PATH =
  '/v1/chat/sessions/{session_id}/slots/{slot_id}/variants' as const satisfies ChatPath;

export const SESSION_SLOT_VARIANT_PATH =
  '/v1/chat/sessions/{session_id}/slots/{slot_id}/variants/{variant_id}' as const satisfies ChatPath;

export const SESSION_SLOT_ACTIVE_VARIANT_PATH =
  '/v1/chat/sessions/{session_id}/slots/{slot_id}/active-variant' as const satisfies ChatPath;

export const SESSION_TREE_PATH =
  '/v1/chat/sessions/{session_id}/tree' as const satisfies ChatPath;

export const SESSION_ACTIVE_BRANCH_PATH =
  '/v1/chat/sessions/{session_id}/branches/active' as const satisfies ChatPath;

export const COMMANDS_PATH = '/v1/chat/commands' as const satisfies ChatPath;

export const SESSION_COMMANDS_PATH =
  '/v1/chat/sessions/{session_id}/commands' as const satisfies ChatPath;

/** Query parameter names used by the chat API (snake_case to match wire). */
export const QUERY_PARAMS = {
  limit: 'limit',
  offset: 'offset',
  profileId: 'profile_id',
  status: 'status',
  cursor: 'cursor',
  before: 'before',
  includeToolPayloads: 'include_tool_payloads',
} as const;

/** Header names used by the chat API. */
export const HEADER_NAMES = {
  authorization: 'Authorization',
  contentType: 'Content-Type',
  idempotencyKey: 'Idempotency-Key',
  lastEventId: 'Last-Event-ID',
} as const;
