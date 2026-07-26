import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './domain-types';
import { searchConversationMessages } from './conversation-search';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    sessionId: 's1',
    author: { role: 'assistant', displayName: undefined },
    createdAt: '2026-06-24T12:00:00Z',
    status: 'completed',
    blocks: [
      {
        id: 'b1',
        messageId: 'm1',
        kind: 'text',
        content: 'The brass key is under the console.',
        estimatedHeight: undefined,
        renderPolicy: 'full',
      },
    ],
    ...overrides,
  };
}

describe('searchConversationMessages', () => {
  it('finds case-insensitive block content matches in conversation order', () => {
    const results = searchConversationMessages(
      [
        message({ id: 'm1' }),
        message({
          id: 'm2',
          blocks: [
            {
              id: 'b2',
              messageId: 'm2',
              kind: 'text',
              content: 'Another KEY appears.',
              estimatedHeight: undefined,
              renderPolicy: 'full',
            },
          ],
        }),
      ],
      'key',
    );

    expect(results.map((result) => result.messageId)).toEqual(['m1', 'm2']);
    expect(results[0]?.ordinal).toBe(1);
    expect(results[0]?.snippet).toContain('key');
  });

  it('applies role and date filters', () => {
    const results = searchConversationMessages(
      [
        message({
          id: 'user_old',
          author: { role: 'user', displayName: undefined },
          createdAt: '2026-06-23T12:00:00Z',
        }),
        message({
          id: 'assistant_current',
          author: { role: 'assistant', displayName: undefined },
          createdAt: '2026-06-24T12:00:00Z',
        }),
      ],
      'key',
      {
        roles: ['assistant'],
        dateFrom: '2026-06-24',
        dateTo: '2026-06-24',
      },
    );

    expect(results.map((result) => result.messageId)).toEqual([
      'assistant_current',
    ]);
  });

  it('includes attachment names and extracted text previews', () => {
    const results = searchConversationMessages(
      [
        message({
          blocks: [
            {
              id: 'file_block',
              messageId: 'm1',
              kind: 'attachment',
              content: '',
              estimatedHeight: undefined,
              renderPolicy: 'full',
              attachment: {
                id: 'a1',
                status: 'active',
                kind: 'file',
                name: 'notes.md',
                mimeType: 'text/markdown',
                sizeBytes: 12,
                url: undefined,
                thumbnailUrl: undefined,
                textPreview: {
                  text: 'needle inside attached notes',
                  truncated: false,
                },
                scopeId: undefined,
              },
            },
          ],
        }),
      ],
      'needle',
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.blockId).toBe('file_block');
  });
});
