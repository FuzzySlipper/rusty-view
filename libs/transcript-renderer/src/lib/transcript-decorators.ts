import { InjectionToken } from '@angular/core';
import type { ChatMessage } from '@rusty-view/chat-domain';

/**
 * Extension token for message decoration.
 *
 * The base transcript renderer is product-agnostic. Downstream consumers
 * provide decorators via this multi-provider token to add styling, prefixes,
 * suffixes, or metadata to specific messages without modifying the renderer.
 *
 * Example provider:
 *   { provide: CHAT_MESSAGE_DECORATORS, multi: true, useValue: myDecorator }
 */
export interface ChatMessageDecorator {
  /** Unique kind identifier for this decorator (e.g. 'consumer-highlight'). */
  readonly kind: string;
  /** Return true if this decorator applies to the given message. */
  canDecorate(message: ChatMessage): boolean;
  /** Return decoration metadata for the renderer to apply. */
  decorate(message: ChatMessage): ChatMessageDecoration;
}

export interface ChatMessageDecoration {
  readonly className: string | undefined;
  readonly prefix: string | undefined;
  readonly suffix: string | undefined;
}

export const CHAT_MESSAGE_DECORATORS = new InjectionToken<
  readonly ChatMessageDecorator[]
>('CHAT_MESSAGE_DECORATORS', {
  providedIn: 'root',
  factory: (): readonly ChatMessageDecorator[] => [],
});
