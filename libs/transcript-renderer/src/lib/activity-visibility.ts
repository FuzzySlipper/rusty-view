import type { ChatMessage, MessageBlock } from '@rusty-view/chat-domain';

/**
 * Product-agnostic visibility policy for non-prose transcript activity.
 *
 * Visibility changes presentation only. Source messages and blocks stay
 * intact so a downstream host can reveal diagnostics without replaying or
 * reloading the conversation.
 */
export interface TranscriptActivityVisibility {
  readonly reasoning: boolean;
  readonly tools: boolean;
}

export const DEFAULT_TRANSCRIPT_ACTIVITY_VISIBILITY: TranscriptActivityVisibility =
  Object.freeze({
    reasoning: true,
    tools: true,
  });

const TOOL_ACTIVITY_KINDS = new Set([
  'tool_call',
  'tool_result',
  'debug',
  'command',
]);

export function isTranscriptBlockVisible(
  block: MessageBlock,
  visibility: TranscriptActivityVisibility,
): boolean {
  if (block.kind === 'reasoning') return visibility.reasoning;
  if (block.tool !== undefined || TOOL_ACTIVITY_KINDS.has(block.kind)) {
    return visibility.tools;
  }
  return true;
}

export function visibleTranscriptBlocks(
  message: ChatMessage,
  visibility: TranscriptActivityVisibility,
): readonly MessageBlock[] {
  const visible = message.blocks.filter((block) =>
    isTranscriptBlockVisible(block, visibility),
  );
  return visible.length === message.blocks.length ? message.blocks : visible;
}
