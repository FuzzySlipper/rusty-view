import type {
  ChatEvent,
  ChatEventKind,
  ChatEventPayload,
} from '@rusty-view/protocol';

import { ChatTransportError } from './chat-transport-error';

/**
 * Runtime map of every known {@link ChatEventKind}.
 *
 * Typed as `Record<ChatEventKind, true>` so the TypeScript compiler enforces
 * exhaustiveness: if the OpenAPI contract adds a new kind, regeneration
 * changes the `ChatEventKind` union and this object literal fails to compile
 * until the new key is added. This is the compile-time safety net for the
 * runtime kind check below.
 */
const KNOWN_EVENT_KINDS: Record<ChatEventKind, true> = {
  session_snapshot: true,
  session_execution_changed: true,
  message_created: true,
  assistant_turn_started: true,
  assistant_text_delta: true,
  assistant_reasoning_delta: true,
  phase_change: true,
  provider_status: true,
  assistant_message_completed: true,
  assistant_turn_finished: true,
  tool_call_started: true,
  tool_call_completed: true,
  tool_call_failed: true,
  command_started: true,
  command_completed: true,
  command_failed: true,
  context_status: true,
  context_compaction_started: true,
  context_compaction_completed: true,
  context_compaction_failed: true,
  logical_turn_admitted: true,
  logical_turn_continuing: true,
  logical_turn_yielding: true,
  logical_turn_queued_to_continue: true,
  logical_turn_attention_required: true,
  logical_turn_cancelling: true,
  logical_turn_completed: true,
  logical_turn_cancelled: true,
  logical_turn_failed: true,
  message_slot_created: true,
  message_variant_created: true,
  message_variant_deleted: true,
  message_variants_reordered: true,
  message_active_variant_selected: true,
  conversation_branch_created: true,
  conversation_active_branch_selected: true,
  conversation_branch_head_updated: true,
  conversation_snapshot_created: true,
  attachment_uploaded: true,
  attachment_linked: true,
  attachment_removed: true,
  attachment_updated: true,
  data_bank_scope_created: true,
  data_bank_scope_removed: true,
  stream_error: true,
  unknown: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKnownEventKind(kind: string): kind is ChatEventKind {
  return Object.prototype.hasOwnProperty.call(KNOWN_EVENT_KINDS, kind);
}

function readStringField(obj: Record<string, unknown>, field: string): string {
  const value = obj[field];
  if (typeof value !== 'string') {
    throw new ChatTransportError({
      code: 'sse_parse_error',
      message: `ChatEvent field "${field}" is missing or not a string`,
    });
  }
  return value;
}

function readNumberField(obj: Record<string, unknown>, field: string): number {
  const value = obj[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ChatTransportError({
      code: 'sse_parse_error',
      message: `ChatEvent field "${field}" is missing or not a finite number`,
    });
  }
  return value;
}

/**
 * Parse SSE `data` text into a typed {@link ChatEvent}.
 *
 * Forward-compatibility: if the parsed JSON's `kind` is not a known
 * {@link ChatEventKind}, the event is coerced into a synthetic `unknown` event
 * (carrying the original under `payload.raw`). This guarantees the debug UI can
 * render any future backend event without crashing, as required by the contract
 * and docs/rusty-view.md.
 *
 * Throws {@link ChatTransportError} (code `sse_parse_error`) only when the data
 * is not valid JSON or the base envelope fields (event_id, session_id,
 * sequence_id, created_at) are missing/malformed for a KNOWN event kind.
 * Unknown-kind events are always delivered (coerced), never thrown.
 */
export function parseChatEvent(data: string): ChatEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new ChatTransportError({
      code: 'sse_parse_error',
      message: 'SSE data is not valid JSON',
    });
  }

  if (!isRecord(parsed)) {
    throw new ChatTransportError({
      code: 'sse_parse_error',
      message: 'SSE data is not a JSON object',
    });
  }

  const rawKind = typeof parsed['kind'] === 'string' ? parsed['kind'] : null;

  if (rawKind !== null && isKnownEventKind(rawKind)) {
    return parseKnownEvent(parsed, rawKind);
  }

  return coerceUnknownEvent(parsed, rawKind);
}

function parseKnownEvent(
  obj: Record<string, unknown>,
  kind: ChatEventKind,
): ChatEvent {
  const event_id = readStringField(obj, 'event_id');
  const session_id = readStringField(obj, 'session_id');
  const sequence_id = readNumberField(obj, 'sequence_id');
  const created_at = readStringField(obj, 'created_at');
  const payload = obj['payload'];

  if (!isRecord(payload)) {
    throw new ChatTransportError({
      code: 'sse_parse_error',
      message: 'ChatEvent payload is missing or not an object',
    });
  }

  // Transport is the wire trust boundary: the backend guarantees payload
  // structure per the OpenAPI contract. Full runtime payload validation would
  // duplicate the schema; we validate the base envelope and trust the payload.
  return {
    event_id,
    session_id,
    sequence_id,
    created_at,
    kind,
    // Justified cast: payload shape is backend-guaranteed per the contract.
    payload: payload as ChatEventPayload,
  };
}

function coerceUnknownEvent(
  obj: Record<string, unknown>,
  originalKind: string | null,
): ChatEvent {
  const summary =
    originalKind !== null
      ? `Unrecognized event kind: ${originalKind}`
      : 'Unrecognized event (missing kind field)';

  const event_id =
    typeof obj['event_id'] === 'string'
      ? obj['event_id']
      : `unknown-${cryptoRandomId()}`;
  const session_id =
    typeof obj['session_id'] === 'string' ? obj['session_id'] : '';
  const sequence_id =
    typeof obj['sequence_id'] === 'number' &&
    Number.isFinite(obj['sequence_id'])
      ? obj['sequence_id']
      : 0;
  const created_at =
    typeof obj['created_at'] === 'string'
      ? obj['created_at']
      : new Date(0).toISOString();

  // Preserve the original event (including its original kind) under raw so the
  // debug UI can inspect exactly what the backend sent.
  const raw: Record<string, unknown> = { ...obj };
  if (originalKind !== null) {
    raw['original_kind'] = originalKind;
  }

  return {
    event_id,
    session_id,
    sequence_id,
    created_at,
    kind: 'unknown',
    payload: { summary, raw },
  };
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
