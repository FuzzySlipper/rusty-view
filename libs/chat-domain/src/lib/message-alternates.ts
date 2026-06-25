import type {
  ChatMessage,
  MessageAlternateSlot,
  MessageMetadata,
  MessageVariant,
} from './domain-types';

export interface MessageAlternateSlotOptions {
  readonly slotId?: string;
  readonly activeVariantId?: string;
  readonly alternates?: readonly MessageVariant[];
  readonly metadata?: MessageMetadata;
}

export function primaryMessageVariant(
  message: ChatMessage,
  slotId = message.id,
): MessageVariant {
  return {
    id: message.id,
    slotId,
    source: 'primary',
    ordinal: 0,
    message,
  };
}

export function messageAlternateSlot(
  primaryMessage: ChatMessage,
  options: MessageAlternateSlotOptions = {},
): MessageAlternateSlot {
  const slotId = options.slotId ?? primaryMessage.id;
  const primary = primaryMessageVariant(primaryMessage, slotId);
  const slot: MessageAlternateSlot = {
    id: slotId,
    sessionId: primaryMessage.sessionId,
    primary,
    alternates: options.alternates ?? [],
    activeVariantId: undefined,
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };

  return withActiveMessageVariant(slot, options.activeVariantId);
}

export function orderedMessageVariants(
  slot: MessageAlternateSlot,
): readonly MessageVariant[] {
  return [
    slot.primary,
    ...[...slot.alternates].sort((a, b) => a.ordinal - b.ordinal),
  ];
}

export function findMessageVariant(
  slot: MessageAlternateSlot,
  variantId: string | undefined,
): MessageVariant | undefined {
  if (variantId === undefined || variantId === slot.primary.id) {
    return slot.primary;
  }

  return slot.alternates.find((variant) => variant.id === variantId);
}

export function activeMessageVariant(
  slot: MessageAlternateSlot,
): MessageVariant {
  return findMessageVariant(slot, slot.activeVariantId) ?? slot.primary;
}

export function activeMessageForSlot(slot: MessageAlternateSlot): ChatMessage {
  return activeMessageVariant(slot).message;
}

export function withActiveMessageVariant(
  slot: MessageAlternateSlot,
  variantId: string | undefined,
): MessageAlternateSlot {
  const variant = findMessageVariant(slot, variantId);

  return {
    ...slot,
    activeVariantId:
      variant === undefined || variant.source === 'primary'
        ? undefined
        : variant.id,
  };
}
