import { CHAT_DOMAIN_VERSION, projectConversation } from '../index';
import type { ChatEvent } from '@rusty-view/protocol';

import { describe, expect, it } from 'vitest';

describe('@rusty-view/chat-domain package version', () => {
  it('exports a version marker', () => {
    expect(CHAT_DOMAIN_VERSION).toBe('0.0.0');
  });
});

function makeEvent(
  kind: ChatEvent['kind'],
  payload: ChatEvent['payload'],
  overrides: Partial<ChatEvent> = {},
): ChatEvent {
  return {
    event_id:
      overrides.event_id ?? `evt_${Math.random().toString(36).slice(2, 8)}`,
    session_id: overrides.session_id ?? 'sess_1',
    sequence_id: overrides.sequence_id ?? 0,
    created_at: overrides.created_at ?? '2026-06-22T10:00:00Z',
    kind,
    payload,
  };
}

describe('projectConversation', () => {
  it('returns an empty projection for no events', () => {
    const projection = projectConversation([]);
    expect(projection.messages).toHaveLength(0);
    expect(projection.unknownEvents).toHaveLength(0);
  });

  it('applies events on top of a previous projection (incremental)', () => {
    const base = projectConversation([
      makeEvent('message_created', {
        message_id: 'm1',
        role: 'user',
        body: 'first',
      }),
    ]);
    const updated = projectConversation(
      [
        makeEvent('message_created', {
          message_id: 'm2',
          role: 'assistant',
          body: 'second',
        }),
      ],
      base,
    );
    expect(updated.messages).toHaveLength(2);
  });

  it('tracks latestCursor from event_id', () => {
    const projection = projectConversation([
      makeEvent(
        'message_created',
        { message_id: 'm1', role: 'user', body: 'hi' },
        { event_id: 'cur_5' },
      ),
    ]);
    expect(projection.latestCursor).toBe('cur_5');
  });

  it('session_snapshot sets sessionMetadata', () => {
    const session = {
      session_id: 'sess_1',
      agent_id: 'agent_1',
      profile_id: 'prof_1',
      kind: 'full' as const,
      status: 'active' as const,
      latest_cursor: 'cur_0',
      updated_at: '2026-06-22T10:00:00Z',
    };
    const projection = projectConversation([
      makeEvent('session_snapshot', { session }),
    ]);
    expect(projection.sessionMetadata?.session_id).toBe('sess_1');
  });

  it('message_created creates a completed message with a text block', () => {
    const projection = projectConversation([
      makeEvent('message_created', {
        message_id: 'm1',
        role: 'user',
        body: 'Hello world',
      }),
    ]);
    expect(projection.messages).toHaveLength(1);
    const msg = projection.messages[0];
    expect(msg?.id).toBe('m1');
    expect(msg?.author.role).toBe('user');
    expect(msg?.status).toBe('completed');
    expect(msg?.blocks[0]?.kind).toBe('text');
    expect(msg?.blocks[0]?.content).toBe('Hello world');
  });

  it('deduplicates message_created by message_id', () => {
    const events: ChatEvent[] = [
      makeEvent(
        'message_created',
        { message_id: 'm1', role: 'user', body: 'hi' },
        { event_id: 'e1' },
      ),
      makeEvent(
        'message_created',
        { message_id: 'm1', role: 'user', body: 'hi' },
        { event_id: 'e2' },
      ),
    ];
    const projection = projectConversation(events);
    expect(projection.messages).toHaveLength(1);
  });

  it('assistant streaming: turn_started → deltas → completed → turn_finished', () => {
    const events: ChatEvent[] = [
      makeEvent('assistant_turn_started', {}, { event_id: 'e1' }),
      makeEvent(
        'assistant_text_delta',
        { message_id: 'a1', delta: 'Hello ' },
        { event_id: 'e2' },
      ),
      makeEvent(
        'assistant_text_delta',
        { message_id: 'a1', delta: 'world!' },
        { event_id: 'e3' },
      ),
      makeEvent(
        'assistant_message_completed',
        { message_id: 'a1', body: 'Hello world!' },
        { event_id: 'e4' },
      ),
      makeEvent('assistant_turn_finished', {}, { event_id: 'e5' }),
    ];

    const projection = projectConversation(events);

    // Message finalized.
    expect(projection.messages).toHaveLength(1);
    const msg = projection.messages[0];
    expect(msg?.id).toBe('a1');
    expect(msg?.status).toBe('completed');
    expect(msg?.blocks[0]?.content).toBe('Hello world!');

    // Active turn cleared.
    expect(projection.activeTurn).toBeUndefined();
  });

  it('assistant_text_delta creates a streaming message if turn not started', () => {
    const projection = projectConversation([
      makeEvent(
        'assistant_text_delta',
        { message_id: 'a1', delta: 'partial' },
        { event_id: 'e1' },
      ),
    ]);
    expect(projection.messages).toHaveLength(1);
    expect(projection.messages[0]?.status).toBe('streaming');
    expect(projection.messages[0]?.blocks[0]?.content).toBe('partial');
  });

  it('activeTurn tracks streaming text across deltas', () => {
    const projection = projectConversation([
      makeEvent('assistant_turn_started', {}, { event_id: 'e1' }),
      makeEvent(
        'assistant_text_delta',
        { message_id: 'a1', delta: 'foo' },
        { event_id: 'e2' },
      ),
      makeEvent(
        'assistant_text_delta',
        { message_id: 'a1', delta: 'bar' },
        { event_id: 'e3' },
      ),
    ]);
    expect(projection.activeTurn?.streamingText).toBe('foobar');
    expect(projection.activeTurn?.messageId).toBe('a1');
  });

  it('assistant_reasoning_delta accumulates into a separate reasoning block', () => {
    const projection = projectConversation([
      makeEvent('assistant_turn_started', {}, { event_id: 'e1' }),
      makeEvent(
        'assistant_reasoning_delta',
        { wake_id: 'w1', text: 'Let me ', visibility: 'reasoning' },
        { event_id: 'e2' },
      ),
      makeEvent(
        'assistant_reasoning_delta',
        { wake_id: 'w1', text: 'think.', visibility: 'reasoning' },
        { event_id: 'e3' },
      ),
    ]);

    expect(projection.messages).toHaveLength(1);
    const blocks = projection.messages[0]?.blocks ?? [];
    const reasoning = blocks.filter((b) => b.kind === 'reasoning');
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0]?.content).toBe('Let me think.');
    expect(reasoning[0]?.renderPolicy).toBe('collapsed');
    // Reasoning does not leak into the visible answer text.
    expect(projection.activeTurn?.streamingText).toBe('');
  });

  it('reasoning shares one message with answer text and preserves order', () => {
    // Reasoning (wake w1) streams before any text delta (message asst:w1); both
    // must land on the SAME assistant message, reasoning first then text.
    const projection = projectConversation([
      makeEvent(
        'assistant_reasoning_delta',
        { wake_id: 'w1', text: 'thinking…', visibility: 'reasoning' },
        { event_id: 'e1' },
      ),
      makeEvent(
        'assistant_text_delta',
        { wake_id: 'w1', text: 'The answer.' },
        { event_id: 'e2' },
      ),
    ]);

    expect(projection.messages).toHaveLength(1);
    const blocks = projection.messages[0]?.blocks ?? [];
    expect(blocks.map((b) => b.kind)).toEqual(['reasoning', 'text']);
    expect(blocks[0]?.content).toBe('thinking…');
    expect(blocks[1]?.content).toBe('The answer.');
  });

  it('interleaved reasoning/text/tool ordering, cleared by turn_finished', () => {
    const projection = projectConversation([
      makeEvent('assistant_turn_started', {}, { event_id: 'e1' }),
      makeEvent(
        'assistant_reasoning_delta',
        { wake_id: 'w1', text: 'plan', visibility: 'reasoning' },
        { event_id: 'e2' },
      ),
      makeEvent(
        'assistant_text_delta',
        { wake_id: 'w1', text: 'answer ' },
        { event_id: 'e3' },
      ),
      makeEvent(
        'assistant_reasoning_delta',
        { wake_id: 'w1', text: 'reconsider', visibility: 'reasoning' },
        { event_id: 'e4' },
      ),
      makeEvent(
        'assistant_message_completed',
        { wake_id: 'w1', body: 'answer done' },
        { event_id: 'e5' },
      ),
      makeEvent('assistant_turn_finished', {}, { event_id: 'e6' }),
    ]);

    const blocks = projection.messages[0]?.blocks ?? [];
    // Two reasoning segments bracket the text, staying in chronological order.
    expect(blocks.map((b) => b.kind)).toEqual([
      'reasoning',
      'text',
      'reasoning',
    ]);
    expect(projection.messages[0]?.status).toBe('completed');
    expect(projection.activeTurn).toBeUndefined();
  });

  it('tool_call lifecycle: started → completed', () => {
    const projection = projectConversation([
      makeEvent(
        'tool_call_started',
        {
          tool_call_id: 'tc1',
          tool_name: 'search_lore',
          summary: 'Searched for amber',
          status: 'started',
        },
        { event_id: 'e1' },
      ),
      makeEvent(
        'tool_call_completed',
        {
          tool_call_id: 'tc1',
          tool_name: 'search_lore',
          summary: 'Found 3 entries',
          status: 'completed',
        },
        { event_id: 'e2' },
      ),
    ]);
    expect(projection.toolCalls).toHaveLength(1);
    expect(projection.toolCalls[0]?.status).toBe('completed');
    expect(projection.toolCalls[0]?.toolName).toBe('search_lore');
  });

  it('tool_call_failed sets status to failed', () => {
    const projection = projectConversation([
      makeEvent(
        'tool_call_failed',
        {
          tool_call_id: 'tc1',
          tool_name: 'search_lore',
          summary: 'Lore service down',
          status: 'failed',
          reason_code: 'timeout',
        },
        { event_id: 'e1' },
      ),
    ]);
    expect(projection.toolCalls[0]?.status).toBe('failed');
    expect(projection.toolCalls[0]?.reasonCode).toBe('timeout');
  });

  it('command lifecycle: started → completed', () => {
    const projection = projectConversation([
      makeEvent(
        'command_started',
        {
          command_name: '/new',
          summary: 'Creating new session',
          status: 'started',
        },
        { event_id: 'e1' },
      ),
      makeEvent(
        'command_completed',
        {
          command_name: '/new',
          summary: 'Archived and created',
          status: 'completed',
          old_session_id: 's1',
          new_session_id: 's2',
        },
        { event_id: 'e2' },
      ),
    ]);
    expect(projection.commands).toHaveLength(2);
    expect(projection.commands[1]?.status).toBe('completed');
    expect(projection.commands[1]?.newSessionId).toBe('s2');
  });

  it('stream_error surfaces error state', () => {
    const projection = projectConversation([
      makeEvent(
        'stream_error',
        {
          message: 'Connection lost',
          retryable: true,
          reason_code: 'network',
        },
        { event_id: 'e1' },
      ),
    ]);
    expect(projection.streamError?.message).toBe('Connection lost');
    expect(projection.streamError?.retryable).toBe(true);
  });

  it('unknown events are preserved in unknownEvents', () => {
    const unknownEvent = makeEvent(
      'unknown',
      {
        summary: 'Weird thing happened',
        raw: { detail: 42 },
      },
      { event_id: 'e1' },
    );
    const projection = projectConversation([unknownEvent]);
    expect(projection.unknownEvents).toHaveLength(1);
    expect(projection.unknownEvents[0]?.event_id).toBe('e1');
  });
});

