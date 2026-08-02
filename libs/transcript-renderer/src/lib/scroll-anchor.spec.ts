import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@rusty-view/chat-domain';
import {
  transcriptSearchSeekKey,
  transcriptPresentationChanged,
  transcriptTailChanged,
} from './transcript-viewport';

/**
 * Projection identity helpers stay unit-tested here. Browser-owned paused
 * anchoring and prepend behavior are semantic Playwright contracts.
 */

function makeMessage(id: string): ChatMessage {
  return {
    id,
    sessionId: 's1',
    author: { role: 'user', displayName: undefined },
    createdAt: '2026-06-22T10:00:00Z',
    status: 'completed',
    blocks: [
      {
        id: `${id}-b0`,
        messageId: id,
        kind: 'text',
        content: `Message ${id}`,
        estimatedHeight: undefined,
        renderPolicy: 'full',
      },
    ],
  };
}

describe('transcriptTailChanged', () => {
  it('ignores idle projection refreshes with fresh but identical objects', () => {
    const previous = [makeMessage('a'), makeMessage('b')];
    const refreshed = [makeMessage('a'), makeMessage('b')];

    expect(transcriptTailChanged(previous, refreshed)).toBe(false);
  });

  it('detects streamed content growth at the tail', () => {
    const original = makeMessage('a');
    const originalBlock = original.blocks[0];
    if (originalBlock === undefined) throw new Error('expected message block');
    const previous = [original];
    const current: ChatMessage[] = [
      {
        ...original,
        status: 'streaming',
        blocks: [
          {
            ...originalBlock,
            content: 'Message a plus a streamed delta',
          },
        ],
      },
    ];

    expect(transcriptTailChanged(previous, current)).toBe(true);
  });

  it('detects streamed growth before an unchanged optimistic tail', () => {
    const assistant = {
      ...makeMessage('assistant'),
      author: { role: 'assistant' as const, displayName: 'Agent' },
      status: 'streaming' as const,
    };
    const assistantBlock = assistant.blocks[0];
    if (assistantBlock === undefined) throw new Error('expected message block');
    const optimistic = {
      ...makeMessage('optimistic-user'),
      metadata: { optimisticExternalUser: true },
    };
    const previous = [assistant, optimistic];
    const current: ChatMessage[] = [
      {
        ...assistant,
        blocks: [
          {
            ...assistantBlock,
            content: 'A longer streamed assistant update',
          },
        ],
      },
      optimistic,
    ];

    expect(transcriptTailChanged(previous, current)).toBe(true);
  });
});

describe('transcriptPresentationChanged', () => {
  it('ignores idle projections made of fresh but identical objects', () => {
    expect(
      transcriptPresentationChanged(
        [makeMessage('a'), makeMessage('b')],
        [makeMessage('a'), makeMessage('b')],
      ),
    ).toBe(false);
  });

  it('detects visible replacement content anywhere in the projection', () => {
    const original = makeMessage('a');
    const block = original.blocks[0];
    if (block === undefined) throw new Error('expected message block');
    const changed: ChatMessage = {
      ...original,
      blocks: [{ ...block, content: 'Reprojected content' }],
    };

    expect(
      transcriptPresentationChanged(
        [makeMessage('a'), makeMessage('b')],
        [changed, makeMessage('b')],
      ),
    ).toBe(true);
  });

  it('detects non-block presentation metadata instead of retaining a stale row', () => {
    const original = makeMessage('a');
    const changed = { ...original, metadata: { label: 'updated' } };

    expect(transcriptPresentationChanged([original], [changed])).toBe(true);
  });
});

describe('transcriptSearchSeekKey', () => {
  it('returns the same primitive for freshly allocated copies of one result', () => {
    expect(transcriptSearchSeekKey('needle', { id: 'm1:b1:0' })).toBe(
      transcriptSearchSeekKey('needle', { id: 'm1:b1:0' }),
    );
  });

  it('changes only when the selected stable result changes', () => {
    expect(transcriptSearchSeekKey('needle', { id: 'm1:b1:0' })).not.toBe(
      transcriptSearchSeekKey('needle', { id: 'm2:b1:0' }),
    );
    expect(transcriptSearchSeekKey('   ', { id: 'm1:b1:0' })).toBeUndefined();
  });
});
