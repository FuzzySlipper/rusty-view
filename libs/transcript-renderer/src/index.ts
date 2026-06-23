/**
 * @rusty-view/transcript-renderer
 *
 * Virtualized transcript rendering: 10k+ messages, streaming-safe delta
 * rendering, scroll anchoring, tail-follow, jump-to-message, collapsible
 * blocks, and roleplay-agnostic extension hooks.
 *
 * The virtualizer (Angular CDK) is hidden behind the public component API.
 * Implemented in Den task #3184.
 */

export { TranscriptViewportComponent } from './lib/transcript-viewport';
export { MessageItemComponent } from './lib/message-item';
export { MessageBlockComponent } from './lib/message-block';
export { CHAT_MESSAGE_DECORATORS } from './lib/transcript-decorators';
export type {
  ChatMessageDecorator,
  ChatMessageDecoration,
} from './lib/transcript-decorators';
export { WorkerManager } from './lib/worker-manager';
export type {
  WorkerRequest,
  WorkerResponse,
  WorkerOperationKind,
} from './lib/worker-message-protocol';
export { processRequestInline } from './lib/worker-inline-ops';

export const TRANSCRIPT_RENDERER_VERSION = '0.0.0' as const;
