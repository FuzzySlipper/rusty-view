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
  it('keeps distinct Codex items from one active turn in one stable row', () => {
    const turn = 'thread-1:turn-1';
    const before = projectTranscriptVirtualRows(
      [
        message('reasoning', {
          status: 'streaming',
          thread: 'thread-1',
          turn: 'turn-1',
        }),
      ],
      new Set([turn]),
    );
    const after = projectTranscriptVirtualRows(
      [
        message('reasoning', {
          status: 'completed',
          thread: 'thread-1',
          turn: 'turn-1',
        }),
        message('command', {
          status: 'completed',
          thread: 'thread-1',
          turn: 'turn-1',
        }),
        message('final', {
          status: 'streaming',
          thread: 'thread-1',
          turn: 'turn-1',
        }),
      ],
      new Set([turn]),
    );

    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.messages.map((entry) => entry.id)).toEqual([
      'reasoning',
      'command',
      'final',
    ]);
  });

  it('keeps a remembered turn grouped after its messages become terminal', () => {
    const rows = projectTranscriptVirtualRows(
      [
        message('reasoning', {
          thread: 'thread-1',
          turn: 'turn-1',
        }),
        message('final', {
          thread: 'thread-1',
          turn: 'turn-1',
        }),
      ],
      new Set(['thread-1:turn-1']),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.messages).toHaveLength(2);
  });

  it('does not merge user prompts or separate turns into an active turn row', () => {
    const rows = projectTranscriptVirtualRows(
      [
        message('prompt', {
          role: 'user',
          thread: 'thread-1',
          turn: 'turn-1',
        }),
        message('reasoning', {
          status: 'streaming',
          thread: 'thread-1',
          turn: 'turn-1',
        }),
        message('next-turn', {
          status: 'streaming',
          thread: 'thread-1',
          turn: 'turn-2',
        }),
      ],
      new Set(['thread-1:turn-1', 'thread-1:turn-2']),
    );

    expect(rows.map((row) => row.messages.map((entry) => entry.id))).toEqual([
      ['prompt'],
      ['reasoning'],
      ['next-turn'],
    ]);
  });
});
