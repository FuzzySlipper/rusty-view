/**
 * Protocol wire-type smoke.
 *
 * Verifies the generated/aliased types correctly type representative Rusty Crew
 * chat wire JSON: a session summary, several event kinds (including a tool call
 * and the `unknown` forward-compat envelope), a send-message request, a command
 * descriptor, and an error envelope. Each fixture is parsed with `JSON.parse`
 * and assigned to an aliased type, then fields are read back — proving the
 * public aliases both compile under strict mode and accept real wire shapes.
 *
 * This package is type-only at runtime; these tests are the only runtime
 * exercise of the types (parsing is test-only, not shipped library code).
 */

import { describe, expect, it } from 'vitest';

import {
  PROTOCOL_VERSION,
  type ApiError,
  type ChatCommandDescriptor,
  type ChatEvent,
  type ChatSessionSummary,
  type ExecuteChatCommandResult,
  type SendChatMessageRequest,
} from '../index';

const sessionSummaryJson = `{
  "session_id": "sess_1",
  "agent_id": "agent_narrator",
  "profile_id": "profile_rp",
  "kind": "full",
  "status": "active",
  "title": "Opening scene",
  "latest_cursor": "cur_42",
  "created_at": "2026-06-22T10:00:00Z",
  "updated_at": "2026-06-22T10:05:00Z",
  "message_count": 12,
  "tool_event_count": 3
}`;

const messageCreatedEventJson = `{
  "event_id": "evt_100",
  "session_id": "sess_1",
  "sequence_id": 100,
  "created_at": "2026-06-22T10:05:00Z",
  "kind": "message_created",
  "payload": {
    "message_id": "msg_7",
    "role": "user",
    "body": "The door creaks open.",
    "client_message_id": "cmid_abc"
  }
}`;

const toolCallEventJson = `{
  "event_id": "evt_101",
  "session_id": "sess_1",
  "sequence_id": 101,
  "created_at": "2026-06-22T10:05:01Z",
  "kind": "tool_call_started",
  "payload": {
    "tool_call_id": "tc_9",
    "tool_name": "search_lore",
    "summary": "Searched lore for 'amber lantern'",
    "status": "started"
  }
}`;

const unknownEventJson = `{
  "event_id": "evt_102",
  "session_id": "sess_1",
  "sequence_id": 102,
  "created_at": "2026-06-22T10:05:02Z",
  "kind": "unknown",
  "payload": {
    "summary": "Unrecognized event kind future_thing",
    "raw": { "kind": "future_thing", "detail": 7 }
  }
}`;

const sendMessageRequestJson = `{
  "actor": { "id": "user_patch", "kind": "human", "display_name": "Patch" },
  "body": "I step into the light.",
  "client_message_id": "cmid_def",
  "reason": "user_turn"
}`;

const commandDescriptorJson = `{
  "name": "new",
  "aliases": ["restart"],
  "description": "Archive the current session and create a fresh one.",
  "read_only": false,
  "mutating": true,
  "scope": "session",
  "allowed_session_kinds": ["full"],
  "requires_control_auth": true
}`;

const executeCommandResultJson = `{
  "status": "completed",
  "command_name": "new",
  "summary": "Archived sess_1; created sess_2.",
  "latest_cursor": "cur_0",
  "old_session_id": "sess_1",
  "new_session_id": "sess_2"
}`;

const apiErrorJson = `{
  "code": "failed_precondition",
  "reason_code": "session_blocked",
  "message": "Session is blocked.",
  "retryable": false
}`;

describe('@rusty-view/protocol package version', () => {
  it('exports a version marker', () => {
    expect(PROTOCOL_VERSION).toBe('0.0.0');
  });
});

describe('@rusty-view/protocol wire types parse representative envelopes', () => {
  it('parses a ChatSessionSummary', () => {
    const summary: ChatSessionSummary = JSON.parse(sessionSummaryJson);
    expect(summary.session_id).toBe('sess_1');
    expect(summary.kind).toBe('full');
    expect(summary.status).toBe('active');
    expect(summary.latest_cursor).toBe('cur_42');
  });

  it('parses a message_created ChatEvent and reads its payload', () => {
    const event: ChatEvent = JSON.parse(messageCreatedEventJson);
    expect(event.kind).toBe('message_created');
    expect(event.sequence_id).toBe(100);
    // Narrow the oneOf payload by a field unique to MessageCreatedPayload.
    if ('message_id' in event.payload) {
      expect(event.payload.role).toBe('user');
      expect(event.payload.body).toBe('The door creaks open.');
    }
  });

  it('parses a tool_call_started ChatEvent and reads its payload', () => {
    const event: ChatEvent = JSON.parse(toolCallEventJson);
    expect(event.kind).toBe('tool_call_started');
    if ('tool_call_id' in event.payload) {
      expect(event.payload.tool_name).toBe('search_lore');
      expect(event.payload.status).toBe('started');
    }
  });

  it('keeps the unknown event kind representable for debug display', () => {
    const event: ChatEvent = JSON.parse(unknownEventJson);
    // The explicit 'unknown' kind is part of the closed ChatEventKind union.
    expect(event.kind).toBe('unknown');

    // The `raw` field is unique to UnknownEventPayload, so its presence narrows
    // the oneOf payload without a type assertion. It carries a debug summary
    // plus the original event blob, so the operator client can render future/
    // unrecognized backend events generically.
    if ('raw' in event.payload) {
      expect(event.payload.summary).toContain('future_thing');
      expect(event.payload.raw['kind']).toBe('future_thing');
    } else {
      throw new Error('expected UnknownEventPayload with a raw field');
    }
  });

  it('parses a SendChatMessageRequest', () => {
    const request: SendChatMessageRequest = JSON.parse(sendMessageRequestJson);
    expect(request.actor.kind).toBe('human');
    expect(request.body).toBe('I step into the light.');
    expect(request.client_message_id).toBe('cmid_def');
  });

  it('parses a ChatCommandDescriptor', () => {
    const descriptor: ChatCommandDescriptor = JSON.parse(commandDescriptorJson);
    expect(descriptor.name).toBe('new');
    expect(descriptor.mutating).toBe(true);
    expect(descriptor.requires_control_auth).toBe(true);
    expect(descriptor.allowed_session_kinds).toEqual(['full']);
  });

  it('parses an ExecuteChatCommandResult', () => {
    const result: ExecuteChatCommandResult = JSON.parse(
      executeCommandResultJson,
    );
    expect(result.status).toBe('completed');
    expect(result.old_session_id).toBe('sess_1');
    expect(result.new_session_id).toBe('sess_2');
  });

  it('parses an ApiError', () => {
    const error: ApiError = JSON.parse(apiErrorJson);
    expect(error.code).toBe('failed_precondition');
    expect(error.retryable).toBe(false);
  });

  it('round-trips serialization stably for a ChatEvent', () => {
    const event: ChatEvent = JSON.parse(messageCreatedEventJson);
    const roundTripped = JSON.parse(JSON.stringify(event)) as ChatEvent;
    expect(roundTripped).toEqual(event);
  });
});
