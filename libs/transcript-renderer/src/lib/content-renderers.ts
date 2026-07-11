import { InjectionToken, type Type } from '@angular/core';
import type {
  ChatMessage,
  MessageBlock,
  ToolCallDebugDetail,
} from '@rusty-view/chat-domain';

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

export type ToolCallDebugDetailLoader = (
  sessionId: string,
  debugDetailId: string,
) => Promise<ToolCallDebugDetail>;

export const TOOL_CALL_DEBUG_DETAIL_LOADER =
  new InjectionToken<ToolCallDebugDetailLoader>(
    'TOOL_CALL_DEBUG_DETAIL_LOADER',
  );

export interface MessageBlockDetail {
  readonly content: string;
  readonly truncated: boolean;
  readonly redactedKeys: readonly string[];
}

export type MessageBlockDetailLoader = (
  block: MessageBlock,
  message: ChatMessage | undefined,
) => Promise<MessageBlockDetail>;

export const MESSAGE_BLOCK_DETAIL_LOADER =
  new InjectionToken<MessageBlockDetailLoader>('MESSAGE_BLOCK_DETAIL_LOADER');
