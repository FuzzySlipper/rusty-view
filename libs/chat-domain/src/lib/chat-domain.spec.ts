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

function attachmentRecord(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    attachment_id: 'att_1',
    session_id: 'sess_1',
    status: 'active',
    filename: 'generated.png',
    mime_type: 'image/png',
    byte_size: 4096,
    storage_url: 'file:///private/generated.png',
    download_url: '/v1/chat/sessions/sess_1/attachments/att_1/content',
    thumbnail_url: '/v1/chat/sessions/sess_1/attachments/att_1/thumbnail',
    extracted_text: null,
    extracted_text_truncated: false,
    metadata_json: { source: 'tool_media' },
    created_at: '2026-06-22T10:00:01Z',
    updated_at: '2026-06-22T10:00:01Z',
    expires_at: null,
    links: [],
    ...overrides,
  };
}

function attachmentLink(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    link_id: 'link_1',
    attachment_id: 'att_1',
    session_id: 'sess_1',
    message_id: 'assistant_1',
    block_id: 'assistant_1-attachment-att_1',
    scope_id: null,
    metadata_json: { source: 'tool_media' },
    created_at: '2026-06-22T10:00:02Z',
    ...overrides,
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

  it('keeps phase_change and provider_status known but transcript-neutral', () => {
    const projection = projectConversation([
      makeEvent(
        'phase_change',
        { phase: 'exploring', message: 'Gathering context' },
        { event_id: 'phase_1' },
      ),
      makeEvent(
        'provider_status',
        { level: 'info', message: 'provider stream connected' },
        { event_id: 'provider_1' },
      ),
    ]);

    expect(projection.latestCursor).toBe('provider_1');
    expect(projection.messages).toHaveLength(0);
    expect(projection.unknownEvents).toHaveLength(0);
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

  it('projects fresh session execution events and rejects stale regressions', () => {
    const session = {
      session_id: 'sess_1',
      agent_id: 'agent_1',
      profile_id: 'prof_1',
      kind: 'full' as const,
      status: 'idle' as const,
      execution: {
        sessionId: 'sess_1',
        lifecycleStatus: 'live' as const,
        phase: 'idle' as const,
        source: 'logical_turn' as const,
        lastOutcome: 'completed' as const,
        updatedAt: '2026-07-30T09:00:03Z',
      },
      latest_cursor: 'cur_0',
      updated_at: '2026-07-30T09:00:03Z',
    };
    const projection = projectConversation([
      makeEvent('session_snapshot', { session }, { sequence_id: 1 }),
      makeEvent(
        'session_execution_changed',
        {
          execution: {
            ...session.execution,
            phase: 'active',
            lastOutcome: null,
            updatedAt: '2026-07-30T09:00:01Z',
          },
        },
        { sequence_id: 2 },
      ),
    ]);

    expect(projection.sessionMetadata?.execution.phase).toBe('idle');
    expect(projection.sessionMetadata?.execution.lastOutcome).toBe('completed');
    expect(projection.sessionMetadata?.status).toBe('idle');
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

  it('preserves streamed assistant deltas when completion only carries a terminal summary', () => {
    const projection = projectConversation([
      makeEvent('assistant_turn_started', {}, { event_id: 'e1' }),
      makeEvent(
        'assistant_text_delta',
        { wake_id: 'wake-1', text: 'Actual long answer. ' },
        { event_id: 'e2' },
      ),
      makeEvent(
        'assistant_text_delta',
        { wake_id: 'wake-1', text: 'Second paragraph.' },
        { event_id: 'e3' },
      ),
      makeEvent(
        'assistant_message_completed',
        {
          wake_id: 'wake-1',
          status: 'completed',
          summary: 'responses replay wake completed',
        },
        { event_id: 'e4' },
      ),
      makeEvent('assistant_turn_finished', {}, { event_id: 'e5' }),
    ]);

    const message = projection.messages[0];
    expect(message?.status).toBe('completed');
    expect(message?.blocks[0]?.content).toBe(
      'Actual long answer. Second paragraph.',
    );
    expect(message?.blocks[0]?.content).not.toBe(
      'responses replay wake completed',
    );
    expect(projection.activeTurn).toBeUndefined();
  });

  it('materializes a completion-tool-only summary as terminal assistant text', () => {
    const projection = projectConversation([
      makeEvent(
        'tool_call_started',
        {
          wake_id: 'wake-delivery',
          tool_call_id: 'delivery-1',
          tool_name: 'deliver_completion_md',
        },
        { event_id: 'e1' },
      ),
      makeEvent(
        'tool_call_completed',
        {
          wake_id: 'wake-delivery',
          tool_call_id: 'delivery-1',
          tool_name: 'deliver_completion_md',
          is_error: false,
        },
        { event_id: 'e2' },
      ),
      makeEvent(
        'assistant_message_completed',
        {
          wake_id: 'wake-delivery',
          status: 'completed',
          summary: '# Final result\n\nEverything passed.',
        },
        { event_id: 'e3' },
      ),
    ]);

    expect(projection.messages).toHaveLength(1);
    expect(projection.messages[0]?.id).toBe('asst:wake-delivery');
    expect(projection.messages[0]?.status).toBe('completed');
    expect(
      projection.messages[0]?.blocks.find((block) => block.kind === 'text')
        ?.content,
    ).toBe('# Final result\n\nEverything passed.');
  });

  it('reconciles a delivered completion summary onto its draft idempotently', () => {
    const beforeCompletion = projectConversation([
      makeEvent(
        'assistant_text_delta',
        { wake_id: 'wake-delivery', text: 'Preparing final response.' },
        { event_id: 'e1' },
      ),
      makeEvent(
        'tool_call_started',
        {
          wake_id: 'wake-delivery',
          tool_call_id: 'delivery-1',
          tool_name: 'deliver_completion_md',
        },
        { event_id: 'e2' },
      ),
      makeEvent(
        'tool_call_completed',
        {
          wake_id: 'wake-delivery',
          tool_call_id: 'delivery-1',
          tool_name: 'deliver_completion_md',
          is_error: false,
        },
        { event_id: 'e3' },
      ),
    ]);
    const completion = makeEvent(
      'assistant_message_completed',
      {
        wake_id: 'wake-delivery',
        status: 'completed',
        summary: '# Final result\n\nEverything passed.',
      },
      { event_id: 'e4' },
    );

    const completed = projectConversation([completion], beforeCompletion);
    const replayed = projectConversation([completion], completed);
    const text = replayed.messages[0]?.blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.content);

    expect(replayed.messages).toHaveLength(1);
    expect(replayed.messages[0]?.id).toBe('asst:wake-delivery');
    expect(replayed.messages[0]?.status).toBe('completed');
    expect(text).toEqual([
      'Preparing final response.',
      '# Final result\n\nEverything passed.',
    ]);
  });

  it('materializes an orphaned non-empty terminal summary with a replay-stable id', () => {
    const completion = makeEvent(
      'assistant_message_completed',
      { status: 'completed', summary: 'Recovered terminal answer.' },
      { event_id: 'completion-only' },
    );

    const completed = projectConversation([completion]);
    const replayed = projectConversation([completion], completed);

    expect(replayed.messages).toHaveLength(1);
    expect(replayed.messages[0]?.id).toBe('asst:completion-only');
    expect(replayed.messages[0]?.blocks[0]?.content).toBe(
      'Recovered terminal answer.',
    );
  });

  it('renders wake timeout completions as service notices without replacing streamed text', () => {
    const projection = projectConversation([
      makeEvent('assistant_turn_started', {}, { event_id: 'e1' }),
      makeEvent(
        'assistant_text_delta',
        { wake_id: 'wake-1', text: 'Partial answer before cap.' },
        { event_id: 'e2' },
      ),
      makeEvent(
        'assistant_message_completed',
        {
          wake_id: 'wake-1',
          status: 'failed',
          reason_code: 'wake_timeout',
          summary: 'wake wake-1 exceeded service turn cap 45000 ms',
          timeout_ms: 45_000,
        } as ChatEvent['payload'],
        { event_id: 'e3' },
      ),
    ]);

    const message = projection.messages[0];
    expect(message?.status).toBe('error');
    expect(message?.blocks[0]?.kind).toBe('text');
    expect(message?.blocks[0]?.content).toBe('Partial answer before cap.');
    const notice = message?.blocks.find(
      (block) => block.kind === 'service_notice',
    );
    expect(notice?.content).toContain('service turn cap');
    expect(notice?.metadata?.['reasonCode']).toBe('wake_timeout');
    expect(notice?.metadata?.['timeoutMs']).toBe(45_000);
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

  it('carries tool debug detail ids from payload or metadata into projections and blocks', () => {
    const projection = projectConversation([
      makeEvent('assistant_text_delta', { message_id: 'a1', delta: 'x' }),
      makeEvent(
        'tool_call_started',
        {
          tool_call_id: 'tc1',
          tool_name: 'search_lore',
          summary: 'Searched for amber',
          debug_detail_id: 'dbg_top',
          metadata: { debugDetailId: 'dbg_meta' },
        },
        { event_id: 'e1' },
      ),
      makeEvent(
        'tool_call_completed',
        {
          tool_call_id: 'tc1',
          tool_name: 'search_lore',
          summary: 'Found 3 entries',
          metadata: { debugDetailId: 'dbg_meta' },
        },
        { event_id: 'e2' },
      ),
    ]);
    const toolBlock = projection.messages[0]?.blocks.find(
      (b) => b.kind === 'tool_call',
    );
    expect(projection.toolCalls[0]?.debugDetailId).toBe('dbg_meta');
    expect(toolBlock?.tool?.debugDetailId).toBe('dbg_meta');
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

describe('attachment lifecycle projection', () => {
  it('links a generated image into its target message with browser-safe URLs', () => {
    const record = attachmentRecord();
    const link = attachmentLink();
    const projection = projectConversation([
      makeEvent('message_created', {
        message_id: 'assistant_1',
        role: 'assistant',
        body: 'Here is the generated image.',
      }),
      makeEvent('attachment_uploaded', { attachment: record }),
      makeEvent('attachment_linked', {
        attachment_id: 'att_1',
        attachment: { ...record, links: [link] },
        link,
      }),
    ]);

    expect(projection.attachments).toHaveLength(1);
    const block = projection.messages[0]?.blocks.find(
      (candidate) => candidate.kind === 'attachment',
    );
    expect(block?.id).toBe('assistant_1-attachment-att_1');
    expect(block?.attachment).toMatchObject({
      id: 'att_1',
      status: 'active',
      kind: 'image',
      name: 'generated.png',
      url: '/v1/chat/sessions/sess_1/attachments/att_1/content',
      thumbnailUrl: '/v1/chat/sessions/sess_1/attachments/att_1/thumbnail',
    });
    expect(block?.attachment?.url).not.toContain('file:');
  });

  it('retains a link that arrives before its target message', () => {
    const record = attachmentRecord();
    const link = attachmentLink();
    const projection = projectConversation([
      makeEvent('attachment_linked', {
        attachment_id: 'att_1',
        attachment: { ...record, links: [link] },
        link,
      }),
      makeEvent('message_created', {
        message_id: 'assistant_1',
        role: 'assistant',
        body: 'Late message.',
      }),
    ]);

    expect(
      projection.messages[0]?.blocks.filter(
        (candidate) => candidate.kind === 'attachment',
      ),
    ).toHaveLength(1);
  });

  it('updates and removes one stable block across replayed duplicate events', () => {
    const link = attachmentLink();
    const initial = attachmentRecord({ links: [link] });
    const updated = attachmentRecord({
      download_url: '/content/revised',
      thumbnail_url: '/thumbnail/revised',
      updated_at: '2026-06-22T10:00:03Z',
      links: [link],
    });
    const removed = attachmentRecord({
      status: 'removed',
      updated_at: '2026-06-22T10:00:04Z',
      links: [link],
    });
    const projection = projectConversation([
      makeEvent('message_created', {
        message_id: 'assistant_1',
        role: 'assistant',
        body: 'Image lifecycle.',
      }),
      makeEvent('attachment_linked', {
        attachment_id: 'att_1',
        attachment: initial,
        link,
      }),
      makeEvent('attachment_linked', {
        attachment_id: 'att_1',
        attachment: initial,
        link,
      }),
      makeEvent('attachment_updated', {
        attachment_id: 'att_1',
        attachment: updated,
      }),
      makeEvent('attachment_removed', {
        attachment_id: 'att_1',
        attachment: removed,
      }),
      // A stale replay after reconnect must not resurrect the removed image.
      makeEvent('attachment_linked', {
        attachment_id: 'att_1',
        attachment: initial,
        link,
      }),
    ]);

    const blocks =
      projection.messages[0]?.blocks.filter(
        (candidate) => candidate.kind === 'attachment',
      ) ?? [];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.id).toBe('assistant_1-attachment-att_1');
    expect(blocks[0]?.attachment?.status).toBe('removed');
    expect(projection.attachments[0]?.updatedAt).toBe('2026-06-22T10:00:04Z');
  });

  it('preserves pending attachment state across incremental replay', () => {
    const link = attachmentLink();
    const base = projectConversation([
      makeEvent('attachment_linked', {
        attachment_id: 'att_1',
        attachment: attachmentRecord({ links: [link] }),
        link,
      }),
    ]);
    const projection = projectConversation(
      [
        makeEvent('message_created', {
          message_id: 'assistant_1',
          role: 'assistant',
          body: 'Loaded after reconnect.',
        }),
      ],
      base,
    );

    expect(
      projection.messages[0]?.blocks.some(
        (candidate) => candidate.kind === 'attachment',
      ),
    ).toBe(true);
  });

  it('projects missing download URLs as an unavailable attachment', () => {
    const link = attachmentLink();
    const projection = projectConversation([
      makeEvent('message_created', {
        message_id: 'assistant_1',
        role: 'assistant',
        body: 'No media URL.',
      }),
      makeEvent('attachment_linked', {
        attachment_id: 'att_1',
        attachment: attachmentRecord({
          download_url: null,
          thumbnail_url: null,
          links: [link],
        }),
        link,
      }),
    ]);

    const attachment = projection.messages[0]?.blocks.find(
      (candidate) => candidate.kind === 'attachment',
    )?.attachment;
    expect(attachment?.url).toBeUndefined();
    expect(attachment?.thumbnailUrl).toBeUndefined();
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

  it('uses debug_detail_id as a stable identity for legacy Crew tool events', () => {
    const projection = projectConversation([
      makeEvent('assistant_text_delta', { wake_id: 'w1', text: 'working ' }),
      makeEvent('tool_call_started', {
        wake_id: 'w1',
        debug_detail_id: 'dbg_terminal',
        tool_name: 'terminal',
      }),
      makeEvent('tool_call_completed', {
        wake_id: 'w1',
        debug_detail_id: 'dbg_terminal',
        tool_name: 'terminal',
        is_error: false,
      }),
      makeEvent('tool_call_started', {
        wake_id: 'w1',
        debug_detail_id: 'dbg_read_file',
        tool_name: 'read_file',
      }),
      makeEvent('tool_call_completed', {
        wake_id: 'w1',
        debug_detail_id: 'dbg_read_file',
        tool_name: 'read_file',
        is_error: false,
      }),
    ]);

    expect(projection.toolCalls.map((call) => call.toolCallId)).toEqual([
      'dbg_terminal',
      'dbg_read_file',
    ]);
    const toolBlocks =
      projection.messages[0]?.blocks.filter((b) => b.kind === 'tool_call') ??
      [];
    expect(toolBlocks.map((block) => block.id)).toEqual([
      'tool-dbg_terminal',
      'tool-dbg_read_file',
    ]);
    expect(toolBlocks.map((block) => block.tool?.status)).toEqual([
      'completed',
      'completed',
    ]);
  });

  it('uses metadata.debugDetailId before wake_id when tool_call_id is absent', () => {
    const projection = projectConversation([
      makeEvent('assistant_text_delta', { wake_id: 'w1', text: 'working ' }),
      makeEvent('tool_call_started', {
        wake_id: 'w1',
        metadata: { debugDetailId: 'dbg_meta' },
        tool_name: 'read_file',
      }),
    ]);

    expect(projection.toolCalls[0]?.toolCallId).toBe('dbg_meta');
    const toolBlock = projection.messages[0]?.blocks.find(
      (b) => b.kind === 'tool_call',
    );
    expect(toolBlock?.id).toBe('tool-dbg_meta');
    expect(toolBlock?.tool?.debugDetailId).toBe('dbg_meta');
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

  it('adopts a tool-only placeholder into the later real assistant wake message', () => {
    const projection = projectConversation([
      makeEvent('assistant_turn_started', {}, { event_id: 'e1' }),
      makeEvent(
        'tool_call_started',
        {
          wake_id: 'tool-wake',
          tool_name: 'env_default_get_messages',
        },
        { event_id: 'sess:586' },
      ),
      makeEvent(
        'tool_call_completed',
        {
          wake_id: 'tool-wake',
          tool_name: 'env_default_get_messages',
          is_error: false,
        },
        { event_id: 'sess:587' },
      ),
      makeEvent(
        'assistant_reasoning_delta',
        {
          wake_id: 'service-sess-4',
          text: 'thinking',
          visibility: 'reasoning',
        },
        { event_id: 'sess:588' },
      ),
      makeEvent(
        'assistant_text_delta',
        { wake_id: 'service-sess-4', text: 'done' },
        { event_id: 'sess:589' },
      ),
      makeEvent(
        'assistant_message_completed',
        { wake_id: 'service-sess-4', body: 'done' },
        { event_id: 'sess:590' },
      ),
      makeEvent('assistant_turn_finished', {}, { event_id: 'sess:591' }),
    ]);

    expect(projection.messages).toHaveLength(1);
    const message = projection.messages[0];
    expect(message?.id).toBe('asst:service-sess-4');
    expect(message?.status).toBe('completed');
    expect(message?.blocks.map((block) => block.kind)).toEqual([
      'tool_call',
      'reasoning',
      'text',
    ]);
    expect(message?.blocks[0]?.tool?.status).toBe('completed');
    expect(projection.activeTurn).toBeUndefined();
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