describe('inline tool/command blocks', () => {
  it('renders a tool_call as an inline collapsible block on the assistant message', () => {
    const projection = projectConversation([
      makeEvent('assistant_text_delta', {
        message_id: 'a1',
        delta: 'Let me look that up. ',
      }),
      makeEvent('tool_call_started', {
        tool_call_id: 'tc1',
        tool_name: 'search_lore',
        summary: 'Searching lore for "amber lantern"',
      }),
    ]);

    const blocks = projection.messages[0]?.blocks ?? [];
    const toolBlock = blocks.find((b) => b.kind === 'tool_call');
    expect(toolBlock?.id).toBe('tool-tc1');
    expect(toolBlock?.renderPolicy).toBe('collapsed');
    expect(toolBlock?.tool?.name).toBe('search_lore');
    expect(toolBlock?.tool?.status).toBe('running');
    // Still mirrored in the separate collection for the debug inspector.
    expect(projection.toolCalls).toHaveLength(1);
  });

  it('updates the same block in place across started → completed', () => {
    const projection = projectConversation([
      makeEvent('assistant_text_delta', { message_id: 'a1', delta: 'x' }),
      makeEvent('tool_call_started', {
        tool_call_id: 'tc1',
        tool_name: 'search_lore',
        summary: 'searching',
      }),
      makeEvent('tool_call_completed', {
        tool_call_id: 'tc1',
        tool_name: 'search_lore',
        summary: 'searching',
        result_ref: { hits: 3 },
      }),
    ]);
    const toolBlocks =
      projection.messages[0]?.blocks.filter((b) => b.kind === 'tool_call') ??
      [];
    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]?.tool?.status).toBe('completed');
    expect(toolBlocks[0]?.content).toContain('hits');
  });

  it('interleaves text and tool blocks in chronological order', () => {
    const projection = projectConversation([
      makeEvent('assistant_text_delta', { message_id: 'a1', delta: 'before ' }),
      makeEvent('tool_call_started', {
        tool_call_id: 'tc1',
        tool_name: 'search_lore',
        summary: 's',
      }),
      makeEvent('assistant_text_delta', { message_id: 'a1', delta: 'after' }),
    ]);
    const kinds = projection.messages[0]?.blocks.map((b) => b.kind) ?? [];
    expect(kinds).toEqual(['text', 'tool_call', 'text']);
    const texts = projection.messages[0]?.blocks
      .filter((b) => b.kind === 'text')
      .map((b) => b.content);
    expect(texts).toEqual(['before ', 'after']);
  });

  it('accepts the live backend tool shape (wake_id, no summary, is_error)', () => {
    const projection = projectConversation([
      makeEvent('assistant_text_delta', { wake_id: 'w1', text: 'working ' }),
      makeEvent('tool_call_started', {
        wake_id: 'w1',
        tool_name: 'git_status',
      }),
      makeEvent('tool_call_completed', {
        wake_id: 'w1',
        tool_name: 'git_status',
        is_error: false,
      }),
    ]);
    const toolBlocks =
      projection.messages[0]?.blocks.filter((b) => b.kind === 'tool_call') ??
      [];
    expect(toolBlocks).toHaveLength(1);
    expect(toolBlocks[0]?.id).toBe('tool-w1');
    expect(toolBlocks[0]?.tool?.name).toBe('git_status');
    expect(toolBlocks[0]?.tool?.status).toBe('completed');
    // No summary on the wire — falls back to the tool name.
    expect(toolBlocks[0]?.tool?.summary).toBe('git_status');
  });

  it('treats a completed event with is_error as a failure', () => {
    const projection = projectConversation([
      makeEvent('assistant_text_delta', { wake_id: 'w1', text: 'x' }),
      makeEvent('tool_call_completed', {
        wake_id: 'w1',
        tool_name: 'git_status',
        is_error: true,
      }),
    ]);
    const toolBlock = projection.messages[0]?.blocks.find(
      (b) => b.kind === 'tool_call',
    );
    expect(toolBlock?.tool?.status).toBe('failed');
  });

  it('marks a failed tool block with status failed and reason', () => {
    const projection = projectConversation([
      makeEvent('assistant_text_delta', { message_id: 'a1', delta: 'x' }),
      makeEvent('tool_call_failed', {
        tool_call_id: 'tc1',
        tool_name: 'search_lore',
        summary: 's',
        reason_code: 'timeout',
      }),
    ]);
    const toolBlock = projection.messages[0]?.blocks.find(
      (b) => b.kind === 'tool_call',
    );
    expect(toolBlock?.tool?.status).toBe('failed');
    expect(toolBlock?.tool?.reasonCode).toBe('timeout');
    expect(toolBlock?.content).toBe('timeout');
  });
});

