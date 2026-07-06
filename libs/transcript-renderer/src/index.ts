/**
 * @rusty-view/transcript-renderer
 *
 * Virtualized transcript rendering: 10k+ messages, streaming-safe delta
 * rendering, scroll anchoring, tail-follow, jump-to-message, collapsible
 * blocks, and product-agnostic extension hooks.
 *
 * The virtualizer (Angular CDK) is hidden behind the public component API.
 * Implemented in Den task #3184.
 */

export { TranscriptViewportComponent } from './lib/transcript-viewport';
export { MessageItemComponent } from './lib/message-item';
export { MessageBlockComponent } from './lib/message-block';
export { MessageRevisionControlsComponent } from './lib/message-revision-controls';
export type {
  MessageRevisionAction,
  MessageRevisionActionKind,
  MessageRevisionCapabilities,
} from './lib/message-revision-controls';
export { AttachmentBlockComponent } from './lib/attachment-block';
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
export {
  DEFAULT_MARKDOWN_RENDER_POLICY,
  TRANSCRIPT_TEXT_RENDER_MODE,
  TRANSCRIPT_MARKDOWN_POLICY,
  TRANSCRIPT_HTML_POLICY,
  DEFAULT_HTML_SANITIZER_POLICY,
  DEFAULT_ALLOWED_HTML_TAGS,
  DEFAULT_ALLOWED_HTML_ATTRS,
} from './lib/render-mode-token';
export type {
  TextRenderMode,
  MarkdownLiteralExclusion,
  MarkdownLiteralMatchMode,
  MarkdownRenderPolicy,
  HtmlSanitizerPolicy,
} from './lib/render-mode-token';
export {
  CHAT_CONTENT_RENDERERS,
  TOOL_CALL_DEBUG_DETAIL_LOADER,
} from './lib/content-renderers';
export type {
  ChatContentRenderer,
  ChatContentRenderContext,
  ToolCallDebugDetailLoader,
} from './lib/content-renderers';

export const TRANSCRIPT_RENDERER_VERSION = '0.0.0' as const;
