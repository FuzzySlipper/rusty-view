import {
  activeMessageForSlot,
  activeMessageVariant,
  messageAlternateSlot,
  orderedMessageVariants,
  withActiveMessageVariant,
} from '../index';
import type { ChatMessage, MessageVariant } from '../index';

import { describe, expect, it } from 'vitest';

function makeMessage(id: string, content: string): ChatMessage {
  return {
    id,
    sessionId: 'sess_1',
    author: { role: 'assistant', displayName: 'Assistant' },
    createdAt: '2026-06-24T10:00:00Z',
    status: 'completed',
    metadata: { providerMessageId: `${id}_provider` },
    blocks: [
      {
        id: `${id}_text`,
        messageId: id,
        kind: 'text',
        content,
        estimatedHeight: undefined,
        renderPolicy: 'full',
        metadata: { tokenCount: content.length },
      },
    ],
  };
}

function makeAlternate(
  slotId: string,
  id: string,
  ordinal: number,
  content: string,
): MessageVariant {
  return {
    id,
    slotId,
    source: 'alternate',
    ordinal,
    message: makeMessage(id, content),
    metadata: { generatedBy: 'retry' },
  };
}

describe('message alternates', () => {
  it('models a stable slot with an active primary message by default', () => {
    const primary = makeMessage('m1', 'primary');
    const slot = messageAlternateSlot(primary);

    expect(slot.id).toBe('m1');
    expect(slot.activeVariantId).toBeUndefined();
    expect(activeMessageVariant(slot).source).toBe('primary');
    expect(activeMessageForSlot(slot)).toBe(primary);
  });

  it('switches active alternates locally while preserving full metadata', () => {
    const primary = makeMessage('m1', 'primary');
    const alternate = makeAlternate('m1', 'm1_alt_1', 1, 'alternate');
    const slot = messageAlternateSlot(primary, { alternates: [alternate] });

    const switched = withActiveMessageVariant(slot, 'm1_alt_1');
    const active = activeMessageVariant(switched);

    expect(switched.id).toBe('m1');
    expect(switched.activeVariantId).toBe('m1_alt_1');
    expect(active).toBe(alternate);
    expect(active.message.metadata).toEqual({
      providerMessageId: 'm1_alt_1_provider',
    });
    expect(active.message.blocks[0]?.metadata).toEqual({ tokenCount: 9 });
    expect(active.metadata).toEqual({ generatedBy: 'retry' });
  });

  it('keeps variants ordered with the primary first', () => {
    const primary = makeMessage('m1', 'primary');
    const slot = messageAlternateSlot(primary, {
      alternates: [
        makeAlternate('m1', 'm1_alt_2', 2, 'second'),
        makeAlternate('m1', 'm1_alt_1', 1, 'first'),
      ],
    });

    expect(orderedMessageVariants(slot).map((variant) => variant.id)).toEqual([
      'm1',
      'm1_alt_1',
      'm1_alt_2',
    ]);
  });

  it('falls back to the primary variant for unknown active ids', () => {
    const primary = makeMessage('m1', 'primary');
    const slot = messageAlternateSlot(primary, {
      alternates: [makeAlternate('m1', 'm1_alt_1', 1, 'alternate')],
    });

    const switched = withActiveMessageVariant(slot, 'missing');

    expect(switched.activeVariantId).toBeUndefined();
    expect(activeMessageForSlot(switched)).toBe(primary);
  });
});