describe('command lifecycle events', () => {
  it('projects command_started into a running command block', () => {
    const projection = projectConversation([
      makeEvent('command_started', {
        command_name: '/status',
        summary: 'Checking status',
        status: 'started',
      }),
    ]);
    expect(projection.commands).toHaveLength(1);
    expect(projection.commands[0]?.commandName).toBe('/status');
    expect(projection.commands[0]?.status).toBe('started');

    const cmdBlock = projection.messages[0]?.blocks.find(
      (b) => b.kind === 'command',
    );
    expect(cmdBlock?.tool?.name).toBe('/status');
    expect(cmdBlock?.tool?.status).toBe('running');
  });

  it('upgrades command block from started to completed in place', () => {
    const projection = projectConversation([
      makeEvent('command_started', {
        command_name: '/new',
        summary: 'Starting',
        status: 'started',
      }),
      makeEvent('command_completed', {
        command_name: '/new',
        summary: 'Created session abc',
        status: 'completed',
        new_session_id: 'new-sess',
      }),
    ]);
    // The commands log is append-only.
    expect(projection.commands).toHaveLength(2);
    expect(projection.commands[1]?.status).toBe('completed');
    // The inline block is upserted in place.
    const cmdBlock = projection.messages[0]?.blocks.find(
      (b) => b.kind === 'command',
    );
    expect(cmdBlock?.tool?.status).toBe('completed');
  });

  it('marks a command block as failed with reason code', () => {
    const projection = projectConversation([
      makeEvent('command_started', {
        command_name: '/reload',
        summary: 'Reloading',
        status: 'started',
      }),
      makeEvent('command_failed', {
        command_name: '/reload',
        summary: 'Not allowed',
        status: 'failed',
        reason_code: 'forbidden',
      }),
    ]);
    const cmdBlock = projection.messages[0]?.blocks.find(
      (b) => b.kind === 'command',
    );
    expect(cmdBlock?.tool?.status).toBe('failed');
    expect(cmdBlock?.tool?.reasonCode).toBe('forbidden');
  });

  it('ignores malformed command payloads without crashing', () => {
    const projection = projectConversation([
      makeEvent('command_started', {
        summary: 'oops',
        status: 'started',
      } as never),
    ]);
    expect(projection.commands).toHaveLength(0);
    expect(projection.messages).toHaveLength(0);
  });
});
