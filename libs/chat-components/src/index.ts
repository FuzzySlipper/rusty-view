/**
 * @rusty-view/chat-components
 *
 * Dumb presentational components: message input, stream status indicator,
 * JSON inspector. No service injection, no store access, no domain logic.
 * Inputs/outputs only. OnPush everywhere. Design-token-driven CSS.
 *
 * Message bubble and block rendering live in @rusty-view/transcript-renderer
 * (#3184). This package provides the auxiliary debug/chat UI controls.
 *
 * Implemented in Den task #3185.
 */

export { MessageInputComponent } from './lib/message-input';
export { StreamStatusComponent } from './lib/stream-status';
export type { StreamStatusKind } from './lib/stream-status';
export { JsonInspectorComponent } from './lib/json-inspector';

export const CHAT_COMPONENTS_VERSION = '0.0.0' as const;
