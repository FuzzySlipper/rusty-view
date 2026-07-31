import type { ChatMessage, MessageBlock } from '@rusty-view/chat-domain';
import { describe, expect, it } from 'vitest';

import { projectTranscriptVirtualRows } from './transcript-viewport';

function message(
  id: string,
  options: {
    readonly role?: ChatMessage['author']['role'];
    readonly status?: ChatMessage['status'];
    readonly thread?: string;
    readonly turn?: string;
  } = {},
): ChatMessage {
  const block: MessageBlock = {
    id: `${id}:block`,
    messageId: id,
    kind: 'text',
    content: id,
    estimatedHeight: undefined,
    renderPolicy: 'full',
  };
  return {
    id,
    sessionId: 'session',
    author: {
      role: options.role ?? 'assistant',
      displayName: undefined,
    },
    createdAt: '2026-07-24T00:00:00.000Z',
    status: options.status ?? 'completed',
    blocks: [block],
    ...(options.thread === undefined || options.turn === undefined
      ? {}
      : {
          metadata: {
            nativeThreadId: options.thread,
            nativeTurnId: options.turn,
          },
        }),
  };
}

describe('projectTranscriptVirtualRows', () => {
  it('keeps a growing Codex turn message in one stable row', () => {
    const projected = message('assistant-turn', {
      status: 'streaming',
      thread: 'thread-1',
      turn: 'turn-1',
    });
    const baseBlock = projected.blocks[0];
    if (baseBlock === undefined) throw new Error('fixture block missing');
    const before = projectTranscriptVirtualRows([projected]);
    const after = projectTranscriptVirtualRows([
      {
        ...projected,
        blocks: [
          ...projected.blocks,
          { ...baseBlock, id: 'command:block', kind: 'command' },
          { ...baseBlock, id: 'final:block', content: 'final' },
        ],
      },
    ]);

    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.messages[0]?.blocks).toHaveLength(3);
  });

  it('does not retain stateful grouping after a turn becomes terminal', () => {
    const terminal = message('assistant-turn', {
      thread: 'thread-1',
      turn: 'turn-1',
    });
    const rows = projectTranscriptVirtualRows([terminal]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('message:assistant-turn');
    expect(rows[0]?.messages).toEqual([terminal]);
  });

  it('keeps user prompts and separate turns in separate rows', () => {
    const rows = projectTranscriptVirtualRows([
      message('prompt', {
        role: 'user',
        thread: 'thread-1',
        turn: 'turn-1',
      }),
      message('assistant-turn', {
        status: 'streaming',
        thread: 'thread-1',
        turn: 'turn-1',
      }),
      message('next-turn', {
        status: 'streaming',
        thread: 'thread-1',
        turn: 'turn-2',
      }),
    ]);

    expect(rows.map((row) => row.messages.map((entry) => entry.id))).toEqual([
      ['prompt'],
      ['assistant-turn'],
      ['next-turn'],
    ]);
  });
});
