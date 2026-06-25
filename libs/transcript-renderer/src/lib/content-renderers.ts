import { InjectionToken, type Type } from '@angular/core';
import type { ChatMessage, MessageBlock } from '@rusty-view/chat-domain';

export interface ChatContentRenderContext {
  /** Parent message when the block is rendered through MessageItemComponent. */
  readonly message: ChatMessage | undefined;
  readonly block: MessageBlock;
  readonly sessionId: string | undefined;
}

/**
 * Registers a renderer for a block kind.
 *
 * The renderer component receives `block`, `message`, and `context` inputs.
 * Components should declare all three inputs even if they only use one of them;
 * Angular validates `NgComponentOutlet` inputs at runtime.
 */
export interface ChatContentRenderer {
  readonly type: string;
  readonly label?: string;
  readonly order?: number;
  readonly component: Type<unknown>;
  canRender?(context: ChatContentRenderContext): boolean;
}

export const CHAT_CONTENT_RENDERERS = new InjectionToken<
  readonly ChatContentRenderer[]
>('CHAT_CONTENT_RENDERERS');
